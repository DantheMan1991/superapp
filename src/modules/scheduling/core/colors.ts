/**
 * The calendar palette.
 *
 * IT LIVES HERE RATHER THAN IN `actions.ts`, AND THAT IS NOT TIDINESS. A
 * `"use server"` file may export ONLY async functions — every other runtime
 * export makes Next.js throw *"A 'use server' file can only export async
 * functions, found object"* when the module graph is evaluated, which takes down
 * every server action in the file and every page that transitively imports it.
 *
 * It shipped in `actions.ts` on 2026-08-08 and broke the superadmin tenant page
 * in production: enabling ANY module 500'd, because that page imports
 * `moduleRegistry` → `SchedulingModule` → `calendar-manager` → `actions`.
 *
 * WHAT MAKES IT WORTH A FILE HEADER: `tsc`, eslint, vitest AND `npm run build`
 * all passed it. The failure only happens when the server-action graph is
 * evaluated at request time. `tests/use-server-exports.test.ts` is the guard
 * that now catches it, because nothing else in the pipeline does.
 *
 * (Exported `type` and `interface` declarations are fine anywhere — they are
 * erased before runtime, which is why several other action files have them.)
 */
export const CALENDAR_COLORS = [
  "slate",
  "blue",
  "green",
  "amber",
  "rose",
  "violet",
] as const;

export type CalendarColor = (typeof CALENDAR_COLORS)[number];
