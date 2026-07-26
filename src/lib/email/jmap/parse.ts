import type {
  JmapChanges,
  JmapEmail,
  JmapEmailAddress,
  JmapEmailBodyPart,
  JmapKeywords,
  JmapMailbox,
  JmapMailboxRole,
  JmapQueryResult,
  JmapSession,
  JmapThread,
} from "./types";

/**
 * Pure parsing of JMAP responses.
 *
 * Free of `server-only` on purpose — the same reasoning that keeps
 * migadu-parse.ts and mx.ts separate. These functions decide what an inbox
 * displays, and they should be testable against captured payloads without a
 * network, a database, or a server runtime.
 *
 * Two rules run through all of it:
 *
 *   1. Never invent data. A missing subject is "", never "(no subject)" —
 *      presentation decides how to render an absence, parsing does not
 *      manufacture one.
 *   2. Never throw. A malformed message must not take down a mailbox listing;
 *      it parses to null and gets skipped, so one bad row costs one row.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * JMAP UTCDate → Date. Returns null rather than an Invalid Date, so callers
 * cannot accidentally render "NaN" or sort against garbage.
 */
export function parseJmapDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Addresses. JMAP splits display name from address, and `name` is legitimately
 * null for a bare address — kept as null rather than defaulted to the email, so
 * the UI can decide whether to show one line or two.
 */
export function parseAddresses(value: unknown): JmapEmailAddress[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): JmapEmailAddress[] => {
    const r = asRecord(raw);
    if (!r || typeof r.email !== "string" || r.email.length === 0) return [];
    return [{ name: typeof r.name === "string" ? r.name : null, email: r.email }];
  });
}

function parseKeywords(value: unknown): JmapKeywords {
  const r = asRecord(value);
  if (!r) return {};
  const out: JmapKeywords = {};
  for (const [key, flag] of Object.entries(r)) {
    if (flag === true) out[key] = true;
  }
  return out;
}

function parseBodyParts(value: unknown): JmapEmailBodyPart[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): JmapEmailBodyPart[] => {
    const r = asRecord(raw);
    if (!r) return [];
    return [
      {
        partId: typeof r.partId === "string" ? r.partId : null,
        blobId: typeof r.blobId === "string" ? r.blobId : null,
        size: asNumber(r.size),
        name: typeof r.name === "string" ? r.name : null,
        type: asString(r.type, "application/octet-stream"),
        charset: typeof r.charset === "string" ? r.charset : null,
        disposition: typeof r.disposition === "string" ? r.disposition : null,
        cid: typeof r.cid === "string" ? r.cid : null,
      },
    ];
  });
}

/**
 * Body text lives one level of indirection away: `textBody` lists parts, and
 * `bodyValues` maps partId → the actual string. Only populated when the request
 * asked for it, because fetching bodies for a list view is the standard way to
 * make an inbox feel slow.
 */
function resolveBody(
  parts: unknown,
  bodyValues: Record<string, unknown> | null,
): string | null {
  if (!bodyValues || !Array.isArray(parts)) return null;
  for (const raw of parts) {
    const part = asRecord(raw);
    const partId = part?.partId;
    if (typeof partId !== "string") continue;
    const entry = asRecord(bodyValues[partId]);
    if (entry && typeof entry.value === "string") return entry.value;
  }
  return null;
}

export function parseEmail(raw: unknown): JmapEmail | null {
  const r = asRecord(raw);
  if (!r || typeof r.id !== "string" || r.id.length === 0) return null;

  const bodyValues = asRecord(r.bodyValues);
  const attachments = parseBodyParts(r.attachments);

  return {
    id: r.id,
    blobId: asString(r.blobId),
    threadId: asString(r.threadId),
    mailboxIds: (() => {
      const m = asRecord(r.mailboxIds);
      if (!m) return {};
      const out: Record<string, boolean> = {};
      for (const [id, on] of Object.entries(m)) if (on === true) out[id] = true;
      return out;
    })(),
    keywords: parseKeywords(r.keywords),
    from: parseAddresses(r.from),
    to: parseAddresses(r.to),
    cc: parseAddresses(r.cc),
    bcc: parseAddresses(r.bcc),
    replyTo: parseAddresses(r.replyTo),
    subject: asString(r.subject),
    sentAt: parseJmapDate(r.sentAt),
    receivedAt: parseJmapDate(r.receivedAt),
    size: asNumber(r.size),
    preview: asString(r.preview),
    // Trust the server's own flag when present; otherwise infer, so a message
    // with attachments never renders as though it had none.
    hasAttachment: asBool(r.hasAttachment, attachments.length > 0),
    attachments,
    textBody: resolveBody(r.textBody, bodyValues),
    htmlBody: resolveBody(r.htmlBody, bodyValues),
  };
}

const KNOWN_ROLES: ReadonlySet<string> = new Set([
  "inbox",
  "archive",
  "drafts",
  "sent",
  "trash",
  "junk",
  "important",
  "all",
  "flagged",
  "subscribed",
]);

function parseRole(value: unknown): JmapMailboxRole {
  if (typeof value !== "string") return null;
  // An unrecognized role is treated as no role — a user-created folder, which
  // is what it will behave like anyway.
  return KNOWN_ROLES.has(value) ? (value as JmapMailboxRole) : null;
}

