import { fitLogo, readableOnWhite, type HexColor } from "@/lib/brand/core";
import { formatCentsSigned } from "@/lib/money";
import { formatQuantity, minutesToHoursString, percentComplete, ppmToPercentString } from "./billing-math";

/**
 * A PAY APPLICATION AS A PRINTABLE CERTIFICATE — pure, no database, no React
 * (slice 5e, ADR 0063). The same split as Accounting's `invoice-pdf-model.ts`:
 * every decision about what the pages say is made here and table-tested;
 * `certificate-pdf.tsx` is a layout file with no arithmetic in it.
 *
 * THE SHAPE IS THE ONE EVERY OWNER AND ARCHITECT KNOWS — the application and
 * certificate for payment with its nine numbered lines and its change-order
 * summary, and a continuation sheet with a row per schedule line: scheduled,
 * from previous applications, this period, stored, to date, percent, balance
 * to finish. The wording is this product's own; the form itself, its text and
 * its name belong to the AIA, and nothing here reproduces them. A cost-plus or
 * time-and-materials application prints on the same two pages with its own
 * lines: the books' cost by code, and the hours by person, in place of a
 * schedule (ADRs 0060 and 0062).
 *
 * All money arrives as integer cents and leaves as a formatted string.
 */

export type CertificateMethod = "fixed" | "unit_price" | "cost_plus" | "time_and_materials";

export interface CertificateBrand {
  tagline: string;
  primaryColor: HexColor | null;
  logo: { data: Uint8Array; width: number; height: number; format: "png" | "jpg" } | null;
}

export interface CertificateInput {
  businessName: string;
  brand?: CertificateBrand;
  /** The person or business the application is made to. */
  ownerName: string;
  /** Free-text postal address; may hold newlines. */
  ownerAddress: string;
  projectNumber: string;
  projectName: string;
  /** "Service work · Kitchen remodel" — the kind and the name, as the contract page titles it. */
  contractTitle: string;
  contractSignedOn: string | null;
  method: CertificateMethod;
  /** The original contract sum on a fixed-value contract; the maximum on the other two (null for none). */
  originalCents: number | null;
  retainagePpm: number;
  applicationNumber: number;
  periodTo: string;
  issuedOn: string | null;
  status: string;
  notes: string;
  /** The last issued application's period end, which decides which change orders are "previous". */
  previousPeriodTo: string | null;
  totals: {
    completedToDateCents: number;
    retainageCents: number;
    earnedLessRetainageCents: number;
    previousCertificatesCents: number;
    dueCents: number;
    /** Cost plus and T&M only: the parts of line 4. */
    laborToDateCents?: number;
    costToDateCents?: number;
    feeToDateCents?: number;
    capped?: boolean;
  };
  /** The APPROVED change orders on the contract. */
  changeOrders: ReadonlyArray<{ number: string; title: string; valueCents: number; approvedOn: string | null }>;
  /** Fixed-value methods: the schedule lines, in order. */
  lines: ReadonlyArray<{
    description: string;
    scheduledCents: number;
    previousCents: number;
    thisPeriodCents: number;
    storedCents: number;
    /** Unit price (ADR 0064): the unit, the price, the estimate and the quantities; absent on a lump-sum line. */
    unit?: string;
    unitPriceCents?: number | null;
    quantityThousandths?: number | null;
    quantityPreviousThousandths?: number;
    quantityThisPeriodThousandths?: number;
  }>;
  /** Cost plus and T&M: the books' cost by code. */
  costs: ReadonlyArray<{
    label: string;
    ledgerToDateCents: number;
    previousCents: number;
    thisPeriodCents: number;
  }>;
  /** T&M: the hours by person and rate. */
  labor: ReadonlyArray<{
    name: string;
    rateCents: number;
    minutesToDate: number;
    previousMinutes: number;
    thisPeriodMinutes: number;
    previousCents: number;
    thisPeriodCents: number;
  }>;
  /** Words for the fee or markup, e.g. "15% of cost", or "" for none. */
  feeWords: string;
}

export interface CertificateSummaryLine {
  n: string;
  label: string;
  amount: string;
  /** Sub-lines under line 4 on a cost-plus or T&M certificate. */
  detail?: Array<{ label: string; amount: string }>;
  bold?: boolean;
}

export interface CertificateChangeSummary {
  rows: Array<{ label: string; additions: string; deductions: string }>;
  netLabel: string;
  net: string;
}

