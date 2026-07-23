/**
 * Prompt construction for bill-line coding — pure module.
 * Data minimization: the chart of accounts, this vendor's coding history,
 * the bill's lines, the vendor name, and enabled-pack guidance strings
 * are the ENTIRE tenant payload. Nothing else leaves the tenant.
 */

export interface BillPromptAccount {
  code: string;
  name: string;
  accountType: string;
  subtype: string;
}

export interface BillPromptHistoryRow {
  description: string;
  code: string;
}

export interface BillPromptLine {
  id: string;
  description: string;
  amountCents: number;
}

/** Static → cacheable as an ephemeral system block. */
export const BILL_CODING_SYSTEM_PROMPT = `You are a meticulous bookkeeping assistant coding the lines of a vendor bill for a US small business that keeps double-entry books.

Rules:
- Suggest exactly one accountCode per bill line id you are given, chosen ONLY from the provided chart of accounts, copied verbatim. Never invent or modify codes.
- A bill records money the business OWES a vendor: lines are expenses, cost of goods sold, or asset purchases — never income, never Accounts Payable itself.
- This vendor's previous codings are the strongest signal: when a line description closely matches one coded before for this vendor, use the same code.
- Otherwise infer from the vendor's trade and the line description (e.g. lumber yards → materials/COGS, utility companies → utilities expense, insurance carriers → insurance).
- Negative amounts are vendor credits or discounts on this bill — code them to the same account the related charge would use.
- If industry guidance sections are provided, apply them when they cover the situation.
- Calibrate confidence between 0 and 1: 0.9+ only when vendor history makes it near-certain, 0.7–0.9 for confident inference, below 0.5 when guessing from a terse description.
- Keep each reason under 15 words.
- Respond ONLY by calling the code_bill_lines tool.`;

export const CODE_BILL_TOOL = {
  name: "code_bill_lines",
  description: "Report one account suggestion per bill line.",
  input_schema: {
    type: "object" as const,
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            billLineId: { type: "string" },
            accountCode: { type: "string" },
            confidence: { type: "number" },
            reason: { type: "string" },
          },
          required: ["billLineId", "accountCode", "confidence"],
        },
      },
    },
    required: ["suggestions"],
  },
};

/** Cap per pack guidance section (P17). */
export const PACK_GUIDANCE_CHAR_CAP = 2000;
export const PACK_GUIDANCE_MAX_PACKS = 4;

export function buildBillCodingUserTurn(
  coa: BillPromptAccount[],
  vendorHistory: BillPromptHistoryRow[],
  bill: { vendorName: string; billDate: string; billNumber: string },
  lines: BillPromptLine[],
  packGuidance: string[],
): string {
  const chart = coa
    .map((a) => `${a.code} | ${a.name} | ${a.accountType} | ${a.subtype}`)
    .join("\n");
  const history =
    vendorHistory.length > 0
      ? vendorHistory.map((h) => `"${h.description}" -> ${h.code}`).join("\n")
      : "(none yet)";
  const lineRows = lines
    .map((l) => `${l.id} | ${l.amountCents} | ${l.description || "(no description)"}`)
    .join("\n");
  const guidance = packGuidance
    .slice(0, PACK_GUIDANCE_MAX_PACKS)
    .map(
      (g) =>
        `INDUSTRY GUIDANCE:\n\`\`\`\n${g.slice(0, PACK_GUIDANCE_CHAR_CAP)}\n\`\`\``,
    )
    .join("\n\n");

  return [
    `Chart of accounts (code | name | type | subtype):\n\`\`\`\n${chart}\n\`\`\``,
    `This vendor's recent codings ("description" -> code):\n\`\`\`\n${history}\n\`\`\``,
    guidance,
    `Bill from ${bill.vendorName}${bill.billNumber ? ` (invoice ${bill.billNumber})` : ""}, dated ${bill.billDate}.`,
    `Bill lines to code (id | signed cents | description):\n\`\`\`\n${lineRows}\n\`\`\``,
  ]
    .filter(Boolean)
    .join("\n\n");
}
