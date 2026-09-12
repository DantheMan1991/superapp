import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { openLaborAccrual } from "../src/lib/labor-posting";
import {
  laborAccrualFor,
  postPeriodLabor,
  reversePeriodLabor,
} from "../src/modules/time/posting-ops";
import { payPeriodCsv } from "../src/modules/time/export-ops";
import { setPostsLabor } from "../src/modules/time/settings-ops";

/**
 * Hours reaching the books — Time slice 6.
 *
 * Covered here rather than in `tests/isolation/time.test.ts` because this is
 * about what the OPS do, not what the database forbids, and because it needs a
 * chart of accounts and a company that the isolation suite has no business
 * building. That file's fixtures are raw inserts on purpose; these are the
 * product's own verbs, which is the only way to certify that a journal entry
 * comes out balanced.
 *
 * The three claims that matter:
 *  1. Only APPROVED hours become a liability.
 *  2. The entry BALANCES and its expense lines carry the dimension.
 *  3. Unlocking REVERSES, and the pair nets to nothing.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("labor accrual", () => {
  const STAMP = `labor-${process.pid}`;
  const OWNER = `${STAMP}-owner`;

  let tenantId = "";
  let workerA = "";
  let workerB = "";
  let memberId = "";
  let periodId = "";

  const period = { start: "2026-08-31", end: "2026-09-13" };

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });

  const ledgerCtx = () => ({ tenantId, userId: OWNER, role: "owner" as const });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: STAMP,
          name: "Labor Farm",
          slug: STAMP,
        })
        .returning();
      tenantId = tenant.id;

      const people = await tx
        .insert(schema.parties)
        .values([
          { tenantId, kind: "person" as const, displayName: "Approved Alice" },
          { tenantId, kind: "person" as const, displayName: "Pending Pete" },
        ])
        .returning({ id: schema.parties.id });

      const workers = await tx
        .insert(schema.timeWorkers)
        .values([
          { tenantId, partyId: people[0].id },
          { tenantId, partyId: people[1].id },
        ])
        .returning({ id: schema.timeWorkers.id });
      workerA = workers[0].id;
      workerB = workers[1].id;

      const [member] = await tx
        .insert(schema.dimensionMembers)
        .values({
          tenantId,
          dimensionType: "enterprise",
          packEntityId: crypto.randomUUID(),
          displayName: "Beef",
        })
        .returning({ id: schema.dimensionMembers.id });
      memberId = member.id;

      /*
       * Alice: ten hours, all tagged Beef, on a rate with 10% on-costs. Her
       * sheet is APPROVED and its gross frozen at $250.00.
       * Pete: ten hours too, and a sheet that was never approved. He is the
       * control — nothing of his may reach the ledger.
       */
      const entries = await tx
        .insert(schema.timeEntries)
        .values([
          {
            tenantId,
            workerId: workerA,
            minutes: 600,
            workDate: "2026-09-01",
            payType: "worked" as const,
            enteredByClerkUserId: OWNER,
          },
          {
            tenantId,
            workerId: workerB,
            minutes: 600,
            workDate: "2026-09-01",
            payType: "worked" as const,
            enteredByClerkUserId: OWNER,
          },
        ])
        .returning({ id: schema.timeEntries.id });

      await tx.insert(schema.timeEntryDimensions).values({
        tenantId,
        entryId: entries[0].id,
        dimensionType: "enterprise",
        memberId,
      });

      await tx.insert(schema.timeRates).values({
        tenantId,
        workerId: workerA,
        payRateCents: 2500,
        burdenPercent: 10,
        effectiveOn: "2026-01-01",
      });

      await tx.insert(schema.timeSheets).values([
        {
          tenantId,
          workerId: workerA,
          periodStartsOn: period.start,
          periodEndsOn: period.end,
          submittedByClerkUserId: OWNER,
          approvedAt: new Date(),
          approvedByClerkUserId: OWNER,
          workedMinutes: 600,
          regularMinutes: 600,
          overtimeMinutes: 0,
          doubleTimeMinutes: 0,
          paidLeaveMinutes: 0,
          rulesetSlug: "federal",
          grossCents: 25000,
        },
        {
          tenantId,
          workerId: workerB,
          periodStartsOn: period.start,
          periodEndsOn: period.end,
          submittedByClerkUserId: OWNER,
        },
      ]);

      const [row] = await tx
        .insert(schema.timePeriods)
        .values({
          tenantId,
          startsOn: period.start,
          endsOn: period.end,
          lockedAt: new Date(),
          lockedByClerkUserId: OWNER,
        })
        .returning({ id: schema.timePeriods.id });
      periodId = row.id;
    });

    // The chart and the default company, through the product's own provisioner
    // so the accounts are the ones a real tenant gets.
    await asOwner((tx) => provisionAccounting(tx, tenantId));
  });

  afterAll(async () => {
    if (!tenantId) return;
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("exports hours a payroll provider can read", async () => {
    const { csv, filename } = await asOwner((tx) =>
      payPeriodCsv(tx, tenantId, period, {
        weekStartsOn: 1,
        overtimeRuleset: "federal",
      }),
    );
    expect(filename).toBe("hours-2026-08-31-to-2026-09-13.csv");

    const lines = csv.trim().split(/\r\n/);
    expect(lines[0]).toBe(
      "Worker,Period start,Period end,Regular hours,Overtime hours,Double time hours,Paid leave hours,Gross pay,Approved",
    );

    // DECIMAL hours, because no payroll system parses a colon the same way.
    const alice = lines.find((l) => l.startsWith("Approved Alice"))!;
    expect(alice).toBe(
      "Approved Alice,2026-08-31,2026-09-13,10,0,0,0,250.00,yes",
    );

    /*
     * Pete is ON THE FILE even though nobody approved his sheet. He worked the
     * hours; a payroll file that silently dropped him is how somebody does not
     * get paid. The Approved column is what says his are not agreed — and his
     * gross is EMPTY, because he has no rate, rather than a misleading 0.00.
     */
    const pete = lines.find((l) => l.startsWith("Pending Pete"))!;
    expect(pete).toBe("Pending Pete,2026-08-31,2026-09-13,10,0,0,0,,no");
  });

  it("accrues only what was approved", async () => {
    const accrual = await asOwner((tx) =>
      laborAccrualFor(tx, tenantId, period),
    );
    // Alice's $250.00 and nothing of Pete's, even though he logged the same
    // ten hours.
    expect(accrual.wagesCents).toBe(25000);
    expect(accrual.unapprovedWorkers).toBe(1);
  });

  it("puts the employer's on-costs on their own figure, never in the wage", async () => {
    const accrual = await asOwner((tx) =>
      laborAccrualFor(tx, tenantId, period),
    );
    expect(accrual.burdenCents).toBe(2500); // 10% of 250.00
    expect(accrual.wagesCents).toBe(25000); // and the wage is untouched by it
  });

  it("tags the line with what the hours were for", async () => {
    const accrual = await asOwner((tx) =>
      laborAccrualFor(tx, tenantId, period),
    );
    expect(accrual.lines).toHaveLength(1);
    expect(accrual.lines[0].memberIds).toEqual([memberId]);
    expect(accrual.lines[0].memo).toBe("Beef");
  });

  it("posts a balanced entry against the payroll accounts", async () => {
    const posted = await asOwner((tx) =>
      postPeriodLabor(tx, ledgerCtx(), { period, periodId }),
    );
    expect(posted.entryId).not.toBeNull();

    const { lines, entry } = await asOwner(async (tx) => {
      const entry = await tx.query.journalEntries.findFirst({
        where: eq(schema.journalEntries.id, posted.entryId!),
      });
      const lines = await tx.query.journalLines.findMany({
        where: eq(schema.journalLines.entryId, posted.entryId!),
      });
      return { entry, lines };
    });

    expect(entry?.source).toBe("payroll_accrual");
    expect(entry?.sourceId).toBe(periodId);
    // The liability belongs to the period that earned it, not to the day
    // somebody pressed Lock.
    expect(entry?.entryDate).toBe(period.end);

    // THE ONE THAT MATTERS: an entry that does not sum to zero does not exist.
    expect(lines.reduce((s, l) => s + l.amountCents, 0)).toBe(0);
    // Wages, on-costs, and one credit for the lot.
    expect(lines).toHaveLength(3);
    expect(lines.filter((l) => l.amountCents > 0)).toHaveLength(2);
    expect(lines.find((l) => l.amountCents < 0)?.amountCents).toBe(-27500);
  });

  it("carries the dimension onto the posted lines", async () => {
    const tagged = await asOwner((tx) =>
      tx.query.lineDimensions.findMany({
        where: and(
          eq(schema.lineDimensions.tenantId, tenantId),
          eq(schema.lineDimensions.memberId, memberId),
        ),
      }),
    );
    // Both expense lines, so a P&L split by enterprise carries the wage AND
    // the on-costs.
    expect(tagged.length).toBe(2);
    expect(tagged.every((t) => t.journalLineId !== null)).toBe(true);
  });

  it("refuses a second accrual for a period that already has one", async () => {
    await expect(
      asOwner((tx) => postPeriodLabor(tx, ledgerCtx(), { period, periodId })),
    ).rejects.toThrow(/already in the books/i);
  });

  it("will not stop posting while wages are still in the books", async () => {
    await expect(
      asOwner((tx) => setPostsLabor(tx, tenantId, false)),
    ).rejects.toThrow(/unlock/i);
  });

  it("reverses on unlock, and the pair nets to nothing", async () => {
    const reversed = await asOwner((tx) =>
      reversePeriodLabor(tx, ledgerCtx(), { period, periodId }),
    );
    expect(reversed.entryId).not.toBeNull();

    const total = await asOwner(async (tx) => {
      const entries = await tx.query.journalEntries.findMany({
        where: and(
          eq(schema.journalEntries.tenantId, tenantId),
          eq(schema.journalEntries.status, "posted"),
        ),
        columns: { id: true },
      });
      const lines = await tx.query.journalLines.findMany({
        where: eq(schema.journalLines.tenantId, tenantId),
      });
      return lines
        .filter((l) => entries.some((e) => e.id === l.entryId))
        .reduce((s, l) => s + l.amountCents, 0);
    });
    expect(total).toBe(0);

    // And nothing is standing any more, so the period may post again.
    const open = await asOwner((tx) =>
      openLaborAccrual(tx, tenantId, periodId),
    );
    expect(open).toBeNull();
  });

  it("posts again after a re-lock instead of deduping onto the reversed one", async () => {
    const again = await asOwner((tx) =>
      postPeriodLabor(tx, ledgerCtx(), { period, periodId }),
    );
    expect(again.entryId).not.toBeNull();
    const { accruals, reversals } = await asOwner(async (tx) => {
      const accruals = await tx.query.journalEntries.findMany({
        where: and(
          eq(schema.journalEntries.tenantId, tenantId),
          eq(schema.journalEntries.source, "payroll_accrual"),
        ),
        columns: { id: true },
      });
      const reversals = await tx.query.journalEntries.findMany({
        where: and(
          eq(schema.journalEntries.tenantId, tenantId),
          eq(schema.journalEntries.source, "reversal"),
        ),
        columns: { reversesEntryId: true },
      });
      return { accruals, reversals };
    });
    /*
     * TWO accruals and ONE reversal, and the split matters more than the
     * total: a reversal is NOT a `payroll_accrual` row. It carries
     * `source = 'reversal'` and no `source_id`, so the only way back to what it
     * undid is `reverses_entry_id`. A reader who counts accruals to decide
     * whether a period is still accrued gets the wrong answer every time.
     */
    expect(accruals).toHaveLength(2);
    expect(reversals).toHaveLength(1);
    expect(accruals.map((a) => a.id)).toContain(reversals[0].reversesEntryId);
  });

  it("lets the switch go off once nothing is standing", async () => {
    // Reverse the second accrual too, so the ledger is clear. The guard asks
    // about STATE, not history: a business that tried this and changed its mind
    // must not be locked in by entries it has already taken back out.
    await asOwner((tx) =>
      reversePeriodLabor(tx, ledgerCtx(), { period, periodId }),
    );
    await asOwner((tx) => setPostsLabor(tx, tenantId, false));
    const prefsNow = await asOwner((tx) =>
      tx.query.timeSettings.findFirst({
        where: eq(schema.timeSettings.tenantId, tenantId),
      }),
    );
    expect(prefsNow?.postsLabor).toBe(false);
  });
});
