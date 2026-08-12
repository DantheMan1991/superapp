import { describe, expect, it } from "vitest";
import {
  DEFAULT_OFFSETS,
  describeOffset,
  dueReminderOffset,
  parseOffsets,
  reminderTone,
} from "../src/modules/accounting/invoicing/reminder-schedule";
import {
  buildReminderEmail,
  reminderIdempotencyKey,
  reminderKeyPrefix,
  reminderTestIdempotencyKey,
  sentOffsetsFromKeys,
  testSubject,
} from "../src/modules/accounting/invoicing/reminder-email";

/**
 * Automatic reminders, tested without a database.
 *
 * Everything that decides whether a customer gets chased lives in these two
 * pure modules, so this is where the behaviour is pinned. It matters more here
 * than for the rule engine: a mistake in `rules-match` miscodes a row that a
 * human then fixes, and a mistake here emails a stranger about money.
 */

const DUE = "2026-01-10";

function offsetOn(
  today: string,
  sentOffsets: readonly number[] = [],
  offsets: readonly number[] = DEFAULT_OFFSETS,
  dueDate: string | null = DUE,
): number | null {
  return dueReminderOffset({ dueDate, today, offsets, sentOffsets });
}

describe("dueReminderOffset", () => {
  it("never chases an invoice with no due date", () => {
    // There is no date it is late against, and inventing one would mail
    // somebody about a deadline they never agreed to.
    expect(offsetOn("2026-06-01", [], DEFAULT_OFFSETS, null)).toBeNull();
  });

  it("stays silent before the first offset comes round", () => {
    // -3 fires on the 7th; the 6th is still too early.
    expect(offsetOn("2026-01-06")).toBeNull();
  });

  it("fires each offset on its own date", () => {
    expect(offsetOn("2026-01-07")).toBe(-3); // 3 days before
    expect(offsetOn("2026-01-10", [-3])).toBe(0); // on the day
    expect(offsetOn("2026-01-17", [-3, 0])).toBe(7);
    expect(offsetOn("2026-01-24", [-3, 0, 7])).toBe(14);
    expect(offsetOn("2026-02-09", [-3, 0, 7, 14])).toBe(30);
  });

  it("goes quiet once the last offset has been sent", () => {
    // Chasing has to end on its own. An owner extends the schedule if they
    // want more; the code never invents a 31st day.
    expect(offsetOn("2026-06-01", [-3, 0, 7, 14, 30])).toBeNull();
    expect(offsetOn("2027-06-01", [-3, 0, 7, 14, 30])).toBeNull();
  });

  it("sends exactly one reminder when switched on over an old invoice", () => {
    // THE FAILURE THIS DESIGN EXISTS TO PREVENT. An owner enabling reminders
    // over a book of 90-day-old invoices must not send five emails per
    // customer on the first morning.
    expect(offsetOn("2026-04-10")).toBe(30);
    expect(offsetOn("2026-04-11", [30])).toBeNull();
    expect(offsetOn("2026-05-11", [30])).toBeNull();
  });

  it("never sends an earlier offset after a later one is applicable", () => {
    // An invoice 30 days overdue is never told it is "due in three days"
    // merely because that offset was never sent. Earlier offsets are
    // overtaken, not queued.
    expect(offsetOn("2026-02-09", [])).toBe(30);
    expect(offsetOn("2026-02-09", [30])).toBeNull();
  });

  it("walks the whole schedule exactly once, in order", () => {
    const sent: number[] = [];
    // Day by day across four months, as the cron would see it.
    for (let d = 0; d < 130; d += 1) {
      const today = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
      const offset = offsetOn(today, sent);
      if (offset !== null) sent.push(offset);
    }
    expect(sent).toEqual([-3, 0, 7, 14, 30]);
  });

  it("is self-healing when the cron misses a day", () => {
    // The 7-day offset is due on the 17th. If nothing runs that day it is
    // still the latest applicable offset on the 18th, so it goes a day late
    // rather than being lost.
    expect(offsetOn("2026-01-18", [-3, 0])).toBe(7);
  });

  it("handles an unsorted, duplicated offsets list", () => {
    expect(offsetOn("2026-01-17", [], [7, -3, 7, 0])).toBe(7);
  });

  it("sends nothing when the schedule is empty", () => {
    expect(offsetOn("2026-06-01", [], [])).toBeNull();
  });
});

