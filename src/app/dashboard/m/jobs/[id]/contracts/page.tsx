import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { allowsWrite } from "@/lib/packs/authorize";
import { labelFor } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
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
import { formatMoney, formatMoneySign } from "@/lib/money";
import {
  contractBilling,
  getProject,
  listChangeOrders,
  listContracts,
} from "@/packs/jobs/ops";
import { contractSummary } from "@/packs/jobs/contract-math";
import { ContractForm } from "@/packs/jobs/components/contract-form";
import {
  BILLING_METHOD_LABELS,
  CONTRACT_STATUS_LABELS,
  PACK,
  contractKindsFrom,
  isBillingMethod,
  isContractStatus,
  slugLabel,
} from "@/packs/jobs/vocabulary";

/**
 * Contracts: every agreement on the job, and what each one is worth now.
 *
 * Lifted out of the project page's flat panel stack unchanged (jobs redesign
 * 2a). The job's identity, its vitals and the section strip are the layout's.
 */
export default async function ContractsPage({
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
      const [contracts, changeOrders, billing, parties, pack] = await Promise.all([
        listContracts(tx, ctx.tenant.id, project.id),
        listChangeOrders(tx, ctx.tenant.id, project.id),
        contractBilling(tx, ctx.tenant.id, project.id),
        tx
          .select({ id: schema.parties.id, name: schema.parties.displayName })
          .from(schema.parties)
          .where(eq(schema.parties.tenantId, ctx.tenant.id))
          .limit(500),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
      ]);
      return {
        project,
        contracts,
        changeOrders,
        billing,
        parties,
        labels: pack.labels,
        config: pack.config,
      };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { project, contracts, changeOrders } = data;
  const isOwner = allowsWrite(ctx.role, "owner");
  const symbol = ctx.tenant.currencySymbol;
  const clientWord = labelFor(data.labels, "customer", "Customer");
  const { revisedOf, approvedByContract, signedValue, changesValue, signedCount, proposedCount } =
    contractSummary(contracts, changeOrders);
  const partyName = new Map(data.parties.map((p) => [p.id, p.name]));

  return (
    <>
      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">
            Contracts
          </h2>
          {isOwner && (
            <ContractForm
              projectId={project.id}
              parties={data.parties}
              contractKinds={contractKindsFrom(data.config)}
              clientWord={clientWord}
            />
          )}
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          {/*
           * THE SENTENCE THAT STOPS A PROPOSAL BEING READ AS MONEY. A concept
           * the client has not signed is not revenue, and a total that quietly
           * included it would be the number an owner takes to a bank.
           */}
          {contracts.length === 0
            ? "No agreements yet. A job can have several — a design agreement, then drawings, then the build."
            : `Worth ${formatMoneySign(signedValue, symbol)} across ${signedCount} signed ${
                signedCount === 1 ? "agreement" : "agreements"
              }${
                changesValue !== 0
                  ? `, including ${formatMoneySign(changesValue, symbol)} in approved changes`
                  : ""
              }${proposedCount > 0 ? `, with ${proposedCount} still proposed` : ""}.`}
        </p>
        {contracts.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>With</TableHead>
                  <TableHead>Billed by</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Billed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((c, i) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {i + 1}
                    </TableCell>
                    <TableCell className="font-medium">
                      {/* The kind is the way in to the contract's own page: its schedule and its draws. */}
                      <Link
                        href={`/dashboard/m/jobs/${project.id}/contracts/${c.id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {slugLabel(c.kind)}
                      </Link>
                      {c.name && (
                        <span className="block text-xs text-muted-foreground">
                          {c.name}
                        </span>
                      )}
                      {c.role === "subcontract" && (
                        <span className="block text-xs text-muted-foreground">
                          We are a subcontractor
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {partyName.get(c.counterpartyPartyId ?? "") ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {isBillingMethod(c.billingMethod)
                        ? BILLING_METHOD_LABELS[c.billingMethod]
                        : c.billingMethod}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {/*
                        REVISED — original + approved changes — with the
                        original underneath only when they differ. The number
                        in the column is the one the next pay application is
                        against; signed renderer because a deduction can take
                        it below the original.
                      */}
                      {c.valueCents === null && !approvedByContract.has(c.id)
                        ? "—"
                        : formatMoneySign(revisedOf(c), symbol)}
                      {(approvedByContract.get(c.id) ?? 0) !== 0 && (
                        <span className="block text-xs text-muted-foreground">
                          orig.{" "}
                          {c.valueCents === null ? "—" : formatMoney(c.valueCents, symbol)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {/*
                        What has been certified for payment so far, from the
                        contract's own page. A dash until the first
                        application is issued: nothing has been billed, which
                        is not the same as zero owed.
                      */}
                      {(() => {
                        const b = data.billing.get(c.id);
                        if (!b || b.issuedCount === 0) return "—";
                        return (
                          <>
                            {formatMoney(b.billedCents, symbol)}
                            {b.retainageHeldCents > 0 && (
                              <span className="block text-xs text-muted-foreground">
                                {formatMoney(b.retainageHeldCents, symbol)} held
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={c.status === "signed" ? "default" : "secondary"}
                      >
                        {isContractStatus(c.status)
                          ? CONTRACT_STATUS_LABELS[c.status]
                          : c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="w-10 text-right">
                      {isOwner && (
                        <ContractForm
                          projectId={project.id}
                          parties={data.parties}
                          contractKinds={contractKindsFrom(data.config)}
                          clientWord={clientWord}
                          existing={{
                            id: c.id,
                            version: c.version,
                            kind: c.kind,
                            name: c.name,
                            counterpartyPartyId: c.counterpartyPartyId,
                            role: c.role,
                            billingMethod: c.billingMethod,
                            valueCents: c.valueCents,
                            feePpm: c.feePpm,
                            feeCents: c.feeCents,
                            gmaxCents: c.gmaxCents,
                            laborRateCents: c.laborRateCents,
                            rateLocked: (data.billing.get(c.id)?.issuedCount ?? 0) > 0,
                            status: c.status,
                            signedOn: c.signedOn,
                            notes: c.notes,
                          }}
                          trigger={
                            <Button variant="ghost" size="icon">
                              <Pencil className="size-4" />
                              <span className="sr-only">
                                Edit {slugLabel(c.kind)}
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
