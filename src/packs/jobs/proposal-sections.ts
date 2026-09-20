import { formatQuantity } from "./billing-math";
import { formatCents } from "@/lib/money";
import { buildProposalModel, paragraphs, type ProposalInput, type ProposalModel } from "./proposal-model";
import { PROPOSAL_FORMATS, type ProposalFormat } from "./vocabulary";

/**
 * A PROPOSAL AS AN ORDERED LIST OF SECTIONS — pure, no database, no React
 * (E5a, ADR 0083).
 *
 * **A brochure is not a layout problem, it is a page order over facts the pack
 * already holds.** The narrative is the items' own names and notes (ADR 0079),
 * the allowances are the job's selections (ADR 0067), the milestones are its
 * phases (ADR 0071), the price is the money `proposal-model.ts` already
 * decided. So this file decides WHICH pages a format has and WHAT IS ON THEM,
 * and a renderer — the HTML document today, a Chromium print of the same HTML
 * tomorrow — decides only how they look.
 *
 * **THE MONEY HAS ONE SOURCE, STILL.** Every figure comes from
 * `buildProposalModel`; nothing here computes a price. That is the whole reason
 * sections wrap the model rather than replace it — two things that both work
 * out a total is how they come to disagree (ADR 0070's rule, kept).
 *
 * **AND IT STILL NEVER PRINTS COST.** The sections carry prices, quantities and
 * words; unit cost, markup, overhead, profit and margin appear nowhere, and the
 * same scan that guards the model guards the sections.
 */

/** An allowance as the client reads it: what is set aside, and what they chose. */
export interface ProposalAllowance {
  name: string;
  /** "Kitchen tile", "$6,000 allowed" — already formatted. */
  allowance: string;
  /** What they picked, or "" while the decision is still theirs to make. */
  chosen: string;
  /** "Still to choose" / "Chosen" / "By 14 October" — one phrase, never a status word. */
  standing: string;
}

/** A milestone as the client reads it: a stretch of work and when it happens. */
export interface ProposalMilestone {
  name: string;
  /** "3 March – 28 March", or a single date when it is one day. */
  when: string;
  /** The trade or subcontractor, when the phase names one. */
  who: string;
}

export type ProposalSection =
  | { kind: "cover"; title: string; project: string; site: string; toName: string; date: string; businessName: string }
  | { kind: "letter"; paragraphs: string[]; signOff: string }
  | { kind: "facts"; rows: Array<[string, string]> }
  | { kind: "parties"; toLines: string[]; fromLines: string[] }
  | { kind: "text"; title: string; paragraphs: string[] }
  /** The items in their order, with the sentence each carries and no money at all. */
  | { kind: "narrative"; title: string; items: Array<{ name: string; note: string }> }
  | { kind: "price"; price: ProposalModel["price"] }
  | { kind: "allowances"; title: string; intro: string; rows: ProposalAllowance[] }
  | { kind: "milestones"; title: string; intro: string; rows: ProposalMilestone[] }
  | { kind: "acceptance"; words: string; validity: string | null; signatures: ProposalModel["signatures"] }
  /**
   * THE PRICE SHEET: one running list, numbered straight through, with the
   * parts of the bid as rows of their own. The founder's own document, which
   * he described as *"infrastructure, structural etc"* over the client items.
   */
  | { kind: "worksheet"; heading: string; rows: WorksheetRow[]; total: ProposalModel["price"]["total"] };

/**
 * A row of the price sheet. **The number runs through everything including
 * the headings**, because that is how somebody says *"look at 102"* on the
 * phone — which is the whole reason the numbers are there.
 */
export interface WorksheetRow {
  number: number;
  /** A part of the bid rather than a thing in it. No amount of its own. */
  isSection: boolean;
  description: string;
  /** The qualifier beside the name: "As per plans", "Supplied by others". */
  note: string;
  /** Formatted, and blank on a section row. `$0.00` is a real answer. */
  amount: string;
}

/** What the sections need beyond the money: the facts the rest of the pack holds. */
export interface ProposalExtras {
  /** The letter the brochure opens with; blank leaves the page out. */
  letter?: string;
  allowances?: ProposalAllowance[];
  milestones?: ProposalMilestone[];
}

export interface ProposalDocument {
  format: ProposalFormat;
  /** For the tab, the file name and the running footer. */
  title: string;
  model: ProposalModel;
  sections: ProposalSection[];
}

/** The same price, with the row notes dropped because another page has them. */
function withoutRowNotes(price: ProposalModel["price"]): ProposalModel["price"] {
  return {
    ...price,
    rows: price.rows.map((r) => ({ ...r, note: "" })),
  };
}

