import { describe, expect, it } from "vitest";
import {
  describeMethodError,
  parseChanges,
  parseEmail,
  parseJmapDate,
  parseMailbox,
  parseQueryResult,
  parseSession,
  parseThread,
  takeMethodResponse,
} from "@/lib/email/jmap/parse";

/**
 * JMAP response parsing.
 *
 * Built against RFC 8620/8621 rather than one server's behaviour, so these
 * fixtures are spec-shaped rather than captured. They will be re-checked
 * against real payloads via `npm run jmap:probe` once a server exists — the
 * lesson from the Migadu adapter, where two shapes guessed from documentation
 * were both wrong.
 *
 * The tests that matter most are the ones asserting what happens when a field
 * is MISSING, because that is where a parser quietly invents data or throws.
 */

/** Drop keys from a fixture to model a server that omitted them. */
function without<T extends object>(obj: T, ...keys: string[]): Partial<T> {
  const copy = { ...obj } as Record<string, unknown>;
  for (const key of keys) delete copy[key];
  return copy as Partial<T>;
}

describe("dates", () => {
  it("reads a JMAP UTCDate", () => {
    expect(parseJmapDate("2026-07-26T14:15:43Z")?.toISOString()).toBe(
      "2026-07-26T14:15:43.000Z",
    );
  });

  it("returns null rather than an Invalid Date", () => {
    // An Invalid Date renders as "NaN" and sorts unpredictably; null forces
    // the caller to decide what an unknown timestamp looks like.
    for (const bad of ["", "not a date", null, undefined, 42, {}]) {
      expect(parseJmapDate(bad)).toBeNull();
    }
  });
});

describe("emails", () => {
  const FULL = {
    id: "M1",
    blobId: "B1",
    threadId: "T1",
    mailboxIds: { mb1: true, mb2: false },
    keywords: { $seen: true, $flagged: true, $draft: false },
    from: [{ name: "Dana Reeve", email: "dana@example.com" }],
    to: [{ name: null, email: "dan@yosherapp.com" }],
    subject: "Revised drawings",
    receivedAt: "2026-07-26T14:15:43Z",
    sentAt: "2026-07-26T14:15:40Z",
    size: 20480,
    preview: "Attached are the revised…",
    hasAttachment: true,
    attachments: [
      {
        partId: "3",
        blobId: "B2",
        size: 18000,
        name: "A-101.pdf",
        type: "application/pdf",
        disposition: "attachment",
      },
    ],
  };

  it("reads a complete message", () => {
    const email = parseEmail(FULL)!;
    expect(email.id).toBe("M1");
    expect(email.threadId).toBe("T1");
    expect(email.subject).toBe("Revised drawings");
    expect(email.from[0]).toEqual({ name: "Dana Reeve", email: "dana@example.com" });
    expect(email.receivedAt?.toISOString()).toBe("2026-07-26T14:15:43.000Z");
    expect(email.attachments[0].name).toBe("A-101.pdf");
  });

  it("keeps only mailboxes and keywords that are actually set", () => {
    // JMAP maps carry false entries; treating them as present would put a
    // message in a folder it was explicitly removed from.
    const email = parseEmail(FULL)!;
    expect(Object.keys(email.mailboxIds)).toEqual(["mb1"]);
    expect(email.keywords).toEqual({ $seen: true, $flagged: true });
  });

  it("keeps a null display name rather than substituting the address", () => {
    // The UI decides whether a nameless sender shows one line or two. Faking a
    // name here removes that choice.
    expect(parseEmail(FULL)!.to[0].name).toBeNull();
  });

  it("infers hasAttachment when the server omits it", () => {
    expect(parseEmail(without(FULL, "hasAttachment"))!.hasAttachment).toBe(true);
  });

  it("resolves body text through bodyValues", () => {
    // The indirection that trips people up: textBody lists parts, bodyValues
    // holds the strings, keyed by partId.
    const email = parseEmail({
      ...FULL,
      textBody: [{ partId: "1", type: "text/plain" }],
      htmlBody: [{ partId: "2", type: "text/html" }],
      bodyValues: {
        "1": { value: "Plain text here", isTruncated: false },
        "2": { value: "<p>HTML here</p>", isTruncated: false },
      },
    })!;
    expect(email.textBody).toBe("Plain text here");
    expect(email.htmlBody).toBe("<p>HTML here</p>");
  });

  it("has no body when bodies were not requested", () => {
    const email = parseEmail(FULL)!;
    expect(email.textBody).toBeNull();
    expect(email.htmlBody).toBeNull();
  });

  it("survives a message with almost nothing in it", () => {
    // One malformed message must not take down a mailbox listing.
    const email = parseEmail({ id: "M2" })!;
    expect(email.id).toBe("M2");
    expect(email.subject).toBe("");
    expect(email.from).toEqual([]);
    expect(email.receivedAt).toBeNull();
    expect(email.hasAttachment).toBe(false);
  });

  it("rejects a row with no id rather than inventing one", () => {
    expect(parseEmail({ subject: "orphan" })).toBeNull();
    expect(parseEmail(null)).toBeNull();
    expect(parseEmail([])).toBeNull();
  });

  it("drops addresses that carry no email", () => {
    const email = parseEmail({ ...FULL, from: [{ name: "Ghost" }, "nonsense"] })!;
    expect(email.from).toEqual([]);
  });
});

