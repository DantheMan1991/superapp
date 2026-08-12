/**
 * Accounts receivable: customers, invoices, payments, recurring schedules.
 *
 * Split out of the former single-file `src/db/schema.ts`; `./index.ts`
 * re-exports every domain, so `@/db/schema` still resolves exactly as before.
 */
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
import { tenants } from "./platform";
import { parties } from "./parties";
import { accounts, dimensionMembers, entryEditPolicy, journalEntries, journalLines } from "./ledger";
import { billLines } from "./payables";

export const invoiceStatus = pgEnum("invoice_status", [
  "draft",
  "issued",
  "partial",
  "paid",
  "void",
]);

export const recurringFrequency = pgEnum("recurring_frequency", ["monthly"]);

/* ------------------------------------------------------------------------
 * Catalogue (2026-08-12): the three lists a business reuses on every
 * invoice — what it sells, when it expects to be paid, and how the money
 * arrived. All three are per-tenant reference data, seeded with sensible
 * defaults when accounting is provisioned and freely editable after.
 * ---------------------------------------------------------------------- */

export const productKind = pgEnum("product_kind", ["service", "product"]);

/**
 * Something the business sells often enough to be worth saving.
 *
 * Deliberately NOT inventory. There is no quantity on hand, no cost of
 * goods tracking and no stock movement — this is a saved LINE, so the
 * tenth invoice for the same job does not need the description and price
 * typed again. Real inventory is a different feature with a different data
 * model, and calling this "products" is already the generous reading.
 */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    kind: productKind("kind").notNull().default("service"),
    /** Default unit price in cents. Signed, so a saved discount is possible. */
    unitPriceCents: bigint("unit_price_cents", { mode: "number" })
      .notNull()
      .default(0),
    /** Where an invoice line for this lands. Nullable: sell-only or buy-only. */
    incomeAccountId: uuid("income_account_id"),
    /** Where a bill line for this lands. Nullable for the same reason. */
    expenseAccountId: uuid("expense_account_id"),
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
    uniqueIndex("products_tenant_id_id_idx").on(t.tenantId, t.id),
    index("products_tenant_active_idx").on(t.tenantId, t.isActive),
    // Two saved lines with the same name is a duplicate, not a fact.
    uniqueIndex("products_tenant_name_idx").on(t.tenantId, t.name),
    foreignKey({
      name: "products_income_account_fk",
      columns: [t.tenantId, t.incomeAccountId],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
    foreignKey({
      name: "products_expense_account_fk",
      columns: [t.tenantId, t.expenseAccountId],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
  ],
);

/**
 * When payment is expected, as a named rule.
 *
 * `due_in_days` is the whole of the arithmetic: due date = issue date + N.
 * Deliberately no "net EOM" or "2/10 net 30" — early-payment discounts
 * change what is OWED, which is a posting question rather than a date
 * question, and inventing half of it would be worse than not having it.
 */
export const paymentTerms = pgTable(
  "payment_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dueInDays: integer("due_in_days").notNull().default(0),
    /** The one offered first on a new invoice. At most one per tenant. */
    isDefault: boolean("is_default").notNull().default(false),
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
    uniqueIndex("payment_terms_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("payment_terms_tenant_name_idx").on(t.tenantId, t.name),
    // At most one default, enforced by the database rather than by care.
    uniqueIndex("payment_terms_tenant_default_idx")
      .on(t.tenantId)
      .where(sql`${t.isDefault} = true`),
    check("payment_terms_due_in_days", sql`${t.dueInDays} between 0 and 365`),
  ],
);

/**
 * How money arrived, as a list the tenant owns.
 *
 * `invoice_payments.method` stays TEXT and keeps its existing values — the
 * five that used to be a zod enum are seeded as rows so historic payments
 * still resolve to a name. This table decides what the dropdown OFFERS; it
 * is not a foreign key, because renaming or deactivating a method must
 * never rewrite what a posted payment recorded.
 */
export const paymentMethods = pgTable(
  "payment_methods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Stored into `invoice_payments.method`. Stable once used. */
    code: text("code").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
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
    uniqueIndex("payment_methods_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("payment_methods_tenant_code_idx").on(t.tenantId, t.code),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /**
     * The identity behind this AR relationship. This row is now a ROLE — "a
     * party we invoice" — and `parties` is who they are.
     *
     * Declared NOT NULL here because that is the settled state; the column
     * arrived nullable in 0059 and was enforced in 0062 only after the backfill
     * (see docs/modules/crm.md). Nothing in this file can express that
     * sequence, which is why those two migrations are hand-written.
     */
    partyId: uuid("party_id").notNull(),
    name: text("name").notNull(),
    /**
     * NO `email` OR `phone`. They were dropped in 0075 — the contract half of
     * the expand/contract that `party_contact_points` began — because a way of
     * reaching a business is one of several and a column can hold one. The
     * customer form still asks for them and writes them there.
     *
     * `address` and `notes` STAY, and the asymmetry is deliberate rather than
     * an unfinished job: nothing yet reads a postal address that this does not
     * serve, and `party_addresses` is recorded as deferred in
     * docs/modules/crm.md rather than built with no reader.
     */
    address: text("address").notNull().default(""),
    notes: text("notes").notNull().default(""),
    isActive: boolean("is_active").notNull().default(true),
    /**
     * Never chase this customer automatically — the big account you would
     * rather phone. Standing, so it covers invoices that do not exist yet;
     * `invoices.reminders_muted` is the one-off counterpart for a single
     * disputed invoice.
     */
    remindersMuted: boolean("reminders_muted").notNull().default(false),
    /**
     * This customer's usual terms, overriding the tenant default. Null means
     * "whatever the default is" rather than "no terms" — so changing the
     * default moves every customer who never had a special arrangement.
     */
    paymentTermsId: uuid("payment_terms_id"),
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
    foreignKey({
      name: "customers_payment_terms_fk",
      columns: [t.tenantId, t.paymentTermsId],
      foreignColumns: [paymentTerms.tenantId, paymentTerms.id],
    }),
    // A party holds the customer role at most once. Two AR relationships with
    // the same identity is a duplicate, not a fact.
    uniqueIndex("customers_tenant_party_idx").on(t.tenantId, t.partyId),
    foreignKey({
      name: "customers_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }),
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
    /** Stop chasing this one invoice — a dispute, or a payment plan agreed by
     * phone. Distinct from muting the customer, which is standing. */
    remindersMuted: boolean("reminders_muted").notNull().default(false),
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
    // `bookkeeping_timezone` lived here from 0007 until 0088. The business
    // day is `tenants.timezone` now — one clock, readable by every module.
    /**
     * Automatic invoice reminders. OFF is the only safe default: these emails
     * go to the tenant's CUSTOMERS, so nothing may start sending because a
     * migration ran — an owner turns it on deliberately.
     */
    remindersEnabled: boolean("reminders_enabled").notNull().default(false),
    /**
     * Days relative to the due date, negative = before it: `[-3, 0, 7, 14, 30]`
     * means a nudge three days out, one on the day, then chasing.
     *
     * jsonb and zod-validated at write AND re-read, the same contract
     * `recurring_invoices.template` keeps — an offsets list an owner edited
     * last year has to survive a validator that has since got stricter, and
     * failing one tenant's sweep is better than failing the run.
     */
    reminderOffsets: jsonb("reminder_offsets").notNull().default([-3, 0, 7, 14, 30]),
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
    /**
     * AI thread-drafting cooldown marker (15s). Its own, like every other
     * tool's — the point of separate markers is that one tool's cooldown never
     * blocks a different one. This is the most expensive call in the module (a
     * whole conversation, with thinking on), so it is also the one most worth
     * throttling.
     */
    aiLastThreadDraftAt: timestamp("ai_last_thread_draft_at", {
      withTimezone: true,
    }),
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

export type LineDimension = typeof lineDimensions.$inferSelect;

export type AccountingSettings = typeof accountingSettings.$inferSelect;

export type Customer = typeof customers.$inferSelect;

export type Invoice = typeof invoices.$inferSelect;

export type InvoiceLine = typeof invoiceLines.$inferSelect;

export type InvoicePayment = typeof invoicePayments.$inferSelect;

export type RecurringInvoice = typeof recurringInvoices.$inferSelect;

export type Product = typeof products.$inferSelect;

export type PaymentTerm = typeof paymentTerms.$inferSelect;

export type PaymentMethod = typeof paymentMethods.$inferSelect;
