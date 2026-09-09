import Link from "next/link";
import { History } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { formatMoney } from "@/lib/money";
import { pageFrom, pageWindow, searchTerm } from "@/lib/list-query";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { DataTable } from "@/components/app/data-table";
import { FilterPills } from "@/components/app/filter-pills";
import { LinkRow } from "@/components/app/link-row";
import { ListSearch } from "@/components/app/list-search";
import { Pager } from "@/components/app/pager";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  countEntries,
  listEntries,
  listKindsInUse,
  listLocations,
  NO_PLACE,
} from "@/packs/inventory/ops";
import { InventoryNav } from "@/packs/inventory/components/inventory-nav";
import { formatQuantity } from "@/packs/inventory/core/units";
import {
  adjustmentReasonLabel,
  movementKindLabel,
  slugLabel,
} from "@/packs/inventory/vocabulary";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/inventory";

/** Long enough to read a week of a busy business in one page, short enough to load on a phone. */
const PER_PAGE = 50;

/**
 * **EVERY ENTRY EVER RECORDED, newest first, across everything.**
 *
 * Every figure in this pack is a fold over these rows and nothing anywhere
 * writes a balance down — so this is not a log of what the software did, it IS
 * the record. Until 2026-09-09 the only way to read it was one item at a time,
 * twenty five rows deep, with nothing saying the rest existed; *what happened
 * on Tuesday* had no screen at all.
 *
 * **A SEARCH AND PAGES, AS URL STATE.** The term, the kind, the place and the
 * page are all in the address, so a question survives a refresh and can be
 * sent. The same three filter names the hub and the valuation use.
 */
