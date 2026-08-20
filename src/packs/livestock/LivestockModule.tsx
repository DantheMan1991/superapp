import Link from "next/link";
import { Beef, ClipboardCheck, Scale, Sparkles } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { todayInTimezone } from "@/lib/timezone";
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
import { packContext } from "@/lib/packs/tenant-context";
import { listItems, listLots, movementKindsForLots } from "@/packs/inventory/ops";
import { currentZoneForOccupants } from "@/packs/land/ops";
import { slugLabel } from "@/packs/inventory/vocabulary";
import { listLivestockLots, withdrawalByLot } from "./ops";
import {
  blocksProcessing,
  describeWithdrawal,
  formatWithdrawal,
} from "./core/withdrawal";
import { ageInDays, formatAge, formatRate, mortalityRate, summariseHead } from "./core/herd";
import { labelFor } from "@/lib/packs/resolve";
import { speciesFrom } from "./vocabulary";
import { LivestockLotForm } from "./components/lot-controls";

const BASE = "/dashboard/m/livestock";

/**
 * The `livestock` pack's home: every animal lot, what is in it, and where it is.
 *
 * "SEEING YOUR ANIMALS ON PADDOCKS ALREADY BEATS NOTHING" is the design's own
 * justification for this slice, and it is why the location column is here
 * rather than on the detail page. It also happens to be the visible proof of
 * the pack model: the code comes from `inventory`, the head count from
 * `inventory`'s ledger, the paddock from `land`, and the species from here.
 */
export async function LivestockModule({
  ctx,
  searchParams,
}: {
  ctx: TenantContext;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const speciesParam = searchParams.species;
  const species = typeof speciesParam === "string" ? speciesParam : undefined;
  const today = todayInTimezone(ctx.tenant.timezone);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [lots, pack, items] = await Promise.all([
        listLivestockLots(tx, ctx.tenant.id, { species }),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "livestock"),
        // Only items counted in head can hold animals, which is what makes
        // "head is a unit of measure" true in the UI as well as the schema.
        listItems(tx, ctx.tenant.id, { status: "active" }),
      ]);

      const inventoryLotIds = lots.map((l) => l.inventoryLotId);
      // Three queries for the whole page, whatever the lot count: the spine
      // rows, where each lot is, and the movements behind every head figure.
      const [inventoryLots, zones, movements, withdrawals] = await Promise.all([
        listLots(tx, ctx.tenant.id),
        currentZoneForOccupants(
          tx,
          ctx.tenant.id,
          "livestock",
          inventoryLotIds,
          today,
        ),
        movementKindsForLots(tx, ctx.tenant.id, inventoryLotIds),
        // A LOT UNDER WITHDRAWAL HAS TO BE VISIBLE WHERE SOMEBODY IS ALREADY
        // LOOKING, not only on a page they would have to think to open.
        withdrawalByLot(
          tx,
          ctx.tenant.id,
          lots.map((l) => l.id),
          today,
        ),
      ]);

      return { lots, pack, items, inventoryLots, zones, movements, withdrawals };
    },
    { role: ctx.role },
  );

  const { lots, pack, items, inventoryLots, zones, movements, withdrawals } =
    data;
  const isOwner = ctx.role === "owner";
  const byId = new Map(inventoryLots.map((l) => [l.id, l]));
  const headItems = items.filter((i) => i.stockingUnit === "head");
  const suggestedSpecies = speciesFrom(pack.config);
  const lotWord = labelFor(pack.labels, "livestockLot", "Lot");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Livestock"
        description={`Every animal is a ${lotWord.toLowerCase()}, and an individual is a ${lotWord.toLowerCase()} of one.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* FIRST, and not owner-gated. The round is the daily act and the
                lot form is the occasional one, so the order on the page is the
                order of how often they are used — not the order they were
                built in. */}
            <Button asChild variant="outline">
              <Link href={`${BASE}/log`}>
                <ClipboardCheck className="mr-2 h-4 w-4" />
                Daily round
              </Link>
            </Button>
            {/* Slice 2. Not daily — feed is looked at when a batch is being
                judged against the last one, which is why it sits after the
                round rather than beside it. */}
            <Button asChild variant="outline">
              <Link href={`${BASE}/feed`}>
                <Scale className="mr-2 h-4 w-4" />
                Feed
              </Link>
            </Button>
            {/* The other half of the wedge, and the only thing on this page
                that works with nothing recorded at all. */}
            <Button asChild variant="outline">
              <Link href={`${BASE}/ask`}>
                <Sparkles className="mr-2 h-4 w-4" />
                Ask
              </Link>
            </Button>
            {/* No longer gated on an item existing: the form can create one. A
                farm's first animal used to require a trip to Inventory first. */}
            {isOwner && (
              <LivestockLotForm
                items={headItems.map((i) => ({ id: i.id, name: i.name }))}
                speciesOptions={suggestedSpecies}
                today={today}
              />
            )}
          </div>
        }
      />

      {lots.length === 0 ? (
        <EmptyState
          panel
          icon={<Beef className="h-5 w-5" />}
          title="No animals recorded yet"
          description={
            isOwner
              ? "Start a lot — a batch of chicks, a group of feeders, one named cow. What goes in and what leaves are both entries against it, so the count always reconciles."
              : "An owner starts the first lot. Once they do, the animals show up here."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{lotWord}</TableHead>
              <TableHead>Species</TableHead>
              <TableHead>Where</TableHead>
              <TableHead className="text-right">Age</TableHead>
              <TableHead className="text-right">Lost</TableHead>
              <TableHead>Withdrawal</TableHead>
              <TableHead className="text-right">Head</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lots.map((lot) => {
              const inv = byId.get(lot.inventoryLotId);
              const lotMovements = movements.get(lot.inventoryLotId) ?? [];
              // The head count IS the balance — the same fold, over the same
              // ledger, that inventory's own pages use.
              const summary = summariseHead(lotMovements);
              const zone = zones.get(lot.inventoryLotId);
              return (
                <TableRow key={lot.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      <Link
                        href={`${BASE}/${lot.id}`}
                        className="hover:underline"
                      >
                        {inv?.code ?? "—"}
                      </Link>
                      {inv?.parentLotId && <Badge variant="outline">split</Badge>}
                    </div>
                    {lot.breed && (
                      <div className="text-xs text-muted-foreground">
                        {lot.breed}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {slugLabel(lot.species)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {/* From `land`, through land's own query. This pack never
                        touches land_occupancy directly. */}
                    {zone ? (
                      <span>
                        {zone.zoneName}
                        {zone.structureName && (
                          <span className="text-xs"> · {zone.structureName}</span>
                        )}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatAge(ageInDays(lot.bornOn, today))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatRate(mortalityRate(summary))}
                  </TableCell>
                  <TableCell>
                    {/* Nothing at all when nothing has been given — a column of
                        "Clear" on a farm that has never treated anything is
                        noise, and noise is what makes a real one invisible. */}
                    {(() => {
                      const w = withdrawals.get(lot.id);
                      if (!w || w.treatmentCount === 0) {
                        return <span className="text-muted-foreground">—</span>;
                      }
                      return (
                        <Badge
                          variant={
                            blocksProcessing(w.meat) ? "default" : "outline"
                          }
                          title={describeWithdrawal(w.meat)}
                        >
                          {formatWithdrawal(w.meat)}
                        </Badge>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {/* An em dash before anything has been placed. "No animals"
                        and "none recorded yet" are different facts. */}
                    {lotMovements.length === 0 ? "—" : summary.balance}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
