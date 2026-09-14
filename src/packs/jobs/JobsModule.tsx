import Link from "next/link";
import { HardHat } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor, pluralOf } from "@/lib/packs/resolve";
import { formatMoneySign } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
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
import { listCostCodeSets, listProjectRows, projectValues } from "./ops";
import {
  PACK,
  STATUS_LABELS,
  deliveryMethodsFrom,
  isProjectStatus,
  slugLabel,
} from "./vocabulary";
import { ProjectForm } from "./components/project-form";

/**
 * The `jobs` pack's home: every project, and the three coordinates each one
 * carries.
 *
 * **NOTHING HERE IS CONSTRUCTION-SHAPED, and that is the test.** A project has a
 * number, a client, a company, a division and a kind of work; a fit-out, a
 * software engagement and a house are the same row. The kinds of work come from
 * the installed profile's `packConfig`, never from this pack — see
 * `vocabulary.ts`, which deliberately ships no list.
 *
 * ONE QUERY SHAPE FOR THE WHOLE PAGE: `listProjectRows` resolves the company,
 * client, division and cost code list in one statement with four left joins,
 * rather than a lookup per row.
 */
export async function JobsModule({
  ctx,
}: {
  ctx: TenantContext;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { rows, values, entities, parties, enterprises, sets, labels, config } =
    await withTenant(
      ctx.tenant.id,
      async (tx) => {
        const [rows, values, entities, parties, enterprises, sets, pack] =
          await Promise.all([
          listProjectRows(tx, ctx.tenant.id),
          projectValues(tx, ctx.tenant.id),
          tx
            .select({ id: schema.entities.id, name: schema.entities.name })
            .from(schema.entities)
            .where(
              and(
                eq(schema.entities.tenantId, ctx.tenant.id),
                eq(schema.entities.isActive, true),
              ),
            ),
          tx
            .select({
              id: schema.parties.id,
              name: schema.parties.displayName,
            })
            .from(schema.parties)
            .where(eq(schema.parties.tenantId, ctx.tenant.id))
            .limit(500),
          tx
            .select({ id: schema.enterprises.id, name: schema.enterprises.name })
            .from(schema.enterprises)
            .where(eq(schema.enterprises.tenantId, ctx.tenant.id)),
          listCostCodeSets(tx, ctx.tenant.id),
          packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
        ]);
        return {
          rows,
          values,
          entities,
          parties,
          enterprises,
          sets,
          labels: pack.labels,
          config: pack.config,
        };
      },
      { role: ctx.role },
    );

  const projectWord = labelFor(labels, "project", "Project");
  // The shared plural rule, never a second key: a declared plural for the word
  // nobody renamed, an "s" for the tenant's own. See `pluralOf`.
  const projectPlural = pluralOf(projectWord, "Project", "Projects");
  const clientWord = labelFor(labels, "customer", "Customer");
  const isOwner = ctx.role === "owner";
  /**
   * The kinds of work this business does, offered as suggestions. From the
   * PROFILE, never from here — a list in this file would make the pack know its
   * industry (ADR 0004). An empty list means a free-text box, which is the
   * correct answer for a tenant with no profile installed.
   */
  const deliveryMethods = deliveryMethodsFrom(config);
  const symbol = ctx.tenant.currencySymbol;

  const form = isOwner ? (
    <ProjectForm
      entities={entities}
      parties={parties}
      enterprises={enterprises}
      costCodeSets={sets.map((s) => ({
        id: s.id,
        name: s.name,
        isDefault: s.isDefault,
      }))}
      deliveryMethods={deliveryMethods}
      projectWord={projectWord}
      clientWord={clientWord}
    />
  ) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={projectPlural}
        description={`What ${ctx.tenant.name} is building, and what each job costs.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/m/jobs/wip">Work in progress</Link>
            </Button>
            {isOwner && (
              <Button variant="outline" size="sm" asChild>
                <Link href="/dashboard/m/jobs/cost-codes">Cost codes</Link>
              </Button>
            )}
            {form}
          </div>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<HardHat />}
          title={`No ${projectPlural.toLowerCase()} yet`}
          description={
            isOwner
              ? `Add the first one and every bill and hour can be charged to it. ${projectPlural} appear as a cost object, so the reports you already have will group by them.`
              : `Nobody has added a ${projectWord.toLowerCase()} yet. An owner sets the first one up.`
          }
          action={form}
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-card shadow-elevation-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>{projectWord}</TableHead>
                <TableHead>{clientWord}</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Company</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ project, entityName, clientName, enterpriseName }) => (
                <TableRow key={project.id}>
                  <TableCell className="font-mono text-xs">
                    <Link
                      href={`/dashboard/m/jobs/${project.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {project.number}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">
                    {project.name}
                    {project.address && (
                      <span className="block text-xs text-muted-foreground">
                        {project.address}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{clientName ?? "—"}</TableCell>
                  <TableCell>
                    {/* The business's own word for the kind of work, never ours. */}
                    {project.deliveryMethod ? slugLabel(project.deliveryMethod) : "—"}
                  </TableCell>
                  <TableCell>
                    {entityName}
                    {enterpriseName && (
                      <span className="block text-xs text-muted-foreground">
                        {enterpriseName}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {/*
                     * Signed agreements only. A job with nothing signed shows a
                     * dash rather than a zero, because zero reads as "worth
                     * nothing" and the truth is "not agreed yet".
                     *
                     * REVISED, with the approved changes said underneath when
                     * there are any — so a job that grew is seen to have grown,
                     * not silently re-signed at a bigger number. Signed
                     * renderers, because a deduction is a negative and
                     * `formatMoney` would print it as its own opposite.
                     */}
                    {(() => {
                      const v = values.get(project.id);
                      if (!v || v.signedCount === 0) return "—";
                      return (
                        <>
                          {formatMoneySign(v.valueCents, symbol)}
                          {v.changesCents !== 0 && (
                            <span className="block text-xs text-muted-foreground">
                              incl. {formatMoneySign(v.changesCents, symbol)} in changes
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <Badge variant={project.status === "active" ? "default" : "secondary"}>
                      {isProjectStatus(project.status)
                        ? STATUS_LABELS[project.status]
                        : project.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
