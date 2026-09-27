import "server-only";
import { cache } from "react";
import { and, eq, sql } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { withSystem, schema, type Tx } from "@/db";
import type { Tenant } from "@/db/schema";
import { insertTenantFromOrgInTx } from "@/lib/tenant-sync";
import { isValidTimeZone } from "@/lib/timezone";
import {
  enablePersonalToolsEverywhereSql,
  ensurePersonalToolsSql,
} from "@/lib/personal-tools-sql";
import {
  PERSONAL_CATEGORY,
  PERSONAL_ORG_NAME,
  personalOrgMetadata,
  personalSpacesOpen,
} from "@/lib/personal-space-core";

/**
 * A PERSONAL SPACE: finding one, and making one (ADR 0111,
 * docs/modules/personal-space.md).
 *
 * Trusted code, like `tenant-sync.ts`: it runs under `withSystem` because the
 * row it looks for or makes is not yet anybody's tenant context. Every caller
 * has already established WHO is asking from Clerk's own session — never from
 * input — and passes that id in.
 */

/**
 * The Clerk calls provisioning makes, injected so the database half — the
 * lock, the row, the tools, the race with the webhook — can be tested without
 * Clerk, the way `tests/operator-provision.test.ts` tests everything around
 * the console's one Clerk call.
 */
export interface PersonalOrgClerk {
  /**
   * No `slug`, on purpose: this Clerk instance has organization slugs off and
   * answers a create that carries one with 403 `organization_slugs_disabled`.
   * The space's slug is ours (`personalSlug`), made from the id Clerk returns.
   */
  createOrganization(params: {
    name: string;
    createdBy: string;
    maxAllowedMemberships: number;
    publicMetadata: Record<string, unknown>;
  }): Promise<{ id: string; name: string; slug: string | null; publicMetadata: unknown }>;
  deleteOrganization(organizationId: string): Promise<void>;
}

export const liveClerk: PersonalOrgClerk = {
  async createOrganization(params) {
    const client = await clerkClient();
    const org = await client.organizations.createOrganization(params);
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      publicMetadata: org.publicMetadata,
    };
  },
  async deleteOrganization(organizationId) {
    const client = await clerkClient();
    await client.organizations.deleteOrganization(organizationId);
  },
};

export async function findPersonalSpaceInTx(
  tx: Tx,
  clerkUserId: string,
): Promise<Tenant | null> {
  const row = await tx.query.tenants.findFirst({
    where: and(
      eq(schema.tenants.kind, "personal"),
      eq(schema.tenants.personalOwnerClerkUserId, clerkUserId),
    ),
  });
  return row ?? null;
}

/** This person's personal space, or null when they have not opened one. */
export async function findPersonalSpace(clerkUserId: string): Promise<Tenant | null> {
  return withSystem((tx) => findPersonalSpaceInTx(tx, clerkUserId));
}

