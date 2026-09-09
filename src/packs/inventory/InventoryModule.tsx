import Link from "next/link";
import { Boxes, SearchX } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { DataTable } from "@/components/app/data-table";
import { LinkRow } from "@/components/app/link-row";
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
  NO_PLACE,
  expiringLots,
  listItems,
  listKindsInUse,
  listLocations,
  onHandByItem,
  onHandByPlace,
  valueStock,
} from "./ops";
import { slugLabel } from "./vocabulary";
import { formatQuantity } from "./core/units";
import { describeExpiring, expiryLabel, splitExpiring } from "./core/expiry";
import { Button } from "@/components/ui/button";
import { todayInTimezone } from "@/lib/timezone";
import { formatMoney } from "@/lib/money";
import { PasteListButton } from "@/components/app/paste-list-button";
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
 * **HOW FAR AHEAD "SOON" IS.** Six weeks: long enough that a freezer full of
 * meat can still be sold or eaten rather than binned, short enough that the
 * panel is not a list of everything the business owns.
 */
const SOON_DAYS = 42;
/** How many going-off rows the panel shows before saying how many more there are. */
const EXPIRING_SHOWN = 12;

/**
 * The `inventory` pack's home.
 *
 * THE DAY-ONE SCREEN IS "WHAT DO I HAVE AND WHERE". The pilot farm tracks
 * nothing and finds out by opening the freezer lid, so the first useful thing
 * this pack can do needs no history at all — just a list with a number beside
 * it. Everything cleverer is downstream of somebody bothering to record
 * anything, which is why this page is deliberately plain.
 *
 * **AND WHERE, since 2026-09-09.** The place row narrows the list to what has
 * stock in one freezer, barn or truck and shows that figure — the half of the
 * day-one question that was answered only one item page at a time. Below `md`
 * the list is a card per item, because at 375px the table's `On hand` column
 * sat off the right edge of the screen that is opened standing in the freezer.
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
  const placeParam = searchParams.place;
  const place = typeof placeParam === "string" && placeParam ? placeParam : undefined;
  const showArchived = searchParams.archived === "1";
  const filtering =
    Boolean(kind) ||
    Boolean(search) ||
    Boolean(enterprise) ||
    Boolean(place) ||
    showArchived;

  /**
   * Only signpost a module this tenant actually has. Pointing somebody at a
   * page that is not switched on is the "button that leads to a 404" mistake
   * `land` made with its parcel finder a day ago.
   */
  const livestockEnabled = await isModuleEnabled(ctx.tenant.id, "livestock");

  const today = todayInTimezone(ctx.tenant.timezone);
  const horizon = new Date(
    Date.parse(`${today}T00:00:00Z`) + SOON_DAYS * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);

  const {
    items,
    onHand,
    kinds,
    locations,
    labels,
    expiringAll,
    enterprises,
    allItems,
    valuation,
    byPlace,
  } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [
        items,
        onHand,
        kinds,
        locations,
        pack,
        expiringAll,
        enterprises,
        allItems,
        valuation,
        byPlace,
      ] = await Promise.all([
        listItems(tx, ctx.tenant.id, {
          kind,
          search,
          enterprise,
          status: showArchived ? undefined : "active",
        }),
        onHandByItem(tx, ctx.tenant.id),
        /**
         * **THE SAME POPULATION THE LIST SHOWS.** Counted over every status,
         * a pill read `Feed 5` above a list of four, because the list hides
         * retired things unless asked. Now the pill counts what the list would
         * show under the same toggle.
         */
        listKindsInUse(tx, ctx.tenant.id, {
          status: showArchived ? undefined : "active",
        }),
        listLocations(tx, ctx.tenant.id),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "inventory"),
        // FIRST EXPIRED, FIRST OUT. A suggestion and never an enforcement:
        // the person holding the scoop can see which bag is already open.
        // Read wide and counted honestly; the panel decides how many to show.
        expiringLots(tx, ctx.tenant.id, { onOrBefore: horizon, limit: 200 }),
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
        // What is in each place, one grouped query — the place pills' counts
        // and the figure the list shows once a place is picked.
        onHandByPlace(tx, ctx.tenant.id),
      ]);
      return {
        items,
        onHand,
        kinds,
        locations,
        labels: pack.labels,
        expiringAll,
        enterprises,
        allItems,
        valuation,
        byPlace,
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

  /**
   * **WHAT IS IN EACH PLACE**, counted over the same population as the other
   * pills (retired things only when they are showing). A place with nothing in
   * it keeps its pill with no figure: a freezer that stands empty is still a
   * place, and "nothing is in it" is the honest answer to picking it.
   */
  const shownIds = new Set(allItems.map((i) => i.id));
  const stockedIn = (placeKey: string) =>
    [...(byPlace.get(placeKey)?.keys() ?? [])].filter((id) => shownIds.has(id))
      .length;
  const places = locations.map((l) => ({
    id: l.id,
    name: l.name,
    count: stockedIn(l.id),
  }));
  const noPlaceCount = stockedIn(NO_PLACE);
  const placeNames = new Map(locations.map((l) => [l.id, l.name]));
  /**
   * With a place picked, the list is what has stock THERE and the figure is
   * that stock, not the item's total. An unknown `?place=` narrows to nothing
   * rather than to everything — the same answer `listItems` gives a malformed
   * enterprise, and for the same reason: a list under a bar claiming to be
   * filtered must not quietly be the whole list.
   */
  const placeStock = place ? (byPlace.get(place) ?? new Map<string, number>()) : null;
  const placeName = place
    ? place === NO_PLACE
      ? "no place"
      : (placeNames.get(place) ?? null)
    : null;

  /**
   * **PAST ITS DATE IS NOT "SOON".** Both halves are listed, past first
   * because the list arrives soonest-first, and each row says which it is in
   * words. The card counts everything the panel holds and its sentence says
   * how much of that is already lost.
   */
  const { past, soon } = splitExpiring(
    expiringAll.map((row) => ({ ...row, expiresOn: row.lot.expiresOn ?? today })),
    today,
  );
  const expiring = [...past, ...soon];
  const expiringShown = expiring.slice(0, EXPIRING_SHOWN);
  /** The soonest date per item, for a badge on its row. */
  const expiryByItem = new Map<string, { label: string; past: boolean }>();
  for (const row of expiring) {
    if (expiryByItem.has(row.lot.itemId)) continue;
    expiryByItem.set(row.lot.itemId, {
      label: expiryLabel(row.expiresOn, today, SOON_DAYS),
      past: row.expiresOn < today,
    });
  }

  const rows = (placeStock ? items.filter((i) => placeStock.has(i.id)) : items).map(
    (item) => ({
      item,
      href: `${BASE}/${item.id}`,
      /* Nothing recorded is an em dash, not a zero. "None on hand" and "never
         counted" are different facts, and on a farm that has never tracked
         anything the second is the common one. */
      balance: placeStock
        ? (placeStock.get(item.id) ?? null)
        : (onHand.get(item.id) ?? null),
      expiry: expiryByItem.get(item.id) ?? null,
      keeps: item.storageRequirement ? slugLabel(item.storageRequirement) : null,
      managedInLivestock: item.itemKind === "livestock" && livestockEnabled,
    }),
  );
  const onHandHeading = placeName
    ? place === NO_PLACE
      ? "On hand, no place"
      : `On hand at ${placeName}`
    : "On hand";

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
            <div className="flex flex-wrap items-center gap-2">
              <PasteListButton
                slug="inventory.items"
                label="kinds of stock"
                noun={{ one: "kind of stock", many: "kinds of stock" }}
                example={"Layer pellets, feed, 50 lb bag\nEggs, dozen\nFence staples, each"}
              />
              <ItemForm
                kindsInUse={kinds.map((k) => k.kind)}
                enterprises={enterpriseOptions}
                enterpriseWord={enterpriseWord}
                livestockEnabled={livestockEnabled}
              />
            </div>
          ) : undefined
        }
      />

      <InventoryNav isOwner={isOwner} />

      {/**
       * **STATS ONLY ONCE THERE IS STOCK TO COUNT**, on `allItems` rather than
       * the filtered `items` — the same argument the filter bar makes below.
       * Three figures over an empty farm is furniture, and a farm that holds
       * forty things should not lose its headline numbers to a search box.
       *
       * Two-up on a phone with the third spanning: one per row pushed the
       * first item to y=998 at 375px.
       */}
      {allItems.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {/**
           * **THE TOTAL DOES NOT TRAVEL WITHOUT ITS CAVEAT**, and that is a
           * rule this page inherited rather than invented: `/value`'s own
           * header says *"if a later change moves the total somewhere the
           * caveat does not follow, that is the defect"*. So the shortfall is
           * in THIS card's footnote, not in the card beside it — cards reflow
           * on a phone, and a neighbour is not "with it".
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
          {/* Red only when something is already lost; a shelf to use first is
              the accent, not a fault. The card is a link to its own panel. */}
          <StatCard
            label="Going off soon"
            value={expiring.length === 0 ? "None" : expiring.length}
            tone={
              past.length > 0
                ? "destructive"
                : soon.length > 0
                  ? "accent"
                  : "default"
            }
            href={expiring.length > 0 ? "#going-off" : undefined}
            footnote={describeExpiring(past.length, soon.length)}
            className="col-span-2 sm:col-span-1"
          />
        </div>
      )}

      {expiring.length > 0 && (
        <section id="going-off" className="scroll-mt-24">
          <h2 className="mb-3 font-heading text-xl font-semibold tracking-heading">
            Going off soon
          </h2>
          {/* Phone: a card per batch, the whole card opening the item. */}
          <ul className="space-y-3 md:hidden">
            {expiringShown.map((row) => (
              <li key={row.lot.id}>
                <Link
                  href={`${BASE}/${row.lot.itemId}`}
                  className="block rounded-2xl bg-card p-4 shadow-elevation-1 transition-shadow hover:shadow-elevation-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{row.itemName}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.lot.code}
                      </p>
                    </div>
                    <p className="shrink-0 text-right font-medium tabular-nums">
                      {formatQuantity(row.balance, row.unit)}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge
                      variant={row.expiresOn < today ? "destructive" : "outline"}
                    >
                      {expiryLabel(row.expiresOn, today, SOON_DAYS)}
                    </Badge>
                    <span className="tabular-nums">{row.expiresOn}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
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
                  {expiringShown.map((row) => (
                    <LinkRow key={row.lot.id} href={`${BASE}/${row.lot.itemId}`}>
                      <TableCell className="font-medium">
                        <Link
                          href={`${BASE}/${row.lot.itemId}`}
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
                          row.expiresOn < today
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {row.expiresOn}
                        <span className="block text-xs">
                          {expiryLabel(row.expiresOn, today, SOON_DAYS)}
                        </span>
                      </TableCell>
                    </LinkRow>
                  ))}
                </TableBody>
              </Table>
            </DataTable>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {/* The design asks for the two views that prevent loss — oldest
                first, and expiring soon. Sorted by date IS both. */}
            Soonest first
            {expiring.length > expiringShown.length &&
              ` — ${expiringShown.length} of ${expiring.length} shown`}
            . Use these before the rest; nothing here refuses a later batch,
            because you can see which one is already open and this cannot.
          </p>
        </section>
      )}

      {/**
       * **THE BAR IS HIDDEN ON A FARM THAT HOLDS NOTHING, and shown the moment
       * one thing exists.** A filter over an empty list is furniture, and the
       * first screen somebody sees should be the one sentence telling them what
       * to add. `allItems` is empty in exactly that case, so it is the test —
       * `kinds` no longer is, because it now follows the retired toggle.
       */}
      {allItems.length > 0 && (
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
          places={places}
          noPlaceCount={noPlaceCount}
          activePlace={place}
          search={search}
          showArchived={showArchived}
          shown={rows.length}
          itemWord={itemWord}
        />
      )}

      {rows.length === 0 ? (
        /**
         * **`DataTable` SUPPLIES THE PANEL, so `EmptyState` no longer asks for
         * one.** And **"NOTHING MATCHES" AND "NOTHING TRACKED YET" ARE
         * DIFFERENT FACTS**: showing the second for the first is how a filter
         * convinces somebody their data is gone.
         */
        <DataTable
          isEmpty
          empty={
            filtering ? (
              <EmptyState
                icon={<SearchX className="h-5 w-5" />}
                title="Nothing matches"
                description={
                  search
                    ? `No ${itemWord.toLowerCase()} here has "${search}" in its name. Names are all this searches — a bag of feed for the beef herd is not called beef.`
                    : place
                      ? place === NO_PLACE
                        ? "Everything with stock has a place recorded."
                        : `Nothing has stock ${placeName ? `at ${placeName}` : "there"}.`
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
          {null}
        </DataTable>
      ) : (
        <>
          {/* Phone: one card per item, and the whole card opens it. The
              figure is the one thing a stockroom wants and it is on the right,
              where the table put it off the screen. */}
          <ul className="space-y-3 md:hidden">
            {rows.map((row) => (
              <li key={row.item.id}>
                <Link
                  href={row.href}
                  className="block rounded-2xl bg-card p-4 shadow-elevation-1 transition-shadow hover:shadow-elevation-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                        <span className="truncate">{row.item.name}</span>
                        {row.item.status === "archived" && (
                          <Badge variant="outline">retired</Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {slugLabel(row.item.itemKind)}
                        {row.keeps && ` · ${row.keeps}`}
                        {/* Plain text here: the card is already a link, and
                            a link inside a link is not a thing. */}
                        {row.managedInLivestock && " · managed in Livestock"}
                      </p>
                    </div>
                    <p className="shrink-0 text-right tabular-nums">
                      <span className="font-medium">
                        {formatQuantity(row.balance, row.item.stockingUnit)}
                      </span>
                      {placeName && (
                        <span className="block text-xs text-muted-foreground">
                          {place === NO_PLACE ? "no place" : `at ${placeName}`}
                        </span>
                      )}
                    </p>
                  </div>
                  {row.expiry && (
                    <div className="mt-2">
                      <Badge variant={row.expiry.past ? "destructive" : "outline"}>
                        {row.expiry.label}
                      </Badge>
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>

          {/* Wide screen: the table, and the whole row opens the item. */}
          <div className="hidden md:block">
            <DataTable>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{itemWord}</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Keeps</TableHead>
                    <TableHead className="text-right">{onHandHeading}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <LinkRow key={row.item.id} href={row.href}>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2 font-medium">
                          <Link href={row.href} className="hover:underline">
                            {row.item.name}
                          </Link>
                          {row.item.status === "archived" && (
                            <Badge variant="outline">retired</Badge>
                          )}
                          {row.expiry && (
                            <Badge
                              variant={row.expiry.past ? "destructive" : "outline"}
                            >
                              {row.expiry.label}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {slugLabel(row.item.itemKind)}
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
                        {row.managedInLivestock && (
                          <Link
                            href="/dashboard/m/livestock"
                            className="ml-2 text-xs underline hover:text-foreground"
                          >
                            managed in Livestock
                          </Link>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.keeps ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQuantity(row.balance, row.item.stockingUnit)}
                      </TableCell>
                    </LinkRow>
                  ))}
                </TableBody>
              </Table>
            </DataTable>
          </div>
        </>
      )}

      {rows.length > 0 && locations.length === 0 && isOwner && (
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
