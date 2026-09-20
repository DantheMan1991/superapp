import { describe, expect, it } from "vitest";
import {
  buildProposalDocument,
  isProposalFormat,
  UNSECTIONED,
  type WorksheetRow,
} from "../src/packs/jobs/proposal-sections";
import type { ProposalInput } from "../src/packs/jobs/proposal-model";

/**
 * THE PRICE SHEET (the founder's own document).
 *
 * Sections over client items, numbered straight through, and **a row at
 * `$0.00` printed rather than dropped** — about a third of a real sheet is
 * those, and they are its exclusions.
 *
 * The rule the whole format rests on: **it arranges, it never computes.**
 * Every figure comes from the model.
 */

function line(over: Partial<ProposalInput["lines"][number]> = {}) {
  return {
    description: "A line",
    unit: "",
    quantityThousandths: 1_000,
    unitCostCents: 100_00,
    markupPpm: null,
    unitPriceCents: null,
    clientDescription: "",
    clientVisible: true,
    groupId: null as string | null,
    codeLabel: null,
    codeName: null,
    ...over,
  };
}

function group(id: string, name: string, section: string) {
  return {
    id,
    name,
    clientNote: "",
    section,
    priceMode: "rollup",
    fixedPriceCents: null,
    showLines: false,
  };
}

const INPUT: ProposalInput = {
  businessName: "A builder",
  toName: "Jennifer and Andrew",
  toAddress: "",
  projectNumber: "24-109",
  projectName: "New home",
  projectAddress: "1150 Colville Road",
  number: "EST-2",
  title: "New home price sheet",
  status: "draft",
  sentOn: null,
  validUntil: null,
  presentation: "groups",
  scope: "",
  exclusions: "",
  terms: "",
  markupPpm: 0,
  overheadPpm: 0,
  profitPpm: 0,
  groups: [
    group("g1", "Excavation cut and fill", "Infrastructure"),
    group("g2", "Rip rap", "Infrastructure"),
    group("g3", "Footers", "Structure"),
    group("g4", "Rods in footers", "Structure"),
  ],
  lines: [
    line({ groupId: "g1", unitCostCents: 16_250_00, description: "Excavation" }),
    line({ groupId: "g2", unitCostCents: 1_775_00, description: "Rip rap" }),
    line({ groupId: "g3", unitCostCents: 16_828_00, description: "Footers" }),
    /** A row the client is shown at nothing on purpose: an exclusion. */
    line({ groupId: "g4", unitCostCents: 0, description: "Included in the footer" }),
  ],
};

function sheetOf(input: ProposalInput = INPUT): WorksheetRow[] {
  const doc = buildProposalDocument(input, {}, "price_sheet");
  const section = doc.sections.find((s) => s.kind === "worksheet");
  if (!section || section.kind !== "worksheet") throw new Error("no worksheet");
  return section.rows;
}

describe("isProposalFormat", () => {
  it("knows the three", () => {
    expect(isProposalFormat("letter")).toBe(true);
    expect(isProposalFormat("brochure")).toBe(true);
    expect(isProposalFormat("price_sheet")).toBe(true);
    expect(isProposalFormat("worksheet")).toBe(false);
  });

  it("falls back to the letter rather than refusing", () => {
    expect(buildProposalDocument(INPUT, {}, "nonsense").format).toBe("letter");
  });
});

