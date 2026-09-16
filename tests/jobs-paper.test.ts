import { describe, expect, it } from "vitest";
import {
  buildChangeOrderPaper,
  buildOrderPaper,
  contractSumBefore,
  signedMoney,
  type ChangeOrderPaperInput,
  type OrderPaperInput,
} from "../src/packs/jobs/paper-model";
import { renderPaperPdf } from "../src/packs/jobs/paper-pdf";

/**
 * Paper for the outside (ADR 0075), pure: the change order at its price with
 * the contract sum before and after it, and the order as placed with its
 * changes beneath it. The layout is smoke-tested to bytes; the ops suite
 * proves the loaders read the rows.
 */

const changes: ChangeOrderPaperInput["approvedChanges"] = [
  { id: "co1", valueCents: 4_000_00, approvedOn: "2026-03-01", createdAt: "2026-02-20T10:00:00.000Z" },
  { id: "co2", valueCents: -1_500_00, approvedOn: "2026-04-10", createdAt: "2026-04-01T10:00:00.000Z" },
  { id: "co3", valueCents: 2_250_00, approvedOn: "2026-04-10", createdAt: "2026-04-05T10:00:00.000Z" },
];

const co: ChangeOrderPaperInput = {
  businessName: "Ops Builder LLC",
  toName: "Oak Row Owner",
  toAddress: "17 Main St\nMount Vernon, OH 43050",
  projectNumber: "24-108",
  projectName: "Oak Row residence",
  projectAddress: "4 Mill Lane",
  contractLabel: "Construction · Main house",
  contractValueCents: 400_000_00,
  approvedChanges: changes,
  id: "co3",
  number: "CO-3",
  title: "Dormer over bedroom 1",
  description: "Add a shed dormer over bedroom 1 as sketched by the architect on 2026-04-02.\nFraming, roofing, one window, drywall and paint.",
  status: "approved",
  requestedOn: "2026-04-05",
  approvedOn: "2026-04-10",
  createdAt: "2026-04-05T10:00:00.000Z",
  valueCents: 2_250_00,
};

describe("the contract sum before a change", () => {
  it("is the signed value plus the approved changes that came before it, by the day approved then by which was raised first", () => {
    expect(contractSumBefore({ ...co, id: "co1", status: "approved", approvedOn: "2026-03-01", createdAt: "2026-02-20T10:00:00.000Z" })).toBe(400_000_00);
    expect(contractSumBefore({ ...co, id: "co2", status: "approved", approvedOn: "2026-04-10", createdAt: "2026-04-01T10:00:00.000Z" })).toBe(404_000_00);
    expect(contractSumBefore(co)).toBe(402_500_00);
  });

  it("is the signed value plus every approved change for one not yet approved, and nothing on a contract with no value", () => {
    expect(contractSumBefore({ ...co, id: "co4", status: "proposed", approvedOn: null, createdAt: "2026-05-01T10:00:00.000Z" })).toBe(404_750_00);
    expect(contractSumBefore({ ...co, id: "co4", status: "declined", approvedOn: null, createdAt: "2026-05-01T10:00:00.000Z" })).toBe(404_750_00);
    expect(contractSumBefore({ ...co, contractValueCents: null })).toBeNull();
  });
});

