/**
 * JMAP object shapes (RFC 8620 core, RFC 8621 mail).
 *
 * Written against the published specification rather than one server's
 * behaviour, which is the whole reason this module can be built before the
 * mail server exists. Stalwart implements the spec; the spec is the contract.
 *
 * Only the subset the inbox actually reads is modelled. JMAP objects carry far
 * more than this, and typing fields nobody uses invites the shape to drift
 * without anyone noticing.
 */

/** A person on a message. JMAP always splits display name from address. */
export interface JmapEmailAddress {
  name: string | null;
  email: string;
}

/**
 * Well-known mailbox roles (RFC 8621 §2). A mailbox may have no role at all —
 * user-created folders don't — so every consumer must handle null.
 */
export type JmapMailboxRole =
  | "inbox"
  | "archive"
  | "drafts"
  | "sent"
  | "trash"
  | "junk"
  | "important"
  | "all"
  | "flagged"
  | "subscribed"
  | null;

export interface JmapMailbox {
  id: string;
  name: string;
  parentId: string | null;
  role: JmapMailboxRole;
  sortOrder: number;
  totalEmails: number;
  unreadEmails: number;
  totalThreads: number;
  unreadThreads: number;
  /** What this account may do here. A shared box can be read-only. */
  mayReadItems: boolean;
  mayAddItems: boolean;
  mayRemoveItems: boolean;
  maySetSeen: boolean;
  mayDelete: boolean;
}

/**
 * Keywords are JMAP's flags, and they are an open set — `$seen`, `$flagged`,
 * `$draft`, `$answered` are standard, but a server or another client may add
 * its own. Modelled as a map rather than booleans so an unknown keyword
 * survives a round trip instead of being silently dropped.
 */
export type JmapKeywords = Record<string, boolean>;

export const KEYWORD_SEEN = "$seen";
export const KEYWORD_FLAGGED = "$flagged";
export const KEYWORD_DRAFT = "$draft";
export const KEYWORD_ANSWERED = "$answered";

export interface JmapEmailBodyPart {
  partId: string | null;
  blobId: string | null;
  size: number;
  name: string | null;
  type: string;
  charset: string | null;
  disposition: string | null;
  cid: string | null;
}

/**
 * A message. `bodyValues` is only populated when explicitly requested, because
 * fetching bodies for a list view is the classic way to make an inbox slow.
 */
export interface JmapEmail {
  id: string;
  blobId: string;
  threadId: string;
  /** Mailbox id → true. A message can be in several at once. */
  mailboxIds: Record<string, boolean>;
  keywords: JmapKeywords;
  from: JmapEmailAddress[];
  to: JmapEmailAddress[];
  cc: JmapEmailAddress[];
  bcc: JmapEmailAddress[];
  replyTo: JmapEmailAddress[];
  /**
   * Threading headers. All three come back as string ARRAYS or null — verified
   * against a live server, where a message with no parent returned
   * `messageId: ["..."]` and `inReplyTo: null` rather than empty arrays.
   * Only populated on a detail fetch; a reply's References chain is built from
   * them, and you cannot build a chain from data you never asked for.
   */
  messageId: string[] | null;
  inReplyTo: string[] | null;
  references: string[] | null;
  subject: string;
  /** When the sender says it was sent. Spoofable; prefer receivedAt for ordering. */
  sentAt: Date | null;
  /** When this server accepted it. The honest timestamp. */
  receivedAt: Date | null;
  size: number;
  preview: string;
  hasAttachment: boolean;
  attachments: JmapEmailBodyPart[];
  /** Populated only when bodies were requested. */
  textBody: string | null;
  htmlBody: string | null;
  /**
   * True when the server cut a body short at `maxBodyValueBytes`.
   *
   * Load-bearing rather than informational: a truncated HTML body is cut at an
   * arbitrary byte, which means mid-tag, which is exactly the malformed input a
   * sanitizer has to survive — and showing a partial message as though it were
   * whole is its own kind of wrong. The UI offers "view original" when set.
   */
  bodyTruncated: boolean;
}

/**
 * An address this account may send as (RFC 8621 §6).
 *
 * Defined by the SUBMISSION capability rather than the mail one, which is worth
 * knowing: a token that can read a mailbox cannot necessarily list its
 * identities, and asking for them is therefore a real test of whether it may
 * send.
 *
 * Signatures live here rather than in a table of ours — the mail server already
 * models them, and a second copy would drift the first time somebody edited one
 * in Outlook.
 */
