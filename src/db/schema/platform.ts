/**
 * Tenancy, membership, modules, billing and audit — the shell every
 * other domain hangs off.
 *
 * Split out of the former single-file `src/db/schema.ts`; `./index.ts`
 * re-exports every domain, so `@/db/schema` still resolves exactly as before.
 */
import {
  boolean,
  date,
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

export const tenantStatus = pgEnum("tenant_status", [
  "prospect",
  "onboarding",
  "active",
  "paused",
  "churned",
]);

/**
 * "owner"/"staff" mirror the Clerk org role; "expert" (outside accountant)
 * is a LOCAL overlay set by the tenant owner on the Team page — any writer
 * of memberships.role must preserve an existing "expert" value (see
 * upsertMembership in tenant-sync.ts).
 *
 * "owner" is a PRIVILEGED value: background jobs read it to decide whose
 * behalf they may act on, so tenant context may never write it. RLS enforces
 * that (drizzle/0085) — a withTenant transaction can only move a row between
 * staff and expert, and cannot touch an owner row at all. Only withSystem
 * (the Clerk webhook and membership-sync's reconcile) mints or clears one.
 */
export const membershipRole = pgEnum("membership_role", [
  "owner",
  "staff",
  "expert",
]);

/**
 * Whether this person wants the daily digest.
 *
 * `off` must exist and must be honoured. A digest that cannot be turned off
 * gets filtered instead, which is strictly worse: the person stops reading it
 * AND we stop knowing they stopped. Two values on purpose — a frequency picker
 * invites "weekly", and a weekly list of things that were urgent on Tuesday is
 * not a digest, it is a backlog.
 */
export const digestPreference = pgEnum("digest_preference", ["daily", "off"]);

export const moduleStatus = pgEnum("module_status", [
  "available",
  "coming_soon",
]);

/**
 * A business in the CRM — the record that spans the whole lifecycle.
 * status "prospect" + null clerkOrgId = CRM-only (discovery stage);
 * converting to a client attaches a Clerk Organization to the SAME row,
 * which is what makes it a tenant (the unit of data isolation).
 */
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null while the business is a prospect with no platform workspace. */
    clerkOrgId: text("clerk_org_id"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    industry: text("industry").notNull().default("general"),
    status: tenantStatus("status").notNull().default("onboarding"),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    /**
     * The business's clock. IANA zone name — the single answer to "what day is
     * it here", for every module and for code running with no request behind it.
     *
     * Platform-level rather than per-module because "is this overdue" is one
     * question with one answer: an invoice due today and a task due today must
     * agree, and a digest that says 4 things are due cannot disagree with the
     * page that says 3. Accounting held the only timezone in the system
     * (`accounting_settings.bookkeeping_timezone`) and CRM could not read it
     * without importing another module's table — see docs/modules/timezone.md.
     *
     * Per-USER timezones are deliberately not a thing. A person's preferred
     * send time is separable from what day the business is having.
     */
    timezone: text("timezone").notNull().default("America/New_York"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("tenants_clerk_org_id_idx").on(t.clerkOrgId),
    uniqueIndex("tenants_slug_idx").on(t.slug),
  ],
);

/** A person. Maps 1:1 to a Clerk user; synced via webhook. */
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    email: text("email").notNull(),
    name: text("name"),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("profiles_clerk_user_id_idx").on(t.clerkUserId)],
);

/** Who belongs to which tenant, with what role. Synced from Clerk org memberships. */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull().default("staff"),
    /**
     * When this row's Clerk-derived role was last confirmed against Clerk —
     * by the membership webhook or by reconcileTenantMemberships().
     *
     * Exists because a background job cannot ask Clerk who it is acting as.
     * Storing the role is not enough: a dropped demotion webhook leaves a row
     * that says "owner" forever, and a job that trusted it would read
     * owners-only data on behalf of somebody who no longer has it. This lets a
     * job require recency and degrade to staff when the row is stale, which
     * keeps the S6 direction (down, never up).
     *
     * Nullable: rows written before this column existed have never been
     * confirmed, and NULL says exactly that rather than implying a sync.
     */
    clerkRoleSyncedAt: timestamp("clerk_role_synced_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_tenant_profile_idx").on(t.tenantId, t.profileId),
    index("memberships_tenant_idx").on(t.tenantId),
  ],
);

