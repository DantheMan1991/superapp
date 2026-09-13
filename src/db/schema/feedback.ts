/**
 * FEEDBACK — what a client tells us is broken or missing, and the conversation
 * that follows.
 *
 * Read docs/modules/feedback.md and
 * [ADR 0053](../../../docs/decisions/0053-a-report-is-filed-from-the-screen-it-is-about-and-its-thread-is-the-reporters-own.md)
 * before changing anything here. Three decisions shape this file and each one
 * looks like over-thinking until you try the alternative:
 *
 *  1. **THE ROW LIVES IN THE CLIENT'S WORKSPACE, NOT THE OPERATOR'S.** ADR 0041
 *     put a CLIENT in the operator tenant's CRM, and the obvious reading of it
 *     is that a support conversation belongs there too. It does not: the person
 *     who filed this has to be able to READ THE ANSWER, and they have no
 *     account in the operator's workspace. So it is an ordinary tenant-scoped
 *     table with ordinary RLS, and the console reads across every tenant with
 *     `withSystem` after `requireSuperAdmin()` — the posture `/admin/audit`
 *     already has.
 *
 *  2. **A THREAD IS THE REPORTER'S OWN.** The policy is `app_current_tenant()`
 *     AND `app_current_user()` together — `push_devices`' and `device_grants`'
 *     posture rather than an ordinary tenant table's. Not because a report is a
 *     credential, but because the box says "tell us what is wrong" and people
 *     answer that honestly only if their colleagues are not reading it. It also
 *     makes read state ONE timestamp instead of a table, because there is
 *     exactly one client reader. A policy is easier to loosen than to tighten,
 *     and letting the workspace in later is one clause; taking it back out
 *     after somebody has typed a complaint about their boss is not.
 *
 *  3. **THE CONTEXT IS CAPTURED, NEVER ASKED.** Route, feature, shell, app
 *     version, viewport, user agent. Every one of them is a question a bug
 *     report otherwise makes the user answer badly — "which screen?" gets
 *     "the animals one" — and every one is already known to the button that
 *     filed it.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";

/**
 * ONE REPORT — the thread head. Its title, where it came from, where it has
 * got to, and who is waiting on whom.
 *
 * `clerk_user_id` IS THE VISIBILITY TERM and never changes. A report filed by
 * somebody who has since left the workspace stays theirs; nobody inherits it,
 * and the console is where it is still answerable. That is the correct
 * outcome — the alternative is a policy that reassigns a stranger's words to
 * whoever replaced them.
 */
export const feedbackReports = pgTable(
  "feedback_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The reporter. THE visibility term — see the table comment. */
    clerkUserId: text("clerk_user_id").notNull(),
    /**
     * Who they were WHEN THEY WROTE IT, copied rather than joined. The console
     * renders a name and an address for a person it has no Clerk session for,
     * and a report from somebody who has since left must still say who sent it.
     * Identifiers and a display name only — never anything the audit rule would
     * refuse (AGENTS.md).
     */
    reporterName: text("reporter_name").notNull().default(""),
    reporterEmail: text("reporter_email").notNull().default(""),

    /** One of FEEDBACK_KINDS. The client picks; the console may re-file. */
    kind: text("kind").notNull(),
    /** One of FEEDBACK_STATUSES. Written by the console, read by both sides. */
    status: text("status").notNull().default("new"),
    title: text("title").notNull(),

    /**
     * WHERE IT WAS FILED FROM. `route` is the pathname alone and `routeQuery`
     * the search string, split because the pathname is what groups reports
     * ("four people have hit this on the bills list") and the query is what
     * reproduces one.
     *
     * NEITHER IS TRUSTED AS A LINK. The console renders them as text and as a
     * link only after `sameOriginPath` has agreed they are a relative path —
     * this is a string the browser handed us.
     */
    route: text("route").notNull().default(""),
    routeQuery: text("route_query").notNull().default(""),
    /**
     * The module or pack the route belongs to, derived once at filing time by
     * `featureFromRoute` and stored — so the console can group by feature with
     * an index rather than by parsing 400 pathnames on every page load, and so
     * a route that later moves does not silently re-file old reports.
     * Empty when the screen belongs to no feature (Overview, settings).
     */
    featureSlug: text("feature_slug").notNull().default(""),
    /** One of FEEDBACK_SURFACES: the Capacitor shell, or a browser. */
    surface: text("surface").notNull().default("browser"),
    /** The native shell's version, when there is one. */
    appVersion: text("app_version").notNull().default(""),
    /** "375x812". Free text: it is a measurement, not a taxonomy. */
    viewport: text("viewport").notNull().default(""),
    userAgent: text("user_agent").notNull().default(""),

    /**
     * READ STATE, ONE TIMESTAMP PER SIDE. Stored rather than derived because
     * "have you seen this" is not a fact about the messages — it is a fact
     * about a reader, and there is exactly one on each side. The client's is
     * one person by construction (decision 2 above); the operator's is the
     * console, and a second superadmin sharing it is the intended behaviour
     * rather than an oversight, because what the console needs to know is
     * whether ANYBODY has looked.
     *
     * Null means never read, which is not the same as read at the epoch and is
     * why these are nullable rather than defaulted.
     */
    clientReadAt: timestamp("client_read_at", { withTimezone: true }),
    operatorReadAt: timestamp("operator_read_at", { withTimezone: true }),

    /**
     * When it reached a closed status. Set and cleared by the same writer that
     * moves `status`, so "closed" is one indexable predicate rather than a
     * `NOT IN` over a list that will grow — `work_items.closed_at`' reasoning,
     * copied deliberately.
     */
    closedAt: timestamp("closed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The pair the messages table's composite FK points at, so a message can
    // never be attached to a report in another tenant.
    uniqueIndex("feedback_reports_tenant_id_id_idx").on(t.tenantId, t.id),
    // The client's list: their own, newest first.
    index("feedback_reports_reporter_idx").on(
      t.tenantId,
      t.clerkUserId,
      t.createdAt,
    ),
    // The console's list, which spans tenants and filters on status.
    index("feedback_reports_status_idx").on(t.status, t.createdAt),
    check(
      "feedback_reports_kind",
      sql`${t.kind} in ('bug', 'idea', 'question')`,
    ),
    check(
      "feedback_reports_status",
      sql`${t.status} in ('new', 'needs_info', 'planned', 'in_progress', 'done', 'declined')`,
    ),
    check(
      "feedback_reports_surface",
      sql`${t.surface} in ('app', 'browser')`,
    ),
  ],
);
export type FeedbackReport = typeof feedbackReports.$inferSelect;

