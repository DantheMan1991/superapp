/**
 * Outbound spine plus hosted mailboxes: domains, accounts, the thread index
 * and everything Gmail-parity (labels, snooze, rules, templates, auto-filing).
 *
 * Split out of the former single-file `src/db/schema.ts`; `./index.ts`
 * re-exports every domain, so `@/db/schema` still resolves exactly as before.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";

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

/**
 * "Everything from this supplier goes in the Bills folder."
 *
 * The automatic half of the attachments → Documents loop. The manual half has
 * existed since Slice 5: somebody attaches a thread to an invoice and the
 * message plus its attachments are filed. This runs the same filing path from
 * the cron instead of from a click.
 *
 * PER-USER, the sixth such table, and the reason is sharper than for the
 * others. `mail_rules` and `mail_snoozes` are per-user because their rows are
 * meaningless in anybody else's account. These rows would work perfectly well
 * for a colleague — that is exactly why they must not be theirs to create.
 * **Filing publishes one person's private correspondence to the whole
 * business**, which is why the manual action audits inside its transaction, and
 * an automatic version removes the human who was deciding each time. So only
 * the person whose mailbox connection it is may set one up, and RLS is what
 * says so rather than a predicate somebody has to remember.
 *
 * ALLOWED ON A DELEGATED MAILBOX, unlike Sieve rules — and by the rule the
 * delegation slice arrived at rather than by exception. A Sieve script is
 * refused on a shared box because its effect is invisible and its record is
 * private. This one's effect is a document appearing in a shared folder, which
 * everybody can see and which is audited per filing. `accounts@` filing its
 * bills is the case the feature exists for.
 *
 * NOTHING HERE IS A COPY OF ANY MAIL. The row is a standing instruction: which
 * connection to watch, what to match, where the copy goes. The copies live in
 * Documents, and the messages stay on the mail server.
 */
export const mailAutofileRules = pgTable(
  "mail_autofile_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Whose mailbox this watches. Nobody files anonymously. */
    clerkUserId: text("clerk_user_id").notNull(),
    mailAccountId: uuid("mail_account_id").notNull(),
    name: text("name").notNull(),
    /**
     * Restrict to one folder, as a JMAP mailbox id. Null means "anywhere the
     * query looks", which the sweep narrows to the inbox — never Drafts or
     * Sent, because `npm run mail:probe-autofile` confirmed the user's own
     * drafts are visible to the same machinery and filing somebody's outgoing
     * work back into Documents is the loop this must not have.
     */
    matchMailboxId: text("match_mailbox_id"),
    /**
     * Sender substring, case-folded, matched against the From address. Empty
     * means "any sender" — which is only sane in combination with a folder, and
     * the action refuses a rule that constrains neither.
     */
    matchFrom: text("match_from").notNull().default(""),
    /**
     * Where copies go, as a Documents folder id. Null means the Documents
     * inbox, which is the same default the manual path uses.
     *
     * An OWNERS-ONLY folder can never be named here, and it is a property of
     * the runtime rather than a rule anybody enforces: `requireTenant()` derives
     * "owner" from Clerk's org role, which a cron invocation has no way to
     * obtain, so the sweep runs as `staff` and RLS refuses the write. The action
     * refuses it up front too, so it fails at the moment somebody chooses rather
     * than silently every night.
     *
     * The composite FK is declared in SQL rather than here, the same exception
     * `mail_links.mail_account_id` takes and for the identical reason: it needs
     * `ON DELETE SET NULL (destination_folder_id)`, the column-list form (PG 15+)
     * that drizzle-kit cannot emit. The plain form would try to null `tenant_id`
     * as well — and that is NOT NULL, so **deleting a Documents folder would
     * fail outright** for any tenant with a rule pointing at it. Nulling it
     * instead degrades the rule to "file into the Documents inbox", which is the
     * right answer: somebody deleted a folder, not the instruction to keep
     * filing.
     */
    destinationFolderId: uuid("destination_folder_id"),
    isEnabled: boolean("is_enabled").notNull().default(true),
    /**
     * The watermark: only messages received AFTER this are considered.
     *
     * It exists to avoid work, not to guarantee correctness — the filing target
     * is already idempotent on the sha256 of the raw message, so a message
     * considered twice is filed once. But that guarantee costs a full download
     * to compute the hash, so without a watermark every sweep would re-fetch
     * every message it had ever filed. Null means "start from now", set when the
     * rule is created: a new rule is a statement about what arrives next, not an
     * instruction to import the last three years.
     */
    cursor: timestamp("cursor", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    /** Surfaced in the editor, so a rule that is quietly failing is visible. */
    lastError: text("last_error").notNull().default(""),
    filedCount: integer("filed_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("mail_autofile_rules_tenant_id_id_idx").on(t.tenantId, t.id),
    index("mail_autofile_rules_user_idx").on(
      t.tenantId,
      t.clerkUserId,
      t.mailAccountId,
    ),
    // How the sweep picks its work: enabled rules, oldest run first.
    index("mail_autofile_rules_due_idx").on(t.isEnabled, t.lastRunAt),
    foreignKey({
      name: "mail_autofile_rules_account_fk",
      columns: [t.tenantId, t.mailAccountId],
      foreignColumns: [mailAccounts.tenantId, mailAccounts.id],
    }).onDelete("cascade"),
    // NB: the destination_folder_id composite FK is NOT declared here — see the
    // column's comment. It lives in drizzle/0058 because it needs the
    // column-list form of ON DELETE SET NULL.
    check(
      "mail_autofile_rules_name_not_blank",
      sql`length(btrim(${t.name})) > 0`,
    ),
  ],
);

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

export type MailAutofileRule = typeof mailAutofileRules.$inferSelect;

export type MailScheduledSend = typeof mailScheduledSends.$inferSelect;

/** Display-only participants on an indexed thread. */
export type MailParticipant = { name: string; email: string };