export interface ContinuationRow {
  item: string;
  description: string;
  /** Unit price only; "" on a lump-sum line. */
  unit: string;
  unitPrice: string;
  estimatedQuantity: string;
  previousQuantity: string;
  thisPeriodQuantity: string;
  toDateQuantity: string;
  scheduled: string;
  previous: string;
  thisPeriod: string;
  stored: string;
  toDate: string;
  percent: string;
  balance: string;
}

export interface CostRow {
  label: string;
  ledgerToDate: string;
  previous: string;
  thisPeriod: string;
  toDate: string;
}

export interface LaborRow {
  name: string;
  rate: string;
  hoursToDate: string;
  previousHours: string;
  thisPeriodHours: string;
  thisPeriod: string;
  toDate: string;
}

export interface CertificateModel {
  title: string;
  subtitle: string;
  businessName: string;
  tagline: string;
  titleColor: HexColor;
  ruleColor: HexColor;
  logo: CertificateBrand["logo"];
  /** The header's facts, label and value, in print order. */
  facts: Array<[string, string]>;
  toLines: string[];
  fromLines: string[];
  summary: CertificateSummaryLine[];
  changes: CertificateChangeSummary;
  certification: string;
  signatures: Array<{ heading: string; lines: string[] }>;
  continuation: {
    title: string;
    /** Under the title: the period, the application, the rate. */
    caption: string;
    /** Unit price: the sheet carries the unit columns. */
    unitPriced: boolean;
    rows: ContinuationRow[];
    total: ContinuationRow | null;
  };
  costs: { rows: CostRow[]; total: CostRow | null };
  labor: { rows: LaborRow[]; total: LaborRow | null };
  notes: string;
  watermark: string | null;
  footer: string;
}

/** The ink the certificate uses without a brand colour, the invoice's. */
export const CERTIFICATE_INK: HexColor = "#111827";
export const CERTIFICATE_LOGO_BOX = { width: 140, height: 48 } as const;

/** Parentheses for a negative, the convention on a printed statement: a deduction reads (1,000.00). */
function money(cents: number): string {
  return formatCentsSigned(cents);
}

function pct(completedCents: number, scheduledCents: number): string {
  const p = percentComplete(completedCents, scheduledCents);
  return p === null ? "—" : `${p}%`;
}

function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

