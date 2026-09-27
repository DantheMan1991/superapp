import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";

/**
 * THE AUTH SPLIT NEEDS A CLERK SESSION, so this file fakes one — the first in
 * the suite to. Everywhere else the rule is "certify the ops, leave the Clerk
 * half alone", because the Clerk half is `requireTenant()` and nothing more.
 * Here the Clerk half IS the feature: which door a workspace may come through
 * is the whole of what keeps a personal space out of the business product and
 * the business out of it (ADR 0111). So `auth()` answers what each test says,
 * and `redirect()` throws where it goes, so a test can read it.
 */
const session = vi.hoisted(() => ({
  userId: null as string | null,
  orgId: null as string | null,
  orgRole: null as string | null,
  superadmin: false,
  method: "GET",
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({
    userId: session.userId,
    orgId: session.orgId,
    orgRole: session.orgRole,
  })),
  currentUser: vi.fn(async () =>
    session.userId
      ? {
          id: session.userId,
          publicMetadata: session.superadmin ? { role: "superadmin" } : {},
          emailAddresses: [],
        }
      : null,
  ),
  clerkClient: vi.fn(async () => {
    throw new Error("no real Clerk in tests — inject a fake");
  }),
}));

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect → ${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Redirected(to);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(
    async () =>
      new Headers({ "x-yosher-method": session.method, "x-yosher-path": "/dashboard" }),
  ),
}));

import { withSystem, withTenant, schema } from "../src/db";
import {
  requirePersonalSpace,
  requireTenant,
  resolvePersonalContext,
  resolveTenantContext,
} from "../src/lib/auth";
import {
  DuplicatePersonalSpaceError,
  upsertMembership,
  upsertProfileFromUser,
  upsertTenantFromOrg,
} from "../src/lib/tenant-sync";
import {
  ensurePersonalTools,
  PersonalSpaceError,
  personalToolsAvailableInTx,
  provisionPersonalSpace,
  type PersonalOrgClerk,
} from "../src/lib/personal-space";
import { getActiveModules, isModuleEnabled } from "../src/lib/modules";
import { personalOrgMetadata, personalSlug } from "../src/lib/personal-space-core";

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

const PID = process.pid;
const STAMP = `personal-db-${PID}`;
/** Clerk-shaped ids, so the metadata parser accepts them. */
const user = (tag: string) => `user_pdb${tag}${PID}`;
const org = (tag: string) => `org_pdb${tag}${PID}`;

/**
 * A fake Clerk that makes organizations with our ids and records what it was
 * asked. Slugs come back null, as they do from the real instance, which has
 * organization slugs switched off.
 */
function fakeClerk(opts: { beforeReturn?: (o: { id: string; name: string; slug: null }) => Promise<void> } = {}) {
  const created: Array<Parameters<PersonalOrgClerk["createOrganization"]>[0] & { id: string }> = [];
  const deleted: string[] = [];
  let n = 0;
  const clerk: PersonalOrgClerk = {
    async createOrganization(params) {
      n += 1;
      const id = `${org("fake")}x${n}${Math.random().toString(36).slice(2, 8)}`;
      created.push({ ...params, id });
      const made = { id, name: params.name, slug: null };
      if (opts.beforeReturn) await opts.beforeReturn(made);
      return { ...made, publicMetadata: params.publicMetadata };
    },
    async deleteOrganization(id) {
      deleted.push(id);
    },
  };
  return { clerk, created, deleted };
}

async function tenantsByOrg(clerkOrgId: string) {
  return withSystem((tx) =>
    tx.select().from(schema.tenants).where(eq(schema.tenants.clerkOrgId, clerkOrgId)),
  );
}

/** A `coming_soon` personal module: harmless if a run dies before cleanup — nothing enables it. */
const TEST_TOOL = `test-personal-${PID}`;

