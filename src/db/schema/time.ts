/**
 * Time — who can log hours, the hours they logged, and the one setting a week
 * needs to exist.
 *
 * THE SPINE OF A CORE TOOL, built in slice 0 of the plan in
 * docs/modules/time.md. Everything the plan promises later — punches, the
 * overtime evaluator, rates, approval, the labor accrual — hangs off these
 * three tables, and each arrives with the slice that reads it. Nothing here is
 * speculative: every column below is read by a screen that ships with it.
 *
 * INDUSTRY-BLIND, and the words are load-bearing. A bookkeeping firm, a dental
 * practice and a plumbing contractor all recognise a worker, an hour and a day
 * (docs/extension-model.md §3). "Job", "crew" and "shift" do not pass that test
 * and must never appear here — §8 already carries the receipt for "job".
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { parties } from "./parties";
import { tenants } from "./platform";

/**
 * A person who can have hours logged against them.
 *
 * A DETAIL ROW ON THE PARTY SPINE, the shape `crm_party_details` uses, and the
 * single most consequential decision in this module. Roughly forty tables in
 * this codebase stamp `actor_clerk_user_id`, which quietly assumes that every
 * person the business deals with holds a login. A seasonal picker, a framer and
 * a hygienist frequently do not, and a time tool that cannot record their hours
 * is not a time tool.
 *
 * The property that falls out of it and is easy to miss: a subcontractor who is
 * ALSO a vendor is one `parties` row with two detail rows, so their hours can
 * become a bill rather than a paycheck without anybody keying a second record.
 *
 * A party with no row here is simply somebody nobody has ever logged time for —
 * a customer, a supplier, a contact. That is the normal state and not a gap to
 * backfill.
 */
export const timeWorkers = pgTable(
  "time_workers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    partyId: uuid("party_id").notNull(),
    /**
     * The login this worker signs in as, when they have one.
     *
     * TEXT AND NOT A `profiles` FK, matching every other actor column in the
     * schema — which is what lets "is this worker me?" be a string comparison
     * against `ctx.userId` rather than a join on every screen that asks.
     *
     * NULL is the interesting case and the reason this module exists: a person
     * who works here and never opens the app. Nullable rather than the
     * empty-string sentinel used elsewhere because the partial unique index
     * below wants NULLs to be distinct, which is exactly what NULL means here —
     * "no login", many times over, not "the same missing login twice".
     */
    clerkUserId: text("clerk_user_id"),
    /**
     * Somebody who has left. NOT a delete: their hours are history, and a
     * business that could erase a worker could erase what it paid them.
     */
    isActive: boolean("is_active").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Every referencing FK in this schema is tenant-aware, so every referenced
    // table needs this pair unique.
    uniqueIndex("time_workers_tenant_id_id_idx").on(t.tenantId, t.id),
    // 1:1 with the party, the `crm_party_details` rule: "the worker record for
    // this person" is a lookup, never a query that might return two answers.
    uniqueIndex("time_workers_tenant_party_idx").on(t.tenantId, t.partyId),
    // One worker per login. Partial so the many workers with no login at all do
    // not collide with each other — the ordinary case on a farm or a site.
    uniqueIndex("time_workers_tenant_user_idx")
      .on(t.tenantId, t.clerkUserId)
      .where(sql`${t.clerkUserId} is not null`),
    index("time_workers_tenant_active_idx").on(t.tenantId, t.isActive),
    foreignKey({
      name: "time_workers_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }).onDelete("cascade"),
  ],
);

/**
 * THE RAW CLOCK RECORD. Evidence, not the payable fact.
 *
 * The rule this table exists to keep: **store the raw forever and compute
 * everything else.** A punch is what actually happened — two instants and who
 * pressed the button — and the entry it produces is that run through the
 * tenant's rounding policy. Keeping both is what lets a screen answer "you
 * worked 7:53, we were paid for 8:00, here is the rule" instead of showing a
 * number nobody can account for, and it is what makes the rounding policy
 * changeable without rewriting history.
 *
 * ONE OPEN PUNCH PER WORKER, by a partial unique index rather than by care.
 * Two running clocks on one person is not a state the product should be able to
 * reach — it double-counts an afternoon — and between a look-before-you-leap
 * SELECT and the INSERT another request can always win. The index cannot be
 * raced.
 *
 * A manual entry has no punch, which is why nothing downstream may assume one
 * exists. The device, the coordinates and the client-generated id that make an
 * offline phone's punch idempotent arrive in slice 7, with the screen that
 * sends them.
 */
export const timePunches = pgTable(
  "time_punches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    workerId: uuid("worker_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    /** Null = the clock is still running. The only meaning it carries. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /**
     * WHO PRESSED THE BUTTON, which is not who worked. A supervisor clocking
     * six people in is the ordinary case on a site, not an exception.
     */
    startedByClerkUserId: text("started_by_clerk_user_id").notNull(),
    endedByClerkUserId: text("ended_by_clerk_user_id"),
    /** Carried onto the entry at clock-out, so it is typed once. */
    note: text("note").notNull().default(""),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("time_punches_tenant_id_id_idx").on(t.tenantId, t.id),
    // THE INVARIANT. Partial, so the many closed punches a worker accumulates
    // do not collide with each other.
    uniqueIndex("time_punches_one_open_idx")
      .on(t.tenantId, t.workerId)
      .where(sql`${t.endedAt} is null`),
    index("time_punches_tenant_started_idx").on(t.tenantId, t.startedAt),
    foreignKey({
      name: "time_punches_worker_fk",
      columns: [t.tenantId, t.workerId],
      foreignColumns: [timeWorkers.tenantId, timeWorkers.id],
    }).onDelete("cascade"),
    // A clock that stopped before it started is a typo in an adjustment, and it
    // would produce negative minutes downstream.
    check(
      "time_punches_ends_after_start",
      sql`${t.endedAt} is null or ${t.endedAt} > ${t.startedAt}`,
    ),
  ],
);

