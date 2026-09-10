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
import { sql } from "drizzle-orm";

/**
 * `prospect` is RETIRED (back-office slice 3, ADR 0041): a business without a
 * workspace is a party in the operator's CRM, never a tenant row. The value
 * stays because Postgres cannot drop one from an enum; nothing writes it and
 * the console's schema refuses it.
 */
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
 * A WORKSPACE — the unit of data isolation: one Clerk Organization, one set
 * of modules, one subscription, one RLS boundary. Not the relationship: since
 * ADR 0041 a client is a party in the operator tenant's CRM, and
 * `operator_party_id` below is the one pointer from here to there. Until
 * September 2026 this row doubled as the CRM record ("a business in the CRM
 * — the record that spans the whole lifecycle", with `status = 'prospect'`
 * meaning no workspace yet), which was right before the CRM existed and
 * wrong after.
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
    /**
     * Layer 3 vocabulary: this tenant's own words, overriding the installed
     * profile's. `{ "zone": "Paddock", "livestockLot": "Flock" }`.
     *
     * TENANT-WIDE, and that is a correction. These first lived under a `labels`
     * key on each pack's `tenant_modules.config` row, reasoning that renaming a
     * word for one pack should not silently rename it in another. That was
     * backwards: `zone` is `land`'s word that `livestock` also displays, so a
     * per-pack override would have changed one screen and not the other. On a
     * farm a paddock is a paddock everywhere. Moved here 2026-08-15, while
     * there was still no data in the wrong shape to migrate.
     *
     * Which keys mean anything is declared by the features themselves — see
     * `LabelDefinition` in src/lib/packs/resolve.ts. Unknown keys are IGNORED
     * rather than rejected, because a pack being switched off must not make a
     * tenant's saved words invalid.
     *
     * Written only through `withSystem` after `requireTenantOwner`: `tenants`
     * is SELECT-only for members and must stay that way, because RLS is
     * row-level and any member UPDATE policy permissive enough for this would
     * also expose `status` and `clerk_org_id`.
     */
    labels: jsonb("labels").notNull().default({}),
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
    /**
     * What to put in front of money on screen — "$", "£", or null for none.
     *
     * **PLATFORM-LEVEL, for the same reason `timezone` is**: money shown two
     * ways inside one workspace is worse than either way consistently, and a
     * per-module setting guarantees exactly that. See docs/modules/timezone.md
     * for the argument the first time it was made.
     *
     * NULL IS THE DEFAULT AND MEANS NO SYMBOL, which is the house style
     * `formatCents` was written for: it serves debit/credit columns whose
     * headers carry the currency, and a symbol in that grid is noise to a
     * bookkeeper. An industry profile turns it on for tenants who are not
     * reading a ledger all day — a farmer looking at "Fed · 85.00" has no
     * column header to tell him that is money.
     *
     * NOT a currency CODE, and not an exchange rate. This is presentation
     * only: the platform is single-currency and nothing here converts
     * anything. A real multi-currency story needs the amount to carry its
     * currency, which is a different and much larger change.
     */
    currencySymbol: text("currency_symbol"),
    /**
     * THE OPERATOR TENANT — the business that runs the platform, running on
     * it (ADR 0041, docs/modules/back-office.md). At most one per database:
     * the partial unique index below is the constraint. In data rather than an
     * env var so dev and prod each name their own, the isolation suite can
     * mint one, and the deploy sets nothing.
     *
     * Set by scripts/operator-tenant.ts under withSystem, audited, never by a
     * console action — moving it is not a routine act. What it changes is
     * deliberately small: the console refuses its own buttons on this row
     * (src/lib/operator-guard.ts), and the health check will land its leads
     * here (slice 2). To RLS it is an ordinary tenant, and
     * tests/isolation/operator.test.ts is what keeps it that way.
     */
    isOperator: boolean("is_operator").notNull().default(false),
    /**
     * THE ONE POINTER BETWEEN A WORKSPACE AND ITS RELATIONSHIP (ADR 0041,
     * back-office slice 1): the party in the OPERATOR tenant's CRM that this
     * business is. Written once, by the console (`ensureOperatorParty` in
     * src/app/admin/relationship.ts), and by nothing in any module — the CRM
     * never writes `tenants`.
     *
     * A soft pointer, deliberately: `parties` is keyed `(tenant_id, id)` and
     * this crosses tenants by design, so a real FK would need the operator's
     * id inside the platform row. Resolved under the operator's context and
     * null-safe — a party deleted in the CRM leaves a dangling id the console
     * reads as "gone", the `site_enquiries.party_id` precedent.
     */
    operatorPartyId: uuid("operator_party_id"),
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
    // One operator per database, proved by the index rather than by code.
    uniqueIndex("tenants_operator_idx")
      .on(t.isOperator)
      .where(sql`${t.isOperator} = true`),
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
export const pushPlatform = pgEnum("push_platform", ["ios", "android"]);