describe("the change order", () => {
  it("prints the price, the contract sum before and after, and the ladder reads through the approved changes", () => {
    const m = buildChangeOrderPaper(co);
    expect(m.title).toBe("CHANGE ORDER");
    expect(m.subtitle).toBe("CO-3 · Dormer over bedroom 1");
    expect(m.facts).toEqual([
      ["Project", "24-108 · Oak Row residence"],
      ["Site", "4 Mill Lane"],
      ["Contract", "Construction · Main house"],
      ["Change order no.", "CO-3"],
      ["Requested", "2026-04-05"],
      ["Approved", "2026-04-10"],
    ]);
    expect(m.toLabel).toBe("TO");
    expect(m.toLines).toEqual(["Oak Row Owner", "17 Main St", "Mount Vernon, OH 43050"]);
    expect(m.fromLines).toEqual(["Ops Builder LLC"]);
    expect(m.sections).toEqual([{ title: "THE CHANGE", paragraphs: ["Add a shed dormer over bedroom 1 as sketched by the architect on 2026-04-02.", "Framing, roofing, one window, drywall and paint."] }]);
    expect(m.table).toBeNull();
    expect(m.sums).toEqual([
      { label: "Contract sum before this change", amount: "402,500.00", strong: false },
      { label: "This change", amount: "+2,250.00", strong: false },
      { label: "Contract sum after this change", amount: "404,750.00", strong: true },
    ]);
    expect(m.watermark).toBeNull();
    expect(m.closing).toContain("approved on 2026-04-10");
    expect(m.signatures.map((s) => s.heading)).toEqual(["Approved for Oak Row Owner", "For Ops Builder LLC"]);
    expect(m.footer).toBe("Ops Builder LLC · Change order CO-3 · 24-108");
  });

  it("marks a proposed, declined or void change, asks for a signature on a proposed one, and shows a deduction as one", () => {
    const proposed = buildChangeOrderPaper({ ...co, id: "co4", number: "CO-4", status: "proposed", approvedOn: null, valueCents: -800_00 });
    expect(proposed.watermark).toBe("PROPOSED");
    expect(proposed.facts.at(-1)).toEqual(["Status", "Proposed"]);
    expect(proposed.sums.map((s) => s.amount)).toEqual(["404,750.00", "−800.00", "403,950.00"]);
    expect(proposed.closing).toContain("Signing below approves this change");
    expect(buildChangeOrderPaper({ ...co, status: "declined", approvedOn: null }).watermark).toBe("DECLINED");
    expect(buildChangeOrderPaper({ ...co, status: "void", approvedOn: null }).watermark).toBe("VOID");
  });

  it("says only the change when the contract has no signed value, and copes with no client and no site", () => {
    const m = buildChangeOrderPaper({ ...co, contractValueCents: null, toName: "", toAddress: "", projectAddress: "", title: "" });
    expect(m.sums).toEqual([{ label: "This change", amount: "+2,250.00", strong: true }]);
    expect(m.subtitle).toBe("Change order CO-3");
    expect(m.toLines).toEqual([]);
    expect(m.facts.some(([l]) => l === "Site")).toBe(false);
    expect(m.signatures[0].heading).toBe("Approved for the client");
  });

  it("NEVER prints the cost, a code, the markup or the margin", () => {
    const m = buildChangeOrderPaper({ ...co, businessName: "B", toName: "C", projectName: "P", contractLabel: "K", description: "D", title: "T" });
    expect(JSON.stringify(m).toLowerCase()).not.toMatch(/cost|markup|overhead|profit|margin|code/);
  });

  it("signs money the way the eye reads it, in the house style that prints no currency symbol (the proposal's and the certificate's)", () => {
    expect(signedMoney(1_200_00)).toBe("+1,200.00");
    expect(signedMoney(-300_00)).toBe("−300.00");
    expect(signedMoney(0)).toBe("0.00");
  });
});

const order: OrderPaperInput = {
  businessName: "Ops Builder LLC",
  vendorName: "Framing crew",
  vendorAddress: "PO Box 12\nGambier, OH 43022",
  projectNumber: "24-108",
  projectName: "Oak Row residence",
  projectAddress: "4 Mill Lane",
  kind: "subcontract",
  number: "SC-24108-1",
  description: "Framing labour, first and second floor",
  status: "issued",
  issuedOn: "2026-05-01",
  notes: "Net 30 from an approved application.\nRetainage 10% until final.",
  lines: [
    { description: "First floor framing", codeLabel: "06 10 00 · Rough carpentry", amountCents: 18_000_00, change: null },
    { description: "Second floor framing", codeLabel: "06 10 00 · Rough carpentry", amountCents: 14_000_00, change: null },
    { description: "Dormer framing", codeLabel: "06 10 00 · Rough carpentry", amountCents: 1_800_00, change: { number: "SCO-1", status: "approved" } },
    { description: "Extra blocking", codeLabel: null, amountCents: 400_00, change: { number: "SCO-2", status: "proposed" } },
  ],
  changes: [
    { number: "SCO-1", title: "Dormer framing", status: "approved", approvedOn: "2026-05-20", amountCents: 1_800_00 },
    { number: "SCO-2", title: "Extra blocking", status: "proposed", approvedOn: null, amountCents: 400_00 },
  ],
};

