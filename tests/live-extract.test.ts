import "dotenv/config";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { callExtractModel } from "../src/modules/accounting/ai/extract";
import { validateExtraction } from "../src/modules/accounting/ai/extract-validate";
import { CLAUDE_MODEL } from "../src/lib/claude";

/**
 * MANUAL live verification of the extraction engine against the real
 * Claude API (costs ~1 vision call). Skipped unless explicitly requested:
 *
 *   RUN_LIVE_EXTRACT=1 npx vitest run tests/live-extract.test.ts
 */
const RUN = process.env.RUN_LIVE_EXTRACT === "1" && !!process.env.ANTHROPIC_API_KEY;
const d = RUN ? describe : describe.skip;

d("live extraction (real Claude API)", () => {
  it("extracts a synthetic receipt correctly", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500">
      <rect width="400" height="500" fill="white"/>
      <text x="200" y="60" font-size="24" text-anchor="middle" font-family="monospace">JOE'S HARDWARE</text>
      <text x="200" y="90" font-size="14" text-anchor="middle" font-family="monospace">123 Main St, Springfield</text>
      <text x="40" y="140" font-size="14" font-family="monospace">Date: 07/14/2026</text>
      <text x="40" y="180" font-size="14" font-family="monospace">2x PVC Pipe 10ft      $18.00</text>
      <text x="40" y="205" font-size="14" font-family="monospace">1x Pipe Wrench        $24.99</text>
      <text x="40" y="230" font-size="14" font-family="monospace">Subtotal              $42.99</text>
      <text x="40" y="255" font-size="14" font-family="monospace">Tax (6%)               $2.58</text>
      <text x="40" y="290" font-size="18" font-family="monospace" font-weight="bold">TOTAL              $45.57</text>
      <text x="40" y="330" font-size="12" font-family="monospace">Receipt #4471</text>
    </svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();

    const raw = await callExtractModel({
      documentId: "live-test",
      mimeType: "image/png",
      base64: png.toString("base64"),
    });
    const v = validateExtraction(raw, CLAUDE_MODEL, new Date().toISOString());
    console.log(JSON.stringify(v, null, 2));

    expect(v.docType).toBe("receipt");
    expect(v.fields.vendorName.value).toMatch(/joe'?s hardware/i);
    expect(v.fields.totalCents.value).toBe(4557);
    expect(v.fields.taxCents.value).toBe(258);
    expect(v.fields.documentDate.value).toBe("2026-07-14");
    expect(v.fields.documentNumber.value).toContain("4471");
    expect(v.lineItems.length).toBeGreaterThanOrEqual(2);
  }, 120_000);
});
