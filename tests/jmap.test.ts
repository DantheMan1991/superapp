import { describe, expect, it } from "vitest";
import {
  compareMailboxes,
  describeMethodError,
  parseChanges,
  parseEmail,
  parseJmapDate,
  parseMailbox,
  parseQueryResult,
  parseSession,
  parseThread,
  sessionMatchesAddress,
  takeMethodResponse,
} from "@/lib/email/jmap/parse";
import { rebaseOntoSessionHost } from "@/lib/email/jmap/client";

/**
 * JMAP response parsing.
 *
 * Built against RFC 8620/8621 rather than one server's behaviour, so most
 * fixtures here are spec-shaped. The re-check against real payloads has now
 * happened (Stalwart 0.16.15, via `npm run mail:fixture` + `npm run jmap:probe`)
 * and the captured ones live in the "live payloads" block at the bottom — the
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

describe("mailbox ordering", () => {
  /**
   * Exactly what a live Stalwart returned: five default mailboxes, every one
   * with sortOrder 0. Sorting by sortOrder then name puts "Deleted Items"
   * first and the Inbox third, which no mail client has ever done.
   */
  const LIVE_MAILBOXES = [
    { id: "b", name: "Deleted Items", role: "trash", sortOrder: 0 },
    { id: "c", name: "Junk Mail", role: "junk", sortOrder: 0 },
    { id: "a", name: "Inbox", role: "inbox", sortOrder: 0 },
    { id: "d", name: "Drafts", role: "drafts", sortOrder: 0 },
    { id: "e", name: "Sent Items", role: "sent", sortOrder: 0 },
  ].map((m) => parseMailbox(m)!);

  it("puts the Inbox first when the server ties every sortOrder", () => {
    const order = [...LIVE_MAILBOXES].sort(compareMailboxes).map((m) => m.name);
    expect(order).toEqual([
      "Inbox",
      "Drafts",
      "Sent Items",
      "Junk Mail",
      "Deleted Items",
    ]);
  });

  it("still defers to a server that sets sortOrder", () => {
    // Role order only breaks ties. A server expressing an explicit preference
    // knows something we do not.
    const explicit = [
      parseMailbox({ id: "a", name: "Inbox", role: "inbox", sortOrder: 9 })!,
      parseMailbox({ id: "z", name: "Archive", role: "archive", sortOrder: 1 })!,
    ];
    expect(explicit.sort(compareMailboxes).map((m) => m.name)).toEqual([
      "Archive",
      "Inbox",
    ]);
  });

  it("sorts the user's own folders after the well-known ones", () => {
    const mixed = [
      parseMailbox({ id: "1", name: "Zebra", sortOrder: 0 })!,
      parseMailbox({ id: "2", name: "Inbox", role: "inbox", sortOrder: 0 })!,
      parseMailbox({ id: "3", name: "Apple", sortOrder: 0 })!,
    ];
    expect(mixed.sort(compareMailboxes).map((m) => m.name)).toEqual([
      "Inbox",
      "Apple",
      "Zebra",
    ]);
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

/**
 * Live payloads — captured verbatim from Stalwart 0.16.15 on 2026-07-27, via
 * `npm run mail:fixture` then `npm run jmap:probe`.
 *
 * These exist because a parser written from a specification looks perfectly
 * healthy against invented input. Each assertion below records something the
 * server actually did that the code could reasonably have assumed otherwise.
 */
describe("live payloads (Stalwart 0.16.15)", () => {
  const LIVE_EMAIL = {
    id: "a",
    blobId: "co0dqdhtw2qpbjg1cjvtqupyx0beghfrccuhqqhrs10mmv11bt0gmaiaa",
    threadId: "a",
    mailboxIds: { a: true },
    keywords: {},
    from: [{ name: "Supplier Test", email: "billing@supplier-test.example" }],
    to: [{ name: null, email: "admin@yosher.test" }],
    // Arrays, and null rather than [] when the header is absent.
    messageId: ["fixture-1785201159919@yosher.test"],
    inReplyTo: null,
    references: null,
    subject: "Invoice 4471 — façade works",
    receivedAt: "2026-07-27T18:32:39Z",
    size: 2048,
    hasAttachment: true,
    textBody: [{ partId: "3", type: "text/plain" }],
    htmlBody: [{ partId: "4", type: "text/html" }],
    bodyValues: {
      "3": { value: "Invoice 4471\n\nHello - the invoice is attached.\n", isTruncated: false, isEncodingProblem: false },
      "4": { value: "<html><head>\n<style>body{font-family:sans-serif}</style>\n", isTruncated: false, isEncodingProblem: false },
    },
    attachments: [
      {
        partId: "5",
        blobId: "co0dqdhtw2qpbjg1cjvtqupyx0beghfrccuhqqhrs10mmv11bt0gmaiaahsr2za",
        name: "logo.png",
        type: "image/png",
        charset: null,
        disposition: "inline",
        cid: "logo-part-1@yosher.test",
        size: 70,
      },
      {
        partId: "6",
        blobId: "co0dqdhtw2qpbjg1cjvtqupyx0beghfrccuhqqhrs10mmv11bt0gmaiaagisdcac",
        name: "Facturación año.pdf",
        type: "application/pdf",
        charset: null,
        disposition: "attachment",
        cid: null,
        size: 192,
      },
    ],
  };

  it("returns cid WITHOUT angle brackets, though the message carried them", () => {
    // The wire format was Content-ID: <logo-part-1@yosher.test>. The server
    // strips them. A cid map keyed on the bracketed form would match nothing —
    // and would fail as a missing inline image, not as an error.
    const email = parseEmail(LIVE_EMAIL);
    const inline = email?.attachments.find((a) => a.cid !== null);
    expect(inline?.cid).toBe("logo-part-1@yosher.test");
    expect(inline?.cid).not.toContain("<");
  });

  it("decodes RFC 2047 attachment names for us", () => {
    // Sent as =?utf-8?B?RmFjdHVyYWNpw7NuIGHDsW8ucGRm?=. It comes back decoded,
    // so no encoded-word decoder is needed before Content-Disposition.
    const email = parseEmail(LIVE_EMAIL);
    const pdf = email?.attachments.find((a) => a.type === "application/pdf");
    expect(pdf?.name).toBe("Facturación año.pdf");
    expect(pdf?.name).not.toContain("=?");
  });

  it("lists inline parts among attachments, with a disposition to tell them apart", () => {
    // RFC 8621 says it should; this proves it does. The reading pane relies on
    // it to build the cid map from the same array it renders chips from.
    const email = parseEmail(LIVE_EMAIL);
    expect(email?.attachments).toHaveLength(2);
    expect(email?.attachments.filter((a) => a.disposition === "inline")).toHaveLength(1);
  });

  it("decodes bodies to UTF-8 — no iconv step required", () => {
    const email = parseEmail(LIVE_EMAIL);
    expect(email?.subject).toBe("Invoice 4471 — façade works");
    expect(email?.textBody).toContain("Invoice 4471");
  });

  it("reports isTruncated, and parseEmail carries it", () => {
    const whole = parseEmail(LIVE_EMAIL);
    expect(whole?.bodyTruncated).toBe(false);

    const cut = structuredClone(LIVE_EMAIL);
    cut.bodyValues["4"].isTruncated = true;
    // Either body being cut makes the message incomplete.
    expect(parseEmail(cut)?.bodyTruncated).toBe(true);
  });

  it("treats a missing isTruncated as not truncated", () => {
    // A server that omits the flag must not be read as "truncated" — that
    // would put a "message cut short" warning on every message it sends.
    const noFlag = structuredClone(LIVE_EMAIL);
    for (const part of Object.values(noFlag.bodyValues)) {
      delete (part as { isTruncated?: boolean }).isTruncated;
    }
    expect(parseEmail(noFlag)?.bodyTruncated).toBe(false);
  });

  it("keeps threading headers as arrays, and absent ones as null", () => {
    const email = parseEmail(LIVE_EMAIL);
    expect(email?.messageId).toEqual(["fixture-1785201159919@yosher.test"]);
    // null, not [] — "never fetched" must stay distinguishable from "empty".
    expect(email?.inReplyTo).toBeNull();
    expect(email?.references).toBeNull();
  });
});

describe("session URLs are rebased onto the host we reached", () => {
  // Stalwart advertises its CONFIGURED hostname, not the one the request came
  // in on. Verified live: a session fetched from localhost:8080 returned
  // apiUrl https://mail.yosherdev.com/jmap/ — a name that does not resolve.
  // Without rebasing, every method call and every attachment fetch fails.
  const SESSION_URL = "http://localhost:8080/.well-known/jmap";

  it("replaces a mismatched host, keeping path, query and template variables", () => {
    expect(
      rebaseOntoSessionHost(
        "https://mail.yosherdev.com/jmap/download/{accountId}/{blobId}/{name}?accept={type}",
        SESSION_URL,
      ),
    ).toBe("http://localhost:8080/jmap/download/{accountId}/{blobId}/{name}?accept={type}");
  });

  it("leaves a URL alone when the host already matches", () => {
    const same = "http://localhost:8080/jmap/";
    expect(rebaseOntoSessionHost(same, SESSION_URL)).toBe(same);
  });

  it("returns an unparseable URL untouched rather than guessing at a repair", () => {
    expect(rebaseOntoSessionHost("not a url", SESSION_URL)).toBe("not a url");
  });

  it("distinguishes hosts by port, not just name", () => {
    expect(rebaseOntoSessionHost("http://localhost:9999/jmap/", SESSION_URL)).toBe(
      "http://localhost:8080/jmap/",
    );
  });
});

/**
 * Connecting the RIGHT mailbox.
 *
 * The callback proves a token opens a mailbox. These cover the separate
 * question of WHICH — without it, authorizing as one address while connecting
 * another records a mailbox that looks right and reads wrong.
 */
describe("session identity check", () => {
  const session = (username: string, accountName = "") => ({ username, accountName });

  it("accepts the address the credentials belong to", () => {
    expect(sessionMatchesAddress(session("dan@acme.example"), "dan@acme.example")).toBe(true);
  });

  it("ignores case on both sides", () => {
    expect(sessionMatchesAddress(session("Dan@Acme.Example"), "dan@acme.example")).toBe(true);
    expect(sessionMatchesAddress(session("dan@acme.example"), "  DAN@ACME.EXAMPLE  ")).toBe(true);
  });

  it("REFUSES a different address on the same domain", () => {
    // The case that motivated this: connecting a shared box while signed in as
    // yourself. Same tenant, same domain, wrong mailbox.
    expect(sessionMatchesAddress(session("dan@acme.example"), "info@acme.example")).toBe(false);
  });

  it("falls back to accountName when username is absent", () => {
    // Some servers put the address there instead; the spec only promises
    // accountName is human-friendly, so it is a fallback and not the primary.
    expect(sessionMatchesAddress(session("", "dan@acme.example"), "dan@acme.example")).toBe(true);
  });

  it("refuses when the session identifies itself with NEITHER field", () => {
    // Unverifiable is treated as failed. A false refusal costs a retry; a false
    // accept files one person's correspondence under another person's address.
    expect(sessionMatchesAddress(session("", ""), "dan@acme.example")).toBe(false);
  });

  it("refuses a blank mailbox address rather than matching a blank session", () => {
    expect(sessionMatchesAddress(session("", ""), "")).toBe(false);
    expect(sessionMatchesAddress(session("dan@acme.example"), "   ")).toBe(false);
  });

  it("does not accept a substring or a lookalike", () => {
    expect(sessionMatchesAddress(session("dan@acme.example"), "an@acme.example")).toBe(false);
    expect(sessionMatchesAddress(session("dan@acme.example.evil"), "dan@acme.example")).toBe(false);
  });
});
