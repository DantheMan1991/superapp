import { describe, expect, it } from "vitest";
import {
  journalTemplateBalances,
  journalTemplateImbalanceCents,
  parseRecurringEntryTemplate,
  recurringEntryTemplateSchema,
} from "../src/modules/accounting/recurring/template";
import { advanceMonthly } from "../src/modules/accounting/recurring/schedule";

/**
 * Recurring invoices, bills and journals — the pure half.
 *
 * The balance rule is the one that matters. The posting engine would reject an
 * unbalanced entry anyway, but it would do so once a month inside a generation
 * run, where the only evidence is an error row nobody reads.
 */

// Real v4 UUIDs: zod enforces the version and variant nibbles, so the
// all-same-digit placeholders used elsewhere in these tests do not parse here.
const ACC_A = "11111111-1111-4111-8111-111111111111";
const ACC_B = "22222222-2222-4222-8222-222222222222";

const journal = (
  lines: Array<{
    accountId: string;
    amountCents: number;
    dimensionMemberIds?: string[];
  }>,
) => ({
  kind: "journal" as const,
  lines,
});

describe("journal balance", () => {
  it("sums signed cents, positive = debit", () => {
    expect(
      journalTemplateImbalanceCents([{ amountCents: 5_000 }, { amountCents: -5_000 }]),
    ).toBe(0);
    expect(
      journalTemplateImbalanceCents([{ amountCents: 5_000 }, { amountCents: -4_000 }]),
    ).toBe(1_000);
  });

  it("accepts a balanced depreciation entry", () => {
    // Dr Depreciation expense, Cr Accumulated depreciation — the entry the
    // benchmark QuickBooks file runs every month and we could not express.
    expect(
      journalTemplateBalances([{ amountCents: 41_667 }, { amountCents: -41_667 }]),
    ).toBe(true);
  });

  it("rejects one that is out by a cent", () => {
    expect(
      journalTemplateBalances([{ amountCents: 41_667 }, { amountCents: -41_666 }]),
    ).toBe(false);
  });
});

describe("template parsing", () => {
  it("accepts a well-formed journal", () => {
    const parsed = parseRecurringEntryTemplate(
      journal([
        { accountId: ACC_A, amountCents: 41_667 },
        { accountId: ACC_B, amountCents: -41_667 },
      ]),
    );
    expect(parsed?.kind).toBe("journal");
  });

  it("REFUSES an unbalanced journal, rather than leaving it to fail monthly", () => {
    expect(
      parseRecurringEntryTemplate(
        journal([
          { accountId: ACC_A, amountCents: 41_667 },
          { accountId: ACC_B, amountCents: -1 },
        ]),
      ),
    ).toBeNull();
  });

  it("refuses a journal with fewer than two lines", () => {
    // One line cannot balance; the posting engine's own floor.
    expect(
      parseRecurringEntryTemplate(journal([{ accountId: ACC_A, amountCents: 0 }])),
    ).toBeNull();
  });

  it("refuses a zero-amount line", () => {
    expect(
      parseRecurringEntryTemplate(
        journal([
          { accountId: ACC_A, amountCents: 0 },
          { accountId: ACC_B, amountCents: 0 },
        ]),
      ),
    ).toBeNull();
  });

  it("accepts a bill template with its own shape", () => {
    const parsed = parseRecurringEntryTemplate({
      kind: "bill",
      dueInDays: 30,
      lines: [{ description: "Yard rent", amountCents: 120_000, accountId: null }],
    });
    expect(parsed?.kind).toBe("bill");
    // Uncoded is legal and deliberate (P9) — the bill-coding AI fills it later.
    expect(parsed?.kind === "bill" && parsed.lines[0].accountId).toBeNull();
  });

  it("accepts an invoice template, quantity and unit price and all", () => {
    // Folded in from `recurring_invoices`, which had no `kind` of its own: the
    // table it lived in WAS the discriminator, and migration 0122 wrote the tag
    // into every row on the way across.
    const parsed = parseRecurringEntryTemplate({
      kind: "invoice",
      dueInDays: 15,
      lines: [
        {
          description: "Unit 4 rent",
          quantity: "1",
          unitPriceCents: 120_000,
          incomeAccountId: ACC_A,
        },
      ],
    });
    expect(parsed?.kind).toBe("invoice");
  });

  it("refuses an invoice line missing the income account it must post to", () => {
    // A bill line may be uncoded and get categorised later; an invoice line
    // may not, because issuing is what posts it.
    expect(
      parseRecurringEntryTemplate({
        kind: "invoice",
        dueInDays: 15,
        lines: [{ description: "Rent", quantity: "1", unitPriceCents: 120_000 }],
      }),
    ).toBeNull();
    // And the bounds the old table checked are still checked.
    expect(
      parseRecurringEntryTemplate({ kind: "invoice", dueInDays: 15, lines: [] }),
    ).toBeNull();
    expect(
      parseRecurringEntryTemplate({
        kind: "invoice",
        dueInDays: -1,
        lines: [
          {
            description: "Rent",
            quantity: "1",
            unitPriceCents: 120_000,
            incomeAccountId: ACC_A,
          },
        ],
      }),
    ).toBeNull();
  });

  it("returns null for junk rather than throwing", () => {
    // One malformed row must cost its own run and nothing else.
    for (const bad of [null, "nonsense", 42, [], {}, { kind: "nosuchkind" }]) {
      expect(parseRecurringEntryTemplate(bad)).toBeNull();
    }
  });

  it("discriminates on kind, so a bill cannot wear journal lines", () => {
    const result = recurringEntryTemplateSchema.safeParse({
      kind: "bill",
      dueInDays: 30,
      lines: [{ accountId: ACC_A, amountCents: 100 }],
    });
    // A bill line needs a description field, not an accountId-only shape.
    expect(result.success).toBe(true);
    if (result.success && result.data.kind === "bill") {
      expect(result.data.lines[0].description).toBe("");
    }
  });
});

