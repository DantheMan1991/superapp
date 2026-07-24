/**
 * Close-narrative prompt assembly — pure, fixture-testable, no imports
 * from server code. Mirrors bill-prompt.ts: a static cacheable system
 * prompt, a forced tool, and a user turn built from fenced sections.
 *
 * Data minimization (P11 middle ground): report aggregates (labels +
 * integer cents), outstanding checklist counts, the period's top posted
 * entries (date, memo, magnitude, source), and the NAMES of vendors and
 * customers created in the period. Nothing else leaves the tenant.
 */

export interface NarrativeReportRow {
  label: string;
  cents: number;
  prevCents?: number | null;
}

export interface NarrativeCashRow {
  label: string;
  openingCents: number;
  netCents: number;
  closingCents: number;
}

export interface NarrativeTopEntry {
  date: string;
  memo: string;
  amountCents: number;
  source: string;
}

export interface CloseNarrativeInputs {
  periodStart: string;
  periodEnd: string;
  /** P&L section/computed rows with prior-period comparison. */
  pnlRows: NarrativeReportRow[];
  netIncomeCents: number;
  prevNetIncomeCents: number | null;
  cashRows: NarrativeCashRow[];
  totals: { assetsCents: number; liabilitiesCents: number; equityCents: number };
  /** Outstanding checklist items at generation time (label + count). */
  openItems: Array<{ label: string; count: number }>;
  topEntries: NarrativeTopEntry[];
  newVendors: string[];
  newCustomers: string[];
}

export const CLOSE_NARRATIVE_SYSTEM_PROMPT = `You are a bookkeeping reviewer writing the month-end close summary for a small business owner.

Rules:
- All amounts are INTEGER USD CENTS. Convert to dollars when writing (e.g. 123456 cents = $1,234.56). Never invent a number that is not derivable from the provided data.
- Compare this period against the prior period where comparison figures are provided; call out the biggest movements and say why they matter in plain English.
- Mention notable individual transactions (the "largest entries" list) when they explain a movement.
- If open items are listed (unreviewed transactions, drafts, unreconciled accounts), flag them plainly as things to tidy up — no alarmism.
- Voice: clear, direct, professional; write for an owner, not an accountant. No jargon without a plain-English gloss.
- Length: 2 to 5 short paragraphs, at most ~350 words. Simple "-" bullets are allowed; NO headings, tables, links, or bold.
- Also produce up to 5 short highlights (title + one-line detail) — the scannable version of the story.
- Respond ONLY by calling the write_close_narrative tool.`;

export const WRITE_CLOSE_NARRATIVE_TOOL = {
  name: "write_close_narrative",
  description:
    "Deliver the close narrative and its highlights for the period under review.",
  input_schema: {
    type: "object" as const,
    properties: {
      narrative: {
        type: "string",
        description:
          "2-5 short plain-text paragraphs (optional '-' bullets). No headings.",
      },
      highlights: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short highlight title" },
            detail: { type: "string", description: "One-line supporting detail" },
          },
          required: ["title"],
        },
      },
    },
    required: ["narrative"],
  },
};

function cents(n: number): string {
  return String(n);
}

function reportSection(rows: NarrativeReportRow[]): string {
  return rows
    .map(
      (r) =>
        `${r.label} | ${cents(r.cents)}${
          r.prevCents === null || r.prevCents === undefined
            ? ""
            : ` | prev ${cents(r.prevCents)}`
        }`,
    )
    .join("\n");
}

export function buildCloseNarrativeUserTurn(
  inputs: CloseNarrativeInputs,
): string {
  const parts: string[] = [];
  parts.push(
    `Close period: ${inputs.periodStart} through ${inputs.periodEnd}. All amounts are integer cents.`,
  );
  parts.push(
    "PROFIT AND LOSS (this period, with prior-period comparison where present):\n```\n" +
      reportSection(inputs.pnlRows) +
      `\nNet income | ${cents(inputs.netIncomeCents)}${
        inputs.prevNetIncomeCents === null
          ? ""
          : ` | prev ${cents(inputs.prevNetIncomeCents)}`
      }\n` +
      "```",
  );
  if (inputs.cashRows.length > 0) {
    parts.push(
      "CASH ACTIVITY (opening | net change | closing):\n```\n" +
        inputs.cashRows
          .map(
            (r) =>
              `${r.label} | ${cents(r.openingCents)} | ${cents(r.netCents)} | ${cents(r.closingCents)}`,
          )
          .join("\n") +
        "\n```",
    );
  }
  parts.push(
    "BALANCE SHEET TOTALS at period end:\n```\n" +
      `Assets | ${cents(inputs.totals.assetsCents)}\n` +
      `Liabilities | ${cents(inputs.totals.liabilitiesCents)}\n` +
      `Equity | ${cents(inputs.totals.equityCents)}\n` +
      "```",
  );
  if (inputs.topEntries.length > 0) {
    parts.push(
      "LARGEST POSTED ENTRIES this period (date | memo | cents | source):\n```\n" +
        inputs.topEntries
          .map(
            (e) => `${e.date} | ${e.memo || "(no memo)"} | ${cents(e.amountCents)} | ${e.source}`,
          )
          .join("\n") +
        "\n```",
    );
  }
  if (inputs.newVendors.length > 0) {
    parts.push(`NEW VENDORS this period: ${inputs.newVendors.join(", ")}`);
  }
  if (inputs.newCustomers.length > 0) {
    parts.push(`NEW CUSTOMERS this period: ${inputs.newCustomers.join(", ")}`);
  }
  if (inputs.openItems.length > 0) {
    parts.push(
      "OPEN ITEMS at close (flag these):\n```\n" +
        inputs.openItems.map((i) => `${i.label}: ${i.count}`).join("\n") +
        "\n```",
    );
  } else {
    parts.push("OPEN ITEMS at close: none — a clean close.");
  }
  parts.push("Write the close narrative now via the tool.");
  return parts.join("\n\n");
}
