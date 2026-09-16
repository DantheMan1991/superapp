import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { allowsWrite } from "@/lib/packs/authorize";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge, type StatusTone } from "@/packs/jobs/components/status-badge";
import { ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney, formatMoneySign } from "@/lib/money";
import {
  actualByProject,
  committedTotals,
  getProject,
  listChangeOrders,
  listCommitments,
  listContracts,
  listCostCodes,
} from "@/packs/jobs/ops";
import { commitmentBilling } from "@/packs/jobs/sub-billing-ops";
import { waiverCoverage, waiverGaps } from "@/packs/jobs/compliance-ops";
import { CommitmentForm } from "@/packs/jobs/components/commitment-form";
import { contractSummary } from "@/packs/jobs/contract-math";
import {
  COMMITMENT_KIND_LABELS,
  COMMITMENT_STATUS_LABELS,
  COMMITTED_STATUSES,
  isCommitmentKind,
  isCommitmentStatus,
} from "@/packs/jobs/vocabulary";

/**
 * Ordered: every commitment on the job — what has been ordered, what has been
 * billed against it, and what is still owed the subcontractor.
 *
 * Lifted out of the project page's flat panel stack unchanged (jobs redesign
 * 2a). The job's identity, its vitals and the section strip are the layout's.
 */
