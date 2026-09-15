import { describe, expect, it } from "vitest";
import {
  buildCertificateModel,
  type CertificateInput,
} from "../src/packs/jobs/certificate-model";
import { renderCertificatePdf } from "../src/packs/jobs/certificate-pdf";

/**
 * The pay application's printout — the certificate page and the continuation
 * sheet (slice 5e, ADR 0063). The model is pure and every figure on the page
 * is pinned here; the renderer is exercised once per shape so that a missing
 * font face or a bad style fails here rather than at request time, the way
 * `invoice-pdf-render.test.ts` guards Accounting's.
 */

const fixed: CertificateInput = {
  businessName: "Ops Builder LLC",
  ownerName: "Oak Row Owner",
  ownerAddress: "17 Main St\nMount Vernon, OH 43050",
  projectNumber: "24-108",
  projectName: "Oak Row residence — phase 2",
  contractTitle: "New home",
  contractSignedOn: "2026-03-01",
  method: "fixed",
  originalCents: 100_000_00,
  retainagePpm: 100_000,
  applicationNumber: 2,
  periodTo: "2026-09-30",
  issuedOn: "2026-10-01",
  status: "issued",
  notes: "",
  previousPeriodTo: "2026-08-31",
  totals: {
    completedToDateCents: 65_000_00,
    retainageCents: 6_500_00,
    earnedLessRetainageCents: 58_500_00,
    previousCertificatesCents: 27_000_00,
    dueCents: 31_500_00,
  },
  changeOrders: [
    { number: "CO-1", title: "Deck", valueCents: 5_000_00, approvedOn: "2026-08-15" },
    { number: "CO-2", title: "Smaller pantry", valueCents: -1_000_00, approvedOn: "2026-09-10" },
  ],
  lines: [
    { description: "Foundation", scheduledCents: 30_000_00, previousCents: 30_000_00, thisPeriodCents: 0, storedCents: 0 },
    { description: "Framing", scheduledCents: 50_000_00, previousCents: 10_000_00, thisPeriodCents: 20_000_00, storedCents: 5_000_00 },
    { description: "Roof", scheduledCents: 24_000_00, previousCents: 0, thisPeriodCents: 0, storedCents: 0 },
  ],
  costs: [],
  labor: [],
  feeWords: "",
};

const costPlus: CertificateInput = {
  ...fixed,
  method: "cost_plus",
  contractTitle: "Cost plus build · Barn conversion",
  originalCents: 45_000_00,
  applicationNumber: 1,
  previousPeriodTo: null,
  status: "draft",
  issuedOn: null,
  totals: {
    completedToDateCents: 45_000_00,
    retainageCents: 4_500_00,
    earnedLessRetainageCents: 40_500_00,
    previousCertificatesCents: 0,
    dueCents: 40_500_00,
    costToDateCents: 40_000_00,
    feeToDateCents: 6_000_00,
    laborToDateCents: 0,
    capped: true,
  },
  changeOrders: [],
  lines: [],
  costs: [
    { label: "06 10 00 · Rough carpentry", ledgerToDateCents: 40_500_00, previousCents: 0, thisPeriodCents: 40_500_00 },
    { label: "No cost code", ledgerToDateCents: 850_00, previousCents: 0, thisPeriodCents: -500_00 },
  ],
  feeWords: "15% of cost",
};

