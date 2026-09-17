import "server-only";
import type { Tx } from "@/db";
import { loadInvoiceBrand, withLogoBytes } from "@/modules/accounting/invoicing/invoice-brand";
import type { CertificateBrand } from "./certificate-model";
import { proposalData, type ProposalData } from "./estimating-ops";
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
      priceMode: g.priceMode,
      fixedPriceCents: g.fixedPriceCents,
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

/** The bytes of the proposal for a loaded estimate: the model, then the page. */
export async function renderProposal(
  loaded: NonNullable<Awaited<ReturnType<typeof loadProposal>>>,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const brand = await withLogoBytes(loaded.brand);
  const bytes = await renderProposalPdf(
    proposalInputFrom(loaded.data, {
      businessName: loaded.brand.businessName,
      tagline: brand.tagline,
      primaryColor: brand.primaryColor,
      logo: brand.logo,
    }),
  );
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "-");
  return { bytes, filename: `proposal-${safe(loaded.data.row.estimate.number)}-${safe(loaded.data.project.number)}.pdf` };
}