/**
 * Hours worked on a day. The fact everything downstream reads.
 *
 * Slice 1 adds `time_punches` — the raw clock record that PRODUCES entries —
 * and the rule that comes with it: store the raw forever and compute
 * everything else, so a rounded number can always show its working. An entry
 * typed by hand has no punch, which is why nothing here is nullable on the
 * assumption one exists.
 */
export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    workerId: uuid("worker_id").notNull(),
    /**
     * MINUTES, not decimal hours. 7.4 hours is not representable in binary
     * floating point and a timesheet that loses a cent an hour is a timesheet
     * somebody has to reconcile by hand. `retainer_time_entries` and
     * `ps_time_entries` both settled on minutes first; this agrees with them so
     * the later absorption slices are a copy rather than a conversion.
     */
    minutes: integer("minutes").notNull(),
    /**
     * The bookkeeping day, no timezone — the same convention accounting uses.
     * `mode: "string"` because comparing a `date` column against a server
     * `Date` is wrong by up to a day for anybody off UTC, the trap crm.md
     * records. Compare `yyyy-mm-dd` strings.
     */
    workDate: date("work_date", { mode: "string" }).notNull(),
    /**
     * CLOSED ON PURPOSE, and the one CHECK in this file that is a design
     * decision rather than a guard.
     *
     * Nearly every taxonomy in this codebase is open (primitive P1) so a pack
     * can supply vocabulary without a migration to core. This one cannot be,
     * because the overtime evaluator arriving in slice 2 has to answer one
     * question about every entry — does this hour count toward the 40? — and a
     * value it has never seen cannot be classified safely in either direction.
     * Defaulting an unknown code to "worked" inflates overtime; defaulting it
     * to "not worked" loses somebody's premium. Both are wrong, so the set is
     * closed and a new code is a migration plus a line in `core/pay-types.ts`.
     *
     * Paid leave and holiday are on the paycheck and NOT in the 40. That
     * distinction is here from the first day precisely so slice 2 is pure
     * arithmetic over a column that already means the right thing — getting it
     * wrong is the most common defect in this whole domain.
     */
    payType: text("pay_type").notNull().default("worked"),
    note: text("note").notNull().default(""),
    /**
     * The punch this came from, when it came from one. Null for an entry
     * somebody typed, which is most of them on most businesses.
     *
     * ONE DIRECTION ONLY. `time_punches` deliberately carries no `entry_id`
     * back: two columns that can disagree are two columns that will, and "did
     * this punch produce an entry?" is a lookup on the index below. The same
     * argument `work_items` makes for `closed_at` over a boolean.
     */
    punchId: uuid("punch_id"),
    /**
     * The entry this one CORRECTS, when it is a correction.
     *
     * Set only by an amendment: once a pay period is locked its entries are
     * immutable, so the way to put one right is to add a new entry in the open
     * period that says what the difference was. Paid history is never rewritten
     * — the original stays exactly as the pay run saw it, and this link is what
     * lets a screen show the two together.
     *
     * Self-referential and composite, so an amendment can never point at
     * another tenant's entry. `RESTRICT` rather than cascade or set-null: an
     * entry somebody has amended is the evidence for the correction, and
     * deleting it would leave a correction of nothing.
     */
    amendsEntryId: uuid("amends_entry_id"),
    /**
     * How this entry came to exist. `timer` means a punch produced it, so a
     * screen can say the minutes were rounded rather than typed.
     *
     * CHECKED, and widened by the slice that adds a writer — `kiosk`, `import`,
     * `tell` and `paste` each arrive with the door that writes them. A value
     * set listing doors nobody has built would be a promise in a constraint.
     */
    source: text("source").notNull().default("manual"),
    /**
     * WHO TYPED IT, which is not who worked — a supervisor logging a crew's
     * afternoon is the ordinary case, not an exception. Kept apart from
     * `worker_id` for the reason `crm_party_details` keeps owner and visibility
     * apart: one word meaning two things in one table is how a permission bug
     * starts.
     */
    enteredByClerkUserId: text("entered_by_clerk_user_id").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("time_entries_tenant_id_id_idx").on(t.tenantId, t.id),
    index("time_entries_tenant_date_idx").on(t.tenantId, t.workDate),
    index("time_entries_worker_date_idx").on(
      t.tenantId,
      t.workerId,
      t.workDate,
    ),
    // One entry per punch. Partial, because the many typed entries carry no
    // punch at all and must not collide.
    uniqueIndex("time_entries_punch_idx")
      .on(t.tenantId, t.punchId)
      .where(sql`${t.punchId} is not null`),
    foreignKey({
      name: "time_entries_amends_fk",
      columns: [t.tenantId, t.amendsEntryId],
      foreignColumns: [t.tenantId, t.id],
    }),
    foreignKey({
      name: "time_entries_punch_fk",
      columns: [t.tenantId, t.punchId],
      foreignColumns: [timePunches.tenantId, timePunches.id],
      // SET NULL, not cascade: the entry is the payable fact and the punch is
      // evidence for it, so losing the evidence must not lose the pay. The
      // emitted SQL needs Postgres 15's COLUMN-LIST form, `SET NULL
      // ("punch_id")` — a bare SET NULL on a composite FK would try to null
      // `tenant_id` too and can never run. Hand-written in the migration;
      // drizzle-kit diffs its own snapshot rather than the database, so it does
      // not revert it.
    }).onDelete("set null"),
    foreignKey({
      name: "time_entries_worker_fk",
      columns: [t.tenantId, t.workerId],
      foreignColumns: [timeWorkers.tenantId, timeWorkers.id],
    }).onDelete("cascade"),
    check("time_entries_minutes_positive", sql`${t.minutes} > 0`),
    /**
     * A single entry cannot exceed a day. Not a policy about overwork — two
     * entries on one day may legitimately total more than one shift's worth —
     * but a typo guard: "800" meant as eight hours is otherwise thirteen days,
     * and it reaches a pay run before anybody notices.
     */
    check("time_entries_minutes_within_a_day", sql`${t.minutes} <= 1440`),
    check(
      "time_entries_pay_type",
      sql`${t.payType} in ('worked', 'paid_leave', 'holiday', 'unpaid')`,
    ),
    check("time_entries_source", sql`${t.source} in ('manual', 'timer')`),
    // An entry cannot amend itself; deeper cycles are the write path's problem,
    // but the database can refuse the trivial one a bad copy produces. The same
    // guard `schedule_items.parent_id` and `work_items.parent_id` carry.
    check("time_entries_amends_not_self", sql`${t.amendsEntryId} <> ${t.id}`),
  ],
);

