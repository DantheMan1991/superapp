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
  /**
   * Posted by the `inventory` pack from a stock movement — perpetual inventory,
   * slice 3. Three values rather than one because they are three different
   * postings with three different offsets, and a single `inventory` source
   * would make the ledger unable to say which without joining back to the
   * movement.
   *
   * **THESE THREE ARE IN `MACHINE_SOURCES` (core/guards.ts), which makes them a
   * privilege boundary** — an entry naming one of them posts without the owner
   * check, because the authorisation happened where the stock moved. See
   * [ADR 0011](../../../docs/decisions/0011-machine-posted-entries.md) before
   * adding a fourth.
   *
   * That this is an ENUM rather than free text is load-bearing for that ADR: a
   * source cannot be invented at a call site, only chosen from here, so the set
   * of things that could ever bypass the owner check is fixed at compile time
   * and by a migration.
   */
  "inventory_receipt",
  "inventory_issue",
  "inventory_adjustment",
  /**
   * A correction to what a batch COST — ADR 0012 §A.4, `inventory` slice 3d.
   * `source_id` names an `inventory_cost_adjustments` row rather than a
   * movement, which is why it could not reuse `inventory_adjustment`: that one
   * means a quantity changed, and two sources pointing into two different
   * tables would leave the ledger unable to say which.
   *
   * **DELIBERATELY NOT IN `MACHINE_SOURCES`, and that is the answer to the
   * warning above.** Re-stating what stock cost moves money between the balance
   * sheet and the P&L on somebody's say-so, so it is an owner's decision and
   * `requireOwnerRole` is exactly the check it should meet. The other three are
   * in that set because issuing feed is a staff chore; this is not one, and
   * widening a privilege boundary to admit an act that does not need it is how
   * the boundary stops meaning anything.
   */
  "inventory_cost_adjustment",
  /**
   * BOTH HALVES of an intercompany pair (ADR 0010 slice 2). Added in
   * `drizzle/0150`, alone in its own migration for the reason `depreciation`
   * was: an enum value cannot be USED in the transaction that adds it, and
   * Drizzle runs every pending migration in one.
   *
   * Both legs carry it, including the one that settles a bill — the bill's
   * `bill_payments` row still points at that entry, so AP, aging and status
   * derivation are unaffected, and the source now says what the entry actually
   * is rather than hiding half a transfer behind `bill_payment`.
   *
   * NOT in MANAGED_SOURCES: `assertNotIntercompanyLeg` covers these by their
   * link and is stricter, refusing a one-sided REVERSE as well as a void.
   */
  "intercompany",
  /**
   * **A PROCESSING FEE ACCRUED WHEN A RUN COMPLETED** — `production` slice 2c.
   * `source_id` names a `production_runs` row.
   *
   * `Dr` the consumption account, `Cr 2060 Services Received Not Invoiced`.
   * It exists because the fee goes INTO the pot the run's outputs are costed
   * from, so the receipt that lands the meat credits consumption for money
   * nothing had debited there — a contra credit sitting in an expense account
   * until, and only if, the plant's bill happened to be coded to the same
   * place. The accrual is the debit that makes the receipt's credit legitimate,
   * and the bill clears 2060 instead of hitting the P&L twice.
   *
   * **NOT IN `MACHINE_SOURCES`, and the reason is `inventory_cost_adjustment`'s
   * word for word.** Saying what a plant charged, from a quote, before the
   * invoice arrives, moves money onto the balance sheet on somebody's say-so.
   * `completeRun` is owner-only already, so `requireOwnerRole` is exactly the
   * check this should meet, and widening a privilege boundary to admit an act
   * that does not need it is how the boundary stops meaning anything.
   */
  "production_processing_accrual",
]);

export const entryEditPolicy = pgEnum("entry_edit_policy", [
  "standard",
  "strict_append_only",
]);

