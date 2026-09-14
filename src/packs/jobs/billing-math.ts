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

/*
 * ── COST PLUS A FEE (slice 5b, ADR 0060) ────────────────────────────────────
 *
 * A cost-plus application bills what the job has COST — the ledger's lines
 * tagged with it, by cost code — plus a fee, and the certificate reads:
 *
 *   cost to date          = Σ (previous + this period) over the cost lines
 *   fee to date           = cost to date × rate, rounded once, or the fixed fee
 *                           billed so far (typed), or both
 *   earned to date        = cost + fee, capped at the guaranteed maximum
 *   retainage             = earned × rate, rounded once
 *   earned less retainage
 *   previous certificates = the last issued application's earned less retainage
 *   CURRENT PAYMENT DUE   = earned less retainage − previous certificates
 *
 * The same five bottom lines as the G702, with "completed and stored to
 * date" replaced by "cost plus fee to date", which is why an issued cost-plus
 * application is the same row, the same invoice and the same void path as a
 * fixed-price one. Percent complete has no meaning here and is not shown.
 */
export interface CostLineFigures {
  /** Null for money on the job with no cost code on the line. */
  costCodeId: string | null;
  ledgerToDateCents: number;
  previousCents: number;
  thisPeriodCents: number;
}

export interface CostPlusTerms {
  /** The fee as a share of cost, in parts per million; null or 0 for none. */
  feePpm: number | null;
  /** A fixed fee on the contract; null for none. Billed to date by hand. */
  feeCents: number | null;
  /** The guaranteed maximum; null for no cap. */
  gmaxCents: number | null;
}

export interface CostPlusTotals extends PayApplicationTotals {
  /** Time and materials: approved hours at their rates, billed to date. Zero on cost plus a fee. */
  laborToDateCents: number;
  costToDateCents: number;
  /** The percentage fee on cost to date plus the fixed fee billed to date. */
  feeToDateCents: number;
  /** True when the GMAX held cost plus fee down. */
  capped: boolean;
}

/** rate × cost, rounded half up on the TOTAL, never per line. Zero for a negative total. */
export function feeCents(costToDateCents: number, feePpm: number | null): number {
  if (!feePpm || feePpm <= 0 || costToDateCents <= 0) return 0;
  return Math.floor((costToDateCents * feePpm + 500_000) / 1_000_000);
}

/** What one cost line has billed to date: what earlier applications took plus what this one takes. */
export function costLineToDateCents(line: { previousCents: number; thisPeriodCents: number }): number {
  return line.previousCents + line.thisPeriodCents;
}

/**
 * TIME AND MATERIALS (ADR 0062): what minutes at a rate come to — minutes ×
 * cents per hour ÷ 60, rounded half up PER LINE, because each line is a line
 * on the invoice and a client adds the invoice up. Negative minutes credit
 * hours back at the same rate. A rate of nothing bills nothing.
 */
export function laborLineCents(minutes: number, rateCents: number): number {
  if (!Number.isFinite(minutes) || !Number.isFinite(rateCents) || rateCents <= 0 || minutes === 0) return 0;
  const sign = minutes < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(minutes) * rateCents + 30) / 60);
}

/** "12.5" → 750 minutes; blank → 0; anything else → null. Hours are what a person types; minutes are what is stored. */
export function hoursStringToMinutes(input: string): number | null {
  const t = input.trim();
  if (t === "") return 0;
  const n = Number(t.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 60);
}

/** 750 → "12.5", 45 → "0.75", 0 → "0". At most two decimals; a third of an hour reads 0.33. */
export function minutesToHoursString(minutes: number): string {
  const h = minutes / 60;
  if (Number.isInteger(h)) return String(h);
  const fixed = h.toFixed(2);
  // "0.50" reads 0.5; "0.75" stays. An integer never reaches here, so ".00" cannot.
  return fixed.endsWith("0") ? fixed.slice(0, -1) : fixed;
}

export function costPlusTotals(
  lines: ReadonlyArray<CostLineFigures>,
  terms: CostPlusTerms,
  /** The fixed fee billed to date, as typed on the draft; ignored when the contract has no fixed fee. */
  fixedFeeToDateCents: number,
  retainagePpm: number,
  previousCertificatesCents: number,
  /** Time and materials: the labour lines' billed-to-date sum. The markup is on COST only, never on hours. */
  laborToDateCents = 0,
): CostPlusTotals {
  const costToDateCents = lines.reduce((sum, l) => sum + costLineToDateCents(l), 0);
  const fixedPart = terms.feeCents ? Math.max(0, Math.min(fixedFeeToDateCents, terms.feeCents)) : 0;
  const feeToDateCents = feeCents(costToDateCents, terms.feePpm) + fixedPart;
  const uncapped = laborToDateCents + costToDateCents + feeToDateCents;
  const capped = terms.gmaxCents !== null && terms.gmaxCents >= 0 && uncapped > terms.gmaxCents;
  const completedToDateCents = capped ? (terms.gmaxCents as number) : uncapped;
  const retainage = retainageCents(completedToDateCents, retainagePpm);
  const earnedLessRetainageCents = completedToDateCents - retainage;
  return {
    scheduledCents: terms.gmaxCents ?? 0,
    completedToDateCents,
    retainageCents: retainage,
    earnedLessRetainageCents,
    previousCertificatesCents,
    dueCents: earnedLessRetainageCents - previousCertificatesCents,
    balanceToFinishCents: terms.gmaxCents === null ? 0 : terms.gmaxCents - completedToDateCents,
    laborToDateCents,
    costToDateCents,
    feeToDateCents,
    capped,
  };
}