/**
 * One row per tenant, created lazily. Today it holds exactly one thing.
 *
 * `week_starts_on` is not decoration: it is what the screen groups by, and from
 * slice 2 it is the anchor of the WORKWEEK — the fixed recurring period
 * overtime is computed over, which is not the pay period and need not line up
 * with it. Owners genuinely differ (a Sunday week and a Monday week are both
 * ordinary), and guessing turns every weekly total into a number somebody has
 * to argue with.
 *
 * The pay frequency, the rounding policy and the overtime ruleset land here in
 * slice 2, with the code that reads them.
 */
export const timeSettings = pgTable(
  "time_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** 0 = Sunday … 6 = Saturday, matching `Date.prototype.getDay()`. */
    weekStartsOn: integer("week_starts_on").notNull().default(0),
    /**
     * What a punch's minutes are rounded to on the way to an entry. 0 = to the
     * minute, which is the default because it is the only setting that is
     * right without anybody thinking about it.
     *
     * THERE IS NO DIRECTION, AND THAT IS THE POINT. Rounding is always to the
     * NEAREST increment, so it costs the worker as often as it pays them. A
     * policy that always rounds down is unlawful wage theft however small the
     * increment, so the product does not offer it — which is why this is one
     * integer and not a pair with a mode beside it.
     */
    roundingMinutes: integer("rounding_minutes").notNull().default(0),
    /**
     * How often people are PAID. Not how overtime is measured — that is the
     * workweek, above, and the two are allowed to disagree. Biweekly is two
     * workweeks and each is evaluated on its own; semi-monthly and monthly do
     * not align to weeks at all.
     */
    payFrequency: text("pay_frequency").notNull().default("weekly"),
    /**
     * The first day of some pay period, for `biweekly` ONLY — the one
     * frequency whose boundaries cannot be derived from the calendar or from
     * the week start. Null for the other three, where it would be a value that
     * means nothing and could drift.
     */
    periodAnchor: date("period_anchor", { mode: "string" }),
    /**
     * Which overtime rules this business is measured by. A SLUG naming a data
     * file in `core/rulesets.ts`, never a set of thresholds stored here: two
     * places holding the definition of "over 40" is two places to get it wrong,
     * and a business does not want its rules frozen at the moment it signed up.
     *
     * CHECKed so the column cannot hold a ruleset no build has, though
     * `rulesetFor` falls back to the federal floor rather than failing a page
     * if a deploy ever goes backwards.
     */
    overtimeRuleset: text("overtime_ruleset").notNull().default("federal"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("time_settings_tenant_idx").on(t.tenantId),
    check(
      "time_settings_week_starts_on",
      sql`${t.weekStartsOn} between 0 and 6`,
    ),
    check(
      "time_settings_rounding_minutes",
      sql`${t.roundingMinutes} in (0, 5, 6, 10, 15, 30)`,
    ),
    check(
      "time_settings_pay_frequency",
      sql`${t.payFrequency} in ('weekly', 'biweekly', 'semimonthly', 'monthly')`,
    ),
    check(
      "time_settings_overtime_ruleset",
      sql`${t.overtimeRuleset} in ('federal', 'california', 'none')`,
    ),
    // An anchor is meaningless except for biweekly, and one left behind after a
    // change of frequency would quietly decide period boundaries if the
    // business ever switched back.
    check(
      "time_settings_anchor_only_biweekly",
      sql`${t.periodAnchor} is null or ${t.payFrequency} = 'biweekly'`,
    ),
  ],
);

