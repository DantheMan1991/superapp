import Link from "next/link";
import { Boxes, SearchX } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { DataTable } from "@/components/app/data-table";
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
import { packContext } from "@/lib/packs/tenant-context";
import { isModuleEnabled } from "@/lib/modules";
import { labelFor } from "@/lib/packs/resolve";
import {
  expiringLots,
  listItems,
  listKindsInUse,
  listLocations,
  onHandByItem,
  valueStock,
} from "./ops";
import { slugLabel } from "./vocabulary";
import { formatQuantity } from "./core/units";
import { Button } from "@/components/ui/button";
import { todayInTimezone } from "@/lib/timezone";
import { formatMoney } from "@/lib/money";
import { ItemForm } from "./components/item-form";
import { ItemFilters } from "./components/item-filters";
import { InventoryNav } from "./components/inventory-nav";
import { listEnterprises } from "@/lib/enterprises";
import {
  ENTERPRISE_FALLBACK,
  ENTERPRISE_LABEL_KEY,
} from "@/lib/enterprises/vocabulary";

const BASE = "/dashboard/m/inventory";

/**
 * The `inventory` pack's home.
 *
 * THE DAY-ONE SCREEN IS "WHAT DO I HAVE AND WHERE". The pilot farm tracks
 * nothing and finds out by opening the freezer lid, so the first useful thing
 * this pack can do needs no history at all — just a list with a number beside
 * it. Everything cleverer is downstream of somebody bothering to record
 * anything, which is why this page is deliberately plain.
 */
