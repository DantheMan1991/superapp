import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d, seedParty } from "./_shared";

/**
 * A PERSONAL SPACE IS AN ORDINARY TENANT TO THE DATABASE (ADR 0111).
 *
 * The same wall core.test.ts proves for any pair of tenants stands between a
 * person's business and their personal space — in both directions, and with
 * the same person being a member of both, which is the case this feature
 * turns on. What is special about a personal space is only what the database
 * itself enforces about the ROW, and this file proves each of those:
 *
 *   - one per person (`tenants_personal_owner_idx`);
 *   - a personal space has an owner and a business never does
 *     (`tenants_personal_owner_check`);
 *   - the operator is always a business (`tenants_operator_is_business_check`);
 *   - kind and owner never change, even under `withSystem`
 *     (`tenants_kind_immutable`), because the auth split reads them on every
 *     request.
 *
 * Fixtures are raw inserts, like every file here: this certifies what the
 * DATABASE enforces, and routing them through `tenant-sync.ts` would let a bug
 * there make this file agree with it.
 */

const STAMP = `iso-personal-${process.pid}`;
const OWNER = `user_isoowner${process.pid}`;
const OTHER = `user_isoother${process.pid}`;

/** Whether an error names a constraint, on the message or on its cause. */
function names(err: unknown, needle: string): boolean {
  const e = err as { message?: string; cause?: { message?: string } };
  return `${e?.message ?? ""} ${e?.cause?.message ?? ""}`.includes(needle);
}

async function refusedWith(fn: () => Promise<unknown>, needle: string): Promise<boolean> {
  try {
    await fn();
  } catch (err) {
    return names(err, needle);
  }
  return false;
}

let business: string;
let personal: string;
let businessParty: string;
let personalParty: string;

