import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { DataTable } from "@/components/app/data-table";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  adjustmentReasons,
  countLines,
  listCounts,
  listLocations,
} from "@/packs/inventory/ops";
import { InventoryNav } from "@/packs/inventory/components/inventory-nav";
import {
  ADJUSTMENT_REASON_NOTES,
  COUNT_STATUS_LABELS,
  adjustmentReasonLabel,
  type CountStatus,
} from "@/packs/inventory/vocabulary";
import { StartCountForm } from "@/packs/inventory/components/count-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/inventory";

/** A year back. Long enough to show a season's pattern, short enough to mean now. */
const REASON_WINDOW_DAYS = 365;

/**
 * Counting, and what the counting keeps finding.
 *
 * **THE REASONS PANEL IS THE POINT OF THE PAGE, not the list of counts.** The
 * design is blunt about it: *reasons are a diagnostic rather than a correction —
 * sustained feed shrinkage is not an accounting problem, it is a rodent
 * problem.* One spoiled bag is a wasted bag. The same reason every month is
 * something to go and look at, and nobody sees that from a ledger.
 */
export default async function InventoryCountsPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "inventory");

  const today = todayInTimezone(ctx.tenant.timezone);
  const currencySymbol = ctx.tenant.currencySymbol;
  const from = new Date(
    Date.parse(`${today}T00:00:00Z`) - REASON_WINDOW_DAYS * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);

  const { counts, lineCounts, locations, reasons } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [counts, locations, reasons] = await Promise.all([
        listCounts(tx, ctx.tenant.id),
        listLocations(tx, ctx.tenant.id),
        adjustmentReasons(tx, ctx.tenant.id, { from, to: today }),
      ]);
      const lineCounts = new Map<string, number>();
      for (const count of counts) {
        lineCounts.set(
          count.id,
          (await countLines(tx, ctx.tenant.id, count.id)).length,
        );
      }
      return { counts, lineCounts, locations, reasons };
    },
    { role: ctx.role },
  );

  const byId = new Map(locations.map((l) => [l.id, l.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Counting"
        description="The record and reality will disagree. Counting is how that gets discovered — and what keeps turning up is worth more than any single count."
        icon={<ClipboardList />}
        actions={
          <StartCountForm
            locations={locations.map((l) => ({ id: l.id, name: l.name }))}
            today={today}
          />
        }
      />

      <InventoryNav isOwner={ctx.role === "owner"} />

      {reasons.length > 0 && (
        <section>
          <h2 className="mb-3 font-heading text-xl font-semibold tracking-heading">
            What keeps happening · last {Math.round(REASON_WINDOW_DAYS / 365)}{" "}
            year
          </h2>
          <DataTable>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Times</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reasons.map((row) => (
                  <TableRow key={row.reason}>
                    <TableCell>
                      <div className="font-medium">
                        {adjustmentReasonLabel(row.reason)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {ADJUSTMENT_REASON_NOTES[row.reason] ?? ""}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.entries}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.itemsAffected}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {/* Only what left carries a cost. Stock that turned up was
                          never bought, so its rows add nothing here — which is
                          why this column is a loss figure and not a net one. */}
                      {row.costCents === 0
                        ? "—"
                        : formatMoney(row.costCents, currencySymbol)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
          <p className="mt-3 text-xs text-muted-foreground">
            A reason once is an accident. The same one every month is worth
            walking out to look at — this pack has an opinion about the pattern
            and none at all about the cause.
          </p>
        </section>
      )}

      <DataTable
        isEmpty={counts.length === 0}
        empty={
          <EmptyState
            icon={<ClipboardList className="h-5 w-5" />}
            title="Nothing counted yet"
            description="Walk a freezer and write down what is in it. Nothing changes until you post, so a count can be taken over an afternoon and reconciled at the end."
          />
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Counted</TableHead>
              <TableHead>Where</TableHead>
              <TableHead>Who</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead>State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {counts.map((count) => (
              <TableRow key={count.id}>
                <TableCell>
                  <Link
                    href={`${BASE}/counts/${count.id}`}
                    className="font-medium tabular-nums hover:underline"
                  >
                    {count.countedOn}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {count.locationAssetId
                    ? (byId.get(count.locationAssetId) ?? "—")
                    : "Everywhere"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {count.countedBy || "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {lineCounts.get(count.id) ?? 0}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={count.status === "posted" ? "outline" : "default"}
                  >
                    {COUNT_STATUS_LABELS[count.status as CountStatus] ??
                      count.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTable>
    </div>
  );
}