const tm: CertificateInput = {
  ...costPlus,
  method: "time_and_materials",
  contractTitle: "Service work · Kitchen remodel",
  originalCents: null,
  status: "issued",
  issuedOn: "2026-09-14",
  totals: {
    completedToDateCents: 2_244_00,
    retainageCents: 0,
    earnedLessRetainageCents: 2_244_00,
    previousCertificatesCents: 0,
    dueCents: 2_244_00,
    laborToDateCents: 880_00,
    costToDateCents: 1_240_00,
    feeToDateCents: 124_00,
    capped: false,
  },
  costs: [{ label: "No cost code", ledgerToDateCents: 1_240_00, previousCents: 0, thisPeriodCents: 1_240_00 }],
  labor: [
    { name: "danr.houser91", rateCents: 50_00, minutesToDate: 120, previousMinutes: 0, thisPeriodMinutes: 120, previousCents: 0, thisPeriodCents: 100_00 },
    { name: "Marta Quinn", rateCents: 65_00, minutesToDate: 720, previousMinutes: 0, thisPeriodMinutes: 720, previousCents: 0, thisPeriodCents: 780_00 },
    { name: "Nobody Priced", rateCents: 0, minutesToDate: 30, previousMinutes: 0, thisPeriodMinutes: 0, previousCents: 0, thisPeriodCents: 0 },
  ],
  feeWords: "10% on cost",
};

describe("the certificate page", () => {
  const m = buildCertificateModel(fixed);

  it("carries the nine lines of a fixed-value application, in their order", () => {
    expect(m.summary.map((l) => [l.n, l.label, l.amount])).toEqual([
      ["1", "Original contract sum", "100,000.00"],
      ["2", "Net change by change orders", "4,000.00"],
      ["3", "Contract sum to date (1 + 2)", "104,000.00"],
      ["4", "Total completed and stored to date", "65,000.00"],
      ["5", "Retainage (10% of line 4)", "6,500.00"],
      ["6", "Total earned less retainage (4 − 5)", "58,500.00"],
      ["7", "Less previous certificates for payment", "27,000.00"],
      ["8", "Current payment due", "31,500.00"],
      ["9", "Balance to finish, including retainage (3 − 6)", "45,500.00"],
    ]);
    expect(m.summary[7].bold).toBe(true);
    expect(m.summary[3].detail).toBeUndefined();
  });

  it("splits the change orders at the last certificate's period end, additions from deductions", () => {
    expect(m.changes.rows).toEqual([
      { label: "Approved in previous periods", additions: "5,000.00", deductions: "0.00" },
      { label: "Approved this period", additions: "0.00", deductions: "1,000.00" },
      { label: "Totals", additions: "5,000.00", deductions: "1,000.00" },
    ]);
    expect(m.changes.net).toBe("4,000.00");
    // A first application has no previous certificate: everything is "this period".
    const first = buildCertificateModel({ ...fixed, previousPeriodTo: null });
    expect(first.changes.rows[0]).toMatchObject({ additions: "0.00", deductions: "0.00" });
    expect(first.changes.rows[1]).toMatchObject({ additions: "5,000.00", deductions: "1,000.00" });
    // A net deduction prints in parentheses, the way a statement does.
    const cut = buildCertificateModel({ ...fixed, changeOrders: [fixed.changeOrders[1]] });
    expect(cut.changes.net).toBe("(1,000.00)");
    expect(cut.summary[2].amount).toBe("99,000.00");
  });

  it("names the parties, the job and the dates, and says when a draft is not yet issued", () => {
    expect(m.toLines).toEqual(["Oak Row Owner", "17 Main St", "Mount Vernon, OH 43050"]);
    expect(m.fromLines).toEqual(["Ops Builder LLC"]);
    expect(m.facts).toEqual([
      ["Project", "24-108 · Oak Row residence — phase 2"],
      ["Contract for", "New home"],
      ["Contract date", "2026-03-01"],
      ["Application no.", "2"],
      ["Period to", "2026-09-30"],
      ["Application date", "2026-10-01"],
    ]);
    expect(m.watermark).toBeNull();
    const draft = buildCertificateModel({ ...fixed, status: "draft", issuedOn: null });
    expect(draft.watermark).toBe("DRAFT");
    expect(draft.facts[5]).toEqual(["Application date", "Not yet issued"]);
    expect(buildCertificateModel({ ...fixed, status: "void" }).watermark).toBe("VOID");
    // Nobody named yet: the block says so rather than printing nothing.
    expect(buildCertificateModel({ ...fixed, ownerName: "", ownerAddress: "" }).toLines).toEqual([]);
  });

  it("is signed by the contractor and certified by the owner or architect, in this product's own words", () => {
    expect(m.signatures.map((s) => s.heading)).toEqual(["Contractor", "Owner or architect"]);
    expect(m.signatures[1].lines[0]).toBe("Amount certified");
    expect(m.certification).toMatch(/^The undersigned contractor certifies/);
    // The form, its text and its name are the AIA's; none of them appears.
    for (const s of [m.title, m.certification, m.continuation.title, ...m.summary.map((l) => l.label)]) {
      expect(s).not.toMatch(/AIA|G702|G703/);
    }
  });
});

