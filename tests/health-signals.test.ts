import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { withSystem, withTenant, schema } from "../src/db";
import { featureForPrefix, loadHealthSignals } from "../src/app/admin/health";
import {
  createInvoiceDraft,
  issueInvoice,
} from "../src/modules/accounting/invoicing/invoices";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { obtainOperator, seedEntity, seedParty } from "./isolation/_shared";
import { todayInRetainerTz } from "../src/lib/retainer-core";

/**
 * Health signals (back-office slice 6): derived from what the platform
 * already holds — last seen, thirty days of audit rows, the retainer's month,
 * the operator's open invoices — and turned into concerns.
 *
 * The "owes" half writes an invoice into the operator's books, so it runs
 * only against a MINTED operator (tests/platform-revenue.test.ts says why).
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `health-test-${process.pid}`;

let operator = "";
let operatorMinted = false;
let busy = "";
let silent = "";
let busyParty = "";
let profile = "";
const now = new Date();
// The bookkeeping day in the retainer's zone, so the entry and the allotment
// land in the month the math is looking at, even late on the last evening.
const month = todayInRetainerTz(now);

d("health signals", () => {
  beforeAll(async () => {
    await withSystem(async (tx) => {
      const op = await obtainOperator(tx, STAMP);
      operator = op.id;
      operatorMinted = op.minted;
      if (op.minted) {
        await seedEntity(tx, operator, STAMP);
        await tx
          .insert(schema.tenantModules)
          .values({ tenantId: operator, moduleId: "accounting", enabled: true })
          .onConflictDoNothing();
      }

      const [b] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: `${STAMP}-busy`, name: `${STAMP} Busy`, slug: `${STAMP}-busy` })
        .returning({ id: schema.tenants.id });
      busy = b.id;
      const [s] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: `${STAMP}-silent`, name: `${STAMP} Silent`, slug: `${STAMP}-silent` })
        .returning({ id: schema.tenants.id });
      silent = s.id;

      // A member of the busy workspace, seen three hours ago.
      const [p] = await tx
        .insert(schema.profiles)
        .values({ clerkUserId: `${STAMP}-user`, email: `${STAMP}@example.test` })
        .returning({ id: schema.profiles.id });
      profile = p.id;
      await tx.insert(schema.memberships).values({
        tenantId: busy,
        profileId: profile,
        role: "owner",
        lastSeenAt: new Date(now.getTime() - 3 * 60 * 60_000),
      });

      // Three actions this month: two features the map knows, one it does not.
      await tx.insert(schema.auditLog).values([
        { action: "crm.record.created", tenantId: busy, actorLabel: STAMP },
        { action: "ledger.entry.posted", tenantId: busy, actorLabel: STAMP },
        { action: "weird.thing", tenantId: busy, actorLabel: STAMP },
      ]);

      // A retainer of one hour — the month's allotment is what the math reads,
      // the retainers column is display — and two hours of work: over by one.
      await tx.insert(schema.retainers).values({ tenantId: busy, includedMinutesMonthly: 60 });
      await tx
        .insert(schema.retainerAllotments)
        .values({ tenantId: busy, effectiveMonth: month.slice(0, 7), includedMinutes: 60 });
      await tx.insert(schema.retainerTimeEntries).values({
        tenantId: busy,
        minutes: 120,
        workDate: month,
        note: "health test",
        actorClerkUserId: `${STAMP}-admin`,
      });

      if (op.minted) {
        busyParty = await seedParty(tx, operator, `${STAMP} Busy`);
        await tx.update(schema.tenants).set({ operatorPartyId: busyParty }).where(eq(schema.tenants.id, busy));
      }
    });

    if (operatorMinted) {
      // An issued, unpaid invoice of $250 for the busy client, in the operator's books.
      await withTenant(operator, (tx) => provisionAccounting(tx, operator));
      await withTenant(
        operator,
        async (tx) => {
          const ctx = { tenantId: operator, userId: `${STAMP}-owner`, role: "owner" as const };
          const [customer] = await tx
            .insert(schema.customers)
            .values({ tenantId: operator, partyId: busyParty, name: `${STAMP} Busy` })
            .returning();
          const income = await tx.query.accounts.findFirst({
            where: eq(schema.accounts.code, "4010"),
            columns: { id: true },
          });
          const draft = await createInvoiceDraft(tx, ctx, {
            customerId: customer.id,
            issueDate: month,
            lines: [
              { description: "Setup", quantity: "1", unitPriceCents: 25000, incomeAccountId: income!.id },
            ],
          });
          await issueInvoice(tx, ctx, { invoiceId: draft.id, expectedVersion: draft.version });
        },
        { role: "owner", userId: `${STAMP}-owner` },
      );
    }
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      // audit_log is append-only; the rows stay with a test actor label.
      for (const id of [busy, silent]) {
        if (id) await tx.delete(schema.tenants).where(eq(schema.tenants.id, id));
      }
      if (profile) await tx.delete(schema.profiles).where(eq(schema.profiles.id, profile));
      if (operatorMinted) {
        await tx.delete(schema.tenants).where(eq(schema.tenants.id, operator));
      }
      await tx.delete(schema.profiles).where(like(schema.profiles.clerkUserId, `${STAMP}%`));
    });
  });

  it("attributes only the prefixes it knows", () => {
    expect(featureForPrefix("ledger")).toBe("accounting");
    expect(featureForPrefix("crm")).toBe("crm");
    expect(featureForPrefix("weird")).toBeNull();
    expect(featureForPrefix("tenant")).toBeNull();
  });

  it("reads last seen, thirty days of activity and the retainer for a busy client, and finds the concern", async () => {
    const signals = await loadHealthSignals(
      [{ id: busy, operatorPartyId: busyParty || null, subscriptionStatus: "active" }],
      now,
    );
    const h = signals.get(busy)!;
    expect(h.lastSeenAt).not.toBeNull();
    expect(h.activity.count).toBe(3);
    expect(h.activity.features).toEqual(["accounting", "crm"]);
    expect(h.retainer?.isOver).toBe(true);
    expect(h.retainer?.unpaidOverageMinutes).toBe(60);
    expect(h.concerns).toContain("over_retainer");
    expect(h.concerns).not.toContain("quiet");
    expect(h.concerns).not.toContain("never_signed_in");
    if (operatorMinted) {
      expect(h.owesCents).toBe(25000);
      expect(h.concerns).toContain("owes");
    }
  });

  it("a silent client has never signed in, and a past-due subscription is a concern first", async () => {
    const signals = await loadHealthSignals(
      [{ id: silent, operatorPartyId: null, subscriptionStatus: "past_due" }],
      now,
    );
    const h = signals.get(silent)!;
    expect(h.lastSeenAt).toBeNull();
    expect(h.activity.count).toBe(0);
    expect(h.owesCents).toBeNull();
    expect(h.concerns).toEqual(["past_due", "never_signed_in"]);
    expect(h.concernScore).toBe(9);
  });
});
