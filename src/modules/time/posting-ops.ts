import "server-only";
import type { Tx } from "@/db";
import {
  postLaborAccrual,
  reverseLaborAccrual,
  type LaborAccrualLine,
  type LedgerCtx,
} from "@/lib/labor-posting";
import { splitByDimension } from "./core/allocate";
import type { AllocatableEntry } from "./core/allocate";
import { costWithBurden } from "./core/pay";
import { countsAsPaid } from "./core/pay-types";
import type { PayPeriod } from "./core/periods";
import { periodLabel } from "./core/periods";
import { listEntries, listEntryDimensions } from "./read";
import { listRates } from "./rate-ops";
import { listSheets } from "./sheet-ops";

/**
 * Turning a locked pay period into the lines of a journal entry.
 *
 * The one interesting decision here is WHICH FIGURE IS POSTED, and it is the
 * approved one. `time_sheets.gross_cents` was frozen the moment somebody
 * pressed Approve, and that is what reaches the books — not a figure worked out
 * again at lock time, which could differ if a rate had been added in between.
 * An accrual that disagrees with the timesheet it came from is worse than no
 * accrual at all, because nobody would find it.
 *
 * Nothing here posts. It hands `src/lib/labor-posting.ts` a list and that file
 * decides accounts, entity and idempotency — the same division production keeps
 * between `billing-ops.ts` and the posting engine.
 */

/** What a period comes to, and what it will say in the journal. */
export interface LaborAccrual {
  lines: LaborAccrualLine[];
  wagesCents: number;
  burdenCents: number;
  /** Workers with hours whose sheet was never approved, so nothing posted. */
  unapprovedWorkers: number;
  memo: string;
}

/**
 * Every approved sheet's money, split across what the hours were for.
 *
 * **ONLY APPROVED SHEETS.** Hours that nobody has agreed to are not a
 * liability: approval is the act that turns "what somebody typed" into "what
 * this business owes", and it is the only event in this module that means
 * that. An unapproved sheet in a locked period is counted and reported so the
 * owner can see what was left out, never quietly included.
 *
 * Burden rides along on each line as its own figure. It is computed per worker
 * from the rate in force on the LAST DAY of the period — a percentage of gross
 * rather than of each hour, which is not a simplification but the shape the
 * costs actually take: employer payroll tax is a percentage of what was paid.
 * A rate whose burden changed mid-period uses the later one, because it is the
 * current policy and burden is an estimate either way.
 */
