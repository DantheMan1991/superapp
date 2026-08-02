import type {
  JmapChanges,
  JmapEmail,
  JmapEmailAddress,
  JmapEmailBodyPart,
  JmapContact,
  JmapIdentity,
  JmapKeywords,
  JmapMailbox,
  JmapMailboxRole,
  JmapQueryResult,
  JmapSession,
  JmapSessionAccount,
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
): { value: string; truncated: boolean } | null {
  if (!bodyValues || !Array.isArray(parts)) return null;
  for (const raw of parts) {
    const part = asRecord(raw);
    const partId = part?.partId;
    if (typeof partId !== "string") continue;
    const entry = asRecord(bodyValues[partId]);
    if (entry && typeof entry.value === "string") {
      // `isTruncated` is carried, not dropped. A server that cut the body at
      // maxBodyValueBytes cut it at an arbitrary byte — mid-tag for HTML — and
      // a reader shown a partial message with no sign of it is being lied to.
      // Verified present on a live server, which reports it as false when the
      // body fits.
      return { value: entry.value, truncated: asBool(entry.isTruncated) };
    }
  }
  return null;
}

export function parseEmail(raw: unknown): JmapEmail | null {
  const r = asRecord(raw);
  if (!r || typeof r.id !== "string" || r.id.length === 0) return null;

  const bodyValues = asRecord(r.bodyValues);
  const attachments = parseBodyParts(r.attachments);
  const text = resolveBody(r.textBody, bodyValues);
  const html = resolveBody(r.htmlBody, bodyValues);

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
    // Arrays or null on the wire, never bare strings — confirmed live. Kept as
    // null rather than [] when absent, so "not fetched" stays distinguishable
    // from "fetched and empty".
    messageId: Array.isArray(r.messageId) ? asStringArray(r.messageId) : null,
    inReplyTo: Array.isArray(r.inReplyTo) ? asStringArray(r.inReplyTo) : null,
    references: Array.isArray(r.references) ? asStringArray(r.references) : null,
    subject: asString(r.subject),
    sentAt: parseJmapDate(r.sentAt),
    receivedAt: parseJmapDate(r.receivedAt),
    size: asNumber(r.size),
    preview: asString(r.preview),
    // Trust the server's own flag when present; otherwise infer, so a message
    // with attachments never renders as though it had none.
    hasAttachment: asBool(r.hasAttachment, attachments.length > 0),
    attachments,
    textBody: text?.value ?? null,
    htmlBody: html?.value ?? null,
    // Either body being cut makes the message incomplete; the reader is told
    // once, not per part.
    bodyTruncated: (text?.truncated ?? false) || (html?.truncated ?? false),
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

/**
 * Where each well-known mailbox belongs in a folder list.
 *
 * Necessary because Stalwart returns `sortOrder: 0` for every default mailbox
 * (verified against a live server), so sorting by sortOrder then name puts
 * "Deleted Items" at the top and buries the Inbox in the middle. No mail client
 * has ever done that, and users read folder order as meaning.
 *
 * A server that DOES set sortOrder still wins — this only breaks the tie.
 * Unroled folders are the user's own and sort alphabetically after the rest.
 */
const ROLE_ORDER: Record<string, number> = {
  inbox: 0,
  drafts: 1,
  sent: 2,
  archive: 3,
  junk: 4,
  trash: 5,
};

export function compareMailboxes(a: JmapMailbox, b: JmapMailbox): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  const ra = a.role ? (ROLE_ORDER[a.role] ?? 90) : 99;
  const rb = b.role ? (ROLE_ORDER[b.role] ?? 90) : 99;
  if (ra !== rb) return ra - rb;
  return a.name.localeCompare(b.name);
}

export function parseThread(raw: unknown): JmapThread | null {
  const r = asRecord(raw);
  if (!r || typeof r.id !== "string" || r.id.length === 0) return null;
  return { id: r.id, emailIds: asStringArray(r.emailIds) };
}

/**
 * An identity — an address this account may send as.
 *
 * `replyTo` and `bcc` stay NULL when the server sends null rather than becoming
 * `[]`, because the distinction is real: null means "this identity sets no
 * Reply-To", and an empty array would read the same while being a different
 * statement. A live server returns null for both.
 *
 * An identity with no address is not an identity as far as this app is
 * concerned — you cannot send from it — so it parses to null and gets skipped,
 * the same rule the rest of this file follows.
 */
