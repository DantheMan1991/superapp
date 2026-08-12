import type { Tx } from "@/db";
import type {
  EntityLinkCtx,
  LinkableEntityRef,
  LinkableEntityType,
} from "@/lib/entity-links/types";

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
 * ── WHAT MOVED, AND WHY (2026-08-09) ─────────────────────────────────────────
 *
 * `MailExtensionCtx`, `LinkableEntityRef`, `LinkableEntity` and the generic half
 * of `MailEntityType` now live in `src/lib/entity-links/types.ts`.
 *
 * Mail declared the idea of a linkable business record first, so it owned the
 * contract — and then Scheduling wanted exactly the same nine implementations,
 * because an event is attached to an invoice for the same reason a thread is.
 * The alternative was a parallel contract and nine second implementations to
 * keep in sync, which is what ADR 0004 exists to prevent.
 *
 * NOTHING ABOUT THE IMPLEMENTATIONS CHANGED — only the type they satisfy.
 * `MailEntityType` keeps the parts that really are mail's (template
 * placeholders) and inherits the rest. The names below are re-exported so every
 * existing `import { LinkableEntity } from "@/lib/mail-extensions/types"` keeps
 * resolving; new code should prefer the entity-links path.
 */
export type {
  EntityLinkCtx,
  LinkableEntity,
  LinkableEntityRef,
  LinkableEntityType,
} from "@/lib/entity-links/types";

/** Mail's name for the caller context. An alias, not a second shape. */
export type MailExtensionCtx = EntityLinkCtx;

/**
 * A kind of thing threads can be attached to. One per entity type, not one per
 * module — Accounting contributes four.
 *
 * `type`, `label`, `pluralLabel`, `icon`, `search` and `resolve` come from
 * `LinkableEntityType`; read its header for the S12 rule about `tx`. What is
 * added here is the template vocabulary, which is mail's alone: nothing else in
 * the product fills in `{{invoice.number}}`.
 *
 * (`resolve` is BATCHED there for a reason worth restating on this side: the
 * alternative is N+1 queries behind a reading pane, the exact failure
 * `mail_thread_index` exists to prevent on the other side of this join.)
 */
export interface MailEntityType extends LinkableEntityType {
  /**
   * Placeholder fields this type contributes to mail templates, if any.
   *
   * The placeholder key is `<type>.<field key>` — so an entity type named
   * `invoice` declaring `number` gives `{{invoice.number}}`. Mail composes the
   * vocabulary from these and never invents one, because it does not know what
   * an invoice is.
   *
   * DECLARING IS SEPARATE FROM RESOLVING ON PURPOSE. The template editor has to
   * list what somebody may type, and the save action has to refuse a typo, and
   * both happen with no record chosen — so the vocabulary has to be knowable
   * without reading any data. That is what keeps the enumeration CLOSED, which
   * is the property the whole placeholder design rests on.
   */
  templateFields?: readonly MailTemplateField[];
  /**
   * The values of those fields for ONE record.
   *
   * Takes the CALLER'S `tx`, like `search` and `resolve` and for the same
   * reason: what a template can reveal is exactly what the person inserting it
   * may already read. An id they cannot see resolves to null, which is
   * indistinguishable from "not there" — so a template cannot be used to probe
   * for records, and the values of a colleague's hidden invoice cannot be
   * pasted into a message by naming its id.
   *
   * Returns null when the record is gone or invisible. Every value is a
   * DISPLAY STRING, already formatted by the extension: mail renders money and
   * dates it does not understand, and a number formatted twice is a number
   * formatted wrong.
   */
  templateValues?(
    tx: Tx,
    ctx: MailExtensionCtx,
    entityId: string,
  ): Promise<Record<string, string> | null>;
}

