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

// 'generated' added in 0036, ALONE in its own migration file: a new enum value
// cannot be USED in the transaction that adds it, so anything referencing it
// must land in a later file (0037).
export const documentSource = pgEnum("document_source", [
  "upload",
  "email",
  "generated",
]);

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
    /**
     * Optimistic-concurrency counter (CAS on trash/restore/move). NOT a file
     * revision number — that's `fileVersionNo`. Never conflate the two.
     */
    version: integer("version").notNull().default(1),

    /* -- DMS (documents module) ------------------------------------------
     * The table is shared by two surfaces. `origin` is the discriminator and
     * has NO database default on purpose: $inferInsert makes it required, so
     * every insert site must declare which surface it belongs to. Accounting
     * queries that filter on `status` alone MUST also filter on origin, or
     * DMS files leak into the Receipts inbox and the close checklist.
     */
    origin: text("origin").notNull(),
    /** Null = the system Inbox (captured but not yet filed into the cabinet). */
    folderId: uuid("folder_id"),
    /** Display name; `fileName` stays the on-disk name (Content-Disposition). */
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    /** Open taxonomy for industry packs ('drawing', 'permit', 'submittal'). */
    docKind: text("doc_kind").notNull().default(""),
    /** Tag SLUGS, resolved against document_tags. Renames never touch this. */
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Pack extension bag. NOT NULL so `metadata->>'x'` is always safe. */
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Denormalized from the folder tree — this column IS the RLS predicate. */
    effectiveVisibility: text("effective_visibility")
      .notNull()
      .default("members"),
    /** Current file revision. See document_versions for the history. */
    fileVersionNo: integer("file_version_no").notNull().default(1),
    fileVersionCount: integer("file_version_count").notNull().default(1),
    /** OCR / PDF text seam — indexed by search_tsv, populated later. */
    extractedText: text("extracted_text").notNull().default(""),
    /** When it left the Inbox. */
    filedAt: timestamp("filed_at", { withTimezone: true }),

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
    // NOTE: no OTHER unique index may be added to this table. createDocumentRecord
    // uses a bare .onConflictDoNothing(), which covers every unique constraint —
    // a second one would silently turn legitimate inserts into swallowed conflicts.
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
    index("documents_tenant_origin_idx").on(
      t.tenantId,
      t.origin,
      t.status,
      t.createdAt,
    ),
    index("documents_tenant_folder_idx").on(
      t.tenantId,
      t.folderId,
      t.createdAt.desc(),
    ),
    index("documents_tags_gin_idx").using("gin", t.tags),
    foreignKey({
      name: "documents_folder_fk",
      columns: [t.tenantId, t.folderId],
      foreignColumns: [documentFolders.tenantId, documentFolders.id],
    }),
    check("documents_size_nonnegative", sql`${t.sizeBytes} >= 0`),
    check("documents_origin_check", sql`${t.origin} in ('accounting', 'dms')`),
    check(
      "documents_visibility_check",
      sql`${t.effectiveVisibility} in ('members', 'owners')`,
    ),
    check(
      "documents_file_version_check",
      sql`${t.fileVersionNo} >= 1 and ${t.fileVersionCount} >= ${t.fileVersionNo}`,
    ),
    check(
      "documents_tags_cap",
      sql`array_length(${t.tags}, 1) is null or array_length(${t.tags}, 1) <= 30`,
    ),
    check(
      "documents_filed_at_requires_folder",
      sql`${t.folderId} is not null or ${t.filedAt} is null`,
    ),
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

/* ------------------------------------------------------------------------
 * Documents module (the DMS): the filing cabinet built ON the generic
 * `documents` record above. Receipts keeps its own surface on the same
 * table; `documents.origin` tells the two apart.
 *
 * The tree is an adjacency list (`parent_id`, the source of truth) PLUS a
 * materialized `path`. The path is what makes cycle prevention a single
 * string comparison (`newParent.path LIKE moving.path || '%'`) instead of a
 * recursive CTE, and makes a subtree move one UPDATE. Trees are tiny,
 * read-hot and write-cold, which is why a closure table would be overkill.
 *
 * `effective_visibility` is `visibility` rolled down the ancestor chain and
 * denormalized onto both folders and documents, because it is compared
 * directly inside the RLS policy (drizzle/0024). Recomputed in TypeScript
 * (modules/documents/core/tree.ts), never by recursive SQL — flipping a
 * mid-node back to 'members' must not re-open a descendant that declares
 * itself 'owners', which a naive subtree UPDATE gets wrong.
 * ---------------------------------------------------------------------- */

export const documentFolders = pgTable(
  "document_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Null = a root folder. Self composite FK, NO ACTION (see below). */
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    /** lower(btrim(name)) — app-maintained; gives case-insensitive uniqueness. */
    nameKey: text("name_key").notNull(),
    /** '/<id-hex32>/…/' including self. Derived — see core/tree.ts. */
    path: text("path").notNull(),
    depth: integer("depth").notNull().default(1),
    /** What was declared on THIS folder. */
    visibility: text("visibility").notNull().default("members"),
    /** Declared value rolled down the ancestor chain — the RLS predicate. */
    effectiveVisibility: text("effective_visibility")
      .notNull()
      .default("members"),
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * Opt-in forwarding address: docs-<token>@<inbound domain>. Null = off,
     * which is the default — an inbound address is an anonymous write surface
     * and should exist only where someone asked for one.
     *
     * Stored lowercase and GLOBALLY unique: the webhook resolves it with no
     * tenant context, the same reason document_shares.token_hash is global.
     */
    inboundToken: text("inbound_token"),
    /** Null = provisioned by the platform (the default folder set). */
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
    uniqueIndex("document_folders_tenant_id_id_idx").on(t.tenantId, t.id),
    // TWO partial uniques, not one: parent_id is NULL at root and NULL <> NULL
    // in a unique index, so a single (tenant, parent, name) unique would happily
    // allow ten root folders called "Contracts".
    uniqueIndex("document_folders_tenant_parent_name_idx")
      .on(t.tenantId, t.parentId, t.nameKey)
      .where(sql`${t.parentId} is not null`),
    uniqueIndex("document_folders_tenant_root_name_idx")
      .on(t.tenantId, t.nameKey)
      .where(sql`${t.parentId} is null`),
    index("document_folders_tenant_parent_idx").on(t.tenantId, t.parentId),
    uniqueIndex("document_folders_inbound_token_idx")
      .on(t.inboundToken)
      .where(sql`${t.inboundToken} is not null`),
    check(
      "document_folders_inbound_token_format",
      sql`${t.inboundToken} is null or ${t.inboundToken} ~ '^[a-z0-9]{16,}$'`,
    ),
    // The (tenant_id, path text_pattern_ops) prefix index is hand-written in
    // drizzle/0024 — drizzle-kit cannot emit opclasses, and without it every
    // subtree query silently seq-scans on a non-C collation.
    foreignKey({
      name: "document_folders_parent_fk",
      columns: [t.tenantId, t.parentId],
      foreignColumns: [t.tenantId, t.id],
    }),
    check(
      "document_folders_no_self_parent",
      sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`,
    ),
    check(
      "document_folders_visibility",
      sql`${t.visibility} in ('members', 'owners')`,
    ),
    check(
      "document_folders_eff_visibility",
      sql`${t.effectiveVisibility} in ('members', 'owners')`,
    ),
    // A folder declared 'owners' can never be effectively 'members'.
    check(
      "document_folders_eff_implies",
      sql`${t.visibility} <> 'owners' or ${t.effectiveVisibility} = 'owners'`,
    ),
    check("document_folders_depth", sql`${t.depth} between 1 and 10`),
    check(
      "document_folders_name_not_blank",
      sql`length(btrim(${t.name})) > 0`,
    ),
    check("document_folders_path_format", sql`${t.path} ~ '^(/[0-9a-f]{32})+/$'`),
  ],
);

/**
 * File revision history. There is deliberately NO `documents.current_version_id`
 * pointer — it would make a circular FK and leave "exactly one current" as an
 * app invariant. The partial unique on `is_current` makes it a DATABASE
 * invariant instead, and `documents` keeps the current version's blob columns
 * denormalized so list pages, the stream route and ai/extract never join.
 *
 * `blob_pathname` is intentionally NOT unique here: restoring v1 creates a new
 * row pointing at v1's existing blob — no byte copy, no re-hash, honest history.
 */
export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull(),
    versionNo: integer("version_no").notNull(),
    blobPathname: text("blob_pathname").notNull(),
    fileName: text("file_name").notNull().default(""),
    mimeType: text("mime_type").notNull().default(""),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    sha256: text("sha256").notNull().default(""),
    isCurrent: boolean("is_current").notNull().default(true),
    note: text("note").notNull().default(""),
    /** Set when this row was produced by restoring an earlier version. */
    restoredFromVersionId: uuid("restored_from_version_id"),
    uploadedByClerkUserId: text("uploaded_by_clerk_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("document_versions_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("document_versions_doc_no_idx").on(
      t.tenantId,
      t.documentId,
      t.versionNo,
    ),
    // Exactly one current version per document, enforced by the database.
    // Non-deferrable: the swap must clear the old flag BEFORE inserting.
    uniqueIndex("document_versions_current_idx")
      .on(t.tenantId, t.documentId)
      .where(sql`${t.isCurrent}`),
    index("document_versions_tenant_doc_idx").on(
      t.tenantId,
      t.documentId,
      t.versionNo,
    ),
    // PLAIN, not unique — a restore reuses an existing blob pathname.
    index("document_versions_blob_idx").on(t.blobPathname),
    foreignKey({
      name: "document_versions_document_fk",
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }).onDelete("cascade"),
    check("document_versions_size_nonnegative", sql`${t.sizeBytes} >= 0`),
    check("document_versions_no_positive", sql`${t.versionNo} >= 1`),
  ],
);

/**
 * Tag registry. `documents.tags` stores SLUGS from this table, so renaming a
 * tag is a one-row update and never rewrites documents. Postgres cannot FK an
 * array element — setDocumentTags is the single door that resolves slugs
 * against this registry inside the transaction.
 */
export const documentTags = pgTable(
  "document_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** A design-token name, never raw CSS. */
    color: text("color").notNull().default(""),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("document_tags_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("document_tags_tenant_slug_idx").on(t.tenantId, t.slug),
    check(
      "document_tags_slug_format",
      sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{0,48}$'`,
    ),
    check("document_tags_name_not_blank", sql`length(btrim(${t.name})) > 0`),
  ],
);

