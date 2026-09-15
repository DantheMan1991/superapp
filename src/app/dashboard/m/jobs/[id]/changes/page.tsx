import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { allowsWrite } from "@/lib/packs/authorize";
import { Panel } from "@/components/app/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoneySign } from "@/lib/money";
import {
  getProject,
  listChangeOrders,
  listContracts,
  listCostCodes,
} from "@/packs/jobs/ops";
import { ChangeOrderForm } from "@/packs/jobs/components/change-order-form";
import {
  CHANGE_ORDER_STATUS_LABELS,
  isChangeOrderStatus,
  slugLabel,
} from "@/packs/jobs/vocabulary";
import { contractSummary } from "@/packs/jobs/contract-math";

/**
 * Changes: every change order against the job's contracts.
 *
 * Lifted out of the project page's flat panel stack unchanged (jobs redesign
 * 2a). The job's identity, its vitals and the section strip are the layout's —
 * this page draws its own panel and nothing else.
 */
export default async function ChangesPage({
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
      const [codes, contracts, changeOrders] = await Promise.all([
        project.costCodeSetId
          ? listCostCodes(tx, ctx.tenant.id, project.costCodeSetId)
          : Promise.resolve([]),
        listContracts(tx, ctx.tenant.id, project.id),
        listChangeOrders(tx, ctx.tenant.id, project.id),
      ]);
      return { project, codes, contracts, changeOrders };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { project, contracts, changeOrders } = data;
  const isOwner = allowsWrite(ctx.role, "owner");
  const symbol = ctx.tenant.currencySymbol;
  const { changesValue, approvedCount, proposedChangeCount } = contractSummary(
    contracts,
    changeOrders,
  );

  return (
    <>
      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">
            Change orders
          </h2>
          {isOwner && contracts.length > 0 && (
            <ChangeOrderForm
              projectId={project.id}
              contracts={contracts.map((c) => ({
                id: c.id,
                label: `${slugLabel(c.kind)}${c.name ? ` · ${c.name}` : ""}`,
                status: c.status,
              }))}
              costCodes={data.codes
                .filter((c) => c.isActive)
                .map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }))}
            />
          )}
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          {/*
            THE LINE EVERY OWNER AND SURETY READS: original + approved changes
            = revised. Said in words here, and only APPROVED ones are in the
            number — a proposed change is a price somebody has been shown.
          */}
          {contracts.length === 0
            ? "A change order changes an agreement, so add a contract first."
            : changeOrders.length === 0
              ? "None yet. When the scope moves, a change order records what it costs the client and what it costs you, and only an approved one moves the numbers."
              : `${approvedCount} approved, worth ${formatMoneySign(changesValue, symbol)} on the contract value${
                  proposedChangeCount > 0
                    ? `, with ${proposedChangeCount} still proposed`
                    : ""
                }.`}
        </p>
        {changeOrders.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Against</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {changeOrders.map((row) => (
                  <TableRow key={row.changeOrder.id}>
                    <TableCell className="font-mono text-xs">
                      {row.changeOrder.number}
                    </TableCell>
                    <TableCell className="font-medium">
                      {row.changeOrder.title}
                      {row.changeOrder.approvedOn && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          Approved {row.changeOrder.approvedOn}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {slugLabel(row.contract.kind)}
                      {row.contract.name && (
                        <span className="block text-muted-foreground">
                          {row.contract.name}
                        </span>
                      )}
                    </TableCell>
                    {/*
                      SIGNED RENDERERS ON PURPOSE. A deduction is a negative
                      number here, and `formatMoney` would print it as its own
                      opposite.
                    */}
                    <TableCell className="text-right tabular-nums">
                      {formatMoneySign(row.changeOrder.valueCents, symbol)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.lines.length === 0
                        ? "—"
                        : formatMoneySign(row.costCents, symbol)}
                      {row.lines.length > 1 && (
                        <span className="block text-xs text-muted-foreground">
                          {row.lines.length} codes
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.changeOrder.status === "approved" ? "default" : "secondary"
                        }
                      >
                        {isChangeOrderStatus(row.changeOrder.status)
                          ? CHANGE_ORDER_STATUS_LABELS[row.changeOrder.status]
                          : row.changeOrder.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="w-10 text-right">
                      {isOwner && (
                        <ChangeOrderForm
                          projectId={project.id}
                          contracts={contracts.map((c) => ({
                            id: c.id,
                            label: `${slugLabel(c.kind)}${c.name ? ` · ${c.name}` : ""}`,
                            status: c.status,
                          }))}
                          /*
                            Active codes plus any this change already names, so
                            retiring a code cannot strand a line nobody can
                            reopen — the budget editor's rule, one table over.
                          */
                          costCodes={data.codes
                            .filter(
                              (c) =>
                                c.isActive ||
                                row.lines.some((l) => l.costCodeId === c.id),
                            )
                            .map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }))}
                          existing={{
                            id: row.changeOrder.id,
                            version: row.changeOrder.version,
                            contractId: row.changeOrder.contractId,
                            number: row.changeOrder.number,
                            title: row.changeOrder.title,
                            description: row.changeOrder.description,
                            status: row.changeOrder.status,
                            valueCents: row.changeOrder.valueCents,
                            requestedOn: row.changeOrder.requestedOn,
                            approvedOn: row.changeOrder.approvedOn,
                            notes: row.changeOrder.notes,
                            lines: row.lines.map((l) => ({
                              costCodeId: l.costCodeId,
                              description: l.description,
                              amountCents: l.amountCents,
                            })),
                          }}
                          trigger={
                            <Button variant="ghost" size="icon">
                              <Pencil className="size-4" />
                              <span className="sr-only">
                                Edit {row.changeOrder.number}
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
          </div>
        )}
      </Panel>
    </>
  );
}
