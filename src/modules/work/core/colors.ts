/**
 * The work-list palette.
 *
 * IT LIVES HERE RATHER THAN IN `actions.ts`, AND THAT IS NOT TIDINESS. A
 * `"use server"` file may export ONLY async functions — every other runtime
 * export makes Next.js throw *"A 'use server' file can only export async
 * functions, found object"* when the module graph is evaluated, taking down
 * every action in the file and every page that transitively imports it.
 * Scheduling shipped a colour array in `actions.ts` on 2026-08-08 and broke the
 * superadmin tenant page in production; `tsc`, eslint, vitest and
 * `npm run build` all passed it. `tests/use-server-exports.test.ts` is the only
 * thing in the pipeline that catches it.
 *
 * The same six names as the calendar palette, deliberately duplicated rather
 * than imported: a module may not import another module (extension-model §6),
 * and six strings are a cheaper price than the seam that would avoid them.
 *
 * The COLUMN stays open text so a palette can change without a migration; this
 * enum is the boundary check, so nothing arbitrary reaches a style attribute.
 */
export const WORK_COLORS = [
  "slate",
  "blue",
  "green",
  "amber",
  "rose",
  "violet",
] as const;

export type WorkColor = (typeof WORK_COLORS)[number];

/** Tailwind classes per colour. Static strings — Tailwind cannot see a concat. */
export const WORK_COLOR_CLASSES: Record<WorkColor, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  green: "bg-green-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};