/** The formats, and the only place the page order lives. */
export function isProposalFormat(v: string): v is ProposalFormat {
  return (PROPOSAL_FORMATS as readonly string[]).includes(v);
}

/**
 * THE PRICE SHEET — the shape the pilot's company has handed clients for
 * years, and the reason the section and the one-price switch exist.
 *
 * **EVERY FIGURE COMES FROM `price.rows`, WHICH IS THE MODEL'S.** This file
 * arranges; it never computes. Rows are taken in the order the model
 * produced them, grouped under the section each item carries, and numbered
 * straight through. An item's own note rides beside its name, which is where
 * *"Supplied by Turkel"* and *"As per plans"* go.
 *
 * **A ROW AT `$0.00` IS PRINTED, NOT DROPPED.** Roughly sixty of the pilot's
 * 195 rows are zero on purpose — *"By Owner"*, *"(N/A)"*, *"Included in
 * Plumbing Quote"* — and they are the document's exclusions, stated where
 * the client reads them. Dropping an item because it costs nothing would
 * throw away the most careful part of the sheet.
 *
 * **AN ITEM WITH NO SECTION GETS ONE WHEN ANYTHING ELSE HAS ONE.** With no
 * sections anywhere the sheet is a plain numbered list, which is every
 * estimate written before they existed and is what it always was. But mixed,
 * an unsectioned item printed under the heading above it READS as part of
 * that section — driving this found `Loft framing` sitting under `FINISHES`
 * having never been put there. So it gets `Other`, the same word the `codes`
 * presentation already uses for money with no code.
 */
export const UNSECTIONED = "Other";

function priceSheetSections(model: ProposalModel, sectionOf: ReadonlyMap<string, string>): ProposalSection[] {
  const rows: WorksheetRow[] = [];
  let n = 0;
  let current: string | null = null;

  const named = (row: ProposalModel["price"]["rows"][number]) =>
    (row.groupId ? sectionOf.get(row.groupId) : "") ?? "";
  /** Only worth heading anything when the sheet actually uses sections. */
  const sectioned = model.price.rows.some((r) => named(r) !== "");

  for (const row of model.price.rows) {
    /** A heading row from the takeoff shape is an ITEM, not a part of the bid. */
    const raw = named(row);
    const section = sectioned && raw === "" ? UNSECTIONED : raw;
    if (section !== (current ?? "")) {
      current = section;
      if (section !== "") {
        n += 1;
        rows.push({ number: n, isSection: true, description: section, note: "", amount: "" });
      }
    }
    n += 1;
    rows.push({
      number: n,
      isSection: false,
      description: row.description,
      note: row.note ?? "",
      amount: row.heading ? "" : row.amount,
    });
  }

  if (model.price.rounding) {
    n += 1;
    rows.push({
      number: n,
      isSection: false,
      description: model.price.rounding.description,
      note: "",
      amount: model.price.rounding.amount,
    });
  }

  return [
    { kind: "parties", toLines: model.toLines, fromLines: model.fromLines },
    { kind: "facts", rows: model.facts },
    { kind: "worksheet", heading: model.price.heading, rows, total: model.price.total },
    ...(model.acceptance
      ? [
          {
            kind: "acceptance" as const,
            words: model.acceptance,
            validity: model.validity,
            signatures: model.signatures,
          },
        ]
      : []),
  ];
}

/**
 * The letter: exactly the document ADR 0070 built, in section form — facts,
 * who it is to and from, the scope, the price, the exclusions, the terms, the
 * acceptance. Nothing was added to it, because nothing about it was wrong.
 */
function letterSections(m: ProposalModel): ProposalSection[] {
  const out: ProposalSection[] = [
    { kind: "facts", rows: m.facts },
    { kind: "parties", toLines: m.toLines, fromLines: m.fromLines },
  ];
  if (m.scope.length > 0) out.push({ kind: "text", title: "Scope of work", paragraphs: m.scope });
  out.push({ kind: "price", price: m.price });
  if (m.exclusions.length > 0) out.push({ kind: "text", title: "Not included", paragraphs: m.exclusions });
  if (m.terms.length > 0) out.push({ kind: "text", title: "Terms", paragraphs: m.terms });
  out.push({ kind: "acceptance", words: m.acceptance, validity: m.validity, signatures: m.signatures });
  return out;
}

/**
 * The brochure: the custom-home document. A cover of its own, a letter in the
 * builder's voice, the narrative of what is being built, the price sheet, what
 * is still to be chosen, when it happens, and the paper at the back.
 *
 * **A page with nothing on it is not printed.** No letter typed, no selections
 * drawn up, no phases scheduled — the section is simply absent rather than a
 * heading over a blank, which is the difference between a document and a
 * template somebody forgot to fill in.
 */