/**
 * A pay period that has been LOCKED, and nothing else.
 *
 * A period is arithmetic over `time_settings` (`core/periods.ts`) — slice 2
 * deliberately did not materialise one, because until a period can be locked
 * there is no fact about it worth storing. This table is that fact: payroll has
 * been run for these dates, so the hours inside them must stop moving.
 *
 * A ROW IS CREATED WHEN A PERIOD IS FIRST LOCKED and then kept. Unlocking nulls
 * `locked_at` rather than deleting, so the row remains the record that this
 * period has been through a pay run at least once. WHO unlocked it and when is
 * `audit_log`'s business, not a pair of columns here that nothing would read.
 *
 * THE DATES ARE STORED, not derived, because they must survive a change of pay
 * frequency. An owner who switches from fortnightly to monthly has not
 * un-locked last fortnight.
 */
export const timePeriods = pgTable(
  "time_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    /** Null = open. The only meaning it carries, and the only predicate read. */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedByClerkUserId: text("locked_by_clerk_user_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("time_periods_tenant_id_id_idx").on(t.tenantId, t.id),
    // One row per period. The start date identifies it; two periods cannot
    // begin on the same day under any frequency.
    uniqueIndex("time_periods_tenant_start_idx").on(t.tenantId, t.startsOn),
    index("time_periods_tenant_range_idx").on(t.tenantId, t.endsOn),
    check("time_periods_ends_after_start", sql`${t.endsOn} >= ${t.startsOn}`),
    // Two columns that can disagree are two columns that will. Either it is
    // locked and somebody locked it, or neither.
    check(
      "time_periods_locked_pair",
      sql`(${t.lockedAt} is null) = (${t.lockedByClerkUserId} is null)`,
    ),
  ],
);