describe("the continuation sheet", () => {
  const m = buildCertificateModel(fixed);

  it("has a row per schedule line: scheduled, previous, this period, stored, to date, percent, balance", () => {
    expect(m.continuation.rows).toEqual([
      { item: "1", description: "Foundation", scheduled: "30,000.00", previous: "30,000.00", thisPeriod: "0.00", stored: "0.00", toDate: "30,000.00", percent: "100%", balance: "0.00" },
      { item: "2", description: "Framing", scheduled: "50,000.00", previous: "10,000.00", thisPeriod: "20,000.00", stored: "5,000.00", toDate: "35,000.00", percent: "70%", balance: "15,000.00" },
      { item: "3", description: "Roof", scheduled: "24,000.00", previous: "0.00", thisPeriod: "0.00", stored: "0.00", toDate: "0.00", percent: "0%", balance: "24,000.00" },
    ]);
    expect(m.continuation.total).toEqual({
      item: "",
      description: "Totals",
      scheduled: "104,000.00",
      previous: "40,000.00",
      thisPeriod: "20,000.00",
      stored: "5,000.00",
      toDate: "65,000.00",
      percent: "62.5%",
      balance: "39,000.00",
    });
    expect(m.continuation.caption).toBe("Application 2 · period to 2026-09-30 · retainage 10%");
    expect(m.costs.rows).toEqual([]);
    expect(m.labor.rows).toEqual([]);
  });

  it("a correction this period prints in parentheses and a schedule with no lines has no totals row", () => {
    const corrected = buildCertificateModel({
      ...fixed,
      lines: [{ description: "Framing", scheduledCents: 50_000_00, previousCents: 30_000_00, thisPeriodCents: -5_000_00, storedCents: 0 }],
    });
    expect(corrected.continuation.rows[0].thisPeriod).toBe("(5,000.00)");
    expect(corrected.continuation.rows[0].toDate).toBe("25,000.00");
    expect(buildCertificateModel({ ...fixed, lines: [] }).continuation.total).toBeNull();
  });
});

