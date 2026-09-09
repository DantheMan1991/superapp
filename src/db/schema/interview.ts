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
import { audits, tenants } from "./platform";

/**
 * The SETUP interview — the health check turned inward (ADR 0040).
 *
 * Same conversation machinery, opposite side of the sale: this one runs
 * inside a tenant, for somebody who has already signed up, and produces a
 * PLAN for setting their business up rather than an assessment written to
 * win them. So it is tenant-scoped where `interview_sessions` is
 * platform-level, and it carries no IP hash — the person is signed in.
 *
 * ONE ACTIVE PER TENANT, by partial unique index. A second half-finished
 * conversation about the same business is two answers to "when do your books
 * begin", and the plan is the thing that has to be single.
 */
export const setupInterviews = pgTable(
  "setup_interviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** zod/CHECK: active | done. */
    state: text("state").notNull().default("active"),
    /** [{role: "user" | "assistant", content}, …] — starts with the opener. */
    messages: jsonb("messages").notNull().default([]),
    /** User turns processed. Server-enforced cap. */
    exchangeCount: integer("exchange_count").notNull().default(0),
    /** Per-session turn-cooldown claim (the `ai_last_*` pattern). */
    lastTurnAt: timestamp("last_turn_at", { withTimezone: true }),
    /**
     * `{ summary, steps: [{ title, why, href, guide }] }`, or null until the
     * conversation ends. WRITTEN, not derived: the Getting set up card
     * already says what is MISSING, and this says what to do about it for
     * this business, in an order somebody agreed to.
     */
    plan: jsonb("plan"),
    /** Who walked it. Identifiers only. */
    startedByClerkUserId: text("started_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("setup_interviews_tenant_id_idx").on(t.tenantId, t.id),
    index("setup_interviews_tenant_created_idx").on(t.tenantId, t.createdAt),
    uniqueIndex("setup_interviews_one_active_idx")
      .on(t.tenantId)
      .where(sql`${t.state} = 'active'`),
    check(
      "setup_interviews_state_check",
      sql`${t.state} in ('active', 'done')`,
    ),
  ],
);

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
