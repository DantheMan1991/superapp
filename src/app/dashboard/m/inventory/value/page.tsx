import Link from "next/link";
import { Coins } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { formatMoneySign } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { DataTable } from "@/components/app/data-table";
import { FilterPills } from "@/components/app/filter-pills";
import { StatCard } from "@/components/app/stat-card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listEnterprises } from "@/lib/enterprises";
import {
  ENTERPRISE_FALLBACK,
  ENTERPRISE_LABEL_KEY,
} from "@/lib/enterprises/vocabulary";
import { labelFor } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import {
  listKindsInUse,
  listLocations,
  valueStock,
  NO_ENTERPRISE_FILTER,
  NO_PLACE,
} from "@/packs/inventory/ops";
import {
  AsOfPicker,
  ExportValuationButton,
} from "@/packs/inventory/components/valuation-controls";
import { InventoryNav } from "@/packs/inventory/components/inventory-nav";
import {
  VALUATION_METHOD_NOTES,
  slugLabel,
} from "@/packs/inventory/vocabulary";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/inventory";

/**
 * **WHAT THE SHELF IS WORTH.**
 *
 * The page that finally answers the third of the design's three layers —
 * quantities, cost accumulation, and financial presentation. Nothing here posts
 * to the ledger; this is the number a posting WOULD write, on a screen where a
 * person can disagree with it first.
 *
 * **THE INCOMPLETE BANNER IS THE POINT OF THE PAGE, not a warning bolted onto
 * it.** A total on its own cannot be checked — "$4,200" reads identically
 * whether it covers the whole farm or everything except three pens of birds
 * nobody costed. If a later change moves the total somewhere the caveat does not
 * follow, that is the defect. **The export is held to the same rule**: the
 * caveat is the first line of the file.
 */