/**
 * Saved filter views. `query` is user-controlled JSON that becomes a WHERE
 * clause — it MUST be re-parsed with the same Zod schema on read. Stored
 * input, never trusted config.
 */
/**
 * Document templates — a lien waiver, a change order, a subcontract.
 *
 * NOT to be confused with `src/modules/documents/templates/`, which is the
 * default FOLDER tree a tenant is provisioned with. Unrelated concepts that
 * unfortunately share an English word; the module directory for these is
 * `doc-templates/`.
 *
 * The row is the template's IDENTITY (name, what it is for). Every body lives
 * in `document_template_versions`, because a published template must be
 * immutable — a business needs to know what the waiver said on the day it was
 * sent, and editing in place would silently rewrite history.
 */
export const documentTemplates = pgTable(
  "document_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    description: text("description").notNull().default(""),
    /** Open taxonomy, same vocabulary as documents.doc_kind. */
    docKind: text("doc_kind").notNull().default(""),
    /** Where generated documents get filed. Null = the Inbox. */
    defaultFolderId: uuid("default_folder_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
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
    uniqueIndex("document_templates_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("document_templates_tenant_name_idx").on(t.tenantId, t.nameKey),
    index("document_templates_tenant_kind_idx").on(t.tenantId, t.docKind),
    foreignKey({
      name: "document_templates_folder_fk",
      columns: [t.tenantId, t.defaultFolderId],
      foreignColumns: [documentFolders.tenantId, documentFolders.id],
    }),
    check(
      "document_templates_name_not_blank",
      sql`length(btrim(${t.name})) > 0`,
    ),
  ],
);

/**
 * One revision of a template's body.
 *
 * **Publish immutability is the whole point.** A version with `published_at`
 * set is frozen: editing produces a NEW draft version instead. That is what
 * makes "this waiver was generated from v3, and here is v3" answerable a year
 * later, and it is enforced in `doc-templates/template-ops.ts` rather than by a
 * constraint, because Postgres cannot express "these columns are immutable
 * once that column is non-null" without a trigger.
 *
 * At most ONE draft per template (partial unique) — a template with two drafts
 * has no answer to "what am I editing?".
 */
export const documentTemplateVersions = pgTable(
  "document_template_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").notNull(),
    versionNo: integer("version_no").notNull(),
    /** Markdown. Merge values are NEVER substituted into it — see merge.ts. */
    body: text("body").notNull().default(""),
    /**
     * The declared merge fields: [{ name, label, required }]. Derived from the
     * body on save, so it can never drift into claiming a field the body does
     * not reference — but stored so a form can be built without re-parsing.
     */
    fields: jsonb("fields")
      .notNull()
      .default(sql`'[]'::jsonb`),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedByClerkUserId: text("published_by_clerk_user_id"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("document_template_versions_tenant_id_id_idx").on(
      t.tenantId,
      t.id,
    ),
    uniqueIndex("document_template_versions_no_idx").on(
      t.tenantId,
      t.templateId,
      t.versionNo,
    ),
    // Exactly one editable draft per template, enforced by the database.
    uniqueIndex("document_template_versions_draft_idx")
      .on(t.tenantId, t.templateId)
      .where(sql`${t.publishedAt} is null`),
    index("document_template_versions_tenant_template_idx").on(
      t.tenantId,
      t.templateId,
      t.versionNo,
    ),
    foreignKey({
      name: "document_template_versions_template_fk",
      columns: [t.tenantId, t.templateId],
      foreignColumns: [documentTemplates.tenantId, documentTemplates.id],
    }).onDelete("cascade"),
    check(
      "document_template_versions_no_positive",
      sql`${t.versionNo} >= 1`,
    ),
    // A published version must record who published it: the pair is the
    // evidence, and half of it is not.
    check(
      "document_template_versions_published_pair",
      sql`(${t.publishedAt} is null) = (${t.publishedByClerkUserId} is null)`,
    ),
  ],
);

/**
 * One document produced from a template.
 *
 * The row exists so "where did this PDF come from?" has an answer that survives
 * the template being edited afterwards: it names the exact `version_no` that
 * was current at the time, which is why publish immutability matters.
 *
 * `values` holds what was merged in. It is ordinary tenant data under RLS — and
 * it is already visible in the generated PDF, so storing it adds no exposure
 * while making a regeneration or a "what did we put in that waiver" question
 * answerable.
 */
