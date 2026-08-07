import { describe, expect, it } from "vitest";
import { computeDelta, type PersonDigest } from "../src/lib/notifications/digest";
import {
  deltaSentence,
  digestSubject,
  incompleteSentence,
  renderDigestHtml,
  renderDigestText,
} from "../src/lib/notifications/email";
import type { AttentionItem } from "../src/lib/attention-sources/types";

/**
 * The digest's arithmetic and its words. Pure — no database, always runs.
 *
 * The email is the product here: almost everything else in this feature exists
 * to produce it, and it is read once a day by people who will stop opening it
 * the moment it stops telling them something.
 */

function item(key: string, over: Partial<AttentionItem> = {}): AttentionItem {
  return {
    key,
    title: `Item ${key}`,
    urgency: "today",
    dueOn: "2026-08-06",
    href: `/dashboard/x/${key}`,
    ...over,
  };
}

function digest(over: Partial<PersonDigest> = {}): PersonDigest {
  return {
    tenantId: "t1",
    profileId: "p1",
    clerkUserId: "u1",
    email: "sam@example.test",
    name: "Sam Rivera",
    role: "owner",
    localDate: "2026-08-06",
    items: [],
    delta: { newKeys: [], carriedKeys: [], first: false },
    failed: [],
    complete: true,
    ...over,
  };
}

describe("computeDelta", () => {
  it("treats everything as new when there is no previous digest", () => {
    const d = computeDelta(["a", "b"], null);
    expect(d).toEqual({ newKeys: ["a", "b"], carriedKeys: [], first: true });
  });

  it("splits new from carried", () => {
    const d = computeDelta(["a", "b", "c"], ["b", "z"]);
    expect(d.newKeys).toEqual(["a", "c"]);
    expect(d.carriedKeys).toEqual(["b"]);
    expect(d.first).toBe(false);
  });

  it("an item that went away is simply absent — nothing to report", () => {
    // Derived obligations disappear by being done. There is no "completed"
    // section, because that would be a changelog and this is a to-do list.
    const d = computeDelta(["a"], ["a", "b"]);
    expect(d.newKeys).toEqual([]);
    expect(d.carriedKeys).toEqual(["a"]);
  });

  it("an empty day after a busy one is all-clear, not a delta", () => {
    const d = computeDelta([], ["a", "b"]);
    expect(d.newKeys).toEqual([]);
    expect(d.carriedKeys).toEqual([]);
  });
});

describe("digestSubject", () => {
  it("leads with the number, because that is what survives a lock screen", () => {
    expect(
      digestSubject(
        digest({
          items: [item("a"), item("b"), item("c")],
          delta: { newKeys: ["a"], carriedKeys: ["b", "c"], first: false },
        }),
      ),
    ).toBe("3 things need you (1 new)");
  });

  it("singular reads like a person wrote it", () => {
    expect(
      digestSubject(
        digest({
          items: [item("a")],
          delta: { newKeys: [], carriedKeys: ["a"], first: false },
        }),
      ),
    ).toBe("1 thing needs you");
  });

  it("omits the new-count on the very first digest", () => {
    // "(3 new)" on day one is meaningless — new since what?
    expect(
      digestSubject(
        digest({
          items: [item("a"), item("b"), item("c")],
          delta: { newKeys: ["a", "b", "c"], carriedKeys: [], first: true },
        }),
      ),
    ).toBe("3 things need you");
  });

  it("says the all-clear rather than sending a zero", () => {
    expect(digestSubject(digest())).toBe("Nothing needs you today");
  });

  it("does NOT claim all-clear when a source could not be checked", () => {
    // The distinction the whole resolve layer exists to preserve, carried all
    // the way to the subject line.
    expect(
      digestSubject(
        digest({ complete: false, failed: [{ slug: "acc", label: "Accounting" }] }),
      ),
    ).toBe("Your daily summary (incomplete)");
  });
});