d("personal spaces: sync, provisioning, membership and the gate", () => {
  let business: string;

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [b] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: org("biz"), name: "PDB Business", slug: `${STAMP}-biz` })
        .returning();
      business = b.id;
      await tx
        .insert(schema.modules)
        .values({
          id: TEST_TOOL,
          name: "Test personal tool",
          category: "personal",
          status: "coming_soon",
          sortOrder: 9999,
        })
        .onConflictDoNothing();
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(like(schema.tenants.clerkOrgId, `org_pdb%${PID}%`));
      await tx.delete(schema.tenantModules).where(eq(schema.tenantModules.moduleId, TEST_TOOL));
      await tx.delete(schema.modules).where(eq(schema.modules.id, TEST_TOOL));
      await tx
        .delete(schema.profiles)
        .where(like(schema.profiles.clerkUserId, `user_pdb%${PID}`));
    });
  });

  describe("mirroring an organization", () => {
    it("the mark makes a personal space: kind, owner, active, and a subscription row", async () => {
      const t = await upsertTenantFromOrg({
        id: org("mirror"),
        name: "Personal",
        slug: `personal-${PID}a`,
        publicMetadata: personalOrgMetadata(user("mirror")),
      });
      expect(t.kind).toBe("personal");
      expect(t.personalOwnerClerkUserId).toBe(user("mirror"));
      expect(t.status).toBe("active");
      const sub = await withSystem((tx) =>
        tx.query.subscriptions.findFirst({ where: eq(schema.subscriptions.tenantId, t.id) }),
      );
      expect(sub?.status).toBe("none");
    });

    it("an update without the mark leaves the kind alone — the name follows Clerk, nothing else", async () => {
      const t = await upsertTenantFromOrg({ id: org("mirror"), name: "Renamed", slug: null });
      expect(t.name).toBe("Renamed");
      expect(t.kind).toBe("personal");
      expect(t.personalOwnerClerkUserId).toBe(user("mirror"));
    });

    it("no mark, or a forged one, is a business", async () => {
      const plain = await upsertTenantFromOrg({ id: org("plain"), name: "Plain Co" });
      expect(plain.kind).toBe("business");
      expect(plain.personalOwnerClerkUserId).toBeNull();
      const forged = await upsertTenantFromOrg({
        id: org("forged"),
        name: "Forged",
        publicMetadata: { yosherKind: "personal", personalOwner: "not a user" },
      });
      expect(forged.kind).toBe("business");
    });

    it("the webhook and provisioning racing on one organization land ONE row of the right kind", async () => {
      const facts = {
        id: org("race"),
        name: "Personal",
        slug: `personal-${PID}r`,
        publicMetadata: personalOrgMetadata(user("race")),
      };
      const [a, b] = await Promise.all([upsertTenantFromOrg(facts), upsertTenantFromOrg(facts)]);
      expect(a.id).toBe(b.id);
      const rows = await tenantsByOrg(org("race"));
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe("personal");
    });

    it("a second personal organization for the same person is refused by name", async () => {
      await expect(
        upsertTenantFromOrg({
          id: org("mirror2"),
          name: "Personal",
          publicMetadata: personalOrgMetadata(user("mirror")),
        }),
      ).rejects.toBeInstanceOf(DuplicatePersonalSpaceError);
      expect(await tenantsByOrg(org("mirror2"))).toHaveLength(0);
    });
  });

  describe("provisioning", () => {
    it("is closed to an ordinary person while no personal tool is available, and asks Clerk for nothing", async () => {
      const toolsOut = await withSystem((tx) => personalToolsAvailableInTx(tx));
      if (toolsOut) return; // The catalogue has one: the door is open for everybody, by design.
      const { clerk, created } = fakeClerk();
      await expect(
        provisionPersonalSpace({ clerkUserId: user("closed"), isSuperAdmin: false }, clerk),
      ).rejects.toBeInstanceOf(PersonalSpaceError);
      expect(created).toHaveLength(0);
    });

    it("makes one organization of one member, marked, and the row, the clock and the tools with it", async () => {
      const { clerk, created } = fakeClerk();
      const out = await provisionPersonalSpace(
        { clerkUserId: user("prov"), timezone: "America/Chicago", isSuperAdmin: true },
        clerk,
      );
      expect(out.created).toBe(true);
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        name: "Personal",
        createdBy: user("prov"),
        maxAllowedMemberships: 1,
        publicMetadata: personalOrgMetadata(user("prov")),
      });
      // Clerk is never sent a slug: the real instance refuses one with 403
      // `organization_slugs_disabled`, which is how driving P0 first failed.
      expect(created[0]).not.toHaveProperty("slug");

      const [row] = await tenantsByOrg(created[0].id);
      // The slug is ours, from the organization id, and carries no name.
      expect(row.slug).toBe(personalSlug(created[0].id));
      expect(row.kind).toBe("personal");
      expect(row.personalOwnerClerkUserId).toBe(user("prov"));
      expect(row.timezone).toBe("America/Chicago");
      expect(out.tenant.id).toBe(row.id);
    });

    it("a second ask hands back the same space and asks Clerk for nothing", async () => {
      const { clerk, created } = fakeClerk();
      const again = await provisionPersonalSpace(
        { clerkUserId: user("prov"), isSuperAdmin: true },
        clerk,
      );
      expect(again.created).toBe(false);
      expect(created).toHaveLength(0);
    });

    it("two at once (two tabs, a double click) make ONE organization, under the lock", async () => {
      const { clerk, created } = fakeClerk();
      const [a, b] = await Promise.all([
        provisionPersonalSpace({ clerkUserId: user("twice"), isSuperAdmin: true }, clerk),
        provisionPersonalSpace({ clerkUserId: user("twice"), isSuperAdmin: true }, clerk),
      ]);
      expect(created).toHaveLength(1);
      expect(a.tenant.id).toBe(b.tenant.id);
      expect([a.created, b.created].sort()).toEqual([false, true]);
    });

    it("the webhook landing FIRST changes nothing: one row, personal, with the person's clock", async () => {
      const { clerk } = fakeClerk({
        // Clerk announces the organization before its create call returns.
        beforeReturn: async (made) => {
          await upsertTenantFromOrg({
            ...made,
            publicMetadata: personalOrgMetadata(user("hook")),
          });
        },
      });
      const out = await provisionPersonalSpace(
        { clerkUserId: user("hook"), timezone: "Europe/London", isSuperAdmin: true },
        clerk,
      );
      const rows = await withSystem((tx) =>
        tx
          .select()
          .from(schema.tenants)
          .where(eq(schema.tenants.personalOwnerClerkUserId, user("hook"))),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(out.tenant.id);
      expect(rows[0].kind).toBe("personal");
      expect(rows[0].timezone).toBe("Europe/London");
    });

    it("a failure after the organization exists deletes it again, and leaves no row", async () => {
      const deleted: string[] = [];
      let madeId = "";
      const clerk: PersonalOrgClerk = {
        async createOrganization() {
          madeId = `${org("fail")}${Math.random().toString(36).slice(2, 8)}`;
          // A null name cannot be inserted: the row fails after Clerk has said yes.
          return { id: madeId, name: null as unknown as string, slug: null, publicMetadata: {} };
        },
        async deleteOrganization(id) {
          deleted.push(id);
        },
      };
      await expect(
        provisionPersonalSpace({ clerkUserId: user("fail"), isSuperAdmin: true }, clerk),
      ).rejects.toThrow();
      expect(deleted).toEqual([madeId]);
      expect(await tenantsByOrg(madeId)).toHaveLength(0);
    });
  });

  describe("membership", () => {
    it("the owner is mirrored; anybody else is refused; and no business rows ride along", async () => {
      const { clerk, created } = fakeClerk();
      const { tenant } = await provisionPersonalSpace(
        { clerkUserId: user("mem"), isSuperAdmin: true },
        clerk,
      );
      await upsertProfileFromUser({ id: user("mem"), email: `mem-${PID}@example.test` });
      await upsertProfileFromUser({ id: user("intruder"), email: `in-${PID}@example.test` });

      const owner = await upsertMembership({
        clerkOrgId: created[0].id,
        clerkUserId: user("mem"),
        clerkRole: "org:admin",
      });
      expect(owner.status).toBe("synced");

      const intruder = await upsertMembership({
        clerkOrgId: created[0].id,
        clerkUserId: user("intruder"),
        clerkRole: "org:member",
      });
      expect(intruder).toEqual({ status: "refused", reason: "not-the-owner" });

      const [calendars, lists, members] = await withSystem((tx) =>
        Promise.all([
          tx.select().from(schema.scheduleCalendars).where(eq(schema.scheduleCalendars.tenantId, tenant.id)),
          tx.select().from(schema.workLists).where(eq(schema.workLists.tenantId, tenant.id)),
          tx.select().from(schema.memberships).where(eq(schema.memberships.tenantId, tenant.id)),
        ]),
      );
      expect(calendars).toHaveLength(0);
      expect(lists).toHaveLength(0);
      expect(members).toHaveLength(1);
    });
  });

  describe("the module gate knows which tools belong where", () => {
    let space: string;

    beforeAll(async () => {
      const { clerk } = fakeClerk();
      space = (
        await provisionPersonalSpace({ clerkUserId: user("gate"), isSuperAdmin: true }, clerk)
      ).tenant.id;
      await withSystem((tx) =>
        tx.insert(schema.tenantModules).values([
          { tenantId: space, moduleId: TEST_TOOL, enabled: true },
          { tenantId: space, moduleId: "hello", enabled: true },
          { tenantId: business, moduleId: TEST_TOOL, enabled: true },
          { tenantId: business, moduleId: "hello", enabled: true },
        ]),
      );
    });

    it("a personal tool is on in a personal space and OFF in a business, whatever the row says", async () => {
      expect(await isModuleEnabled(space, TEST_TOOL)).toBe(true);
      expect(await isModuleEnabled(business, TEST_TOOL)).toBe(false);
    });

    it("a business tool is OFF in a personal space, whatever the row says", async () => {
      expect(await isModuleEnabled(space, "hello")).toBe(false);
      expect(await isModuleEnabled(business, "hello")).toBe(true);
    });

    it("the rail agrees with the gate", async () => {
      const inSpace = (await getActiveModules(space)).map((m) => m.module.id);
      expect(inSpace).toContain(TEST_TOOL);
      expect(inSpace).not.toContain("hello");
      const inBusiness = (await getActiveModules(business)).map((m) => m.module.id);
      expect(inBusiness).toContain("hello");
      expect(inBusiness).not.toContain(TEST_TOOL);
    });

    it("switching a space's tools on adds only AVAILABLE personal tools and never turns one back on", async () => {
      // Inside a transaction that is rolled back: an `available` personal tool
      // must never outlive this test, because it would open personal spaces to
      // everybody on this database.
      const Rollback = new Error("rollback");
      await withSystem(async (tx) => {
        const extra = `${TEST_TOOL}-avail`;
        await tx.insert(schema.modules).values({
          id: extra,
          name: "Available test tool",
          category: "personal",
          status: "available",
          sortOrder: 9999,
        });
        await tx
          .update(schema.tenantModules)
          .set({ enabled: false })
          .where(and(eq(schema.tenantModules.tenantId, space), eq(schema.tenantModules.moduleId, TEST_TOOL)));
        const added = await ensurePersonalTools(tx, space);
        expect(added).toBeGreaterThanOrEqual(1);
        const rows = await tx
          .select({ moduleId: schema.tenantModules.moduleId, enabled: schema.tenantModules.enabled })
          .from(schema.tenantModules)
          .where(
            and(
              eq(schema.tenantModules.tenantId, space),
              inArray(schema.tenantModules.moduleId, [extra, TEST_TOOL]),
            ),
          );
        expect(rows).toContainEqual({ moduleId: extra, enabled: true });
        // The coming_soon tool was switched off above and is still off.
        expect(rows).toContainEqual({ moduleId: TEST_TOOL, enabled: false });
        throw Rollback;
      }).catch((err) => {
        if (err !== Rollback) throw err;
      });
    });
  });

  describe("the auth split: each half opens only for its own kind of workspace", () => {
    let spaceOrg: string;

    beforeAll(async () => {
      const { clerk, created } = fakeClerk();
      await provisionPersonalSpace({ clerkUserId: user("auth"), isSuperAdmin: true }, clerk);
      spaceOrg = created[0].id;
    });

    beforeEach(() => {
      session.userId = null;
      session.orgId = null;
      session.orgRole = null;
      session.superadmin = false;
      session.method = "GET";
    });

    async function redirectOf(fn: () => Promise<unknown>): Promise<string | null> {
      try {
        await fn();
        return null;
      } catch (err) {
        if (err instanceof Redirected) return err.to;
        throw err;
      }
    }

    it("the business door sends a personal space to its home", async () => {
      Object.assign(session, { userId: user("auth"), orgId: spaceOrg, orgRole: "org:admin" });
      expect(await redirectOf(() => requireTenant())).toBe("/personal");
      expect(await resolveTenantContext()).toBeNull();
    });

    it("the personal door opens for the owner, as the owner", async () => {
      Object.assign(session, { userId: user("auth"), orgId: spaceOrg, orgRole: "org:admin" });
      const ctx = await requirePersonalSpace();
      expect(ctx.tenant.kind).toBe("personal");
      expect(ctx.role).toBe("owner");
      expect(ctx.support).toBeNull();
      expect((await resolvePersonalContext())?.tenant.id).toBe(ctx.tenant.id);
    });

    it("the personal door sends a business back to /dashboard", async () => {
      Object.assign(session, { userId: user("auth"), orgId: org("biz"), orgRole: "org:admin" });
      expect(await redirectOf(() => requirePersonalSpace())).toBe("/dashboard");
      expect(await resolvePersonalContext()).toBeNull();
    });

    it("somebody else's personal space is refused, even as an admin of it", async () => {
      Object.assign(session, { userId: user("stranger"), orgId: spaceOrg, orgRole: "org:admin" });
      expect(await redirectOf(() => requirePersonalSpace())).toBe("/onboarding");
      expect(await resolvePersonalContext()).toBeNull();
      expect(await redirectOf(() => requireTenant())).toBe("/personal");
    });

    it("a support session found on a personal space is ended, recorded, and opens nothing", async () => {
      const admin = user("admin");
      const [spaceRow] = await tenantsByOrg(spaceOrg);
      const [opened] = await withSystem((tx) =>
        tx
          .insert(schema.supportSessions)
          .values({
            tenantId: spaceRow.id,
            clerkUserId: admin,
            reason: "should never have been opened",
            expiresAt: new Date(Date.now() + 30 * 60_000),
          })
          .returning(),
      );
      Object.assign(session, { userId: admin, orgId: null, superadmin: true, method: "GET" });
      // Not the client's workspace: with the session refused, the superadmin
      // has no organization of their own here, so onboarding is where it goes.
      expect(await redirectOf(() => requireTenant())).toBe("/onboarding");

      const after = await withSystem((tx) =>
        tx.query.supportSessions.findFirst({ where: eq(schema.supportSessions.id, opened.id) }),
      );
      expect(after?.endedAt).not.toBeNull();
      const audit = await withSystem((tx) =>
        tx.query.auditLog.findFirst({
          where: and(
            eq(schema.auditLog.action, "support.refused_personal"),
            eq(schema.auditLog.targetId, opened.id),
          ),
        }),
      );
      expect(audit).toBeTruthy();
    });

    it("a business still opens through the business door, untouched", async () => {
      Object.assign(session, { userId: user("auth"), orgId: org("biz"), orgRole: "org:admin" });
      const ctx = await requireTenant();
      expect(ctx.tenant.id).toBe(business);
      expect(ctx.tenant.kind).toBe("business");
    });
  });

  it("a tenant-context read of a personal space is still just a tenant's read (withTenant)", async () => {
    const [row] = await withSystem((tx) =>
      tx.select().from(schema.tenants).where(eq(schema.tenants.personalOwnerClerkUserId, user("prov"))),
    );
    const seen = await withTenant(row.id, (tx) =>
      tx.select({ id: schema.tenants.id }).from(schema.tenants),
    );
    expect(seen).toEqual([{ id: row.id }]);
  });
});
