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
import {
  COUNT_STATUS_LABELS,
  type CountStatus,
} from "@/packs/inventory/vocabulary";
import {
  AddCountLineForm,
  PostCountButton,
  RemoveCountLineButton,
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
        listItems(tx, ctx.tenant.id, { status: "active" }),
        listLots(tx, ctx.tenant.id, { status: "open" }),
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
            {isDraft && (
              <>
                <AddCountLineForm
                  countId={count.id}
                  items={items.map((i) => ({
                    id: i.id,
                    name: i.name,
                    unit: i.stockingUnit,
                  }))}
                  lots={lots.map((l) => ({
                    id: l.id,
                    itemId: l.itemId,
                    code: l.code,
                  }))}
                />
                <PostCountButton
                  countId={count.id}
                  lineCount={lines.length}
                  today={today}
                />
              </>
            )}
          </div>
        }
      />

      {/* The strip's Counting tab is highlighted here and goes exactly where
          the old `‹ Counting` link went, so the hand-rolled one is gone. */}
      <InventoryNav isOwner={ctx.role === "owner"} />

      <DataTable
        isEmpty={lines.length === 0}
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
            {lines.map((line) => {
              const item = itemById.get(line.itemId);
              const unit = item?.stockingUnit ?? "each";
              const variance =
                line.expectedQuantity === null
                  ? null
                  : Math.round(
                      (line.countedQuantity - line.expectedQuantity) * 10_000,
                    ) / 10_000;
              return (
                <TableRow key={line.id}>
                  <TableCell>
                    <Link
                      href={`${BASE}/${line.itemId}`}
                      className="font-medium hover:underline"
                    >
                      {item?.name ?? "—"}
                    </Link>
                    {line.notes && (
                      <div className="text-xs text-muted-foreground">
                        {line.notes}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {line.lotId
                      ? (lotById.get(line.lotId)?.code ?? "—")
                      : "All of it"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQuantity(line.countedQuantity, unit)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {line.expectedQuantity === null
                      ? "—"
                      : formatQuantity(line.expectedQuantity, unit)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {variance === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : variance === 0 ? (
                      <span className="text-muted-foreground">Agreed</span>
                    ) : (
                      /* A shortfall is the one worth noticing: stock that is
                         not there cost money and may keep going. */
                      <span
                        className={
                          variance < 0 ? "text-destructive" : undefined
                        }
                      >
                        {variance > 0 ? "+" : "−"}
                        {formatQuantity(Math.abs(variance), unit)}
                      </span>
                    )}
                  </TableCell>
                  {isDraft && (
                    <TableCell className="text-right">
                      <RemoveCountLineButton id={line.id} />
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataTable>

      {isDraft && lines.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing has changed yet. Posting turns every disagreement into an
          adjustment at once — and lines that agree write nothing, because there
          is no event in &ldquo;nothing happened&rdquo;.
        </p>
      )}
    </div>
  );
}