/**
 * **THE BASIS THE BUSINESS FILES ON**, and the default every report opens on.
 *
 * NOT a second set of books and not a posting rule — the ledger is always
 * accrual ([ADR 0007](../../../docs/decisions/0007-cash-basis-reporting.md)) and
 * cash is derived at read time. This says only which lens a report should reach
 * for when nobody has said otherwise.
 *
 * It exists because the previous answer was `sp.basis === "cash" ? "cash" :
 * "accrual"` in three separate report pages: a hardcoded literal, so a farm
 * that files on cash opened every report on the basis it does NOT file on, and
 * had to re-pick each time. Two correct-but-different profit figures, with the
 * wrong one loading by default, is the shape of an error somebody eventually
 * acts on.
 */
export const accountingBasis = pgEnum("accounting_basis", ["accrual", "cash"]);

/**
 * **HOW INVENTORY REACHES THE BOOKS**, per
 * [ADR 0013](../../../docs/decisions/0013-inventory-tax-treatment.md).
 *
 * Orthogonal to `accounting_basis`, and deliberately so: a business's reporting
 * basis does not determine its inventory treatment. A qualifying small business
 * has more than one option available, and two businesses both correctly on the
 * cash method can owe different answers â€” which is why an earlier draft that
 * made this a property of the word "cash" was wrong.
 *
 * - `none` â€” **the default, and where every tenant is today.** Inventory does
 *   not post at all. Cost accumulation still runs (it is always on, and wanted
 *   regardless of tax basis); it simply does not reach the ledger. Correct for
 *   any tenant not using accounting, and the only safe default for a change
 *   that alters how purchases hit live books.
 * - `capitalise` â€” stock is an asset. The receipt posts
 *   `Dr Inventory / Cr Goods Received Not Invoiced`, the bill line clears GRNI,
 *   and cost lands in the consumption account when stock is issued (ADR 0012).
 *
 * `expense_on_payment` is named in ADR 0013 and is NOT here yet: it needs the
 * cash lens to substitute capitalising lines, which is its own change. Adding it
 * costs one enum value and one migration.
 */