export async function InventoryModule({
  ctx,
  searchParams,
}: {
  ctx: TenantContext;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const kindParam = searchParams.kind;
  const kind = typeof kindParam === "string" ? kindParam : undefined;
  const qParam = searchParams.q;
  const search = typeof qParam === "string" ? qParam.trim() : "";
  const entParam = searchParams.enterprise;
  const enterprise = typeof entParam === "string" ? entParam : undefined;
  const showArchived = searchParams.archived === "1";
  const filtering =
    Boolean(kind) || Boolean(search) || Boolean(enterprise) || showArchived;

  /**
   * Only signpost a module this tenant actually has. Pointing somebody at a
   * page that is not switched on is the "button that leads to a 404" mistake
   * `land` made with its parcel finder a day ago.
   */
  const livestockEnabled = await isModuleEnabled(ctx.tenant.id, "livestock");

  const today = todayInTimezone(ctx.tenant.timezone);
  /**
   * **HOW FAR AHEAD "SOON" IS.** Six weeks: long enough that a freezer full of
   * meat can still be sold or eaten rather than binned, short enough that the
   * panel is not a list of everything the business owns.
   */
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + 42 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const {
    items,
    onHand,
    kinds,
    locations,
    labels,
    expiring,
    enterprises,
    allItems,
    valuation,
  } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [
        items,
        onHand,
        kinds,
        locations,
        pack,
        expiring,
        enterprises,
        allItems,
        valuation,
      ] = await Promise.all([
        listItems(tx, ctx.tenant.id, {
          kind,
          search,
          enterprise,
          status: showArchived ? undefined : "active",
        }),
        onHandByItem(tx, ctx.tenant.id),
        listKindsInUse(tx, ctx.tenant.id),
        listLocations(tx, ctx.tenant.id),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "inventory"),
        // FIRST EXPIRED, FIRST OUT. A suggestion and never an enforcement:
        // the person holding the scoop can see which bag is already open.
        expiringLots(tx, ctx.tenant.id, { onOrBefore: horizon, limit: 12 }),
        listEnterprises(tx, ctx.tenant.id, { status: "active" }),
        /**
         * **UNFILTERED, FOR THE COUNTS ON THE PILLS.** Counting the FILTERED
         * list would make every pill read the number of rows currently showing,
         * so picking "Broilers" would leave every other pill at zero and the
         * bar would look like the data had gone.
         */
        listItems(tx, ctx.tenant.id, {
          status: showArchived ? undefined : "active",
        }),
        /**
         * **`asOf: today` RATHER THAN THE UNBOUNDED READ, so the headline
         * figure and the page it links to cannot disagree.** `/value` defaults
         * its picker to today; leaving this unbounded would sweep in
         * future-dated movements and the hub would quietly show a different
         * number from the screen it sends you to for the detail.
         */
        valueStock(tx, ctx.tenant.id, { asOf: today }),
      ]);
      return {
        items,
        onHand,
        kinds,
        locations,
        labels: pack.labels,
        expiring,
        enterprises,
        allItems,
        valuation,
      };
    },
    { role: ctx.role },
  );

  const isOwner = ctx.role === "owner";
  const currencySymbol = ctx.tenant.currencySymbol;
  const itemWord = labelFor(labels, "item", "Item");
  const enterpriseWord = labelFor(
    labels,
    ENTERPRISE_LABEL_KEY,
    ENTERPRISE_FALLBACK,
  );
  const enterpriseOptions = enterprises.map((e) => ({
    id: e.id,
    name: e.name,
  }));
  /**
   * Counted over the UNFILTERED list, and "none" is a pill of its own — see
   * `listItems`, where "what have I not tagged yet" is the question that makes
   * an explicit untagged filter worth having.
   */
  const byEnterprise = new Map<string, number>();
  let untagged = 0;
  for (const i of allItems) {
    if (i.enterpriseId) {
      byEnterprise.set(
        i.enterpriseId,
        (byEnterprise.get(i.enterpriseId) ?? 0) + 1,
      );
    } else {
      untagged += 1;
    }
  }

  return (
    <div className="space-y-6">
      {/**
       * **THE FOUR SECTION BUTTONS THAT USED TO LIVE HERE ARE NOW A STRIP.**
       * A header's actions are verbs, and Counting / What it is worth /
       * Deliveries & invoices / When it is deducted are places — rendered as
       * five identical outline buttons they read as one row of undifferentiated
       * chrome, with the one real action last because it was built last. See
       * `components/inventory-nav.tsx`.
       */}
      <PageHeader
        title="Inventory"
        description="What the business holds, where it is, and which batch it came from."
        icon={<Boxes />}
        actions={
          isOwner ? (
            <ItemForm
              kindsInUse={kinds.map((k) => k.kind)}
              enterprises={enterpriseOptions}
              enterpriseWord={enterpriseWord}
              livestockEnabled={livestockEnabled}
            />
          ) : undefined
        }
      />

      <InventoryNav isOwner={isOwner} />

      {/**
       * **STATS ONLY ONCE THERE IS STOCK TO COUNT**, on `allItems` rather than
       * the filtered `items` — the same argument the filter bar makes below.
       * Three figures over an empty farm is furniture, and a farm that holds
       * forty things should not lose its headline numbers to a search box.
       */}
      {allItems.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {/**
           * **THE TOTAL DOES NOT TRAVEL WITHOUT ITS CAVEAT**, and that is a
           * rule this page inherited rather than invented: `/value`'s own
           * header says *"if a later change moves the total somewhere the
           * caveat does not follow, that is the defect"*. So the shortfall is
           * in THIS card's footnote, not in the card beside it — cards reflow
           * to one column on a phone, and a neighbour is not "with it".
           */}
          <StatCard
            label="What it is worth"
            value={formatMoney(valuation.total.valueCents, currencySymbol)}
            href={`${BASE}/value`}
            tone="accent"
            footnote={
              valuation.total.incomplete
                ? `Short by ${valuation.total.unvaluedLines} ${
                    valuation.total.unvaluedLines === 1 ? "batch" : "batches"
                  } nobody has costed`
                : valuation.total.valuedLines === 0
                  ? "Nothing on hand that anybody has costed"
                  : "Every batch on hand carries a cost"
            }
          />
          {/**
           * Raised stock has no purchase price, so this is ordinarily non-zero
           * on a farm and is not styled as a fault. `destructive` would say
           * "something is broken" about a pen of chicks that was hatched.
           */}
          <StatCard
            label="Not costed"
            value={
              valuation.total.incomplete
                ? valuation.total.unvaluedLines
                : "None"
            }
            href={`${BASE}/value`}
            footnote={
              valuation.total.incomplete
                ? `${valuation.total.unvaluedQuantity} in all — raised stock has no purchase price`
                : "Every batch on hand has a cost recorded"
            }
          />
          <StatCard
            label="Going off soon"
            value={expiring.length === 0 ? "None" : expiring.length}
            tone={expiring.length > 0 ? "destructive" : "default"}
            footnote={
              expiring.length > 0
                ? "Within six weeks — soonest first, below"
                : "Nothing within six weeks"
            }
          />
        </div>
      )}

      {expiring.length > 0 && (
        <section>
          <h2 className="mb-3 font-heading text-xl font-semibold tracking-heading">
            Going off soon
          </h2>
          <DataTable>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>What</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Good until</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expiring.map((row) => (
                  <TableRow key={row.lot.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/dashboard/m/inventory/${row.lot.itemId}`}
                        className="hover:underline"
                      >
                        {row.itemName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.lot.code}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQuantity(row.balance, row.unit)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        row.lot.expiresOn && row.lot.expiresOn < today
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }`}
                    >
                      {row.lot.expiresOn}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
          <p className="mt-3 text-xs text-muted-foreground">
            {/* The design asks for the two views that prevent loss — oldest
                first, and expiring soon. Sorted by date IS both. */}
            Soonest first. Use these before the rest; nothing here refuses a
            later batch, because you can see which one is already open and this
            cannot.
          </p>
        </section>
      )}

      {/**
       * **THE BAR IS HIDDEN ON A FARM THAT HOLDS NOTHING, and shown the moment
       * one thing exists.** A filter over an empty list is furniture, and the
       * first screen somebody sees should be the one sentence telling them what
       * to add. `kinds` is empty in exactly that case, so it is the test.
       */}
      {kinds.length > 0 && (
        <ItemFilters
          base={BASE}
          kinds={kinds}
          activeKind={kind}
          /**
           * **THE ROW THAT ANSWERS "JUST CHICKEN".** A kind filter cannot: feed,
           * live birds and packaged meat are three kinds and one line of
           * business. Only rendered once a list exists and something carries a
           * tag — a row of pills over nothing is furniture.
           */
          enterprises={enterpriseOptions.map((e) => ({
            ...e,
            count: byEnterprise.get(e.id) ?? 0,
          }))}
          untaggedCount={untagged}
          activeEnterprise={enterprise}
          enterpriseWord={enterpriseWord}
          search={search}
          showArchived={showArchived}
          shown={items.length}
          itemWord={itemWord}
        />
      )}

      {/**
       * **`DataTable` SUPPLIES THE PANEL, so `EmptyState` no longer asks for
       * one.** `panel` on both states drew a second card inside the first —
       * which is why the prop is dropped here rather than kept "just in case".
       */}
      <DataTable
        isEmpty={items.length === 0}
        empty={
          /**
           * **"NOTHING MATCHES" AND "NOTHING TRACKED YET" ARE DIFFERENT FACTS,
           * and showing the second for the first is how a filter convinces
           * somebody their data is gone.** The old copy told an owner with
           * forty items and a stale search box to go and add their first one.
           */
          filtering ? (
            <EmptyState
              icon={<SearchX className="h-5 w-5" />}
              title="Nothing matches"
              description={
                search
                  ? `No ${itemWord.toLowerCase()} here has "${search}" in its name. Names are all this searches — a bag of feed for the beef herd is not called beef.`
                  : "Nothing under this filter. Retired things are hidden unless you ask for them."
              }
              action={
                <Button asChild variant="outline">
                  <Link href={BASE}>Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Boxes className="h-5 w-5" />}
              title="Nothing tracked yet"
              description={
                isOwner
                  ? `Add the first ${itemWord.toLowerCase()} you hold — feed, cartons, meat in a freezer. What it is measured in decides how every number about it reads, so it is worth a moment.`
                  : "An owner adds what the business holds. Once they do, it shows up here."
              }
            />
          )
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{itemWord}</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Keeps</TableHead>
              <TableHead className="text-right">On hand</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const balance = onHand.get(item.id) ?? null;
              return (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      <Link
                        href={`/dashboard/m/inventory/${item.id}`}
                        className="hover:underline"
                      >
                        {item.name}
                      </Link>
                      {item.status === "archived" && (
                        <Badge variant="outline">archived</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {slugLabel(item.itemKind)}
                    {/**
                     * **ONE THING, TWO VIEWS — and the row has to say so.**
                     * Market animals ARE inventory: head is a unit of measure
                     * and a pen is a batch, which is exactly what makes cost
                     * per pen fall out of the same ledger as the feed. But an
                     * item called "Broiler chicks" sitting here beside the feed
                     * reads as a duplicate of the Livestock page, and the
                     * founder asked which one he was supposed to add animals
                     * to. Nothing on either screen answered him.
                     */}
                    {item.itemKind === "livestock" && livestockEnabled && (
                      <Link
                        href="/dashboard/m/livestock"
                        className="ml-2 text-xs underline hover:text-foreground"
                      >
                        managed in Livestock
                      </Link>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.storageRequirement
                      ? slugLabel(item.storageRequirement)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {/* Nothing recorded is an em dash, not a zero. "None on
                        hand" and "never counted" are different facts, and on a
                        farm that has never tracked anything the second is the
                        common one. */}
                    {formatQuantity(balance, item.stockingUnit)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataTable>

      {items.length > 0 && locations.length === 0 && isOwner && (
        <p className="text-sm text-muted-foreground">
          {/* Locations ARE assets, so there is nothing to create here — which
              is the point of the pack split, said out loud where somebody
              hits it. */}
          Nothing has a place to live yet. Storage locations are assets — add a
          freezer or a barn under Assets and it becomes somewhere stock can sit.
        </p>
      )}
    </div>
  );
}
