/**
 * The words a feedback report's columns are allowed to hold.
 *
 * ITS OWN FILE, WITH NO IMPORTS AND NO DIRECTIVE, for the reason
 * `src/lib/work/vocabulary.ts` spells out: these values are needed in three
 * places that cannot share a module — `src/db/schema/feedback.ts` (server,
 * drags drizzle), the sheet and the console (rendered in the BROWSER), and the
 * migration's CHECK (SQL, imports nothing). `server-only` propagates through
 * type imports, so a constant pulled out of a server module into a client
 * component fails the build.
 *
 * **text + CHECK, never a pgEnum.** documents.md paid for that lesson twice: a
 * new enum value needs its own migration file, alone, because it cannot be used
 * in the transaction that adds it. `status` below is the column most likely to
 * grow a seventh value, which is exactly the case the rule exists for.
 */

/**
 * WHAT SOMEBODY IS TELLING US. Three, not two, and the third is the concession
 * to reality: the button is on every screen, so somebody who is stuck will
 * press it to ask rather than open the guide, and a product that files that as
 * a "bug" learns the wrong thing from its own inbox.
 *
 * The client picks one and the console may re-file it, because the person
 * reporting is describing what happened to them and not triaging our backlog —
 * "the totals are wrong" is a bug, an idea or a misread guide, and which of the
 * three it is is not knowable from the chair it was sent from.
 */
export const FEEDBACK_KINDS = ["bug", "idea", "question"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/**
 * WHERE A REPORT HAS GOT TO. Ordered new → finished, and every value is a
 * sentence the person who sent it would recognise about their own report —
 * which is the test a status column has to pass here, because unlike a work
 * item's state this one is READ BY THE PERSON WAITING.
 *
 *   * `new`         nobody has looked yet
 *   * `needs_info`  we asked them something; the ball is theirs
 *   * `planned`     accepted, not started
 *   * `in_progress` being worked on now
 *   * `done`        shipped
 *   * `declined`    not going to happen, and said so
 *
 * NO `wont_fix`-STYLE SILENCE. `declined` exists so that "no" is a thing the
 * console can say out loud; a report that just stops being answered teaches
 * the client not to send the next one.
 *
 * **These must stay in step with the `feedback_reports_status` CHECK** in the
 * migration. `tests/feedback-core.test.ts` reads the constraint back out of
 * Postgres and compares, the device `work_items_state` uses, because the two
 * cannot be generated from one another.
 */
export const FEEDBACK_STATUSES = [
  "new",
  "needs_info",
  "planned",
  "in_progress",
  "done",
  "declined",
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** The two that mean the report is finished with, either way. */
export const FEEDBACK_CLOSED_STATUSES = ["done", "declined"] as const;

/**
 * WHICH SIDE OF THE CONVERSATION WROTE A MESSAGE. Not a role and not a user id
 * — both of those are stored beside it. This is the only term the RLS policy
 * and the rendering both need, and it stays true when the person who sent it
 * has left the workspace.
 */
export const FEEDBACK_SIDES = ["client", "operator"] as const;
export type FeedbackSide = (typeof FEEDBACK_SIDES)[number];

/**
 * WHICH SHELL IT WAS FILED FROM. `app` is the Capacitor build (ADR 0032),
 * `browser` everything else. Captured rather than asked, because "were you in
 * the app" is a question no user should ever be made to answer about a bug.
 */
export const FEEDBACK_SURFACES = ["app", "browser"] as const;
export type FeedbackSurface = (typeof FEEDBACK_SURFACES)[number];

/** Longest a title may be. The list renders it on one line on a phone. */
export const FEEDBACK_TITLE_MAX = 140;
/** Longest a single message may be. Generous — a good bug report is long. */
export const FEEDBACK_BODY_MAX = 8_000;
