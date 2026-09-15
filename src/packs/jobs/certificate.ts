import "server-only";
import { formatCents } from "@/lib/money";
import type { Tx } from "@/db";
import {
  loadInvoiceBrand,
  withLogoBytes,
} from "@/modules/accounting/invoicing/invoice-brand";
import { ppmToPercentString } from "./billing-math";
import type { CertificateBrand, CertificateInput, CertificateMethod } from "./certificate-model";
import { renderCertificatePdf } from "./certificate-pdf";
import { costPlusTerms, payApplicationCertificate, type CertificateData } from "./ops";
import { billsTheLedger, isTimeAndMaterialsMethod, slugLabel } from "./vocabulary";

/**
 * From the rows the pack holds to the words the certificate prints (slice
 * 5e, ADR 0063). The route and any script that wants the same document call
 * this; the pure model and the layout never see a database row.
 */
export function certificateInputFrom(
  data: CertificateData,
  brand: CertificateBrand & { businessName: string },
): CertificateInput {
  const { app, contract, project, row, previous, changeOrders, ownerName, ownerAddress } = data;
  const tm = isTimeAndMaterialsMethod(contract.billingMethod);
  const method: CertificateMethod = tm
    ? "time_and_materials"
    : billsTheLedger(contract.billingMethod)
      ? "cost_plus"
      : "fixed";
  const terms = costPlusTerms(contract);
  const feeWords = [
    terms.feePpm ? `${ppmToPercentString(terms.feePpm)}% ${tm ? "on" : "of"} cost` : null,
    terms.feeCents ? `fixed ${formatCents(terms.feeCents)}` : null,
  ]
    .filter(Boolean)
    .join(" + ");

  return {
    businessName: brand.businessName,
    brand: { tagline: brand.tagline, primaryColor: brand.primaryColor, logo: brand.logo },
    ownerName,
    ownerAddress,
    projectNumber: project.number,
    projectName: project.name,
    contractTitle: `${slugLabel(contract.kind)}${contract.name ? ` · ${contract.name}` : ""}`,
    contractSignedOn: contract.signedOn,
    method,
    originalCents: method === "fixed" ? contract.valueCents : terms.gmaxCents,
    retainagePpm: app.retainagePpm,
    applicationNumber: app.number,
    periodTo: app.periodTo,
    issuedOn: app.issuedOn,
    status: app.status,
    notes: app.notes,
    previousPeriodTo: previous?.periodTo ?? null,
    totals: {
      completedToDateCents: row.totals.completedToDateCents,
      retainageCents: row.totals.retainageCents,
      earnedLessRetainageCents: row.totals.earnedLessRetainageCents,
      previousCertificatesCents: row.totals.previousCertificatesCents,
      dueCents: row.totals.dueCents,
      ...(row.costPlus
        ? {
            laborToDateCents: row.costPlus.laborToDateCents,
            costToDateCents: row.costPlus.costToDateCents,
            feeToDateCents: row.costPlus.feeToDateCents,
            capped: row.costPlus.capped,
          }
        : {}),
    },
    changeOrders: changeOrders.map((r) => ({
      number: r.changeOrder.number,
      title: r.changeOrder.title,
      valueCents: r.changeOrder.valueCents,
      approvedOn: r.changeOrder.approvedOn,
    })),
    lines: row.lines.map((l) => ({
      description: l.description,
      // A draft reads the schedule as it is now; an issued application, what it froze.
      scheduledCents: app.status === "draft" ? l.sovScheduledCents : l.scheduledCents,
      previousCents: l.previousCents,
      thisPeriodCents: l.thisPeriodCents,
      storedCents: l.storedCents,
    })),
    costs: row.costs.map((c) => ({
      label: c.code ? `${c.code} · ${c.name}` : "No cost code",
      ledgerToDateCents: c.ledgerToDateCents,
      previousCents: c.previousCents,
      thisPeriodCents: c.thisPeriodCents,
    })),
    labor: row.labor.map((l) => ({
      name: l.name,
      rateCents: l.rateCents,
      minutesToDate: l.minutesToDate,
      previousMinutes: l.previousMinutes,
      thisPeriodMinutes: l.thisPeriodMinutes,
      previousCents: l.previousCents,
      thisPeriodCents: l.thisPeriodCents,
    })),
    feeWords,
  };
}

/**
 * The application's rows and its company's brand, read in ONE transaction.
 * The logo's bytes are fetched afterwards by the caller (`withLogoBytes`), a
 * blob read being a network call that has no business inside a transaction.
 */
export async function loadCertificate(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<{ data: CertificateData; brand: Awaited<ReturnType<typeof loadInvoiceBrand>> } | null> {
  const data = await payApplicationCertificate(tx, tenantId, id);
  if (!data) return null;
  const brand = await loadInvoiceBrand(tx, tenantId, data.project.entityId);
  return { data, brand };
}

/** The bytes of the certificate for a loaded application: the model, then the pages. */
export async function renderCertificate(
  loaded: NonNullable<Awaited<ReturnType<typeof loadCertificate>>>,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const brand = await withLogoBytes(loaded.brand);
  const bytes = await renderCertificatePdf(
    certificateInputFrom(loaded.data, {
      businessName: loaded.brand.businessName,
      tagline: brand.tagline,
      primaryColor: brand.primaryColor,
      logo: brand.logo,
    }),
  );
  const safeProject = loaded.data.project.number.replace(/[^A-Za-z0-9._-]/g, "-");
  return { bytes, filename: `application-${loaded.data.app.number}-${safeProject}.pdf` };
}