describe("the price sheet", () => {
  /**
   * **THE NUMBER RUNS THROUGH EVERYTHING, HEADINGS INCLUDED.** That is what
   * makes *"look at 102"* work on the phone, which is the only reason the
   * numbers are there at all.
   */
  it("numbers straight through, sections and items alike", () => {
    expect(sheetOf().map((r) => [r.number, r.description, r.isSection])).toEqual([
      [1, "Infrastructure", true],
      [2, "Excavation cut and fill", false],
      [3, "Rip rap", false],
      [4, "Structure", true],
      [5, "Footers", false],
      [6, "Rods in footers", false],
    ]);
  });

  it("starts a heading only where the section changes", () => {
    const rows = sheetOf();
    expect(rows.filter((r) => r.isSection).map((r) => r.description)).toEqual([
      "Infrastructure",
      "Structure",
    ]);
  });

  /**
   * **A ROW AT `$0.00` IS THE POINT, NOT AN OMISSION.** Roughly sixty of the
   * pilot's 195 rows are zero on purpose — *"By Owner"*, *"(N/A)"*,
   * *"Included in the plumbing quote"* — and they are the exclusions, stated
   * where the client reads them.
   */
  it("prints an item that costs nothing", () => {
    const rows = sheetOf();
    const zero = rows.find((r) => r.description === "Rods in footers");
    expect(zero).toBeDefined();
    /** Present, and carrying the model's own nothing rather than a blank. */
    expect(zero?.amount).toMatch(/0\.00$/);
    expect(zero?.amount).not.toBe("");
    /** And it did not shorten the sheet: four items in, four items out. */
    expect(rows.filter((r) => !r.isSection)).toHaveLength(4);
  });

  it("carries the item's own note beside its name", () => {
    const withNote: ProposalInput = {
      ...INPUT,
      groups: INPUT.groups?.map((g) => (g.id === "g3" ? { ...g, clientNote: "As per plans" } : g)),
    };
    expect(sheetOf(withNote).find((r) => r.description === "Footers")?.note).toBe("As per plans");
  });

  /**
   * **IT ARRANGES; IT NEVER COMPUTES.** Every amount on the sheet is one the
   * model already produced, and they still add to the total the model says.
   */
  it("shows the model's own figures and nothing it worked out itself", () => {
    const doc = buildProposalDocument(INPUT, {}, "price_sheet");
    const section = doc.sections.find((s) => s.kind === "worksheet");
    if (!section || section.kind !== "worksheet") throw new Error("no worksheet");

    const amounts = section.rows.filter((r) => !r.isSection).map((r) => r.amount);
    expect(amounts).toEqual(doc.model.price.rows.map((r) => r.amount));
    expect(section.total).toEqual(doc.model.price.total);
  });

  /**
   * **AN UNSECTIONED ITEM MAY NOT BORROW THE HEADING ABOVE IT.** Driving the
   * sheet found `Loft framing` printed under `FINISHES` having never been
   * put there — a client document saying something nobody meant.
   */
  it("heads the items that have no section, once anything else has one", () => {
    const mixed: ProposalInput = {
      ...INPUT,
      groups: INPUT.groups?.map((g) => (g.id === "g4" ? { ...g, section: "" } : g)),
    };
    const rows = sheetOf(mixed);
    const headings = rows.filter((r) => r.isSection).map((r) => r.description);
    expect(headings).toEqual(["Infrastructure", "Structure", UNSECTIONED]);
    /** And the item itself is the one under it. */
    const at = rows.findIndex((r) => r.description === UNSECTIONED);
    expect(rows[at + 1].description).toBe("Rods in footers");
  });

  /** Every estimate written before sections existed is this, and it still reads. */
  it("prints a plain numbered list when nothing carries a section", () => {
    const plain: ProposalInput = {
      ...INPUT,
      groups: INPUT.groups?.map((g) => ({ ...g, section: "" })),
    };
    const rows = sheetOf(plain);
    expect(rows.every((r) => !r.isSection)).toBe(true);
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3, 4]);
  });

  it("gives the sheet a parties block, the facts and the total", () => {
    const kinds = buildProposalDocument(INPUT, {}, "price_sheet").sections.map((s) => s.kind);
    expect(kinds).toContain("parties");
    expect(kinds).toContain("facts");
    expect(kinds).toContain("worksheet");
  });

  it("says nothing about an estimate with no lines", () => {
    const empty: ProposalInput = { ...INPUT, groups: [], lines: [] };
    expect(sheetOf(empty)).toEqual([]);
  });
});