export function buildCertificateModel(input: CertificateInput): CertificateModel {
  const primary = input.brand?.primaryColor ?? null;
  const logo = input.brand?.logo ?? null;
  const ledger = input.method === "cost_plus" || input.method === "time_and_materials";
  const unitPriced = input.method === "unit_price";
  const tm = input.method === "time_and_materials";
  const draft = input.status === "draft";
  const feeWord = tm ? "markup" : "fee";

  // ---- the change-order summary: approved before the last certificate, or since
  const previous = input.changeOrders.filter(
    (c) => input.previousPeriodTo !== null && c.approvedOn !== null && c.approvedOn <= input.previousPeriodTo,
  );
  const thisPeriod = input.changeOrders.filter((c) => !previous.includes(c));
  type ChangeOrder = CertificateInput["changeOrders"][number];
  const additions = (rows: ReadonlyArray<ChangeOrder>) =>
    rows.filter((c) => c.valueCents > 0).reduce((s, c) => s + c.valueCents, 0);
  const deductions = (rows: ReadonlyArray<ChangeOrder>) =>
    rows.filter((c) => c.valueCents < 0).reduce((s, c) => s - c.valueCents, 0);
  const netChangeCents = input.changeOrders.reduce((s, c) => s + c.valueCents, 0);
  const changes: CertificateChangeSummary = {
    rows: [
      {
        label: "Approved in previous periods",
        additions: money(additions(previous)),
        deductions: money(deductions(previous)),
      },
      {
        label: "Approved this period",
        additions: money(additions(thisPeriod)),
        deductions: money(deductions(thisPeriod)),
      },
      {
        label: "Totals",
        additions: money(additions(input.changeOrders)),
        deductions: money(deductions(input.changeOrders)),
      },
    ],
    netLabel: "Net change by change orders",
    net: money(netChangeCents),
  };

  // ---- the nine lines
  const originalCents = input.originalCents;
  const sumToDateCents = originalCents === null ? null : originalCents + netChangeCents;
  const t = input.totals;
  const none = "—";
  const capWord = tm ? "not-to-exceed" : "guaranteed maximum";
  const line4Label = ledger
    ? t.capped
      ? `${tm ? "Labour, cost and markup" : "Cost plus fee"}, at the ${capWord}`
      : tm
        ? "Labour, cost and markup to date"
        : "Cost plus fee to date"
    : "Total completed and stored to date";
  const detail: CertificateSummaryLine["detail"] = ledger
    ? [
        ...(tm ? [{ label: "Labour to date", amount: money(t.laborToDateCents ?? 0) }] : []),
        { label: tm ? "Cost to date, wages aside" : "Cost to date", amount: money(t.costToDateCents ?? 0) },
        {
          label: `${tm ? "Markup" : "Fee"} to date${input.feeWords ? ` (${input.feeWords})` : ""}`,
          amount: money(t.feeToDateCents ?? 0),
        },
      ]
    : undefined;
  const summary: CertificateSummaryLine[] = [
    {
      n: "1",
      label: ledger ? (tm ? "Not to exceed" : "Guaranteed maximum") : "Original contract sum",
      amount: originalCents === null ? (ledger ? "None" : none) : money(originalCents),
    },
    { n: "2", label: "Net change by change orders", amount: money(netChangeCents) },
    {
      n: "3",
      label: ledger ? `${tm ? "Not to exceed" : "Guaranteed maximum"} to date (1 + 2)` : "Contract sum to date (1 + 2)",
      amount: sumToDateCents === null ? (ledger ? "None" : none) : money(sumToDateCents),
    },
    { n: "4", label: line4Label, amount: money(t.completedToDateCents), detail },
    {
      n: "5",
      label: `Retainage (${ppmToPercentString(input.retainagePpm)}% of line 4)`,
      amount: money(t.retainageCents),
    },
    { n: "6", label: "Total earned less retainage (4 − 5)", amount: money(t.earnedLessRetainageCents) },
    { n: "7", label: "Less previous certificates for payment", amount: money(t.previousCertificatesCents) },
    { n: "8", label: "Current payment due", amount: money(t.dueCents), bold: true },
    {
      n: "9",
      label: ledger ? `Balance to the ${capWord}, including retainage (3 − 6)` : "Balance to finish, including retainage (3 − 6)",
      amount: sumToDateCents === null ? none : money(sumToDateCents - t.earnedLessRetainageCents),
    },
  ];

  // ---- the continuation sheet
  const rows: ContinuationRow[] = input.lines.map((l, i) => {
    const toDate = l.previousCents + l.thisPeriodCents + l.storedCents;
    const priced = l.unitPriceCents != null;
    const previousQty = l.quantityPreviousThousandths ?? 0;
    const thisQty = l.quantityThisPeriodThousandths ?? 0;
    return {
      item: String(i + 1),
      description: l.description,
      unit: priced ? (l.unit ?? "") : "",
      unitPrice: priced ? money(l.unitPriceCents as number) : "",
      estimatedQuantity: priced ? formatQuantity(l.quantityThousandths ?? 0) : "",
      previousQuantity: priced ? formatQuantity(previousQty) : "",
      thisPeriodQuantity: priced ? formatQuantity(thisQty) : "",
      toDateQuantity: priced ? formatQuantity(previousQty + thisQty) : "",
      scheduled: money(l.scheduledCents),
      previous: money(l.previousCents),
      thisPeriod: money(l.thisPeriodCents),
      stored: money(l.storedCents),
      toDate: money(toDate),
      percent: pct(toDate, l.scheduledCents),
      balance: money(l.scheduledCents - toDate),
    };
  });
  const sum = (pick: (l: CertificateInput["lines"][number]) => number) =>
    input.lines.reduce((s, l) => s + pick(l), 0);
  const scheduledTotal = sum((l) => l.scheduledCents);
  const toDateTotal = sum((l) => l.previousCents + l.thisPeriodCents + l.storedCents);
  const total: ContinuationRow | null =
    input.lines.length === 0
      ? null
      : {
          item: "",
          description: "Totals",
          unit: "",
          unitPrice: "",
          estimatedQuantity: "",
          previousQuantity: "",
          thisPeriodQuantity: "",
          toDateQuantity: "",
          scheduled: money(scheduledTotal),
          previous: money(sum((l) => l.previousCents)),
          thisPeriod: money(sum((l) => l.thisPeriodCents)),
          stored: money(sum((l) => l.storedCents)),
          toDate: money(toDateTotal),
          percent: pct(toDateTotal, scheduledTotal),
          balance: money(scheduledTotal - toDateTotal),
        };

  const costRows: CostRow[] = input.costs.map((c) => ({
    label: c.label,
    ledgerToDate: money(c.ledgerToDateCents),
    previous: money(c.previousCents),
    thisPeriod: money(c.thisPeriodCents),
    toDate: money(c.previousCents + c.thisPeriodCents),
  }));
  const costTotal: CostRow | null =
    input.costs.length === 0
      ? null
      : {
          label: "Totals",
          ledgerToDate: money(input.costs.reduce((s, c) => s + c.ledgerToDateCents, 0)),
          previous: money(input.costs.reduce((s, c) => s + c.previousCents, 0)),
          thisPeriod: money(input.costs.reduce((s, c) => s + c.thisPeriodCents, 0)),
          toDate: money(input.costs.reduce((s, c) => s + c.previousCents + c.thisPeriodCents, 0)),
        };
  const laborRows: LaborRow[] = input.labor.map((l) => ({
    name: l.name,
    rate: l.rateCents === 0 ? "—" : `${money(l.rateCents)}/h`,
    hoursToDate: `${minutesToHoursString(l.minutesToDate)} h`,
    previousHours: `${minutesToHoursString(l.previousMinutes)} h`,
    thisPeriodHours: `${minutesToHoursString(l.thisPeriodMinutes)} h`,
    thisPeriod: money(l.thisPeriodCents),
    toDate: money(l.previousCents + l.thisPeriodCents),
  }));
  const laborTotal: LaborRow | null =
    input.labor.length === 0
      ? null
      : {
          name: "Totals",
          rate: "",
          hoursToDate: `${minutesToHoursString(input.labor.reduce((s, l) => s + l.minutesToDate, 0))} h`,
          previousHours: `${minutesToHoursString(input.labor.reduce((s, l) => s + l.previousMinutes, 0))} h`,
          thisPeriodHours: `${minutesToHoursString(input.labor.reduce((s, l) => s + l.thisPeriodMinutes, 0))} h`,
          thisPeriod: money(input.labor.reduce((s, l) => s + l.thisPeriodCents, 0)),
          toDate: money(input.labor.reduce((s, l) => s + l.previousCents + l.thisPeriodCents, 0)),
        };

  const methodWords =
    input.method === "fixed"
      ? "against the schedule of values"
      : unitPriced
        ? "against a schedule of unit prices"
        : tm
        ? "for hours at their rates and cost with a markup"
        : `for cost plus a ${feeWord}`;
  const facts: Array<[string, string]> = [
    ["Project", `${input.projectNumber} · ${input.projectName}`],
    ["Contract for", input.contractTitle],
    ["Contract date", input.contractSignedOn ?? "—"],
    ["Application no.", String(input.applicationNumber)],
    ["Period to", input.periodTo],
    ["Application date", input.issuedOn ?? (draft ? "Not yet issued" : "—")],
  ];

  return {
    title: "APPLICATION AND CERTIFICATE FOR PAYMENT",
    subtitle: `Application ${input.applicationNumber} ${methodWords}`,
    businessName: input.businessName,
    tagline: input.brand?.tagline.trim() ?? "",
    titleColor: primary ? readableOnWhite(primary, CERTIFICATE_INK) : CERTIFICATE_INK,
    ruleColor: primary ?? CERTIFICATE_INK,
    logo: logo ? { data: logo.data, format: logo.format, ...fitLogo(logo, CERTIFICATE_LOGO_BOX) } : null,
    facts,
    toLines: [input.ownerName, ...splitLines(input.ownerAddress)].filter((l) => l.trim() !== ""),
    fromLines: [input.businessName],
    summary,
    changes,
    certification:
      "The undersigned contractor certifies that, to the best of its knowledge, the work covered by this application has been completed in accordance with the contract, that all amounts previously paid on account of it have been applied to the work, and that the current payment shown is now due.",
    signatures: [
      { heading: "Contractor", lines: ["Signed", "Date"] },
      { heading: "Owner or architect", lines: ["Amount certified", "Signed", "Date"] },
    ],
    continuation: {
      title: "CONTINUATION SHEET",
      caption: `Application ${input.applicationNumber} · period to ${input.periodTo} · retainage ${ppmToPercentString(input.retainagePpm)}%`,
      unitPriced,
      rows,
      total,
    },
    costs: { rows: costRows, total: costTotal },
    labor: { rows: laborRows, total: laborTotal },
    notes: input.notes.trim(),
    watermark: draft ? "DRAFT" : input.status === "void" ? "VOID" : null,
    footer: `${input.businessName} · ${input.projectNumber} · Application ${input.applicationNumber}`,
  };
}
