import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema } from "../src/db";
import { mintGrant, revokeGrant } from "../src/lib/device-grants/ops";
import {
  clampSpokenAt,
  redeemGrant,
  roleForGrant,
} from "../src/lib/device-grants/redeem";
import { SPOKEN_AT_TOLERANCE_MS } from "../src/lib/device-grants/types";
// The local gate the other non-isolation database suites use. NOT `_shared`'s
// `d`: that module belongs to the isolation certification, and this file is
// the behaviour on top of it rather than part of it.
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

/**
 * THE GATE ITSELF (ADR 0048) — what a token gets you, and every way it stops
 * getting you anything.
 *
 * The RLS certification for these tables is `tests/isolation/device-grants`;
 * this file is the behaviour on top of it, and the case it exists for is the
 * one the founder named: **nobody is going to revoke a departed worker's
 * phone.** Thirty-day sliding expiry does not cover that — it rewards use,
 * and somebody still talking to it every morning renews it forever. Taking
 * them out of the workspace does, through the INNER JOIN on `memberships`,
 * and the test named for it is the one that must never be deleted.
 */
d("device grant redeem", () => {
  const STAMP = `redeem-${process.pid}-${Date.now()}`;
  const PERSON = `${STAMP}-person`;
  let tenantId: string;
  let profileId: string;
  let token: string;

  beforeAll(async () => {
    // `hashToken` fails closed without it, by design. A test database is not
    // a place to depend on the deployment's secret.
    process.env.SHARE_SECRET ??= "test-share-secret-at-least-32-chars-long";

    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `org_${STAMP}`,
          name: `Redeem ${STAMP}`,
          slug: STAMP,
          timezone: "America/Chicago",
        })
        .returning();
      tenantId = tenant.id;

      const [profile] = await tx
        .insert(schema.profiles)
        .values({ clerkUserId: PERSON, email: `${STAMP}@example.test` })
        .returning();
      profileId = profile.id;

      await tx
        .insert(schema.memberships)
        .values({ tenantId, profileId, role: "staff" });
    });

    token = await withTenant(
      tenantId,
      (tx) =>
        mintGrant(
          tx,
          { tenantId, userId: PERSON },
          { label: "Test phone", platform: "ios" },
        ),
      { role: "staff", userId: PERSON },
    );
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
      await tx.delete(schema.profiles).where(eq(schema.profiles.id, profileId));
    });
  });

  it("a live grant resolves to its own person, in their business, on their day", async () => {
    const redeemed = await redeemGrant(token);
    expect(redeemed).not.toBeNull();
    expect(redeemed!.ctx.tenantId).toBe(tenantId);
    expect(redeemed!.ctx.userId).toBe(PERSON);
    expect(redeemed!.ctx.role).toBe("staff");
    // The tenant's day, not the server's — "this morning" has to mean the
    // right morning for a phone in a different timezone from the region.
    expect(redeemed!.ctx.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("using it slides its expiry forward", async () => {
    const before = await withSystem((tx) =>
      tx.select().from(schema.deviceGrants).where(eq(schema.deviceGrants.tenantId, tenantId)),
    );
    const was = before[0].expiresAt.getTime();

    await redeemGrant(token, new Date(Date.now() + 60_000));

    const after = await withSystem((tx) =>
      tx.select().from(schema.deviceGrants).where(eq(schema.deviceGrants.tenantId, tenantId)),
    );
    expect(after[0].expiresAt.getTime()).toBeGreaterThan(was);
    expect(after[0].lastUsedAt).not.toBeNull();
  });

  it("gibberish costs no round trip and resolves to nothing", async () => {
    expect(await redeemGrant("not-a-token")).toBeNull();
    expect(await redeemGrant("")).toBeNull();
  });

  it("an expired grant is nothing, however valid the token", async () => {
    const wayLater = new Date(Date.now() + 400 * 24 * 60 * 60 * 1_000);
    expect(await redeemGrant(token, wayLater)).toBeNull();
  });

  /**
   * THE ONE THIS FEATURE TURNS ON. Somebody leaves, nobody thinks about their
   * phone, and the phone stops working anyway — because the thing people DO
   * do when somebody leaves is take them out of the workspace, and
   * `organizationMembership.deleted` hard-deletes this row
   * (`src/lib/tenant-sync.ts`).
   */
  it("taking the person out of the workspace kills their phone", async () => {
    expect(await redeemGrant(token)).not.toBeNull();

    await withSystem((tx) =>
      tx
        .delete(schema.memberships)
        .where(
          and(
            eq(schema.memberships.tenantId, tenantId),
            eq(schema.memberships.profileId, profileId),
          ),
        ),
    );

    expect(await redeemGrant(token)).toBeNull();

    // Put it back for the revoke test below.
    await withSystem((tx) =>
      tx.insert(schema.memberships).values({ tenantId, profileId, role: "staff" }),
    );
  });

  it("a revoked grant is nothing", async () => {
    const [row] = await withSystem((tx) =>
      tx.select().from(schema.deviceGrants).where(eq(schema.deviceGrants.tenantId, tenantId)),
    );
    await withTenant(tenantId, (tx) => revokeGrant(tx, row.id), {
      role: "staff",
      userId: PERSON,
    });
    expect(await redeemGrant(token)).toBeNull();
  });
});

describe("a grant is never an owner", () => {
  it("flattens owner and staff alike, and carries expert through", () => {
    // Clerk owns owner-vs-member and this path cannot ask it, so the rule is
    // least privilege rather than a network hop for the privilege of granting
    // MORE. `expert` is carried because expert is not a lesser staff — it is a
    // different member, read-only in the core modules.
    expect(roleForGrant("owner")).toBe("staff");
    expect(roleForGrant("staff")).toBe("staff");
    expect(roleForGrant(null)).toBe("staff");
    expect(roleForGrant("expert")).toBe("expert");
  });
});

describe("the phone's clock", () => {
  const now = new Date("2026-09-12T14:00:00.000Z");

  it("is believed inside the tolerance, because a queued sentence is old on purpose", () => {
    const claimed = new Date(now.getTime() - 10 * 60 * 1_000);
    expect(clampSpokenAt(claimed, now)).toEqual({ effectiveAt: claimed, clamped: false });
  });

  it("loses to the server outside it, in either direction", () => {
    const back = new Date(now.getTime() - SPOKEN_AT_TOLERANCE_MS - 1_000);
    expect(clampSpokenAt(back, now)).toEqual({ effectiveAt: now, clamped: true });
    const forward = new Date(now.getTime() + SPOKEN_AT_TOLERANCE_MS + 1_000);
    expect(clampSpokenAt(forward, now)).toEqual({ effectiveAt: now, clamped: true });
  });

  it("falls back to the server when the phone says nothing, or says nonsense", () => {
    expect(clampSpokenAt(null, now)).toEqual({ effectiveAt: now, clamped: false });
    expect(clampSpokenAt(new Date("nope"), now)).toEqual({
      effectiveAt: now,
      clamped: false,
    });
  });
});