/**
 * ONE TURN IN THE CONVERSATION, including the first.
 *
 * The opening description is a message like any other rather than a `body`
 * column on the report, so the thread is homogeneous: one ordering, one
 * unread rule, one renderer. The report carries the TITLE, which is the only
 * thing a list needs.
 *
 * ── `internal` IS THE ONE DANGEROUS COLUMN IN THIS FILE ──────────────────────
 *
 * An operator's private note — "same as the one from Hilltop", "this is the
 * Turbopack path bug" — lives in the thread because that is where it is useful
 * and where it is in the right order. Which means a row the client must never
 * see sits in a table the client can read, and the only thing between the two
 * is `internal = false` in the SELECT policy.
 *
 * So it is guarded twice and pinned once: the policy carries the clause, every
 * read on the client path restates it in SQL rather than filtering in code,
 * and `tests/isolation/feedback.test.ts` writes an internal note and asserts
 * the reporter's own transaction cannot see it. If that test is ever deleted,
 * this column is a leak.
 */
export const feedbackMessages = pgTable(
  "feedback_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    reportId: uuid("report_id").notNull(),
    /** One of FEEDBACK_SIDES. */
    side: text("side").notNull(),
    /**
     * Who wrote it. Empty for anything the system writes on a side's behalf
     * (a status change note), which is why this is a sentinel rather than
     * null: nothing indexes it uniquely and an empty string reads the same in
     * every consumer.
     */
    clerkUserId: text("clerk_user_id").notNull().default(""),
    /** Their name at the time, for the same reason the report copies one. */
    authorName: text("author_name").notNull().default(""),
    body: text("body").notNull(),
    /** Operator-only. See the table comment — this column is the leak risk. */
    internal: boolean("internal").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite, so a message cannot point at a report in another tenant even
    // if a caller manages to pass one. `onDelete: cascade` because a deleted
    // report has no conversation left to keep.
    foreignKey({
      columns: [t.tenantId, t.reportId],
      foreignColumns: [feedbackReports.tenantId, feedbackReports.id],
      name: "feedback_messages_report_fk",
    }).onDelete("cascade"),
    // The thread, in order. Both surfaces read exactly this.
    index("feedback_messages_thread_idx").on(t.reportId, t.createdAt),
    check("feedback_messages_side", sql`${t.side} in ('client', 'operator')`),
    // A client message can never be internal. Belt to the policy's braces: if
    // a bug ever wrote one, it would be invisible to the person who sent it.
    check(
      "feedback_messages_internal_is_operators",
      sql`${t.internal} = false OR ${t.side} = 'operator'`,
    ),
  ],
);
export type FeedbackMessage = typeof feedbackMessages.$inferSelect;
