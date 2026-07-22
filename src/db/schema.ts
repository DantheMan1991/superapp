import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
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

/**
 * Layer 0 schema — platform shell only.
 * Every tenant-scoped table carries tenant_id and is protected by Postgres
 * Row-Level Security (see drizzle/0001_rls.sql). App code must additionally
 * scope every query — defense in depth, neither layer is trusted alone.
 */

export const tenantStatus = pgEnum("tenant_status", [
  "prospect",
  "onboarding",
  "active",
  "paused",
  "churned",
]);

export const membershipRole = pgEnum("membership_role", [
  "owner",
  "staff",
  "expert",
]);

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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_tenant_profile_idx").on(t.tenantId, t.profileId),
    index("memberships_tenant_idx").on(t.tenantId),
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

export const accountType = pgEnum("account_type", [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
]);

export const journalEntryStatus = pgEnum("journal_entry_status", [
  "draft",
  "posted",
  "void",
]);

export const journalEntrySource = pgEnum("journal_entry_source", [
  "manual",
  "invoice",
  "invoice_payment",
  "bill",
  "bill_payment",
  "bank_import",
  "opening_balance",
  "recurring",
  "reversal",
]);

export const entryEditPolicy = pgEnum("entry_edit_policy", [
  "standard",
  "strict_append_only",
]);

