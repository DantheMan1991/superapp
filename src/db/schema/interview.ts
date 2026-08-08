/**
 * Anonymous public health-check interview sessions — platform-level data
 * with a superadmin-only RLS policy.
 *
 * Split out of the former single-file `src/db/schema.ts`; `./index.ts`
 * re-exports every domain, so `@/db/schema` still resolves exactly as before.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { audits } from "./platform";

/**
 * Anonymous public health-check interview sessions — the conversation
 * BEFORE it becomes a lead (then promoted to a prospect tenant + audit).
 * The row id doubles as the bearer token the visitor's browser holds
 * (unguessable uuid). Platform-level data: superadmin-only RLS (0022).
 * Never stores a raw IP — ip_hash = sha256(INTERVIEW_IP_SALT + ip).
 */
export const interviewSessions = pgTable(
  "interview_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** zod/CHECK: active | awaiting_contact | completed | expired. */
    state: text("state").notNull().default("active"),
    /** [{role: "user" | "assistant", content}, …] — starts with the opener. */
    messages: jsonb("messages").notNull().default([]),
    /** User turns processed. Server-enforced INTERVIEW_EXCHANGE_CAP. */
    exchangeCount: integer("exchange_count").notNull().default(0),
    ipHash: text("ip_hash").notNull(),
    /** Per-session turn-cooldown claim (ai_last_* pattern). */
    lastTurnAt: timestamp("last_turn_at", { withTimezone: true }),
    /** Public-facing markdown assessment; null until generated (or failed). */
    assessment: text("assessment"),
    /** Set on promotion — the double-submit idempotency anchor. */
    auditId: uuid("audit_id").references(() => audits.id, {
      onDelete: "set null",
    }),
    email: text("email"),
    contactName: text("contact_name"),
    businessName: text("business_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("interview_sessions_ip_created_idx").on(t.ipHash, t.createdAt),
    index("interview_sessions_created_idx").on(t.createdAt),
    uniqueIndex("interview_sessions_audit_idx")
      .on(t.auditId)
      .where(sql`${t.auditId} is not null`),
    check(
      "interview_sessions_state_check",
      sql`${t.state} in ('active', 'awaiting_contact', 'completed', 'expired')`,
    ),
  ],
);

export type InterviewSession = typeof interviewSessions.$inferSelect;

/* ------------------------------------------------------------------------
 * CRM (slice 1). The module's OWN rows, on top of the shared `parties`
 * spine — see the party-spine block above and docs/modules/crm.md.
 *
 * The division: `parties` says who somebody is and is readable by a tenant
 * who never bought CRM; everything here says what CRM knows ABOUT them and
 * disappears cleanly with the module. Nothing in accounting reads these
 * tables, which is what lets CRM be sold separately.
 * ---------------------------------------------------------------------- */