/** One fill-in-the-blank an entity type offers. */
export interface MailTemplateField {
  /** The part after the dot: `number` in `{{invoice.number}}`. */
  key: string;
  /** "Invoice number" — shown in the template editor's list. */
  label: string;
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

/* -- People the composer can address -------------------------------------- */

/** One suggestion for a recipient field. */
export interface MailContactCandidate {
  /** The address that goes in the header. Required — a suggestion without one
   * cannot be picked, so a record with no email must not be returned at all. */
  email: string;
  /** "Aoife Ó Braonáin", or "" when only an address is known. */
  name: string;
  /** "Customer · Probe Construction Ltd". Says WHERE this came from. */
  sublabel?: string;
}

/**
 * Somewhere the composer can find people to write to.
 *
 * The founder asked for this on 2026-08-02 alongside the mail server's own
 * address book, and specifically so **a future CRM contributes its people
 * without Mail knowing it exists**. That is the same requirement the image
 * source had, and the answer is the same: a capability on the registry rather
 * than an import.
 *
 * Accounting implements it TODAY, over customers and vendors — which matters
 * beyond the feature. `docs/modules/email.md` records that "a seam with one user
 * is a seam that has never been tested", from the day three Migadu assumptions
 * turned out to be baked into supposedly shared code. This one ships with a real
 * implementation rather than a placeholder.
 *
 * TAKES THE CALLER'S `tx`, like `search`, `resolve` and the image source, and
 * for the same reason — invariant S12. Which people an extension can offer is
 * exactly which rows the person composing may read.
 */
export interface MailContactSource {
  /**
   * People matching `query`, which is raw user input and must be bound rather
   * than interpolated.
   *
   * An empty query returns NOTHING rather than everyone. Unlike the image
   * picker, which is browsed, this fires while somebody types an address — and
   * listing the whole customer table the moment a recipient field is focused
   * would be a query per composer for suggestions nobody asked for.
   */
  search(
    tx: Tx,
    ctx: MailExtensionCtx,
    query: string,
    limit: number,
  ): Promise<MailContactCandidate[]>;
}

/* -- Drafting a record from a conversation -------------------------------- */

/**
 * A conversation, reduced to what a drafter needs: who said what, in order.
 *
 * MAIL FETCHES THIS, NOT THE EXTENSION, and that is the whole reason the seam
 * is shaped this way. Message bodies are not in our database — `mail_thread_index`
 * holds metadata only — and `mail_accounts` is scoped to ONE USER by RLS
 * (`0043`), because a thread is somebody's private correspondence. So the text
 * can only be read by the mailbox's owner, through their own JMAP connection,
 * which is mail's job. An extension is handed the text and never goes looking
 * for it.
 */
export interface DraftableThread {
  subject: string;
  /** Oldest first. Plain text, already stripped of quoting and size-capped. */
  messages: Array<{
    /** Display address of the sender, for matching a party. */
    from: string;
    /** ISO date the message was sent. */
    date: string;
    text: string;
  }>;
}

export interface DraftedLine {
  description: string;
  /** Decimal string, the module's own quantity convention. */
  quantity: string;
  unitPriceCents: number;
  /**
   * Which message this figure came from, and the words relied on.
   *
   * `verified` is set by the drafter, not the model: it means the quote was
   * found in the message it claims to come from. An unverified line is still
   * SHOWN — silently dropping a figure somebody may be owed is its own kind of
   * wrong — but it arrives unticked, so it cannot be accepted by inattention.
   */
  citation: {
    messageIndex: number;
    quote: string;
    verified: boolean;
  } | null;
}

export interface DraftedRecord {
  /** "invoice" | "bill" — which direction this conversation implies. */
  kind: string;
  /** Matched party, or null when the drafter could not recognise one. */
  partyId: string | null;
  partyName: string;
  issueDate: string;
  dueDate: string | null;
  lines: DraftedLine[];
  /** What the drafter could not determine, shown as caveats above the lines. */
  caveats: string[];
}

/**
 * Reading a conversation and proposing a business record from it.
 *
 * The one place this product can lead rather than catch up: we own the
 * mailbox, the documents and the ledger, so "turn this agreement into an
 * invoice, and show me the sentence that justifies each line" is a question
 * only we are positioned to answer.
 *
 * THE PROPOSAL IS NEVER POSTED. `accept` creates a DRAFT, exactly like every
 * other AI surface in the product — a human reads the evidence and presses the
 * button. See docs/modules/accounting.md.
 */
export interface MailThreadDrafter {
  /** Stable key, also the `DraftedRecord.kind`. */
  kind: string;
  /** Button label, e.g. "Draft an invoice". */
  label: string;
  /**
   * Propose a record from the conversation, or null when there is nothing to
   * propose. Takes the caller's `tx` (rule 1) so it can only read what the
   * person asking may read.
   *
   * Throwing is allowed here, unlike `search`/`resolve`: this runs from an
   * explicit button press with somewhere to show the error, not while
   * rendering the inbox.
   */
  draft(
    tx: Tx,
    ctx: EntityLinkCtx,
    thread: DraftableThread,
  ): Promise<DraftedRecord | null>;
  /**
   * Turn a reviewed proposal into a real draft record, returning its ref so
   * mail can link the thread to it. Re-validates everything: the record
   * arriving here has been through a browser and is untrusted input.
   */
  accept(
    tx: Tx,
    ctx: EntityLinkCtx,
    record: DraftedRecord,
  ): Promise<LinkableEntityRef>;
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
  /** People the composer can address. Accounting implements it; a CRM would too. */
  contacts?: MailContactSource;
  /**
   * Records this module can draft from a conversation. Accounting contributes
   * an invoice and a bill; a future layer could contribute a job or a quote.
   */
  drafters?: readonly MailThreadDrafter[];
}
