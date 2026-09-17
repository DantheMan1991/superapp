import { describe, expect, it } from "vitest";
import { buildProposalModel, paragraphs, type ProposalInput } from "../src/packs/jobs/proposal-model";
import { renderProposalPdf } from "../src/packs/jobs/proposal-pdf";
import {
  allowanceOf,
  buildProposalDocument,
  isProposalFormat,
  milestoneOf,
} from "../src/packs/jobs/proposal-sections";
import { renderProposalHtml } from "../src/packs/jobs/proposal-html";
import { PROPOSAL_FORMATS, PROPOSAL_FORMAT_LABELS } from "../src/packs/jobs/vocabulary";

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

describe("the price, four ways", () => {
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

  /**
   * BY ITEM (ADR 0079), which is what a custom-home proposal uses: the same four
   * lines gathered into two items, one adding up its lines and one priced by
   * hand, and the client reads the item and its price with the build-up nowhere.
   */
  const itemised: ProposalInput = {
    ...base,
    presentation: "groups",
    overheadPpm: 0,
    profitPpm: 0,
    groups: [
      { id: "g-shell", name: "The shell", clientNote: "Slab, framing and rebar, as drawn.", priceMode: "rollup", fixedPriceCents: null },
      { id: "g-paper", name: "Permits and approvals", clientNote: "", priceMode: "fixed", fixedPriceCents: 2_500_00 },
    ],
    lines: [
      { ...base.lines[0], groupId: "g-shell" },
      { ...base.lines[1], groupId: "g-shell" },
      { ...base.lines[2], groupId: "g-shell" },
      { ...base.lines[3], groupId: "g-paper" },
    ],
  };

  it("by item: one row per item at its price, its sentence beneath it, and the build-up nowhere", () => {
    const m = buildProposalModel(itemised);
    // The shell: 25,530 + 44,000 + 2,400 of price. Permits: the 2,500 that was typed.
    expect(rowsOf(m)).toEqual([
      ["The shell", "", "", "71,930.00"],
      ["Permits and approvals", "", "", "2,500.00"],
    ]);
    expect(m.price.rows.map((r) => r.note)).toEqual(["Slab, framing and rebar, as drawn.", ""]);
    expect(m.price.columns).toEqual({ quantity: false, unitPrice: false });
    expect(m.price.rounding).toBeNull();
    expect(m.price.total.amount).toBe("74,430.00");
    // Not one line's description is a row: the client reads items, never the build-up.
    const shown = m.price.rows.map((r) => r.description);
    for (const l of base.lines) expect(shown).not.toContain(l.description);
  });

  it("by item: a loose line keeps its own row, its quantity and its unit price", () => {
    const m = buildProposalModel({
      ...itemised,
      lines: [{ ...base.lines[0], groupId: "g-shell" }, { ...base.lines[2], groupId: null }],
    });
    expect(rowsOf(m)).toEqual([
      ["The shell", "", "", "25,530.00"],
      ["Permits and approvals", "", "", "2,500.00"],
      ["Rebar", "2 ton", "1,200.00", "2,400.00"],
    ]);
    expect(m.price.total.amount).toBe("30,430.00");
  });

  it("line by line: an item that adds up shows as a heading over its lines, and one priced by hand shows as ONE row", () => {
    const m = buildProposalModel({ ...itemised, presentation: "lines" });
    expect(m.price.rows.map((r) => [r.description, r.heading, r.amount])).toEqual([
      ["The shell", true, ""],
      ["Slab, 4in, fibre mesh", false, "25,530.00"],
      ["Framing labour", false, "44,000.00"],
      ["Rebar", false, "2,400.00"],
      // The permit line is behind a typed price, so the client never sees it.
      ["Permits and approvals", false, "2,500.00"],
    ]);
    expect(m.price.rows.map((r) => r.quantity)).toEqual(["", "120 cy", "", "2 ton", ""]);
    expect(m.price.total.amount).toBe("74,430.00");
    expect(m.price.rounding).toBeNull();
  });

  it("by cost code: a line behind a typed price is priced at its share of it, so the codes still add to the total", () => {
    const m = buildProposalModel({ ...itemised, presentation: "codes" });
    expect(rowsOf(m)).toEqual([
      ["03 30 00 · Cast-in-place concrete", "", "", "27,930.00"],
      ["06 10 00 · Rough carpentry", "", "", "44,000.00"],
      ["Other", "", "", "2,500.00"],
    ]);
    expect(m.price.total.amount).toBe("74,430.00");
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

describe("what the client reads, and what they do not (ADR 0080)", () => {
  /** The same four lines, with the estimator's shorthand on two of them. */
  const shorthand: ProposalInput = {
    ...base,
    overheadPpm: 0,
    profitPpm: 0,
    lines: [
      { ...base.lines[0], description: "Slab — 4in, fbr mesh, per RM 8/12", clientDescription: "Concrete slab, reinforced" },
      { ...base.lines[1], description: "Frmg lab — TM crew, see est. notes", clientDescription: "Framing labour" },
      base.lines[2],
      base.lines[3],
    ],
  };

  it("prints the client's words on a line, and the estimator's when there are none", () => {
    const m = buildProposalModel(shorthand);
    expect(m.price.rows.map((r) => r.description)).toEqual([
      "Concrete slab, reinforced",
      "Framing labour",
      "Rebar",
      "Permit",
    ]);
    // The shorthand — and what it points at — reaches nothing on the page.
    const printed = JSON.stringify(m);
    expect(printed).not.toContain("per RM 8/12");
    expect(printed).not.toContain("TM crew");
  });

  it("never prints a line kept off the proposal, and the rows still add to the total", () => {
    const m = buildProposalModel({
      ...shorthand,
      presentation: "lines",
      groups: [{ id: "g", name: "The structure", clientNote: "", priceMode: "rollup", fixedPriceCents: null }],
      lines: [
        { ...shorthand.lines[0], groupId: "g" },
        { ...shorthand.lines[1], groupId: "g" },
        // Contingency, inside the item, kept off the page.
        { description: "Contingency", unit: "", quantityThousandths: 1_000, unitCostCents: 5_000_00, markupPpm: null, unitPriceCents: null, codeLabel: null, groupId: "g", clientVisible: false },
      ],
    });
    // The item collapses to one row: 25,530 + 44,000 + 5,750 of contingency at 15%.
    expect(rowsOf(m)).toEqual([["The structure", "", "", "75,280.00"]]);
    expect(m.price.rounding).toBeNull();
    expect(m.price.total.amount).toBe("75,280.00");
    expect(JSON.stringify(m)).not.toContain("Contingency");
  });

  it("keeps the cost code's NUMBER off the page unless the business asks for it", () => {
    const withNames = base.lines.map((l) => ({
      ...l,
      codeName: l.codeLabel === null ? null : l.codeLabel.split(" · ")[1],
    }));
    const plain = buildProposalModel({ ...base, presentation: "codes", lines: withNames });
    expect(rowsOf(plain).map((r) => r[0])).toEqual([
      "Cast-in-place concrete",
      "Rough carpentry",
      "Other",
    ]);
    expect(JSON.stringify(plain)).not.toContain("03 30 00");

    const csi = buildProposalModel({ ...base, presentation: "codes", showCodeNumbers: true, lines: withNames });
    expect(rowsOf(csi).map((r) => r[0])).toEqual([
      "03 30 00 · Cast-in-place concrete",
      "06 10 00 · Rough carpentry",
      "Other",
    ]);
    // Either way the money is the same; only the label moved.
    expect(rowsOf(plain).map((r) => r[3])).toEqual(rowsOf(csi).map((r) => r[3]));
    expect(plain.price.total).toEqual(csi.price.total);
  });

  it("falls back to the label when a line carries no name of its own", () => {
    // An older caller that passes only `codeLabel` still prints something.
    const m = buildProposalModel({ ...base, presentation: "codes" });
    expect(rowsOf(m).map((r) => r[0])).toEqual([
      "03 30 00 · Cast-in-place concrete",
      "06 10 00 · Rough carpentry",
      "Other",
    ]);
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
    for (const presentation of ["lines", "codes", "groups", "sum"]) {
      const m = buildProposalModel({
        ...base,
        presentation,
        title: "",
        scope: "",
        exclusions: "",
        terms: "",
        // Items too, one priced by hand: the typed price must not print its margin either.
        groups: [
          { id: "g1", name: "Part one", clientNote: "As drawn.", priceMode: "rollup", fixedPriceCents: null },
          { id: "g2", name: "Part two", clientNote: "", priceMode: "fixed", fixedPriceCents: 2_500_00 },
        ],
        lines: base.lines.map((l, i) => ({
          ...l,
          description: `Item ${i + 1}`,
          codeLabel: l.codeLabel ? `Code ${i}` : null,
          groupId: i < 2 ? "g1" : "g2",
        })),
      });
      expect(JSON.stringify(m).toLowerCase()).not.toMatch(/cost|markup|overhead|profit|margin/);
    }
  });
});

describe("the proposal as a list of sections (E5a, ADR 0083)", () => {
  const items = [
    { id: "g1", name: "The shell", clientNote: "Slab, framing and rebar, as drawn.", priceMode: "rollup", fixedPriceCents: null },
    { id: "g2", name: "Permits and approvals", clientNote: "", priceMode: "fixed", fixedPriceCents: 2_500_00 },
  ];
  const grouped: ProposalInput = {
    ...base,
    presentation: "groups",
    overheadPpm: 0,
    profitPpm: 0,
    groups: items,
    lines: base.lines.map((l, i) => ({ ...l, groupId: i < 3 ? "g1" : "g2" })),
  };
  const extras = {
    letter: "Thank you for asking us to price the house.\nWe would be glad to build it.",
    allowances: [
      allowanceOf({ name: "Kitchen tile", allowanceCents: 6_000_00, chosenLabel: null, chosenPriceCents: null, neededBy: "2026-10-14" }),
      allowanceOf({ name: "Appliances", allowanceCents: 12_000_00, chosenLabel: "Café 36in range", chosenPriceCents: 13_400_00, neededBy: null }),
    ],
    milestones: [
      milestoneOf({ name: "Foundation", startOn: "2026-03-03", endOn: "2026-03-28", partyName: "Miller Concrete" }),
      milestoneOf({ name: "Substantial completion", startOn: "2026-11-02", endOn: "2026-11-02", partyName: null }),
    ],
  };
  const kinds = (d: ReturnType<typeof buildProposalDocument>) => d.sections.map((s) => s.kind);

  it("the LETTER is exactly the document ADR 0070 built, in sections", () => {
    const doc = buildProposalDocument(base, {}, "letter");
    expect(doc.format).toBe("letter");
    expect(kinds(doc)).toEqual(["facts", "parties", "text", "price", "text", "text", "acceptance"]);
    // And its money is the model's, untouched.
    expect(doc.model.price.total.amount).toBe("89,122.55");
  });

  it("the BROCHURE opens with a cover and a letter, then the narrative, the price, the allowances and the dates", () => {
    const doc = buildProposalDocument(grouped, extras, "brochure");
    expect(kinds(doc)).toEqual([
      "cover",
      "letter",
      "text",
      "narrative",
      "price",
      "allowances",
      "milestones",
      "text",
      "text",
      "acceptance",
    ]);
    const cover = doc.sections[0];
    expect(cover.kind === "cover" && cover.toName).toBe("Oak Row Owner");
    expect(cover.kind === "cover" && cover.project).toBe("24-108 · Oak Row residence — phase 2");
    const letter = doc.sections[1];
    expect(letter.kind === "letter" && letter.paragraphs).toEqual([
      "Thank you for asking us to price the house.",
      "We would be glad to build it.",
    ]);
    // THE NARRATIVE IS THE ITEMS' OWN WORDS, and carries no money at all.
    const narrative = doc.sections[3];
    expect(narrative.kind === "narrative" && narrative.items).toEqual([
      { name: "The shell", note: "Slab, framing and rebar, as drawn." },
      { name: "Permits and approvals", note: "" },
    ]);
    expect(JSON.stringify(narrative)).not.toContain("8,400");
    // AND THE SENTENCE IS PRINTED ONCE: the narrative has the notes, so the price
    // sheet beside it prints names and money only.
    const price = doc.sections.find((s) => s.kind === "price");
    expect(price?.kind === "price" && price.price.rows.map((r) => r.note)).toEqual(["", ""]);
    expect(price?.kind === "price" && price.price.rows.map((r) => r.description)).toEqual([
      "The shell",
      "Permits and approvals",
    ]);
    // With no notes to print there is nothing to deduplicate, so they stay where they were.
    const plain = buildProposalDocument(
      { ...grouped, groups: items.map((g) => ({ ...g, clientNote: "" })) },
      extras,
      "brochure",
    );
    expect(plain.sections.some((s) => s.kind === "narrative")).toBe(true);
  });

  it("leaves a page out rather than printing a heading over nothing", () => {
    // No letter, no selections, no phases, no items, no scope, no exclusions, no terms.
    const bare = buildProposalDocument(
      { ...base, scope: "", exclusions: "", terms: "", groups: [] },
      {},
      "brochure",
    );
    expect(kinds(bare)).toEqual(["cover", "price", "acceptance"]);
  });

  it("reads an allowance the way a client does, chosen or not", () => {
    const doc = buildProposalDocument(grouped, extras, "brochure");
    const allowances = doc.sections.find((s) => s.kind === "allowances");
    expect(allowances?.kind === "allowances" && allowances.rows).toEqual([
      { name: "Kitchen tile", allowance: "6,000.00 allowed", chosen: "", standing: "Still to choose, by 2026-10-14" },
      {
        name: "Appliances",
        allowance: "12,000.00 allowed",
        chosen: "Café 36in range · 13,400.00",
        standing: "Chosen",
      },
    ]);
    // A selection with no allowance is not an allowance line; that filter is the loader's.
    expect(allowanceOf({ name: "x", allowanceCents: 0, chosenLabel: null, chosenPriceCents: null, neededBy: null }).standing).toBe(
      "Still to choose",
    );
  });

  it("reads a milestone as a span, or a single date when it is one day", () => {
    const doc = buildProposalDocument(grouped, extras, "brochure");
    const milestones = doc.sections.find((s) => s.kind === "milestones");
    expect(milestones?.kind === "milestones" && milestones.rows).toEqual([
      { name: "Foundation", when: "2026-03-03 – 2026-03-28", who: "Miller Concrete" },
      { name: "Substantial completion", when: "2026-11-02", who: "" },
    ]);
  });

  it("falls back to the letter for a format nobody recognises, rather than printing nothing", () => {
    expect(buildProposalDocument(base, {}, "poster").format).toBe("letter");
    expect(isProposalFormat("brochure")).toBe(true);
    expect(isProposalFormat("poster")).toBe(false);
    for (const f of PROPOSAL_FORMATS) expect(PROPOSAL_FORMAT_LABELS[f]).toBeTruthy();
  });

  it("NEVER CARRIES COST, MARKUP, OVERHEAD, PROFIT OR MARGIN — in either format", () => {
    for (const format of PROPOSAL_FORMATS) {
      const doc = buildProposalDocument(
        {
          ...grouped,
          title: "",
          scope: "",
          exclusions: "",
          terms: "",
          groups: items.map((g, i) => ({ ...g, name: `Part ${i + 1}`, clientNote: "" })),
          lines: grouped.lines.map((l, i) => ({ ...l, description: `Item ${i + 1}`, codeLabel: null })),
        },
        { letter: "A letter.", allowances: extras.allowances, milestones: extras.milestones },
        format,
      );
      expect(JSON.stringify(doc.sections).toLowerCase(), format).not.toMatch(
        /cost|markup|overhead|profit|margin/,
      );
    }
  });
});

describe("the proposal as one HTML document", () => {
  const brandless = { businessName: "Ops Builder LLC", tagline: "", primaryColor: null, logo: null };

  it("renders a whole page for both formats, with nothing fetched from the network", () => {
    for (const format of PROPOSAL_FORMATS) {
      const html = renderProposalHtml(buildProposalDocument(base, { letter: "A letter." }, format), brandless);
      expect(html.startsWith("<!doctype html>"), format).toBe(true);
      expect(html, format).toContain("@page");
      expect(html, format).toContain("89,122.55");
      // No stylesheet, script or image that would need the network to look right.
      expect(html, format).not.toMatch(/<link|<script|src="http/);
    }
  });

  it("ESCAPES what the business typed, so a stray angle bracket cannot become markup", () => {
    const html = renderProposalHtml(
      buildProposalDocument(
        { ...base, title: "", scope: '<script>alert("x")</script> & "quoted"' },
        {},
        "letter",
      ),
      brandless,
    );
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("prints the brochure's cover, its letter and its allowance table", () => {
    const html = renderProposalHtml(
      buildProposalDocument(
        { ...base, presentation: "groups", groups: [{ id: "g", name: "The shell", clientNote: "As drawn.", priceMode: "rollup", fixedPriceCents: null }], lines: base.lines.map((l) => ({ ...l, groupId: "g" })) },
        {
          letter: "Thank you for asking us.",
          allowances: [allowanceOf({ name: "Kitchen tile", allowanceCents: 6_000_00, chosenLabel: null, chosenPriceCents: null, neededBy: null })],
          milestones: [milestoneOf({ name: "Foundation", startOn: "2026-03-03", endOn: "2026-03-28", partyName: null })],
        },
        "brochure",
      ),
      brandless,
    );
    expect(html).toContain("Thank you for asking us.");
    expect(html).toContain("class=\"section cover\"");
    expect(html).toContain("page-break");
    expect(html).toContain("Kitchen tile");
    expect(html).toContain("Foundation");
    // The item's own sentence reaches the page; the build-up does not.
    expect(html).toContain("As drawn.");
    expect(html).not.toContain("Slab, 4in, fibre mesh");
  });

  it("carries the DRAFT watermark into the document", () => {
    const html = renderProposalHtml(buildProposalDocument({ ...base, status: "draft" }, {}, "brochure"), brandless);
    expect(html).toContain("DRAFT");
    expect(renderProposalHtml(buildProposalDocument(base, {}, "brochure"), brandless)).not.toContain("watermark\">");
  });
});

describe("renderProposalPdf", () => {
  it("produces a real PDF for the line-by-line proposal, with a brand colour", async () => {
    const bytes = await renderProposalPdf({ ...base, brand: { tagline: "Built right", primaryColor: "#1d4ed8", logo: null } });
    expect(bytes.length).toBeGreaterThan(1000);
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
  });

  it("renders the by-item proposal, headings and an item's sentence included", async () => {
    const groups = [
      { id: "g1", name: "The shell", clientNote: "Slab, framing and rebar, as drawn.", priceMode: "rollup", fixedPriceCents: null },
      { id: "g2", name: "Permits and approvals", clientNote: "", priceMode: "fixed", fixedPriceCents: 2_500_00 },
    ];
    const lines = base.lines.map((l, i) => ({ ...l, groupId: i < 3 ? "g1" : "g2" }));
    for (const presentation of ["groups", "lines"]) {
      const bytes = await renderProposalPdf({ ...base, presentation, groups, lines });
      expect(Buffer.from(bytes.slice(0, 5)).toString("latin1"), presentation).toBe("%PDF-");
    }
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
