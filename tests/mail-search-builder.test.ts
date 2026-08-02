import { describe, expect, it } from "vitest";
import {
  describeView,
  isEmptyView,
  nextDay,
  parseMailView,
  readMailView,
  toJmapFilter,
  usesBuilder,
} from "@/modules/email/organise/filters";

/**
 * The advanced search builder.
 *
 * EVERY FIELD OFFERED WAS VERIFIED AGAINST THE LIVE SERVER first.
 * `npm run mail:probe-search` runs each JMAP condition against a message built
 * to match and a decoy built not to, because the dangerous outcome is not a
 * REJECTED condition — it is an ACCEPTED AND IGNORED one. A `from` filter that
 * is silently dropped turns "find mail from Dan" into "here is everything",
 * which reads as a bad search rather than a bug and never gets reported.
 *
 * The probe also found something worth remembering beyond this feature: the
 * server's full-text index is ASYNCHRONOUS. A message just filed is not
 * instantly findable, and the first version of the probe reported whichever
 * condition ran first as unsupported.
 *
 * `header` is deliberately absent from the vocabulary — the one condition the
 * probe could not make behave.
 */

describe("the vocabulary", () => {
  it("reads the builder's fields out of the URL", () => {
    const view = readMailView({
      from: " dan@acme.example ",
      subject: "quotation",
      after: "2026-07-01",
      before: "2026-07-31",
    });
    expect(view.from).toBe("dan@acme.example");
    expect(view.subject).toBe("quotation");
    expect(view.after).toBe("2026-07-01");
  });

  it("drops a date that is not a date", () => {
    // A bad value degrades to ABSENT rather than reaching the mail server or
    // throwing during a page render.
    for (const bad of ["yesterday", "2026-7-1", "01/07/2026", "2026-07-01T00:00"]) {
      expect(readMailView({ after: bad }).after, bad).toBeUndefined();
    }
  });

  it("survives a hand-edited saved search", () => {
    // Stored blobs are re-parsed every time, including rows this code wrote.
    const parsed = parseMailView({
      from: "dan@acme.example",
      after: "not-a-date",
      // Zod's default strip drops unknown keys, so a hand-edited row cannot
      // smuggle a field into the filter.
      header: ["X-Evil", "yes"],
    });
    expect(parsed.from).toBe("dan@acme.example");
    expect(parsed.after).toBeUndefined();
    expect("header" in parsed).toBe(false);
  });

  it("knows when the builder is in use", () => {
    expect(usesBuilder({ q: "quote" })).toBe(false);
    expect(usesBuilder({ from: "dan" })).toBe(true);
    expect(usesBuilder({ before: "2026-07-31" })).toBe(true);
  });

  it("counts a builder search as non-empty, so it can be saved", () => {
    expect(isEmptyView({})).toBe(true);
    expect(isEmptyView({ from: "dan" })).toBe(false);
  });
});

describe("toJmapFilter", () => {
  it("puts every field in ONE condition object", () => {
    // RFC 8621 already ANDs the properties within a single FilterCondition, so
    // no operator is needed. The probe verified AND, OR and NOT all work — and
    // not needing them is the better outcome.
    const filter = toJmapFilter(
      { from: "dan", subject: "quote", unread: true, attach: true },
      null,
    );
    expect(filter).toMatchObject({
      from: "dan",
      subject: "quote",
      notKeyword: "$seen",
      hasAttachment: true,
    });
    expect("operator" in filter).toBe(false);
  });

  describe("the folder rule", () => {
    it("narrows to the current folder when nothing is being searched", () => {
      expect(toJmapFilter({}, "inbox-id")).toEqual({ inMailbox: "inbox-id" });
    });

    it("SPANS the account for a quick search", () => {
      // Hunting for something you know exists and being told "no results"
      // because you were standing in the wrong folder is the worst failure a
      // mail search has.
      expect(toJmapFilter({ q: "quote" }, "inbox-id")).toEqual({ text: "quote" });
    });

    it("HONOURS a folder the builder chose", () => {
      // Somebody who opened the builder and picked a folder has said where to
      // look. Ignoring that would be its own kind of wrong.
      const filter = toJmapFilter({ from: "dan", mailbox: "clients" }, "inbox-id");
      expect(filter.inMailbox).toBe("clients");
      expect(filter.from).toBe("dan");
    });

    it("still spans the account when the builder names no folder", () => {
      const filter = toJmapFilter({ from: "dan" }, "inbox-id");
      expect(filter.inMailbox).toBeUndefined();
    });
  });

  describe("dates", () => {
    it("includes both ends of the range", () => {
      // "Before 3 August" means everything sent ON the 3rd, which is what the
      // words mean to a person — and not what a naive conversion produces.
      const filter = toJmapFilter({ after: "2026-07-01", before: "2026-07-31" }, null);
      expect(filter.after?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
      expect(filter.before?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    });

    it("rolls over a month and a year end", () => {
      expect(nextDay("2026-07-31")).toBe("2026-08-01");
      expect(nextDay("2026-12-31")).toBe("2027-01-01");
      // And a leap day, which is the one people get wrong by hand.
      expect(nextDay("2028-02-28")).toBe("2028-02-29");
    });

    it("takes one end without the other", () => {
      expect(toJmapFilter({ after: "2026-07-01" }, null).before).toBeUndefined();
      expect(toJmapFilter({ before: "2026-07-31" }, null).after).toBeUndefined();
    });
  });

  it("never emits `header`, which the probe could not make behave", () => {
    const filter = toJmapFilter(
      // Even if a hand-edited saved search carried one, the schema strips it
      // before this is reached — asserted from the other end here.
      parseMailView({ header: ["X-Thing", "value"], from: "dan" }),
      null,
    );
    expect(JSON.stringify(filter)).not.toContain("header");
  });
});

describe("describeView", () => {
  it("names each builder field, so a saved search does not need a name invented", () => {
    expect(
      describeView({ from: "dan@acme.example", subject: "quote" }, null),
    ).toBe("from dan@acme.example, subject quote");
  });

  it("reads a date range as a range", () => {
    expect(describeView({ after: "2026-07-01", before: "2026-07-31" }, null)).toBe(
      "2026-07-01 to 2026-07-31",
    );
  });

  it("mentions the folder only when the folder is actually applied", () => {
    // A quick search ignores the folder, so naming it would describe a view
    // that is not the one being run.
    expect(describeView({ q: "quote" }, "Inbox")).toBe("“quote”");
    // The builder honours it, so there it belongs in the description.
    expect(describeView({ from: "dan", mailbox: "x" }, "Clients")).toBe(
      "from dan, in Clients",
    );
  });

  it("falls back to something a person would recognise", () => {
    expect(describeView({}, null)).toBe("All mail");
  });
});