export default async function InventoryEntriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "inventory");

  const currencySymbol = ctx.tenant.currencySymbol;
  const q = searchTerm(typeof query.q === "string" ? query.q : "");
  const kind = typeof query.kind === "string" ? query.kind : undefined;
  const place = typeof query.place === "string" ? query.place : undefined;
  const page = pageFrom(typeof query.page === "string" ? query.page : undefined);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const filter = { q: q || undefined, kind, locationAssetId: place };
      // The count first, so a stale link past the end lands on the last page
      // rather than on an empty one.
      const total = await countEntries(tx, ctx.tenant.id, filter);
      const window = pageWindow(page, PER_PAGE, total);
      const [entries, kinds, places] = await Promise.all([
        listEntries(tx, ctx.tenant.id, {
          ...filter,
          limit: PER_PAGE,
          offset: window.offset,
        }),
        listKindsInUse(tx, ctx.tenant.id),
        listLocations(tx, ctx.tenant.id),
      ]);
      return { entries, kinds, places, window };
    },
    { role: ctx.role },
  );

  const { entries, kinds, places, window } = data;
  const placeName =
    place === NO_PLACE
      ? "No place"
      : (places.find((p) => p.id === place)?.name ?? null);
  const narrowed = Boolean(q || kind || place);

  /** A link that changes one thing and keeps the rest — and drops the page, because a new question starts on page one. */
  function urlWith(change: {
    kind?: string | null;
    place?: string | null;
    page?: number;
  }) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const nextKind = change.kind === undefined ? kind : change.kind;
    const nextPlace = change.place === undefined ? place : change.place;
    if (nextKind) params.set("kind", nextKind);
    if (nextPlace) params.set("place", nextPlace);
    if (change.page && change.page > 1) params.set("page", String(change.page));
    const s = params.toString();
    return s ? `?${s}` : `${BASE}/entries`;
  }

  /** `+40 pounds` / `−12 packages`, in the row's own unit. */
  function amount(quantity: number, unit: string) {
    return `${quantity > 0 ? "+" : ""}${formatQuantity(quantity, unit)}`;
  }

  /** The batch it left, and the batch that ate it when there is one. */
  function batches(row: (typeof entries)[number]) {
    const parts: string[] = [];
    if (row.lotCode) parts.push(row.lotCode);
    if (row.consumerCode) parts.push(`fed to ${row.consumerCode}`);
    return parts.length > 0 ? parts.join(" · ") : null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="What happened"
        description="Every entry ever recorded, newest first. Every figure in this pack is added up from these."
        icon={<History />}
      />

      <InventoryNav isOwner={ctx.role === "owner"} />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <ListSearch placeholder="Search what, batch, reason or note" />
        </div>
        <FilterPills
          activeKey={kind ?? ""}
          items={[
            { key: "", label: "All", href: urlWith({ kind: null }) },
            ...kinds.map((k) => ({
              key: k.kind,
              label: slugLabel(k.kind),
              href: urlWith({ kind: k.kind }),
            })),
          ]}
        />
        {places.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Place</span>
            <FilterPills
              activeKey={place ?? ""}
              items={[
                { key: "", label: "All", href: urlWith({ place: null }) },
                ...places.map((p) => ({
                  key: p.id,
                  label: p.name,
                  href: urlWith({ place: p.id }),
                })),
                {
                  key: NO_PLACE,
                  label: "No place",
                  href: urlWith({ place: NO_PLACE }),
                },
              ]}
            />
          </div>
        )}
      </div>

      {/**
       * **ONE FOLD, RENDERED TWICE.** Cards below `md`, the table above — the
       * shape every list in this pack has since slice 2.
       */}
      {entries.length > 0 && (
        <ul className="space-y-3 md:hidden">
          {entries.map((row) => {
            const m = row.movement;
            return (
              <li key={m.id} className="rounded-2xl bg-card p-4 shadow-elevation-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`${BASE}/${m.itemId}`}
                      className="font-medium hover:underline"
                    >
                      {row.itemName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {movementKindLabel(m.movementKind)}
                      {m.reason && ` · ${adjustmentReasonLabel(m.reason)}`}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {m.occurredOn}
                      {row.placeName && ` · ${row.placeName}`}
                      {batches(row) && ` · ${batches(row)}`}
                    </p>
                    {m.notes && (
                      <p className="mt-1 text-xs text-muted-foreground">{m.notes}</p>
                    )}
                  </div>
                  <p className="shrink-0 text-right tabular-nums">
                    <span className="font-medium">{amount(m.quantity, row.unit)}</span>
                    {m.costCents !== null && (
                      <span className="block text-xs text-muted-foreground">
                        {formatMoney(m.costCents, currencySymbol)}
                      </span>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className={entries.length > 0 ? "hidden md:block" : ""}>
        <DataTable
          isEmpty={entries.length === 0}
          empty={
            <EmptyState
              title={narrowed ? "Nothing matches" : "Nothing recorded yet"}
              description={
                narrowed
                  ? "No entry matches what you have narrowed it to. Clear the search or widen the filters."
                  : "Record a delivery or some stock going out, and it will be the first line here."
              }
            />
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>What</TableHead>
                <TableHead>What happened</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Where</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((row) => {
                const m = row.movement;
                return (
                  <LinkRow key={m.id} href={`${BASE}/${m.itemId}`}>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {m.occurredOn}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`${BASE}/${m.itemId}`}
                        className="hover:underline"
                      >
                        {row.itemName}
                      </Link>
                    </TableCell>
                    {/* Free text wraps, or one long note widens the whole
                        table — the item page learned this on 2026-09-09. */}
                    <TableCell className="max-w-[22rem] whitespace-normal">
                      {movementKindLabel(m.movementKind)}
                      {m.reason && (
                        <div className="text-xs text-muted-foreground">
                          {adjustmentReasonLabel(m.reason)}
                        </div>
                      )}
                      {m.notes && (
                        <div className="text-xs text-muted-foreground">{m.notes}</div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">
                      {batches(row) ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.placeName ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {amount(m.quantity, row.unit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.costCents === null
                        ? "—"
                        : formatMoney(m.costCents, currencySymbol)}
                    </TableCell>
                  </LinkRow>
                );
              })}
            </TableBody>
          </Table>
        </DataTable>
      </div>

      <Pager
        window={window}
        noun={{ one: "entry", many: "entries" }}
        hrefFor={(p) => urlWith({ page: p })}
      />

      {narrowed && (
        /* The same line the valuation ends on: what is in force, and one link
           that clears all of it — the search box included. */
        <p className="text-xs text-muted-foreground">
          Showing {placeName ?? "everywhere"}
          {kind ? `, ${slugLabel(kind)}` : ""}
          {q ? `, matching “${q}”` : ""}.{" "}
          <Link href={`${BASE}/entries`} className="underline">
            Show everything
          </Link>
        </p>
      )}
    </div>
  );
}
