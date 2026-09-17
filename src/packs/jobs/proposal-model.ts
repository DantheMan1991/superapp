import { fitLogo, readableOnWhite, type HexColor } from "@/lib/brand/core";
import { formatCents } from "@/lib/money";
import { formatQuantity } from "./billing-math";
import type { CertificateBrand } from "./certificate-model";
import {
  estimateTotals,
  scheduleFromEstimate,
  scheduleRows,
  type EstimateGroupFigures,
  type EstimateLineFigures,
} from "./estimate-math";

/**
 * AN ESTIMATE AS THE PROPOSAL THE CLIENT IS SENT — pure, no database, no
 * React (slice 10b, ADR 0070). The same split as the pay application's
 * certificate: every word and figure on the page is decided here and
 * table-tested; `proposal-pdf.tsx` is a layout file with no arithmetic.
 *
 * **THE PROPOSAL SHOWS PRICES, NEVER COST.** Every line prints at its
 * price with the estimate's overhead and profit spread into it — the same
 * spread the schedule of values takes (`scheduleFromEstimate`), so the lines
 * add up to the total the contract will be signed at, and a line sold by
 * the unit prints its raised unit price and bills the same way. The unit
 * cost, the markup, the overhead, the profit and the margin appear nowhere;
 * a pure test scans for the words.
 *
 * **THREE WAYS TO SHOW THE PRICE**, the business's choice per estimate: line
 * by line (a takeoff or a unit-price bid), by cost code (a summary a
 * custom-home client reads), or one sum (a remodeler's lump price). The
 * total is the same in all three.
 *
 * All money arrives as integer cents and leaves as a formatted string.
 */

export interface ProposalLineInput extends EstimateLineFigures {
  description: string;
  /** What the client reads instead (ADR 0080); blank uses the description. */
  clientDescription?: string;
  unit: string;
  /** "03 30 00 · Cast-in-place concrete", or null for a line with no code. */
  codeLabel: string | null;
  /** The same code without its number — "Cast-in-place concrete". */
  codeName?: string | null;
}

/** A client-facing item on the proposal (ADR 0079): its name, its paragraph, its price rule. */
export interface ProposalGroupInput extends EstimateGroupFigures {
  name: string;
  clientNote: string;
}

export interface ProposalInput {
  businessName: string;
  brand?: CertificateBrand;
  /** The client the proposal is made to: the contract's counterparty, else the job's client. */
  toName: string;
  /** Free-text postal address; may hold newlines. */
  toAddress: string;
  projectNumber: string;
  projectName: string;
  /** The site, if the job carries one. */
  projectAddress: string;
  number: string;
  title: string;
  status: string;
  sentOn: string | null;
  validUntil: string | null;
  /** "lines" | "codes" | "sum" — how the price is shown. */
  presentation: string;
  scope: string;
  exclusions: string;
  terms: string;
  markupPpm: number;
  overheadPpm: number;
  profitPpm: number;
  lines: ProposalLineInput[];
  /** The client-facing items, in their order; empty on an estimate of loose lines. */
  groups?: ProposalGroupInput[];
  /**
   * Whether the `codes` presentation prints a cost code's NUMBER beside its
   * name (ADR 0080). Off by default: the number is an internal accounting key
   * and a homeowner reading `09 30 00` learns nothing.
   */
  showCodeNumbers?: boolean;
}

export interface ProposalRow {
  description: string;
  /** "120 cy", or "" on a lump sum. */
  quantity: string;
  /** The price per unit on a line sold by the unit, else "". */
  unitPrice: string;
  amount: string;
  /** The item's paragraph, under its name; "" on a line and on a heading. */
  note?: string;
  /** An item's name over the lines beneath it: no amount, and no money of its own. */
  heading?: boolean;
}

export interface ProposalModel {
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
  /** The scope, paragraph by paragraph; empty when nothing was written. */
  scope: string[];
  price: {
    heading: string;
    /** Which columns the rows need. */
    columns: { quantity: boolean; unitPrice: boolean };
    rows: ProposalRow[];
    /** The cents the rounding of unit prices leaves, so the rows still add to the total; null when they do. */
    rounding: ProposalRow | null;
    total: { label: string; amount: string };
  };
  exclusions: string[];
  terms: string[];
  /** "This proposal is valid until 2026-10-15.", or null. */
  validity: string | null;
  acceptance: string;
  signatures: Array<{ heading: string; lines: string[] }>;
  watermark: string | null;
  footer: string;
}

/** The ink the proposal uses without a brand colour, the invoice's. */
export const PROPOSAL_INK: HexColor = "#111827";
export const PROPOSAL_LOGO_BOX = { width: 140, height: 48 } as const;

function money(cents: number): string {
  return formatCents(cents);
}

