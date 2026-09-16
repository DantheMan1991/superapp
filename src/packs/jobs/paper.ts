import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { loadInvoiceBrand, withLogoBytes } from "@/modules/accounting/invoicing/invoice-brand";
import { customerForParty } from "@/modules/accounting/invoicing/customers";
import { getProject, listChangeOrders, listCommitmentChangeOrders, listCommitments } from "./ops";
import { getCommitment } from "./sub-billing-ops";
import { buildChangeOrderPaper, buildOrderPaper, type ChangeOrderPaperInput, type OrderPaperInput } from "./paper-model";
import { renderPaperPdf } from "./paper-pdf";
import { slugLabel } from "./vocabulary";

/**
 * From the rows the pack holds to the words the two documents print
 * (ADR 0075): the change order the client signs and the order the vendor
 * signs. The routes call these; the pure models and the layout never see a
 * database row. Both read in ONE transaction and fetch the logo's bytes
 * afterwards, as the proposal does.
 */

type Brand = Awaited<ReturnType<typeof loadInvoiceBrand>>;

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "-");

function contractLabel(kind: string, name: string): string {
  return `${slugLabel(kind)}${name ? ` · ${name}` : ""}`;
}

// ------------------------------------------------------------ the change order

export interface ChangeOrderPaperData {
  input: Omit<ChangeOrderPaperInput, "businessName" | "brand">;
  projectNumber: string;
  number: string;
}

/**
 * The change order, its contract and the client. The contract sum before
 * and after are computed by the pure model from the contract's signed value
 * and every approved change on the same contract, so the ladder of approved
 * changes reads the same here as on the job's page.
 */
export async function loadChangeOrderPaper(tx: Tx, tenantId: string, id: string): Promise<{ data: ChangeOrderPaperData; brand: Brand } | null> {
  const head = await tx
    .select({ contractId: schema.jobChangeOrders.contractId, projectId: schema.jobContracts.projectId })
    .from(schema.jobChangeOrders)
    .innerJoin(schema.jobContracts, and(eq(schema.jobContracts.tenantId, schema.jobChangeOrders.tenantId), eq(schema.jobContracts.id, schema.jobChangeOrders.contractId)))
    .where(and(eq(schema.jobChangeOrders.tenantId, tenantId), eq(schema.jobChangeOrders.id, id)))
    .limit(1);
  if (head.length === 0) return null;
  const project = await getProject(tx, tenantId, head[0].projectId);
  if (!project) return null;
  const rows = await listChangeOrders(tx, tenantId, project.id);
  const row = rows.find((r) => r.changeOrder.id === id);
  if (!row) return null;
  const contract = await tx
    .select({ valueCents: schema.jobContracts.valueCents, counterpartyPartyId: schema.jobContracts.counterpartyPartyId, status: schema.jobContracts.status })
    .from(schema.jobContracts)
    .where(and(eq(schema.jobContracts.tenantId, tenantId), eq(schema.jobContracts.id, row.contract.id)))
    .limit(1);
  const partyId = contract[0]?.counterpartyPartyId ?? project.partyId ?? null;
  let toName = "";
  let toAddress = "";
  if (partyId) {
    const party = await tx
      .select({ name: schema.parties.displayName })
      .from(schema.parties)
      .where(and(eq(schema.parties.tenantId, tenantId), eq(schema.parties.id, partyId)))
      .limit(1);
    toName = party[0]?.name ?? "";
    toAddress = (await customerForParty(tx, tenantId, partyId))?.address ?? "";
  }
  const co = row.changeOrder;
  const input: ChangeOrderPaperData["input"] = {
    toName,
    toAddress,
    projectNumber: project.number,
    projectName: project.name,
    projectAddress: project.address,
    contractLabel: contractLabel(row.contract.kind, row.contract.name),
    contractValueCents: contract[0]?.valueCents ?? null,
    approvedChanges: rows
      .filter((r) => r.contract.id === row.contract.id && r.changeOrder.status === "approved")
      .map((r) => ({ id: r.changeOrder.id, valueCents: r.changeOrder.valueCents, approvedOn: r.changeOrder.approvedOn, createdAt: r.changeOrder.createdAt.toISOString() })),
    id: co.id,
    number: co.number,
    title: co.title,
    description: co.description,
    status: co.status,
    requestedOn: co.requestedOn,
    approvedOn: co.approvedOn,
    createdAt: co.createdAt.toISOString(),
    valueCents: co.valueCents,
  };
  const brand = await loadInvoiceBrand(tx, tenantId, project.entityId);
  return { data: { input, projectNumber: project.number, number: co.number }, brand };
}