/**
 * A phone that asked to be told. One row per device token, keyed by the
 * PERSON (Clerk id) and not by tenant: a device belongs to whoever is signed
 * in on it, and a person in two businesses has one phone. The morning digest
 * is per (tenant, person), so that phone gets one notification per business,
 * exactly as it gets one email per business.
 *
 * Not tenant-scoped, like `profiles`. RLS (`drizzle/0262`): superadmin, and
 * otherwise YOUR OWN ROWS ONLY through `app_current_user()` — no tier of
 * membership reaches somebody else's phone, in either direction. The sender
 * runs under `withSystem`; so does registration, because a phone that
 * changes hands is a row the new person cannot see (push-actions.ts).
 *
 * `token` is unique globally: the provider's token identifies the device, and
 * a device that changes hands is re-pointed at the new person by the upsert
 * rather than duplicated. `disabled_at` is set when the provider says the
 * token is dead (uninstalled, expired); the row stays as a record and is
 * skipped. Mobile dossier, ADR 0032.
 */
export const pushDevices = pgTable(
  "push_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    platform: pushPlatform("platform").notNull(),
    token: text("token").notNull(),
    appVersion: text("app_version").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    disabledReason: text("disabled_reason"),
  },
  (t) => [
    uniqueIndex("push_devices_token_idx").on(t.token),
    index("push_devices_user_idx").on(t.clerkUserId),
  ],
);
export type PushDevice = typeof pushDevices.$inferSelect;

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

/**
 * A superadmin's time-boxed, read-only, audited look at a client's workspace
 * as its staff see it (back-office slice 4). Platform-level and
 * superadmin-only: the console opens and ends one, src/lib/auth.ts reads it
 * on every tenant request and honours it for a GET and nothing else. One
 * live session per person, by the partial unique index; opening a new one
 * ends the last. Sixty minutes, then it is not live whether or not anybody
 * ended it.
 */
export const supportSessions = pgTable(
  "support_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    /** Why — typed by the superadmin, shown on the banner, kept for the record. */
    reason: text("reason").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    viewCount: integer("view_count").notNull().default(0),
  },
  (t) => [
    index("support_sessions_user_idx").on(t.clerkUserId, t.expiresAt),
    index("support_sessions_tenant_idx").on(t.tenantId),
    uniqueIndex("support_sessions_live_idx")
      .on(t.clerkUserId)
      .where(sql`${t.endedAt} is null`),
  ],
);

export type SupportSession = typeof supportSessions.$inferSelect;

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
    /**
     * "What has happened to THIS record" — the per-record history panel.
     *
     * Added when that panel was built (2026-08-12), because it is the first
     * read that filters by target rather than by tenant or time. Without it
     * the query scans every audit row the tenant has ever written, which is a
     * table that only grows and is never pruned.
     */
    index("audit_log_target_idx").on(
      t.tenantId,
      t.targetType,
      t.targetId,
      t.createdAt,
    ),
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
 * Discovery engagements (Tier 0 — the sales wedge): the copilot conversation
 * with the founder, and the health check + build spec it produces.
 *
 * A ROW OF THE OPERATOR TENANT since back-office slice 2 (ADR 0041): the
 * business that runs the platform owns the record, and `party_id` names the
 * party it is about. Until 2026-09-09 this was platform-level data with a
 * superadmin-only policy and `tenant_id` meant the tenant the audit was
 * ABOUT — a prospect row minted for a stranger — which `origin_tenant_id`
 * remembers. Scoped like every tenant table now: superadmin_all + member_all
 * (migration 0288).
 */
export const audits = pgTable(
  "audits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The operator tenant. Never the business the record is about. */
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /**
     * The party (in the operator tenant) this discovery is about. Null for a
     * record nothing points at yet — one that moved home before its business
     * had a party; the console attaches it. No FK: `parties` is keyed
     * `(tenant_id, id)`, and a party merged away in the CRM leaves a record
     * to re-attach, not a cascade.
     */
    partyId: uuid("party_id"),
    /**
     * Where a record came from when it moved home: the tenant it was about.
     * Read by `ensureOperatorParty` to attach the record when that business
     * gets its party, and by nothing for access. No FK on purpose — the row
     * it names is one slice 3 deletes.
     */
    originTenantId: uuid("origin_tenant_id"),
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
  (t) => [
    index("audits_status_idx").on(t.status),
    index("audits_tenant_party_idx").on(t.tenantId, t.partyId),
  ],
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


export type AuditEntry = typeof auditLog.$inferSelect;

export type HelloItem = typeof helloItems.$inferSelect;
