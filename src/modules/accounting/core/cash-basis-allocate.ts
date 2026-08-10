/**
 * Cash-basis recognition: splitting a document's income or expense across the
 * payments that settled it. Pure — no "server-only", no database.
 *
 * THE ONE PLACE IN REPORT MATH THAT DIVIDES. Policy P5 pins report math to
 * integer cents with no division, and `report-builders.ts` says so at the top.
 * Pro-rata allocation cannot honour that: a $400 payment against a $1,000
 * invoice recognises two fifths of every line. So the division is quarantined
 * here, with an exact remainder rule, and tested to the cent — rather than
 * smeared through the builders where P5 would quietly stop being true.
 *
 * Two invariants, both load-bearing:
 *
 *   1. Each payment's allocation sums EXACTLY to the amount allocated for that
 *      payment. Otherwise a cash-basis trial balance stops balancing, which is
 *      the loudest possible symptom of a rounding bug.
 *   2. Across all payments, each line is allocated at most its full amount, and
 *      exactly its full amount once the document is fully paid. No cent is
 *      invented or lost by the order payments arrive in.
 *
 * Intermediate products use BigInt: `lineAmount * paymentAmount` is a product
 * of two cent values and would lose precision as a double well before either
 * factor reached an implausible size.
 */

/** One income or expense line of a document's accrual entry. */
export interface RecognitionLine {
  accountId: string;
  /** Dimension member for the report's grouping, or null when untagged. */
  memberId: string | null;
  /** Signed cents. Income lines are credits (negative), expenses debits. */
  amountCents: number;
}

export interface DocumentPayment {
  /** The payment's own posted entry — allocations are dated by it. */
  paymentEntryId: string;
  /** Signed cents of the payment. Only the magnitude is used. */
  amountCents: number;
}

export interface PaymentAllocation {
  paymentEntryId: string;
  /** Allocated shares, signed like the source lines. May be empty. */
  lines: RecognitionLine[];
  /** Magnitude actually recognised — less than the payment on an overpayment. */
  allocatedCents: number;
}

function sign(n: number): number {
  return n < 0 ? -1 : 1;
}

/**
 * Split `targetSigned` across `remaining` in proportion to each entry, so the
 * result sums to exactly `targetSigned`.
 *
 * Truncation toward zero first, then the leftover cents go to the largest
 * fractional remainders — the largest-remainder method. Ties break by index so
 * the same inputs always produce the same split on every machine.
 */
export function splitProportional(
  remaining: readonly number[],
  targetSigned: number,
  totalSigned: number,
): number[] {
  const out = new Array<number>(remaining.length).fill(0);
  if (targetSigned === 0 || totalSigned === 0) return out;

  const target = BigInt(targetSigned);
  const total = BigInt(totalSigned);
  const remainders: Array<{ index: number; remainder: bigint }> = [];

  let placed = 0;
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i] === 0) continue;
    const numerator = BigInt(remaining[i]) * target;
    // BigInt division truncates toward zero, which is what we want: never
    // allocate more than the proportional share before the remainder pass.
    const base = numerator / total;
    out[i] = Number(base);
    placed += out[i];
    // BigInt literals (0n) need an ES2020 target; this tsconfig is lower.
    const rem = numerator % total;
    remainders.push({ index: i, remainder: rem < BigInt(0) ? -rem : rem });
  }

  let leftover = targetSigned - placed;
  if (leftover === 0) return out;

  remainders.sort(
    (a, b) =>
      (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : 0) ||
      a.index - b.index,
  );

  const step = sign(leftover);
  // At most one cent per line per pass; two passes is already more than the
  // truncation error can require, but the loop is bounded either way.
  while (leftover !== 0) {
    let moved = false;
    for (const { index } of remainders) {
      if (leftover === 0) break;
      const next = out[index] + step;
      // Never let a line's share exceed the line, or flip its sign.
      const cap = remaining[index];
      const withinCap = cap >= 0 ? next >= 0 && next <= cap : next <= 0 && next >= cap;
      if (!withinCap) continue;
      out[index] = next;
      leftover -= step;
      moved = true;
    }
    if (!moved) break; // nothing can absorb it; caller's invariant is unmet
  }
  return out;
}

/**
 * Allocate a document's recognition lines across its payments, in the order
 * given (callers pass payments oldest first).
 *
 * An overpayment allocates only what is left; the excess is the caller's to
 * leave on the control account, because unapplied cash is money owed back to
 * the customer, not revenue.
 */
export function allocateDocument(
  recognition: readonly RecognitionLine[],
  payments: readonly DocumentPayment[],
): PaymentAllocation[] {
  const remaining = recognition.map((l) => l.amountCents);
  let remainingTotal = remaining.reduce((sum, n) => sum + n, 0);

  return payments.map((payment) => {
    const payMagnitude = Math.abs(payment.amountCents);
    const remMagnitude = Math.abs(remainingTotal);
    if (payMagnitude === 0 || remMagnitude === 0) {
      return { paymentEntryId: payment.paymentEntryId, lines: [], allocatedCents: 0 };
    }
    const targetMagnitude = Math.min(payMagnitude, remMagnitude);
    const targetSigned = targetMagnitude * sign(remainingTotal);

    const shares = splitProportional(remaining, targetSigned, remainingTotal);

    const lines: RecognitionLine[] = [];
    for (let i = 0; i < shares.length; i++) {
      if (shares[i] === 0) continue;
      remaining[i] -= shares[i];
      lines.push({
        accountId: recognition[i].accountId,
        memberId: recognition[i].memberId,
        amountCents: shares[i],
      });
    }
    remainingTotal -= shares.reduce((sum, n) => sum + n, 0);

    return {
      paymentEntryId: payment.paymentEntryId,
      lines,
      allocatedCents: targetMagnitude,
    };
  });
}
