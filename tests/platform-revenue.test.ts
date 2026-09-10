import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { withSystem, withTenant, schema } from "../src/db";
import {
  postPlatformCharge,
  retrySkippedPostings,
  stripeMarker,
  type PlatformCharge,
} from "../src/lib/platform-revenue";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { obtainOperator, seedEntity, seedParty } from "./isolation/_shared";

/**
 * The platform's revenue reaches the operator's books (ADR 0043, slice 5):
 * a charge becomes a paid invoice through Accounting's own verbs, once, and a
 * charge that cannot post yet is skipped with a reason and posts on retry.
 *
 * RUNS ONLY AGAINST A MINTED OPERATOR. These tests write real invoices into
 * the operator's books; on a database where the founder has named one, that
 * would be Yosher's own ledger, so the suite mints its operator or stands
 * down loudly. CI builds from zero and always runs it.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `revenue-test-${process.pid}`;

let operator = "";
let operatorMinted = false;
let client = "";
let clientParty = "";
let orphan = "";

function charge(id: string, tenantId: string | null, cents = 100000): PlatformCharge {
  return {
    kind: "subscription_invoice",
    stripeObjectId: `in_${STAMP}_${id}`,
    clientTenantId: tenantId,
    amountCents: cents,
    currency: "usd",
    paidAt: new Date(),
    description: `Yosher Operations · Stripe invoice ${id}`,
  };
}

d("platform revenue in the operator's books", () => {
  beforeAll(async () => {
    await withSystem(async (tx) => {
      const op = await obtainOperator(tx, STAMP);
      operator = op.id;
      operatorMinted = op.minted;
      if (!op.minted) {
        console.warn(
          "⚠ platform-revenue: the database already names an operator; refusing to post test invoices into real books. Tests stand down.",
        );
        return;
      }
      await seedEntity(tx, operator, STAMP);
      await tx
        .insert(schema.tenantModules)
        .values([
          { tenantId: operator, moduleId: "accounting", enabled: true },
          { tenantId: operator, moduleId: "crm", enabled: true },
        ])
        .onConflictDoNothing();
      const [c] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: `${STAMP}-client`, name: `${STAMP} Client`, slug: `${STAMP}-client` })
        .returning({ id: schema.tenants.id });
      client = c.id;
      clientParty = await seedParty(tx, operator, `${STAMP} Client`);
      await tx
        .update(schema.tenants)
        .set({ operatorPartyId: clientParty })
        .where(eq(schema.tenants.id, client));
      const [o] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: `${STAMP}-orphan`, name: `${STAMP} Orphan`, slug: `${STAMP}-orphan` })
        .returning({ id: schema.tenants.id });
      orphan = o.id;
    });
    if (operatorMinted) {
      await withTenant(operator, (tx) => provisionAccounting(tx, operator));
    }
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      // The postings this file made, by their stamped Stripe ids; then the
      // client rows; then the minted operator, whose books, customers and
      // parties cascade with it.
      await tx
        .delete(schema.operatorPostings)
        .where(like(schema.operatorPostings.stripeObjectId, `in_${STAMP}%`));
      for (const id of [client, orphan]) {
        if (id) await tx.delete(schema.tenants).where(eq(schema.tenants.id, id));
      }
      if (operatorMinted) {
        await tx.delete(schema.tenants).where(eq(schema.tenants.id, operator));
      }
    });
  });

  it("posts a charge as a paid invoice in the operator's books, for the client's customer role", async () => {
    if (!operatorMinted) return;
    const outcome = await postPlatformCharge(charge("first", client));
    expect(outcome.status).toBe("posted");
    if (outcome.status !== "posted") return;
    expect(outcome.already).toBe(false);

    const invoice = await withTenant(
      operator,
      (tx) =>
        tx.query.invoices.findFirst({
          where: and(eq(schema.invoices.tenantId, operator), eq(schema.invoices.id, outcome.invoiceId)),
        }),
      { role: "owner" },
    );
    expect(invoice?.status).toBe("paid");
    expect(invoice?.totalCents).toBe(100000);
    expect(invoice?.memo).toBe(stripeMarker(`in_${STAMP}_first`));

    const customer = await withTenant(
      operator,
      (tx) =>
        tx.query.customers.findFirst({
          where: and(eq(schema.customers.tenantId, operator), eq(schema.customers.partyId, clientParty)),
        }),
      { role: "owner" },
    );
    expect(customer?.id).toBe(invoice?.customerId);

    const payments = await withTenant(
      operator,
      (tx) =>
        tx
          .select({ method: schema.invoicePayments.method, cents: schema.invoicePayments.amountCents })
          .from(schema.invoicePayments)
          .where(eq(schema.invoicePayments.invoiceId, outcome.invoiceId)),
      { role: "owner" },
    );
    expect(payments).toEqual([{ method: "stripe", cents: 100000 }]);

    const [row] = await withSystem((tx) =>
      tx
        .select({ status: schema.operatorPostings.status, invoiceId: schema.operatorPostings.invoiceId })
        .from(schema.operatorPostings)
        .where(eq(schema.operatorPostings.stripeObjectId, `in_${STAMP}_first`)),
    );
    expect(row).toEqual({ status: "posted", invoiceId: outcome.invoiceId });
  });

  it("the same Stripe object again posts nothing twice", async () => {
    if (!operatorMinted) return;
    const again = await postPlatformCharge(charge("first", client));
    expect(again.status).toBe("posted");
    if (again.status === "posted") expect(again.already).toBe(true);
    const invoices = await withTenant(
      operator,
      (tx) =>
        tx
          .select({ id: schema.invoices.id })
          .from(schema.invoices)
          .where(eq(schema.invoices.memo, stripeMarker(`in_${STAMP}_first`))),
      { role: "owner" },
    );
    expect(invoices).toHaveLength(1);
  });

  it("a client with no party is skipped with the reason, and posts on retry once it has one", async () => {
    if (!operatorMinted) return;
    const first = await postPlatformCharge(charge("orphan", orphan));
    expect(first).toEqual({ status: "skipped", reason: "no_party" });

    const party = await withSystem(async (tx) => {
      const id = await seedParty(tx, operator, `${STAMP} Orphan`);
      await tx.update(schema.tenants).set({ operatorPartyId: id }).where(eq(schema.tenants.id, orphan));
      return id;
    });
    expect(party).toBeTruthy();

    const counts = await retrySkippedPostings();
    expect(counts.posted).toBeGreaterThanOrEqual(1);
    const [row] = await withSystem((tx) =>
      tx
        .select({ status: schema.operatorPostings.status })
        .from(schema.operatorPostings)
        .where(eq(schema.operatorPostings.stripeObjectId, `in_${STAMP}_orphan`)),
    );
    expect(row.status).toBe("posted");
  });

  it("nothing paid, a foreign currency, and a day before the books begin are skipped", async () => {
    if (!operatorMinted) return;
    expect(await postPlatformCharge(charge("zero", client, 0))).toEqual({
      status: "skipped",
      reason: "zero_amount",
    });
    expect(await postPlatformCharge({ ...charge("euro", client), currency: "eur" })).toEqual({
      status: "skipped",
      reason: "currency",
    });

    const tomorrow = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await withSystem((tx) =>
      tx
        .update(schema.entities)
        .set({ booksStartOn: tomorrow })
        .where(and(eq(schema.entities.tenantId, operator), eq(schema.entities.isDefault, true))),
    );
    expect(await postPlatformCharge(charge("early", client))).toEqual({
      status: "skipped",
      reason: "before_books_start",
    });
    await withSystem((tx) =>
      tx
        .update(schema.entities)
        .set({ booksStartOn: null })
        .where(and(eq(schema.entities.tenantId, operator), eq(schema.entities.isDefault, true))),
    );
  });
});