export const documentGenerations = pgTable(
  "document_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").notNull(),
    /** The frozen version used. NOT a FK to the version row — see below. */
    templateVersionNo: integer("template_version_no").notNull(),
    templateVersionId: uuid("template_version_id"),
    /** The document this produced. Null only if filing somehow failed. */
    documentId: uuid("document_id"),
    /** Per-tenant sequence, for "Waiver #14". */
    number: integer("number").notNull(),
    values: jsonb("values")
      .notNull()
      .default(sql`'{}'::jsonb`),
    generatedByClerkUserId: text("generated_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("document_generations_tenant_id_id_idx").on(t.tenantId, t.id),
    // The per-tenant number is a sequence, so it must be unique or it is not a
    // number anyone can quote.
    uniqueIndex("document_generations_tenant_number_idx").on(
      t.tenantId,
      t.number,
    ),
    index("document_generations_tenant_template_idx").on(
      t.tenantId,
      t.templateId,
      t.createdAt,
    ),
    foreignKey({
      name: "document_generations_template_fk",
      columns: [t.tenantId, t.templateId],
      foreignColumns: [documentTemplates.tenantId, documentTemplates.id],
    }),
    // Documents can be trashed; a generation record must outlive that, so this
    // is NO ACTION and document_id is nullable rather than cascading away the
    // evidence that a document was ever produced.
    foreignKey({
      name: "document_generations_document_fk",
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }),
    check("document_generations_number_positive", sql`${t.number} >= 1`),
    check(
      "document_generations_version_positive",
      sql`${t.templateVersionNo} >= 1`,
    ),
  ],
);

export const documentSavedViews = pgTable(
  "document_saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    scope: text("scope").notNull().default("tenant"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    query: jsonb("query")
      .notNull()
      .default(sql`'{}'::jsonb`),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("document_saved_views_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("document_saved_views_tenant_owner_name_idx").on(
      t.tenantId,
      t.createdByClerkUserId,
      t.nameKey,
    ),
    check(
      "document_saved_views_scope",
      sql`${t.scope} in ('tenant', 'private')`,
    ),
    check(
      "document_saved_views_name_not_blank",
      sql`length(btrim(${t.name})) > 0`,
    ),
  ],
);

/**
 * Per-tenant module settings. Provisioned when the module is enabled. The
 * sharing / e-sign / AI columns are created now, unused, so the later phases
 * (share links, template drafting) need no migration of their own.
 */
export const documentSettings = pgTable(
  "document_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sharingEnabled: boolean("sharing_enabled").notNull().default(true),
    shareMaxTtlDays: integer("share_max_ttl_days").notNull().default(30),
    esignEnabled: boolean("esign_enabled").notNull().default(false),
    /** AI template drafting cooldown, claimed inside the gating transaction. */
    aiLastTemplateAt: timestamp("ai_last_template_at", { withTimezone: true }),
    aiTemplateCountDate: date("ai_template_count_date", { mode: "string" }),
    aiTemplateCountToday: integer("ai_template_count_today")
      .notNull()
      .default(0),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("document_settings_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("document_settings_tenant_idx").on(t.tenantId),
    check(
      "document_settings_ttl_positive",
      sql`${t.shareMaxTtlDays} between 1 and 365`,
    ),
    check(
      "document_settings_ai_count_nonneg",
      sql`${t.aiTemplateCountToday} >= 0`,
    ),
  ],
);

/* ------------------------------------------------------------------------
 * Share links: anonymous, tokenised read access to a file or a folder.
 *
 * The token itself is never stored. `token_hash` is a keyed HMAC used for
 * lookup, and `token_ciphertext` is the token under AES-GCM so an owner can
 * copy the URL again weeks later — an audited reveal rather than a column
 * anyone with database access reads silently. Both keys live in the
 * environment, so a database-only compromise yields nothing.
 *
 * `token_hash` is GLOBALLY unique, with no tenant prefix, because the public
 * lookup has no tenant context to scope by — the same reasoning as
 * documents_blob_pathname_idx.
 * ---------------------------------------------------------------------- */

export const documentShares = pgTable(
  "document_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Exactly one of these two — CHECK below. */
    documentId: uuid("document_id"),
    folderId: uuid("folder_id"),
    tokenHash: text("token_hash").notNull(),
    tokenCiphertext: text("token_ciphertext").notNull(),
    label: text("label").notNull().default(""),
    /** false = view-only. A UX affordance, never a security control. */
    canDownload: boolean("can_download").notNull().default(false),
    /** scrypt, base64(salt).base64(hash). Null = no passcode. */
    passcodeHash: text("passcode_hash"),
    /** No never-expiring anonymous links. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    maxUses: integer("max_uses"),
    useCount: integer("use_count").notNull().default(0),
    failedUnlockCount: integer("failed_unlock_count").notNull().default(0),
    /**
     * The root's visibility when the link was created. If the folder later
     * becomes stricter the share suspends itself rather than continuing to
     * expose a subtree the owner has since closed.
     */
    createdRootVisibility: text("created_root_visibility").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByClerkUserId: text("revoked_by_clerk_user_id"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("document_shares_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("document_shares_token_hash_idx").on(t.tokenHash),
    index("document_shares_tenant_document_idx")
      .on(t.tenantId, t.documentId)
      .where(sql`${t.documentId} is not null`),
    index("document_shares_tenant_folder_idx")
      .on(t.tenantId, t.folderId)
      .where(sql`${t.folderId} is not null`),
    index("document_shares_tenant_active_idx").on(
      t.tenantId,
      t.revokedAt,
      t.expiresAt,
    ),
    foreignKey({
      name: "document_shares_document_fk",
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_shares_folder_fk",
      columns: [t.tenantId, t.folderId],
      foreignColumns: [documentFolders.tenantId, documentFolders.id],
    }).onDelete("cascade"),
    // Same shape as document_links_one_target.
    check(
      "document_shares_one_scope",
      sql`num_nonnulls(${t.documentId}, ${t.folderId}) = 1`,
    ),
    check(
      "document_shares_expiry_forward",
      sql`${t.expiresAt} > ${t.createdAt}`,
    ),
    check(
      "document_shares_max_uses_positive",
      sql`${t.maxUses} is null or ${t.maxUses} > 0`,
    ),
    check("document_shares_use_count_nonneg", sql`${t.useCount} >= 0`),
    check(
      "document_shares_root_visibility",
      sql`${t.createdRootVisibility} in ('members', 'owners')`,
    ),
  ],
);

/**
 * Per-link access log — the tenant's evidence that a recipient did or did not
 * open what they were sent. member_read only: this is a record members
 * consult, not one they author.
 */
export const documentShareEvents = pgTable(
  "document_share_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    shareId: uuid("share_id").notNull(),
    /** Set on file fetches inside a folder share. */
    documentId: uuid("document_id"),
    kind: text("kind").notNull(),
    ipHash: text("ip_hash").notNull().default(""),
    userAgentHash: text("user_agent_hash").notNull().default(""),
    bytesSent: bigint("bytes_sent", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("document_share_events_tenant_id_id_idx").on(t.tenantId, t.id),
    index("document_share_events_share_idx").on(
      t.tenantId,
      t.shareId,
      t.createdAt,
    ),
    foreignKey({
      name: "document_share_events_share_fk",
      columns: [t.tenantId, t.shareId],
      foreignColumns: [documentShares.tenantId, documentShares.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_share_events_document_fk",
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }),
    check("document_share_events_bytes_nonneg", sql`${t.bytesSent} >= 0`),
  ],
);

/**
 * Anonymous probe and failed-unlock counters. Deliberately has NO tenant_id:
 * an attacker guessing tokens belongs to no tenant, and forcing these rows
 * into a tenant-scoped table would either need a nullable tenant_id (breaking
 * the FK and RLS story) or attribute an attacker's traffic to a victim.
 * Superadmin-only, like interview_sessions.
 */
export const publicAccessAttempts = pgTable(
  "public_access_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    ipHash: text("ip_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("public_access_attempts_ip_idx").on(t.ipHash, t.kind, t.createdAt),
    index("public_access_attempts_created_idx").on(t.createdAt),
  ],
);

/* ------------------------------------------------------------------------
 * Outbound email. Platform machinery, not a module: invoices, share links and
 * signature requests all send through the same spine.
 *
 * The product decision this exists to serve: mail should come FROM the client's
 * own domain, not from ours. You cannot simply put their address in the From
 * header — SPF/DKIM alignment would fail and DMARC would reject it — so a
 * tenant proves ownership by adding DNS records, and until they do, sending
 * falls back to the platform domain with Reply-To pointed at them.
 * ---------------------------------------------------------------------- */

export const emailDomains = pgTable(
  "email_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The sending domain, usually a subdomain: mail.acmebuilders.com */
    domain: text("domain").notNull(),
    /** The provider's id for this domain; null until creation succeeds. */
    providerDomainId: text("provider_domain_id"),
    /** pending | verified | failed */
    status: text("status").notNull().default("pending"),
    /** Normalized DNS records for the setup wizard to display. */
    dnsRecords: jsonb("dns_records")
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** The part before the @. "invoices" -> invoices@mail.acmebuilders.com */
    fromLocalPart: text("from_local_part").notNull().default("notifications"),
    /** Display name; defaults to the tenant's name at send time when blank. */
    fromName: text("from_name").notNull().default(""),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("email_domains_tenant_id_id_idx").on(t.tenantId, t.id),
    // One sending domain per tenant in v1.
    uniqueIndex("email_domains_tenant_idx").on(t.tenantId),
    // A domain can only be claimed once across the platform — otherwise two
    // tenants could both try to send as the same domain.
    uniqueIndex("email_domains_domain_idx").on(t.domain),
    check(
      "email_domains_status_check",
      sql`${t.status} in ('pending', 'verified', 'failed')`,
    ),
    check(
      "email_domains_local_part_format",
      sql`${t.fromLocalPart} ~ '^[a-z0-9][a-z0-9._-]{0,62}$'`,
    ),
    check("email_domains_domain_not_blank", sql`length(${t.domain}) > 3`),
  ],
);