describe("deltaSentence", () => {
  it("reports both halves when both exist", () => {
    expect(
      deltaSentence(
        digest({
          items: [item("a"), item("b"), item("c"), item("d"), item("e")],
          delta: { newKeys: ["a", "b"], carriedKeys: ["c", "d", "e"], first: false },
        }),
      ),
    ).toBe("2 new since last time, 3 still waiting.");
  });

  it("names the stale case explicitly — the day-30 failure mode", () => {
    // An unchanged list is exactly when a digest starts being ignored, so it
    // must say so rather than re-presenting itself as news.
    expect(
      deltaSentence(
        digest({
          items: [item("a"), item("b")],
          delta: { newKeys: [], carriedKeys: ["a", "b"], first: false },
        }),
      ),
    ).toBe("Nothing new since last time — 2 still waiting.");
  });

  it("does not say 'since last time' on the first one", () => {
    expect(
      deltaSentence(
        digest({
          items: [item("a")],
          delta: { newKeys: ["a"], carriedKeys: [], first: true },
        }),
      ),
    ).toBe("One thing is outstanding.");
  });
});

describe("incompleteSentence", () => {
  it("is null when everything answered", () => {
    expect(incompleteSentence(digest())).toBeNull();
  });

  it("names one failed source", () => {
    expect(
      incompleteSentence(
        digest({ failed: [{ slug: "acc", label: "Accounting" }], complete: false }),
      ),
    ).toBe("We could not check Accounting this morning, so this list may be short.");
  });

  it("names several readably", () => {
    expect(
      incompleteSentence(
        digest({
          complete: false,
          failed: [
            { slug: "a", label: "Accounting" },
            { slug: "b", label: "Follow-ups" },
          ],
        }),
      ),
    ).toBe(
      "We could not check Accounting and Follow-ups this morning, so this list may be short.",
    );
  });
});

describe("rendering", () => {
  const full = digest({
    items: [
      item("a", { title: "Invoice 1043 is 6 days overdue", urgency: "overdue" }),
      item("b", { title: "Call the roofer back" }),
      item("c", { title: "Nobody owns this", unassigned: true }),
    ],
    delta: { newKeys: ["a"], carriedKeys: ["b", "c"], first: false },
  });

  it("text is actionable without clicking: every item and its link is present", () => {
    const text = renderDigestText(full);
    expect(text).toContain("Invoice 1043 is 6 days overdue");
    expect(text).toContain("Call the roofer back");
    expect(text).toContain("/dashboard/x/a");
    expect(text).toContain("/dashboard/x/b");
  });

  it("text marks what is new and separates unassigned work", () => {
    const text = renderDigestText(full);
    expect(text).toContain("NEW  Invoice 1043");
    expect(text).toContain("NOT ASSIGNED TO ANYONE");
    expect(text).toContain("Nobody owns this");
  });

  it("text always offers a way out", () => {
    // A digest that cannot be turned off gets filtered instead, and a filtered
    // email is worse than an unsubscribed one.
    expect(renderDigestText(full)).toContain("Stop these emails");
  });

  it("the all-clear is a message, not an empty body", () => {
    const text = renderDigestText(digest());
    expect(text).toContain("Nothing is outstanding.");
    expect(text).toContain("No follow-ups due and nothing waiting on you.");
  });

  it("html escapes titles rather than trusting them", () => {
    // Item titles carry customer-entered data — a task called
    // `<script>` must not become one.
    const html = renderDigestHtml(
      digest({
        items: [item("x", { title: `<script>alert(1)</script>` })],
        delta: { newKeys: [], carriedKeys: ["x"], first: false },
      }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("html names the incomplete case too", () => {
    const html = renderDigestHtml(
      digest({ complete: false, failed: [{ slug: "a", label: "Accounting" }] }),
    );
    expect(html).toContain("could not check Accounting");
  });

  it("ONE NUMBER EVERYWHERE: subject count equals the item count both surfaces render", () => {
    // The design's credibility rule. The in-app page renders `digest.items`
    // directly and the subject is derived from the same array, so this asserts
    // the two cannot drift without a test failing.
    const d = digest({
      items: [item("a"), item("b"), item("c"), item("d")],
      delta: { newKeys: ["a"], carriedKeys: ["b", "c", "d"], first: false },
    });
    expect(digestSubject(d)).toContain("4 things");
    expect(d.items).toHaveLength(4);
    const text = renderDigestText(d);
    for (const i of d.items) expect(text).toContain(i.title);
  });
});
