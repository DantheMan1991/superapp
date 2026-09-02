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
  let readerA: string;
  let readerB: string;

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

      const readers = await tx
        .insert(schema.paymentReaders)
        .values([
          {
            tenantId: tenantA,
            paymentAccountId: accountA,
            stripeReaderId: `tmr_${STAMP.replace(/-/g, "")}A`,
            stripeLocationId: `tml_${STAMP.replace(/-/g, "")}A`,
            label: "Front table",
            deviceType: "simulated_wisepos_e",
            status: "online",
          },
          {
            tenantId: tenantB,
            paymentAccountId: accountB,
            stripeReaderId: `tmr_${STAMP.replace(/-/g, "")}B`,
            stripeLocationId: `tml_${STAMP.replace(/-/g, "")}B`,
            label: "B reader",
          },
        ])
        .returning();
      readerA = readers[0].id;
      readerB = readers[1].id;
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

  // ---- readers -----------------------------------------------------------

  it("a tenant sees only its own readers, and STAFF can see them", async () => {
    // The till is worked by whoever is standing at the stall. A reader only the
    // owner could see is a reader nobody can take money on.
    expect(
      (await asStaff((tx) => tx.select().from(schema.paymentReaders))).map(
        (r) => r.label,
      ),
    ).toEqual(["Front table"]);
    expect(
      (await asOtherTenant((tx) => tx.select().from(schema.paymentReaders))).map(
        (r) => r.label,
      ),
    ).toEqual(["B reader"]);
  });

  it("cannot read another tenant's reader", async () => {
    expect(
      await asOwner((tx) =>
        tx
          .select()
          .from(schema.paymentReaders)
          .where(eq(schema.paymentReaders.id, readerB)),
      ),
    ).toHaveLength(0);
  });

  it("AN OWNER CANNOT WRITE A READER ROW EITHER — it mirrors Stripe", async () => {
    /**
     * Same posture as `payment_accounts`, and for a related reason: a row here
     * that Stripe has never heard of is a device the till would offer, at a
     * stall, and pushing a payment to it fails with a customer holding a card.
     * Silent again — only the INSERT raises.
     */
    expect(
      await asOwner((tx) =>
        tx
          .update(schema.paymentReaders)
          .set({ status: "online", label: "Stolen" })
          .where(eq(schema.paymentReaders.id, readerA))
          .returning(),
      ),
    ).toHaveLength(0);

    await expect(
      asOwner((tx) =>
        tx.insert(schema.paymentReaders).values({
          tenantId: tenantA,
          paymentAccountId: accountA,
          stripeReaderId: `tmr_${STAMP.replace(/-/g, "")}SELF`,
          stripeLocationId: `tml_${STAMP.replace(/-/g, "")}SELF`,
          label: "Invented",
        }),
      ),
    ).rejects.toThrow();
  });

  it("A READER CANNOT POINT AT ANOTHER TENANT'S ACCOUNT, even under withSystem", async () => {
    /**
     * The composite FK, and the reason it is composite. The connected account
     * decides whose bank a device's takings land in — a reader pointed at
     * somebody else's account would pay one farm's market into another's.
     */
    await expect(
      withSystem((tx) =>
        tx.insert(schema.paymentReaders).values({
          tenantId: tenantA,
          paymentAccountId: accountB,
          stripeReaderId: `tmr_${STAMP.replace(/-/g, "")}X`,
          stripeLocationId: `tml_${STAMP.replace(/-/g, "")}X`,
          label: "Wrong bank",
        }),
      ),
    ).rejects.toThrow();
  });

  it("one row per physical device", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.paymentReaders).values({
          tenantId: tenantA,
          paymentAccountId: accountA,
          stripeReaderId: `tmr_${STAMP.replace(/-/g, "")}A`,
          stripeLocationId: `tml_${STAMP.replace(/-/g, "")}A`,
          label: "Duplicate",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses anything that is not a reader or location id", async () => {
    // `tmr_` and `tml_` are different things and swapping them would register a
    // payment against an address instead of a device.
    for (const [reader, location] of [
      ["tml_abc123", "tml_abc123"],
      ["tmr_abc123", "tmr_abc123"],
      ["acct_abc123", "tml_abc123"],
      ["", "tml_abc123"],
    ]) {
      await expect(
        withSystem((tx) =>
          tx.insert(schema.paymentReaders).values({
            tenantId: tenantA,
            paymentAccountId: accountA,
            stripeReaderId: reader,
            stripeLocationId: location,
            label: "Bad ids",
          }),
        ),
      ).rejects.toThrow();
    }
  });

  it("closing a connected account takes its readers with it", async () => {
    // CASCADE here, unlike the entity FK: a reader is meaningless without the
    // account it pays into, and there is no separate history to preserve.
    const account = await withSystem((tx) =>
      tx
        .insert(schema.paymentAccounts)
        .values({
          tenantId: tenantB,
          stripeAccountId: `acct_${STAMP.replace(/-/g, "")}C`,
        })
        .returning(),
    );
    await withSystem((tx) =>
      tx.insert(schema.paymentReaders).values({
        tenantId: tenantB,
        paymentAccountId: account[0].id,
        stripeReaderId: `tmr_${STAMP.replace(/-/g, "")}C`,
        stripeLocationId: `tml_${STAMP.replace(/-/g, "")}C`,
        label: "Doomed",
      }),
    );
    await withSystem((tx) =>
      tx
        .delete(schema.paymentAccounts)
        .where(eq(schema.paymentAccounts.id, account[0].id)),
    );
    expect(
      await withSystem((tx) =>
        tx
          .select()
          .from(schema.paymentReaders)
          .where(eq(schema.paymentReaders.stripeReaderId, `tmr_${STAMP.replace(/-/g, "")}C`)),
      ),
    ).toHaveLength(0);
  });

  // ---- Square: a second provider on the same table, and the one table with
  // ---- NO member policy at all (ADR 0017) ---------------------------------

  const MERCHANT_A = `ML${STAMP.replace(/-/g, "").toUpperCase()}A`;
  let squareAccountA: string;

  it("a Square account hangs off a company like a Stripe one, and members can READ it", async () => {
    // Tenant A's SECOND company takes Square — the first already has Stripe.
    // One row per company PER PROVIDER, so a company may hold one of each.
    const [row] = await withSystem((tx) =>
      tx
        .insert(schema.paymentAccounts)
        .values({
          tenantId: tenantA,
          entityId: entityA2,
          provider: "square",
          squareMerchantId: MERCHANT_A,
          cardPaymentsStatus: "active",
        })
        .returning(),
    );
    squareAccountA = row.id;
    expect(row.stripeAccountId).toBeNull();

    // The till reads "can this company take a card" as staff, whichever
    // provider answers it — so the account row is member-readable.
    const seen = await asStaff((tx) =>
      tx
        .select()
        .from(schema.paymentAccounts)
        .where(eq(schema.paymentAccounts.provider, "square")),
    );
    expect(seen.map((r) => r.id)).toEqual([squareAccountA]);
    expect(
      await asOtherTenant((tx) =>
        tx
          .select()
          .from(schema.paymentAccounts)
          .where(eq(schema.paymentAccounts.provider, "square")),
      ),
    ).toHaveLength(0);
  });

  it("payment_credentials has NO member policy: a tenant cannot read even its own token row", async () => {
    await withSystem((tx) =>
      tx.insert(schema.paymentCredentials).values({
        tenantId: tenantA,
        paymentAccountId: squareAccountA,
        accessTokenEnc: "iv.tag.ciphertext",
        refreshTokenEnc: "iv.tag.ciphertext",
        scopes: ["PAYMENTS_WRITE"],
      }),
    );
    // Superadmin / system sees it; that is the only way it is ever read.
    expect(
      await withSystem((tx) => tx.select().from(schema.paymentCredentials)),
    ).toHaveLength(1);
    // The OWNER of the tenant that holds the token sees nothing. Not a
    // filtered view — nothing. The lib decrypts under withSystem in one place.
    expect(await asOwner((tx) => tx.select().from(schema.paymentCredentials))).toHaveLength(0);
    expect(await asStaff((tx) => tx.select().from(schema.paymentCredentials))).toHaveLength(0);
    expect(
      await asOtherTenant((tx) => tx.select().from(schema.paymentCredentials)),
    ).toHaveLength(0);
  });

  it("members cannot write payment_credentials — the insert is loud, the update and delete are silent", async () => {
    await expect(
      asOwner((tx) =>
        tx.insert(schema.paymentCredentials).values({
          tenantId: tenantA,
          paymentAccountId: squareAccountA,
          accessTokenEnc: "forged",
        }),
      ),
    ).rejects.toThrow();

    // No member UPDATE/DELETE policy means no USING clause to satisfy: zero rows
    // rather than an error. The guarantee holds either way (see drizzle/0207).
    const updated = await asOwner((tx) =>
      tx
        .update(schema.paymentCredentials)
        .set({ accessTokenEnc: "swapped" })
        .where(eq(schema.paymentCredentials.paymentAccountId, squareAccountA))
        .returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await asOwner((tx) =>
      tx
        .delete(schema.paymentCredentials)
        .where(eq(schema.paymentCredentials.paymentAccountId, squareAccountA))
        .returning(),
    );
    expect(deleted).toHaveLength(0);

    const still = await withSystem((tx) =>
      tx.query.paymentCredentials.findFirst({
        where: eq(schema.paymentCredentials.paymentAccountId, squareAccountA),
      }),
    );
    expect(still?.accessTokenEnc).toBe("iv.tag.ciphertext");
  });

  it("a token cannot be filed against another tenant's account, even under withSystem", async () => {
    // Composite FK: (tenant_id, payment_account_id) → payment_accounts. Tenant A
    // naming tenant B's account is unrepresentable, not merely refused.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.paymentCredentials).values({
          tenantId: tenantA,
          paymentAccountId: accountB,
          accessTokenEnc: "x",
        }),
      ),
    ).rejects.toThrow();
  });

  it("a row cannot lie about its provider", async () => {
    const bad = [
      // Square row carrying a Stripe id and no merchant id.
      { provider: "square", stripeAccountId: "acct_wrong", squareMerchantId: null },
      // Stripe row with no Stripe id.
      { provider: "stripe", stripeAccountId: null, squareMerchantId: null },
      // Both ids at once.
      { provider: "square", stripeAccountId: "acct_both", squareMerchantId: "MLBOTH" },
      // A provider nobody has written.
      { provider: "paypal", stripeAccountId: null, squareMerchantId: "MLPP" },
    ];
    for (const values of bad) {
      await expect(
        withSystem((tx) =>
          tx.insert(schema.paymentAccounts).values({
            tenantId: tenantB,
            ...values,
          }),
        ),
      ).rejects.toThrow();
    }
  });

  it("one account per company per provider, and the same Square merchant on one company only", async () => {
    // A second Square row for the company that already has one.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.paymentAccounts).values({
          tenantId: tenantA,
          entityId: entityA2,
          provider: "square",
          squareMerchantId: `${MERCHANT_A}2`,
        }),
      ),
    ).rejects.toThrow();
    // The same merchant on the OTHER company of the same tenant: one bank
    // account's takings would land in two sets of books.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.paymentAccounts).values({
          tenantId: tenantA,
          entityId: entityA1,
          provider: "square",
          squareMerchantId: MERCHANT_A,
        }),
      ),
    ).rejects.toThrow();
    // But a Stripe row beside the Square one on the same company is fine.
    const [stripeToo] = await withSystem((tx) =>
      tx
        .insert(schema.paymentAccounts)
        .values({
          tenantId: tenantA,
          entityId: entityA2,
          provider: "stripe",
          stripeAccountId: `acct_${STAMP.replace(/-/g, "")}A2`,
        })
        .returning(),
    );
    expect(stripeToo.provider).toBe("stripe");
  });

  it("closing the account takes its credential with it", async () => {
    // CASCADE: a token for an account that no longer exists is meaningless, and
    // deleting the account is the one time deleting a token is right.
    const [account] = await withSystem((tx) =>
      tx
        .insert(schema.paymentAccounts)
        .values({
          tenantId: tenantB,
          provider: "square",
          squareMerchantId: `${MERCHANT_A}B`,
        })
        .returning(),
    );
    await withSystem((tx) =>
      tx.insert(schema.paymentCredentials).values({
        tenantId: tenantB,
        paymentAccountId: account.id,
        accessTokenEnc: "doomed",
      }),
    );
    await withSystem((tx) =>
      tx.delete(schema.paymentAccounts).where(eq(schema.paymentAccounts.id, account.id)),
    );
    expect(
      await withSystem((tx) =>
        tx
          .select()
          .from(schema.paymentCredentials)
          .where(eq(schema.paymentCredentials.paymentAccountId, account.id)),
      ),
    ).toHaveLength(0);
  });
});
