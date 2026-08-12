/**
 * Month arithmetic for every recurring template — pure, no `server-only`.
 *
 * Moved here from `invoicing/recurring.ts` when the two recurrence mechanisms
 * became one. It was always general: `day_of_month` is DB-checked to 1–28 in
 * both tables precisely so this stays a TOTAL function with no clamping
 * branch, which is the property that made catch-up safe to write.
 */

/** Total function because day_of_month is DB-checked to 1–28 (P11). */
export function advanceMonthly(dateIso: string, dayOfMonth: number): string {
  const [y, m] = dateIso.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
}
