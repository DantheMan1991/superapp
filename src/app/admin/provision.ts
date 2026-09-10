import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { withSystem, withTenant, schema } from "@/db";
import { isModuleEnabled } from "@/lib/modules";
import { getOperatorTenant } from "@/lib/operator-tenant";
import { loadParty, PartyError } from "@/lib/parties";
import { listContactPoints } from "@/lib/parties/contacts";
import { uniqueTenantSlug } from "@/lib/slug";
import { logActivity } from "@/modules/crm/timeline-ops";

/**
 * A workspace is provisioned FROM a party (ADR 0041, back-office slice 3).
 *
 * The relationship comes first and lives in the operator's CRM; the workspace
 * is the thing the platform makes for it, once, when the deal is won. So the
 * console's *New workspace* starts from a party, and everything it can decide
 * without asking Clerk for anything is decided here, before Clerk is asked:
 * that the party exists in the operator's CRM, that it is a business and not
 * a person, that no workspace points at it already, what the workspace will
 * be called, and the slug a person would type (Clerk suffixes the one it
 * makes for an API-created organization — `yosher-app-1789…` — and the
 * console shows slugs nowhere, so the platform names it).
 *
 * The action in actions.ts composes: resolve → Clerk → `upsertTenantFromOrg`
 * → attach. Only the Clerk call is outside this file, which is what makes the
 * rest of it testable without one.
 */

export type ProvisionRefusal =
  | "NO_OPERATOR"
  | "PARTY_NOT_FOUND"
  | "NOT_A_BUSINESS"
  | "HAS_WORKSPACE";

export class ProvisionError extends Error {
  constructor(
    readonly code: ProvisionRefusal,
    message: string,
  ) {
    super(message);
    this.name = "ProvisionError";
  }
}

/** The sentence the console shows for a refusal. */
export function provisionMessage(code: ProvisionRefusal): string {
  switch (code) {
    case "NO_OPERATOR":
      return "No operator tenant is named yet — run scripts/operator-tenant.ts first.";
    case "PARTY_NOT_FOUND":
      return "That business is not in the operator's CRM.";
    case "NOT_A_BUSINESS":
      return "A workspace is for a business, not a person — pick the company.";
    case "HAS_WORKSPACE":
      return "That business already has a workspace.";
  }
}

export interface ProvisionTarget {
  operatorId: string;
  partyId: string;
  /** The party's display name — the workspace's name. */
  name: string;
  /** The party's first email contact point, for `tenants.contact_email`. */
  email: string | null;
  /** Deduped against `tenants.slug`; handed to Clerk explicitly. */
  slug: string;
}

/**
 * Everything the console can check before Clerk is asked for anything.
 * Reads the party through the OPERATOR's context as staff.
 */
export async function resolveProvisionTarget(partyId: string): Promise<ProvisionTarget> {
  const operator = await getOperatorTenant();
  if (!operator) {
    throw new ProvisionError("NO_OPERATOR", "no operator tenant is named");
  }

  let party: { id: string; kind: string; displayName: string };
  let email: string | null = null;
  try {
    const read = await withTenant(
      operator.id,
      async (tx) => {
        const p = await loadParty(tx, operator.id, partyId);
        const points = await listContactPoints(tx, operator.id, p.id);
        return { party: p, points };
      },
      { role: "staff" },
    );
    party = read.party;
    email = read.points.find((c) => c.kind === "email")?.value ?? null;
  } catch (err) {
    if (err instanceof PartyError && err.code === "PARTY_NOT_FOUND") {
      throw new ProvisionError("PARTY_NOT_FOUND", "party not in the operator's CRM");
    }
    throw err;
  }
  if (party.kind !== "organization") {
    throw new ProvisionError("NOT_A_BUSINESS", "a workspace is for an organization");
  }

  const existing = await withSystem((tx) =>
    tx.query.tenants.findFirst({
      where: eq(schema.tenants.operatorPartyId, partyId),
      columns: { id: true },
    }),
  );
  if (existing) {
    throw new ProvisionError("HAS_WORKSPACE", "a workspace already points at this party");
  }

  const slug = await withSystem((tx) => uniqueTenantSlug(tx, party.displayName));
  return { operatorId: operator.id, partyId: party.id, name: party.displayName, email, slug };
}

/**
 * After Clerk has made the organization and `upsertTenantFromOrg` the row:
 * the pointer (once — a second call for the same party changes nothing), the
 * contact email the party carries, and the platform's one permitted touch on
 * the relationship, a note on the party's timeline saying a workspace exists.
 */
export async function attachWorkspaceToParty(
  tenantId: string,
  target: ProvisionTarget,
  actor: { userId: string },
): Promise<{ linked: boolean }> {
  const [linked] = await withSystem((tx) =>
    tx
      .update(schema.tenants)
      .set({
        operatorPartyId: target.partyId,
        contactEmail: target.email,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.tenants.id, tenantId), isNull(schema.tenants.operatorPartyId)))
      .returning({ id: schema.tenants.id }),
  );
  if (!linked) return { linked: false };

  if (await isModuleEnabled(target.operatorId, "crm")) {
    await withTenant(
      target.operatorId,
      (tx) =>
        logActivity(
          tx,
          { tenantId: target.operatorId, userId: actor.userId, role: "owner" },
          {
            partyId: target.partyId,
            kind: "note",
            subject: "Workspace provisioned",
            body: `A Yosher workspace was created for ${target.name}.`,
          },
        ),
      { role: "owner", userId: actor.userId },
    );
  }
  return { linked: true };
}