/**
 * The send log. Members read it — "did that invoice actually arrive?" is a
 * question they need answered — but only trusted server code writes it, so
 * a delivery status can never be forged.
 *
 * Recipient addresses are stored in the clear, deliberately. They are the
 * tenant's own record of their own correspondence, sitting behind RLS, and a
 * send log that cannot tell you who you sent to is not a send log. They are
 * kept OUT of the audit log, which is identifiers-only and superadmin-visible.
 */
export const outboundEmails = pgTable(
  "outbound_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** share_link | invoice | esign | ... */
    kind: text("kind").notNull(),
    toAddress: text("to_address").notNull(),
    /** Split out so deliverability can be reasoned about per recipient domain. */
    toDomain: text("to_domain").notNull().default(""),
    subject: text("subject").notNull().default(""),
    /** What we actually sent as — the whole point of the domain feature. */
    fromAddress: text("from_address").notNull().default(""),
    /** True when sent from the tenant's own verified domain. */
    fromTenantDomain: boolean("from_tenant_domain").notNull().default(false),
    providerMessageId: text("provider_message_id"),
    /** queued | sent | delivered | bounced | complained | failed */
    status: text("status").notNull().default("queued"),
    /** Makes a retried action a no-op instead of a second email. */
    idempotencyKey: text("idempotency_key").notNull(),
    error: text("error").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("outbound_emails_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("outbound_emails_idempotency_idx").on(
      t.tenantId,
      t.idempotencyKey,
    ),
    index("outbound_emails_tenant_created_idx").on(t.tenantId, t.createdAt),
    // The webhook looks messages up by provider id, with no tenant context.
    index("outbound_emails_provider_idx")
      .on(t.providerMessageId)
      .where(sql`${t.providerMessageId} is not null`),
    check(
      "outbound_emails_status_check",
      sql`${t.status} in ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed')`,
    ),
  ],
);

/**
 * A domain whose MAIL WE HOST — the MX record points at our mailbox provider
 * and real mailboxes live under it.
 *
 * Deliberately NOT the same table as `email_domains`, even though both hold a
 * domain and a pile of DNS records, because they are different promises:
 *
 *   email_domains    mail.acme.com   sending only. DKIM/SPF. If it breaks,
 *                                    outbound notifications stop.
 *   mailbox_domains  acme.com        MX. If it breaks, the business stops
 *                                    RECEIVING MAIL. Every order, every RFI.
 *
 * That second failure mode is the reason for most of the design below. A
 * sending subdomain is additive — nothing worked there before. An MX record is
 * a takeover of something that already works, so the flow is staged
 * (create → publish records → diagnostics → activate) rather than one button,
 * and `previous_mx` exists so rollback is a stored fact rather than a hope.
 */
export const mailboxDomains = pgTable(
  "mailbox_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Usually the root domain: acmebuilders.com */
    domain: text("domain").notNull(),
    /**
     * Which mailbox host holds it. Stored per row, not inferred from env, so a
     * migration from one host to another can run tenant by tenant instead of
     * as a platform-wide flag day.
     */
    provider: text("provider").notNull().default("migadu"),
    /**
     * pending    — created at the provider, DNS not published yet
     * dns_ready  — provider diagnostics pass, but MX has NOT been cut over
     * active     — activated; this domain's mail now arrives here
     * failed     — provider rejected it, see last_error
     *
     * dns_ready is the important one. It is the state where everything is
     * proven and nothing has been taken over yet, and it is where an owner can
     * safely sit and think before the irreversible-feeling step.
     */
    status: text("status").notNull().default("pending"),
    /** Records the provider says to publish. Same shape the sending wizard renders. */
    dnsRecords: jsonb("dns_records")
      .notNull()
      .default(sql`'[]'::jsonb`),
    /**
     * THE ROLLBACK RECORD. Whatever MX the domain had before we touched it,
     * captured at cutover time.
     *
     * Without this, "put it back the way it was" depends on someone having
     * taken a screenshot. A business whose mail is going to the wrong place is
     * not in a state to reconstruct their old Google MX values from memory.
     */
    previousMx: jsonb("previous_mx")
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Raw provider diagnostics from the last check, for showing what's missing. */
    lastDiagnostics: jsonb("last_diagnostics")
      .notNull()
      .default(sql`'{}'::jsonb`),
    lastError: text("last_error").notNull().default(""),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    /** When the owner accepted the MX change. Null until they do. */
    mxCutoverAt: timestamp("mx_cutover_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("mailbox_domains_tenant_id_id_idx").on(t.tenantId, t.id),
    // One hosted domain per tenant in v1.
    uniqueIndex("mailbox_domains_tenant_idx").on(t.tenantId),
    // Platform-wide claim: two tenants must never both host the same domain.
    uniqueIndex("mailbox_domains_domain_idx").on(t.domain),
    check(
      "mailbox_domains_status_check",
      sql`${t.status} in ('pending', 'dns_ready', 'active', 'failed')`,
    ),
    check("mailbox_domains_domain_not_blank", sql`length(${t.domain}) > 3`),
    check(
      "mailbox_domains_provider_check",
      sql`${t.provider} in ('migadu', 'stalwart')`,
    ),
    // Can't be active without having recorded the moment of cutover — that
    // would mean an activation path skipped the rollback capture.
    check(
      "mailbox_domains_active_has_cutover",
      sql`${t.status} <> 'active' or ${t.mxCutoverAt} is not null`,
    ),
  ],
);

/**
 * One real mailbox: dan@acmebuilders.com, with a password its owner uses in
 * this app, on their phone, and in Outlook if they want.
 *
 * NO PASSWORD OR CREDENTIAL IS STORED HERE, ever. Provisioning prefers the
 * provider's invitation flow (the provider mails a setup link and we never see
 * a secret); where a password must be generated it is returned to the caller
 * once, shown once, and never persisted or logged. A mailbox password is
 * strictly more dangerous than an app password — it can read the mail that
 * resets every other account the business owns.
 */
