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
  /** Where method calls are POSTed. */
  apiUrl: string;
  downloadUrl: string;
  uploadUrl: string;
  eventSourceUrl: string | null;
  /** The mail account this token can act on. */
  primaryAccountId: string;
  accountName: string;
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

/** Every call returns this shape rather than throwing — same rule as MailboxHost. */
export type JmapResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; status?: number; needsReauth?: boolean };
