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
  numeric,
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

/**
 * "owner"/"staff" mirror the Clerk org role; "expert" (outside accountant)
 * is a LOCAL overlay set by the tenant owner on the Team page — any writer
 * of memberships.role must preserve an existing "expert" value (see
 * upsertMembership in tenant-sync.ts).
 */
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

/* ------------------------------------------------------------------------
 * Invoicing / AR (session 4). The tenant's OWN customers (the platform
 * `tenants` table is the founder's CRM — unrelated). Invoices carry an
 * explicit state machine; `partial`/`paid` are derived from payments,
 * never set directly. Issuance posts Dr AR / Cr income through the core
 * engine; payments post Dr deposit / Cr AR.
 * ---------------------------------------------------------------------- */

export const invoiceStatus = pgEnum("invoice_status", [
  "draft",
  "issued",
  "partial",
  "paid",
  "void",
]);

export const recurringFrequency = pgEnum("recurring_frequency", ["monthly"]);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    address: text("address").notNull().default(""),
    notes: text("notes").notNull().default(""),
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
    uniqueIndex("customers_tenant_id_id_idx").on(t.tenantId, t.id),
    index("customers_tenant_idx").on(t.tenantId),
  ],
);

/**
 * Recurring invoice templates (the rent-roll seam). The template is jsonb
 * — zod-validated at write AND re-validated at generation time (accounts
 * and dimension members may have deactivated since; generation skips
 * invalid templates with a report instead of failing the run).
 */