/**
 * What one person wants to be told, in one workspace.
 *
 * A TABLE RATHER THAN A COLUMN ON `memberships`, for a reason that is entirely
 * about RLS. `drizzle/0085` deliberately made owner rows unwritable from tenant
 * context so a background job could trust `memberships.role`; a preference
 * living there would inherit that and owners could never turn their own digest
 * off, forcing a `withSystem` write into a user-facing action just to change a
 * boolean about email.
 *
 * Here the rule the product actually wants — "you may set YOUR OWN preference
 * and nobody else's" — is expressible as a policy (`drizzle/0090`, the shape
 * `mail_accounts` uses), so it is enforced by Postgres instead of by whichever
 * server action remembers to check. That is the trade the security doc asks
 * for: structurally hard rather than merely unlikely.
 *
 * A missing row means `daily`. The default lives in the read, not in a
 * backfill, so nobody has to be inserted before they can be mailed.
 */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    digest: digestPreference("digest").notNull().default("daily"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("notification_preferences_person_idx").on(
      t.tenantId,
      t.profileId,
    ),
  ],
);

/**
 * One row per person per day the digest was sent for.
 *
 * TWO JOBS, and the second is why this is a table rather than a timestamp:
 *
 *  1. **Idempotency.** The cron runs hourly and asks each tenant whether it is
 *     7am there. Overlapping invocations, a redeploy mid-run, or a retry must
 *     not mail somebody twice — the unique index below is what makes the second
 *     attempt a no-op. (`outbound_emails.idempotency_key` is a second net under
 *     this one; this table is what lets the cron skip the WORK, not just the
 *     send.)
 *
 *  2. **The delta.** The design's rule for surviving to day 30 is to lead with
 *     what CHANGED — "2 new since yesterday, 3 still waiting" — rather than
 *     re-listing an identical set every morning until it becomes wallpaper.
 *     That needs yesterday's item keys to compare against, which is the one
 *     thing a bare "last sent at" column cannot provide.
 *
 * `item_keys` holds identifiers only (`crm_task:<uuid>`, `invoice:<uuid>`) —
 * never a title, which would carry a customer's name into a platform table
 * (S9). The count is stored alongside rather than derived so a future change to
 * what gets logged cannot silently rewrite history.
 */
export const notificationDigestLog = pgTable(
  "notification_digest_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /**
     * The date IN THE TENANT'S TIMEZONE that this digest was for — not the UTC
     * date it happened to be sent on. Those differ for most of the world at
     * 7am, and keying on the wrong one would let somebody be mailed twice
     * across a midnight boundary.
     */
    localDate: date("local_date", { mode: "string" }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    itemCount: integer("item_count").notNull().default(0),
    /** Identifiers only — see the table comment. */
    itemKeys: jsonb("item_keys").notNull().default([]),
  },
  (t) => [
    // THE idempotency guarantee. Two concurrent cron invocations serialize
    // here rather than both sending.
    uniqueIndex("notification_digest_log_person_day_idx").on(
      t.tenantId,
      t.profileId,
      t.localDate,
    ),
    index("notification_digest_log_tenant_idx").on(t.tenantId, t.localDate),
  ],
);

/** Global registry of togglable modules. Not tenant data. */
export const modules = pgTable("modules", {
  id: text("id").primaryKey(), // slug, e.g. "hello", "accounting"
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default("core"),
  status: moduleStatus("status").notNull().default("coming_soon"),
  sortOrder: integer("sort_order").notNull().default(100),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Which modules are switched on for which tenant. */
export const tenantModules = pgTable(
  "tenant_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    moduleId: text("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    config: jsonb("config").notNull().default({}),
    enabledAt: timestamp("enabled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("tenant_modules_tenant_module_idx").on(t.tenantId, t.moduleId),
    index("tenant_modules_tenant_idx").on(t.tenantId),
  ],
);

/** Stripe billing state for a tenant. Synced by webhook only. */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status").notNull().default("none"), // none | active | trialing | past_due | canceled | incomplete
    planName: text("plan_name"),
    priceId: text("price_id"),
    /** Monthly recurring amount in cents, synced from Stripe. Powers MRR. */
    amountCents: integer("amount_cents"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("subscriptions_tenant_idx").on(t.tenantId),
    index("subscriptions_customer_idx").on(t.stripeCustomerId),
  ],
);

/** Admin CRM notes about a client. Super-admin eyes only (enforced by RLS). */
export const tenantNotes = pgTable(
  "tenant_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    authorClerkUserId: text("author_clerk_user_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("tenant_notes_tenant_idx").on(t.tenantId)],
);