describe("mailboxes", () => {
  it("reads a mailbox and its rights", () => {
    const mb = parseMailbox({
      id: "mb1",
      name: "Inbox",
      parentId: null,
      role: "inbox",
      sortOrder: 0,
      totalEmails: 42,
      unreadEmails: 3,
      totalThreads: 40,
      unreadThreads: 2,
      myRights: { mayReadItems: true, mayAddItems: true, maySetSeen: true },
    })!;
    expect(mb.role).toBe("inbox");
    expect(mb.unreadEmails).toBe(3);
    expect(mb.mayReadItems).toBe(true);
  });

  it("defaults rights CLOSED when they cannot be read", () => {
    // Offering an action the server will refuse is worse than not offering it.
    const mb = parseMailbox({ id: "mb2", name: "Shared" })!;
    expect(mb.mayReadItems).toBe(false);
    expect(mb.mayAddItems).toBe(false);
    expect(mb.mayDelete).toBe(false);
  });

  it("treats an unknown role as no role", () => {
    // A user folder behaves like one regardless of what the server calls it.
    expect(parseMailbox({ id: "mb3", name: "Odd", role: "invented" })!.role).toBeNull();
    expect(parseMailbox({ id: "mb4", name: "Plain" })!.role).toBeNull();
  });
});

describe("threads", () => {
  it("reads message ids in server order", () => {
    const thread = parseThread({ id: "T1", emailIds: ["M1", "M2", "M3"] })!;
    expect(thread.emailIds).toEqual(["M1", "M2", "M3"]);
  });

  it("rejects a thread with no id", () => {
    expect(parseThread({ emailIds: ["M1"] })).toBeNull();
  });
});

describe("query results", () => {
  it("distinguishes an unknown total from zero", () => {
    // `total` only comes back when calculateTotal was requested. Collapsing
    // "unknown" to 0 would render "no results" over a full inbox.
    expect(parseQueryResult({ ids: ["M1"], queryState: "s1" })!.total).toBeNull();
    expect(parseQueryResult({ ids: [], total: 0, queryState: "s1" })!.total).toBe(0);
  });

  it("reads ids and paging state", () => {
    const q = parseQueryResult({
      ids: ["M1", "M2"],
      total: 2,
      position: 0,
      queryState: "abc",
      canCalculateChanges: true,
    })!;
    expect(q.ids).toEqual(["M1", "M2"]);
    expect(q.queryState).toBe("abc");
    expect(q.canCalculateChanges).toBe(true);
  });
});