export const mailboxes = pgTable(
  "mailboxes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    mailboxDomainId: uuid("mailbox_domain_id").notNull(),
    /** The part before the @. */
    localPart: text("local_part").notNull(),
    /** Denormalized full address — every read wants it, and it never changes. */
    address: text("address").notNull(),
    /** Display name on outgoing mail. */
    displayName: text("display_name").notNull().default(""),
    /**
     * Which platform user this mailbox belongs to, when it belongs to one.
     * Null for shared boxes (info@, invoices@) that no single person owns.
     */
    clerkUserId: text("clerk_user_id"),
    /** provisioning | active | suspended | failed */
    status: text("status").notNull().default("provisioning"),
    /** Mirrors the provider's per-mailbox switches. */
    maySend: boolean("may_send").notNull().default(true),
    mayReceive: boolean("may_receive").notNull().default(true),
    mayAccessImap: boolean("may_access_imap").notNull().default(true),
    /** True while the provider's invitation is outstanding. */
    invitePending: boolean("invite_pending").notNull().default(false),
    lastError: text("last_error").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("mailboxes_tenant_id_id_idx").on(t.tenantId, t.id),
    // No two mailboxes on the same domain can share a local part — that would
    // be two people believing they own one address.
    uniqueIndex("mailboxes_domain_local_part_idx").on(
      t.mailboxDomainId,
      t.localPart,
    ),
    index("mailboxes_tenant_status_idx").on(t.tenantId, t.status),
    // House rule: the composite FK makes it structurally impossible to hang a
    // mailbox off ANOTHER tenant's domain, RLS bug or not.
    foreignKey({
      name: "mailboxes_domain_fk",
      columns: [t.tenantId, t.mailboxDomainId],
      foreignColumns: [mailboxDomains.tenantId, mailboxDomains.id],
    }).onDelete("cascade"),
    check(
      "mailboxes_status_check",
      sql`${t.status} in ('provisioning', 'active', 'suspended', 'failed')`,
    ),
    check(
      "mailboxes_local_part_format",
      sql`${t.localPart} ~ '^[a-z0-9][a-z0-9._-]{0,62}$'`,
    ),
  ],
);

/**
 * The mail server's directory. THE ONLY TABLE THE MAIL SERVER CAN READ.
 *
 * Stalwart authenticates against an external SQL directory rather than an
 * internal store, which means provisioning a mailbox is a row here instead of
 * a call to somebody's REST API — the reason the monolith survives having its
 * own mail server at all.
 *
 * It also means the mail server holds a Postgres connection, and that is the
 * risk this table's shape is built around. `stalwart_directory` is a dedicated
 * role with SELECT on this table and NOTHING else (scripts/create-mail-role.ts),
 * backed by an RLS policy keyed on `current_user`. Two independent mechanisms,
 * because one of them being wrong should not be enough.
 *
 * So the worst case for a compromised mail server is: the list of email
 * addresses on the platform, and their password hashes. Not an invoice, not a
 * document, not a ledger. Everything else in the database is unreachable from
 * that role.
 *
 * A hash is not a usable credential — the server compares a submitted password
 * against it, it cannot be replayed — but it IS offline-attackable, which is
 * why the algorithm matters and why nothing else lives here.
 */
export const mailDirectoryAccounts = pgTable(
  "mail_directory_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    mailboxId: uuid("mailbox_id").notNull(),
    /**
     * What the user types into a mail client. The full address, because that is
     * what people know and what every IMAP client prompts for.
     * Unique platform-wide: a login that resolved to two accounts would be an
     * authentication bug with a cross-tenant blast radius.
     */
    login: text("login").notNull(),
    /**
     * PHC-format hash, null until the invitation is accepted and the person
     * chooses their own password. Yosher never stores the password itself and
     * never learns it after hashing.
     *
     * The exact algorithm must be confirmed against the mail server's supported
     * list before the invitation flow is wired — guessing at a format the
     * server cannot verify produces an account nobody can log into.
     */
    passwordHash: text("password_hash"),
    /** individual | group — the mail server distinguishes them. */
    accountType: text("account_type").notNull().default("individual"),
    description: text("description").notNull().default(""),
    /** Switch off access without destroying the mailbox or its mail. */
    isActive: boolean("is_active").notNull().default(true),
    /** 0 means no limit, matching the mail host's own convention. */
    quotaBytes: bigint("quota_bytes", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("mail_directory_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("mail_directory_login_idx").on(t.login),
    uniqueIndex("mail_directory_mailbox_idx").on(t.mailboxId),
    foreignKey({
      name: "mail_directory_mailbox_fk",
      columns: [t.tenantId, t.mailboxId],
      foreignColumns: [mailboxes.tenantId, mailboxes.id],
    }).onDelete("cascade"),
    check(
      "mail_directory_account_type_check",
      sql`${t.accountType} in ('individual', 'group')`,
    ),
  ],
);

/**
 * A person's connection to a mailbox they can read inside Yosher.
 *
 * Deliberately separate from `mailboxes`: that table says an address EXISTS,
 * this one says someone has authorized this app to read it. Provisioning a
 * mailbox for an employee does not entitle the platform to their mail — they
 * connect it themselves, through an OAuth consent screen on their own mail
 * server, and can revoke it there.
 *
 * That distinction is why no mailbox password appears anywhere in this system.
 * Tokens are stored encrypted with a key held in the environment and never in
 * the database, so the ciphertext is inert to anyone reading rows.
 *
 * RLS is member_read, which means a colleague can see that a row exists. The
 * app always filters by clerk_user_id on top; the encryption is what makes the
 * residual exposure uninteresting rather than the policy.
 */
export const mailAccounts = pgTable(
  "mail_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    mailboxId: uuid("mailbox_id").notNull(),
    /** Which platform user authorized this. Not null — nobody connects a mailbox anonymously. */
    clerkUserId: text("clerk_user_id").notNull(),
    /** Where the protocol session lives, discovered once and cached. */
    jmapSessionUrl: text("jmap_session_url").notNull().default(""),
    /** The account id inside the mail server's session object. */
    jmapAccountId: text("jmap_account_id").notNull().default(""),
    accessTokenEnc: text("access_token_enc").notNull().default(""),
    refreshTokenEnc: text("refresh_token_enc").notNull().default(""),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    /**
     * The mail server's opaque state string from the last sync. Comparing it is
     * how "has anything changed?" costs one small request instead of a refetch.
     */
    lastState: text("last_state").notNull().default(""),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    /**
     * Unread CONVERSATIONS in the inbox, cached here so the sidebar badge is an
     * indexed local read.
     *
     * The badge renders in the dashboard layout, which is `force-dynamic` and
     * runs on EVERY page in the product — a JMAP call there would put
     * mail-server latency on the invoice list and the document browser. So the
     * number is written by sync and read from Postgres, and is stale by at most
     * one sync interval. That staleness is the entire point of the column.
     *
     * Threads, not messages: the app is conversation-first, so a badge counting
     * messages would say "7" over a list showing three rows.
     */
    inboxUnread: integer("inbox_unread").notNull().default(0),
    /** connected | needs_reauth | revoked | error */
    status: text("status").notNull().default("connected"),
    lastError: text("last_error").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("mail_accounts_tenant_id_id_idx").on(t.tenantId, t.id),
    // One connection per person per mailbox. A shared box legitimately has
    // several rows, one per person who connected it.
    uniqueIndex("mail_accounts_mailbox_user_idx").on(
      t.tenantId,
      t.mailboxId,
      t.clerkUserId,
    ),
    index("mail_accounts_user_idx").on(t.tenantId, t.clerkUserId),
    foreignKey({
      name: "mail_accounts_mailbox_fk",
      columns: [t.tenantId, t.mailboxId],
      foreignColumns: [mailboxes.tenantId, mailboxes.id],
    }).onDelete("cascade"),
    check(
      "mail_accounts_status_check",
      sql`${t.status} in ('connected', 'needs_reauth', 'revoked', 'error')`,
    ),
  ],
);

