/**
 * Bank feeds and reconciliation, including the Plaid item state.
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
import { accounts, entities, journalEntries, journalLines } from "./ledger";
// One-way: payables knows nothing of banking, so the payee FK does not cycle.
import { vendors } from "./payables";

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

/** Which side of the register a rule is allowed to match. */
export const bankRuleAppliesTo = pgEnum("bank_rule_applies_to", [
  "money_in",
  "money_out",
  "both",
]);

/** Whether every condition must hold, or any one of them. */
export const bankRuleMatchMode = pgEnum("bank_rule_match_mode", ["all", "any"]);

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
    /**
     * Which company owns this register (ADR 0010).
     *
     * A BANK ACCOUNT BELONGS TO EXACTLY ONE COMPANY — an account is a thing
     * with a balance, and a balance belongs on one balance sheet. The LEDGER
     * account it clears stays part of the shared chart, so two companies each
     * have their own register on their own account code (1000, 1010) while the
     * chart itself is still managed in one place.
     *
     * The posting engine enforces the consequence: a journal line may not touch
     * a register owned by a different company than the entry (`postEntry`).
     * Paying one company's bill from another's account is an INTERCOMPANY
     * transaction and needs a linked pair of entries, which is slice 2 — until
     * then it is refused rather than mis-recorded.
     *
     * NOT NULL one release ahead of the database; see `0145`/`0146`.
     */
    entityId: uuid("entity_id").notNull(),
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
    index("bank_accounts_tenant_entity_idx").on(t.tenantId, t.entityId),
    foreignKey({
      name: "bank_accounts_entity_fk",
      columns: [t.tenantId, t.entityId],
      foreignColumns: [entities.tenantId, entities.id],
    }),
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
    /**
     * {ruleId, ruleName, accountId, accountCode, memo?, at} | null.
     *
     * Deliberately a snapshot rather than an FK to `bank_rules`: a suggestion
     * is a statement about what a rule said AT MATCH TIME, and editing or
     * deleting the rule afterwards must not silently rewrite or erase what the
     * owner is being shown. Same reasoning as `journal_entry_id`'s NO ACTION
     * link — the app unlinks, the database does not cascade meaning.
     */
    ruleSuggestion: jsonb("rule_suggestion"),
    /**
     * Who the money went to or came from, once somebody (or a rule) says so.
     *
     * The bank only ever gives us a description; the payee is a judgement laid
     * over it. Kept on the STAGING row rather than the ledger because a
     * journal entry has no party column, and inventing one for this would be a
     * far larger change than the feed screen needs — see the dossier.
     */
    vendorId: uuid("vendor_id"),
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
    // NO ACTION: deactivating a vendor is the supported move. A feed row that
    // silently lost its payee would be worse than one that refuses to delete.
    foreignKey({
      name: "bank_transactions_vendor_fk",
      columns: [t.tenantId, t.vendorId],
      foreignColumns: [vendors.tenantId, vendors.id],
    }),
  ],
);

/**
 * Deterministic categorization rules for the bank feed.
 *
 * The counterpart to `bank_transactions.ai_suggestion`: AI reasons about a row
 * it has never seen, a rule states a mapping the owner has already decided. A
 * rule is cheaper, instant, explainable and stable, so where one matches it
 * WINS over the model — see `banking/rules-match.ts`.
 *
 * Rules may also be machine-proposed (`is_suggested`) after the same mapping is
 * chosen by hand often enough. That is the graduation path: the model handles
 * what is genuinely new, and anything routine hardens into a rule.
 *
 * No `set_dimension_member_ids` column: a jsonb array of member ids carries no
 * referential integrity, which is precisely the "jsonb tags" design the master
 * plan rejected for `line_dimensions`. It lands as a real composite FK once the
 * dimension write path exists.
 */
export const bankRules = pgTable(
  "bank_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Ascending; first match wins. Ties broken by created_at. */
    priority: integer("priority").notNull().default(100),
    isActive: boolean("is_active").notNull().default(true),
    /** Machine-proposed from accepted history; renders as "(Suggested)". */
    isSuggested: boolean("is_suggested").notNull().default(false),
    appliesTo: bankRuleAppliesTo("applies_to").notNull().default("both"),
    /** Null = every register in the tenant. */
    bankAccountId: uuid("bank_account_id"),
    matchMode: bankRuleMatchMode("match_mode").notNull().default("all"),
    /** Zod-validated `[{field, op, value}]` — see rules-match.ts. */
    conditions: jsonb("conditions").notNull().default([]),
    /** The category this rule codes to. */
    setAccountId: uuid("set_account_id").notNull(),
    /** Optional payee. Half the work a rule saves is not typing the vendor. */
    setVendorId: uuid("set_vendor_id"),
    setMemo: text("set_memo"),
    /** Post without human review. Off by default, and never overrides a lock. */
    autoPost: boolean("auto_post").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("bank_rules_tenant_id_id_idx").on(t.tenantId, t.id),
    index("bank_rules_tenant_active_priority_idx").on(
      t.tenantId,
      t.isActive,
      t.priority,
    ),
    foreignKey({
      name: "bank_rules_bank_account_fk",
      columns: [t.tenantId, t.bankAccountId],
      foreignColumns: [bankAccounts.tenantId, bankAccounts.id],
    }).onDelete("cascade"),
    // NO ACTION: deactivating an account is the supported move, and a rule
    // pointing at a deleted category must fail loudly rather than code to null.
    foreignKey({
      name: "bank_rules_set_account_fk",
      columns: [t.tenantId, t.setAccountId],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
    foreignKey({
      name: "bank_rules_set_vendor_fk",
      columns: [t.tenantId, t.setVendorId],
      foreignColumns: [vendors.tenantId, vendors.id],
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

export type BankAccount = typeof bankAccounts.$inferSelect;

export type BankTransaction = typeof bankTransactions.$inferSelect;

export type BankRule = typeof bankRules.$inferSelect;

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

export type PlaidItem = typeof plaidItems.$inferSelect;
