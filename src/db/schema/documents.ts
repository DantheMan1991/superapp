/**
 * The DMS: files, folders, versions, templates, generation and share links.
 * Shared by the accounting receipt flow and the standalone Documents module.
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
import { journalEntries } from "./ledger";
import { invoices } from "./invoicing";
import { bankTransactions } from "./banking";
import { bills } from "./payables";

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
    /**
     * The document's readable contents, indexed by `search_tsv` at weight D.
     *
     * Describes the CURRENT bytes, exactly like `file_name` and `sha256` do —
     * `document_versions` holds the authoritative copy per revision and
     * `promoteVersion` denormalizes it here. Written by
     * `documents/text/extract.ts` for the DMS and by the mail seam for a filed
     * message (whose transcript is a better answer than any parser).
     *
     * Bounded to 200,000 characters by the producer because that is what
     * drizzle/0026's `left(extracted_text, 200000)` indexes — see
     * `text/state.ts`.
     */
    extractedText: text("extracted_text").notNull().default(""),
    /**
     * Why those contents are, or are not, in the index — see
     * `documents/text/state.ts` for the vocabulary. Defaults to 'pending', so
     * every row that predates the producer is the backfill's queue.
     */
    textExtraction: text("text_extraction").notNull().default("pending"),
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
    // The backfill's queue, and nothing else. PARTIAL on purpose: a plain btree
    // over six states would be useless, whereas this one shrinks to almost
    // nothing once every document has been read — which is the steady state.
    index("documents_text_extraction_pending_idx")
      .on(t.tenantId, t.createdAt)
      .where(sql`${t.textExtraction} in ('pending', 'failed')`),
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
    // text + CHECK, not a pgEnum: ALTER TYPE ... ADD VALUE cannot be used in
    // the transaction that adds it and Drizzle wraps each migration in one, so
    // a seventh state would need a migration file of its own containing a
    // single statement. Same reasoning as every other discriminator here.
    check(
      "documents_text_extraction_check",
      sql`${t.textExtraction} in ('pending', 'done', 'empty', 'unsupported', 'too_large', 'failed')`,
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

/**
 * A DOCUMENT ATTACHED TO SOMETHING THAT IS NOT AN ACCOUNTING RECORD — a photo
 * of a cow, a photo of a tractor, a manual, a permit.
 *
 * **WHY THIS IS NOT FOUR MORE COLUMNS ON `document_links`.** That table names
 * its targets in typed columns, which buys referential integrity and costs
 * something core cannot afford here: a `livestock_lot_id` on a Layer 0 table
 * would be **core knowing what a livestock lot is**. That is the leak ADR 0004
 * draws the line against and the exact correction the enterprises slice took a
 * day after shipping — *a core tool speaks no industry*. It would also mean a
 * core migration every time a pack wanted a photo, forever.
 *
 * So this follows `mail_links` instead, which is the same seam solved the same
 * way for the same reason: `extension_slug` + `entity_type` + `entity_id`, no
 * FK to the target, and an uninstalled layer's rows simply never resolve. The
 * document side IS core, so THAT gets a real composite FK and CASCADE.
 *
 * **WHAT IS GIVEN UP, SAID PLAINLY: a deleted target leaves a dangling row.**
 * Postgres cannot police a polymorphic reference, so the pack that owns the
 * record detaches on its own delete path, and a reader that finds nothing shows
 * nothing. `mail_links` has made this trade since the mail module shipped.
 *
 * `is_primary` is the profile picture: **at most one per record**, enforced by a
 * partial unique index. It is not a column on the record itself, because a
 * primary that could outlive the attachment it names is a dangling pointer with
 * extra steps — this way detaching the photo takes the flag with it. Whether a
 * primary must be an IMAGE is the app's rule, not the database's: an attachment
 * is any document, and a manual is a legitimate one.
 */
export const documentAttachments = pgTable(
  "document_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull(),
    /**
     * Which layer owns this attachment type, so an uninstalled pack's rows can
     * be ignored rather than misread. Same column, same job, as `mail_links`.
     */
    extensionSlug: text("extension_slug").notNull(),
    /** "livestock_lot" | "asset" | later "zone", "production_run", … */
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    /** The profile picture. At most one per record — see the partial unique. */
    isPrimary: boolean("is_primary").notNull().default(false),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("document_attachments_tenant_id_id_idx").on(t.tenantId, t.id),
    index("document_attachments_tenant_document_idx").on(
      t.tenantId,
      t.documentId,
    ),
    // One file attached to one record once. Attaching it twice would put the
    // same photo in the gallery twice and make "which is primary" ambiguous.
    uniqueIndex("document_attachments_unique_idx").on(
      t.tenantId,
      t.documentId,
      t.entityType,
      t.entityId,
    ),
    // The join every gallery runs: "every file on this animal".
    index("document_attachments_entity_idx").on(
      t.tenantId,
      t.entityType,
      t.entityId,
    ),
    // **AT MOST ONE PROFILE PICTURE PER RECORD, in the database.** A list
    // thumbnail wants one canonical photo rather than whichever is newest —
    // the open item `assets` has carried since 2026-08-15 — and "canonical"
    // stops being true the moment two rows can claim it.
    uniqueIndex("document_attachments_primary_idx")
      .on(t.tenantId, t.entityType, t.entityId)
      .where(sql`${t.isPrimary}`),
    foreignKey({
      name: "document_attachments_document_fk",
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }).onDelete("cascade"),
    check(
      "document_attachments_entity_type_format",
      sql`${t.entityType} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
    check(
      "document_attachments_extension_slug_format",
      sql`${t.extensionSlug} ~ '^[a-z][a-z0-9_]{0,62}$'`,
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
    /**
     * This revision's readable contents, and the reason they live here rather
     * than only on the document: text describes BYTES, and every other
     * descriptor of the bytes (file_name, mime_type, size, sha256) is already
     * authoritative on the version row and denormalized onto the document.
     * Text is one more descriptor, so it follows the same rule — which makes
     * restore free, because restoring v1 restores v1's text with no download
     * and no re-parse.
     */
    extractedText: text("extracted_text").notNull().default(""),
    textExtraction: text("text_extraction").notNull().default("pending"),
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
    check(
      "document_versions_text_extraction_check",
      sql`${t.textExtraction} in ('pending', 'done', 'empty', 'unsupported', 'too_large', 'failed')`,
    ),
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

export type Document = typeof documents.$inferSelect;

export type DocumentLink = typeof documentLinks.$inferSelect;
export type DocumentAttachment = typeof documentAttachments.$inferSelect;

export type DocumentFolder = typeof documentFolders.$inferSelect;

export type DocumentVersion = typeof documentVersions.$inferSelect;

export type DocumentTag = typeof documentTags.$inferSelect;

export type DocumentSavedView = typeof documentSavedViews.$inferSelect;

export type DocumentTemplate = typeof documentTemplates.$inferSelect;

export type DocumentTemplateVersion =
  typeof documentTemplateVersions.$inferSelect;

export type DocumentGeneration = typeof documentGenerations.$inferSelect;

export type DocumentSettings = typeof documentSettings.$inferSelect;

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
