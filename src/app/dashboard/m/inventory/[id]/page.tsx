import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getItem,
  listLocations,
  listLots,
  listMovements,
  movementRowsForItem,
} from "@/packs/inventory/ops";
import {
  balanceByLocation,
  balanceOfLot,
} from "@/packs/inventory/core/balances";
import { formatQuantity, getUnit } from "@/packs/inventory/core/units";
import {
  LOT_SOURCE_LABELS,
  isLotSource,
  movementKindLabel,
  slugLabel,
} from "@/packs/inventory/vocabulary";
import {
  LotForm,
  MovementForm,
  SplitLotForm,
} from "@/packs/inventory/components/stock-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/inventory";

/**
 * One item: how much there is, WHERE, and which batch it belongs to.
 *
 * The "where" card is the day-one screen the design named — *"which freezer has
 * the ribeyes"* — and it needs no history at all beyond one recorded movement.
 *
 * Every number here is folded from the ledger by `core/balances.ts`. Nothing on
 * this page reads a stored quantity, because there is not one.
 */
export default async function InventoryItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "inventory");

  const today = todayInTimezone(ctx.tenant.timezone);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const item = await getItem(tx, ctx.tenant.id, id);
      if (!item) return null;
      const [lots, rows, movements, locations] = await Promise.all([
        listLots(tx, ctx.tenant.id, { itemId: id }),
        movementRowsForItem(tx, ctx.tenant.id, id),
        listMovements(tx, ctx.tenant.id, { itemId: id, limit: 25 }),
        listLocations(tx, ctx.tenant.id),
      ]);
      return { item, lots, rows, movements, locations };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { item, lots, rows, movements, locations } = data;

  const isOwner = ctx.role === "owner";
  const unit = item.stockingUnit;
  const unitLabel = getUnit(unit)?.plural ?? unit;
  const locationNames = new Map(locations.map((l) => [l.id, l.name]));

  const total = rows.reduce((sum, r) => sum + r.quantity, 0);
  const byLocation = balanceByLocation(rows);

  const lotOptions = lots
    .filter((l) => l.status === "open")
    .map((l) => ({
      id: l.id,
      code: l.code,
      balanceLabel: formatQuantity(balanceOfLot(rows, l.id), unit),
    }));
  const locationOptions = locations.map((l) => ({ id: l.id, name: l.name }));

  return (
    <div className="space-y-6">
      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        All inventory
      </Link>

      <PageHeader
        title={item.name}
        description={
          <span className="flex items-center gap-2">
            {slugLabel(item.itemKind)}
            {" · counted in "}
            {unitLabel}
            {item.storageRequirement && (
              <Badge variant="outline">{slugLabel(item.storageRequirement)}</Badge>
            )}
            {item.status === "archived" && <Badge variant="outline">archived</Badge>}
          </span>
        }
        actions={
          isOwner && item.status === "active" ? (
            <div className="flex items-center gap-2">
              <LotForm itemId={item.id} today={today} />
              <MovementForm
                itemId={item.id}
                unitLabel={unitLabel}
                lots={lotOptions}
                locations={locationOptions}
                today={today}
              />
            </div>
          ) : null
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">On hand</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-medium tabular-nums">
              {rows.length === 0 ? "—" : formatQuantity(total, unit)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {rows.length === 0
                ? "Nothing recorded yet. Every number here is the sum of what you enter."
                : `From ${rows.length} ${rows.length === 1 ? "entry" : "entries"}.`}
            </p>
            {total < 0 && (
              // Deliberately reported rather than prevented. Stock goes
              // negative when Monday's delivery is entered on Wednesday, and
              // refusing the Tuesday entry teaches people to stop entering.
              <p className="mt-3 text-sm text-muted-foreground">
                That is below zero, which usually means something was used
                before the delivery that covered it was entered.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Where it is</CardTitle>
          </CardHeader>
          <CardContent>
            {byLocation.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing on hand anywhere.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {byLocation.map((b) => (
                  <li
                    key={b.locationAssetId ?? "none"}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span
                      className={
                        b.locationAssetId ? "font-medium" : "text-muted-foreground"
                      }
                    >
                      {/* "Somewhere, uncounted" is kept rather than hidden —
                          otherwise the parts would not add up to the total. */}
                      {b.locationAssetId
                        ? (locationNames.get(b.locationAssetId) ?? "Unknown place")
                        : "Not recorded"}
                    </span>
                    <span className="tabular-nums">
                      {formatQuantity(b.quantity, unit)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">
          Batches {lots.length > 0 && `(${lots.length})`}
        </h2>
        {lots.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No batches yet. A batch is what traceability follows, and what a
            cost attaches to — one delivery, one hatch, one pen.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lots.map((lot) => {
                const balance = balanceOfLot(rows, lot.id);
                return (
                  <TableRow key={lot.id}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        {lot.code}
                        {lot.status === "closed" && (
                          <Badge variant="outline">closed</Badge>
                        )}
                        {lot.parentLotId && (
                          <Badge variant="outline">split</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {isLotSource(lot.source)
                        ? LOT_SOURCE_LABELS[lot.source]
                        : lot.source}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {lot.openedOn ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQuantity(balance, unit)}
                    </TableCell>
                    <TableCell className="text-right">
                      {isOwner && lot.status === "open" && balance > 0 && (
                        <SplitLotForm
                          lot={{
                            id: lot.id,
                            code: lot.code,
                            balanceLabel: formatQuantity(balance, unit),
                          }}
                          unitLabel={unitLabel}
                          locations={locationOptions}
                          today={today}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {movements.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium">Recent entries</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>What happened</TableHead>
                <TableHead>Where</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {m.occurredOn}
                  </TableCell>
                  <TableCell>
                    {movementKindLabel(m.movementKind)}
                    {m.notes && (
                      <div className="text-xs text-muted-foreground">
                        {m.notes}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {m.locationAssetId
                      ? (locationNames.get(m.locationAssetId) ?? "—")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m.quantity > 0 ? "+" : ""}
                    {formatQuantity(m.quantity, unit)}
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
