import { fitLogo, readableOnWhite, type HexColor } from "@/lib/brand/core";
import { formatCents } from "@/lib/money";
import type { CertificateBrand } from "./certificate-model";
import { paragraphs } from "./proposal-model";
import { CHANGE_ORDER_STATUS_LABELS, COMMITMENT_KIND_LABELS, isChangeOrderStatus, isCommitmentKind } from "./vocabulary";

/**
 * PAPER FOR THE OUTSIDE (ADR 0075): the client's change order and the
 * issued order, as the documents somebody signs. Pure — no database, no
 * React — the same split as the proposal and the certificate: every word
 * and figure on the page is decided here and table-tested, and
 * `paper-pdf.tsx` is one layout both documents share.
 *
 * **THE CHANGE ORDER SHOWS ITS PRICE, NEVER ITS COST.** A change order
 * carries lines by cost code that say what the change is expected to COST
 * the business; the client sees the price, the contract sum before it and
 * the contract sum after it. The lines, the codes and the word cost appear
 * nowhere; a pure test scans for the words, as the proposal's does.
 *
 * **THE ORDER PRINTS AS PLACED, WITH ITS CHANGES BENEATH IT.** An issued
 * order's lines are locked (ADR 0065), so printing the live rows prints the
 * agreement; each change order on it is listed with its amount and where it
 * stands, and only the approved ones are in the total.
 */

export interface PaperColumn {
  label: string;
  align: "left" | "right";
  /** Points, or undefined for the column that takes the rest. */
  width?: number;
}

export interface PaperTable {
  heading: string;
  columns: PaperColumn[];
  rows: string[][];
  /** The line under the rows, in the last column. */
  total: { label: string; amount: string } | null;
}

export interface PaperModel {
  title: string;
  subtitle: string;
  businessName: string;
  tagline: string;
  titleColor: HexColor;
  logo: CertificateBrand["logo"];
  facts: Array<[string, string]>;
  toLabel: string;
  toLines: string[];
  fromLines: string[];
  /** Sections in print order: a heading and its paragraphs; empty ones are dropped by the builder. */
  sections: Array<{ title: string; paragraphs: string[] }>;
  table: PaperTable | null;
  /** The money in one block: label and amount, the strong row the sum. */
  sums: Array<{ label: string; amount: string; strong: boolean }>;
  closing: string;
  signatures: Array<{ heading: string; lines: string[] }>;
  watermark: string | null;
  footer: string;
}

export const PAPER_INK: HexColor = "#111827";
export const PAPER_LOGO_BOX = { width: 140, height: 48 } as const;

function money(cents: number): string {
  return formatCents(cents);
}

/** "+$1,200.00" for money that moves a sum, "−$300.00" when it takes away, "$0.00" for nothing. */
export function signedMoney(cents: number): string {
  if (cents > 0) return `+${formatCents(cents)}`;
  if (cents < 0) return `−${formatCents(-cents)}`;
  return formatCents(0);
}

function brandOf(brand: CertificateBrand | undefined): Pick<PaperModel, "tagline" | "titleColor" | "logo"> {
  const primary = brand?.primaryColor ?? null;
  const logo = brand?.logo ?? null;
  return {
    tagline: brand?.tagline.trim() ?? "",
    titleColor: primary ? readableOnWhite(primary, PAPER_INK) : PAPER_INK,
    logo: logo ? { data: logo.data, format: logo.format, ...fitLogo(logo, PAPER_LOGO_BOX) } : null,
  };
}

// ------------------------------------------------------------ the change order

export interface ApprovedChange {
  id: string;
  valueCents: number;
  approvedOn: string | null;
  createdAt: string;
}

export interface ChangeOrderPaperInput {
  businessName: string;
  brand?: CertificateBrand;
  /** The contract's counterparty, else the job's client. */
  toName: string;
  toAddress: string;
  projectNumber: string;
  projectName: string;
  projectAddress: string;
  /** "Construction · Main house" — the contract this changes. */
  contractLabel: string;
  /** The contract's signed value; null when it has none (a cost-plus contract, say). */
  contractValueCents: number | null;
  /** Every APPROVED change order on the same contract, this one included when it is approved. */
  approvedChanges: ApprovedChange[];
  id: string;
  number: string;
  title: string;
  description: string;
  status: string;
  requestedOn: string | null;
  approvedOn: string | null;
  createdAt: string;
  valueCents: number;
}