describe("the order", () => {
  it("prints the lines the order was placed with, its changes beneath with where each stands, and a total that counts only the approved", () => {
    const m = buildOrderPaper(order);
    expect(m.title).toBe("SUBCONTRACT");
    expect(m.subtitle).toBe("SC-24108-1 · Framing labour, first and second floor");
    expect(m.toLabel).toBe("SUBCONTRACTOR");
    expect(m.toLines).toEqual(["Framing crew", "PO Box 12", "Gambier, OH 43022"]);
    expect(m.facts).toEqual([
      ["Project", "24-108 · Oak Row residence"],
      ["Site", "4 Mill Lane"],
      ["Order no.", "SC-24108-1"],
      ["Issued", "2026-05-01"],
    ]);
    expect(m.table?.columns.map((c) => c.label)).toEqual(["ITEM", "COST CODE", "AMOUNT"]);
    expect(m.table?.rows).toEqual([
      ["First floor framing", "06 10 00 · Rough carpentry", "18,000.00"],
      ["Second floor framing", "06 10 00 · Rough carpentry", "14,000.00"],
    ]);
    expect(m.table?.total).toEqual({ label: "Order as placed", amount: "32,000.00" });
    expect(m.sections).toEqual([
      { title: "CHANGE ORDERS ON THIS ORDER", paragraphs: ["SCO-1 · Dormer framing: +1,800.00 (approved 2026-05-20)", "SCO-2 · Extra blocking: +400.00 (proposed)"] },
      { title: "TERMS", paragraphs: ["Net 30 from an approved application.", "Retainage 10% until final."] },
    ]);
    expect(m.sums).toEqual([
      { label: "Order as placed", amount: "32,000.00", strong: false },
      { label: "Approved changes", amount: "+1,800.00", strong: false },
      { label: "Subcontract total", amount: "33,800.00", strong: true },
    ]);
    expect(m.watermark).toBeNull();
    expect(m.signatures.map((s) => s.heading)).toEqual(["Accepted for Framing crew", "For Ops Builder LLC"]);
    expect(m.footer).toBe("Ops Builder LLC · Subcontract SC-24108-1 · 24-108");
  });

  it("is a purchase order with one signature and no code column when no line has a code, DRAFT until issued, CANCELLED when it is", () => {
    const po = buildOrderPaper({
      ...order,
      kind: "purchase_order",
      number: "PO-7",
      description: "",
      status: "draft",
      issuedOn: null,
      notes: "",
      changes: [],
      lines: [{ description: "Lumber package", codeLabel: null, amountCents: 9_000_00, change: null }],
    });
    expect(po.title).toBe("PURCHASE ORDER");
    expect(po.subtitle).toBe("Purchase order PO-7");
    expect(po.toLabel).toBe("VENDOR");
    expect(po.facts.at(-1)).toEqual(["Issued", "Not yet issued"]);
    expect(po.table?.columns.map((c) => c.label)).toEqual(["ITEM", "AMOUNT"]);
    expect(po.table?.rows).toEqual([["Lumber package", "9,000.00"]]);
    expect(po.sections).toEqual([]);
    expect(po.sums).toEqual([{ label: "Purchase order total", amount: "9,000.00", strong: true }]);
    expect(po.watermark).toBe("DRAFT");
    expect(po.signatures).toHaveLength(1);
    expect(buildOrderPaper({ ...order, status: "cancelled" }).watermark).toBe("CANCELLED");
    expect(buildOrderPaper({ ...order, status: "closed" }).watermark).toBeNull();
  });
});

describe("renderPaperPdf", () => {
  it("renders both documents to PDF bytes, with and without a brand", async () => {
    for (const m of [buildChangeOrderPaper(co), buildOrderPaper(order), buildChangeOrderPaper({ ...co, brand: { tagline: "Built right", primaryColor: "#1d4ed8", logo: null } })]) {
      const bytes = await renderPaperPdf(m, "test");
      expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    }
  }, 60_000);
});