/**
 * One worker's hours for one pay period, submitted and then approved.
 *
 * A ROW EXISTS ONCE IT HAS BEEN SUBMITTED. `approved_at is null` is "waiting
 * for somebody", which is exactly the question the attention source asks, and
 * it needs no status column to answer — the arrangement `work_items.closed_at`
 * already lives by.
 *
 * THE TOTALS ARE A SNAPSHOT TAKEN AT APPROVAL, and they are null until then.
 * Before approval the numbers are still moving, so storing them would be
 * storing a guess; after it, they are what the approver actually agreed to and
 * what a pay run quotes. `ruleset_slug` rides with them because the same hours
 * under different rules are different money, and a business that changes its
 * rules must not silently restate what it already approved.
 *
 * THE PERIOD'S DATES ARE STORED rather than referenced, for `time_periods`'
 * reason: a sheet approved for a fortnight stays approved for that fortnight
 * after the payroll switches to monthly.
 */
export const timeSheets = pgTable(
  "time_sheets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    workerId: uuid("worker_id").notNull(),
    periodStartsOn: date("period_starts_on", { mode: "string" }).notNull(),
    periodEndsOn: date("period_ends_on", { mode: "string" }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedByClerkUserId: text("submitted_by_clerk_user_id").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByClerkUserId: text("approved_by_clerk_user_id"),
    /** The snapshot. Null until approved; see the header. */
    workedMinutes: integer("worked_minutes"),
    regularMinutes: integer("regular_minutes"),
    overtimeMinutes: integer("overtime_minutes"),
    doubleTimeMinutes: integer("double_time_minutes"),
    paidLeaveMinutes: integer("paid_leave_minutes"),
    /** Which rules produced those numbers. */
    rulesetSlug: text("ruleset_slug"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("time_sheets_tenant_id_id_idx").on(t.tenantId, t.id),
    // One sheet per person per period.
    uniqueIndex("time_sheets_tenant_worker_period_idx").on(
      t.tenantId,
      t.workerId,
      t.periodStartsOn,
    ),
    // What the attention source reads: everything still waiting.
    index("time_sheets_tenant_awaiting_idx").on(t.tenantId, t.approvedAt),
    foreignKey({
      name: "time_sheets_worker_fk",
      columns: [t.tenantId, t.workerId],
      foreignColumns: [timeWorkers.tenantId, timeWorkers.id],
    }).onDelete("cascade"),
    check(
      "time_sheets_ends_after_start",
      sql`${t.periodEndsOn} >= ${t.periodStartsOn}`,
    ),
    check(
      "time_sheets_approved_pair",
      sql`(${t.approvedAt} is null) = (${t.approvedByClerkUserId} is null)`,
    ),
    // The snapshot arrives with the approval and never without it.
    check(
      "time_sheets_snapshot_with_approval",
      sql`(${t.approvedAt} is null) = (${t.workedMinutes} is null)`,
    ),
  ],
);

export type TimeWorker = typeof timeWorkers.$inferSelect;
export type TimePeriod = typeof timePeriods.$inferSelect;
export type TimeSheet = typeof timeSheets.$inferSelect;
export type TimePunch = typeof timePunches.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type TimeSettings = typeof timeSettings.$inferSelect;
