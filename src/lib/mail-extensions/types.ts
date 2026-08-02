import type { Tx } from "@/db";

/**
 * The mail extension contract — primitive P5, "declared extension points".
 *
 * Mail names slots; other modules fill them. The four extension primitives that
 * already existed (open taxonomy columns, metadata bags, link tables carrying
 * `extension_slug`, pack-owned tables) all let a layer store something. This is
 * the first one that lets a layer *do* something, and it is the one
 * docs/extension-model.md §4 said would be needed first for entity-type
 * registration. See docs/extension-model.md and docs/security.md §7.
 *
 * THIS FILE IMPORTS NOTHING FROM `src/modules/**`, AND MUST NOT.
 *
 * That is the whole trick, and it is the same one `src/modules/types.ts` plays
 * for module renderers. The dependency graph is:
 *
 *     src/modules/<slug>/mail/extension.ts  ──imports──▶  types.ts   (this file)
 *     src/lib/mail-extensions/registry.ts   ──imports──▶  every extension
 *     src/modules/email/**                  ──imports──▶  registry.ts
 *
 * so mail depends on the registry and never on a module, a module depends on
 * this contract and never on mail or on another module, and `registry.ts` is the
 * single composition root where the two meet. Every arrow points one way, and
 * eslint.config.mjs now enforces it rather than trusting anyone to remember.
 *
 * TWO RULES THAT ARE SECURITY, NOT STYLE:
 *
 *  1. `search` and `resolve` take the CALLER'S `tx`. They do not open their own
 *     transaction, do not call `withTenant`, and above all never call
 *     `withSystem`. The caller has already established the RLS context from a
 *     `requireTenant()` result, so what an extension can find is exactly what
 *     the person asking is allowed to see — an extension cannot widen its own
 *     visibility, which is invariant S12 expressed as a function signature. An
 *     extension that opened its own scope would be able to hand mail a row RLS
 *     had already refused.
 *
 *  2. Every hook is optional and nothing may throw. A broken extension costs its
 *     own chips and its own row in the picker; it never costs the inbox.
 *     `resolve.ts` enforces this with `Promise.allSettled` plus a timeout, but
 *     an extension should still return `[]` rather than raise.
 */

/**
 * What an extension is told about the caller.
 *
 * Deliberately small: the ids and the role, all of which came from
 * `requireTenant()`. Notably absent is anything an extension could use to
 * broaden a query — no database handle, no session, no token. It gets the same
 * `tx` the caller is already inside, and that tx is already scoped.
 */
export interface MailExtensionCtx {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
}

/** Enough to write a `mail_links` row. */
export interface LinkableEntityRef {
  /** Matches `mail_links.entity_type`: ^[a-z][a-z0-9_]{0,62}$ */
  entityType: string;
  entityId: string;
}

/**
 * One thing a thread can be attached to, as the UI needs to show it.
 *
 * Presentation strings come from the extension because only the extension knows
 * what an invoice is called. Mail renders them and never parses them.
 */
export interface LinkableEntity extends LinkableEntityRef {
  /** "Invoice INV-1042" — the primary line, already formatted. */
  label: string;
  /** "Acme Builders · due 2026-08-01". Optional second line. */
  sublabel?: string;
  /** Where clicking it goes. Omitted when the entity has no page of its own. */
  href?: string;
}

/**
 * A kind of thing threads can be attached to. One per entity type, not one per
 * module — Accounting contributes four.
 */
