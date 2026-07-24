import "dotenv/config";
import { describe, expect, it } from "vitest";
import { callCloseNarrativeModel } from "../src/modules/accounting/ai/narrative";
import { validateCloseNarrative } from "../src/modules/accounting/ai/narrative-validate";
import { CLAUDE_MODEL } from "../src/lib/claude";

/**
 * MANUAL live verification of the close-narrative engine against the real
 * Claude API (costs ~1 small text call). Skipped unless requested:
 *
 *   RUN_LIVE_NARRATIVE=1 npx vitest run tests/live-narrative.test.ts
 */
const RUN =
  process.env.RUN_LIVE_NARRATIVE === "1" && !!process.env.ANTHROPIC_API_KEY;
const d = RUN ? describe : describe.skip;

d("live close narrative (real Claude API)", () => {
  it("writes a grounded narrative that mentions the seeded figures", async () => {
    const raw = await callCloseNarrativeModel({
      closeId: "live-test",
      inputs: {
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        pnlRows: [
          { label: "Sales", cents: 1_250_000, prevCents: 1_000_000 },
          { label: "Rent", cents: 300_000, prevCents: 300_000 },
          { label: "Repairs & Maintenance", cents: 220_000, prevCents: 40_000 },
        ],
        netIncomeCents: 730_000,
        prevNetIncomeCents: 660_000,
        cashRows: [
          {
            label: "Cash accounts: Business Checking",
            openingCents: 2_000_000,
            netCents: 480_000,
            closingCents: 2_480_000,
          },
        ],
        totals: {
          assetsCents: 5_000_000,
          liabilitiesCents: 1_200_000,
          equityCents: 3_800_000,
        },
        openItems: [{ label: "Unreviewed bank transactions", count: 3 }],
        topEntries: [
          {
            date: "2026-06-12",
            memo: "HVAC compressor replacement",
            amountCents: 180_000,
            source: "bill",
          },
        ],
        newVendors: ["Arctic Air HVAC"],
        newCustomers: [],
      },
    });
    const narrative = validateCloseNarrative(
      raw,
      CLAUDE_MODEL,
      new Date().toISOString(),
    );
    console.log(JSON.stringify(narrative, null, 2));

    expect(narrative.narrative.length).toBeGreaterThan(200);
    // Grounded in the seeded story: the repair spike / HVAC job.
    expect(narrative.narrative.toLowerCase()).toMatch(/hvac|repair/);
    // Flags the open items.
    expect(narrative.narrative.toLowerCase()).toMatch(/unreviewed|bank/);
    expect(narrative.highlights.length).toBeGreaterThan(0);
  }, 120_000);
});