/** Chart of accounts. Never hard-deleted once referenced — deactivate instead. */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    accountType: accountType("account_type").notNull(),
    /** QB "detail type" analog. Text (not enum) so industry packs can add slugs. */
    subtype: text("subtype").notNull().default("other"),
    parentId: uuid("parent_id"),
    description: text("description").notNull().default(""),
    isActive: boolean("is_active").notNull().default(true),
    /** AR/AP/Opening Balance Equity/Retained Earnings — protected from edit. */
    isSystem: boolean("is_system").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("accounts_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("accounts_tenant_code_idx").on(t.tenantId, t.code),
    index("accounts_tenant_idx").on(t.tenantId),
    index("accounts_tenant_type_idx").on(t.tenantId, t.accountType),
    foreignKey({
      name: "accounts_parent_fk",
      columns: [t.tenantId, t.parentId],
      foreignColumns: [t.tenantId, t.id],
    }),
  ],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The bookkeeping day (no timezone). ISO string, compared lexically. */
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    memo: text("memo").notNull().default(""),
    status: journalEntryStatus("status").notNull().default("draft"),
    source: journalEntrySource("source").notNull().default("manual"),
    /** Soft back-pointer to the source document (invoice, bank txn, …). */
    sourceId: uuid("source_id"),
    idempotencyKey: text("idempotency_key"),
    reversesEntryId: uuid("reverses_entry_id"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    /** Optimistic concurrency: compare-and-increment on every mutation. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("journal_entries_tenant_id_id_idx").on(t.tenantId, t.id),
    index("journal_entries_tenant_date_idx").on(t.tenantId, t.entryDate),
    index("journal_entries_tenant_status_idx").on(t.tenantId, t.status),
    uniqueIndex("journal_entries_tenant_idem_idx")
      .on(t.tenantId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    // An entry can be reversed at most once — a DB rule, not a convention.
    uniqueIndex("journal_entries_tenant_reverses_idx")
      .on(t.tenantId, t.reversesEntryId)
      .where(sql`${t.reversesEntryId} is not null`),
    foreignKey({
      name: "journal_entries_reverses_fk",
      columns: [t.tenantId, t.reversesEntryId],
      foreignColumns: [t.tenantId, t.id],
    }),
  ],
);

export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Denormalized on purpose: required by the RLS policy shape and lets
     * reports aggregate without joining entries. Composite FKs below keep
     * it consistent with the parent entry and account. */
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id").notNull(),
    accountId: uuid("account_id").notNull(),
    /** Signed: positive = debit, negative = credit. Never zero. */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    memo: text("memo").notNull().default(""),
    lineNo: integer("line_no").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("journal_lines_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("journal_lines_entry_line_no_idx").on(
      t.tenantId,
      t.entryId,
      t.lineNo,
    ),
    index("journal_lines_tenant_account_idx").on(t.tenantId, t.accountId),
    index("journal_lines_tenant_entry_idx").on(t.tenantId, t.entryId),
    foreignKey({
      name: "journal_lines_entry_fk",
      columns: [t.tenantId, t.entryId],
      foreignColumns: [journalEntries.tenantId, journalEntries.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "journal_lines_account_fk",
      columns: [t.tenantId, t.accountId],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
    check("journal_lines_amount_nonzero", sql`${t.amountCents} <> 0`),
  ],
);

/**
 * Core registry of reportable dimension values (property, job, cost code…).
 * Industry packs sync their entities into this table in the same
 * transaction as their own CRUD; the core never imports pack tables.
 */
export const dimensionMembers = pgTable(
  "dimension_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    dimensionType: text("dimension_type").notNull(),
    /** The pack-side entity row this member mirrors. */
    packEntityId: uuid("pack_entity_id").notNull(),
    displayName: text("display_name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("dimension_members_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("dimension_members_tenant_type_entity_idx").on(
      t.tenantId,
      t.dimensionType,
      t.packEntityId,
    ),
    // Target for the typed FK from line_dimensions: proves member type.
    uniqueIndex("dimension_members_tenant_type_id_idx").on(
      t.tenantId,
      t.dimensionType,
      t.id,
    ),
    index("dimension_members_tenant_idx").on(t.tenantId),
  ],
);

/**
 * Tags a journal line with one dimension member per dimension type.
 * dimension_type is denormalized so both rules are DB-enforced:
 * one-per-type-per-line (unique below) and member-is-of-stated-type
 * (typed composite FK below).
 */
export const lineDimensions = pgTable(
  "line_dimensions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    journalLineId: uuid("journal_line_id").notNull(),
    dimensionType: text("dimension_type").notNull(),
    memberId: uuid("member_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("line_dimensions_line_type_idx").on(
      t.tenantId,
      t.journalLineId,
      t.dimensionType,
    ),
    index("line_dimensions_tenant_member_idx").on(t.tenantId, t.memberId),
    foreignKey({
      name: "line_dimensions_line_fk",
      columns: [t.tenantId, t.journalLineId],
      foreignColumns: [journalLines.tenantId, journalLines.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "line_dimensions_member_fk",
      columns: [t.tenantId, t.dimensionType, t.memberId],
      foreignColumns: [
        dimensionMembers.tenantId,
        dimensionMembers.dimensionType,
        dimensionMembers.id,
      ],
    }),
  ],
);

/** One row per tenant with the accounting module enabled. */
export const accountingSettings = pgTable(
  "accounting_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Entries dated on or before this are locked (reversal-only). */
    closedThrough: date("closed_through", { mode: "string" }),
    coaTemplate: text("coa_template").notNull().default("general"),
    fiscalYearStartMonth: integer("fiscal_year_start_month")
      .notNull()
      .default(1),
    entryEditPolicy: entryEditPolicy("entry_edit_policy")
      .notNull()
      .default("standard"),
    /** Defines "today" and period cutoffs — the server TZ never decides. */
    bookkeepingTimezone: text("bookkeeping_timezone")
      .notNull()
      .default("America/New_York"),
    /** AI-suggestion cooldown marker (30s between batches per tenant). */
    aiLastSuggestedAt: timestamp("ai_last_suggested_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("accounting_settings_tenant_idx").on(t.tenantId)],
);

/* ------------------------------------------------------------------------
 * Banking (session 3): staging registers over the ledger. Both feeds —
 * CSV import and Plaid sync — land in bank_transactions; categorizing a
 * row posts a journal entry through the core engine. Reconciliation
 * clears LEDGER LINES (manual entries too), not just imported rows.
 * ---------------------------------------------------------------------- */

export const bankAccountKind = pgEnum("bank_account_kind", [
  "checking",
  "savings",
  "credit_card",
]);

export const bankTransactionSource = pgEnum("bank_transaction_source", [
  "csv",
  "plaid",
]);

export const bankTransactionStatus = pgEnum("bank_transaction_status", [
  "unreviewed",
  "posted",
  "excluded",
]);

export const reconciliationStatus = pgEnum("reconciliation_status", [
  "in_progress",
  "completed",
]);

export const plaidItemStatus = pgEnum("plaid_item_status", [
  "active",
  "error",
]);

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The ledger account this register clears. 1:1 (unique below). */
    accountId: uuid("account_id").notNull(),
    name: text("name").notNull(),
    kind: bankAccountKind("kind").notNull(),
    institution: text("institution").notNull().default(""),
    /** Data minimization: last 4 digits only, never full numbers. */
    last4: text("last4").notNull().default(""),
    /** Plaid linkage (Plaid's own string ids). Null = CSV-only account. */
    plaidItemId: text("plaid_item_id"),
    plaidAccountId: text("plaid_account_id"),
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
    uniqueIndex("bank_accounts_tenant_id_id_idx").on(t.tenantId, t.id),
    // One register per ledger account — reconciliation math depends on it.
    uniqueIndex("bank_accounts_tenant_account_idx").on(t.tenantId, t.accountId),
    index("bank_accounts_tenant_idx").on(t.tenantId),
    foreignKey({
      name: "bank_accounts_account_fk",
      columns: [t.tenantId, t.accountId],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
    check("bank_accounts_last4_digits", sql`${t.last4} ~ '^[0-9]{0,4}$'`),
  ],
);

export const bankTransactions = pgTable(
  "bank_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    bankAccountId: uuid("bank_account_id").notNull(),
    txnDate: date("txn_date", { mode: "string" }).notNull(),
    description: text("description").notNull().default(""),
    /** Signed cents, account-holder perspective: positive = money in. */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    /** Dedup key: sha256 for CSV rows, Plaid transaction_id for synced. */
    externalHash: text("external_hash").notNull(),
    source: bankTransactionSource("source").notNull().default("csv"),
    status: bankTransactionStatus("status").notNull().default("unreviewed"),
    /** Set when categorized; reset by voidPostedEntry (app-side unlink —
     * FK is NO ACTION: SET NULL on a composite FK would null tenant_id). */
    journalEntryId: uuid("journal_entry_id"),
    /** {accountId, accountCode, confidence, reason?, model, at} | null. */
    aiSuggestion: jsonb("ai_suggestion"),
    /** Original parsed CSV row / trimmed Plaid payload — provenance. */
    raw: jsonb("raw").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("bank_transactions_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("bank_transactions_dedup_idx").on(
      t.tenantId,
      t.bankAccountId,
      t.externalHash,
    ),
    index("bank_transactions_tenant_acct_status_idx").on(
      t.tenantId,
      t.bankAccountId,
      t.status,
    ),
    index("bank_transactions_tenant_acct_date_idx").on(
      t.tenantId,
      t.bankAccountId,
      t.txnDate,
    ),
    uniqueIndex("bank_transactions_tenant_entry_idx")
      .on(t.tenantId, t.journalEntryId)
      .where(sql`${t.journalEntryId} is not null`),
    foreignKey({
      name: "bank_transactions_bank_account_fk",
      columns: [t.tenantId, t.bankAccountId],
      foreignColumns: [bankAccounts.tenantId, bankAccounts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "bank_transactions_entry_fk",
      columns: [t.tenantId, t.journalEntryId],
      foreignColumns: [journalEntries.tenantId, journalEntries.id],
    }),
  ],
);

export const reconciliations = pgTable(
  "reconciliations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    bankAccountId: uuid("bank_account_id").notNull(),
    statementEndDate: date("statement_end_date", { mode: "string" }).notNull(),
    /** As printed on the statement (credit cards: positive = owed). */
    statementEndBalanceCents: bigint("statement_end_balance_cents", {
      mode: "number",
    }).notNull(),
    status: reconciliationStatus("status").notNull().default("in_progress"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("reconciliations_tenant_id_id_idx").on(t.tenantId, t.id),
    // One active reconciliation per bank account — a DB rule.
    uniqueIndex("reconciliations_one_active_idx")
      .on(t.tenantId, t.bankAccountId)
      .where(sql`${t.status} = 'in_progress'`),
    index("reconciliations_tenant_acct_idx").on(t.tenantId, t.bankAccountId),
    foreignKey({
      name: "reconciliations_bank_account_fk",
      columns: [t.tenantId, t.bankAccountId],
      foreignColumns: [bankAccounts.tenantId, bankAccounts.id],
    }).onDelete("cascade"),
  ],
);

/**
 * A cleared ledger line. The NO ACTION FK to journal_lines is the DB
 * backstop for reconciled immutability: deleting a cleared line (or
 * cascading its entry's deletion) fails at end of statement, while
 * whole-tenant cascades still pass (these rows delete in the same
 * statement).
 */
export const reconciliationLines = pgTable(
  "reconciliation_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    reconciliationId: uuid("reconciliation_id").notNull(),
    journalLineId: uuid("journal_line_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // A journal line clears at most once, ever.
    uniqueIndex("reconciliation_lines_tenant_line_idx").on(
      t.tenantId,
      t.journalLineId,
    ),
    index("reconciliation_lines_tenant_recon_idx").on(
      t.tenantId,
      t.reconciliationId,
    ),
    foreignKey({
      name: "reconciliation_lines_recon_fk",
      columns: [t.tenantId, t.reconciliationId],
      foreignColumns: [reconciliations.tenantId, reconciliations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "reconciliation_lines_line_fk",
      columns: [t.tenantId, t.journalLineId],
      foreignColumns: [journalLines.tenantId, journalLines.id],
    }),
  ],
);

/**
 * One Plaid Item per institution login. The access token is stored
 * ENCRYPTED (AES-256-GCM via src/lib/crypto.ts) — never plaintext at
 * rest, never in logs or audit rows. Plaid holds the bank credentials;
 * this platform never sees them.
 */
export const plaidItems = pgTable(
  "plaid_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Plaid's item id (string). */
    plaidItemId: text("plaid_item_id").notNull(),
    accessTokenEnc: text("access_token_enc").notNull(),
    institutionName: text("institution_name").notNull().default(""),
    /** /transactions/sync cursor; null = never synced. */
    syncCursor: text("sync_cursor"),
    status: plaidItemStatus("status").notNull().default("active"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("plaid_items_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("plaid_items_tenant_item_idx").on(t.tenantId, t.plaidItemId),
    index("plaid_items_tenant_idx").on(t.tenantId),
  ],
);

export type Audit = typeof audits.$inferSelect;
export type AuditMessage = { role: "user" | "assistant"; content: string };

export type Tenant = typeof tenants.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Module = typeof modules.$inferSelect;
export type TenantModule = typeof tenantModules.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type TenantNote = typeof tenantNotes.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type HelloItem = typeof helloItems.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type JournalLine = typeof journalLines.$inferSelect;
export type DimensionMember = typeof dimensionMembers.$inferSelect;
export type LineDimension = typeof lineDimensions.$inferSelect;
export type AccountingSettings = typeof accountingSettings.$inferSelect;
export type BankAccount = typeof bankAccounts.$inferSelect;
export type BankTransaction = typeof bankTransactions.$inferSelect;
export type Reconciliation = typeof reconciliations.$inferSelect;
export type ReconciliationLine = typeof reconciliationLines.$inferSelect;
export type PlaidItem = typeof plaidItems.$inferSelect;