export interface MailEntityType {
  /**
   * Written verbatim into `mail_links.entity_type`, which carries no whitelist
   * on purpose: registering a new type needs no migration to core. The format
   * CHECK is the only constraint, so keep it lowercase and underscore-separated.
   */
  type: string;
  /** Singular, for the picker: "Invoice". */
  label: string;
  /** Plural, for headings: "Invoices". */
  pluralLabel: string;
  /** lucide icon name. A string, so it stays serializable across the boundary. */
  icon: string;
  /**
   * Find candidates for the "Attach to…" picker.
   *
   * `query` is raw user input and must be treated as such — bind it, never
   * interpolate it. Returning fewer than `limit` is fine; returning more is
   * truncated by the caller.
   */
  search(
    tx: Tx,
    ctx: MailExtensionCtx,
    query: string,
    limit: number,
  ): Promise<LinkableEntity[]>;
  /**
   * Turn stored ids back into displayable entities — BATCHED, one call for
   * every id of this type on the page.
   *
   * Batched because the alternative is N+1 queries behind a reading pane, which
   * is the exact failure `mail_thread_index` exists to prevent on the other
   * side of this join. Ids that no longer resolve (deleted, or hidden by RLS)
   * are simply absent from the result; the caller renders those as a dangling
   * link rather than treating it as an error.
   */
  resolve(
    tx: Tx,
    ctx: MailExtensionCtx,
    ids: readonly string[],
  ): Promise<LinkableEntity[]>;
}

/* -- Filing ------------------------------------------------------------- */