d("a personal space is an ordinary tenant (RLS)", () => {
  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [b] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: `${STAMP}-b`, name: "Isolation Business", slug: `${STAMP}-b` })
        .returning();
      business = b.id;
      const [p] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-p`,
          name: "Personal",
          slug: `${STAMP}-p`,
          kind: "personal",
          personalOwnerClerkUserId: OWNER,
        })
        .returning();
      personal = p.id;
      businessParty = await seedParty(tx, business, "The business's own party");
      personalParty = await seedParty(tx, personal, "Something in the personal space");
    });
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx
        .delete(schema.tenants)
        .where(inArray(schema.tenants.clerkOrgId, [`${STAMP}-b`, `${STAMP}-p`, `${STAMP}-p2`])),
    );
  });

  it("a person's business cannot read their personal space, nor the space the business", async () => {
    const fromBusiness = await withTenant(business, (tx) =>
      tx.select({ id: schema.parties.id }).from(schema.parties),
    );
    expect(fromBusiness.map((r) => r.id)).toContain(businessParty);
    expect(fromBusiness.map((r) => r.id)).not.toContain(personalParty);

    const fromPersonal = await withTenant(personal, (tx) =>
      tx.select({ id: schema.parties.id }).from(schema.parties),
    );
    expect(fromPersonal.map((r) => r.id)).toEqual([personalParty]);

    // Asked by id, across the wall, as the owner — who is the same person in
    // both — the answer is still nothing. RLS knows tenants, not people.
    const byId = await withTenant(
      business,
      (tx) =>
        tx
          .select({ id: schema.parties.id })
          .from(schema.parties)
          .where(eq(schema.parties.id, personalParty)),
      { role: "owner" },
    );
    expect(byId).toHaveLength(0);
  });

  it("each can read its own tenants row and not the other's", async () => {
    const seen = await withTenant(business, (tx) =>
      tx.select({ id: schema.tenants.id }).from(schema.tenants),
    );
    expect(seen.map((r) => r.id)).toEqual([business]);
    const seenFromPersonal = await withTenant(personal, (tx) =>
      tx.select({ id: schema.tenants.id, kind: schema.tenants.kind }).from(schema.tenants),
    );
    expect(seenFromPersonal).toEqual([{ id: personal, kind: "personal" }]);
  });

  it("a member cannot write the kind or the owner, from inside either workspace", async () => {
    const fromInside = await withTenant(personal, (tx) =>
      tx
        .update(schema.tenants)
        .set({ kind: "business", personalOwnerClerkUserId: null })
        .where(eq(schema.tenants.id, personal))
        .returning(),
    );
    expect(fromInside).toHaveLength(0);
    const fromBusiness = await withTenant(business, (tx) =>
      tx
        .update(schema.tenants)
        .set({ kind: "personal", personalOwnerClerkUserId: OTHER })
        .where(eq(schema.tenants.id, business))
        .returning(),
    );
    expect(fromBusiness).toHaveLength(0);
  });

  it("kind and owner never change, even under withSystem — the trigger refuses it", async () => {
    expect(
      await refusedWith(
        () =>
          withSystem((tx) =>
            tx
              .update(schema.tenants)
              .set({ kind: "business", personalOwnerClerkUserId: null })
              .where(eq(schema.tenants.id, personal)),
          ),
        "tenants_kind_immutable",
      ),
    ).toBe(true);
    expect(
      await refusedWith(
        () =>
          withSystem((tx) =>
            tx
              .update(schema.tenants)
              .set({ personalOwnerClerkUserId: OTHER })
              .where(eq(schema.tenants.id, personal)),
          ),
        "tenants_kind_immutable",
      ),
    ).toBe(true);
    expect(
      await refusedWith(
        () =>
          withSystem((tx) =>
            tx
              .update(schema.tenants)
              .set({ kind: "personal", personalOwnerClerkUserId: OTHER })
              .where(eq(schema.tenants.id, business)),
          ),
        "tenants_kind_immutable",
      ),
    ).toBe(true);

    // Everything else about the row still moves: the name follows Clerk.
    const [renamed] = await withSystem((tx) =>
      tx
        .update(schema.tenants)
        .set({ name: "Personal (renamed)" })
        .where(eq(schema.tenants.id, personal))
        .returning({ kind: schema.tenants.kind, owner: schema.tenants.personalOwnerClerkUserId }),
    );
    expect(renamed).toEqual({ kind: "personal", owner: OWNER });
  });

  it("one personal space per person — a second is refused by the index", async () => {
    expect(
      await refusedWith(
        () =>
          withSystem((tx) =>
            tx.insert(schema.tenants).values({
              clerkOrgId: `${STAMP}-p2`,
              name: "Personal",
              slug: `${STAMP}-p2`,
              kind: "personal",
              personalOwnerClerkUserId: OWNER,
            }),
          ),
        "tenants_personal_owner_idx",
      ),
    ).toBe(true);
  });

  it("a personal space has an owner, and a business never does", async () => {
    expect(
      await refusedWith(
        () =>
          withSystem((tx) =>
            tx.insert(schema.tenants).values({
              clerkOrgId: `${STAMP}-p2`,
              name: "Personal",
              slug: `${STAMP}-p2`,
              kind: "personal",
            }),
          ),
        "tenants_personal_owner_check",
      ),
    ).toBe(true);
    expect(
      await refusedWith(
        () =>
          withSystem((tx) =>
            tx.insert(schema.tenants).values({
              clerkOrgId: `${STAMP}-p2`,
              name: "A business that names an owner",
              slug: `${STAMP}-p2`,
              personalOwnerClerkUserId: OTHER,
            }),
          ),
        "tenants_personal_owner_check",
      ),
    ).toBe(true);
  });

  it("the operator is a business, never somebody's personal space", async () => {
    expect(
      await refusedWith(
        () =>
          withSystem((tx) =>
            tx.insert(schema.tenants).values({
              clerkOrgId: `${STAMP}-p2`,
              name: "Personal operator",
              slug: `${STAMP}-p2`,
              kind: "personal",
              personalOwnerClerkUserId: OTHER,
              isOperator: true,
            }),
          ),
        // A CHECK is evaluated before the row reaches any index, so this
        // refusal comes first even on a database that already names an
        // operator (where `tenants_operator_idx` would refuse it next).
        "tenants_operator_is_business_check",
      ),
    ).toBe(true);
  });
});