export const recurringInvoices = pgTable(
  "recurring_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull(),
    name: text("name").notNull(),
    /** {lines: [{description, quantity, unitPriceCents, incomeAccountId,
     * dimensionMemberIds?}], memo, dueInDays} */
    template: jsonb("template").notNull(),
    frequency: recurringFrequency("frequency").notNull().default("monthly"),
    dayOfMonth: integer("day_of_month").notNull(),
    nextRunDate: date("next_run_date", { mode: "string" }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastGeneratedAt: timestamp("last_generated_at", { withTimezone: true }),
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
    uniqueIndex("recurring_invoices_tenant_id_id_idx").on(t.tenantId, t.id),
    index("recurring_invoices_tenant_next_idx")
      .on(t.tenantId, t.nextRunDate)
      .where(sql`${t.isActive} = true`),
    foreignKey({
      name: "recurring_invoices_customer_fk",
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    // 1–28 keeps month advancement a total function (no clamping logic).
    check(
      "recurring_invoices_day_of_month",
      sql`${t.dayOfMonth} between 1 and 28`,
    ),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    status: invoiceStatus("status").notNull().default("draft"),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }),
    memo: text("memo").notNull().default(""),
    /** Denormalized Σ line amounts; recomputed in the same tx as line writes. */
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    /** The issuance entry. Null while draft; survives void (audit trail). */
    journalEntryId: uuid("journal_entry_id"),
    recurringInvoiceId: uuid("recurring_invoice_id"),
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
    uniqueIndex("invoices_tenant_id_id_idx").on(t.tenantId, t.id),
    // The numbering race arbiter.
    uniqueIndex("invoices_tenant_number_idx").on(t.tenantId, t.invoiceNumber),
    index("invoices_tenant_status_idx").on(t.tenantId, t.status),
    index("invoices_tenant_customer_idx").on(t.tenantId, t.customerId),
    // One invoice per issuance entry — mirrors bank_transactions.
    uniqueIndex("invoices_tenant_entry_idx")
      .on(t.tenantId, t.journalEntryId)
      .where(sql`${t.journalEntryId} is not null`),
    foreignKey({
      name: "invoices_customer_fk",
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    foreignKey({
      name: "invoices_entry_fk",
      columns: [t.tenantId, t.journalEntryId],
      foreignColumns: [journalEntries.tenantId, journalEntries.id],
    }),
    foreignKey({
      name: "invoices_recurring_fk",
      columns: [t.tenantId, t.recurringInvoiceId],
      foreignColumns: [recurringInvoices.tenantId, recurringInvoices.id],
    }),
    check("invoices_total_nonnegative", sql`${t.totalCents} >= 0`),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull(),
    lineNo: integer("line_no").notNull().default(0),
    description: text("description").notNull().default(""),
    /** 2dp quantity; drizzle numeric arrives as string — parse via lib only. */
    quantity: numeric("quantity", { precision: 12, scale: 2 })
      .notNull()
      .default("1"),
    /** Signed: negative = discount line (posts Dr income). */
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
    /** App-computed round(quantity × unitPrice); 0 = posts nothing. */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    incomeAccountId: uuid("income_account_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("invoice_lines_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("invoice_lines_invoice_line_no_idx").on(
      t.tenantId,
      t.invoiceId,
      t.lineNo,
    ),
    index("invoice_lines_tenant_invoice_idx").on(t.tenantId, t.invoiceId),
    foreignKey({
      name: "invoice_lines_invoice_fk",
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "invoice_lines_income_account_fk",
      columns: [t.tenantId, t.incomeAccountId],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
    check("invoice_lines_quantity_positive", sql`${t.quantity} > 0`),
  ],
);

export const invoicePayments = pgTable(
  "invoice_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull(),
    paymentDate: date("payment_date", { mode: "string" }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    /** Where the money landed: a bank register's ledger account or 1250. */
    depositAccountId: uuid("deposit_account_id").notNull(),
    /** zod enum: cash | check | card | bank_transfer | other. */
    method: text("method").notNull().default("other"),
    memo: text("memo").notNull().default(""),
    /** Created atomically with its entry — NOT NULL by design. */
    journalEntryId: uuid("journal_entry_id").notNull(),
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
    uniqueIndex("invoice_payments_tenant_id_id_idx").on(t.tenantId, t.id),
    index("invoice_payments_tenant_invoice_idx").on(t.tenantId, t.invoiceId),
    // One payment row per entry — DB rule.
    uniqueIndex("invoice_payments_tenant_entry_idx").on(
      t.tenantId,
      t.journalEntryId,
    ),
    // NO ACTION: an invoice with payments can never be deleted (drafts
    // have none, so draft-delete passes).
    foreignKey({
      name: "invoice_payments_invoice_fk",
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    foreignKey({
      name: "invoice_payments_deposit_account_fk",
      columns: [t.tenantId, t.depositAccountId],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
    foreignKey({
      name: "invoice_payments_entry_fk",
      columns: [t.tenantId, t.journalEntryId],
      foreignColumns: [journalEntries.tenantId, journalEntries.id],
    }),
    check("invoice_payments_amount_positive", sql`${t.amountCents} > 0`),
  ],
);

/**
 * Tags a journal line OR an invoice line with one dimension member per
 * dimension type. Exactly one parent is set (CHECK below); invoice-line
 * dimensions are copied onto journal lines at issuance, so reports only
 * ever read the journal side. dimension_type is denormalized so both
 * rules are DB-enforced: one-per-type-per-line and
 * member-is-of-stated-type (typed composite FK).
 */
export const lineDimensions = pgTable(
  "line_dimensions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    journalLineId: uuid("journal_line_id"),
    invoiceLineId: uuid("invoice_line_id"),
    /** Session 6's planned additive parent. */
    billLineId: uuid("bill_line_id"),
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
    uniqueIndex("line_dimensions_invoice_line_type_idx")
      .on(t.tenantId, t.invoiceLineId, t.dimensionType)
      .where(sql`${t.invoiceLineId} is not null`),
    uniqueIndex("line_dimensions_bill_line_type_idx")
      .on(t.tenantId, t.billLineId, t.dimensionType)
      .where(sql`${t.billLineId} is not null`),
    index("line_dimensions_tenant_member_idx").on(t.tenantId, t.memberId),
    foreignKey({
      name: "line_dimensions_line_fk",
      columns: [t.tenantId, t.journalLineId],
      foreignColumns: [journalLines.tenantId, journalLines.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "line_dimensions_invoice_line_fk",
      columns: [t.tenantId, t.invoiceLineId],
      foreignColumns: [invoiceLines.tenantId, invoiceLines.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "line_dimensions_bill_line_fk",
      columns: [t.tenantId, t.billLineId],
      foreignColumns: [billLines.tenantId, billLines.id],
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
    check(
      "line_dimensions_one_parent",
      sql`num_nonnulls(${t.journalLineId}, ${t.invoiceLineId}, ${t.billLineId}) = 1`,
    ),
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
    /**
     * Email-in routing key: receipts-{token}@{INBOUND_EMAIL_DOMAIN}.
     * Effectively a bearer token (safe because nothing auto-posts);
     * owner-regenerable. Null = email-in disabled.
     */
    inboundEmailToken: text("inbound_email_token"),
    /** AI-extraction cooldown marker (15s between model calls per tenant). */
    aiLastExtractedAt: timestamp("ai_last_extracted_at", { withTimezone: true }),
    /** AI bill-coding cooldown marker (15s; separate so tools don't block each other). */
    aiLastBillCodedAt: timestamp("ai_last_bill_coded_at", { withTimezone: true }),
    /** AI close-narrative cooldown marker (15s). */
    aiLastNarrativeAt: timestamp("ai_last_narrative_at", { withTimezone: true }),
    /** Full-books export cooldown marker (60s — the zip is expensive). */
    booksExportLastAt: timestamp("books_export_last_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("accounting_settings_tenant_idx").on(t.tenantId),
    // GLOBAL unique — the inbound webhook resolves tenant by token alone.
    uniqueIndex("accounting_settings_inbound_token_idx")
      .on(t.inboundEmailToken)
      .where(sql`${t.inboundEmailToken} is not null`),
  ],
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

/* ------------------------------------------------------------------------
 * Documents (session 5): the capture-and-extract substrate. `documents` is
 * the GENERIC file record (nothing accounting-specific — a future DMS tool
 * and industry packs build on it); `document_links` carries the accounting
 * attachments with exactly-one-of composite FKs. Packs bolt on via their
 * own link tables FK'ing documents (tenant_id, id) — zero core migration.
 * ---------------------------------------------------------------------- */

export const documentSource = pgEnum("document_source", ["upload", "email"]);

export const documentStatus = pgEnum("document_status", [
  "inbox",
  "filed",
  "trashed",
]);

export const extractionStatus = pgEnum("extraction_status", [
  "pending",
  "done",
  "failed",
  "skipped",
]);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Private-Blob pathname. Null = no-attachment email provenance row. */
    blobPathname: text("blob_pathname"),
    fileName: text("file_name").notNull().default(""),
    mimeType: text("mime_type").notNull().default(""),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    /** Content hash — dedup warns on match, never blocks. */
    sha256: text("sha256").notNull().default(""),
    source: documentSource("source").notNull().default("upload"),
    /** filed = has at least one link; recomputed in-tx with every link write. */
    status: documentStatus("status").notNull().default("inbox"),
    emailFrom: text("email_from").notNull().default(""),
    emailSubject: text("email_subject").notNull().default(""),
    emailMessageId: text("email_message_id").notNull().default(""),
    emailReceivedAt: timestamp("email_received_at", { withTimezone: true }),
    /** Null for email-ingested documents. */
    uploadedByClerkUserId: text("uploaded_by_clerk_user_id"),
    extractionStatus: extractionStatus("extraction_status")
      .notNull()
      .default("pending"),
    /** The session-6 contract shape — see documents/extraction types. */
    extraction: jsonb("extraction"),
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("documents_tenant_id_id_idx").on(t.tenantId, t.id),
    // GLOBAL unique — the pathname embeds the tenant id (acct/{tenant}/…).
    uniqueIndex("documents_blob_pathname_idx")
      .on(t.blobPathname)
      .where(sql`${t.blobPathname} is not null`),
    index("documents_tenant_status_idx").on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
    index("documents_tenant_sha256_idx").on(t.tenantId, t.sha256),
    index("documents_tenant_extraction_idx").on(
      t.tenantId,
      t.extractionStatus,
    ),
    check("documents_size_nonnegative", sql`${t.sizeBytes} >= 0`),
  ],
);

/**
 * Attaches a document to exactly one accounting record (CHECK below).
 * Target FKs are NO ACTION on purpose: hard-delete paths (journal drafts,
 * invoice drafts, Plaid removed txns) must detach app-side first — the FK
 * is the backstop against silently orphaned links. `bill_id` arrives as an
 * additive migration in session 6.
 */
export const documentLinks = pgTable(
  "document_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull(),
    journalEntryId: uuid("journal_entry_id"),
    bankTransactionId: uuid("bank_transaction_id"),
    invoiceId: uuid("invoice_id"),
    /** Session 6's planned additive target. */
    billId: uuid("bill_id"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("document_links_tenant_id_id_idx").on(t.tenantId, t.id),
    index("document_links_tenant_document_idx").on(t.tenantId, t.documentId),
    // No duplicate identical links (one pair-unique per target kind).
    uniqueIndex("document_links_doc_entry_idx")
      .on(t.tenantId, t.documentId, t.journalEntryId)
      .where(sql`${t.journalEntryId} is not null`),
    uniqueIndex("document_links_doc_bank_txn_idx")
      .on(t.tenantId, t.documentId, t.bankTransactionId)
      .where(sql`${t.bankTransactionId} is not null`),
    uniqueIndex("document_links_doc_invoice_idx")
      .on(t.tenantId, t.documentId, t.invoiceId)
      .where(sql`${t.invoiceId} is not null`),
    uniqueIndex("document_links_doc_bill_idx")
      .on(t.tenantId, t.documentId, t.billId)
      .where(sql`${t.billId} is not null`),
    // Reverse lookups: "documents attached to this record".
    index("document_links_tenant_entry_idx")
      .on(t.tenantId, t.journalEntryId)
      .where(sql`${t.journalEntryId} is not null`),
    index("document_links_tenant_bank_txn_idx")
      .on(t.tenantId, t.bankTransactionId)
      .where(sql`${t.bankTransactionId} is not null`),
    index("document_links_tenant_invoice_idx")
      .on(t.tenantId, t.invoiceId)
      .where(sql`${t.invoiceId} is not null`),
    index("document_links_tenant_bill_idx")
      .on(t.tenantId, t.billId)
      .where(sql`${t.billId} is not null`),
    foreignKey({
      name: "document_links_document_fk",
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_links_entry_fk",
      columns: [t.tenantId, t.journalEntryId],
      foreignColumns: [journalEntries.tenantId, journalEntries.id],
    }),
    foreignKey({
      name: "document_links_bank_txn_fk",
      columns: [t.tenantId, t.bankTransactionId],
      foreignColumns: [bankTransactions.tenantId, bankTransactions.id],
    }),
    foreignKey({
      name: "document_links_invoice_fk",
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    foreignKey({
      name: "document_links_bill_fk",
      columns: [t.tenantId, t.billId],
      foreignColumns: [bills.tenantId, bills.id],
    }),
    check(
      "document_links_one_target",
      sql`num_nonnulls(${t.journalEntryId}, ${t.bankTransactionId}, ${t.invoiceId}, ${t.billId}) = 1`,
    ),
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
export type Customer = typeof customers.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type InvoicePayment = typeof invoicePayments.$inferSelect;
export type RecurringInvoice = typeof recurringInvoices.$inferSelect;
export type BankAccount = typeof bankAccounts.$inferSelect;
export type BankTransaction = typeof bankTransactions.$inferSelect;
export type Reconciliation = typeof reconciliations.$inferSelect;
export type ReconciliationLine = typeof reconciliationLines.$inferSelect;
/* ------------------------------------------------------------------------
 * Payables (session 6): vendors, bills, bill payments — the AP mirror of
 * invoicing. Bills carry the VENDOR's invoice number (no tenant sequence);
 * partial/paid derive from payments; approval posts Dr expense / Cr AP
 * through the core engine. bill_lines.account_id is nullable by design:
 * the flagship flow births uncoded lines that AI then a human code —
 * approval enforces every non-zero line is coded.
 * ---------------------------------------------------------------------- */

export const billStatus = pgEnum("bill_status", [
  "draft",
  "awaiting_approval",
  "approved",
  "partial",
  "paid",
  "void",
]);

export const vendors = pgTable(
  "vendors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    address: text("address").notNull().default(""),
    notes: text("notes").notNull().default(""),
    /** AI-free prefill for this vendor's bill lines. */
    defaultExpenseAccountId: uuid("default_expense_account_id"),
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
    uniqueIndex("vendors_tenant_id_id_idx").on(t.tenantId, t.id),
    index("vendors_tenant_idx").on(t.tenantId),
    foreignKey({
      name: "vendors_default_account_fk",
      columns: [t.tenantId, t.defaultExpenseAccountId],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

export const bills = pgTable(
  "bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id").notNull(),
    /** The VENDOR's invoice number — the real-world dedup key. */
    billNumber: text("bill_number").notNull().default(""),
    status: billStatus("status").notNull().default("draft"),
    /** Approval posts with this entry date. */
    billDate: date("bill_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }),
    memo: text("memo").notNull().default(""),
    /** Denormalized Σ line amounts; recomputed in the same tx as line writes. */
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    /** The approval entry. Null while draft; survives void (audit trail). */
    journalEntryId: uuid("journal_entry_id"),
    /** AI coding suggestions keyed by bill line id; cleared on line edits. */
    aiCoding: jsonb("ai_coding"),
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
    uniqueIndex("bills_tenant_id_id_idx").on(t.tenantId, t.id),
    index("bills_tenant_status_idx").on(t.tenantId, t.status),
    index("bills_tenant_vendor_idx").on(t.tenantId, t.vendorId),
    // One bill per approval entry — mirrors invoices.
    uniqueIndex("bills_tenant_entry_idx")
      .on(t.tenantId, t.journalEntryId)
      .where(sql`${t.journalEntryId} is not null`),
    // Duplicate-check lookup (strong signal: vendor + vendor invoice #).
    index("bills_tenant_vendor_number_idx")
      .on(t.tenantId, t.vendorId, t.billNumber)
      .where(sql`${t.billNumber} <> ''`),
    foreignKey({
      name: "bills_vendor_fk",
      columns: [t.tenantId, t.vendorId],
      foreignColumns: [vendors.tenantId, vendors.id],
    }),
    foreignKey({
      name: "bills_entry_fk",
      columns: [t.tenantId, t.journalEntryId],
      foreignColumns: [journalEntries.tenantId, journalEntries.id],
    }),
    check("bills_total_nonnegative", sql`${t.totalCents} >= 0`),
  ],
);

export const billLines = pgTable(
  "bill_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    billId: uuid("bill_id").notNull(),
    lineNo: integer("line_no").notNull().default(0),
    description: text("description").notNull().default(""),
    /** Signed; 0 posts nothing; negative = credit/discount line. */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    /** Nullable by design (P9): uncoded until AI + human code it. */
    accountId: uuid("account_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("bill_lines_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("bill_lines_bill_line_no_idx").on(t.tenantId, t.billId, t.lineNo),
    index("bill_lines_tenant_bill_idx").on(t.tenantId, t.billId),
    foreignKey({
      name: "bill_lines_bill_fk",
      columns: [t.tenantId, t.billId],
      foreignColumns: [bills.tenantId, bills.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "bill_lines_account_fk",
      columns: [t.tenantId, t.accountId],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

export const billPayments = pgTable(
  "bill_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    billId: uuid("bill_id").notNull(),
    paymentDate: date("payment_date", { mode: "string" }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    /** A bank-register ledger account, any kind incl. credit_card. */
    paidFromAccountId: uuid("paid_from_account_id").notNull(),
    /** zod enum: cash | check | card | bank_transfer | other. */
    method: text("method").notNull().default("other"),
    memo: text("memo").notNull().default(""),
    /** Created atomically with its entry — NOT NULL by design. */
    journalEntryId: uuid("journal_entry_id").notNull(),
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
    uniqueIndex("bill_payments_tenant_id_id_idx").on(t.tenantId, t.id),
    index("bill_payments_tenant_bill_idx").on(t.tenantId, t.billId),
    // One payment row per entry — DB rule.
    uniqueIndex("bill_payments_tenant_entry_idx").on(
      t.tenantId,
      t.journalEntryId,
    ),
    // NO ACTION: a bill with payments can never be deleted (drafts
    // have none, so draft-delete passes).
    foreignKey({
      name: "bill_payments_bill_fk",
      columns: [t.tenantId, t.billId],
      foreignColumns: [bills.tenantId, bills.id],
    }),
    foreignKey({
      name: "bill_payments_paid_from_fk",
      columns: [t.tenantId, t.paidFromAccountId],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
    foreignKey({
      name: "bill_payments_entry_fk",
      columns: [t.tenantId, t.journalEntryId],
      foreignColumns: [journalEntries.tenantId, journalEntries.id],
    }),
    check("bill_payments_amount_positive", sql`${t.amountCents} > 0`),
  ],
);

/* ------------------------------------------------------------------------
 * Close & accountant tools (session 7): month-end close records. Each
 * completed close snapshots its checklist and establishes the period lock;
 * accounting_settings.closed_through is DERIVED state written only by
 * completeClose/reopenClose in core/close.ts.
 * ---------------------------------------------------------------------- */

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

export type PlaidItem = typeof plaidItems.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type DocumentLink = typeof documentLinks.$inferSelect;
export type Vendor = typeof vendors.$inferSelect;
export type Bill = typeof bills.$inferSelect;
export type BillLine = typeof billLines.$inferSelect;
export type BillPayment = typeof billPayments.$inferSelect;
export type PeriodClose = typeof periodCloses.$inferSelect;
export type CloseNote = typeof closeNotes.$inferSelect;
export type Retainer = typeof retainers.$inferSelect;
export type RetainerAllotment = typeof retainerAllotments.$inferSelect;
export type RetainerTimeEntry = typeof retainerTimeEntries.$inferSelect;
export type RetainerPurchase = typeof retainerPurchases.$inferSelect;