describe("a cost-plus or time-and-materials certificate", () => {
  it("prints the maximum where the contract sum goes, cost plus fee with its parts as line 4, and the cost by code in place of a schedule", () => {
    const m = buildCertificateModel(costPlus);
    expect(m.summary.map((l) => [l.n, l.label, l.amount])).toEqual([
      ["1", "Guaranteed maximum", "45,000.00"],
      ["2", "Net change by change orders", "0.00"],
      ["3", "Guaranteed maximum to date (1 + 2)", "45,000.00"],
      ["4", "Cost plus fee, at the guaranteed maximum", "45,000.00"],
      ["5", "Retainage (10% of line 4)", "4,500.00"],
      ["6", "Total earned less retainage (4 − 5)", "40,500.00"],
      ["7", "Less previous certificates for payment", "0.00"],
      ["8", "Current payment due", "40,500.00"],
      ["9", "Balance to the guaranteed maximum, including retainage (3 − 6)", "4,500.00"],
    ]);
    expect(m.summary[3].detail).toEqual([
      { label: "Cost to date", amount: "40,000.00" },
      { label: "Fee to date (15% of cost)", amount: "6,000.00" },
    ]);
    expect(m.continuation.rows).toEqual([]);
    expect(m.costs.rows).toEqual([
      { label: "06 10 00 · Rough carpentry", ledgerToDate: "40,500.00", previous: "0.00", thisPeriod: "40,500.00", toDate: "40,500.00" },
      { label: "No cost code", ledgerToDate: "850.00", previous: "0.00", thisPeriod: "(500.00)", toDate: "(500.00)" },
    ]);
    expect(m.costs.total).toMatchObject({ label: "Totals", ledgerToDate: "41,350.00", thisPeriod: "40,000.00", toDate: "40,000.00" });
    expect(m.watermark).toBe("DRAFT");
    expect(m.subtitle).toBe("Application 1 for cost plus a fee");
    // No maximum: lines 1, 3 and 9 say so instead of pretending to a number.
    const open = buildCertificateModel({ ...costPlus, originalCents: null, totals: { ...costPlus.totals, capped: false } });
    expect(open.summary[0].amount).toBe("None");
    expect(open.summary[2].amount).toBe("None");
    expect(open.summary[3].label).toBe("Cost plus fee to date");
    expect(open.summary[8].amount).toBe("—");
  });

  it("prints hours by person under the cost, labour first in line 4, and a person with no rate as a dash", () => {
    const m = buildCertificateModel(tm);
    expect(m.summary[0]).toMatchObject({ label: "Not to exceed", amount: "None" });
    expect(m.summary[3]).toMatchObject({ label: "Labour, cost and markup to date", amount: "2,244.00" });
    expect(m.summary[3].detail).toEqual([
      { label: "Labour to date", amount: "880.00" },
      { label: "Cost to date, wages aside", amount: "1,240.00" },
      { label: "Markup to date (10% on cost)", amount: "124.00" },
    ]);
    expect(m.labor.rows).toEqual([
      { name: "danr.houser91", rate: "50.00/h", hoursToDate: "2 h", previousHours: "0 h", thisPeriodHours: "2 h", thisPeriod: "100.00", toDate: "100.00" },
      { name: "Marta Quinn", rate: "65.00/h", hoursToDate: "12 h", previousHours: "0 h", thisPeriodHours: "12 h", thisPeriod: "780.00", toDate: "780.00" },
      { name: "Nobody Priced", rate: "—", hoursToDate: "0.5 h", previousHours: "0 h", thisPeriodHours: "0 h", thisPeriod: "0.00", toDate: "0.00" },
    ]);
    expect(m.labor.total).toMatchObject({ name: "Totals", hoursToDate: "14.5 h", thisPeriod: "880.00", toDate: "880.00" });
    expect(m.subtitle).toBe("Application 1 for hours at their rates and cost with a markup");
    expect(m.watermark).toBeNull();
  });
});

describe("renderCertificatePdf", () => {
  it("produces a real two-page PDF for a fixed-value application", async () => {
    const bytes = await renderCertificatePdf(fixed);
    expect(bytes.length).toBeGreaterThan(1000);
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
  });

  it("renders the cost-plus draft (watermark, bold face) and the time-and-materials one (three tables)", async () => {
    for (const input of [costPlus, tm]) {
      const bytes = await renderCertificatePdf(input);
      expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    }
  });

  it("renders an application with nothing on it yet, and one with notes and a brand colour", async () => {
    const empty = await renderCertificatePdf({ ...fixed, lines: [], changeOrders: [], notes: "" });
    expect(Buffer.from(empty.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    const noted = await renderCertificatePdf({
      ...fixed,
      notes: "Stored materials are in the locked container on site.",
      brand: { tagline: "Built right", primaryColor: "#1d4ed8", logo: null },
    });
    expect(Buffer.from(noted.slice(0, 5)).toString("latin1")).toBe("%PDF-");
  });
});