/** Whether the catalogue has a personal tool anybody can use yet. */
export async function personalToolsAvailableInTx(tx: Tx): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.modules.id })
    .from(schema.modules)
    .where(
      and(
        eq(schema.modules.category, PERSONAL_CATEGORY),
        eq(schema.modules.status, "available"),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Whether the door is open for this person (see `personalSpacesOpen`). The
 * account menu asks it before drawing the item, and provisioning asks it
 * again before making anything, so the two cannot disagree.
 */
export async function personalSpacesOpenFor(isSuperAdmin: boolean): Promise<boolean> {
  if (isSuperAdmin) return true;
  const personalToolsAvailable = await withSystem((tx) => personalToolsAvailableInTx(tx));
  return personalSpacesOpen({ isSuperAdmin, personalToolsAvailable });
}

/**
 * SWITCH ON EVERY AVAILABLE PERSONAL TOOL in one personal space. Idempotent,
 * and it never switches anything OFF: a tool the person turned off is a row
 * with `enabled = false`, and `do nothing` on the conflict leaves it be.
 *
 * Called when a space is made. Spaces made BEFORE a tool shipped get it from
 * `enablePersonalToolsEverywhere`, which the seed runs — a new row in the
 * catalogue reaching only the spaces created after it would be exactly the
 * "seeded rows do not follow the seed" trap.
 */
export async function ensurePersonalTools(
  tx: Tx,
  tenantId: string,
  opts: { preview?: boolean } = {},
): Promise<number> {
  const added = await tx.execute(ensurePersonalToolsSql(tenantId, opts));
  return added.rows.length;
}

/**
 * The door's half (`/personal/open`): a space made before a tool shipped —
 * or, for a superadmin, before a tool was even `available` — gets it the next
 * time its owner comes through the door. The space's layout asks too, for a
 * superadmin's preview only, since the workspace switcher never passes the
 * door. The seed does the same for `available` tools in every space; this is
 * what reaches a preview.
 */
export async function ensurePersonalToolsFor(
  tenantId: string,
  opts: { preview: boolean },
): Promise<number> {
  return withSystem((tx) => ensurePersonalTools(tx, tenantId, opts));
}

/**
 * A superadmin's preview, switched on ONCE per request, before anything
 * reads the space's tools. The layout (the rail) and the page (the home's
 * `Your tools`) render side by side, so each awaits this same promise (React
 * `cache`) before it reads. The first drive of it did it in the layout alone,
 * and the home, reading at the same moment, said "Nothing is switched on here
 * yet" under a rail that listed Workouts: the founder's first visit after it
 * shipped. Nothing for anybody who is not a superadmin.
 */
export const previewPersonalTools = cache(async (tenantId: string, admin: boolean): Promise<void> => {
  if (admin) await ensurePersonalToolsFor(tenantId, { preview: true });
});

/** The same, for every personal space at once. The seed's half. */
export async function enablePersonalToolsEverywhere(tx: Tx): Promise<number> {
  const added = await tx.execute(enablePersonalToolsEverywhereSql);
  return added.rows.length;
}

/** Why a person could not be given a space. The action turns each into a sentence. */
export class PersonalSpaceError extends Error {
  constructor(readonly code: "CLOSED") {
    super(code);
    this.name = "PersonalSpaceError";
  }
}

export interface ProvisionedSpace {
  tenant: Tenant;
  /** False when the person already had one and was handed it back. */
  created: boolean;
}

/**
 * GIVE THIS PERSON THEIR PERSONAL SPACE: the one they have, or a new one.
 *
 * **One per person, under a lock.** The check and the create run inside one
 * transaction holding an advisory lock on the person, so two tabs, or a double
 * click, queue here and the second is handed the first's space. The unique
 * index behind it (`tenants_personal_owner_idx`) is the backstop, not the plan.
 *
 * **The Clerk organization is made inside that transaction**, and that is
 * deliberate: its id is what the row is keyed on, and holding the lock across
 * the call is what makes "check, then create" atomic for this person. If
 * anything after the call fails, the organization is deleted again, so a
 * failure leaves neither half behind.
 *
 * **It races the webhook, and both win.** Clerk announces the organization the
 * moment it exists; `organization.created` may insert the row before this
 * does. Both go through `insertTenantFromOrgInTx`, which reads the kind off the
 * organization's metadata, so whichever lands first lands the same row.
 */
export async function provisionPersonalSpace(
  input: { clerkUserId: string; timezone?: string | null; isSuperAdmin: boolean },
  clerk: PersonalOrgClerk = liveClerk,
): Promise<ProvisionedSpace> {
  return withSystem(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`personal-space:${input.clerkUserId}`}))`,
    );
    const existing = await findPersonalSpaceInTx(tx, input.clerkUserId);
    if (existing) return { tenant: existing, created: false };

    const open = personalSpacesOpen({
      isSuperAdmin: input.isSuperAdmin,
      personalToolsAvailable: await personalToolsAvailableInTx(tx),
    });
    if (!open) throw new PersonalSpaceError("CLOSED");

    const metadata = personalOrgMetadata(input.clerkUserId);
    const org = await clerk.createOrganization({
      name: PERSONAL_ORG_NAME,
      createdBy: input.clerkUserId,
      // The first of the three locks on the door (docs/modules/personal-space.md):
      // Clerk itself will not let a second person in.
      maxAllowedMemberships: 1,
      publicMetadata: { ...metadata },
    });

    try {
      const tenant = await insertTenantFromOrgInTx(tx, {
        id: org.id,
        name: org.name,
        slug: org.slug,
        // What we SENT, not what came back: it is our own mark, and a response
        // that dropped it must not turn the space into a business.
        publicMetadata: metadata,
      });
      // The person's own clock, from their browser. A personal space's "today"
      // is theirs, and there is no business day to borrow.
      const timezone =
        input.timezone && isValidTimeZone(input.timezone) ? input.timezone : null;
      if (timezone && tenant.timezone !== timezone) {
        await tx
          .update(schema.tenants)
          .set({ timezone, updatedAt: new Date() })
          .where(eq(schema.tenants.id, tenant.id));
      }
      // AVAILABLE tools only, for everybody. A superadmin's preview of the
      // `coming_soon` ones is switched on where the space is opened (the door,
      // the layout and the home: `previewPersonalTools`), never here, so
      // provisioning, which every consumer's space goes through, keeps the
      // one rule the seed keeps.
      await ensurePersonalTools(tx, tenant.id);
      return { tenant: { ...tenant, timezone: timezone ?? tenant.timezone }, created: true };
    } catch (err) {
      await clerk.deleteOrganization(org.id).catch((cleanup: unknown) => {
        console.error("personal space: could not delete the orphaned organization", org.id, cleanup);
      });
      throw err;
    }
  });
}