export default async function OrderedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "jobs");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const project = await getProject(tx, ctx.tenant.id, id);
      if (!project) return null;
      const [
        codes,
        contracts,
        commitments,
        changeOrders,
        subBilling,
        waiverGapList,
        waiverCover,
        parties,
        committed,
        actual,
      ] = await Promise.all([
        project.costCodeSetId
          ? listCostCodes(tx, ctx.tenant.id, project.costCodeSetId)
          : Promise.resolve([]),
        listContracts(tx, ctx.tenant.id, project.id),
        listCommitments(tx, ctx.tenant.id, project.id),
        listChangeOrders(tx, ctx.tenant.id, project.id),
        commitmentBilling(tx, ctx.tenant.id, project.id),
        waiverGaps(tx, ctx.tenant.id, project.id),
        waiverCoverage(tx, ctx.tenant.id, project.id),
        tx
          .select({ id: schema.parties.id, name: schema.parties.displayName })
          .from(schema.parties)
          .where(eq(schema.parties.tenantId, ctx.tenant.id))
          .limit(500),
        committedTotals(tx, ctx.tenant.id),
        actualByProject(tx, ctx.tenant.id, { kind: "one", entityId: project.entityId }),
      ]);
      return {
        project,
        codes,
        contracts,
        commitments,
        changeOrders,
        subBilling,
        waiverGaps: waiverGapList,
        waiverCoverage: waiverCover,
        parties,
        committed,
        actual,
      };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { project, contracts, commitments } = data;
  const isOwner = allowsWrite(ctx.role, "owner");
  const symbol = ctx.tenant.currencySymbol;
  const committedCents = data.committed.byProject.get(project.id) ?? 0;
  const actualCents = data.actual.get(project.id) ?? 0;
  /** The revised contract value, which the ordered figure is compared against. */
  const { signedValue } = contractSummary(contracts, data.changeOrders);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-heading">Ordered</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
            {/*
              COMMITTED IS NOT ACTUAL, and the difference is the point of this
              page: a job can look healthy on what the ledger has been billed
              right up until you notice what it has already promised. Both
              figures are in the strip above — this page is the detail under
              them, so it does not repeat them as boxes of their own.
            */}
            {/*
              Nothing when the list is empty — the empty state below says what
              an order is, and saying it twice on one screen reads as a stutter.
            */}
            {commitments.length > 0 &&
              `${formatMoney(committedCents, symbol)} committed against ${formatMoney(signedValue, symbol)} of contract, and ${formatMoney(actualCents, symbol)} of it billed to the books so far.`}
          </p>
        </div>
        {isOwner && (
          <CommitmentForm
            projectId={project.id}
            parties={data.parties}
            costCodes={data.codes.map((c) => ({
              id: c.id,
              label: `${c.code} · ${c.name}`,
            }))}
          />
        )}
      </div>
        <p className="text-xs text-muted-foreground">
          What this job has EARNED against what it has billed is on the{" "}
          <Link href="/dashboard/m/jobs/wip" className="underline">
            work in progress schedule
          </Link>
          , per period end.
        </p>
        {/*
          THE BOOKKEEPER'S QUESTION, answered where the orders are: who has been
          paid with no unconditional lien waiver on file (ADR 0066). Derived
          from the applications and their bills, never stored.
        */}
        {(data.waiverGaps.length > 0 || data.waiverCoverage.size > 0) &&
          (() => {
            const paid = data.waiverGaps.filter((g) => g.paid);
            const unpaid = data.waiverGaps.length - paid.length;
            const orders = [...new Set(paid.map((g) => `${g.commitmentNumber} (${g.partyName})`))];
            return (
              <p className="mb-3 text-xs text-muted-foreground">
                {paid.length > 0 ? (
                  <>
                    <span className="font-medium text-destructive">
                      Lien waivers: {paid.length} paid{" "}
                      {paid.length === 1 ? "application" : "applications"} with no unconditional
                      waiver on file
                    </span>{" "}
                    — {orders.join(", ")}.
                  </>
                ) : (
                  "Lien waivers: every paid application has an unconditional waiver on file."
                )}
                {unpaid > 0 && ` ${unpaid} billed and unpaid with no waiver yet.`}
              </p>
            );
          })()}

      <DataTable
        isEmpty={commitments.length === 0}
        empty={
          <EmptyState
            icon={<ShoppingCart />}
            title="Nothing ordered yet"
            description="Purchase orders and subcontracts recorded here are what the job already owes, before any bill arrives."
            action={
              isOwner ? (
                <CommitmentForm
                  projectId={project.id}
                  parties={data.parties}
                  costCodes={data.codes.map((c) => ({
                    id: c.id,
                    label: `${c.code} · ${c.name}`,
                  }))}
                />
              ) : null
            }
          />
        }
      >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>For</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Billed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {commitments.map((row) => (
                  <TableRow key={row.commitment.id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/dashboard/m/jobs/${project.id}/commitments/${row.commitment.id}`}
                        className="hover:underline"
                      >
                        {row.commitment.number}
                      </Link>
                      <span className="block font-sans text-xs text-muted-foreground">
                        {isCommitmentKind(row.commitment.kind)
                          ? COMMITMENT_KIND_LABELS[row.commitment.kind]
                          : row.commitment.kind}
                      </span>
                    </TableCell>
                    <TableCell>{row.vendorName}</TableCell>
                    <TableCell>
                      {row.commitment.description || "—"}
                      {row.lines.filter((l) => l.counted).length > 1 && (
                        <span className="block text-xs text-muted-foreground">
                          {row.lines.filter((l) => l.counted).length} lines
                        </span>
                      )}
                    </TableCell>
                    {/*
                      ORIGINAL + APPROVED CHANGES, the contracts table's rule on
                      the payable side: the sum an order is worth now, with the
                      original under it when a change order has moved it.
                    */}
                    <TableCell className="text-right tabular-nums">
                      {formatMoneySign(row.totalCents, symbol)}
                      {row.changesCents !== 0 && (
                        <span className="block text-xs text-muted-foreground">
                          orig. {formatMoney(row.originalCents, symbol)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {/*
                        WHAT THE SUBCONTRACTOR HAS BILLED, and what is held back
                        from them — the retainage the profile's 2120 exists for.
                        A purchase order shows a dash: it is billed in Accounting.
                      */}
                      {(() => {
                        const b = data.subBilling.get(row.commitment.id);
                        if (!b || b.billedCount === 0) {
                          return <span className="text-muted-foreground">—</span>;
                        }
                        const cover = data.waiverCoverage.get(row.commitment.id);
                        const paidWithout = data.waiverGaps.some(
                          (g) => g.commitmentId === row.commitment.id && g.paid,
                        );
                        const waiverWord = paidWithout
                          ? "paid, no waiver"
                          : cover?.finalOnFile
                            ? "final waiver on file"
                            : cover?.unconditionalThrough
                              ? `waiver through ${cover.unconditionalThrough}`
                              : "no waiver yet";
                        return (
                          <>
                            {formatMoney(b.billedCents, symbol)}
                            {b.retainageHeldCents > 0 && (
                              <span className="block text-xs text-muted-foreground">
                                {formatMoney(b.retainageHeldCents, symbol)} held
                              </span>
                            )}
                            {/* The bookkeeper's question per order (ADR 0066). */}
                            <span
                              className={`block text-xs ${paidWithout ? "text-destructive" : "text-muted-foreground"}`}
                            >
                              {waiverWord}
                            </span>
                          </>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={COMMITMENT_TONES[row.commitment.status] ?? "quiet"}>
                        {isCommitmentStatus(row.commitment.status)
                          ? COMMITMENT_STATUS_LABELS[row.commitment.status]
                          : row.commitment.status}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="w-10 text-right">
                      {isOwner && (
                        <CommitmentForm
                          projectId={project.id}
                          parties={data.parties}
                          costCodes={data.codes.map((c) => ({
                            id: c.id,
                            label: `${c.code} · ${c.name}`,
                          }))}
                          existing={{
                            id: row.commitment.id,
                            version: row.commitment.version,
                            partyId: row.commitment.partyId,
                            kind: row.commitment.kind,
                            number: row.commitment.number,
                            description: row.commitment.description,
                            status: row.commitment.status,
                            issuedOn: row.commitment.issuedOn,
                            notes: row.commitment.notes,
                            // The lines the order was placed with; a change's are the change's.
                            lines: row.lines
                              .filter((l) => l.change === null)
                              .map((l) => ({
                                costCodeId: l.costCodeId,
                                description: l.description,
                                amountCents: l.amountCents,
                              })),
                          }}
                          linesLocked={(COMMITTED_STATUSES as readonly string[]).includes(
                            row.commitment.status,
                          )}
                          trigger={
                            <Button variant="ghost" size="icon">
                              <Pencil className="size-4" />
                              <span className="sr-only">
                                Edit {row.commitment.number}
                              </span>
                            </Button>
                          }
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
      </DataTable>
    </div>
  );
}

/**
 * An order's status as a tone. `issued` and `closed` are real commitments and
 * count toward committed cost; a `draft` is waiting on somebody to issue it.
 */
const COMMITMENT_TONES: Record<string, StatusTone> = {
  issued: "good",
  closed: "good",
  draft: "pending",
  cancelled: "quiet",
};
