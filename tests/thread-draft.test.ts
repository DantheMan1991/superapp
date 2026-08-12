import { describe, expect, it } from "vitest";
import type { DraftableThread } from "../src/lib/mail-extensions/types";
import {
  MIN_QUOTE_CHARS,
  normalizeForQuoteMatch,
  quoteAppearsIn,
  validateThreadDraft,
} from "../src/modules/accounting/ai/thread-draft-validate";
import {
  buildThreadDraftUserTurn,
  threadDraftSystemPrompt,
  threadDraftTool,
  MESSAGE_CHAR_CAP,
} from "../src/modules/accounting/ai/thread-draft-prompt";

/**
 * Drafting a record from a conversation, tested without a database or a model.
 *
 * The citation check is the whole reason anybody can trust this feature in the
 * five seconds they will actually give it, so it is where the tests are.
 */

const TODAY = "2026-08-12";

const THREAD: DraftableThread = {
  subject: "Kitchen rewire",
  messages: [
    {
      from: "client@acme.test",
      date: "2026-08-01",
      text: "Hi — can you quote for rewiring the kitchen?",
    },
    {
      from: "me@sparks.test",
      date: "2026-08-02",
      text: "Happy to. It would be $1,850.00 for labour\nand materials, done in two days.",
    },
    {
      from: "client@acme.test",
      date: "2026-08-03",
      text: "That works, go ahead. Please invoice on completion.",
    },
  ],
};

const PARTIES = new Set(["11111111-1111-1111-1111-111111111111"]);

function raw(over: Record<string, unknown> = {}) {
  return {
    partyId: "11111111-1111-1111-1111-111111111111",
    partyName: "Acme Ltd",
    issueDate: "2026-08-03",
    dueDate: null,
    lines: [
      {
        description: "Kitchen rewire, labour and materials",
        quantity: "1",
        unitPriceCents: 185_000,
        citationMessageIndex: 1,
        citationQuote: "It would be $1,850.00 for labour and materials",
      },
    ],
    caveats: [],
    ...over,
  };
}

describe("quote matching", () => {
  it("forgives only how whitespace fell", () => {
    // Mail bodies get re-wrapped in transit, so a faithfully copied sentence
    // comes back with a newline where the source had a space.
    expect(
      quoteAppearsIn(
        "It would be $1,850.00 for labour and materials",
        THREAD.messages[1].text,
      ),
    ).toBe(true);
    expect(normalizeForQuoteMatch("a  b\n c")).toBe("a b c");
  });

  it("rejects a paraphrase", () => {
    // Punctuation and word order still have to match — this is the check that
    // separates a citation from a plausible-sounding sentence.
    expect(
      quoteAppearsIn("It would be about 1850 dollars for the work", THREAD.messages[1].text),
    ).toBe(false);
  });

  it("rejects a quote from the wrong message", () => {
    expect(quoteAppearsIn("rewiring the kitchen", THREAD.messages[1].text)).toBe(false);
    expect(quoteAppearsIn("rewiring the kitchen", THREAD.messages[0].text)).toBe(true);
  });

  it("refuses a quote too short to prove anything", () => {
    expect("the".length).toBeLessThan(MIN_QUOTE_CHARS);
    expect(quoteAppearsIn("the", THREAD.messages[1].text)).toBe(false);
  });
});

