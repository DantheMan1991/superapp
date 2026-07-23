import "dotenv/config";
import { describe, expect, it } from "vitest";
import { callBillCodingModel } from "../src/modules/accounting/ai/bill-code";
import { validateBillCoding } from "../src/modules/accounting/ai/bill-validate";
import { CLAUDE_MODEL } from "../src/lib/claude";

/**
 * MANUAL live verification of the bill-coding engine against the real
 * Claude API (costs ~1 small text call). Skipped unless requested:
 *
 *   RUN_LIVE_BILL_CODING=1 npx vitest run tests/live-bill-coding.test.ts
 */
const RUN =
  process.env.RUN_LIVE_BILL_CODING === "1" && !!process.env.ANTHROPIC_API_KEY;
const d = RUN ? describe : describe.skip;

d("live bill coding (real Claude API)", () => {
  it("codes obvious lines to sensible accounts with calibrated confidence", async () => {
    const coa = [
      { code: "5000", name: "Cost of Goods Sold", accountType: "expense", subtype: "cogs" },
      { code: "6100", name: "Insurance", accountType: "expense", subtype: "operating_expense" },
      { code: "6300", name: "Office Supplies", accountType: "expense", subtype: "operating_expense" },
      { code: "6550", name: "Repairs & Maintenance", accountType: "expense", subtype: "operating_expense" },
      { code: "6700", name: "Utilities", accountType: "expense", subtype: "operating_expense" },
    ];
    const lines = [
      { id: "l-electric", description: "Monthly electric service 123 Main St", amountCents: 18_450 },
      { id: "l-copier", description: "Copier paper, 10 reams", amountCents: 6_200 },
    ];
    const raw = await callBillCodingModel({
      billId: "live-test",
      vendorName: "City Power & Light",
      billDate: "2026-07-01",
      billNumber: "CPL-4471",
      lines,
      coa,
      vendorHistory: [
        { description: "Monthly electric service 123 Main St", code: "6700" },
      ],
      packGuidance: [],
      accountsByCode: new Map(
        coa.map((a) => [a.code, { id: `id-${a.code}`, isActive: true }]),
      ),
    });
    const coding = validateBillCoding(
      raw,
      new Set(lines.map((l) => l.id)),
      new Map(coa.map((a) => [a.code, { id: `id-${a.code}`, isActive: true }])),
      CLAUDE_MODEL,
      new Date().toISOString(),
    );
    console.log(JSON.stringify(coding, null, 2));

    const electric = coding.suggestions.find((s) => s.billLineId === "l-electric");
    expect(electric?.accountCode).toBe("6700");
    expect(electric!.confidence).toBeGreaterThanOrEqual(0.8);
    const paper = coding.suggestions.find((s) => s.billLineId === "l-copier");
    expect(paper?.accountCode).toBe("6300");
  }, 120_000);
});