/** Every typed line is its own paragraph, trimmed, blanks dropped — so a list of exclusions stays a list. */
export function paragraphs(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

const splitLines = paragraphs;

const STATUS_WATERMARK: Record<string, string> = {
  draft: "DRAFT",
  declined: "DECLINED",
  superseded: "SUPERSEDED",
};

export function buildProposalModel(input: ProposalInput): ProposalModel {
  const primary = input.brand?.primaryColor ?? null;
  const logo = input.brand?.logo ?? null;
  const terms = { markupPpm: input.markupPpm, overheadPpm: input.overheadPpm, profitPpm: input.profitPpm };
  const groups = input.groups ?? [];
  const totals = estimateTotals(input.lines, terms, groups);
  const schedule = scheduleFromEstimate(input.lines, terms, groups);

  // ---- the price, four ways
  let rows: ProposalRow[] = [];
  let rounding: ProposalRow | null = null;
  const columns = { quantity: false, unitPrice: false };
  const quantityOf = (thousandths: number | null, unit: string): string => {
    if (thousandths === null) return "";
    if (thousandths === 1000 && unit.trim() === "") return "";
    return `${formatQuantity(thousandths)} ${unit.trim()}`.trim();
  };
  if (input.presentation === "lines" || input.presentation === "groups") {
    // `groups` shows one row per item; `lines` shows a takeoff, where an item priced
    // by hand still shows as one row — its build-up was never the client's (ADR 0079).
    const scheduled = scheduleRows(
      input.lines.map((l) => ({ ...l, costCodeId: null })),
      terms,
      groups,
      input.presentation === "groups" ? "group" : "detail",
    );
    const noteOf = new Map(groups.map((g) => [g.id, g.clientNote.trim()]));
    rows = scheduled.map((r) => {
      const quantity = r.heading ? "" : quantityOf(r.lineQuantityThousandths, r.unit);
      const unitPrice = r.unitPriceCents === null ? "" : money(r.unitPriceCents);
      if (quantity) columns.quantity = true;
      if (unitPrice) columns.unitPrice = true;
      return {
        description: r.description,
        quantity,
        unitPrice,
        amount: r.heading ? "" : money(r.scheduledCents),
        note: r.groupId === null ? "" : (noteOf.get(r.groupId) ?? ""),
        heading: r.heading,
      };
    });
    const shown = scheduled.reduce((sum, r) => (r.heading ? sum : sum + r.scheduledCents), 0);
    if (shown !== totals.totalCents) {
      rounding = { description: "Rounding", quantity: "", unitPrice: "", amount: money(totals.totalCents - shown) };
    }
  } else if (input.presentation === "codes") {
    const groups = new Map<string, number>();
    let other = 0;
    // The number is an accounting key, so it prints only when the business asks (ADR 0080).
    const labelOf = (l: ProposalLineInput): string | null =>
      input.showCodeNumbers ? l.codeLabel : (l.codeName ?? l.codeLabel);
    input.lines.forEach((l, i) => {
      const label = labelOf(l);
      if (label === null) other += schedule[i].scheduledCents;
      else groups.set(label, (groups.get(label) ?? 0) + schedule[i].scheduledCents);
    });
    rows = [...groups.entries()].map(([label, cents]) => ({ description: label, quantity: "", unitPrice: "", amount: money(cents) }));
    if (other > 0 || (rows.length === 0 && input.lines.length > 0)) {
      rows.push({ description: "Other", quantity: "", unitPrice: "", amount: money(other) });
    }
    const shown = rows.length === 0 ? totals.totalCents : [...groups.values()].reduce((s, c) => s + c, 0) + other;
    if (shown !== totals.totalCents) {
      rounding = { description: "Rounding", quantity: "", unitPrice: "", amount: money(totals.totalCents - shown) };
    }
  }
  // "sum": no rows — the total line is the price.

  const draft = input.status === "draft";
  const facts: Array<[string, string]> = [
    ["Project", `${input.projectNumber} · ${input.projectName}`],
    ...(input.projectAddress.trim() ? [["Site", input.projectAddress.trim()] as [string, string]] : []),
    ["Proposal no.", input.number],
    ["Date", input.sentOn ?? (draft ? "Not yet sent" : "—")],
    ["Valid until", input.validUntil ?? "—"],
  ];

  return {
    title: "PROPOSAL",
    subtitle: input.title.trim() || `Proposal ${input.number}`,
    businessName: input.businessName,
    tagline: input.brand?.tagline.trim() ?? "",
    titleColor: primary ? readableOnWhite(primary, PROPOSAL_INK) : PROPOSAL_INK,
    ruleColor: primary ?? PROPOSAL_INK,
    logo: logo ? { data: logo.data, format: logo.format, ...fitLogo(logo, PROPOSAL_LOGO_BOX) } : null,
    facts,
    toLines: [input.toName, ...splitLines(input.toAddress)].filter((l) => l.trim() !== ""),
    fromLines: [input.businessName],
    scope: paragraphs(input.scope),
    price: {
      heading: input.presentation === "sum" ? "PRICE" : "THE PRICE",
      columns,
      rows,
      rounding,
      total: { label: input.presentation === "sum" ? "Price for the work described" : "Total", amount: money(totals.totalCents) },
    },
    exclusions: paragraphs(input.exclusions),
    terms: paragraphs(input.terms),
    validity: input.validUntil ? `This proposal is valid until ${input.validUntil}.` : null,
    acceptance: `Signing below accepts this proposal and authorises ${input.businessName} to proceed with the work described, on the terms above.`,
    signatures: [
      { heading: `Accepted for ${input.toName.trim() || "the client"}`, lines: ["Signed", "Name", "Date"] },
      { heading: `For ${input.businessName}`, lines: ["Signed", "Date"] },
    ],
    watermark: STATUS_WATERMARK[input.status] ?? null,
    footer: `${input.businessName} · Proposal ${input.number} · ${input.projectNumber}`,
  };
}