describe("validateThreadDraft", () => {
  it("accepts a well-cited line and marks it verified", () => {
    const { record } = validateThreadDraft(raw(), "invoice", THREAD, PARTIES, TODAY);
    expect(record.lines).toHaveLength(1);
    expect(record.lines[0]).toMatchObject({
      description: "Kitchen rewire, labour and materials",
      quantity: "1",
      unitPriceCents: 185_000,
    });
    expect(record.lines[0].citation?.verified).toBe(true);
    expect(record.caveats).toEqual([]);
  });

  it("KEEPS a hallucinated citation but flags it, and says so", () => {
    // The failure this feature exists to catch. Dropping the line silently
    // would hide money somebody may be owed; the reader gets a warning and an
    // unticked row instead.
    const { record } = validateThreadDraft(
      raw({
        lines: [
          {
            ...raw().lines[0],
            citationQuote: "I agree to pay a further $5,000 on completion",
          },
        ],
      }),
      "invoice",
      THREAD,
      PARTIES,
      TODAY,
    );
    expect(record.lines).toHaveLength(1);
    expect(record.lines[0].citation?.verified).toBe(false);
    expect(record.caveats[0]).toMatch(/could not be matched/i);
  });

  it("rejects a citation pointing outside the conversation", () => {
    const { record } = validateThreadDraft(
      raw({ lines: [{ ...raw().lines[0], citationMessageIndex: 99 }] }),
      "invoice",
      THREAD,
      PARTIES,
      TODAY,
    );
    expect(record.lines[0].citation).toBeNull();
    expect(record.caveats[0]).toMatch(/could not be matched/i);
  });

  it("refuses a party id it was never offered", () => {
    // A matched party is a claim about a row; an unknown id is a hallucination,
    // and falls back to the name the human confirms anyway.
    const { record } = validateThreadDraft(
      raw({ partyId: "99999999-9999-9999-9999-999999999999" }),
      "invoice",
      THREAD,
      PARTIES,
      TODAY,
    );
    expect(record.partyId).toBeNull();
    expect(record.partyName).toBe("Acme Ltd");
  });

  it("drops lines whose money or description is unusable, and counts them", () => {
    const { record, droppedLines } = validateThreadDraft(
      raw({
        lines: [
          { ...raw().lines[0], unitPriceCents: 1.5 },
          { ...raw().lines[0], description: "   " },
          raw().lines[0],
        ],
      }),
      "invoice",
      THREAD,
      PARTIES,
      TODAY,
    );
    expect(droppedLines).toBe(2);
    expect(record.lines).toHaveLength(1);
    expect(record.caveats.some((c) => /discarded as malformed/i.test(c))).toBe(true);
  });

  it("falls back to a sane quantity rather than rejecting the line", () => {
    const { record } = validateThreadDraft(
      raw({ lines: [{ ...raw().lines[0], quantity: "one and a half" }] }),
      "invoice",
      THREAD,
      PARTIES,
      TODAY,
    );
    expect(record.lines[0].quantity).toBe("1");
  });

  it("falls back to today when the model gives an impossible date", () => {
    const { record } = validateThreadDraft(
      raw({ issueDate: "2026-02-31", dueDate: "not a date" }),
      "invoice",
      THREAD,
      PARTIES,
      TODAY,
    );
    expect(record.issueDate).toBe(TODAY);
    expect(record.dueDate).toBeNull();
  });

  it("degrades to an empty record rather than throwing", () => {
    for (const bad of [null, "nonsense", 42, []]) {
      const { record } = validateThreadDraft(bad, "invoice", THREAD, PARTIES, TODAY);
      expect(record.lines).toEqual([]);
      expect(record.caveats.length).toBeGreaterThan(0);
    }
  });

  it("distinguishes 'nothing agreed here' from 'the model broke'", () => {
    // These render almost identically — an empty line list — so they must not
    // read identically. One is a correct answer; the other is a failure.
    const nothingAgreed = validateThreadDraft(
      raw({ lines: [], caveats: ["No amount was ever settled."] }),
      "invoice",
      THREAD,
      PARTIES,
      TODAY,
    ).record;
    expect(nothingAgreed.caveats).toEqual(["No amount was ever settled."]);

    const broken = validateThreadDraft(
      raw({ lines: undefined }),
      "invoice",
      THREAD,
      PARTIES,
      TODAY,
    ).record;
    expect(broken.caveats).toEqual(["The assistant returned nothing usable."]);
  });

  it("carries the model's own caveats through", () => {
    const { record } = validateThreadDraft(
      raw({ lines: [], caveats: ["A price was discussed but never settled."] }),
      "invoice",
      THREAD,
      PARTIES,
      TODAY,
    );
    expect(record.lines).toEqual([]);
    expect(record.caveats).toEqual(["A price was discussed but never settled."]);
  });
});

describe("prompt seam", () => {
  it("numbers messages so a citation can point at one", () => {
    const turn = buildThreadDraftUserTurn(
      THREAD,
      [
        {
          id: "11111111-1111-1111-1111-111111111111",
          name: "Acme Ltd",
          emails: ["client@acme.test"],
        },
      ],
      TODAY,
    );
    expect(turn).toContain("--- message 0 ---");
    expect(turn).toContain("--- message 2 ---");
    expect(turn).toContain("client@acme.test");
    expect(turn).toContain("Kitchen rewire");
  });

  it("says there are no parties rather than pretending there are", () => {
    const turn = buildThreadDraftUserTurn(THREAD, [], TODAY);
    expect(turn).toContain("(none on file)");
  });

  it("caps a runaway message", () => {
    const huge: DraftableThread = {
      subject: "s",
      messages: [{ from: "a@b.test", date: "2026-08-01", text: "x".repeat(50_000) }],
    };
    const turn = buildThreadDraftUserTurn(huge, [], TODAY);
    expect(turn.length).toBeLessThan(MESSAGE_CHAR_CAP + 2_000);
  });

  it("tells the model which direction it is reading, and to cite", () => {
    expect(threadDraftSystemPrompt("invoice")).toContain("OWED");
    expect(threadDraftSystemPrompt("bill")).toContain("OWES");
    for (const kind of ["invoice", "bill"] as const) {
      expect(threadDraftSystemPrompt(kind)).toMatch(/EVERY line must quote/);
      expect(threadDraftSystemPrompt(kind)).toMatch(/NEVER invent a figure/);
    }
  });

  it("forces a tool whose schema demands a citation per line", () => {
    const tool = threadDraftTool("invoice");
    expect(tool.name).toBe("propose_invoice");
    const line = tool.input_schema.properties.lines.items;
    expect(line.required).toContain("citationMessageIndex");
    expect(line.required).toContain("citationQuote");
    expect(threadDraftTool("bill").name).toBe("propose_bill");
  });
});