export async function laborAccrualFor(
  tx: Tx,
  tenantId: string,
  period: PayPeriod,
): Promise<LaborAccrual> {
  const sheets = await listSheets(tx, tenantId, period);
  const approved = sheets.filter((s) => s.approvedAt !== null);
  const payable = approved.filter(
    (s) => s.grossCents !== null && s.grossCents > 0,
  );

  const memo = `Payroll accrual — ${periodLabel(period)}`;
  const empty: LaborAccrual = {
    lines: [],
    wagesCents: 0,
    burdenCents: 0,
    unapprovedWorkers: sheets.length - approved.length,
    memo,
  };
  if (payable.length === 0) return empty;

  const entries = await listEntries(tx, tenantId, {
    from: period.start,
    to: period.end,
  });
  // Unpaid hours carry no cost, so they must not attract a share of it — an
  // unpaid lunch booked to an enterprise would otherwise take money off the
  // enterprise that actually worked.
  const paid = entries.filter((e) => countsAsPaid(e.payType));
  const dimensions = await listEntryDimensions(
    tx,
    tenantId,
    paid.map((e) => e.id),
  );

  const memberIdsByEntry = new Map<string, string[]>();
  const nameByMember = new Map<string, string>();
  for (const d of dimensions) {
    const found = memberIdsByEntry.get(d.entryId);
    if (found) found.push(d.memberId);
    else memberIdsByEntry.set(d.entryId, [d.memberId]);
    nameByMember.set(d.memberId, d.name);
  }

  /*
   * Rates come back EMPTY for a reader who is not an owner, and that is fine
   * here only because the one caller is `lockPeriod`, which is owner-only.
   * Anything else calling this would silently accrue no burden, which is why
   * this function is not exported through a screen.
   */
  const rates = await listRates(tx, tenantId);
  const burdenOf = (workerId: string): number => {
    const inForce = rates
      .filter((r) => r.workerId === workerId && r.effectiveOn <= period.end)
      .sort((a, b) => (a.effectiveOn < b.effectiveOn ? 1 : -1))[0];
    return inForce?.burdenPercent ?? 0;
  };

  // Keyed by the dimension SET, so one enterprise is one line however many
  // people worked on it. Who earned what is a question for Time, not for a
  // journal entry with forty lines on it.
  const byKey = new Map<string, LaborAccrualLine>();

  for (const sheet of payable) {
    const gross = sheet.grossCents!;
    const burdenTotal = costWithBurden(gross, burdenOf(sheet.workerId)) - gross;

    const theirs: AllocatableEntry[] = paid
      .filter((e) => e.workerId === sheet.workerId)
      .map((e) => ({
        minutes: e.minutes,
        memberIds: memberIdsByEntry.get(e.id) ?? [],
      }));

    const wageSplits = splitByDimension(theirs, gross);
    const burdenSplits =
      burdenTotal > 0 ? splitByDimension(theirs, burdenTotal) : [];

    const burdenByKey = new Map(
      burdenSplits.map((s) => [s.memberIds.join("|"), s.cents]),
    );

    for (const split of wageSplits) {
      const key = split.memberIds.join("|");
      const found = byKey.get(key);
      const burden = burdenByKey.get(key) ?? 0;
      if (found) {
        found.wagesCents += split.cents;
        found.burdenCents += burden;
      } else {
        byKey.set(key, {
          memberIds: split.memberIds,
          wagesCents: split.cents,
          burdenCents: burden,
          memo:
            split.memberIds
              .map((id) => nameByMember.get(id) ?? "Unknown")
              .join(" · ") || "Unattributed",
        });
      }
    }
  }

  const lines = [...byKey.values()];
  return {
    lines,
    wagesCents: lines.reduce((s, l) => s + l.wagesCents, 0),
    burdenCents: lines.reduce((s, l) => s + l.burdenCents, 0),
    unapprovedWorkers: sheets.length - approved.length,
    memo,
  };
}

/**
 * Put a locked period's labor in the books.
 *
 * Called by `setPeriodLockAction` immediately after the lock, and only when the
 * business has asked for it (`time_settings.posts_labor`). Returns what
 * happened so the screen can say it — an owner who locks a period and sees
 * nothing has no way to tell "posted" from "there was nothing to post".
 */
export async function postPeriodLabor(
  tx: Tx,
  ctx: LedgerCtx,
  input: { period: PayPeriod; periodId: string },
): Promise<{ entryId: string | null; accrual: LaborAccrual }> {
  const accrual = await laborAccrualFor(tx, ctx.tenantId, input.period);
  const posted = await postLaborAccrual(tx, ctx, {
    periodId: input.periodId,
    // The last day of the period: the day the liability is incurred, not the
    // day somebody got round to locking it.
    entryDate: input.period.end,
    memo: accrual.memo,
    lines: accrual.lines,
  });
  return { entryId: posted?.entryId ?? null, accrual };
}

/**
 * Take a period's labor back out, because it has been unlocked.
 *
 * An offsetting entry dated the same day as the original, so a reversal does
 * not move an expense into a month it never belonged to — the default would be
 * today, and unlocking September's payroll in October should not put a credit
 * in October.
 */
export async function reversePeriodLabor(
  tx: Tx,
  ctx: LedgerCtx,
  input: { period: PayPeriod; periodId: string },
): Promise<{ entryId: string | null }> {
  const reversed = await reverseLaborAccrual(tx, ctx, {
    periodId: input.periodId,
    entryDate: input.period.end,
    memo: `Reversal — payroll accrual ${periodLabel(input.period)}`,
  });
  return { entryId: reversed?.entryId ?? null };
}
