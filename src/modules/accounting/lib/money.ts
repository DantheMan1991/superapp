/**
 * Money helpers shared by server and client (no "server-only").
 *
 * All amounts are integer cents in JS numbers. Integer arithmetic below
 * Number.MAX_SAFE_INTEGER is exact; MAX_AMOUNT_CENTS keeps every stored
 * amount far inside that bound, and toSafeCents() refuses — loudly — to
 * return any aggregate that crosses it. The DB column is bigint, so if the
 * business ever outgrows this, only this file and core/balances change.
 */

/** $100 billion in cents — the per-line ceiling, enforced in Zod and core. */
export const MAX_AMOUNT_CENTS = 10_000_000_000_000;

/**
 * Parse a user-typed money string ("1,234.56") to non-negative cents.
 * Returns null for anything unparseable, negative, more than 2 decimals,
 * or beyond MAX_AMOUNT_CENTS.
 */
export function parseMoneyToCents(input: string): number | null {
  const s = input.trim().replace(/,/g, "").replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT_CENTS) return null;
  return cents;
}

/** Format signed cents as "1,234.56" (no currency symbol, no sign). */
export function formatCents(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${whole.toLocaleString("en-US")}.${frac}`;
}

/**
 * Convert a Postgres bigint aggregate (arrives as string or number) to a
 * JS number, throwing rather than silently losing precision.
 */
export function toSafeCents(value: string | number | null): number {
  if (value === null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`ledger amount exceeds safe integer range: ${value}`);
  }
  return n;
}

/**
 * Format signed cents in accounting style: negatives in parentheses.
 * "1,234.56" / "(1,234.56)". Used by reports (P6); formatCents stays
 * sign-blind for debit/credit-column layouts.
 */
export function formatCentsSigned(cents: number): string {
  const s = formatCents(cents);
  return cents < 0 ? `(${s})` : s;
}

/**
 * CSV amount: plain "-1234.56" built by integer construction — no float
 * division, no thousands separators (P5).
 */
export function centsToCsvAmount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

/** Today's ISO date (yyyy-mm-dd) in the tenant's bookkeeping timezone. */
export function todayInTimezone(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** True if s is a real calendar date in yyyy-mm-dd form (rejects 2026-02-31). */
export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}
