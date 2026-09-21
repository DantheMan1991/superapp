import "server-only";
import type { Tx } from "@/db";
import { printHtmlToPdf } from "@/lib/pdf/print-html";
import { loadInvoiceBrand, withLogoBytes } from "@/modules/accounting/invoicing/invoice-brand";
import type { CertificateBrand } from "./certificate-model";
import { proposalData, type ProposalData } from "./estimating-ops";
import { renderProposalHtml, type ProposalAcceptView } from "./proposal-html";
import type { ProposalInput } from "./proposal-model";
import { renderProposalPdf } from "./proposal-pdf";
import { listSelections } from "./selections-ops";
import { listPhases } from "./schedule-ops";
import {
  allowanceOf,
  buildProposalDocument,
  milestoneOf,
  type ProposalDocument,
  type ProposalExtras,
} from "./proposal-sections";

/**
 * From the rows the pack holds to the words the proposal prints (slice 10b,
 * ADR 0070). The route and any script that wants the same document call
 * this; the pure model and the layout never see a database row.
 */
export function proposalInputFrom(data: ProposalData, brand: CertificateBrand & { businessName: string }): ProposalInput {
  const { row, project, toName, toAddress } = data;
  const e = row.estimate;
  return {
    businessName: brand.businessName,
    brand: { tagline: brand.tagline, primaryColor: brand.primaryColor, logo: brand.logo },
    toName,
    toAddress,
    projectNumber: project.number,
    projectName: project.name,
    projectAddress: project.address,
    number: e.number,
    title: e.title,
    status: e.status,
    sentOn: e.sentOn,
    validUntil: e.validUntil,
    presentation: e.presentation,
    showCodeNumbers: e.showCodeNumbers,
    scope: e.scope,
    exclusions: e.exclusions,
    terms: e.terms,
    markupPpm: e.markupPpm,
    overheadPpm: e.overheadPpm,
    profitPpm: e.profitPpm,
    lines: row.lines.map((l) => ({
      description: l.description,
      clientDescription: l.clientDescription,
      clientVisible: l.clientVisible,
      unit: l.unit,
      quantityThousandths: l.quantityThousandths,
      unitCostCents: l.unitCostCents,
      markupPpm: l.markupPpm,
      unitPriceCents: l.unitPriceCents,
      codeLabel: l.codeLabel,
      codeName: l.codeName,
      groupId: l.groupId,
    })),
    /** The client-facing items (ADR 0079); the prices they carry are the client's. */
    groups: row.groups.map((g) => ({
      id: g.id,
      name: g.name,
      clientNote: g.clientNote,
      section: g.section,
      /** Without this the switch would set on the estimate and do nothing
       *  where it is meant to act — on the document the client reads. */
      showLines: g.showLines,
      priceMode: g.priceMode,
      fixedPriceCents: g.fixedPriceCents,
      /** Without this the client reads a firm price where a choice is owed. */
      isAllowance: g.isAllowance,
    })),
  };
}

/**
 * WHAT THE BROCHURE NEEDS THAT THE LETTER DOES NOT (E5a, ADR 0083): the
 * allowances still to be chosen and the order the work goes in. Both are
 * ordinary reads of facts the pack already keeps — the job's selections (ADR
 * 0067) and its phases (ADR 0071) — which is the whole claim behind the
 * brochure being a page order rather than a new kind of document.
 *
 * Only called for the brochure: the letter has no page for either, so a
 * letterhead proposal costs two queries less.
 */
export async function loadBrochureExtras(
  tx: Tx,
  tenantId: string,
  projectId: string,
  letter: string,
  timeZone: string,
  today: string,
): Promise<ProposalExtras> {
  const [selections, phases] = await Promise.all([
    listSelections(tx, tenantId, projectId, today),
    listPhases(tx, tenantId, projectId, timeZone, today),
  ]);
  return {
    letter,
    allowances: selections
      .filter((r) => r.selection.allowanceCents > 0)
      .map((r) =>
        allowanceOf({
          name: r.selection.name,
          allowanceCents: r.selection.allowanceCents,
          chosenLabel: r.chosen?.description ?? null,
          chosenPriceCents: r.chosen?.priceCents ?? null,
          neededBy: r.selection.neededBy,
        }),
      ),
    milestones: phases.map((r) =>
      milestoneOf({ name: r.phase.name, startOn: r.startOn, endOn: r.endOn, partyName: r.partyName }),
    ),
  };
}

/**
 * The whole document, in sections, for whichever format the estimate names.
 * One call for the page order, the money and the words; the renderer takes it
 * from here.
 */
