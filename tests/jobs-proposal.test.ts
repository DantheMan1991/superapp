import { describe, expect, it } from "vitest";
import { buildProposalModel, paragraphs, type ProposalInput } from "../src/packs/jobs/proposal-model";
import { renderProposalPdf } from "../src/packs/jobs/proposal-pdf";

/**
 * The proposal — an estimate as the document the client is sent (slice
 * 10b, ADR 0070). The model is pure and every figure on the page is pinned
 * here on the four lines the estimating suites use; the renderer is
 * exercised once per shape so a missing font face or a bad style fails
 * here rather than at request time, the way the certificate's test does.
 */

const base: ProposalInput = {
  businessName: "Ops Builder LLC",
  toName: "Oak Row Owner",
  toAddress: "17 Main St\nMount Vernon, OH 43050",
  projectNumber: "24-108",
  projectName: "Oak Row residence — phase 2",
  projectAddress: "4 Mill Lane",
  number: "EST-1",
  title: "As drawn",
  status: "sent",
  sentOn: "2026-09-15",
  validUntil: "2026-10-15",
  presentation: "lines",
  scope: "A new home as drawn on sheets A1–A9.\nSite work, foundation, framing, roof, exterior finishes.",
  exclusions: "Permits and utility fees.\nLandscaping.\n",
  terms: "Ten percent on signing; draws monthly against the schedule of values.",
  markupPpm: 150_000,
  overheadPpm: 100_000,
  profitPpm: 100_000,
  lines: [
    { description: "Slab, 4in, fibre mesh", unit: "cy", quantityThousandths: 120_000, unitCostCents: 185_00, markupPpm: null, unitPriceCents: null, codeLabel: "03 30 00 · Cast-in-place concrete" },
    { description: "Framing labour", unit: "", quantityThousandths: 1_000, unitCostCents: 40_000_00, markupPpm: 100_000, unitPriceCents: null, codeLabel: "06 10 00 · Rough carpentry" },
    { description: "Rebar", unit: "ton", quantityThousandths: 2_000, unitCostCents: 900_00, markupPpm: null, unitPriceCents: 1_200_00, codeLabel: "03 30 00 · Cast-in-place concrete" },
    { description: "Permit", unit: "", quantityThousandths: 1_000, unitCostCents: 1_500_00, markupPpm: null, unitPriceCents: null, codeLabel: null },
  ],
};

const rowsOf = (m: ReturnType<typeof buildProposalModel>) =>
  m.price.rows.map((r) => [r.description, r.quantity, r.unitPrice, r.amount]);

describe("the price, three ways", () => {
  it("line by line: every line at its price with overhead and profit in it, the unit line's raised unit price, and the total the contract is signed at", () => {
    const m = buildProposalModel(base);
    expect(m.price.heading).toBe("THE PRICE");
    expect(m.price.columns).toEqual({ quantity: true, unitPrice: true });
    expect(rowsOf(m)).toEqual([
      ["Slab, 4in, fibre mesh", "120 cy", "", "30,891.30"],
      ["Framing labour", "", "", "53,240.00"],
      ["Rebar", "2 ton", "1,452.00", "2,904.00"],
      ["Permit", "", "", "2,087.25"],
    ]);
    expect(m.price.rounding).toBeNull();
    expect(m.price.total).toEqual({ label: "Total", amount: "89,122.55" });
  });

  it("by cost code: each code's sum in the order the codes appear, the no-code lines as Other", () => {
    const m = buildProposalModel({ ...base, presentation: "codes" });
    expect(m.price.columns).toEqual({ quantity: false, unitPrice: false });
    expect(rowsOf(m)).toEqual([
      ["03 30 00 · Cast-in-place concrete", "", "", "33,795.30"],
      ["06 10 00 · Rough carpentry", "", "", "53,240.00"],
      ["Other", "", "", "2,087.25"],
    ]);
    expect(m.price.total.amount).toBe("89,122.55");
    // Nothing coded at all: one row, the lot.
    const uncoded = buildProposalModel({ ...base, presentation: "codes", lines: base.lines.map((l) => ({ ...l, codeLabel: null })) });
    expect(rowsOf(uncoded)).toEqual([["Other", "", "", "89,122.55"]]);
  });

  it("one sum: no rows, the price on its own line", () => {
    const m = buildProposalModel({ ...base, presentation: "sum" });
    expect(m.price.heading).toBe("PRICE");
    expect(m.price.rows).toEqual([]);
    expect(m.price.rounding).toBeNull();
    expect(m.price.total).toEqual({ label: "Price for the work described", amount: "89,122.55" });
  });

  it("carries a rounding line when unit prices cannot add to the total to the cent, so the rows still add up", () => {
    const allUnit = buildProposalModel({
      ...base,
      markupPpm: 0,
      overheadPpm: 210_000,
      profitPpm: 0,
      lines: [
        { description: "Bolts", unit: "ea", quantityThousandths: 3_000, unitCostCents: 0, markupPpm: null, unitPriceCents: 1, codeLabel: null },
        { description: "Nuts", unit: "ea", quantityThousandths: 3_000, unitCostCents: 0, markupPpm: null, unitPriceCents: 1, codeLabel: null },
      ],
    });
    expect(rowsOf(allUnit)).toEqual([
      ["Bolts", "3 ea", "0.01", "0.03"],
      ["Nuts", "3 ea", "0.01", "0.03"],
    ]);
    expect(allUnit.price.rounding).toEqual({ description: "Rounding", quantity: "", unitPrice: "", amount: "0.01" });
    expect(allUnit.price.total.amount).toBe("0.07");
  });
});

