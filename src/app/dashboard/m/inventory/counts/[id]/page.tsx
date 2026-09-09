import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { DataTable } from "@/components/app/data-table";
import { InventoryNav } from "@/packs/inventory/components/inventory-nav";
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
  countLines,
  getCount,
  listItems,
  listLocations,
  listLots,
} from "@/packs/inventory/ops";
import { formatQuantity } from "@/packs/inventory/core/units";
import { lineVariance } from "@/packs/inventory/core/counts";
import {
  COUNT_STATUS_LABELS,
  type CountStatus,
} from "@/packs/inventory/vocabulary";
import {
  AddCountLineForm,
  PostCountButton,
  RemoveCountLineButton,
  StartCountForm,
} from "@/packs/inventory/components/count-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/inventory";

/**
 * One count: what was found, and — once posted — what the record had thought.
 *
 * **THE EXPECTED COLUMN IS EMPTY UNTIL IT IS POSTED, and that is the design
 * rather than a gap.** A count is worth nothing if the screen tells the person
 * with the clipboard what answer to write. The comparison is the output of
 * counting, not an input to it.
 *
 * **A CARD PER SHELF BELOW `md`.** This is the screen walked in a freezer with
 * a phone, and at 375px the table was 564px wide with `Remove` off the right
 * edge. One `rows` fold feeds both shapes; CSS picks.
 */
