import Link from "next/link";
import { ChevronLeft, ListTree } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { allowsWrite } from "@/lib/packs/authorize";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listCostCodeSets, listCostCodes } from "@/packs/jobs/ops";
import { PACK } from "@/packs/jobs/vocabulary";
import {
  MakeDefaultButton,
  NewCodeButton,
  NewSetButton,
} from "@/packs/jobs/components/cost-code-controls";

/**
 * The chart of cost: every list this business keeps, and the codes in each.
 *
 * **THE PACK SHIPS NO STARTER LIST**, and that is the whole reason this screen
 * exists rather than a constant somewhere. CSI MasterFormat is the commercial
 * norm, NAHB's chart the residential one, and plenty of builders use a list they
 * invented — the construction pilot does, one list across all three of the kinds
 * of work it does. A profile may seed a starter set; from the moment it lands it
 * is the tenant's to edit.
 *
 * OWNER-ONLY TO WRITE, member-wide to read: editing the chart of cost is a
 * decision, and the codes are what everybody else charges against.
 */
export default async function CostCodesPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const isOwner = allowsWrite(ctx.role, "owner");

  const sets = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const rows = await listCostCodeSets(tx, ctx.tenant.id);
      return Promise.all(
        rows.map(async (set) => ({
          set,
          codes: await listCostCodes(tx, ctx.tenant.id, set.id),
        })),
      );
    },
    { role: ctx.role },
  );

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/m/jobs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Jobs
      </Link>

      <PageHeader
        title="Cost codes"
        description="What work is charged against. Keep one list, or one per kind of job."
        actions={isOwner ? <NewSetButton /> : null}
      />

      {sets.length === 0 ? (
        <EmptyState
          icon={<ListTree />}
          title="No cost code lists yet"
          description={
            isOwner
              ? "Add your own list — the codes you already use on a job cost report. Some businesses use CSI MasterFormat, some use NAHB's, and plenty use a list of their own; nothing here assumes which."
              : "An owner sets the chart of cost up."
          }
          action={isOwner ? <NewSetButton /> : undefined}
        />
      ) : (
        sets.map(({ set, codes }) => (
          <Panel key={set.id}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="font-heading text-sm font-medium tracking-heading">
                  {set.name}
                </h2>
                {set.isDefault && <Badge variant="secondary">Default</Badge>}
              </div>
              {isOwner && (
                <div className="flex items-center gap-1">
                  {!set.isDefault && <MakeDefaultButton setId={set.id} />}
                  <NewCodeButton setId={set.id} />
                </div>
              )}
            </div>
            {codes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No codes in this list yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-40">Code</TableHead>
                      <TableHead>Name</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {codes.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">{c.code}</TableCell>
                        <TableCell>{c.name}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Panel>
        ))
      )}
    </div>
  );
}
