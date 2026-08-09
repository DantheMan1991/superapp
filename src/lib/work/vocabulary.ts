/**
 * The words Work's columns are allowed to hold.
 *
 * ITS OWN FILE, WITH NO IMPORTS AND NO DIRECTIVE, AND THAT IS THE POINT.
 * These values are needed in three places that cannot share a module:
 *
 *   * `src/db/schema/work.ts`, which is server-side and pulls in drizzle;
 *   * `src/modules/work/core/state.ts`, rendered in the BROWSER by a board;
 *   * the migration's CHECK, which is SQL and imports nothing at all.
 *
 * documents.md paid for this twice. `server-only` propagates through TYPE
 * imports, so a type plus a constant pulled out of a server module into a
 * client component fails the build; and conventions §8 records the inverse,
 * where a helper living in a `"use client"` file became a client reference and
 * took the CRM deal page down in production. A file with no directive and no
 * dependencies cannot do either.
 *
 * Keeping the values here also keeps them out of a client bundle by way of the
 * schema: importing a label from `@/db/schema/work` would drag drizzle and
 * every table definition along with it.
 */

/**
 * The five states core reasons about, least to most finished.
 *
 * All five pass the neutrality test in extension-model.md §3 — a bookkeeper
 * waits on a client, a dentist waits on a lab, a plumber waits on parts, and
 * all three call that blocked. What none of them share is the WORD: "On the
 * way" is a plumbing label for `in_progress`, which is what `status` is for.
 *
 * **These must stay in step with the `work_items_state` CHECK** in
 * drizzle/0104. There is a test that reads the constraint back out of Postgres
 * and compares, because the two cannot be generated from one another and a
 * drift here is a state the app believes in and the database refuses.
 */
export const WORK_STATES = [
  "todo",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
] as const;
export type WorkState = (typeof WORK_STATES)[number];

/** The two states that mean the item is finished with, either way. */
export const WORK_CLOSED_STATES = ["done", "cancelled"] as const;

/** How much of a list the tenant's staff may see. */
export const WORK_VISIBILITIES = ["members", "owners"] as const;
export type WorkVisibility = (typeof WORK_VISIBILITIES)[number];
