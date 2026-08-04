/**
 * MOVED. The money helpers now live at `@/lib/money`.
 *
 * WHY, in one sentence: CRM needs them for deal amounts, and a module may not
 * import another module — so the code went where eslint.config.mjs says
 * genuinely shared code goes, which is `src/lib/`.
 *
 * This file is a re-export and nothing else. It exists so the sixty callers
 * that already import from here keep working: rewriting all of them inside a
 * feature PR would bury the feature in an unreviewable diff, and every one of
 * those edits is a chance to typo something in the accounting module. They can
 * be moved over opportunistically.
 *
 * **New code should import `@/lib/money` directly.** conventions.md §3 names
 * that path as the one place this logic lives — a second import path is not a
 * second implementation, but it is one more thing to be wrong about.
 */
export {
  MAX_AMOUNT_CENTS,
  parseMoneyToCents,
  formatCents,
  toSafeCents,
  formatCentsSigned,
  centsToCsvAmount,
  todayInTimezone,
  isValidIsoDate,
} from "@/lib/money";
