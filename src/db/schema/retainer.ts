/**
 * Retainer hours: allotments, time entries and purchases.
 *
 * Split out of the former single-file `src/db/schema.ts`; `./index.ts`
 * re-exports every domain, so `@/db/schema` still resolves exactly as before.
 */
import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";

/** Retainer config + live timer state. One row per tenant, created lazily. */
export const retainers = pgTable(
  "retainers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** CURRENT allotment — display only. Math reads retainer_allotments. */
    includedMinutesMonthly: integer("included_minutes_monthly")
      .notNull()
      .default(0),
    /** Non-null = a timer is running against this tenant. */
    timerStartedAt: timestamp("timer_started_at", { withTimezone: true }),
    timerNote: text("timer_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("retainers_tenant_idx").on(t.tenantId),
    check(
      "retainers_included_nonnegative",
      sql`${t.includedMinutesMonthly} >= 0`,
    ),
  ],
);

/** Allotment history: includedMinutes effective from effectiveMonth onward. */
export const retainerAllotments = pgTable(
  "retainer_allotments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** 'YYYY-MM' calendar month (America/New_York). */
    effectiveMonth: text("effective_month").notNull(),
    includedMinutes: integer("included_minutes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("retainer_allotments_tenant_month_idx").on(
      t.tenantId,
      t.effectiveMonth,
    ),
    check(
      "retainer_allotments_month_format",
      sql`${t.effectiveMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    check(
      "retainer_allotments_nonnegative",
      sql`${t.includedMinutes} >= 0`,
    ),
  ],
);

/** A unit of logged work. The note is the client-facing deliverable. */
export const retainerTimeEntries = pgTable(
  "retainer_time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    minutes: integer("minutes").notNull(),
    /** Bookkeeping day, no timezone — same convention as accounting. */
    workDate: date("work_date", { mode: "string" }).notNull(),
    note: text("note").notNull(),
    /** zod enum: manual | timer. */
    source: text("source").notNull().default("manual"),
    actorClerkUserId: text("actor_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("retainer_time_entries_tenant_date_idx").on(t.tenantId, t.workDate),
    check("retainer_time_entries_minutes_positive", sql`${t.minutes} > 0`),
    check(
      "retainer_time_entries_source",
      sql`${t.source} in ('manual', 'timer')`,
    ),
  ],
);

/**
 * A purchased hour block. Written ONLY by the verified-webhook / reconcile
 * credit path. stripe_session_id unique = the idempotency arbiter: a
 * redelivered webhook conflicts and credits nothing.
 */
export const retainerPurchases = pgTable(
  "retainer_purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    minutes: integer("minutes").notNull(),
    amountCents: integer("amount_cents").notNull().default(0),
    stripeSessionId: text("stripe_session_id").notNull(),
    blockKey: text("block_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("retainer_purchases_session_idx").on(t.stripeSessionId),
    index("retainer_purchases_tenant_idx").on(t.tenantId),
    check("retainer_purchases_minutes_positive", sql`${t.minutes} > 0`),
  ],
);

export type Retainer = typeof retainers.$inferSelect;

export type RetainerAllotment = typeof retainerAllotments.$inferSelect;

export type RetainerTimeEntry = typeof retainerTimeEntries.$inferSelect;

export type RetainerPurchase = typeof retainerPurchases.$inferSelect;