/**
 * A thin index of threads, and the only place mail content is duplicated.
 *
 * The mail server owns the mail. It threads, searches, sorts and syncs better
 * than a mirror of it would, so this is NOT a mirror: there are no bodies, no
 * recipients beyond display, and no full-text index. Search goes to the mail
 * server, always.
 *
 * What lives here is the minimum that lets a *module* ask a question from its
 * own side — "every thread on this invoice" — as a SQL join rather than
 * fetching thread ids and then asking the mail server about each one. Without
 * it the business-object integration degrades into N+1 network calls, and that
 * integration is the entire reason this product exists rather than Gmail.
 */
export const mailThreadIndex = pgTable(
  "mail_thread_index",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    mailAccountId: uuid("mail_account_id").notNull(),
    /** The mail server's thread id. Opaque to us, stable to it. */
    threadId: text("thread_id").notNull(),
    subject: text("subject").notNull().default(""),
    /** Display-only addresses, for showing a thread without a round trip. */
    participants: jsonb("participants")
      .notNull()
      .default(sql`'[]'::jsonb`),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    hasAttachment: boolean("has_attachment").notNull().default(false),
    messageCount: integer("message_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("mail_thread_index_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("mail_thread_index_thread_idx").on(
      t.tenantId,
      t.mailAccountId,
      t.threadId,
    ),
    index("mail_thread_index_recent_idx").on(t.tenantId, t.lastMessageAt),
    foreignKey({
      name: "mail_thread_index_account_fk",
      columns: [t.tenantId, t.mailAccountId],
      foreignColumns: [mailAccounts.tenantId, mailAccounts.id],
    }).onDelete("cascade"),
  ],
);

/**
 * A thread attached to something the business cares about.
 *
 * This is the product. An inbox that cannot do this is a worse Gmail.
 *
 * `entity_type` deliberately carries NO check constraint. Extensions register
 * their own linkable types — Documents contributes files and folders,
 * Accounting contributes invoices and customers, and an industry layer will
 * later contribute jobs, RFIs and submittals. A constraint listing today's
 * types would have to be migrated every time a layer is added, which is
 * exactly the coupling the extension registry exists to avoid.
 *
 * Member-writable, unlike most of the email module: linking a thread to an
 * invoice is ordinary daily work, not an owner-level decision.
 */