export interface JmapIdentity {
  id: string;
  name: string;
  email: string;
  replyTo: JmapEmailAddress[] | null;
  bcc: JmapEmailAddress[] | null;
  textSignature: string;
  htmlSignature: string;
  mayDelete: boolean;
}

/**
 * A conversation. The server computes membership from Message-Id / In-Reply-To
 * / References plus subject normalization, and re-threads on out-of-order
 * arrival — none of which we implement.
 */
export interface JmapThread {
  id: string;
  emailIds: string[];
}

/** The session object from the discovery endpoint. */
export interface JmapSession {
  /**
   * Where discovery actually happened — the URL we reached, not one the server
   * told us about. Every other URL here is rebased onto its host, so this is
   * the one address in the session known to work.
   */
  sessionUrl: string;
  /** Where method calls are POSTed. */
  apiUrl: string;
  downloadUrl: string;
  uploadUrl: string;
  eventSourceUrl: string | null;
  /** The mail account this token can act on. */
  primaryAccountId: string;
  accountName: string;
  /**
   * RFC 8620 §2: "the username associated with the given credentials". The
   * address the token actually belongs to, which is not necessarily the address
   * someone clicked Connect on — see the callback's identity check.
   */
  username: string;
  /** Changes whenever anything about the session does. */
  state: string;
  capabilities: string[];
}

/** Sort options the list view offers. Server-side, so paging stays correct. */
export interface JmapQuerySort {
  property: "receivedAt" | "sentAt" | "subject" | "size" | "from";
  isAscending: boolean;
}

/**
 * The filter subset the inbox exposes. JMAP supports considerably more; this is
 * what a search box and a folder click actually need.
 */
export interface JmapEmailFilter {
  inMailbox?: string;
  /** Free text across from, to, subject and body — the search box. */
  text?: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  hasKeyword?: string;
  notKeyword?: string;
  hasAttachment?: boolean;
  after?: Date;
  before?: Date;
}

export interface JmapQueryResult {
  ids: string[];
  total: number | null;
  position: number;
  /** Opaque; feeds the next changes call. */
  queryState: string;
  canCalculateChanges: boolean;
}

export interface JmapChanges {
  oldState: string;
  newState: string;
  created: string[];
  updated: string[];
  destroyed: string[];
  hasMoreChanges: boolean;
}

/** An attachment already uploaded to the mail server's blob store. */
export interface JmapUploadedBlob {
  blobId: string;
  type: string;
  size: number;
}

/**
 * A message ready to become a draft or to be sent.
 *
 * `envelopeRcptTo` is separate from `to`/`cc`/`bcc` ON PURPOSE, and it is the
 * most important field here. The headers are what the recipient reads; the
 * envelope is where the mail server actually delivers. They are normally the
 * same, and outside production they deliberately are not — the dev guard
 * rewrites the envelope and leaves the headers truthful, so Sent holds a real
 * record while delivery goes only to the developer.
 *
 * The client does not compute it. Whoever calls `sendMessage` is responsible for
 * having run the guard, and the field is named so that handing it a header list
 * by accident reads as obviously wrong.
 */
export interface JmapComposedMessage {
  /** Which identity to send as — from `Identity/get`. */
  identityId: string;
  from: JmapEmailAddress;
  to: JmapEmailAddress[];
  cc: JmapEmailAddress[];
  bcc: JmapEmailAddress[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  /** RFC 5322 threading, from `threadHeaders()`. */
  inReplyTo?: string[];
  references?: string[];
  attachments?: { blobId: string; type: string; name: string }[];
  /**
   * Pictures the HTML part references with `cid:`.
   *
   * Separate from `attachments` because the MIME they need is a different SHAPE,
   * not a different disposition — see `draftObject`. A `cid` here must match one
   * in the html body or the recipient gets a file with nothing pointing at it.
   */
  inlineImages?: { blobId: string; cid: string; type: string; name: string }[];
  /** Where the draft is created. Required — every message starts as a draft. */
  draftsMailboxId: string;
  /** Where it lands after sending. Absent means the server decides. */
  sentMailboxId?: string;
  /** Envelope recipients. See the note above; NOT the header list. */
  envelopeRcptTo: string[];
}

/** Every call returns this shape rather than throwing — same rule as MailboxHost. */
export type JmapResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      message: string;
      status?: number;
      needsReauth?: boolean;
      /**
       * The JMAP error TYPE, carried alongside the human sentence.
       *
       * Sync has to branch on `cannotCalculateChanges` to fall back to a full
       * resync, and matching that on the text of an English message breaks the
       * day somebody improves the copy.
       */
      errorType?: string;
    };