/** One attachment, already fetched from the mail server. */
export interface FiledAttachmentInput {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

/**
 * A message, as handed to whichever extension files copies.
 *
 * Neutral on purpose: no `JmapEmail`, no client, no blob ids. Mail has already
 * done every protocol-shaped thing by the time this is built, so a second
 * filing target (a future archive module, say) would not have to learn JMAP.
 */
export interface FiledMessageInput {
  /**
   * What the person is attaching this conversation TO.
   *
   * Passed through neutrally: mail states the target and expresses no opinion
   * about it, and a filing target ignores anything it does not recognise. It
   * exists because "attach this to the Admin folder" names a destination, while
   * "attach this to invoice INV-1042" does not — the first is an instruction
   * about where the copy goes, and treating both the same put filed emails
   * somewhere the person had not asked for.
   */
  target?: LinkableEntityRef;
  /** The mail server's ids. Opaque; used for provenance and idempotency only. */
  messageId: string;
  threadId: string;
  /** RFC 5322 Message-Id, when the server gave us one. Stable across servers. */
  rfcMessageId: string;
  subject: string;
  fromAddress: string;
  fromName: string | null;
  to: string[];
  cc: string[];
  receivedAt: Date | null;
  /**
   * A readable plain-text transcript: headers, then the body. This is what goes
   * into the full-text index, so "find the email where they agreed the price"
   * works from the Documents search box.
   */
  transcript: string;
  /**
   * The raw RFC 5322 message. THE snapshot: complete, standard, and openable in
   * any mail client, which is what makes it evidence rather than our rendering
   * of evidence.
   */
  raw: Uint8Array;
  attachments: FiledAttachmentInput[];
}

export interface FiledMessageResult {
  /** The entity the filed copy IS, so mail can link the thread to it. */
  entityType: string;
  entityId: string;
  label: string;
  href?: string;
  /**
   * Where the copy ACTUALLY went — "the Admin folder", "the Documents inbox".
   *
   * Reported by the target rather than assumed by the caller, because only the
   * target knows whether it honoured the destination it was given. Telling
   * somebody the copy is in one place while it sits in another is the specific
   * failure this field exists to prevent.
   */
  destinationLabel: string;
  attachmentsFiled: number;
  /**
   * Attachments the filing target refused — its own upload allowlist applied to
   * bytes that arrived from outside the business. Surfaced rather than swallowed
   * so nobody believes a file was kept that was not.
   */
  attachmentsRejected: number;
  /** True when this exact message had already been filed; nothing was written. */
  alreadyFiled: boolean;
}

/**
 * The capability that makes linking mean anything.
 *
 * Settled with the founder and written up in docs/modules/email.md: **linking
 * COPIES the message into the tenant's space rather than pointing at the
 * mailbox.** Mailboxes are private per user (RLS 0043) and `mail_thread_index`
 * deliberately holds no bodies, so a link on its own would show a colleague
 * "a thread called X, with these people, last Tuesday" and not one readable
 * word. Filing the message where the business can already read things is what
 * turns a link into the feature.
 *
 * Note this hook does NOT take a `tx`, unlike `search` and `resolve`, and the
 * difference is deliberate: filing writes bytes to blob storage first, and the
 * house rule is that network work never happens inside a transaction. So the
 * target owns its own `withTenant` — still under the caller's tenant and role,
 * still never `withSystem`.
 */
export interface MailFilingTarget {
  /**
   * Where copies go when the target names no destination of its own —
   * "the Documents inbox". Shown in the picker BEFORE a target is chosen, so it
   * describes the default rather than the outcome; the outcome comes back on
   * `FiledMessageResult.destinationLabel`.
   */
  destinationLabel: string;
  fileMessage(
    ctx: MailExtensionCtx,
    input: FiledMessageInput,
  ): Promise<FiledMessageResult>;
}

/* -- Images a message can be composed with ------------------------------- */

/** One picture the caller may insert, as the picker needs to show it. */
export interface MailImageCandidate {
  /** Opaque to Mail. Handed straight back to `open()`. */
  id: string;
  /** "Site photo 3.jpg" — already formatted, rendered verbatim. */
  label: string;
  /** "Drawings · 2.1 MB". Optional second line. */
  sublabel?: string;
  /** Bytes, for the composer's own size cap. */
  size: number;
  /** An image/* type the composer will refuse if it does not recognize it. */
  type: string;
}

/** A picture resolved far enough to put in a message. */
export interface MailImageBlob {
  /** The file name the recipient sees. */
  name: string;
  type: string;
  size: number;
  /**
   * The bytes, fetched OUTSIDE the transaction that authorized them.
   *
   * A thunk rather than a buffer because of the house rule that network work
   * never happens inside a transaction — `open()` proves the caller may have
   * this file while the tx is open, and the download happens after it closes.
   * Returning null means the file has gone since the row was read, which is a
   * missing image rather than an error.
   */
  fetch(): Promise<ArrayBuffer | null>;
}

/**
 * Somewhere the composer can insert a picture from, besides the user's disk.
 *
 * The founder asked for this on 2026-08-02: an inline image should be reachable
 * from the business's own files, not only from whatever is on the laptop in
 * front of somebody. Documents implements it; nothing else needs to.
 *
 * BOTH HOOKS TAKE THE CALLER'S `tx`, like `search` and `resolve` and for the
 * same reason — invariant S12. What an extension can find here is exactly what
 * the person asking may see, so an owners-only folder's photograph is invisible
 * to a staff user with no predicate anywhere in Mail's code. That property is
 * demonstrated rather than asserted: there is a test that puts an image in an
 * owners-only folder and calls this as staff.
 *
 * It is deliberately NOT the filing capability's shape. Filing opens its own
 * `withTenant` because it writes blobs; this only READS, so it can take the
 * caller's transaction and inherit the caller's visibility for free.
 */
export interface MailImageSource {
  /** Section heading in the picker: "Documents". */
  label: string;
  /**
   * Images the caller may insert. An empty `query` should return recent ones
   * rather than nothing — this is a picker somebody browses, unlike the entity
   * search, where an empty query means "not asked yet".
   */
  search(
    tx: Tx,
    ctx: MailExtensionCtx,
    query: string,
    limit: number,
  ): Promise<MailImageCandidate[]>;
  /**
   * Resolve one id to something the composer can upload.
   *
   * Returns null when the caller may not see it, which is the same answer as
   * "it does not exist" — deliberately, so this cannot be used to probe for the
   * existence of files in folders somebody cannot open.
   */
  open(tx: Tx, ctx: MailExtensionCtx, id: string): Promise<MailImageBlob | null>;
}

/* -- The extension itself ------------------------------------------------ */

export interface MailExtension {
  /**
   * Written into `mail_links.extension_slug` and `mail_annotations.extension_slug`.
   * Format CHECK: ^[a-z][a-z0-9_-]{0,62}$.
   */
  slug: string;
  /**
   * The module this extension belongs to, matched against `tenant_modules`.
   * An extension whose module is switched off contributes nothing — its rows
   * survive untouched and come back when the module does.
   */
  moduleSlug: string;
  /** Human name, for the picker's section headings. */
  name: string;
  entityTypes: MailEntityType[];
  /** Only one extension needs to implement this, and only Documents does. */
  filing?: MailFilingTarget;
  /** Somewhere the composer can insert a picture from. Documents implements it. */
  images?: MailImageSource;
}