function brochureSections(
  input: ProposalInput,
  m: ProposalModel,
  extras: ProposalExtras,
): ProposalSection[] {
  const letter = paragraphs(extras.letter ?? "");
  const items = (input.groups ?? [])
    .map((g) => ({ name: g.name.trim(), note: g.clientNote.trim() }))
    .filter((i) => i.name !== "");
  const allowances = extras.allowances ?? [];
  const milestones = extras.milestones ?? [];
  const out: ProposalSection[] = [
    {
      kind: "cover",
      title: m.subtitle,
      project: `${input.projectNumber} · ${input.projectName}`,
      site: input.projectAddress.trim(),
      toName: input.toName.trim(),
      date: m.facts.find(([label]) => label === "Date")?.[1] ?? "",
      businessName: input.businessName,
    },
  ];
  if (letter.length > 0) {
    out.push({ kind: "letter", paragraphs: letter, signOff: input.businessName });
  }
  if (m.scope.length > 0) out.push({ kind: "text", title: "The work", paragraphs: m.scope });
  const narrated = items.some((i) => i.note !== "");
  if (items.length > 0) {
    out.push({ kind: "narrative", title: "What is included", items });
  }
  /**
   * **The sentence is printed ONCE.** When the narrative carries the items'
   * notes, the price sheet prints names and money only — the two pages sit
   * next to each other, and reading the same sentence twice is how a document
   * starts to look automatic. Found by reading the first real brochure.
   */
  out.push({ kind: "price", price: narrated ? withoutRowNotes(m.price) : m.price });
  if (allowances.length > 0) {
    out.push({
      kind: "allowances",
      title: "Allowances",
      intro:
        "An allowance is money set aside in the price for something still to be chosen. " +
        "Choose above it and the difference is added; choose below and it comes back.",
      rows: allowances,
    });
  }
  if (milestones.length > 0) {
    out.push({
      kind: "milestones",
      title: "How it goes",
      intro: "The order of the work as it stands today. Dates move with the weather and the trades.",
      rows: milestones,
    });
  }
  if (m.exclusions.length > 0) out.push({ kind: "text", title: "Not included", paragraphs: m.exclusions });
  if (m.terms.length > 0) out.push({ kind: "text", title: "Terms", paragraphs: m.terms });
  out.push({ kind: "acceptance", words: m.acceptance, validity: m.validity, signatures: m.signatures });
  return out;
}

export function buildProposalDocument(
  input: ProposalInput,
  extras: ProposalExtras = {},
  format = "letter",
): ProposalDocument {
  const model = buildProposalModel(input);
  const chosen: ProposalFormat = isProposalFormat(format) ? format : "letter";
  const sectionOf = new Map(
    (input.groups ?? []).map((g) => [g.id, (g.section ?? "").trim()]),
  );
  return {
    format: chosen,
    title: model.subtitle,
    model,
    sections:
      chosen === "brochure"
        ? brochureSections(input, model, extras)
        : chosen === "price_sheet"
          ? priceSheetSections(model, sectionOf)
          : letterSections(model),
  };
}

// ------------------------------------------------- the facts, as the client reads them

/** A selection as an allowance line. Money formatted here so the renderer holds none. */
export function allowanceOf(row: {
  name: string;
  allowanceCents: number;
  chosenLabel: string | null;
  chosenPriceCents: number | null;
  neededBy: string | null;
}): ProposalAllowance {
  const chosen =
    row.chosenLabel === null
      ? ""
      : row.chosenPriceCents === null
        ? row.chosenLabel
        : `${row.chosenLabel} · ${formatCents(row.chosenPriceCents)}`;
  return {
    name: row.name,
    allowance: `${formatCents(row.allowanceCents)} allowed`,
    chosen,
    standing:
      row.chosenLabel !== null
        ? "Chosen"
        : row.neededBy === null
          ? "Still to choose"
          : `Still to choose, by ${row.neededBy}`,
  };
}

/** A phase as a milestone line: one date when it is one day, a span otherwise. */
export function milestoneOf(row: {
  name: string;
  startOn: string;
  endOn: string;
  partyName: string | null;
}): ProposalMilestone {
  return {
    name: row.name,
    when: row.startOn === row.endOn ? row.startOn : `${row.startOn} – ${row.endOn}`,
    who: row.partyName ?? "",
  };
}

/** "320 sf", for a narrative that wants the quantity; the price sheet formats its own. */
export function quantityLabel(quantityThousandths: number, unit: string): string {
  if (quantityThousandths === 1_000 && unit.trim() === "") return "";
  return `${formatQuantity(quantityThousandths)} ${unit.trim()}`.trim();
}