export function parseIdentity(raw: unknown): JmapIdentity | null {
  const r = asRecord(raw);
  if (!r || typeof r.id !== "string" || r.id.length === 0) return null;
  const email = asString(r.email);
  if (email.length === 0) return null;
  return {
    id: r.id,
    name: asString(r.name),
    email,
    replyTo:
      r.replyTo === null || r.replyTo === undefined
        ? null
        : parseAddresses(r.replyTo),
    bcc: r.bcc === null || r.bcc === undefined ? null : parseAddresses(r.bcc),
    textSignature: asString(r.textSignature),
    htmlSignature: asString(r.htmlSignature),
    mayDelete: asBool(r.mayDelete),
  };
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
 * WHICH account in this session is the mailbox someone asked to connect?
 *
 * Proving a token opens *a* mailbox is not the same as proving it opens *the*
 * mailbox. Without this check, clicking Connect on `info@acme.com` and then
 * authorizing as `dan@acme.com` records `info@` as connected while every read
 * returns Dan's personal mail — a mailbox that looks right, reads wrong, and
 * would go on to poison the thread index under the wrong address.
 *
 * IT RETURNS THE ACCOUNT RATHER THAN A BOOLEAN, and that is the delegation
 * slice in one sentence. This used to compare the address against the session's
 * PRIMARY account only, which turned away exactly the case a shared mailbox
 * needs: somebody granted access to `info@` signs in as themselves, so the
 * primary account is *their* mailbox and `info@` is a second entry in
 * `session.accounts`. Matching across all of them finds it — and the caller
 * needs the id that matched, because storing the primary would connect the
 * shared box and then read the delegate's personal mail through it. Precisely
 * the bug this function exists to prevent, one layer further down.
 *
 * A boolean plus a separate lookup was the other shape and is worse: two code
 * paths that can disagree about which account was matched, where disagreeing
 * means showing one person's mail under another's name.
 *
 * `accounts[].name` is the address on this server, verified by
 * `npm run mail:probe-delegation` rather than assumed — the spec only promises
 * a human-readable label. `username` and `accountName` remain accepted for the
 * PRIMARY account, because they are where some servers put the address instead.
 *
 * Three ways to get nothing back, all deliberate and all the same principle —
 * a false refusal costs a connection somebody can retry, a false accept
 * silently files one person's correspondence under another person's address:
 *
 *   • no account matches
 *   • the session identifies none of its accounts at all
 *   • MORE THAN ONE account matches. Ambiguity is refused rather than resolved
 *     by picking the first, because "resolved by picking the first" is how the
 *     wrong mailbox gets connected in the one case nobody tested.
 */
export function matchSessionAccount(
  session: Pick<
    JmapSession,
    "username" | "accountName" | "accounts" | "primaryAccountId"
  >,
  address: string,
): JmapSessionAccount | null {
  const want = address.trim().toLowerCase();
  if (want.length === 0) return null;

  const named = (session.accounts ?? []).filter(
    (a) => a.name.trim().toLowerCase() === want,
  );
  if (named.length > 1) return null;
  if (named.length === 1) return named[0];

  // Nothing matched by account name. The session may still identify its own
  // account through the credentials' fields, which is how this worked before
  // delegation and still how a server that puts a display name in `name`
  // behaves. Only ever resolves to the PRIMARY account — a delegated mailbox
  // is not "the credentials this session belongs to" by definition.
  const credentials = [session.username, session.accountName]
    .map((v) => (v ?? "").trim().toLowerCase())
    .filter((v) => v.length > 0);
  if (!credentials.includes(want)) return null;

  // Resolved by id rather than by `isPersonal`, which is the server's flag and
  // defaults to false here when absent — inferring the primary from it would
  // refuse every session on a server that does not send it.
  return (
    (session.accounts ?? []).find((a) => a.id === session.primaryAccountId) ??
    null
  );
}

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
    // Filled in by discoverJmapSession, which is the only caller that knows
    // where it connected. Parsing cannot know.
    sessionUrl: "",
    apiUrl,
    downloadUrl: asString(r.downloadUrl),
    uploadUrl: asString(r.uploadUrl),
    eventSourceUrl:
      typeof r.eventSourceUrl === "string" ? r.eventSourceUrl : null,
    primaryAccountId: accountId,
    accountName: asString(account?.name),
    accounts: parseSessionAccounts(accounts),
    username: asString(r.username),
    state: asString(r.state),
    capabilities: Object.keys(asRecord(r.capabilities) ?? {}),
  };
}

/**
 * Every account in the session, in the order the server listed them.
 *
 * `isPersonal` and `isReadOnly` default to the CAUTIOUS value rather than the
 * common one — the same rule `parseMailbox` follows for `myRights`. An account
 * whose flags we could not read is treated as delegated and read-only, so a
 * failure to parse costs a disabled button rather than an action that gets
 * refused after somebody has typed a reply.
 */
