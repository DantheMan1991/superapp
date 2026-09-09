/**
 * Prompt construction for bank-transaction categorization — pure module.
 * Data minimization: only descriptions, dates, amounts, and the chart of
 * accounts leave the tenant. No names, no account numbers, no institution.
 */

export interface PromptAccount {
  code: string;
  name: string;
  accountType: string;
  subtype: string;
}

export interface PromptHistoryRow {
  description: string;
  code: string;
}

export interface PromptTxn {
  id: string;
  txnDate: string;
  amountCents: number;
  description: string;
}

/** Static → cacheable as an ephemeral system block. */
export const SUGGEST_SYSTEM_PROMPT = `You are a meticulous bookkeeping assistant categorizing bank-feed transactions for a US small business that keeps double-entry books.

Rules:
- Suggest exactly one accountCode per transaction id you are given, chosen ONLY from the provided chart of accounts, copied verbatim. Never invent or modify codes.
- Amounts are signed cents from the account holder's perspective: positive = money into the account (income, refunds, transfers in, credit-card payments), negative = money out (expenses, transfers out, credit-card charges).
- The business's recent categorizations are the strongest signal: when a description closely matches one they have categorized before, use the same code.
- Otherwise infer from merchant names and common sense (e.g. fuel stations → vehicle expenses, insurance carriers → insurance).
- Transfers between the business's own accounts (the provided asset/liability accounts) should use those accounts — never income or expense.
- Calibrate confidence between 0 and 1: 0.9+ only when history makes it near-certain, 0.7–0.9 for confident merchant inference, below 0.5 when guessing.
- Keep each reason under 15 words.
- Respond ONLY by calling the suggest_categories tool.`;

export const SUGGEST_TOOL = {
  name: "suggest_categories",
  description: "Report one category suggestion per bank transaction.",
  input_schema: {
    type: "object" as const,
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            transactionId: { type: "string" },
            accountCode: {
              type: "string",
              description: "A code from the provided chart of accounts, verbatim",
            },
            confidence: { type: "number", description: "0 to 1" },
            reason: { type: "string", description: "Short justification, <= 15 words" },
          },
          required: ["transactionId", "accountCode", "confidence"],
        },
      },
    },
    required: ["suggestions"],
  },
};

/**
 * The one code that is not in the chart: "this line is not the business's".
 * Offered to the model only for a PERSONAL register (ADR 0034), and accepted
 * by `validateSuggestions` only when the caller says so.
 */
export const PERSONAL_CODE = "PERSONAL";

/**
 * What the model is told about a personal register, ahead of the chart. The
 * prior is inverted on purpose: on a business account every line is the
 * business's until proven otherwise, on the owner's own account it is the
 * other way round, and a business line missed is cheaper than personal
 * spending in the books — the owner will find the missed line when the
 * feed store's bill arrives, and nobody will find the groceries.
 */
export const PERSONAL_INSTRUCTION = [
  "THIS IS THE OWNER'S PERSONAL ACCOUNT. It also carries some of the business's money, but MOST LINES ARE PERSONAL.",
  "For each transaction decide FIRST whether it is the business's at all:",
  `- If it is the owner's own spending or income — groceries, household, medical, entertainment, personal transfers, pay from an unrelated job — answer accountCode ${PERSONAL_CODE}. Default to ${PERSONAL_CODE} when unsure.`,
  "- Only when it is clearly the business's — a supplier, feed, seed, equipment, fuel for the work, a customer paying — pick the category from the chart as usual.",
  `${PERSONAL_CODE} is a valid accountCode for this account and appears in the chart below. Prior decisions marked ${PERSONAL_CODE} in the history are personal lines the owner has already set aside.`,
].join("\n");

export function buildSuggestUserTurn(
  coa: PromptAccount[],
  history: PromptHistoryRow[],
  batch: PromptTxn[],
  options: { personal?: boolean } = {},
): string {
  const rows = options.personal
    ? [
        ...coa,
        {
          code: PERSONAL_CODE,
          name: "Not the business's — the owner's own spending or income",
          accountType: "personal",
          subtype: "personal",
        },
      ]
    : coa;
  const chart = rows
    .map((a) => `${a.code} | ${a.name} | ${a.accountType} | ${a.subtype}`)
    .join("\n");
  const past =
    history.length > 0
      ? history.map((h) => `"${h.description}" -> ${h.code}`).join("\n")
      : "(none yet)";
  const txns = batch
    .map((t) => `${t.id} | ${t.txnDate} | ${t.amountCents} | ${t.description}`)
    .join("\n");
  return [
    ...(options.personal ? [PERSONAL_INSTRUCTION, ""] : []),
    "CHART OF ACCOUNTS (code | name | type | subtype):",
    "```",
    chart,
    "```",
    "",
    "RECENT CATEGORIZATIONS BY THIS BUSINESS:",
    "```",
    past,
    "```",
    "",
    "TRANSACTIONS TO CATEGORIZE (id | date | signed cents | description):",
    "```",
    txns,
    "```",
  ].join("\n");
}
