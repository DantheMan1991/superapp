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
  ],
);

export type TimeWorker = typeof timeWorkers.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type TimeSettings = typeof timeSettings.$inferSelect;