/**
 * The contract sum this change order sits on. For an approved change, the
 * signed value plus the approved changes that came before it — by the day
 * they were approved, then by which was raised first — so a stack of
 * approved changes reads as a ladder, each one's "after" the next one's
 * "before". For a change not yet approved, the signed value plus every
 * approved change: the sum as it stands the day the client reads it.
 */
export function contractSumBefore(input: Pick<ChangeOrderPaperInput, "contractValueCents" | "approvedChanges" | "id" | "status" | "approvedOn" | "createdAt">): number | null {
  if (input.contractValueCents === null) return null;
  const before = input.approvedChanges.filter((c) => {
    if (c.id === input.id) return false;
    if (input.status !== "approved") return true;
    const mine = input.approvedOn ?? "";
    const theirs = c.approvedOn ?? "";
    if (theirs !== mine) return theirs < mine;
    return c.createdAt < input.createdAt;
  });
  return input.contractValueCents + before.reduce((s, c) => s + c.valueCents, 0);
}

const CHANGE_WATERMARK: Record<string, string> = {
  proposed: "PROPOSED",
  declined: "DECLINED",
  void: "VOID",
};

export function buildChangeOrderPaper(input: ChangeOrderPaperInput): PaperModel {
  const statusWord = isChangeOrderStatus(input.status) ? CHANGE_ORDER_STATUS_LABELS[input.status] : input.status;
  const before = contractSumBefore(input);
  const sums: PaperModel["sums"] =
    before === null
      ? [{ label: "This change", amount: signedMoney(input.valueCents), strong: true }]
      : [
          { label: "Contract sum before this change", amount: money(before), strong: false },
          { label: "This change", amount: signedMoney(input.valueCents), strong: false },
          { label: "Contract sum after this change", amount: money(before + input.valueCents), strong: true },
        ];
  const facts: Array<[string, string]> = [
    ["Project", `${input.projectNumber} · ${input.projectName}`],
    ...(input.projectAddress.trim() ? [["Site", input.projectAddress.trim()] as [string, string]] : []),
    ["Contract", input.contractLabel],
    ["Change order no.", input.number],
    ["Requested", input.requestedOn ?? "—"],
    [input.status === "approved" ? "Approved" : "Status", input.status === "approved" ? (input.approvedOn ?? "—") : statusWord],
  ];
  const approved = input.status === "approved";
  return {
    title: "CHANGE ORDER",
    subtitle: input.title.trim() ? `${input.number} · ${input.title.trim()}` : `Change order ${input.number}`,
    businessName: input.businessName,
    ...brandOf(input.brand),
    facts,
    toLabel: "TO",
    toLines: [input.toName, ...paragraphs(input.toAddress)].filter((l) => l.trim() !== ""),
    fromLines: [input.businessName],
    sections: [{ title: "THE CHANGE", paragraphs: paragraphs(input.description) }].filter((s) => s.paragraphs.length > 0),
    table: null,
    sums,
    closing: approved
      ? `This change order was approved on ${input.approvedOn ?? "the date recorded"} and is part of the contract between ${input.toName.trim() || "the client"} and ${input.businessName}.`
      : `Signing below approves this change to the contract between ${input.toName.trim() || "the client"} and ${input.businessName}, and authorises the work described at the price shown.`,
    signatures: [
      { heading: `Approved for ${input.toName.trim() || "the client"}`, lines: ["Signed", "Name", "Date"] },
      { heading: `For ${input.businessName}`, lines: ["Signed", "Date"] },
    ],
    watermark: CHANGE_WATERMARK[input.status] ?? null,
    footer: `${input.businessName} · Change order ${input.number} · ${input.projectNumber}`,
  };
}

// ---------------------------------------------------------------- the order

export interface OrderPaperLine {
  description: string;
  /** "03 30 00 · Cast-in-place concrete", or null. */
  codeLabel: string | null;
  amountCents: number;
  /** The change order the line belongs to, or null for a line the order was placed with. */
  change: { number: string; status: string } | null;
}

export interface OrderPaperChange {
  number: string;
  title: string;
  status: string;
  approvedOn: string | null;
  /** The change's lines summed, signed. */
  amountCents: number;
}

