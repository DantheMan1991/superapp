import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { isModuleEnabled } from "@/lib/modules";
import { formatMoney } from "@/lib/money";
import { todayInTimezone } from "@/lib/timezone";
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor } from "@/lib/packs/resolve";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  balanceByLots,
  listLocations,
  listLots,
} from "@/packs/inventory/ops";
import { formatQuantity, getUnit } from "@/packs/inventory/core/units";
import { inputBlocks, listRunItems, runDetail } from "@/packs/production/ops";
import {
  COST_BASIS_LABELS,
  COST_BASIS_NOTES,
  RUN_STATUS_LABELS,
  slugLabel,
  type RunStatus,
} from "@/packs/production/vocabulary";
import {
  YIELD_REFUSALS,
  formatLb,
  formatRatio,
} from "@/packs/production/core/yield";
import {
  AddInputForm,
  AddOutputForm,
  CompleteRunButton,
  RemoveOutputButton,
} from "@/packs/production/components/run-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/production";

/**
 * One run: what went in, what came out, and the ratio between them.
 *
 * **THREE THINGS ON THIS PAGE ARE NOT AVAILABLE ANYWHERE ELSE IN THE APP**, and
 * each is a load-bearing part of the design:
 *
 *   - **The yield**, folded from the weights and refused with a reason when they
 *     are not all there.
 *   - **What the run is holding.** Between the animals leaving and the boxes
 *     landing, their cost is on no shelf — work in progress, which every
 *     accounting system models and no farm app does.
 *   - **Why a batch cannot go in.** The withdrawal clock has been loud on four
 *     livestock screens since it was built and has refused nothing, because
 *     nothing existed to refuse. It refuses here.
 */
