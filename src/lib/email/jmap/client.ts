import "server-only";
import {
  compareMailboxes,
  parseChanges,
  parseEmail,
  parseMailbox,
  parseQueryResult,
  parseSession,
  parseThread,
  takeMethodResponse,
} from "./parse";
import type {
  JmapChanges,
  JmapEmail,
  JmapEmailFilter,
  JmapMailbox,
  JmapQueryResult,
  JmapQuerySort,
  JmapResult,
  JmapSession,
  JmapThread,
} from "./types";

/**
 * The JMAP client.
 *
 * Everything protocol-shaped lives here; everything that reads a payload lives
 * in parse.ts. Built against RFC 8620/8621 rather than one server's behaviour,
 * which is why it could be written before the mail server existed.
 *
 * The design decision that matters most: **one round trip, not two.** JMAP
 * batches method calls and lets a later call reference an earlier one's result
 * (`#ids` back-references), so listing a mailbox is a single POST that queries
 * and fetches together. Doing it as two requests is the standard way to make a
 * JMAP client as slow as the IMAP one it replaced.
 */

const CORE = "urn:ietf:params:jmap:core";
const MAIL = "urn:ietf:params:jmap:mail";
const TIMEOUT_MS = 20_000;
/**
 * Core `maxObjectsInGet` — 500 on the server this was verified against.
 * Conservative rather than read from the session, because exceeding it is an
 * error rather than a truncation, and the failure would land on whoever opened
 * an unusually long thread.
 */
const MAX_OBJECTS_IN_GET = 500;

/** List views never fetch bodies. That is what keeps them fast. */
const LIST_PROPERTIES = [
  "id",
  "blobId",
  "threadId",
  "mailboxIds",
  "keywords",
  "from",
  "to",
  "subject",
  "receivedAt",
  "sentAt",
  "size",
  "preview",
  "hasAttachment",
];

const DETAIL_PROPERTIES = [
  ...LIST_PROPERTIES,
  "cc",
  "bcc",
  "replyTo",
  "textBody",
  "htmlBody",
  "bodyValues",
  "attachments",
];

interface MethodCall {
  0: string;
  1: Record<string, unknown>;
  2: string;
}

async function httpJson(
  url: string,
  token: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<JmapResult<unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      message: timedOut
        ? "The mail server didn't respond in time."
        : "Couldn't reach the mail server.",
    };
  }

  // 401 is special: it means the token is dead, and the only cure is the user
  // reconnecting. Flagged so callers can mark the account needs_reauth rather
  // than retrying forever against a credential that will never work again.
  if (response.status === 401) {
    return {
      ok: false,
      status: 401,
      needsReauth: true,
      message: "This mailbox needs to be reconnected.",
    };
  }

  const raw = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: `The mail server refused that request (${response.status}).`,
    };
  }

  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch {
    return { ok: false, message: "The mail server's reply wasn't valid JSON." };
  }
}

/**
 * Discover the session. One GET that returns the API url, the account id, and
 * what the server can do — everything later calls need.
 */
export async function discoverJmapSession(
  sessionUrl: string,
  token: string,
): Promise<JmapResult<JmapSession>> {
  const result = await httpJson(sessionUrl, token, { method: "GET" });
  if (!result.ok) return result;

  const session = parseSession(result.data);
  if (!session) {
    return {
      ok: false,
      message: "The mail server didn't return a usable mail account.",
    };
  }
  if (!session.capabilities.includes(MAIL)) {
    return {
      ok: false,
      message: "That server doesn't offer mail over this protocol.",
    };
  }
  return { ok: true, data: session };
}

export interface JmapClient {
  readonly session: JmapSession;
  listMailboxes(): Promise<JmapResult<JmapMailbox[]>>;
  queryEmails(opts: {
    filter?: JmapEmailFilter;
    sort?: JmapQuerySort[];
    limit?: number;
    position?: number;
    collapseThreads?: boolean;
  }): Promise<JmapResult<{ query: JmapQueryResult; emails: JmapEmail[] }>>;
  getEmails(ids: string[], withBodies: boolean): Promise<JmapResult<JmapEmail[]>>;
  getThread(threadId: string): Promise<JmapResult<{ thread: JmapThread; emails: JmapEmail[] }>>;
  setKeyword(
    emailIds: string[],
    keyword: string,
    on: boolean,
  ): Promise<JmapResult<{ updated: string[]; failed: string[] }>>;
  moveToMailbox(emailIds: string[], mailboxId: string): Promise<JmapResult<{ updated: string[] }>>;
  emailChanges(sinceState: string): Promise<JmapResult<JmapChanges>>;
  /** Cheap "has anything changed?" — one request, no payload. */
  currentState(): Promise<JmapResult<string>>;
  downloadUrlFor(blobId: string, name: string, type: string): string;
}