describe("changes", () => {
  it("reads a delta", () => {
    const c = parseChanges({
      oldState: "s1",
      newState: "s2",
      created: ["M9"],
      updated: ["M1"],
      destroyed: [],
      hasMoreChanges: false,
    })!;
    expect(c.created).toEqual(["M9"]);
    expect(c.newState).toBe("s2");
    expect(c.hasMoreChanges).toBe(false);
  });
});

describe("sessions", () => {
  const SESSION = {
    capabilities: {
      "urn:ietf:params:jmap:core": {},
      "urn:ietf:params:jmap:mail": {},
    },
    accounts: { acc1: { name: "dan@yosherapp.com", isPersonal: true } },
    primaryAccounts: { "urn:ietf:params:jmap:mail": "acc1" },
    apiUrl: "https://mail.example.com/jmap/",
    downloadUrl: "https://mail.example.com/dl/{accountId}/{blobId}/{name}",
    uploadUrl: "https://mail.example.com/upload/{accountId}",
    eventSourceUrl: "https://mail.example.com/events",
    state: "sess-1",
  };

  it("reads the account id from primaryAccounts", () => {
    const s = parseSession(SESSION)!;
    expect(s.primaryAccountId).toBe("acc1");
    expect(s.accountName).toBe("dan@yosherapp.com");
    expect(s.capabilities).toContain("urn:ietf:params:jmap:mail");
  });

  it("falls back to the sole account when primaryAccounts omits mail", () => {
    expect(parseSession(without(SESSION, "primaryAccounts"))!.primaryAccountId).toBe(
      "acc1",
    );
  });

  it("refuses a session with no identifiable account", () => {
    // Every later call needs an accountId — better to fail at connect than on
    // the first list.
    expect(parseSession(without(SESSION, "primaryAccounts", "accounts"))).toBeNull();
  });

  it("refuses a session with no apiUrl", () => {
    expect(parseSession(without(SESSION, "apiUrl"))).toBeNull();
  });
});

describe("method responses", () => {
  const BODY = {
    methodResponses: [
      ["Email/query", { ids: ["M1"], queryState: "q1" }, "q"],
      ["Email/get", { list: [{ id: "M1" }], state: "s1" }, "g"],
    ],
    sessionState: "sess-1",
  };

  it("matches by call id, not by position", () => {
    // JMAP returns responses in completion order, which is not request order.
    const taken = takeMethodResponse(BODY, "g");
    expect(taken.ok).toBe(true);
    if (taken.ok) {
      expect(taken.name).toBe("Email/get");
      expect((taken.payload as { state: string }).state).toBe("s1");
    }
  });

  it("surfaces a per-call error instead of parsing it as data", () => {
    // The server substitutes ["error", {type}, callId] in place of the
    // expected response, and an error object has none of the fields the
    // caller is about to read.
    const taken = takeMethodResponse(
      { methodResponses: [["error", { type: "forbidden" }, "q"]] },
      "q",
    );
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.message).toContain("permission");
  });

  it("reports a call that was never answered", () => {
    const taken = takeMethodResponse(BODY, "missing");
    expect(taken.ok).toBe(false);
  });

  it("reports an unreadable body rather than throwing", () => {
    for (const bad of [null, undefined, "nope", { methodResponses: "nope" }]) {
      expect(takeMethodResponse(bad, "q").ok).toBe(false);
    }
  });

  it("translates JMAP error types into something actionable", () => {
    expect(describeMethodError("accountReadOnly")).toContain("read-only");
    expect(describeMethodError("cannotCalculateChanges")).toContain("full refresh");
    expect(describeMethodError("serverUnavailable")).toContain("Try again");
    // Unknown types still name themselves, so a support conversation has
    // something concrete in it.
    expect(describeMethodError("weirdNewError")).toContain("weirdNewError");
  });
});