export default async function ProductionRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "production");

  const today = todayInTimezone(ctx.tenant.timezone);
  const currencySymbol = ctx.tenant.currencySymbol;
  // Only signpost a module this tenant actually has — the "button that leads to
  // a 404" mistake `land` made with its parcel finder.
  const inventoryEnabled = await isModuleEnabled(ctx.tenant.id, "inventory");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const detail = await runDetail(tx, ctx.tenant.id, id, today);
      if (!detail) return null;

      const [items, lots, locations, pack] = await Promise.all([
        listRunItems(tx, ctx.tenant.id),
        listLots(tx, ctx.tenant.id, { status: "open" }),
        listLocations(tx, ctx.tenant.id),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "production"),
      ]);

      const lotIds = lots.map((l) => l.id);
      const [balances, blocks] = await Promise.all([
        balanceByLots(tx, ctx.tenant.id, lotIds),
        // Asked for EVERY open batch, not only the ones already on the run, so
        // the picker can grey out a blocked pen instead of accepting it and
        // then refusing.
        inputBlocks(tx, ctx.tenant.id, lotIds, today),
      ]);

      return { detail, items, lots, locations, pack, balances, blocks };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { detail, items, lots, locations, pack, balances, blocks } = data;
  const { run, inputs, outputs, yieldResult } = detail;
  const isOwner = ctx.role === "owner";
  const isOpen = run.status === "in_progress";
  const runWord = labelFor(pack.labels, "productionRun", "Run");

  const itemById = new Map(items.map((i) => [i.id, i]));
  const itemOptions = items.map((i) => ({
    id: i.id,
    name: i.name,
    unit: i.stockingUnit,
    // A mass-stocked item needs no separate weight: the quantity already is one.
    weighed: getUnit(i.stockingUnit)?.dimension === "mass",
  }));
  const lotOptions = lots.map((l) => {
    const block = blocks.get(l.id);
    const item = itemById.get(l.itemId);
    return {
      id: l.id,
      itemId: l.itemId,
      code: l.code,
      balanceLabel: formatQuantity(
        balances.get(l.id) ?? null,
        item?.stockingUnit ?? "each",
      ),
      blockedBecause: block?.reason ?? null,
      blockedHeadline: block?.headline ?? null,
    };
  });
  const places = locations.map((l) => ({ id: l.id, name: l.name }));

  // What the run is still holding: it took this much cost out of stock and has
  // put this much back. Zero on both sides of a finished run is the honest
  // answer for a run over stock nobody ever put a price on.
  const heldCents = detail.potCents - detail.landedCents;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={BASE}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Production
        </Link>
      </div>

      <PageHeader
        title={run.code}
        description={`${slugLabel(run.runKind)} · started ${run.startedOn}${
          run.completedOn ? ` · finished ${run.completedOn}` : ""
        }${run.performedBy ? ` · ${run.performedBy}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isOpen ? "default" : "outline"}>
              {RUN_STATUS_LABELS[run.status as RunStatus] ?? run.status}
            </Badge>
            {isOpen && (
              <>
                <AddInputForm
                  runId={run.id}
                  items={itemOptions}
                  lots={lotOptions}
                  today={today}
                />
                <AddOutputForm
                  runId={run.id}
                  runCode={run.code}
                  items={itemOptions}
                  locations={places}
                  /* Creating a stock line is `createItem`, which is owner-only
                     because an item is a thing the business is made of rather
                     than a thing that happened to it. Offering the option to
                     somebody who would be refused is the half-thing
                     `inventory`'s own kind picker had to close. */
                  canCreateItem={isOwner}
                />
                {isOwner && (
                  <CompleteRunButton
                    runId={run.id}
                    runWord={runWord}
                    outputCount={outputs.length}
                    potCents={detail.potCents}
                    currencySymbol={currencySymbol}
                    today={today}
                  />
                )}
              </>
            )}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Yield
            </CardTitle>
          </CardHeader>
          <CardContent>
            {yieldResult.yield ? (
              <>
                <div className="text-2xl font-semibold tabular-nums">
                  {formatRatio(yieldResult.yield.ratio)}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatLb(yieldResult.yield.outLb)} out of{" "}
                  {formatLb(yieldResult.yield.inLb)} in. Measured on this run —
                  never a stored factor, because the next one will differ.
                </p>
              </>
            ) : (
              <>
                <div className="text-2xl font-semibold text-muted-foreground">
                  —
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {YIELD_REFUSALS[yieldResult.refusedBecause]}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cost in
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {formatMoney(detail.potCents, currencySymbol)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {/* NOT AN ERROR TALLY. Raised stock has no purchase basis and an
                  invoice can be late; the design is explicit that a model
                  insisting every input has a price will be lied to. */}
              {detail.unpricedInputs > 0
                ? `${detail.unpricedInputs} of ${inputs.length} carried no price at all — real stock with no invoice behind it, not an error.`
                : "What the batches that went in had accumulated, stamped as they left."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {isOpen ? "Held by this run" : "Landed in stock"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {formatMoney(isOpen ? heldCents : detail.landedCents, currencySymbol)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {isOpen
                ? "Off the shelf and not yet on another one — work in progress. It lands when the run is finished."
                : run.costBasis
                  ? `${COST_BASIS_LABELS[run.costBasis] ?? run.costBasis}. ${
                      COST_BASIS_NOTES[run.costBasis] ?? ""
                    }`
                  : "Landed."}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What went in</CardTitle>
        </CardHeader>
        <CardContent>
          {inputs.length === 0 ? (
            <EmptyState
              icon={<ChevronLeft className="h-5 w-5" />}
              title="Nothing has gone in yet"
              description="Adding an input takes it out of stock on the date you give, and carries what that batch had accumulated onto the run."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>What</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Live weight</TableHead>
                  <TableHead className="text-right">Cost carried</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inputs.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {inventoryEnabled ? (
                        <Link
                          href={`/dashboard/m/inventory/${row.itemId}`}
                          className="hover:underline"
                        >
                          {row.itemName}
                        </Link>
                      ) : (
                        row.itemName
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.lotCode ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {row.occurredOn}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQuantity(row.quantity, row.unit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatLb(
                        row.weightLb ??
                          (getUnit(row.unit)?.dimension === "mass"
                            ? row.quantity
                            : null),
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.costCents === null
                        ? "—"
                        : formatMoney(row.costCents, currencySymbol)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What came out</CardTitle>
        </CardHeader>
        <CardContent>
          {outputs.length === 0 ? (
            <EmptyState
              icon={<ChevronLeft className="h-5 w-5" />}
              title="Nothing has come out yet"
              description="Record boxes as they come off. They land in Inventory together when the run is finished, so the cost split across them adds up to what went in."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>What</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Weight</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>In stock</TableHead>
                  {isOpen && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {outputs.map((row) => (
                  <TableRow key={row.output.id}>
                    <TableCell className="font-medium">
                      {inventoryEnabled ? (
                        <Link
                          href={`/dashboard/m/inventory/${row.output.itemId}`}
                          className="hover:underline"
                        >
                          {row.itemName}
                        </Link>
                      ) : (
                        row.itemName
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.output.lotCode}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQuantity(row.output.quantity, row.unit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatLb(row.weightLb)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.costCents === null
                        ? "—"
                        : formatMoney(row.costCents, currencySymbol)}
                    </TableCell>
                    <TableCell>
                      {row.output.inventoryMovementId ? (
                        <Badge variant="outline">Landed</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          On the run
                        </span>
                      )}
                    </TableCell>
                    {isOpen && (
                      <TableCell className="text-right">
                        <RemoveOutputButton id={row.output.id} />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {run.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm text-muted-foreground">
            {run.notes}
          </CardContent>
        </Card>
      )}

      {(run.crewSize !== null || run.labourHours !== null) && (
        <p className="text-sm text-muted-foreground">
          {run.crewSize !== null && `${run.crewSize} on the crew`}
          {run.crewSize !== null && run.labourHours !== null && " · "}
          {run.labourHours !== null && `${run.labourHours} hours`}
          {". Recorded, not costed — turning hours into money needs a decision about what an hour is worth."}
        </p>
      )}
    </div>
  );
}