function serializeFilter(filter: JmapEmailFilter): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (filter.inMailbox) out.inMailbox = filter.inMailbox;
  if (filter.text) out.text = filter.text;
  if (filter.from) out.from = filter.from;
  if (filter.to) out.to = filter.to;
  if (filter.subject) out.subject = filter.subject;
  if (filter.body) out.body = filter.body;
  if (filter.hasKeyword) out.hasKeyword = filter.hasKeyword;
  if (filter.notKeyword) out.notKeyword = filter.notKeyword;
  if (filter.hasAttachment !== undefined) {
    out.hasAttachment = filter.hasAttachment;
  }
  if (filter.after) out.after = filter.after.toISOString();
  if (filter.before) out.before = filter.before.toISOString();
  return out;
}

export function createJmapClient(
  session: JmapSession,
  token: string,
): JmapClient {
  const accountId = session.primaryAccountId;

  async function call(
    methodCalls: MethodCall[],
  ): Promise<JmapResult<unknown>> {
    return httpJson(session.apiUrl, token, {
      method: "POST",
      body: { using: [CORE, MAIL], methodCalls },
    });
  }

  return {
    session,

    async listMailboxes() {
      const result = await call([["Mailbox/get", { accountId, ids: null }, "m"] as unknown as MethodCall]);
      if (!result.ok) return result;

      const taken = takeMethodResponse(result.data, "m");
      if (!taken.ok) return { ok: false, message: taken.message };

      const list = (taken.payload as { list?: unknown })?.list;
      if (!Array.isArray(list)) {
        return { ok: false, message: "The mail server returned no folders." };
      }
      return {
        ok: true,
        data: list
          .map(parseMailbox)
          .filter((m): m is JmapMailbox => m !== null)
          .sort(compareMailboxes),
      };
    },

    async queryEmails(opts) {
      // Query and fetch in ONE request. The back-reference feeds the query's
      // result ids straight into the get, so the list view costs a single
      // round trip rather than two serialized ones.
      const result = await call([
        [
          "Email/query",
          {
            accountId,
            ...(opts.filter ? { filter: serializeFilter(opts.filter) } : {}),
            sort: opts.sort ?? [{ property: "receivedAt", isAscending: false }],
            limit: opts.limit ?? 50,
            position: opts.position ?? 0,
            calculateTotal: true,
            ...(opts.collapseThreads ? { collapseThreads: true } : {}),
          },
          "q",
        ] as unknown as MethodCall,
        [
          "Email/get",
          {
            accountId,
            "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
            properties: LIST_PROPERTIES,
          },
          "g",
        ] as unknown as MethodCall,
      ]);
      if (!result.ok) return result;

      const queryTaken = takeMethodResponse(result.data, "q");
      if (!queryTaken.ok) return { ok: false, message: queryTaken.message };
      const query = parseQueryResult(queryTaken.payload);
      if (!query) {
        return { ok: false, message: "The mail server's search reply couldn't be read." };
      }

      const getTaken = takeMethodResponse(result.data, "g");
      if (!getTaken.ok) return { ok: false, message: getTaken.message };
      const list = (getTaken.payload as { list?: unknown })?.list;

      const byId = new Map<string, JmapEmail>();
      if (Array.isArray(list)) {
        for (const raw of list) {
          const email = parseEmail(raw);
          if (email) byId.set(email.id, email);
        }
      }
      // Email/get does not promise request order. The query's id order IS the
      // sort order, so restore it rather than trusting the fetch.
      const emails = query.ids
        .map((id) => byId.get(id))
        .filter((e): e is JmapEmail => e !== undefined);

      return { ok: true, data: { query, emails } };
    },

    async getEmails(ids, withBodies) {
      if (ids.length === 0) return { ok: true, data: [] };

      // The server caps objects per get — 500 on the instance this was verified
      // against, advertised as core `maxObjectsInGet`. Asking for more does not
      // truncate politely, it errors, so a large thread or a bulk operation
      // would fail rather than return fewer results. Chunking here means
      // callers never have to know the limit exists.
      const out: JmapEmail[] = [];
      for (let i = 0; i < ids.length; i += MAX_OBJECTS_IN_GET) {
        const batch = ids.slice(i, i + MAX_OBJECTS_IN_GET);
        const result = await call([
          [
            "Email/get",
            {
              accountId,
              ids: batch,
              properties: withBodies ? DETAIL_PROPERTIES : LIST_PROPERTIES,
              ...(withBodies
                ? { fetchTextBodyValues: true, fetchHTMLBodyValues: true }
                : {}),
            },
            "g",
          ] as unknown as MethodCall,
        ]);
        if (!result.ok) return result;

        const taken = takeMethodResponse(result.data, "g");
        if (!taken.ok) return { ok: false, message: taken.message };
        const list = (taken.payload as { list?: unknown })?.list;
        if (Array.isArray(list)) {
          for (const raw of list) {
            const email = parseEmail(raw);
            if (email) out.push(email);
          }
        }
      }
      return { ok: true, data: out };
    },

    async getThread(threadId) {
      // Thread then its messages, chained by back-reference — again one trip.
      const result = await call([
        ["Thread/get", { accountId, ids: [threadId] }, "t"] as unknown as MethodCall,
        [
          "Email/get",
          {
            accountId,
            "#ids": { resultOf: "t", name: "Thread/get", path: "/list/*/emailIds" },
            properties: DETAIL_PROPERTIES,
            fetchTextBodyValues: true,
            fetchHTMLBodyValues: true,
          },
          "g",
        ] as unknown as MethodCall,
      ]);
      if (!result.ok) return result;

      const threadTaken = takeMethodResponse(result.data, "t");
      if (!threadTaken.ok) return { ok: false, message: threadTaken.message };
      const threadList = (threadTaken.payload as { list?: unknown })?.list;
      const thread = Array.isArray(threadList) ? parseThread(threadList[0]) : null;
      if (!thread) {
        return { ok: false, message: "That conversation no longer exists." };
      }

      const getTaken = takeMethodResponse(result.data, "g");
      if (!getTaken.ok) return { ok: false, message: getTaken.message };
      const emailList = (getTaken.payload as { list?: unknown })?.list;
      const byId = new Map<string, JmapEmail>();
      if (Array.isArray(emailList)) {
        for (const raw of emailList) {
          const email = parseEmail(raw);
          if (email) byId.set(email.id, email);
        }
      }
      // Thread.emailIds is already in received order per RFC 8621.
      const emails = thread.emailIds
        .map((id) => byId.get(id))
        .filter((e): e is JmapEmail => e !== undefined);

      return { ok: true, data: { thread, emails } };
    },

    async setKeyword(emailIds, keyword, on) {
      if (emailIds.length === 0) {
        return { ok: true, data: { updated: [], failed: [] } };
      }
      // Patch syntax touches one keyword and leaves the rest alone. Sending a
      // whole keywords object would clobber flags set by another client
      // between our read and our write.
      const update: Record<string, unknown> = {};
      for (const id of emailIds) {
        update[id] = { [`keywords/${keyword}`]: on ? true : null };
      }

      const result = await call([
        ["Email/set", { accountId, update }, "s"] as unknown as MethodCall,
      ]);
      if (!result.ok) return result;

      const taken = takeMethodResponse(result.data, "s");
      if (!taken.ok) return { ok: false, message: taken.message };
      const payload = taken.payload as {
        updated?: Record<string, unknown>;
        notUpdated?: Record<string, unknown>;
      };
      return {
        ok: true,
        data: {
          updated: Object.keys(payload?.updated ?? {}),
          failed: Object.keys(payload?.notUpdated ?? {}),
        },
      };
    },

    async moveToMailbox(emailIds, mailboxId) {
      if (emailIds.length === 0) return { ok: true, data: { updated: [] } };
      // Replacing mailboxIds wholesale is correct here: a move means "be in
      // this folder and no other", unlike a keyword change which is additive.
      const update: Record<string, unknown> = {};
      for (const id of emailIds) {
        update[id] = { mailboxIds: { [mailboxId]: true } };
      }
      const result = await call([
        ["Email/set", { accountId, update }, "s"] as unknown as MethodCall,
      ]);
      if (!result.ok) return result;

      const taken = takeMethodResponse(result.data, "s");
      if (!taken.ok) return { ok: false, message: taken.message };
      const payload = taken.payload as { updated?: Record<string, unknown> };
      return { ok: true, data: { updated: Object.keys(payload?.updated ?? {}) } };
    },

    async emailChanges(sinceState) {
      const result = await call([
        ["Email/changes", { accountId, sinceState, maxChanges: 200 }, "c"] as unknown as MethodCall,
      ]);
      if (!result.ok) return result;

      const taken = takeMethodResponse(result.data, "c");
      if (!taken.ok) return { ok: false, message: taken.message };
      const changes = parseChanges(taken.payload);
      if (!changes) {
        return { ok: false, message: "The mail server's change list couldn't be read." };
      }
      return { ok: true, data: changes };
    },

    async currentState() {
      // Email/get for zero ids returns the account's current state and nothing
      // else — the cheapest possible "did anything change?".
      const result = await call([
        ["Email/get", { accountId, ids: [], properties: ["id"] }, "s"] as unknown as MethodCall,
      ]);
      if (!result.ok) return result;

      const taken = takeMethodResponse(result.data, "s");
      if (!taken.ok) return { ok: false, message: taken.message };
      const state = (taken.payload as { state?: unknown })?.state;
      return typeof state === "string"
        ? { ok: true, data: state }
        : { ok: false, message: "The mail server didn't report its state." };
    },

    downloadUrlFor(blobId, name, type) {
      // RFC 8620 template variables. The name is what the browser will save
      // the file as, so it is encoded rather than interpolated raw.
      return session.downloadUrl
        .replace("{accountId}", encodeURIComponent(accountId))
        .replace("{blobId}", encodeURIComponent(blobId))
        .replace("{name}", encodeURIComponent(name))
        .replace("{type}", encodeURIComponent(type));
    },
  };
}