export default async function InventoryCountPage({
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
      const count = await getCount(tx, ctx.tenant.id, id);
      if (!count) return null;
      const [lines, items, lots, locations] = await Promise.all([
        countLines(tx, ctx.tenant.id, id),
        // EVERY item and EVERY batch, retired and closed ones included: a
        // posted count keeps its line for a thing retired since, and the
        // name and unit on that line have to resolve. The dialog is offered
        // the active and open ones only.
        listItems(tx, ctx.tenant.id),
        listLots(tx, ctx.tenant.id),
        listLocations(tx, ctx.tenant.id),
      ]);
      return { count, lines, items, lots, locations };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { count, lines, items, lots, locations } = data;
  const isDraft = count.status === "draft";
  const itemById = new Map(items.map((i) => [i.id, i]));
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const placeName = count.locationAssetId
    ? (locations.find((l) => l.id === count.locationAssetId)?.name ?? "—")
    : "Everywhere";

  const rows = lines.map((line) => {
    const item = itemById.get(line.itemId);
    const unit = item?.stockingUnit ?? "each";
    return {
      line,
      name: item?.name ?? "—",
      unit,
      batch: line.lotId ? (lotById.get(line.lotId)?.code ?? "—") : "All of it",
      counted: formatQuantity(line.countedQuantity, unit),
      expected:
        line.expectedQuantity === null
          ? null
          : formatQuantity(line.expectedQuantity, unit),
      variance: lineVariance(line.countedQuantity, line.expectedQuantity),
    };
  });

  /** `Agreed`, `+3 pounds`, `−3 pounds`, or a dash before posting. */
  function varianceCell(variance: number | null, unit: string) {
    if (variance === null) return <span className="text-muted-foreground">—</span>;
    if (variance === 0) return <span className="text-muted-foreground">Agreed</span>;
    // A shortfall is the one worth noticing: stock that is not there cost
    // money and may keep going.
    return (
      <span className={variance < 0 ? "text-destructive" : undefined}>
        {variance > 0 ? "+" : "−"}
        {formatQuantity(Math.abs(variance), unit)}
      </span>
    );
  }

  const dialogItems = items
    .filter((i) => i.status === "active")
    .map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.stockingUnit,
      kind: i.itemKind,
    }));
  const dialogLots = lots
    .filter((l) => l.status === "open")
    .map((l) => ({ id: l.id, itemId: l.itemId, code: l.code }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Counted ${count.countedOn}`}
        icon={<ClipboardList />}
        description={`${placeName}${count.countedBy ? ` · ${count.countedBy}` : ""}${
          count.postedOn ? ` · posted ${count.postedOn}` : ""
        }`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isDraft ? "default" : "outline"}>
              {COUNT_STATUS_LABELS[count.status as CountStatus] ?? count.status}
            </Badge>
            {isDraft ? (
              <>
                <AddCountLineForm
                  countId={count.id}
                  items={dialogItems}
                  lots={dialogLots}
                  lines={lines.map((l) => ({
                    itemId: l.itemId,
                    lotId: l.lotId,
                    countedQuantity: l.countedQuantity,
                    notes: l.notes,
                  }))}
                />
                <PostCountButton
                  countId={count.id}
                  lineCount={lines.length}
                  today={today}
                  countedOn={count.countedOn}
                />
              </>
            ) : (
              /* THE HONEST REMEDY, on the screen. A posted count is frozen —
                 its variances are in the ledger — and the fix for one that
                 went wrong is the same walk again, at the same place. */
              <StartCountForm
                locations={locations.map((l) => ({ id: l.id, name: l.name }))}
                today={today}
                defaultLocationId={count.locationAssetId}
                trigger="Count again"
                variant="outline"
              />
            )}
          </div>
        }
      />

      {/* The strip's Counting tab is highlighted here and goes exactly where
          the old `‹ Counting` link went, so the hand-rolled one is gone. */}
      <InventoryNav isOwner={ctx.role === "owner"} />

      {count.notes && (
        /* Typed when the count was started and, until 2026-09-09, shown
           nowhere at all. It is the note for whoever walks the shelves. */
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Notes</span> ·{" "}
          {count.notes}
        </p>
      )}

      {rows.length === 0 ? (
        <DataTable
          isEmpty
          empty={
            <EmptyState
              /* Was a `ChevronLeft` — a back-arrow as the glyph for "nothing
                 counted yet", which is the wrong picture for the sentence. */
              icon={<ClipboardList className="h-5 w-5" />}
              title="Nothing counted yet"
              description="Add a line for each shelf as you walk it. What the record thinks is deliberately not shown until you post — a number on the screen is the fastest way to make a count agree with a record that is wrong."
            />
          }
        >
          {null}
        </DataTable>
      ) : (
        <>
          {/* Phone: one card per shelf, with everything the row holds and the
              Remove button where a thumb can reach it. */}
          <ul className="space-y-3 md:hidden">
            {rows.map((row) => (
              <li
                key={row.line.id}
                className="rounded-2xl bg-card p-4 shadow-elevation-1"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`${BASE}/${row.line.itemId}`}
                      className="font-medium hover:underline"
                    >
                      {row.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{row.batch}</p>
                    {row.line.notes && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.line.notes}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <p className="font-medium">{row.counted}</p>
                    <p className="text-xs text-muted-foreground">counted</p>
                  </div>
                </div>
                {!isDraft && (
                  <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-divider pt-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Record said
                      </dt>
                      <dd className="tabular-nums">{row.expected ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Difference
                      </dt>
                      <dd className="tabular-nums">
                        {varianceCell(row.variance, row.unit)}
                      </dd>
                    </div>
                  </dl>
                )}
                {isDraft && (
                  <div className="mt-2 flex justify-end">
                    <RemoveCountLineButton id={row.line.id} label={row.name} />
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* Wide screen: the table. */}
          <div className="hidden md:block">
            <DataTable>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>What</TableHead>
                    <TableHead>Batch</TableHead>
                    <TableHead className="text-right">Counted</TableHead>
                    <TableHead className="text-right">Record said</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                    {isDraft && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.line.id}>
                      <TableCell>
                        <Link
                          href={`${BASE}/${row.line.itemId}`}
                          className="font-medium hover:underline"
                        >
                          {row.name}
                        </Link>
                        {row.line.notes && (
                          <div className="text-xs text-muted-foreground">
                            {row.line.notes}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.batch}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.counted}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.expected ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {varianceCell(row.variance, row.unit)}
                      </TableCell>
                      {isDraft && (
                        <TableCell className="text-right">
                          <RemoveCountLineButton
                            id={row.line.id}
                            label={row.name}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DataTable>
          </div>
        </>
      )}

      {isDraft && rows.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing has changed yet. Posting turns every disagreement into an
          adjustment at once — and lines that agree write nothing, because there
          is no event in &ldquo;nothing happened&rdquo;.
        </p>
      )}
    </div>
  );
}
