/**
 * Accounts payable: vendors, bills, bill payments — the AP mirror of invoicing.
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
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";
import { parties } from "./parties";
import { accounts, journalEntries } from "./ledger";

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
    /**
     * The identity behind this AP relationship — the mirror of
     * `customers.party_id`. A business that both invoices us and buys from us
     * is ONE party holding two role rows, which is the fact these two tables
     * could not previously express.
     */
    partyId: uuid("party_id").notNull(),
    name: text("name").notNull(),
    /** No `email` or `phone` since 0075 — see the note on `customers`. */
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
    uniqueIndex("vendors_tenant_party_idx").on(t.tenantId, t.partyId),
    foreignKey({
      name: "vendors_default_account_fk",
      columns: [t.tenantId, t.defaultExpenseAccountId],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
    foreignKey({
      name: "vendors_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
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

export const recurringEntryKind = pgEnum("recurring_entry_kind", [
  "journal",
  "bill",
]);

/**
 * Things the books produce on a schedule that are NOT invoices.
 *
 * The QuickBooks file this module is benchmarked against carries a monthly
 * depreciation JOURNAL, which we could not express at all — the only recurrence
 * we had was `recurring_invoices`, and an invoice is the one recurring document
 * that has a customer and a due date.
 *
 * ONE TABLE WITH A `kind`, not one table per kind, because everything except
 * the payload is identical: a name, a monthly day, a next run date, a catch-up
 * position and an active flag. `template` is jsonb, zod-validated at write AND
 * re-validated at generation, the same contract `recurring_invoices.template`
 * keeps — accounts and vendors may have deactivated since it was saved.
 *
 * `recurring_invoices` is NOT folded in here yet, and that is a deliberate
 * limit rather than an oversight: it is a live table with rows, its own UI and
 * a customer FK, so absorbing it means a data migration and a rewrite that this
 * change did not need. `kind` has room for `'invoice'` when that is worth
 * doing; until then the module has two recurrence mechanisms and this comment
 * is the honest record of it.
 */
export const recurringEntries = pgTable(
  "recurring_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: recurringEntryKind("kind").notNull(),
    name: text("name").notNull(),
    /** Bills only; a journal has no counterparty. */
    vendorId: uuid("vendor_id"),
    /** Shape depends on `kind` — see modules/accounting/recurring/template.ts. */
    template: jsonb("template").notNull(),
    /**
     * NO `frequency` COLUMN, unlike `recurring_invoices`.
     *
     * That enum has exactly one value (`monthly`), so the column carries no
     * information — and importing it here would make `payables` depend on
     * `invoicing`, which already depends on `payables` for `bill_lines`. A
     * circular import between two eagerly-evaluated drizzle schema files is a
     * real breakage, not a style question. When a second cadence actually
     * arrives it earns a column then, in both tables at once.
     */
    dayOfMonth: integer("day_of_month").notNull(),
    nextRunDate: date("next_run_date", { mode: "string" }).notNull(),
    /**
     * JOURNALS ONLY, and off by default.
     *
     * The same decision bank rules already carry: a template is a decision the
     * owner wrote down, replayed deterministically, so it MAY post — unlike a
     * model's guess, which never may. A monthly depreciation entry you have to
     * approve by hand is the chore this feature exists to remove. It still
     * never overrides the period lock: a run landing in a closed period leaves
     * a draft instead, exactly as an auto-posting rule does.
     */
    autoPost: boolean("auto_post").notNull().default(false),
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
    uniqueIndex("recurring_entries_tenant_id_id_idx").on(t.tenantId, t.id),
    index("recurring_entries_tenant_next_idx")
      .on(t.tenantId, t.nextRunDate)
      .where(sql`${t.isActive} = true`),
    foreignKey({
      name: "recurring_entries_vendor_fk",
      columns: [t.tenantId, t.vendorId],
      foreignColumns: [vendors.tenantId, vendors.id],
    }),
    // 1–28 keeps month advancement a total function, same as recurring_invoices.
    check("recurring_entries_day_of_month", sql`${t.dayOfMonth} between 1 and 28`),
    // A bill needs somebody to owe; a journal must not name one.
    check(
      "recurring_entries_vendor_shape",
      sql`(${t.kind} = 'bill' and ${t.vendorId} is not null)
       or (${t.kind} = 'journal' and ${t.vendorId} is null)`,
    ),
    // Auto-post is a journal-only affordance; a bill posts by being approved.
    check(
      "recurring_entries_auto_post_shape",
      sql`${t.autoPost} = false or ${t.kind} = 'journal'`,
    ),
  ],
);

export type Vendor = typeof vendors.$inferSelect;

export type Bill = typeof bills.$inferSelect;

export type BillLine = typeof billLines.$inferSelect;

export type BillPayment = typeof billPayments.$inferSelect;

export type RecurringEntry = typeof recurringEntries.$inferSelect;
