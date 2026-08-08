/**
 * Period close: locking a month and the notes explaining it.
 *
 * Split out of the former single-file `src/db/schema.ts`; `./index.ts`
 * re-exports every domain, so `@/db/schema` still resolves exactly as before.
 */
import { sql } from "drizzle-orm";
import {
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";

export const periodCloseStatus = pgEnum("period_close_status", [
  "completed",
  "reopened",
]);

export const periodCloses = pgTable(
  "period_closes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The date this close set accounting_settings.closed_through to. */
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    status: periodCloseStatus("status").notNull().default("completed"),
    /**
     * closed_through BEFORE this close — reopen restores exactly this,
     * which also handles closes that predate the period_closes table.
     */
    previousClosedThrough: date("previous_closed_through", { mode: "string" }),
    /** CloseChecklist snapshot recomputed server-side at completion. */
    checklist: jsonb("checklist").notNull(),
    completedByClerkUserId: text("completed_by_clerk_user_id").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reopenedByClerkUserId: text("reopened_by_clerk_user_id"),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    /** Review sign-off (owner or expert). Survives reopen as history. */
    signedOffByClerkUserId: text("signed_off_by_clerk_user_id"),
    signedOffAt: timestamp("signed_off_at", { withTimezone: true }),
    /** AI close narrative: { narrative, highlights, model, at } | null. */
    narrative: jsonb("narrative"),
    narrativeGeneratedAt: timestamp("narrative_generated_at", {
      withTimezone: true,
    }),
    narrativeModel: text("narrative_model"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("period_closes_tenant_id_id_idx").on(t.tenantId, t.id),
    // One LIVE close per period end; reopened rows remain as history.
    uniqueIndex("period_closes_tenant_period_completed_idx")
      .on(t.tenantId, t.periodEnd)
      .where(sql`${t.status} = 'completed'`),
    index("period_closes_tenant_idx").on(t.tenantId),
  ],
);

/** Append-only review dialogue on a close (owner ↔ accountant). */
export const closeNotes = pgTable(
  "close_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    closeId: uuid("close_id").notNull(),
    authorClerkUserId: text("author_clerk_user_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("close_notes_tenant_id_id_idx").on(t.tenantId, t.id),
    index("close_notes_tenant_close_idx").on(t.tenantId, t.closeId),
    foreignKey({
      name: "close_notes_close_fk",
      columns: [t.tenantId, t.closeId],
      foreignColumns: [periodCloses.tenantId, periodCloses.id],
    }).onDelete("cascade"),
  ],
);

/* ------------------------------------------------------------------------
 * Retainer hours — PLATFORM-level concierge-work tracking (like audits /
 * subscriptions, not a tenant module). Written only by superadmin actions
 * and the verified Stripe credit path; tenant members get read-only rows.
 * Balances are DERIVED, never stored: purchased-remaining = Σ purchases −
 * Σ per-month overage, where each month's allotment comes from the
 * retainer_allotments history (past months never rewrite when the
 * allotment changes). All math lives in src/lib/retainer-core.ts.
 * Calendar months are America/New_York.
 * ---------------------------------------------------------------------- */

export type PeriodClose = typeof periodCloses.$inferSelect;

export type CloseNote = typeof closeNotes.$inferSelect;