/** Append-only log of sensitive actions. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, {
      onDelete: "set null",
    }),
    actorClerkUserId: text("actor_clerk_user_id"),
    actorLabel: text("actor_label"),
    action: text("action").notNull(), // e.g. "module.enabled", "admin.viewed_tenant"
    targetType: text("target_type"),
    targetId: text("target_id"),
    meta: jsonb("meta").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_log_tenant_idx").on(t.tenantId),
    index("audit_log_created_idx").on(t.createdAt),
  ],
);

/**
 * Data for the "Hello Module" stub — exists purely to certify that module
 * activation, tenant scoping, and permissions work end to end.
 */
export const helloItems = pgTable(
  "hello_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("hello_items_tenant_idx").on(t.tenantId)],
);

export const auditStatus = pgEnum("audit_status", [
  "open",
  "report_ready",
  "won",
  "lost",
]);

/**
 * Discovery/audit engagements with prospects (Tier 0 — the sales wedge).
 * Prospects are not tenants yet, so this is platform-level data:
 * RLS restricts it to the superadmin context only.
 */
export const audits = pgTable(
  "audits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The CRM record this engagement belongs to. Always set by the app. */
    tenantId: uuid("tenant_id").references(() => tenants.id, {
      onDelete: "cascade",
    }),
    businessName: text("business_name").notNull(),
    industry: text("industry").notNull().default("general"),
    contactName: text("contact_name"),
    status: auditStatus("status").notNull().default("open"),
    /** Who initiated: "founder" (admin console) | "self_serve" (public health check). */
    source: text("source").notNull().default("founder"),
    /** What we knew going in — intake notes, referral context. */
    context: text("context").notNull().default(""),
    /** Conversation with the discovery copilot: [{role, content}, …] */
    messages: jsonb("messages").notNull().default([]),
    /** Generated deliverable: health check + build spec, markdown. */
    report: text("report"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("audits_status_idx").on(t.status)],
);

/* ------------------------------------------------------------------------
 * Accounting module — Core Ledger Platform (Phase 2, session 1).
 *
 * Conventions specific to these tables:
 * - Money is bigint cents; amounts on journal lines are SIGNED
 *   (positive = debit, negative = credit). Every non-draft entry must sum
 *   to zero — enforced by a deferrable constraint trigger in
 *   drizzle/0008_accounting_rls_triggers.sql, not only by app code.
 * - Bookkeeping dates are `date` columns (mode: "string"), never
 *   timestamps — a ledger day has no timezone.
 * - Composite tenant keys: parents expose UNIQUE (tenant_id, id) and child
 *   FKs include tenant_id, so the database itself proves an entry, its
 *   lines, its accounts, and its dimensions all belong to one tenant.
 * - Self/cross references that must survive whole-tenant cascade deletes
 *   use the default NO ACTION (checked at end of statement), not RESTRICT
 *   (checked immediately, which would abort the cascade mid-flight).
 * ---------------------------------------------------------------------- */

export type Audit = typeof audits.$inferSelect;

export type AuditMessage = { role: "user" | "assistant"; content: string };

export type Tenant = typeof tenants.$inferSelect;

export type Profile = typeof profiles.$inferSelect;

export type Membership = typeof memberships.$inferSelect;

export type NotificationDigestLog = typeof notificationDigestLog.$inferSelect;

export type NotificationPreference =
  typeof notificationPreferences.$inferSelect;

export type Module = typeof modules.$inferSelect;

export type TenantModule = typeof tenantModules.$inferSelect;

export type Subscription = typeof subscriptions.$inferSelect;

export type TenantNote = typeof tenantNotes.$inferSelect;

export type AuditEntry = typeof auditLog.$inferSelect;

export type HelloItem = typeof helloItems.$inferSelect;
