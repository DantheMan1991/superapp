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
import {
  accounts,
  dimensionMembers,
  entities,
  entryEditPolicy,
  journalEntries,
  journalLines,
} from "./ledger";
import { billLines, vendors } from "./payables";

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

/**
 * A sales tax rate the business charges, as a list the tenant owns.
 *
 * Deliberately FLAT — a named rate and a number, no jurisdictions and no nexus
 * rules. Resolving a rate from a delivery address is an address-resolution
 * product (a rate service, an agency registry, a filing calendar, economic
 * nexus thresholds); this is the list a small business keeps in its head. When
 * a combined rate needs splitting for a return, that is a
 * `sales_tax_rate_components` child table and per-component tax lines, both
 * additive to this shape.
 *
 * UNLIKE `payment_terms` AND `payment_methods`, NOTHING IS SEEDED. "Net 30" is
 * a sensible default everywhere; there is no tax rate that is right anywhere,
 * and a seeded 0% or 7% is a wrong number on somebody's invoice. A tenant with
 * no rates simply has no tax controls, which is the correct state for most of
 * them — so `provisionCatalogue` does not touch this table and the "Add the
 * standard set" restore does not apply to it.
 */
export const salesTaxRates = pgTable(
  "sales_tax_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /**
     * The rate in PARTS PER MILLION of the taxable amount: 7.25% → 72_500.
     *
     * Basis points are not enough and that is arithmetic, not fussiness —
     * 8.875% (New York City) is 887.5 basis points, which is not an integer.
     * Percent × 10,000 carries four decimal places of percent, which covers
     * every real US rate. Integer because every other number in this module is.
     */
    ratePpm: integer("rate_ppm").notNull(),
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
    uniqueIndex("sales_tax_rates_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("sales_tax_rates_tenant_name_idx").on(t.tenantId, t.name),
    // At most one default, enforced by the database rather than by care —
    // the same partial unique `payment_terms` uses.
    uniqueIndex("sales_tax_rates_tenant_default_idx")
      .on(t.tenantId)
      .where(sql`${t.isDefault} = true`),
    // 0% is legitimate (a zero-rated category still wants naming); over 100%
    // is somebody typing 725 for 7.25%.
    check("sales_tax_rates_rate_ppm", sql`${t.ratePpm} between 0 and 1000000`),
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

/* ------------------------------------------------------------------------
 * Recurring entries live HERE rather than in payables.ts, and the reason is
 * a dependency cycle rather than taste: an invoice template references
 * `customers`, which is defined in this file, while a bill template
 * references `vendors` in payables.ts. payables.ts cannot import invoicing
 * (invoicing already imports `bill_lines` from it), and a circular import
 * between two eagerly-evaluated drizzle schema files is a real breakage.
 * This file can reach both, so the table sits here.
 * ---------------------------------------------------------------------- */

export const recurringEntryKind = pgEnum("recurring_entry_kind", [
  "journal",
  "bill",
  "invoice",
]);

/**
 * EVERYTHING the books produce on a schedule: invoices, bills and journals.
 *
 * It began as the two the module could not express at all — the QuickBooks file
 * this is benchmarked against runs a monthly depreciation JOURNAL — and
 * absorbed `recurring_invoices` on 2026-08-12 (`0121`/`0122`), so there is one
 * recurrence mechanism rather than two.
 *
 * ONE TABLE WITH A `kind`, not one table per kind, because everything except
 * the payload is identical: a name, a monthly day, a next run date, a catch-up
 * position and an active flag. `template` is jsonb, zod-validated at write AND
 * re-validated at generation — accounts, customers and vendors may all have
 * deactivated since it was saved.
 *
 * `recurring_invoices` and `invoices.recurring_invoice_id` are GONE
 * (`drizzle/0147`). They outlived the fold by one release because a DROP must
 * follow the deploy that stopped selecting them, never precede it
 * (docs/conventions.md 4).
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
    /** Invoices only. The other half of what used to be `recurring_invoices`. */
    customerId: uuid("customer_id"),
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
    foreignKey({
      name: "recurring_entries_customer_fk",
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    // 1–28 keeps month advancement a total function, same as recurring_invoices.
    check("recurring_entries_day_of_month", sql`${t.dayOfMonth} between 1 and 28`),
    /**
     * Each kind names EXACTLY the party it needs and no other. A bill owes a
     * vendor, an invoice is owed by a customer, a journal has no counterparty
     * at all — and the database says so rather than trusting three call sites
     * to remember.
     */
    /**
     * Compared as TEXT, not as the enum, and that is load-bearing rather than
     * stylistic: Postgres refuses to USE a newly added enum label in the same
     * transaction that adds it (`check_safe_enum_use`), so a constraint naming
     * `'invoice'` alongside `ALTER TYPE ... ADD VALUE 'invoice'` fails outright.
     * Casting sidesteps it without splitting the migration in two. Found by
     * running it against the dev branch.
     */
    check(
      "recurring_entries_party_shape",
      sql`(${t.kind}::text = 'bill' and ${t.vendorId} is not null and ${t.customerId} is null)
       or (${t.kind}::text = 'invoice' and ${t.customerId} is not null and ${t.vendorId} is null)
       or (${t.kind}::text = 'journal' and ${t.vendorId} is null and ${t.customerId} is null)`,
    ),
    // Auto-post is a journal-only affordance; a bill posts by being approved.
    check(
      "recurring_entries_auto_post_shape",
      sql`${t.autoPost} = false or ${t.kind} = 'journal'`,
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
    /**
     * Which company's books this document belongs to (ADR 0010).
     *
     * THE DOCUMENT DECIDES, and every entry it ever posts follows it — issuance
     * and each payment. Before this column those entries took the tenant's
     * DEFAULT company and inherited from each other, which meant moving the
     * default between issuing and being paid split one document's AR across two
     * balance sheets. Now there is nothing to inherit from.
     *
     * NOT NULL in the database since `drizzle/0146`. It arrived nullable in
     * `0145` and was closed a release later, because migrations precede deploys
     * and the deploy running while `0145` landed did not write it. Worth knowing
     * before adding the next required column here.
     */
    entityId: uuid("entity_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    status: invoiceStatus("status").notNull().default("draft"),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }),
    memo: text("memo").notNull().default(""),
    /** Stop chasing this one invoice — a dispute, or a payment plan agreed by
     * phone. Distinct from muting the customer, which is standing. */
    remindersMuted: boolean("reminders_muted").notNull().default(false),
    /* ----------------------------------------------------------------------
     * Sales tax (2026-08-13). The three columns below are FROZEN at write:
     * they record the tax this invoice charges, not a live view of the rate.
     * Editing or deactivating a rate afterwards must never re-price a document
     * somebody has already been sent, and must never make the invoice on
     * screen disagree with the entry in the ledger.
     * -------------------------------------------------------------------- */
    /** Which rate was chosen. Null = no tax on this invoice. */
    taxRateId: uuid("tax_rate_id"),
    /**
     * The rate AS APPLIED, copied rather than referenced. This is the freeze:
     * `sales_tax_rates.rate_ppm` may change tomorrow, and this invoice still
     * means what it meant. See salesTaxRates for what ppm is.
     */
    taxRatePpm: integer("tax_rate_ppm").notNull().default(0),
    /** Σ taxable line amounts × the rate, rounded ONCE (invoicing/tax.ts). */
    taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
    /** Σ line amounts, before tax. */
    subtotalCents: bigint("subtotal_cents", { mode: "number" })
      .notNull()
      .default(0),
    /**
     * What the customer owes: `subtotal_cents + tax_cents`.
     *
     * The MEANING has not changed since session 4 — it has always been the
     * amount owed — which is why the overpayment guard, aging, the MoneyBar,
     * reminders, the PDF balance and bank matching all keep working with tax
     * switched on. Only the value moved.
     *
     * `total = subtotal + tax` is a CHECK from `drizzle/0147`. It could not
     * ship with `0123`: a migration goes out AHEAD of the deploy
     * (docs/conventions.md 4), and the deployment running then wrote
     * `total_cents` without touching `subtotal_cents`, so the constraint would
     * have rejected every draft edit in that window. Every write path has
     * written all three together since, which is what made it safe to add.
     */
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    /** The issuance entry. Null while draft; survives void (audit trail). */
    journalEntryId: uuid("journal_entry_id"),
    /** The template that generated this invoice, in the unified table. */
    recurringEntryId: uuid("recurring_entry_id"),
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
    index("invoices_tenant_entity_idx").on(t.tenantId, t.entityId),
    index("invoices_tenant_customer_idx").on(t.tenantId, t.customerId),
    // One invoice per issuance entry — mirrors bank_transactions.
    uniqueIndex("invoices_tenant_entry_idx")
      .on(t.tenantId, t.journalEntryId)
      .where(sql`${t.journalEntryId} is not null`),
    foreignKey({
      name: "invoices_entity_fk",
      columns: [t.tenantId, t.entityId],
      foreignColumns: [entities.tenantId, entities.id],
    }),
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
      name: "invoices_recurring_entry_fk",
      columns: [t.tenantId, t.recurringEntryId],
      foreignColumns: [recurringEntries.tenantId, recurringEntries.id],
    }),
    // NO ACTION, like every other reference-list FK here: a rate named on an
    // issued invoice may not be deleted out from under it.
    foreignKey({
      name: "invoices_tax_rate_fk",
      columns: [t.tenantId, t.taxRateId],
      foreignColumns: [salesTaxRates.tenantId, salesTaxRates.id],
    }),
    check("invoices_total_nonnegative", sql`${t.totalCents} >= 0`),
    // The arithmetic the document states, enforced rather than trusted. Owed
    // since `0123` and deferred for the reason on `totalCents` above.
    check(
      "invoices_total_is_subtotal_plus_tax",
      sql`${t.totalCents} = ${t.subtotalCents} + ${t.taxCents}`,
    ),
    // Safe in the same migration as the column: the previous deployment never
    // writes this, and its DEFAULT 0 satisfies the constraint. The
    // total = subtotal + tax CHECK is not, and waits for the follow-up.
    check("invoices_tax_nonnegative", sql`${t.taxCents} >= 0`),
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
    /**
     * Whether the invoice's tax rate applies to THIS line.
     *
     * One rate per invoice, taxability per line — the split that lets a trade
     * bill exempt labour and taxed materials on one document, which is the
     * common case wherever services are exempt and goods are not. It is a
     * boolean rather than a second rate on purpose: two rates on one invoice is
     * a different feature (per-component tax lines) and this is not half of it.
     *
     * DEFAULT false so every line that existed before tax did reads as
     * untaxed, which is what those invoices charged.
     */
    isTaxable: boolean("is_taxable").notNull().default(false),
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
    // `closed_through` lived here from session 7 until ADR 0010 slice 4, and
    // was dropped from the database by `drizzle/0153` once this file had
    // stopped declaring it and that deploy was live. The lock is a property of
    // a SET OF BOOKS, and a tenant can hold several: it is
    // `entities.closed_through` now.
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


export type RecurringEntry = typeof recurringEntries.$inferSelect;

export type Product = typeof products.$inferSelect;

export type PaymentTerm = typeof paymentTerms.$inferSelect;

export type PaymentMethod = typeof paymentMethods.$inferSelect;

export type SalesTaxRate = typeof salesTaxRates.$inferSelect;