function parseSessionAccounts(
  accounts: Record<string, unknown> | null,
): JmapSessionAccount[] {
  if (!accounts) return [];
  const out: JmapSessionAccount[] = [];
  for (const [id, raw] of Object.entries(accounts)) {
    const a = asRecord(raw);
    if (!a || id.length === 0) continue;
    out.push({
      id,
      name: asString(a.name),
      isPersonal: asBool(a.isPersonal),
      isReadOnly: asBool(a.isReadOnly, true),
    });
  }
  return out;
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
  /**
   * Which method's response is wanted, when more than one shares the call id.
   *
   * `EmailSubmission/set` with `onSuccessUpdateEmail` emits TWO responses under
   * the same id — its own, and an `Email/set` for the patch it performed. The
   * spec appends the second, so first-match happens to be right today, and
   * relying on ordering that a server is free to change is how a send starts
   * reporting the wrong half of its own result. Name it and the ambiguity is
   * gone.
   */
  methodName?: string,
):
  | { ok: true; name: string; payload: unknown }
  | { ok: false; message: string; errorType?: string } {
  const root = asRecord(body);
  const responses = root?.methodResponses;
  if (!Array.isArray(responses)) {
    return { ok: false, message: "The mail server's reply couldn't be read." };
  }

  for (const entry of responses) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    if (entry[2] !== callId) continue;
    // An `error` response always matches, whatever method was asked for —
    // otherwise a failed call with a name filter would look like no answer.
    if (methodName && entry[0] !== methodName && entry[0] !== "error") continue;

    const name = asString(entry[0]);
    if (name === "error") {
      const err = asRecord(entry[1]);
      const errorType = asString(err?.type, "unknown");
      // The TYPE is carried alongside the sentence, not replaced by it. Callers
      // have to branch on it — `cannotCalculateChanges` means "resync from
      // scratch", and matching that on the text of an English message is the
      // kind of thing that breaks the day the copy is improved.
      return { ok: false, message: describeMethodError(errorType), errorType };
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

/**
 * A JSContact `ContactCard` (RFC 9553) → one flat entry per address.
 *
 * EVERY DECISION HERE CAME FROM `npm run mail:probe-contacts` RATHER THAN FROM
 * THE DRAFT, because the draft has two incompatible object models and this
 * server implements the newer one. What the probe established, against a card it
 * created and read back:
 *
 *   • `emails` is a KEYED OBJECT (`{ work: { address } }`), not the old draft's
 *     array of `{ type, value }`. A parser written from the old model would have
 *     found no addresses at all and reported an empty address book.
 *   • **the server computes `name.full`** ("Aoife Ó Braonáin") from the
 *     components, so a display name does not have to be assembled by hand —
 *     which matters because component order is locale-dependent and getting it
 *     wrong renames people.
 *   • `@type` and `version` are filled in by the server.
 *
 * `name.full` is still only PREFERRED, not required: it is optional in the
 * spec, so the fallback assembles the components in the order given. That is the
 * best a client can do without a locale, and it is why the server computing it
 * is worth relying on where offered.
 *
 * Never throws and never invents: a card with no usable address yields nothing
 * rather than an entry the composer would offer and then fail to send to.
 */
export function parseContactCard(raw: unknown): JmapContact[] {
  const r = asRecord(raw);
  if (!r || typeof r.id !== "string" || r.id.length === 0) return [];

  const name = contactName(r.name);
  const organization = firstOrganizationName(r.organizations);

  const emails = asRecord(r.emails);
  if (!emails) return [];

  const out: JmapContact[] = [];
  const seen = new Set<string>();
  for (const value of Object.values(emails)) {
    const entry = asRecord(value);
    const address = asString(entry?.address).trim();
    if (address.length === 0) continue;
    // One card can list the same address under two contexts; the composer must
    // not offer it twice.
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: r.id, name, email: address, organization });
  }
  return out;
}

/** `name.full` when the server computed one, else the components in order. */
function contactName(raw: unknown): string {
  const name = asRecord(raw);
  if (!name) return "";
  const full = asString(name.full).trim();
  if (full.length > 0) return full;

  const components = Array.isArray(name.components) ? name.components : [];
  return components
    .map((c) => asString(asRecord(c)?.value).trim())
    .filter((v) => v.length > 0)
    .join(" ");
}

/** Cards carry organizations as a keyed object too; the first one is enough. */
function firstOrganizationName(raw: unknown): string {
  const organizations = asRecord(raw);
  if (!organizations) return "";
  for (const value of Object.values(organizations)) {
    const name = asString(asRecord(value)?.name).trim();
    if (name.length > 0) return name;
  }
  return "";
}
