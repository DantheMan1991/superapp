/**
 * Professional services — engagements, and the time against them.
 *
 * The `professional-services` pack's tables (Layer 2a, P4 in
 * docs/extension-model.md §4), prefixed `ps_` the way CRM's are `crm_` —
 * the pack's slug spelled out would push every index name past what
 * Postgres allows. Same rules as any tenant table: `tenant_id`, FORCE RLS,
 * isolation coverage (tests/isolation/professional-services.test.ts).
 *
 * AN ENGAGEMENT IS A CLIENT'S AGREEMENT WITH THE BUSINESS: who it is for,
 * what is being done, for how much, from when. The client is a PARTY — the
 * shared identity Accounting and CRM already keep — so an engagement never
 * carries a name of its own for the client, and a party that is also a
 * customer is one row holding two roles. The composite FK to `parties`
 * carries NO cascade on purpose: the CRM's merge deletes the losing identity
 * LAST so that a reference it did not know to re-point fails on the key and
 * rolls the merge back, rather than taking a client's engagement and its
 * time log with it (src/modules/crm/merge-ops.ts, step 8).
 *
 * THE KIND IS A WORD, NOT A RULE. `retainer`, `project`, `hourly` are the
 * suggestions; the column is an open taxonomy (P1) with a format check and
 * no value check, because a law practice's "matter" and a studio's "account"
 * are the same row. What the math reads is the FIELDS: retainer minutes a
 * month make a meter, a rate prices the overage, a fee is shown. An
 * engagement with none of them is a place to log time.
 *
 * RETAINER HOURS ARE MONTH-KEYED HISTORY, not a column the math reads —
 * `retainer_minutes_monthly` on the engagement is display, and
 * `ps_engagement_allotments` says what was agreed from which month. The
 * platform's own retainer meter made this call first (retainer-hours.md):
 * raising a client's hours in October must not rewrite September's overage.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
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
import { tenants } from "./platform";
import { parties } from "./parties";

export const psEngagements = pgTable(
  "ps_engagements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The client: a party in this tenant. Fixed at creation, like an asset's company. */
    partyId: uuid("party_id").notNull(),
    name: text("name").notNull(),
    /** Open taxonomy (P1): the format is checked, the values are not. */
    kind: text("kind").notNull().default("retainer"),
    /**
     * text + CHECK, never a pgEnum (documents.md paid for that lesson twice).
     * proposed → active → paused | ended; ended → active again is a reopen.
     */
    status: text("status").notNull().default("active"),
    /** What is being done, in the words of the agreement. */
    scope: text("scope").notNull().default(""),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }),
    /**
     * The agreed fee, in cents: a month's retainer, a project's price. Null
     * is "not priced this way", which is different from free — an hourly
     * engagement has a rate and no fee.
     */
    feeCents: bigint("fee_cents", { mode: "number" }),
    /** Per hour, in cents. Prices overage on a retainer and everything on an hourly engagement. */
    rateCents: bigint("rate_cents", { mode: "number" }),
    /** CURRENT retainer allotment — display only. The math reads ps_engagement_allotments. */
    retainerMinutesMonthly: integer("retainer_minutes_monthly")
      .notNull()
      .default(0),
    notes: text("notes").notNull().default(""),
    createdByClerkUserId: text("created_by_clerk_user_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ps_engagements_tenant_id_id_idx").on(t.tenantId, t.id),
    index("ps_engagements_tenant_party_idx").on(t.tenantId, t.partyId),
    index("ps_engagements_tenant_status_idx").on(t.tenantId, t.status),
    // No ON DELETE: see the header. A party with engagements cannot be
    // deleted or merged away underneath them.
    foreignKey({
      name: "ps_engagements_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }),
    check("ps_engagements_kind_format", sql`${t.kind} ~ '^[a-z][a-z0-9_]{0,62}$'`),
    check(
      "ps_engagements_status_valid",
      sql`${t.status} in ('proposed', 'active', 'paused', 'ended')`,
    ),
    check(
      "ps_engagements_retainer_nonnegative",
      sql`${t.retainerMinutesMonthly} >= 0`,
    ),
    check(
      "ps_engagements_fee_nonnegative",
      sql`${t.feeCents} is null or ${t.feeCents} >= 0`,
    ),
    check(
      "ps_engagements_rate_nonnegative",
      sql`${t.rateCents} is null or ${t.rateCents} >= 0`,
    ),
    check(
      "ps_engagements_ends_after_start",
      sql`${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`,
    ),
  ],
);

/**
 * Retainer hours agreed from a month onward. One row per change, keyed by
 * the calendar month it took effect; `allotmentForMonth` in
 * src/lib/retainer-core.ts reads the newest row at or before a month, so a
 * month keeps the figure that was agreed when it happened.
 */
export const psEngagementAllotments = pgTable(
  "ps_engagement_allotments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    engagementId: uuid("engagement_id").notNull(),
    /** 'YYYY-MM', in the tenant's calendar. */
    effectiveMonth: text("effective_month").notNull(),
    includedMinutes: integer("included_minutes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ps_engagement_allotments_month_idx").on(
      t.tenantId,
      t.engagementId,
      t.effectiveMonth,
    ),
    foreignKey({
      name: "ps_engagement_allotments_engagement_fk",
      columns: [t.tenantId, t.engagementId],
      foreignColumns: [psEngagements.tenantId, psEngagements.id],
    }).onDelete("cascade"),
    check(
      "ps_engagement_allotments_month_format",
      sql`${t.effectiveMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    check(
      "ps_engagement_allotments_nonnegative",
      sql`${t.includedMinutes} >= 0`,
    ),
  ],
);

/**
 * A unit of work against an engagement. Minutes, a bookkeeping day, a note,
 * and who logged it. A chore (`member` level): the person who did the work
 * is the person writing it down, and they are rarely the owner.
 */
export const psTimeEntries = pgTable(
  "ps_time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    engagementId: uuid("engagement_id").notNull(),
    minutes: integer("minutes").notNull(),
    /** Bookkeeping day, no timezone — same convention as accounting. */
    workDate: date("work_date", { mode: "string" }).notNull(),
    note: text("note").notNull().default(""),
    actorClerkUserId: text("actor_clerk_user_id").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ps_time_entries_tenant_id_id_idx").on(t.tenantId, t.id),
    index("ps_time_entries_engagement_date_idx").on(
      t.tenantId,
      t.engagementId,
      t.workDate,
    ),
    foreignKey({
      name: "ps_time_entries_engagement_fk",
      columns: [t.tenantId, t.engagementId],
      foreignColumns: [psEngagements.tenantId, psEngagements.id],
    }).onDelete("cascade"),
    check("ps_time_entries_minutes_positive", sql`${t.minutes} > 0`),
  ],
);

export type Engagement = typeof psEngagements.$inferSelect;
export type EngagementAllotment = typeof psEngagementAllotments.$inferSelect;
/**
 * Named for its table, as `RetainerTimeEntry` is. It was `TimeEntry` until the
 * core Time module arrived, whose `time_entries` derives that name and whose
 * barrel export collided with this one — a pack does not get to hold the
 * unqualified word for a thing core also has.
 */
export type PsTimeEntry = typeof psTimeEntries.$inferSelect;