export function proposalDocumentFrom(
  data: ProposalData,
  brand: CertificateBrand & { businessName: string },
  extras: ProposalExtras = {},
): ProposalDocument {
  return buildProposalDocument(proposalInputFrom(data, brand), extras, data.row.estimate.format);
}

/** The estimate's rows and its company's brand, read in ONE transaction; the logo's bytes come afterwards. */
export async function loadProposal(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<{ data: ProposalData; brand: Awaited<ReturnType<typeof loadInvoiceBrand>> } | null> {
  const data = await proposalData(tx, tenantId, id);
  if (!data) return null;
  const brand = await loadInvoiceBrand(tx, tenantId, data.project.entityId);
  return { data, brand };
}

export type LoadedProposal = NonNullable<Awaited<ReturnType<typeof loadProposal>>> & { extras: ProposalExtras };

/**
 * Everything the document needs, in one transaction — and the SAME read for
 * every door onto it (E5b, ADR 0084). The HTML the browser opens, the PDF the
 * press prints and the link a client will follow all come through here, so
 * there is no way for one of them to be made from a different estimate than
 * another. The brochure's two extra queries are still only the brochure's.
 */
export async function loadProposalDocument(
  tx: Tx,
  tenantId: string,
  id: string,
  timeZone: string,
  today: string,
): Promise<LoadedProposal | null> {
  const loaded = await loadProposal(tx, tenantId, id);
  if (!loaded) return null;
  const e = loaded.data.row.estimate;
  const extras =
    e.format === "brochure"
      ? await loadBrochureExtras(tx, tenantId, e.projectId, e.letter, timeZone, today)
      : {};
  return { ...loaded, extras };
}

/** The brand as both renderers want it, with the logo's bytes fetched once. */
async function brandFor(loaded: LoadedProposal): Promise<CertificateBrand & { businessName: string }> {
  const brand = await withLogoBytes(loaded.brand);
  return {
    businessName: loaded.brand.businessName,
    tagline: brand.tagline,
    primaryColor: brand.primaryColor,
    logo: brand.logo,
  };
}

function htmlOf(
  loaded: LoadedProposal,
  brand: CertificateBrand & { businessName: string },
  accept?: ProposalAcceptView,
): string {
  return renderProposalHtml(proposalDocumentFrom(loaded.data, brand, loaded.extras), brand, accept);
}

function proposalFilename(data: ProposalData): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "-");
  return `proposal-${safe(data.row.estimate.number)}-${safe(data.project.number)}.pdf`;
}

/**
 * The document as the page a browser opens, and what the press is handed.
 *
 * `accept` is the client link's reply card (E5c, ADR 0085) and is the ONLY
 * thing that differs between the three doors. It is screen-only, so the
 * document itself — and therefore any PDF of it — is the same whoever asks.
 */
export async function proposalHtml(
  loaded: LoadedProposal,
  accept?: ProposalAcceptView,
): Promise<string> {
  return htmlOf(loaded, await brandFor(loaded), accept);
}

/**
 * THE PROPOSAL AS A FILE, AND THE FORMAT PICKS THE ENGINE (E5b, ADR 0084).
 *
 * A letter is the react-pdf document ADR 0070 built and is untouched: it costs
 * nothing, needs no browser, and prints the same as it has since it shipped. A
 * brochure is HTML, so a browser prints it — and **the string handed to the
 * press is the very same `htmlOf` the page serves**, not a second rendering of
 * it, which is what makes "one document, three doors" a fact about the code
 * rather than an intention.
 *
 * Before this, every format printed the letter, so a brochure's `Print
 * proposal` quietly handed back the plain letterhead document.
 */
export async function proposalPdf(loaded: LoadedProposal): Promise<{ bytes: Uint8Array; filename: string }> {
  const brand = await brandFor(loaded);
  /**
   * **EVERY FORMAT WITH A LAYOUT OF ITS OWN PRINTS THROUGH ITS OWN HTML.**
   * The letter has a react-pdf renderer because it predates the HTML one;
   * the brochure and the price sheet do not, and writing each a second
   * layout is how two documents that should be identical stop being so.
   * The price of that is the Chromium pack — see the runbook, and the open
   * item in this module's dossier.
   */
  const viaHtml = loaded.data.row.estimate.format !== "letter";
  const bytes = viaHtml
    ? await printHtmlToPdf(htmlOf(loaded, brand))
    : await renderProposalPdf(proposalInputFrom(loaded.data, brand));
  return { bytes, filename: proposalFilename(loaded.data) };
}