export const mailLinks = pgTable(
  "mail_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /**
     * Which connection minted `thread_id`. NULLABLE, and the nullability is the
     * whole design (drizzle/0045).
     *
     * A thread id is opaque and only unique inside one mail account, so without
     * this column two connected accounts in one tenant that ever produce the
     * same id would have their links silently merged. Unlikely against one
     * Stalwart; a coin flip the day a Graph-backed account appears.
     *
     * It is null ONLY as a tombstone. The composite FK is declared in SQL, not
     * here, because it needs `ON DELETE SET NULL (mail_account_id)` — the
     * column-list form (PG 15+) that drizzle-kit cannot express, and which
     * matters because the plain form would try to null `tenant_id` too. That
     * rule is the dossier's promise in DDL: a link SURVIVES the person who made
     * it disconnecting the mailbox or leaving the business, which is exactly
     * when the correspondence behind an invoice is most wanted. What it loses is
     * the ability to jump back to the live thread — which is what has genuinely
     * been lost. The filed copy in Documents is still readable, and that is the
     * artifact the link is really for.
     *
     * Nothing in the app inserts null; the unique index below is therefore
     * effectively total, and NULLS DISTINCT (the default) is deliberate — it
     * means the SET NULL can never collide, so disconnecting a mailbox can never
     * fail on a constraint.
     */
    mailAccountId: uuid("mail_account_id"),
    threadId: text("thread_id").notNull(),
    /** Which extension owns this link type, so an uninstalled layer can be ignored. */
    extensionSlug: text("extension_slug").notNull(),
    /** "invoice" | "customer" | "document" | later "job", "rfi", … */
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("mail_links_tenant_id_id_idx").on(t.tenantId, t.id),
    // The account leads the thread id: "this thread, in this mailbox" is the
    // only globally meaningful way to name a conversation.
    uniqueIndex("mail_links_unique_idx").on(
      t.tenantId,
      t.mailAccountId,
      t.threadId,
      t.entityType,
      t.entityId,
    ),
    // The join a module runs: "every thread on this invoice".
    index("mail_links_entity_idx").on(t.tenantId, t.entityType, t.entityId),
    index("mail_links_thread_idx").on(t.tenantId, t.threadId),
    check(
      "mail_links_entity_type_format",
      sql`${t.entityType} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
    check(
      "mail_links_extension_slug_format",
      sql`${t.extensionSlug} ~ '^[a-z][a-z0-9_-]{0,62}$'`,
    ),
  ],
);

/**
 * Whatever an extension worked out about a thread.
 *
 * The seam that lets a layer add intelligence without the core knowing what
 * intelligence means. A construction layer will store extracted drawing
 * numbers here; accounting might store a detected invoice reference. The core
 * email module reads none of it — it only hands the blob back to the extension
 * that wrote it.
 *
 * One row per extension per thread, so a layer can be reprocessed or removed
 * without touching another layer's work.
 */
export const mailAnnotations = pgTable(
  "mail_annotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    extensionSlug: text("extension_slug").notNull(),
    data: jsonb("data")
      .notNull()
      .default(sql`'{}'::jsonb`),
    /**
     * Optimistic-concurrency counter, same contract as `documents.version`.
     *
     * An annotation is the one mail row two writers genuinely race for: a
     * reprocess and a user edit can both target the same (thread, extension)
     * pair, and last-write-wins on a jsonb blob loses the other one silently.
     * A counter turns that into a visible conflict.
     */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("mail_annotations_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("mail_annotations_unique_idx").on(
      t.tenantId,
      t.threadId,
      t.extensionSlug,
    ),
    check(
      "mail_annotations_extension_slug_format",
      sql`${t.extensionSlug} ~ '^[a-z][a-z0-9_-]{0,62}$'`,
    ),
  ],
);

/**
 * A named mail view — "unread from the accountant", "anything with files".
 *
 * **Per USER, not per tenant, and that is the difference from
 * `document_saved_views`.** A saved view in Documents can be shared with the
 * business because it names tenant data: a folder id means the same thing to
 * everybody. A mail search names a JMAP mailbox id, which is issued by the mail
 * server inside ONE person's account — hand it to a colleague and it points at
 * a folder that does not exist for them, or worse, at a different one. Sharing
 * would produce a view that silently shows the wrong thing.
 *
 * So this is the second table scoped by `app.clerk_user_id` (drizzle/0043), and
 * the reason is the same one that made mailboxes private: the row belongs to a
 * person rather than to the business.
 *
 * `query` is stored USER INPUT. It is re-parsed with Zod on every read
 * (`parseMailView`) and becomes a JMAP filter, never SQL — mail search runs on
 * the mail server, so this blob has no path to a WHERE clause even in principle.
 */
export const mailSavedSearches = pgTable(
  "mail_saved_searches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Whose search this is. Not null — nobody saves one anonymously. */
    clerkUserId: text("clerk_user_id").notNull(),
    /** Which connection's folder ids the query refers to. */
    mailAccountId: uuid("mail_account_id").notNull(),
    name: text("name").notNull(),
    /** Lowercased name, so "Unread" and "unread" cannot both exist. */
    nameKey: text("name_key").notNull(),
    query: jsonb("query")
      .notNull()
      .default(sql`'{}'::jsonb`),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("mail_saved_searches_tenant_id_id_idx").on(t.tenantId, t.id),
    // One name per person per account — a colleague's "Unread" is not a clash.
    uniqueIndex("mail_saved_searches_name_idx").on(
      t.tenantId,
      t.clerkUserId,
      t.mailAccountId,
      t.nameKey,
    ),
    index("mail_saved_searches_user_idx").on(t.tenantId, t.clerkUserId),
    // Deleting a connection takes its searches with it: they name folder ids
    // that stop meaning anything the moment the account is gone. Unlike
    // mail_links, there is no readable artifact left behind to preserve.
    foreignKey({
      name: "mail_saved_searches_account_fk",
      columns: [t.tenantId, t.mailAccountId],
      foreignColumns: [mailAccounts.tenantId, mailAccounts.id],
    }).onDelete("cascade"),
  ],
);

/**
 * A message put out of sight until a date.
 *
 * THE MESSAGE REALLY MOVES. Snoozing files it into a "Snoozed" folder on the
 * mail server and this row remembers where it came from and when to put it
 * back. The alternative — leaving it in the inbox and hiding it in Yosher —
 * would be far less code and quietly wrong: the same mailbox is open on a
 * phone and in Outlook, and a message that is only hidden in one client has
 * not been dealt with, it has been dealt with in one window.
 *
 * So this table is a REMINDER, not the truth. The mail server holds the truth.
 * If every row here were lost, no mail would be lost — a pile of messages would
 * simply sit in a visible folder called Snoozed, waiting to be dragged back by
 * hand. That is the failure mode this shape is chosen for.
 *
 * PER-USER, like mail_saved_searches and for a stronger reason. A snooze names
 * a JMAP mailbox id issued inside ONE person's account, so it cannot be shared
 * even in principle — and "remind me about this on Tuesday" is a statement
 * about somebody's week that a colleague has no business reading.
 */
export const mailSnoozes = pgTable(
  "mail_snoozes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Whose reminder this is. Nobody snoozes anonymously. */
    clerkUserId: text("clerk_user_id").notNull(),
    /** Which connection's ids the two mailbox columns below refer to. */
    mailAccountId: uuid("mail_account_id").notNull(),
    /** The JMAP Email id. Text, because the mail server issues it, not us. */
    emailId: text("email_id").notNull(),
    /**
     * Where it was, so waking it can put it back exactly there rather than
     * assuming the inbox. Somebody who snoozes out of a project folder wants it
     * to return to that folder.
     */
    returnToMailboxId: text("return_to_mailbox_id").notNull(),
    /** The folder it is parked in, so the sweep can tell it has already moved. */
    snoozeMailboxId: text("snooze_mailbox_id").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("mail_snoozes_tenant_id_id_idx").on(t.tenantId, t.id),
    /**
     * One live snooze per message per person. Snoozing something twice is a
     * double-click, not an intention, and two rows would race each other to
     * move the same message back.
     */
    uniqueIndex("mail_snoozes_message_idx").on(
      t.tenantId,
      t.clerkUserId,
      t.mailAccountId,
      t.emailId,
    ),
    /** The sweep's only query: everything due, oldest first, across tenants. */
    index("mail_snoozes_due_idx").on(t.dueAt),
    // Same reasoning as saved searches: the ids stop meaning anything when the
    // connection goes. The MAIL is untouched — it stays in the Snoozed folder
    // on the server, which is exactly where a person would look for it.
    foreignKey({
      name: "mail_snoozes_account_fk",
      columns: [t.tenantId, t.mailAccountId],
      foreignColumns: [mailAccounts.tenantId, mailAccounts.id],
    }).onDelete("cascade"),
  ],
);

/**
 * A message written and held, waiting to go out.
 *
 * WHY THIS TABLE EXISTS AT ALL, given the mail server could in principle do it:
 * `npm run mail:probe-send` asked, and this server REFUSES `sendAt` outright —
 * `invalidProperties` naming the field, and no `maxDelayedSend` advertised. So
 * "send at 7am" cannot be a JMAP submission dated in the future; it has to be a
 * draft on the mail server plus a reminder here.
 *
 * WHICH MAKES IT A REMINDER, NOT CUSTODY — exactly like `mail_snoozes`, and the
 * same failure analysis applies. **The message itself is a draft on the mail
 * server**, so losing every row in this table loses no writing: it leaves a pile
 * of finished messages sitting in Drafts, which is where somebody would look for
 * them. No body, no recipient names and no attachment ever enters this database,
 * which keeps the invariant the whole module is built on — bodies live on the
 * mail server, reachable only with the token that person authorized.
 *
 * `envelope_rcpt_to` is the one thing that looks like content and is not: it is
 * the delivery envelope, needed because the release runs from a cron with no
 * memory of the composer, and the dev guard has to be applied again at the
 * moment the message actually leaves. Addresses only, no names, no bodies.
 *
 * PER-USER, the fifth such table. Same two reasons as snoozes: the mailbox ids
 * are issued inside one account and mean nothing in another, and a list of what
 * somebody has queued to send — and to whom, and when — is correspondence.
 */
export const mailScheduledSends = pgTable(
  "mail_scheduled_sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Whose message this is. Nobody schedules anonymously. */
    clerkUserId: text("clerk_user_id").notNull(),
    /** Which connection's ids every text column below refers to. */
    mailAccountId: uuid("mail_account_id").notNull(),
    /** The JMAP Email id of the draft. Text: the mail server issues it. */
    emailId: text("email_id").notNull(),
    /** Which identity it goes out as, and the address on the envelope. */
    identityId: text("identity_id").notNull(),
    fromEmail: text("from_email").notNull(),
    draftsMailboxId: text("drafts_mailbox_id").notNull(),
    /** Null when the server names no Sent folder; the server then decides. */
    sentMailboxId: text("sent_mailbox_id"),
    /**
     * The delivery envelope, re-guarded at release. Addresses only — see the
     * table comment for why this is not a body by another name.
     */
    envelopeRcptTo: jsonb("envelope_rcpt_to")
      .notNull()
      .default(sql`'[]'::jsonb`),
    sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("mail_scheduled_sends_tenant_id_id_idx").on(t.tenantId, t.id),
    /**
     * One pending send per draft. Scheduling the same message twice is a
     * double-click, and two rows would race to submit the same draft — which
     * would send it twice.
     */
    uniqueIndex("mail_scheduled_sends_message_idx").on(
      t.tenantId,
      t.clerkUserId,
      t.mailAccountId,
      t.emailId,
    ),
    /** The sweep's only query: everything due, oldest first, across tenants. */
    index("mail_scheduled_sends_due_idx").on(t.sendAt),
    // Same reasoning as snoozes: the ids stop meaning anything when the
    // connection goes. The DRAFT is untouched and stays in the mail server's
    // Drafts folder, which is exactly where a person would look for it.
    foreignKey({
      name: "mail_scheduled_sends_account_fk",
      columns: [t.tenantId, t.mailAccountId],
      foreignColumns: [mailAccounts.tenantId, mailAccounts.id],
    }).onDelete("cascade"),
  ],
);

/**
 * A rule the mail server runs on arrival.
 *
 * These rows are the SOURCE, not the truth. They compile to one Sieve script
 * (`rules/compile.ts`) that lives on the mail server and executes there — which
 * is the entire point, because it fires for mail that arrives while nobody is
 * signed in, and it applies to the phone and Outlook as much as to Yosher.
 *
 * Losing this table would leave the last compiled script still running. That is
 * the right failure: mail keeps being sorted, and the rules simply cannot be
 * edited until they are rebuilt.
 *
 * PER-USER, like snoozes and saved searches. `file_into_mailbox_id` is a JMAP
 * id issued inside one person's account, and a Sieve script belongs to the
 * account it runs in — a colleague's rule is not merely private, it is
 * meaningless in anyone else's mailbox.
 */
export const mailRules = pgTable(
  "mail_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    mailAccountId: uuid("mail_account_id").notNull(),
    name: text("name").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    /** Every test must match, or any one of them. */
    matchMode: text("match_mode").notNull().default("all"),
    /** `RuleTest[]` from rules/compile.ts. Validated by Zod at the boundary. */
    tests: jsonb("tests").notNull().default(sql`'[]'::jsonb`),
    /** `RuleAction` from rules/compile.ts. */
    action: jsonb("action").notNull().default(sql`'{}'::jsonb`),
    /** Stop processing later rules once this one matches. */
    stopAfter: boolean("stop_after").notNull().default(true),
    /**
     * Evaluation order, and it is semantic rather than cosmetic: `stop` means
     * "and nothing after this", so reordering rules changes where mail lands.
     */
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("mail_rules_tenant_id_id_idx").on(t.tenantId, t.id),
    index("mail_rules_user_idx").on(t.tenantId, t.clerkUserId, t.mailAccountId),
    foreignKey({
      name: "mail_rules_account_fk",
      columns: [t.tenantId, t.mailAccountId],
      foreignColumns: [mailAccounts.tenantId, mailAccounts.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Canned responses — and the FIRST mail table scoped to the business rather
 * than to one person.
 *
 * Every mail table before this one is per-user, for reasons that do not apply
 * here: they hold correspondence, or ids the mail server issued inside one
 * account. A template holds neither. It is boilerplate somebody wrote in order
 * that it be reused — "our payment terms", "thanks for the enquiry" — and the
 * reuse is the entire point.
 *
 * WHY IT IS NOT ON THE MAIL SERVER, unlike rules, the auto-reply, the signature
 * and labels. `npm run mail:probe-templates` confirmed the server CAN hold one:
 * a `$draft` message in a mailbox of its own is exactly what Gmail's canned
 * responses were, it round-trips its markup, and it does not pollute the Drafts
 * folder. It was rejected anyway, because every mail-server location is scoped
 * to ONE ACCOUNT — so sharing the company's payment-terms wording with a
 * colleague would mean granting them the mailbox it lives in, and every message
 * in it. **There is no way to share a template on the mail server without
 * sharing the correspondence**, and a template that dies when its author leaves
 * the business is not a business asset.
 *
 * That cost is real and accepted: a template does NOT appear on a phone or in
 * Outlook, and it is the first mail feature since Slice 0 of which that is
 * true. Being usable by the whole company is worth more than being usable in
 * another client, which is the opposite of how every previous call went.
 *
 * `mail_account_id` is deliberately ABSENT. A template belongs to the business,
 * not to a mailbox, so the same wording is available from a personal box and
 * from a shared `info@` without being stored twice.
 *
 * Same shape as `document_templates` (0033/0034), which settled this question
 * for the other module that has templates: tenant-scoped, `member_all`, with
 * the author recorded rather than enforced. A colleague editing the payment
 * terms is somebody doing their job.
 */
export const mailTemplates = pgTable(
  "mail_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Case/space-folded, so "Payment terms" and "payment  terms" collide. */
    nameKey: text("name_key").notNull(),
    /**
     * Filled into the composer's subject ONLY when it is empty, so applying a
     * template to a reply cannot rewrite "Re: …". Empty means "this template
     * has nothing to say about the subject", which is different from "".
     */
    subject: text("subject").notNull().default(""),
    /**
     * The body, already through `sanitizeOutboundHtml`.
     *
     * Stored sanitized as well as sanitized again at send, for the reason the
     * signature slice recorded: this is markup that goes out under somebody's
     * own name, many times. The send path is the guarantee; storing it clean
     * means the editor cannot show one thing and the recipient receive another.
     *
     * No inline images. A `cid:` is minted per message and lives in that
     * message's MIME, so a stored template referencing one would show a broken
     * image on every mail it was later inserted into — the same reason the
     * signature editor has no picture button.
     */
    bodyHtml: text("body_html").notNull().default(""),
    /** Who wrote it. Recorded for the audit trail, not used to restrict edits. */
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("mail_templates_tenant_id_id_idx").on(t.tenantId, t.id),
    // One name per business. Two templates called "Payment terms" is a
    // list nobody can choose from at the moment they are trying to write.
    uniqueIndex("mail_templates_tenant_name_idx").on(t.tenantId, t.nameKey),
    check("mail_templates_name_not_blank", sql`length(btrim(${t.name})) > 0`),
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
export type DocumentFolder = typeof documentFolders.$inferSelect;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type DocumentTag = typeof documentTags.$inferSelect;
export type DocumentSavedView = typeof documentSavedViews.$inferSelect;
export type DocumentTemplate = typeof documentTemplates.$inferSelect;
export type DocumentTemplateVersion =
  typeof documentTemplateVersions.$inferSelect;
export type DocumentGeneration = typeof documentGenerations.$inferSelect;
export type DocumentSettings = typeof documentSettings.$inferSelect;
export type EmailDomain = typeof emailDomains.$inferSelect;
export type OutboundEmail = typeof outboundEmails.$inferSelect;
/** One normalized DNS row for the setup wizard. */
export type EmailDnsRecord = {
  record: string;
  type: string;
  name: string;
  value: string;
  ttl: string;
  priority?: number;
  status?: string;
};
export type MailboxDomain = typeof mailboxDomains.$inferSelect;
export type Mailbox = typeof mailboxes.$inferSelect;
/**
 * What the domain's MX looked like before we changed it. Stored so that
 * "put it back" is a stored fact rather than a memory test during an outage.
 */
export type PreviousMxRecord = { host: string; priority: number };
export type MailDirectoryAccount = typeof mailDirectoryAccounts.$inferSelect;
export type MailAccount = typeof mailAccounts.$inferSelect;
export type MailThreadIndexRow = typeof mailThreadIndex.$inferSelect;
export type MailLink = typeof mailLinks.$inferSelect;
export type MailAnnotation = typeof mailAnnotations.$inferSelect;
export type MailSavedSearch = typeof mailSavedSearches.$inferSelect;
export type MailSnooze = typeof mailSnoozes.$inferSelect;
export type MailRuleRow = typeof mailRules.$inferSelect;
export type MailTemplate = typeof mailTemplates.$inferSelect;
export type MailScheduledSend = typeof mailScheduledSends.$inferSelect;
/** Display-only participants on an indexed thread. */
export type MailParticipant = { name: string; email: string };
export type DocumentShare = typeof documentShares.$inferSelect;
export type DocumentShareEvent = typeof documentShareEvents.$inferSelect;
/** Derived, never stored — see modules/documents/shares/status.ts. */
export type ShareStatus =
  | "active"
  | "revoked"
  | "expired"
  | "exhausted"
  | "locked"
  | "suspended";
export type ShareEventKind =
  | "viewed"
  | "unlocked"
  | "downloaded"
  | "denied_passcode"
  | "denied_scope"
  | "budget_hit";
/** The two surfaces sharing the `documents` table. */
export type DocumentOrigin = "accounting" | "dms";
/** Folder access: every member, or tenant owners only. Inherited by children. */
export type DocumentVisibility = "members" | "owners";
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
