/**
 * Double-entry core: chart of accounts, journal entries and lines.
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
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";

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
  /**
   * Posted by the `assets` pack from a depreciation schedule. Added in
   * drizzle/0127, alone in its own migration — an enum value cannot be used in
   * the transaction that adds it.
   *
   * Deliberately NOT in MANAGED_SOURCES (core/guards.ts): invoice and bill
   * entries are protected from journal-voiding because that would desync a
   * document's status and aging, whereas a depreciation entry owns no document
   * and reversing one is an ordinary correction.
   */
  "depreciation",
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
 * THE PARTY SPINE (CRM slice 0) — shared, and owned by NEITHER module.
 *
 * One row per person or organization a tenant deals with. `customers` and
 * `vendors` below stop being identities and become ROLES on a party: "someone
 * we invoice", "someone we pay". A business that is both is one party with two
 * role rows, which is the fact neither table could previously express.
 *
 * WHY IT IS NOT OWNED BY CRM, which is the module it was built for. A tenant
 * can buy Accounting without CRM, so accounting can never reference a `crm_*`
 * table — and two customer lists is precisely the failure CRM exists to
 * prevent. `documents` already answered this shape once (one table, two
 * surfaces, `origin` discriminating), so the writer lives at `src/lib/parties/`
 * rather than inside either module. eslint.config.mjs states the general rule:
 * genuinely shared code moves to src/lib/.
 *
 * NOTE the platform `tenants` table is the FOUNDER'S CRM — a different thing at
 * a different layer, and unrelated to this.
 *
 * THERE IS NO EMAIL, PHONE OR ADDRESS COLUMN HERE, AND THAT IS THE DESIGN.
 * A company has several offices and billing addresses; a person has a work
 * address and a personal one. A single `email` here would be canonical within a
 * week and would then have to be unpicked from every read site that had come to
 * rely on it. So this table commits to nothing: `party_contact_points` is the
 * typed multi-value answer and is now the ONLY store for an email or a phone —
 * `customers.email` and `vendors.email` were retired in 0075. A postal address
 * is still `customers.address`; `party_addresses` is deferred, deliberately, and
 * has the same shape waiting. Do not add a column here as a convenience — see
 * docs/modules/crm.md.
 * ---------------------------------------------------------------------- */

export type Account = typeof accounts.$inferSelect;

export type JournalEntry = typeof journalEntries.$inferSelect;

export type JournalLine = typeof journalLines.$inferSelect;

export type DimensionMember = typeof dimensionMembers.$inferSelect;