export function parseMailbox(raw: unknown): JmapMailbox | null {
  const r = asRecord(raw);
  if (!r || typeof r.id !== "string" || r.id.length === 0) return null;
  const rights = asRecord(r.myRights);

  return {
    id: r.id,
    name: asString(r.name),
    parentId: typeof r.parentId === "string" ? r.parentId : null,
    role: parseRole(r.role),
    sortOrder: asNumber(r.sortOrder),
    totalEmails: asNumber(r.totalEmails),
    unreadEmails: asNumber(r.unreadEmails),
    totalThreads: asNumber(r.totalThreads),
    unreadThreads: asNumber(r.unreadThreads),
    // Rights default CLOSED. A shared mailbox whose myRights we failed to read
    // must not appear writable — offering an action that will be refused is
    // worse than not offering it.
    mayReadItems: asBool(rights?.mayReadItems),
    mayAddItems: asBool(rights?.mayAddItems),
    mayRemoveItems: asBool(rights?.mayRemoveItems),
    maySetSeen: asBool(rights?.maySetSeen),
    mayDelete: asBool(rights?.mayDelete),
  };
}

export function parseThread(raw: unknown): JmapThread | null {
  const r = asRecord(raw);
  if (!r || typeof r.id !== "string" || r.id.length === 0) return null;
  return { id: r.id, emailIds: asStringArray(r.emailIds) };
}

export function parseQueryResult(raw: unknown): JmapQueryResult | null {
  const r = asRecord(raw);
  if (!r) return null;
  return {
    ids: asStringArray(r.ids),
    // `total` is only returned when the request asked for it; null means
    // "unknown", which is different from zero and must not collapse to it.
    total: typeof r.total === "number" ? r.total : null,
    position: asNumber(r.position),
    queryState: asString(r.queryState),
    canCalculateChanges: asBool(r.canCalculateChanges),
  };
}

export function parseChanges(raw: unknown): JmapChanges | null {
  const r = asRecord(raw);
  if (!r) return null;
  return {
    oldState: asString(r.oldState),
    newState: asString(r.newState),
    created: asStringArray(r.created),
    updated: asStringArray(r.updated),
    destroyed: asStringArray(r.destroyed),
    hasMoreChanges: asBool(r.hasMoreChanges),
  };
}

const MAIL_CAPABILITY = "urn:ietf:params:jmap:mail";

/**
 * The session object from the discovery endpoint.
 *
 * Returns null unless a mail account can actually be identified, because every
 * later call needs an accountId and a session without one is not a usable
 * connection — better to fail at connect time than on the first list.
 */
export function parseSession(raw: unknown): JmapSession | null {
  const r = asRecord(raw);
  if (!r) return null;

  const apiUrl = asString(r.apiUrl);
  if (apiUrl.length === 0) return null;

  const primary = asRecord(r.primaryAccounts);
  let accountId =
    typeof primary?.[MAIL_CAPABILITY] === "string"
      ? (primary[MAIL_CAPABILITY] as string)
      : "";

  const accounts = asRecord(r.accounts);
  // Fall back to the sole account when primaryAccounts omits mail — some
  // servers only populate it for multi-account sessions.
  if (accountId.length === 0 && accounts) {
    const ids = Object.keys(accounts);
    if (ids.length === 1) accountId = ids[0];
  }
  if (accountId.length === 0) return null;

  const account = asRecord(accounts?.[accountId]);

  return {
    apiUrl,
    downloadUrl: asString(r.downloadUrl),
    uploadUrl: asString(r.uploadUrl),
    eventSourceUrl:
      typeof r.eventSourceUrl === "string" ? r.eventSourceUrl : null,
    primaryAccountId: accountId,
    accountName: asString(account?.name),
    state: asString(r.state),
    capabilities: Object.keys(asRecord(r.capabilities) ?? {}),
  };
}

/**
 * Pull one method response out of a JMAP batch by its call id.
 *
 * A batch returns `methodResponses: [[name, payload, callId], ...]` in
 * completion order, not request order, so responses are matched by id. A server
 * reporting a per-call error substitutes `["error", {type}, callId]` in place
 * of the expected response — surfaced here rather than parsed as data, since an
 * error object has none of the fields the caller is about to read.
 */
export function takeMethodResponse(
  body: unknown,
  callId: string,
): { ok: true; name: string; payload: unknown } | { ok: false; message: string } {
  const root = asRecord(body);
  const responses = root?.methodResponses;
  if (!Array.isArray(responses)) {
    return { ok: false, message: "The mail server's reply couldn't be read." };
  }

  for (const entry of responses) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    if (entry[2] !== callId) continue;

    const name = asString(entry[0]);
    if (name === "error") {
      const err = asRecord(entry[1]);
      return {
        ok: false,
        message: describeMethodError(asString(err?.type, "unknown")),
      };
    }
    return { ok: true, name, payload: entry[1] };
  }

  return { ok: false, message: "The mail server didn't answer that request." };
}

/** JMAP error types are terse identifiers; these are what a person can act on. */
export function describeMethodError(type: string): string {
  switch (type) {
    case "accountNotFound":
      return "That mailbox is no longer available on the mail server.";
    case "accountNotSupportedByMethod":
      return "That mailbox doesn't support this operation.";
    case "accountReadOnly":
      return "That mailbox is read-only.";
    case "invalidArguments":
      return "The mail server rejected that request.";
    case "requestTooLarge":
      return "That request asked for too much at once.";
    case "cannotCalculateChanges":
      // Recoverable, and the caller is expected to resync from scratch.
      return "The mail server can't sync incrementally — a full refresh is needed.";
    case "forbidden":
      return "You don't have permission to do that in this mailbox.";
    case "serverFail":
    case "serverUnavailable":
      return "The mail server had a problem. Try again shortly.";
    default:
      return `The mail server refused that request (${type}).`;
  }
}