export default async function InventoryValuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "inventory");

  const today = todayInTimezone(ctx.tenant.timezone);
  const currencySymbol = ctx.tenant.currencySymbol;
  // A balance sheet is always as of a day. Defaulting to today is the ordinary
  // case; the picker exists because the interesting question is usually about a
  // period end that has already passed.
  const asOf =
    typeof query.asOf === "string" && query.asOf ? query.asOf : today;

  /**
   * **THE SAME THREE PARAMETER NAMES THE HUB USES**, so a person who narrowed
   * the item list and then opened this page finds the words in the same place
   * and the URL saying the same thing. Divergent grammar for one screen is how
   * a product ends up with `?place=` and `?location=` meaning one idea.
   */
  const kind = typeof query.kind === "string" ? query.kind : undefined;
  const enterprise =
    typeof query.enterprise === "string" ? query.enterprise : undefined;
  const place = typeof query.place === "string" ? query.place : undefined;

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [valuation, kinds, enterprises, places, pack] = await Promise.all([
        valueStock(tx, ctx.tenant.id, {
          asOf,
          kind,
          enterpriseId: enterprise,
          locationAssetId: place,
        }),
        listKindsInUse(tx, ctx.tenant.id, { status: "active" }),
        listEnterprises(tx, ctx.tenant.id, { status: "active" }),
        listLocations(tx, ctx.tenant.id),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "inventory"),
      ]);
      return { valuation, kinds, enterprises, places, labels: pack.labels };
    },
    { role: ctx.role },
  );

  const { valuation, kinds, enterprises, places, labels } = data;
  const enterpriseWord = labelFor(
    labels,
    ENTERPRISE_LABEL_KEY,
    ENTERPRISE_FALLBACK,
  );

  const placeName =
    place === NO_PLACE
      ? "Not recorded"
      : (places.find((p) => p.id === place)?.name ?? null);
  const enterpriseName =
    enterprise === NO_ENTERPRISE_FILTER
      ? "None"
      : (enterprises.find((e) => e.id === enterprise)?.name ?? null);
  const narrowed = Boolean(kind || enterprise || place);

  /** A link that changes one filter and keeps the date and the other two. */
  function urlWith(change: {
    kind?: string | null;
    enterprise?: string | null;
    place?: string | null;
  }) {
    const q = new URLSearchParams();
    q.set("asOf", asOf);
    const next = {
      kind: change.kind === undefined ? kind : change.kind,
      enterprise:
        change.enterprise === undefined ? enterprise : change.enterprise,
      place: change.place === undefined ? place : change.place,
    };
    if (next.kind) q.set("kind", next.kind);
    if (next.enterprise) q.set("enterprise", next.enterprise);
    if (next.place) q.set("place", next.place);
    return `?${q.toString()}`;
  }

  return (
    <div className="space-y-6">
      {/* The hand-rolled `‹ Inventory` link that used to sit beside the picker
          is gone: the strip below goes everywhere it went, from every page in
          the pack rather than only this one. */}
      <PageHeader
        title="What it is worth"
        description="The cost standing in stock on hand. Not what it would sell for — what it cost to have."
        icon={<Coins />}
        /**
         * **KEYED ON THE DATE, so Back and Forward re-sync the box.** The
         * picker seeds `useState` from this prop, and React keeps state across
         * a prop change — so walking the dates with the back button left the
         * field showing one day and the figures another, defeating the exact
         * behaviour the component's own doc comment names as its design goal.
         * `key` is React's answer to resetting state on a prop change, and it
         * is what the item filter bar already does with its search box.
         */
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <AsOfPicker key={asOf} asOf={asOf} today={today} />
            <ExportValuationButton
              asOf={asOf}
              kind={kind}
              enterpriseId={enterprise}
              locationAssetId={place}
            />
          </div>
        }
      />

      <InventoryNav isOwner={ctx.role === "owner"} />

      {/**
       * **NO COUNTS ON THESE PILLS, unlike the hub's.** Each one would be a
       * separate fold over a different population as of the same date — three
       * more queries to answer a question the caveat card below already
       * answers better. The hub's counts are free because `listKindsInUse`
       * already groups; these would not be.
       */}
      <div className="space-y-3">
        <FilterPills
          activeKey={kind ?? ""}
          items={[
            // ALL IS A PILL, not the absence of one — the same rule the hub's
            // bar follows, so being unfiltered is visible rather than inferred.
            { key: "", label: "All", href: urlWith({ kind: null }) },
            ...kinds.map((k) => ({
              key: k.kind,
              label: slugLabel(k.kind),
              href: urlWith({ kind: k.kind }),
            })),
          ]}
        />

        {enterprises.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {enterpriseWord}
            </span>
            <FilterPills
              activeKey={enterprise ?? ""}
              items={[
                { key: "", label: "All", href: urlWith({ enterprise: null }) },
                ...enterprises.map((e) => ({
                  key: e.id,
                  label: e.name,
                  href: urlWith({ enterprise: e.id }),
                })),
                {
                  key: NO_ENTERPRISE_FILTER,
                  label: "Not set",
                  href: urlWith({ enterprise: NO_ENTERPRISE_FILTER }),
                },
              ]}
            />
          </div>
        )}

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

      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label={
            placeName ? `At ${placeName} on ${asOf}` : `On hand at ${asOf}`
          }
          /* **SIGNED.** `core/valuation.ts` sums negative lines as they
             fall, on purpose — "a correction landing after stock has left is a
             real disagreement somebody should see" — and an unsigned total
             hides exactly that. */
          value={formatMoneySign(valuation.total.valueCents, currencySymbol)}
          footnote={
            valuation.total.valuedLines === 0
              ? "Nothing on hand that anybody has costed."
              : `Across ${valuation.total.valuedLines} ${
                  valuation.total.valuedLines === 1 ? "line" : "lines"
                } of stock${narrowed ? ", narrowed" : ""}.`
          }
        />

        {/**
         * NEVER LET THE TOTAL TRAVEL ALONE. Understated by an unknown amount is
         * a different fact from understated by nothing.
         *
         * The old card carried a `TriangleAlert` glyph and a `border-destructive/40`
         * edge. Both are dropped, and the `tone` carries it instead: the panel
         * is elevated rather than outlined under this design, so an extra
         * border draws the boundary twice — and the figure is the thing that
         * should be red, not the box around it.
         */}
        <StatCard
          label="What this figure leaves out"
          value={
            valuation.total.incomplete
              ? valuation.total.unvaluedLines
              : "Nothing"
          }
          tone={valuation.total.incomplete ? "destructive" : "default"}
          footnote={
            valuation.total.incomplete
              ? `${
                  valuation.total.unvaluedLines === 1
                    ? "One batch has"
                    : `${valuation.total.unvaluedLines} batches have`
                } no cost recorded — ${valuation.total.unvaluedQuantity} in all. The stock total is short by whatever they are worth, which nobody has said. Raised stock has no purchase price, so this is ordinary rather than a mistake.`
              : "Every batch on hand carries a cost, so the stock total is the whole of it."
          }
        />
      </div>

      {placeName && (
        /**
         * **WITH A PLACE PICKED, `Worth` MEANS SOMETHING ELSE, and the page has
         * to say so.** Nothing anywhere records what a shelf of a batch cost,
         * so a batch's figure is split by how much of it is here. It is an
         * apportionment rather than a measurement, and a reader quoting the
         * number to an accountant is entitled to know which they have.
         */
        <p className="text-xs text-muted-foreground">
          Only what is at {placeName}. A batch has one cost and nothing records
          what each place&apos;s share of it was, so a batch&apos;s figure is
          split by how much of it is here. Where that cannot be done honestly
          the line reads <span className="font-medium">Cannot be split</span>{" "}
          and counts against the total above.
        </p>
      )}

      <section>
        <h2 className="mb-3 font-heading text-xl font-semibold tracking-heading">
          Batch by batch
        </h2>

        {/**
         * **ONE FOLD, RENDERED TWICE.** Cards below `md` and the table above
         * it, the pattern every other screen in this pack uses since slice 2 —
         * this page was the last one still handing a phone a five-column table
         * to scroll sideways.
         */}
        {valuation.rows.length > 0 && (
          <ul className="space-y-3 md:hidden">
            {valuation.rows.map((row) => (
              <li
                key={`${row.itemId}:${row.lotId ?? ""}`}
                className="rounded-lg border bg-card p-4 shadow-xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`${BASE}/${row.itemId}`}
                      className="font-medium hover:underline"
                    >
                      {row.itemName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {row.lotCode ?? "No batch"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-medium tabular-nums">
                      {row.valueCents === null ? (
                        <span className="text-muted-foreground">Not known</span>
                      ) : (
                        formatMoneySign(row.valueCents, currencySymbol)
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {row.quantity} {row.unit}
                    </p>
                  </div>
                </div>
                <div className="mt-2">
                  <Badge
                    variant={
                      row.method === "none" || row.method === "unsplit"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {VALUATION_METHOD_NOTES[row.method].label}
                  </Badge>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {VALUATION_METHOD_NOTES[row.method].note}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="hidden md:block">
          {/* `DataTable` scrolls its own overflow, so the hand-rolled
              `overflow-x-auto` wrapper that used to sit here is gone. */}
          <DataTable
            isEmpty={valuation.rows.length === 0}
            empty={
              <EmptyState
                title="Nothing on hand"
                description={
                  narrowed
                    ? "Nothing here matches what you have narrowed it to. Widen the filters above."
                    : "Receive some stock and what it cost will stand here."
                }
              />
            }
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>What</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead>How it was valued</TableHead>
                  <TableHead className="text-right">Worth</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {valuation.rows.map((row) => (
                  <TableRow key={`${row.itemId}:${row.lotId ?? ""}`}>
                    <TableCell>
                      <Link
                        href={`${BASE}/${row.itemId}`}
                        className="hover:underline"
                      >
                        {row.itemName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.lotCode ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.quantity} {row.unit}
                    </TableCell>
                    <TableCell className="max-w-[24rem] whitespace-normal">
                      {/* A reader is entitled to know which of the five
                            they are looking at: one is measured, one is an
                            average over a fungible item, one is a share of a
                            batch, and two are admissions. */}
                      <Badge
                        variant={
                          row.method === "none" || row.method === "unsplit"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {VALUATION_METHOD_NOTES[row.method].label}
                      </Badge>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {VALUATION_METHOD_NOTES[row.method].note}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.valueCents === null ? (
                        <span className="text-muted-foreground">Not known</span>
                      ) : (
                        /* Signed for the same reason as the total: a batch
                           issued below zero carries a negative, and unsigned it
                           read as though it were worth that much. */
                        formatMoneySign(row.valueCents, currencySymbol)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
        </div>

        {valuation.rows.length === 0 && (
          <div className="md:hidden">
            <EmptyState
              title="Nothing on hand"
              description={
                narrowed
                  ? "Nothing here matches what you have narrowed it to. Widen the filters above."
                  : "Receive some stock and what it cost will stand here."
              }
            />
          </div>
        )}
      </section>

      {narrowed && (
        <p className="text-xs text-muted-foreground">
          Showing {placeName ? `${placeName}` : "everything"}
          {kind ? `, ${slugLabel(kind)}` : ""}
          {enterpriseName ? `, ${enterpriseName}` : ""}.{" "}
          <Link href={`?asOf=${asOf}`} className="underline">
            Show everything
          </Link>
        </p>
      )}
    </div>
  );
}
