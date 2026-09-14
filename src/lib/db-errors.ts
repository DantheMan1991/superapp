/**
 * Reading the driver's error through drizzle's wrapper.
 *
 * ── THIS EXISTS BECAUSE THE OBVIOUS VERSION SILENTLY DOES NOTHING ────────────
 *
 * `String(err).includes("<index name>")` never fires. Drizzle wraps the
 * driver's error in `DrizzleQueryError`, whose message is `Failed query: insert
 * into … params: …` — the SQL, never the constraint. The real error is one
 * level down, on `cause`. Measured, not guessed:
 *
 *     err.cause.code       === "23505"
 *     err.cause.constraint === "time_punches_one_open_idx"
 *
 * The time module found this first (a second clock-in showed a raw SQL dump
 * where "a clock is already running" was written and waiting) and wrote
 * `violatedUniqueIndex` in `src/modules/time/core/errors.ts`. The `jobs` pack
 * then shipped four translations of the same dead shape and found out the same
 * way, on 2026-09-14 — so the helper lives here now, where a pack may reach it
 * without importing another module, and time re-exports it.
 *
 * Returns the NAME rather than a boolean so the caller matches on the index it
 * means, and a violation of any other one keeps travelling as the failure it
 * is.
 */
export function violatedUniqueIndex(err: unknown): string | null {
  const own = err as { code?: string; constraint?: string } | null;
  const cause = (err as { cause?: { code?: string; constraint?: string } } | null)
    ?.cause;
  const code = own?.code ?? cause?.code;
  if (code !== "23505") return null;
  return own?.constraint ?? cause?.constraint ?? null;
}
