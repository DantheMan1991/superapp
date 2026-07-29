import { describe, expect, it } from "vitest";
import { KEYWORD_FLAGGED, KEYWORD_SEEN } from "@/lib/email/jmap/types";
import {
  describeView,
  filterChips,
  isEmptyView,
  parseMailView,
  readMailView,
  toJmapFilter,
} from "@/modules/email/organise/filters";

/**
 * Filters and saved views.
 *
 * One shape is used three ways — the URL, the JMAP filter, and the blob a saved
 * search stores — and the whole value of putting it in one file is that those
 * three cannot drift. So the tests check the round trip, not just each half.
 */

describe("readMailView", () => {
  it("reads the folder, the term and the three flags", () => {
    expect(
      readMailView({ mailbox: "abc", q: " quote ", unread: "1", attach: "1" }),
    ).toEqual({ mailbox: "abc", q: "quote", unread: true, attach: true });
  });

  it("treats anything but '1' as off", () => {
    // A stray `?unread=0` or `?unread=false` must not silently filter the view.
    expect(readMailView({ unread: "0" })).toEqual({});
    expect(readMailView({ unread: "false" })).toEqual({});
    expect(readMailView({ unread: "" })).toEqual({});
  });

  it("drops a whitespace-only search term", () => {
    expect(readMailView({ q: "   " })).toEqual({});
  });

  it("bounds a runaway term rather than sending it to the mail server", () => {
    const view = readMailView({ q: "x".repeat(5_000) });
    expect(view.q).toHaveLength(200);
  });
});

describe("toJmapFilter", () => {
  it("narrows to the current folder when there is no search term", () => {
    expect(toJmapFilter({}, "inbox-id")).toEqual({ inMailbox: "inbox-id" });
  });

  it("a search term spans the account and DROPS the folder", () => {
    // The worst failure a mail search has is "no results" because you were
    // standing in the wrong folder. There is a test so it stays that way.
    const filter = toJmapFilter({ q: "invoice" }, "inbox-id");
    expect(filter.text).toBe("invoice");
    expect(filter.inMailbox).toBeUndefined();
  });

  it("unread is the ABSENCE of $seen, not a keyword of its own", () => {
    // JMAP has no "isUnread". Asking for hasKeyword:"$unseen" — which does not
    // exist — would silently match nothing at all.
    const filter = toJmapFilter({ unread: true }, "inbox-id");
    expect(filter.notKeyword).toBe(KEYWORD_SEEN);
    expect(filter.hasKeyword).toBeUndefined();
  });

  it("flagged and attachments map to their own fields", () => {
    const filter = toJmapFilter({ flagged: true, attach: true }, null);
    expect(filter.hasKeyword).toBe(KEYWORD_FLAGGED);
    expect(filter.hasAttachment).toBe(true);
  });

  it("combines a term with filters", () => {
    const filter = toJmapFilter({ q: "quote", unread: true, attach: true }, "x");
    expect(filter).toEqual({
      text: "quote",
      notKeyword: KEYWORD_SEEN,
      hasAttachment: true,
    });
  });

  it("an explicit mailbox in the view beats the fallback", () => {
    expect(toJmapFilter({ mailbox: "chosen" }, "current")).toEqual({
      inMailbox: "chosen",
    });
  });

  it("no folder anywhere means no folder predicate", () => {
    expect(toJmapFilter({}, null)).toEqual({});
  });
});

describe("parseMailView", () => {
  it("round-trips what readMailView produces", () => {
    const view = readMailView({ mailbox: "abc", q: "quote", flagged: "1" });
    expect(parseMailView(view)).toEqual(view);
  });

  it("strips unknown keys a hand-edited row might carry", () => {
    // The stored blob is user input. Zod's default `strip` is what stops a
    // smuggled field reaching the filter.
    expect(
      parseMailView({ q: "quote", inMailbox: "evil", limit: 99999 }),
    ).toEqual({ q: "quote" });
  });

  it("degrades a broken field to absent rather than throwing", () => {
    // `.catch()` on every field: a view written by an older or newer version of
    // this code must not throw during a page render.
    expect(parseMailView({ q: 42, unread: "yes" })).toEqual({});
    expect(parseMailView(null)).toEqual({});
    expect(parseMailView("nonsense")).toEqual({});
  });
});

describe("isEmptyView", () => {
  it("a bare folder is empty — that is what the rail is for", () => {
    expect(isEmptyView({})).toBe(true);
    expect(isEmptyView({ mailbox: "abc" })).toBe(true);
  });

  it("a term or any filter makes it worth saving", () => {
    expect(isEmptyView({ q: "quote" })).toBe(false);
    expect(isEmptyView({ unread: true })).toBe(false);
    expect(isEmptyView({ flagged: true })).toBe(false);
    expect(isEmptyView({ attach: true })).toBe(false);
  });
});

describe("describeView", () => {
  it("names the filters so nobody has to invent a name", () => {
    expect(describeView({ unread: true, flagged: true }, "Inbox")).toBe(
      "unread, flagged, in Inbox",
    );
  });

  it("omits the folder when there is a search term, because the search ignores it", () => {
    // Saying "in Inbox" for an account-wide search would describe a view that
    // is not the one being run.
    expect(describeView({ q: "quote" }, "Inbox")).toBe("“quote”");
  });

  it("falls back to something honest", () => {
    expect(describeView({}, null)).toBe("All mail");
  });
});

describe("filterChips", () => {
  it("returns all three in a fixed order, with the active ones marked", () => {
    const chips = filterChips({ flagged: true });
    expect(chips.map((c) => c.key)).toEqual(["unread", "flagged", "attach"]);
    expect(chips.map((c) => c.active)).toEqual([false, true, false]);
  });
});