describe("a template says what its entries were for", () => {
  /**
   * All three line schemas have accepted `dimensionMemberIds` since before any
   * dimension had a member, and `generate.ts` has threaded them the whole
   * time — the gap was a form that could send one. These pin the storage
   * contract the form now depends on: a tag survives the jsonb round trip,
   * and an untagged template stays untagged rather than acquiring `[]`.
   */
  const MEMBER = "33333333-3333-4333-8333-333333333333";

  it("round-trips a tag on a journal line", () => {
    const parsed = parseRecurringEntryTemplate(
      journal([
        { accountId: ACC_A, amountCents: 5_000, dimensionMemberIds: [MEMBER] },
        { accountId: ACC_B, amountCents: -5_000 },
      ]),
    );
    expect(parsed?.kind).toBe("journal");
    expect(
      (parsed as { lines: Array<{ dimensionMemberIds?: string[] }> }).lines[0]
        .dimensionMemberIds,
    ).toEqual([MEMBER]);
  });

  it("round-trips a tag on a bill line and an invoice line", () => {
    const bill = parseRecurringEntryTemplate({
      kind: "bill",
      dueInDays: 14,
      lines: [
        {
          description: "Feed",
          amountCents: 31_840,
          accountId: ACC_A,
          dimensionMemberIds: [MEMBER],
        },
      ],
    });
    expect(
      (bill as { lines: Array<{ dimensionMemberIds?: string[] }> }).lines[0]
        .dimensionMemberIds,
    ).toEqual([MEMBER]);

    const invoice = parseRecurringEntryTemplate({
      kind: "invoice",
      dueInDays: 7,
      lines: [
        {
          description: "Rent",
          quantity: "1",
          unitPriceCents: 120_000,
          incomeAccountId: ACC_B,
          dimensionMemberIds: [MEMBER],
        },
      ],
    });
    expect(
      (invoice as { lines: Array<{ dimensionMemberIds?: string[] }> }).lines[0]
        .dimensionMemberIds,
    ).toEqual([MEMBER]);
  });

  it("leaves an untagged line ABSENT rather than an empty array", () => {
    // The form sends undefined for an untagged row on purpose, and every write
    // path reads `?? []`. A stored `[]` would be a lie about a decision
    // somebody never made.
    const parsed = parseRecurringEntryTemplate(
      journal([
        { accountId: ACC_A, amountCents: 100 },
        { accountId: ACC_B, amountCents: -100 },
      ]),
    );
    expect(
      (parsed as { lines: Array<{ dimensionMemberIds?: string[] }> }).lines[0],
    ).not.toHaveProperty("dimensionMemberIds");
  });

  it("refuses more than ten tags on one line", () => {
    const many = Array.from(
      { length: 11 },
      (_, i) => `4444444${i}-4444-4444-8444-444444444444`,
    );
    expect(
      parseRecurringEntryTemplate(
        journal([
          { accountId: ACC_A, amountCents: 100, dimensionMemberIds: many },
          { accountId: ACC_B, amountCents: -100 },
        ]),
      ),
    ).toBeNull();
  });
});

describe("monthly advance", () => {
  it("moves to the same day next month", () => {
    // ONE implementation for all three kinds — it started life inside the
    // invoice-only module and moved out rather than being reimplemented.
    expect(advanceMonthly("2026-01-15", 15)).toBe("2026-02-15");
    expect(advanceMonthly("2026-12-01", 1)).toBe("2027-01-01");
    // Day 28 is the cap the DB check enforces, so every month has one.
    expect(advanceMonthly("2026-01-28", 28)).toBe("2026-02-28");
  });
});