describe("parseOffsets", () => {
  it("sorts and de-duplicates", () => {
    expect(parseOffsets([30, -3, 0, 30, 7])).toEqual([-3, 0, 7, 30]);
  });

  it("accepts the default schedule", () => {
    expect(parseOffsets([...DEFAULT_OFFSETS])).toEqual([-3, 0, 7, 14, 30]);
  });

  it("falls back to sending NOTHING rather than to a default", () => {
    // A tenant whose jsonb cannot be read must not be given a schedule they
    // never chose. Empty is the only safe direction.
    expect(parseOffsets(null)).toEqual([]);
    expect(parseOffsets("nonsense")).toEqual([]);
    expect(parseOffsets([{ day: 7 }])).toEqual([]);
    expect(parseOffsets([1.5])).toEqual([]);
    expect(parseOffsets([-9999])).toEqual([]);
    expect(parseOffsets([1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([]);
  });
});

describe("reminderIdempotencyKey", () => {
  const INV = "11111111-1111-1111-1111-111111111111";
  const OTHER = "22222222-2222-2222-2222-222222222222";

  it("is stable per invoice, offset and recipient", () => {
    expect(reminderIdempotencyKey(INV, 7, "a@b.com")).toBe(
      `reminder:${INV}:7:a@b.com`,
    );
  });

  it("normalizes the recipient so case and spacing cannot double-send", () => {
    expect(reminderIdempotencyKey(INV, 7, "  A@B.com ")).toBe(
      reminderIdempotencyKey(INV, 7, "a@b.com"),
    );
  });

  it("distinguishes offsets, including negative ones", () => {
    expect(reminderIdempotencyKey(INV, -3, "a@b.com")).not.toBe(
      reminderIdempotencyKey(INV, 3, "a@b.com"),
    );
  });

  it("round-trips through the log back into sent offsets", () => {
    const keys = [-3, 0, 7].map((o) => reminderIdempotencyKey(INV, o, "a@b.com"));
    expect(sentOffsetsFromKeys(keys).sort((a, b) => a - b)).toEqual([-3, 0, 7]);
  });

  it("prefix-matches one invoice exactly", () => {
    const mine = reminderIdempotencyKey(INV, 7, "a@b.com");
    const theirs = reminderIdempotencyKey(OTHER, 7, "a@b.com");
    expect(mine.startsWith(reminderKeyPrefix(INV))).toBe(true);
    expect(theirs.startsWith(reminderKeyPrefix(INV))).toBe(false);
  });

  it("keeps a TEST send out of the real namespace entirely", () => {
    // THE PROPERTY THE TEST BUTTON RESTS ON. If a test send counted as an
    // offset already sent, pressing "Test" on the 7-day wording would stop the
    // customer ever getting the real 7-day reminder — a test that silently
    // breaks the feature it is testing.
    const testKey = reminderTestIdempotencyKey(INV, 7, "me@biz.com", "2026-08-12T09:30");
    expect(testKey.startsWith("reminder-test:")).toBe(true);
    expect(testKey.startsWith(reminderKeyPrefix(INV))).toBe(false);
    expect(sentOffsetsFromKeys([testKey])).toEqual([]);

    // ...and it does not collide with the real key for the same offset.
    expect(testKey).not.toBe(reminderIdempotencyKey(INV, 7, "me@biz.com"));
  });

  it("lets a deliberate re-test through, but not a double-click", () => {
    const at = (nonce: string) =>
      reminderTestIdempotencyKey(INV, 7, "me@biz.com", nonce);
    // Same minute → same key → the log dedupes it into one email.
    expect(at("2026-08-12T09:30")).toBe(at("2026-08-12T09:30"));
    // A minute later → a new key → it sends again, which is the point.
    expect(at("2026-08-12T09:31")).not.toBe(at("2026-08-12T09:30"));
  });

  it("marks the subject and leaves the body alone", () => {
    // The body must stay byte-identical: reading what the customer would read
    // is the entire reason to press the button.
    expect(testSubject("Overdue: invoice INV-0007 from Upward LLC")).toBe(
      "[Test] Overdue: invoice INV-0007 from Upward LLC",
    );
  });

  it("ignores keys it cannot parse instead of throwing", () => {
    // A key written by a future version must not stop today's sweep.
    expect(
      sentOffsetsFromKeys([
        "reminder:only-two-parts",
        "invoice:11111111-1111-1111-1111-111111111111:a@b.com",
        "reminder:x:notanumber:a@b.com",
        reminderIdempotencyKey(INV, 14, "a@b.com"),
      ]),
    ).toEqual([14]);
  });
});

describe("buildReminderEmail", () => {
  const base = {
    businessName: "Upward LLC",
    invoiceNumber: "INV-0007",
    customerName: "Acme Co",
    balanceCents: 123_456,
    dueDate: DUE,
    memo: "",
  };

  it("nudges before the due date", () => {
    const mail = buildReminderEmail({ ...base, offset: -3 });
    expect(mail.subject).toBe("Reminder: invoice INV-0007 from Upward LLC");
    expect(mail.text).toContain("is due on 2026-01-10");
    expect(mail.text).toContain("1,234.56");
  });

  it("says so on the day", () => {
    const mail = buildReminderEmail({ ...base, offset: 0 });
    expect(mail.subject).toBe("Due today: invoice INV-0007 from Upward LLC");
    expect(mail.text).toContain("is due today");
  });

  it("counts the days once it is late", () => {
    expect(buildReminderEmail({ ...base, offset: 14 }).text).toContain(
      "14 days ago",
    );
    expect(buildReminderEmail({ ...base, offset: 1 }).text).toContain("1 day ago");
  });

  it("leaves room for the payment already in the post", () => {
    // No blame, no invented consequence — the wording states the facts and
    // stops, because nobody on our side typed this message.
    expect(buildReminderEmail({ ...base, offset: 30 }).text).toContain(
      "already sent payment",
    );
  });

  it("escapes the business and customer names into the html", () => {
    const mail = buildReminderEmail({
      ...base,
      businessName: 'Ben & Co <script>alert("x")</script>',
      customerName: "A & B",
      offset: 7,
    });
    expect(mail.html).toContain("&amp;");
    expect(mail.html).not.toContain("<script>");
  });

  it("names the pdf after the invoice, safely", () => {
    expect(
      buildReminderEmail({ ...base, invoiceNumber: "INV/0007 #2", offset: 7 })
        .attachmentFilename,
    ).toBe("invoice-INV-0007--2.pdf");
  });
});

describe("reminderTone and describeOffset", () => {
  it("derives the tone from the offset rather than storing it", () => {
    expect(reminderTone(-3)).toBe("upcoming");
    expect(reminderTone(0)).toBe("due_today");
    expect(reminderTone(1)).toBe("overdue");
  });

  it("reads as plain language on the settings screen", () => {
    expect(describeOffset(-3)).toBe("3 days before due");
    expect(describeOffset(-1)).toBe("1 day before due");
    expect(describeOffset(0)).toBe("On the due date");
    expect(describeOffset(1)).toBe("1 day after due");
    expect(describeOffset(30)).toBe("30 days after due");
  });
});
