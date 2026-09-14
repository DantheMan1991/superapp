/**
 * The G702 arithmetic, pure — no imports, so the form can show the same
 * numbers the server will write and a test can pin every one of them.
 *
 * All money is integer cents. A rate is parts per million (10% = 100_000),
 * the convention `sales_tax_rates.rate_ppm` set, because basis points cannot
 * express a real rate exactly and a float can express nothing exactly.
 *
 * ── THE FIVE LINES OF THE CERTIFICATE ───────────────────────────────────────
 *
 *   completed and stored to date  = Σ (previous + this period + stored)
 *   retainage                     = completed × rate, rounded once
 *   earned less retainage         = completed − retainage
 *   previous certificates         = the last issued application's earned less retainage
 *   CURRENT PAYMENT DUE           = earned less retainage − previous certificates
 *
 * Retainage is computed on the TOTAL to date and rounded ONCE, never per line
 * and never per period: the alternative accumulates a cent a month, and a
 * certificate whose retainage does not equal rate × total is one the owner's
 * bookkeeper sends back.
 */
export interface PayLineFigures {
  sovLineId: string;
  scheduledCents: number;
  previousCents: number;
  thisPeriodCents: number;
  storedCents: number;
}

export interface PayApplicationTotals {
  scheduledCents: number;
  completedToDateCents: number;
  retainageCents: number;
  earnedLessRetainageCents: number;
  previousCertificatesCents: number;
  dueCents: number;
  balanceToFinishCents: number;
}

/** Work completed plus materials stored, to date, on one line. */
export function lineCompletedCents(line: {
  previousCents: number;
  thisPeriodCents: number;
  storedCents: number;
}): number {
  return line.previousCents + line.thisPeriodCents + line.storedCents;
}

/** Percent complete of a line, one decimal, or null when the line is worth nothing. */
export function percentComplete(completedCents: number, scheduledCents: number): number | null {
  if (scheduledCents <= 0) return null;
  return Math.round((completedCents / scheduledCents) * 1000) / 10;
}

/**
 * rate × amount in integer math, rounded half up. `amount` is never negative
 * here (completed to date has a floor of zero on every line), so the sign
 * question the house rounding rule answers elsewhere does not arise.
 */
export function retainageCents(completedCents: number, retainagePpm: number): number {
  if (completedCents <= 0 || retainagePpm <= 0) return 0;
  return Math.floor((completedCents * retainagePpm + 500_000) / 1_000_000);
}

export function payApplicationTotals(
  lines: ReadonlyArray<PayLineFigures>,
  retainagePpm: number,
  previousCertificatesCents: number,
): PayApplicationTotals {
  const scheduledCents = lines.reduce((sum, l) => sum + l.scheduledCents, 0);
  const completedToDateCents = lines.reduce((sum, l) => sum + lineCompletedCents(l), 0);
  const retainage = retainageCents(completedToDateCents, retainagePpm);
  const earnedLessRetainageCents = completedToDateCents - retainage;
  return {
    scheduledCents,
    completedToDateCents,
    retainageCents: retainage,
    earnedLessRetainageCents,
    previousCertificatesCents,
    dueCents: earnedLessRetainageCents - previousCertificatesCents,
    balanceToFinishCents: scheduledCents - completedToDateCents,
  };
}

/** 100_000 → "10"; 75_000 → "7.5". What a rate box shows. */
export function ppmToPercentString(ppm: number): string {
  const pct = ppm / 10_000;
  return Number.isInteger(pct) ? String(pct) : String(Math.round(pct * 10_000) / 10_000);
}

/** "10" → 100_000; "7.5" → 75_000; null for anything that is not a rate between 0 and 100. */
export function percentStringToPpm(input: string): number | null {
  const s = input.trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const ppm = Number(whole) * 10_000 + Number((frac + "0000").slice(0, 4));
  if (ppm > 1_000_000) return null;
  return ppm;
}
