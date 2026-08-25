import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d } from "./_shared";

/**
 * `payment_accounts` RLS — one company's ability to take a card.
 *
 * **THIS TABLE IS THE ONE EXCEPTION TO THE SHAPE EVERY OTHER PACK TABLE HAS,
 * and the exception is what most of this file tests.** Members hold a SELECT
 * policy and nothing else, so a `withTenant` transaction can read the row and
 * cannot write it — not its own row, not anybody's. Every column on it is
 * Stripe's verdict about a KYC review this platform does not perform, and S7
 * says such state is written only from a signature-verified webhook or a
 * server→Stripe reconcile. Here that rule is a policy rather than a habit.
 *
 * The failure it forecloses: something inside a tenant transaction sets
 * `card_payments_status` to `active`, the till believes the farm can take a
 * card, and the customer's card is declined at a stall with a queue behind it.
 *
 * The composite FK is the other half. A connected account naming another
 * tenant's company is UNREPRESENTABLE rather than merely refused — it fails
 * even under `withSystem`, where RLS is not watching — and that matters more
 * here than almost anywhere, because the company is what decides whose bank the
 * money lands in and whose tax ID Stripe reports it under (ADR 0015).
 */
d("payment_accounts (RLS)", () => {
  const STAMP = `iso-pay-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const OTHER = `${STAMP}-other`;

  let tenantA: string;
  let tenantB: string;
  let entityA1: string;
  let entityA2: string;
  let entityB: string;
  let accountA: string;
  let accountB: string;

  const asStaff = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "staff", userId: MATE });
  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "owner", userId: OWNER });
  const asOtherTenant = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantB, fn, { role: "owner", userId: OTHER });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const tenants = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP}-a`, name: "Pay A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Pay B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;

      /**
       * **TENANT A DELIBERATELY HOLDS TWO COMPANIES.** ADR 0015 records that a
       * one-company tenant cannot see the difference between hanging this row
       * off the tenant and hanging it off the entity — which is precisely the
       * blind spot that cost `production` slice 2c a real bug. A fixture with
       * one company would pass every assertion below and prove nothing.
       */
      const entities = await tx
        .insert(schema.entities)
        .values([
          { tenantId: tenantA, name: "Oak Row LLC", isDefault: true },
          { tenantId: tenantA, name: "Maple Street LLC" },
          { tenantId: tenantB, name: "B Farm LLC", isDefault: true },
        ])
        .returning();
      entityA1 = entities[0].id;
      entityA2 = entities[1].id;
      entityB = entities[2].id;

      const accounts = await tx
        .insert(schema.paymentAccounts)
        .values([
          {
            tenantId: tenantA,
            entityId: entityA1,
            stripeAccountId: `acct_${STAMP.replace(/-/g, "")}A`,
            cardPaymentsStatus: "active",
          },
          {
            tenantId: tenantB,
            entityId: entityB,
            stripeAccountId: `acct_${STAMP.replace(/-/g, "")}B`,
          },
        ])
        .returning();
      accountA = accounts[0].id;
      accountB = accounts[1].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      // The entity FK is RESTRICT, so the accounts have to go before the
      // companies do. The tenant cascade takes both in the right order.
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  // ---- reads ------------------------------------------------------------

  it("a tenant sees only its own connected accounts", async () => {
    expect(
      (await asOwner((tx) => tx.select().from(schema.paymentAccounts))).map(
        (a) => a.id,
      ),
    ).toEqual([accountA]);
    expect(
      (
        await asOtherTenant((tx) => tx.select().from(schema.paymentAccounts))
      ).map((a) => a.id),
    ).toEqual([accountB]);
  });

  it("staff can read the row too — the till has to know it can take a card", async () => {
    const rows = await asStaff((tx) => tx.select().from(schema.paymentAccounts));
    expect(rows).toHaveLength(1);
    expect(rows[0].cardPaymentsStatus).toBe("active");
  });

  it("cannot read another tenant's connected account", async () => {
    expect(
      await asOwner((tx) =>
        tx
          .select()
          .from(schema.paymentAccounts)
          .where(eq(schema.paymentAccounts.id, accountB)),
      ),
    ).toHaveLength(0);
  });

  // ---- the writes that must not happen ----------------------------------

  it("AN OWNER CANNOT WRITE ITS OWN ROW — the capability status is Stripe's to say", async () => {
    /**
     * The assertion this file exists for.
     *
     * **AND IT IS SILENT, WHICH IS THE HALF WORTH KNOWING.** A member policy
     * scoped `FOR SELECT` gives an UPDATE no USING clause to satisfy, so the
     * row is invisible to that command and Postgres reports zero rows changed
     * rather than raising. An INSERT is the loud one, because there a missing
     * WITH CHECK is a violation rather than an empty match (below).
     *
     * So a future action reaching for this table fails by doing NOTHING. It
     * still cannot make the app believe a farm can take a card, which is the
     * whole guarantee — but nobody should expect an exception to announce it.
     */
    expect(
      await asOwner((tx) =>
        tx
          .update(schema.paymentAccounts)
          .set({ cardPaymentsStatus: "active", requirements: [] })
          .where(eq(schema.paymentAccounts.id, accountA))
          .returning(),
      ),
    ).toHaveLength(0);

    // And the row really is untouched, rather than merely unreported.
    const [row] = await withSystem((tx) =>
      tx
        .select()
        .from(schema.paymentAccounts)
        .where(eq(schema.paymentAccounts.id, accountA)),
    );
    expect(row.cardPaymentsStatus).toBe("active");
  });

  it("an owner cannot insert a connected account of its own — and this one throws", async () => {
    // The loud case: no member WITH CHECK policy exists, so the insert is a
    // policy violation (42501) rather than an empty match.
    await expect(
      asOwner((tx) =>
        tx.insert(schema.paymentAccounts).values({
          tenantId: tenantA,
          entityId: entityA2,
          stripeAccountId: `acct_${STAMP.replace(/-/g, "")}SELF`,
          cardPaymentsStatus: "active",
        }),
      ),
    ).rejects.toThrow();
  });

  it("an owner cannot delete its own connected account", async () => {
    expect(
      await asOwner((tx) =>
        tx
          .delete(schema.paymentAccounts)
          .where(eq(schema.paymentAccounts.id, accountA))
          .returning(),
      ),
    ).toHaveLength(0);
  });

  it("cannot update or delete another tenant's connected account", async () => {
    expect(
      await asOwner((tx) =>
        tx
          .update(schema.paymentAccounts)
          .set({ cardPaymentsStatus: "restricted" })
          .where(eq(schema.paymentAccounts.id, accountB))
          .returning(),
      ),
    ).toHaveLength(0);
    expect(
      await asOwner((tx) =>
        tx
          .delete(schema.paymentAccounts)
          .where(eq(schema.paymentAccounts.id, accountB))
          .returning(),
      ),
    ).toHaveLength(0);
  });

  it("the superadmin context can write — that is how the webhook syncs", async () => {
    const rows = await withSystem((tx) =>
      tx
        .update(schema.paymentAccounts)
        .set({ cardPaymentsStatus: "restricted" })
        .where(eq(schema.paymentAccounts.id, accountA))
        .returning(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cardPaymentsStatus).toBe("restricted");
    await withSystem((tx) =>
      tx
        .update(schema.paymentAccounts)
        .set({ cardPaymentsStatus: "active" })
        .where(eq(schema.paymentAccounts.id, accountA)),
    );
  });

  // ---- the shapes the schema makes unrepresentable ----------------------

  it("CANNOT NAME ANOTHER TENANT'S COMPANY, even under withSystem", async () => {
    /**
     * The composite FK, and the reason it is composite. The company decides
     * whose bank the money lands in and whose tax ID Stripe reports it under —
     * so a row pointing at somebody else's LLC would pay one farm's market
     * takings into another farm's account, and file them on its tax form.
     */
    await expect(
      withSystem((tx) =>
        tx.insert(schema.paymentAccounts).values({
          tenantId: tenantA,
          entityId: entityB,
          stripeAccountId: `acct_${STAMP.replace(/-/g, "")}X`,
        }),
      ),
    ).rejects.toThrow();
  });

  it("one connected account per company", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.paymentAccounts).values({
          tenantId: tenantA,
          entityId: entityA1,
          stripeAccountId: `acct_${STAMP.replace(/-/g, "")}DUP`,
        }),
      ),
    ).rejects.toThrow();
  });

  it("A SECOND COMPANY GETS ITS OWN ACCOUNT — the whole point of the entity", async () => {
    const rows = await withSystem((tx) =>
      tx
        .insert(schema.paymentAccounts)
        .values({
          tenantId: tenantA,
          entityId: entityA2,
          stripeAccountId: `acct_${STAMP.replace(/-/g, "")}M`,
        })
        .returning(),
    );
    expect(rows).toHaveLength(1);
    // And the owner sees both, each against its own company.
    const seen = await asOwner((tx) =>
      tx.select().from(schema.paymentAccounts),
    );
    expect(new Set(seen.map((a) => a.entityId))).toEqual(
      new Set([entityA1, entityA2]),
    );
    await withSystem((tx) =>
      tx
        .delete(schema.paymentAccounts)
        .where(eq(schema.paymentAccounts.id, rows[0].id)),
    );
  });

  it("at most ONE unadopted account per tenant", async () => {
    /**
     * `entity_id` is nullable because `retail` requires `inventory` and not
     * `accounting` — a farm can sell at a market with no books. Postgres treats
     * NULLs as distinct, so without the partial unique index a books-less
     * tenant could mint connected accounts without limit, each one a real
     * Stripe object asking a real person for a tax ID.
     */
    const first = await withSystem((tx) =>
      tx
        .insert(schema.paymentAccounts)
        .values({
          tenantId: tenantA,
          stripeAccountId: `acct_${STAMP.replace(/-/g, "")}N1`,
        })
        .returning(),
    );
    expect(first).toHaveLength(1);

    await expect(
      withSystem((tx) =>
        tx.insert(schema.paymentAccounts).values({
          tenantId: tenantA,
          stripeAccountId: `acct_${STAMP.replace(/-/g, "")}N2`,
        }),
      ),
    ).rejects.toThrow();

    // Another tenant's unadopted account is a different row, not a conflict.
    const other = await withSystem((tx) =>
      tx
        .insert(schema.paymentAccounts)
        .values({
          tenantId: tenantB,
          stripeAccountId: `acct_${STAMP.replace(/-/g, "")}N3`,
        })
        .returning(),
    );
    expect(other).toHaveLength(1);

    await withSystem(async (tx) => {
      await tx
        .delete(schema.paymentAccounts)
        .where(
          and(
            eq(schema.paymentAccounts.tenantId, tenantA),
            isNull(schema.paymentAccounts.entityId),
          ),
        );
      await tx
        .delete(schema.paymentAccounts)
        .where(
          and(
            eq(schema.paymentAccounts.tenantId, tenantB),
            isNull(schema.paymentAccounts.entityId),
          ),
        );
    });
  });

  it("refuses anything that is not a connected account id", async () => {
    /**
     * The two Stripes crossing is the failure this whole area is written
     * against, so a `cus_…` (the platform's customer for the tenant's
     * SUBSCRIPTION) or an `sk_…` in this column fails at the database.
     */
    for (const bad of ["cus_ABC123", "sk_test_abc123", "acct", ""]) {
      await expect(
        withSystem((tx) =>
          tx.insert(schema.paymentAccounts).values({
            tenantId: tenantA,
            entityId: entityA2,
            stripeAccountId: bad,
          }),
        ),
      ).rejects.toThrow();
    }
  });

  it("cannot move a connected account into another tenant", async () => {
    // Under `withSystem`, where RLS is not watching, the composite FK is what
    // refuses: the row would name tenant B while pointing at tenant A's
    // company, and `(tenant_id, entity_id)` has no such target. Unrepresentable
    // rather than merely denied.
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.paymentAccounts)
          .set({ tenantId: tenantB })
          .where(eq(schema.paymentAccounts.id, accountA)),
      ),
    ).rejects.toThrow();
  });

  it("a company that is taking payments cannot be deleted out from under it", async () => {
    // RESTRICT, not CASCADE. Deleting the books of a company whose card
    // takings are still landing somewhere should fail loudly.
    await expect(
      withSystem((tx) =>
        tx.delete(schema.entities).where(eq(schema.entities.id, entityA1)),
      ),
    ).rejects.toThrow();
  });
});