export interface OrderPaperInput {
  businessName: string;
  brand?: CertificateBrand;
  vendorName: string;
  vendorAddress: string;
  projectNumber: string;
  projectName: string;
  projectAddress: string;
  /** "purchase_order" | "subcontract". */
  kind: string;
  number: string;
  description: string;
  status: string;
  issuedOn: string | null;
  /** The order's notes print as its terms. */
  notes: string;
  lines: OrderPaperLine[];
  changes: OrderPaperChange[];
}

const ORDER_WATERMARK: Record<string, string> = {
  draft: "DRAFT",
  cancelled: "CANCELLED",
};

export function buildOrderPaper(input: OrderPaperInput): PaperModel {
  const kindWord = isCommitmentKind(input.kind) ? COMMITMENT_KIND_LABELS[input.kind] : "Order";
  const placed = input.lines.filter((l) => l.change === null);
  const placedCents = placed.reduce((s, l) => s + l.amountCents, 0);
  const approvedCents = input.changes.filter((c) => c.status === "approved").reduce((s, c) => s + c.amountCents, 0);
  const hasCodes = placed.some((l) => l.codeLabel !== null);
  const table: PaperTable = {
    heading: "THE ORDER",
    columns: [
      { label: "ITEM", align: "left" },
      ...(hasCodes ? [{ label: "COST CODE", align: "left" as const, width: 150 }] : []),
      { label: "AMOUNT", align: "right", width: 90 },
    ],
    rows: placed.map((l) => [l.description || "—", ...(hasCodes ? [l.codeLabel ?? ""] : []), money(l.amountCents)]),
    total: { label: "Order as placed", amount: money(placedCents) },
  };
  const changesSection = {
    title: "CHANGE ORDERS ON THIS ORDER",
    paragraphs: input.changes.map((c) => {
      const stands =
        c.status === "approved" ? `approved${c.approvedOn ? ` ${c.approvedOn}` : ""}` : isChangeOrderStatus(c.status) ? CHANGE_ORDER_STATUS_LABELS[c.status].toLowerCase() : c.status;
      return `${c.number} · ${c.title}: ${signedMoney(c.amountCents)} (${stands})`;
    }),
  };
  const sums: PaperModel["sums"] =
    input.changes.length === 0
      ? [{ label: `${kindWord} total`, amount: money(placedCents), strong: true }]
      : [
          { label: "Order as placed", amount: money(placedCents), strong: false },
          { label: "Approved changes", amount: signedMoney(approvedCents), strong: false },
          { label: `${kindWord} total`, amount: money(placedCents + approvedCents), strong: true },
        ];
  const facts: Array<[string, string]> = [
    ["Project", `${input.projectNumber} · ${input.projectName}`],
    ...(input.projectAddress.trim() ? [["Site", input.projectAddress.trim()] as [string, string]] : []),
    ["Order no.", input.number],
    ["Issued", input.issuedOn ?? (input.status === "draft" ? "Not yet issued" : "—")],
  ];
  return {
    title: kindWord.toUpperCase(),
    subtitle: input.description.trim() ? `${input.number} · ${input.description.trim()}` : `${kindWord} ${input.number}`,
    businessName: input.businessName,
    ...brandOf(input.brand),
    facts,
    toLabel: input.kind === "subcontract" ? "SUBCONTRACTOR" : "VENDOR",
    toLines: [input.vendorName, ...paragraphs(input.vendorAddress)].filter((l) => l.trim() !== ""),
    fromLines: [input.businessName],
    sections: [changesSection, { title: "TERMS", paragraphs: paragraphs(input.notes) }].filter((s) => s.paragraphs.length > 0),
    table,
    sums,
    closing:
      input.kind === "subcontract"
        ? `Signing below accepts this subcontract for the work described at the amounts shown, on the terms above, between ${input.vendorName.trim() || "the subcontractor"} and ${input.businessName}.`
        : `This purchase order is issued by ${input.businessName} to ${input.vendorName.trim() || "the vendor"} for the items described at the amounts shown, on the terms above.`,
    signatures:
      input.kind === "subcontract"
        ? [
            { heading: `Accepted for ${input.vendorName.trim() || "the subcontractor"}`, lines: ["Signed", "Name", "Date"] },
            { heading: `For ${input.businessName}`, lines: ["Signed", "Date"] },
          ]
        : [{ heading: `For ${input.businessName}`, lines: ["Signed", "Date"] }],
    watermark: ORDER_WATERMARK[input.status] ?? null,
    footer: `${input.businessName} · ${kindWord} ${input.number} · ${input.projectNumber}`,
  };
}