export const inventoryTreatment = pgEnum("inventory_treatment", [
  "none",
  "capitalise",
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

/**
 * A LEGAL ENTITY inside the tenant — the thing that owns a set of books.
 * See docs/decisions/0010-entities-inside-a-tenant.md.
 *
 * The tenant is the CLIENT RELATIONSHIP; this is the company that files a
 * return. Every tenant has at least one, the common case is exactly one, and
 * that client never learns the word — the picker only appears at two.
 *
 * WHAT THIS IS NOT, because three other things in this codebase are also called
 * an entity:
 *   - NOT a `dimension_members` row. A dimension slices one set of books; this
 *     IS one. The test is whether the trial balance has to balance within it —
 *     North Pasture, no; an LLC, always. `dimensionMembers.packEntityId` means
 *     a pack's own row and is unrelated.
 *   - NOT a `parties` row. A party is somebody the tenant deals with.
 *   - NOT a tenant. RLS is the wall between CLIENTS and that is untouched;
 *     between two entities of one client, separation is application code, which
 *     ADR 0010 names as its own strongest cost.
 *
 * The chart of accounts, vendors, customers and contacts stay TENANT-WIDE and
 * shared — that sharing is most of what "manage ten LLCs in one place" means.
 */
export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** What the picker and every report footer show. */
    name: text("name").notNull(),
    /** The name on the return, when it differs from what people call it. */
    legalName: text("legal_name").notNull().default(""),
    /**
     * Where an entry lands when nothing chose. Exactly one per tenant, by the
     * partial unique index below rather than by care — `payment_terms` and
     * `sales_tax_rates` draw the same line.
     */
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    /**
     * The period lock, PER SET OF BOOKS (ADR 0010 slice 4). Null = never closed.
     *
     * It moved here from `accounting_settings` because ten LLCs close in
     * different months — one bookkeeper finishing Maple's June while Oak's is
     * still missing a bank statement is the ordinary case, and a tenant-wide
     * scalar made it one decision for all of them.
     *
     * DERIVED STATE, written ONLY by completeClose/reopenClose, exactly as the
     * tenant-wide scalar was. That is what keeps drift between the lock and the
     * close history unrepresentable.
     */
    closedThrough: date("closed_through", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Target of the composite FK from journal_entries. MUST exist before that
    // constraint is added — drizzle-kit emits every FK before every index, so
    // the generated migration is hand-reordered.
    uniqueIndex("entities_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("entities_tenant_name_idx").on(t.tenantId, t.name),
    index("entities_tenant_idx").on(t.tenantId),
    uniqueIndex("entities_tenant_default_idx")
      .on(t.tenantId)
      .where(sql`${t.isDefault}`),
  ],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /**
     * The legal entity whose books this entry belongs to (ADR 0010).
     *
     * ON THE ENTRY, NEVER ON THE LINE. An entry belongs to one entity and
     * therefore still balances on its own, so the posting invariant at the
     * heart of this module is untouched. An intercompany transaction is a
     * linked PAIR of entries (slice 2), not one entry spanning two entities.
     *
     * NOT NULL in the database since `drizzle/0144`. It arrived NULLABLE in
     * `0142` and was closed a release later, because migrations go out AHEAD of
     * the deploy and the deploy running while `0142` landed did not write the
     * column — a NOT NULL there rejects every invoice issued in that window.
     * Same expand/contract split `0123` made for its `total = subtotal + tax`
     * CHECK. Worth knowing before adding the next required column here.
     */
    entityId: uuid("entity_id").notNull(),
    /** The bookkeeping day (no timezone). ISO string, compared lexically. */
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    memo: text("memo").notNull().default(""),
    status: journalEntryStatus("status").notNull().default("draft"),
    source: journalEntrySource("source").notNull().default("manual"),
    /** Soft back-pointer to the source document (invoice, bank txn, …). */
    sourceId: uuid("source_id"),
    idempotencyKey: text("idempotency_key"),
    /**
     * The two halves of an INTERCOMPANY transaction share this (ADR 0010
     * slice 2). Null on every ordinary entry, which is nearly all of them.
     *
     * Money moving between two companies of one client cannot be one entry: as
     * `Dr AP (Oak) / Cr Checking (Maple)` tagged to a single company it leaves
     * Oak's balance sheet showing cash leaving an account it does not own and
     * Maple's showing nothing, while the ledger still balances. So it is a PAIR
     * — one entry per company, each balancing on its own against a shared
     * `due_from_affiliate` / `due_to_affiliate` account — written together or
     * not at all.
     *
     * A GROUPING KEY, not a foreign key: it points at no row, because the thing
     * it identifies is the pair itself. Consolidation (slice 3) eliminates by
     * following it rather than by matching amounts, which is what makes
     * elimination mechanical instead of a judgement call.
     *
     * EXACTLY TWO ENTRIES PER ID, enforced by a deferred constraint trigger in
     * `drizzle/0149` — the same backstop shape the balance check uses. A
     * half-written pair leaves one company owing an affiliate that nobody is
     * owed by, which no report would notice.
     */
    intercompanyId: uuid("intercompany_id"),
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
    // Every entity-scoped report filters on exactly this shape.
    index("journal_entries_tenant_entity_date_idx").on(
      t.tenantId,
      t.entityId,
      t.entryDate,
    ),
    index("journal_entries_tenant_status_idx").on(t.tenantId, t.status),
    // Both halves are fetched by this, and consolidation walks it.
    index("journal_entries_tenant_intercompany_idx")
      .on(t.tenantId, t.intercompanyId)
      .where(sql`${t.intercompanyId} is not null`),
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
    // Composite, so an entry naming another tenant's entity is unrepresentable
    // rather than merely unwritten. NO ACTION: an entity with books is never
    // deleted, only deactivated.
    foreignKey({
      name: "journal_entries_entity_fk",
      columns: [t.tenantId, t.entityId],
      foreignColumns: [entities.tenantId, entities.id],
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

export type Entity = typeof entities.$inferSelect;

export type JournalEntry = typeof journalEntries.$inferSelect;

export type JournalLine = typeof journalLines.$inferSelect;

export type DimensionMember = typeof dimensionMembers.$inferSelect;