export async function renderChangeOrderPaper(loaded: NonNullable<Awaited<ReturnType<typeof loadChangeOrderPaper>>>): Promise<{ bytes: Uint8Array; filename: string }> {
  const brand = await withLogoBytes(loaded.brand);
  const model = buildChangeOrderPaper({
    ...loaded.data.input,
    businessName: loaded.brand.businessName,
    brand: { tagline: brand.tagline, primaryColor: brand.primaryColor, logo: brand.logo },
  });
  const bytes = await renderPaperPdf(model, `Change order ${loaded.data.number} · ${loaded.data.projectNumber}`);
  return { bytes, filename: `change-order-${safe(loaded.data.number)}-${safe(loaded.data.projectNumber)}.pdf` };
}

// ---------------------------------------------------------------- the order

export interface OrderPaperData {
  input: Omit<OrderPaperInput, "businessName" | "brand">;
  projectNumber: string;
  number: string;
  kind: string;
}

/** The order as placed, its changes with where each stands, and the vendor with the address the books hold for them. */
export async function loadOrderPaper(tx: Tx, tenantId: string, id: string): Promise<{ data: OrderPaperData; brand: Brand } | null> {
  const commitment = await getCommitment(tx, tenantId, id);
  if (!commitment) return null;
  const project = await getProject(tx, tenantId, commitment.projectId);
  if (!project) return null;
  const [rows, changes, vendor] = await Promise.all([
    listCommitments(tx, tenantId, project.id),
    listCommitmentChangeOrders(tx, tenantId, project.id),
    tx.query.vendors.findFirst({ where: and(eq(schema.vendors.tenantId, tenantId), eq(schema.vendors.partyId, commitment.partyId)) }),
  ]);
  const row = rows.find((r) => r.commitment.id === commitment.id);
  if (!row) return null;
  // The codes by the lines' own ids, not through the job's code set: a line's code is its code wherever the set sits.
  const codeIds = [...new Set(row.lines.map((l) => l.costCodeId).filter((id): id is string => id !== null))];
  const codes =
    codeIds.length === 0
      ? []
      : await tx
          .select({ id: schema.jobCostCodes.id, code: schema.jobCostCodes.code, name: schema.jobCostCodes.name })
          .from(schema.jobCostCodes)
          .where(and(eq(schema.jobCostCodes.tenantId, tenantId), inArray(schema.jobCostCodes.id, codeIds)));
  const codeLabel = new Map(codes.map((c) => [c.id, `${c.code} · ${c.name}`]));
  const input: OrderPaperData["input"] = {
    vendorName: row.vendorName,
    vendorAddress: vendor?.address ?? "",
    projectNumber: project.number,
    projectName: project.name,
    projectAddress: project.address,
    kind: commitment.kind,
    number: commitment.number,
    description: commitment.description,
    status: commitment.status,
    issuedOn: commitment.issuedOn,
    notes: commitment.notes,
    lines: row.lines.map((l) => ({
      description: l.description,
      codeLabel: l.costCodeId ? (codeLabel.get(l.costCodeId) ?? null) : null,
      amountCents: l.amountCents,
      change: l.change ? { number: l.change.number, status: l.change.status } : null,
    })),
    changes: changes
      .filter((c) => c.commitment.id === commitment.id)
      .map((c) => ({ number: c.changeOrder.number, title: c.changeOrder.title, status: c.changeOrder.status, approvedOn: c.changeOrder.approvedOn, amountCents: c.amountCents })),
  };
  const brand = await loadInvoiceBrand(tx, tenantId, project.entityId);
  return { data: { input, projectNumber: project.number, number: commitment.number, kind: commitment.kind }, brand };
}

export async function renderOrderPaper(loaded: NonNullable<Awaited<ReturnType<typeof loadOrderPaper>>>): Promise<{ bytes: Uint8Array; filename: string }> {
  const brand = await withLogoBytes(loaded.brand);
  const model = buildOrderPaper({
    ...loaded.data.input,
    businessName: loaded.brand.businessName,
    brand: { tagline: brand.tagline, primaryColor: brand.primaryColor, logo: brand.logo },
  });
  const word = loaded.data.kind === "subcontract" ? "subcontract" : "purchase-order";
  const bytes = await renderPaperPdf(model, `${loaded.data.kind === "subcontract" ? "Subcontract" : "Purchase order"} ${loaded.data.number} · ${loaded.data.projectNumber}`);
  return { bytes, filename: `${word}-${safe(loaded.data.number)}-${safe(loaded.data.projectNumber)}.pdf` };
}