describe("the words around the price", () => {
  it("names the client, the business, the job, the site and the dates", () => {
    const m = buildProposalModel(base);
    expect(m.title).toBe("PROPOSAL");
    expect(m.subtitle).toBe("As drawn");
    expect(m.facts).toEqual([
      ["Project", "24-108 · Oak Row residence — phase 2"],
      ["Site", "4 Mill Lane"],
      ["Proposal no.", "EST-1"],
      ["Date", "2026-09-15"],
      ["Valid until", "2026-10-15"],
    ]);
    expect(m.toLines).toEqual(["Oak Row Owner", "17 Main St", "Mount Vernon, OH 43050"]);
    expect(m.fromLines).toEqual(["Ops Builder LLC"]);
    expect(m.validity).toBe("This proposal is valid until 2026-10-15.");
    expect(m.footer).toBe("Ops Builder LLC · Proposal EST-1 · 24-108");
    // No site, no title, no dates: the facts shrink and the subtitle falls back to the number.
    const bare = buildProposalModel({ ...base, projectAddress: "", title: "", validUntil: null, sentOn: null, status: "accepted" });
    expect(bare.facts.map(([k]) => k)).toEqual(["Project", "Proposal no.", "Date", "Valid until"]);
    expect(bare.facts.find(([k]) => k === "Date")?.[1]).toBe("—");
    expect(bare.subtitle).toBe("Proposal EST-1");
    expect(bare.validity).toBeNull();
  });

  it("keeps every typed line of the scope, the exclusions and the terms as its own paragraph", () => {
    const m = buildProposalModel(base);
    expect(m.scope).toEqual(["A new home as drawn on sheets A1–A9.", "Site work, foundation, framing, roof, exterior finishes."]);
    expect(m.exclusions).toEqual(["Permits and utility fees.", "Landscaping."]);
    expect(m.terms).toEqual(["Ten percent on signing; draws monthly against the schedule of values."]);
    expect(paragraphs("  \n\n one \n\n two  \n")).toEqual(["one", "two"]);
    expect(buildProposalModel({ ...base, scope: "", exclusions: "\n", terms: "" })).toMatchObject({ scope: [], exclusions: [], terms: [] });
  });

  it("is accepted by the client and signed for the business, in this product's own words", () => {
    const m = buildProposalModel(base);
    expect(m.acceptance).toBe(
      "Signing below accepts this proposal and authorises Ops Builder LLC to proceed with the work described, on the terms above.",
    );
    expect(m.signatures).toEqual([
      { heading: "Accepted for Oak Row Owner", lines: ["Signed", "Name", "Date"] },
      { heading: "For Ops Builder LLC", lines: ["Signed", "Date"] },
    ]);
    expect(buildProposalModel({ ...base, toName: "" }).signatures[0].heading).toBe("Accepted for the client");
    expect(buildProposalModel({ ...base, toName: "", toAddress: "" }).toLines).toEqual([]);
  });

  it("watermarks a draft, a declined and a superseded proposal, and a draft's date reads Not yet sent", () => {
    expect(buildProposalModel({ ...base, status: "draft", sentOn: null }).watermark).toBe("DRAFT");
    expect(buildProposalModel({ ...base, status: "draft", sentOn: null }).facts.find(([k]) => k === "Date")?.[1]).toBe("Not yet sent");
    expect(buildProposalModel({ ...base, status: "declined" }).watermark).toBe("DECLINED");
    expect(buildProposalModel({ ...base, status: "superseded" }).watermark).toBe("SUPERSEDED");
    expect(buildProposalModel({ ...base, status: "sent" }).watermark).toBeNull();
    expect(buildProposalModel({ ...base, status: "accepted" }).watermark).toBeNull();
  });

  it("NEVER PRINTS COST, MARKUP, OVERHEAD, PROFIT OR MARGIN — the client sees prices", () => {
    // The business's own words are blanked so only the model's words are scanned.
    for (const presentation of ["lines", "codes", "sum"]) {
      const m = buildProposalModel({
        ...base,
        presentation,
        title: "",
        scope: "",
        exclusions: "",
        terms: "",
        lines: base.lines.map((l, i) => ({ ...l, description: `Item ${i + 1}`, codeLabel: l.codeLabel ? `Code ${i}` : null })),
      });
      expect(JSON.stringify(m).toLowerCase()).not.toMatch(/cost|markup|overhead|profit|margin/);
    }
  });
});

describe("renderProposalPdf", () => {
  it("produces a real PDF for the line-by-line proposal, with a brand colour", async () => {
    const bytes = await renderProposalPdf({ ...base, brand: { tagline: "Built right", primaryColor: "#1d4ed8", logo: null } });
    expect(bytes.length).toBeGreaterThan(1000);
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
  });

  it("renders the by-code draft (watermark) and the one-sum proposal with no client", async () => {
    for (const input of [
      { ...base, presentation: "codes", status: "draft", sentOn: null },
      { ...base, presentation: "sum", toName: "", toAddress: "", scope: "", exclusions: "", terms: "" },
    ]) {
      const bytes = await renderProposalPdf(input);
      expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    }
  });
});
