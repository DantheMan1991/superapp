import Link from "next/link";
import {
  Boxes,
  ClipboardList,
  Coins,
  FileCheck,
  Scale,
  SearchX,
} from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
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
} from "./ops";
import { slugLabel } from "./vocabulary";
import { formatQuantity } from "./core/units";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { todayInTimezone } from "@/lib/timezone";
import { ItemForm } from "./components/item-form";
import { ItemFilters } from "./components/item-filters";
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
  } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [items, onHand, kinds, locations, pack, expiring, enterprises, allItems] =
        await Promise.all([
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
      };
    },
    { role: ctx.role },
  );

  const isOwner = ctx.role === "owner";
  const itemWord = labelFor(labels, "item", "Item");
  const enterpriseWord = labelFor(
    labels,
    ENTERPRISE_LABEL_KEY,
    ENTERPRISE_FALLBACK,
  );
  const enterpriseOptions = enterprises.map((e) => ({ id: e.id, name: e.name }));
  /**
   * Counted over the UNFILTERED list, and "none" is a pill of its own — see
   * `listItems`, where "what have I not tagged yet" is the question that makes
   * an explicit untagged filter worth having.
   */
  const byEnterprise = new Map<string, number>();
  let untagged = 0;
  for (const i of allItems) {
    if (i.enterpriseId) {
      byEnterprise.set(i.enterpriseId, (byEnterprise.get(i.enterpriseId) ?? 0) + 1);
    } else {
      untagged += 1;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="What the business holds, where it is, and which batch it came from."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* FIRST, and NOT owner-gated. Counting is the chore and adding an
                item is the occasional decision, so the order on the page is how
                often each is used rather than the order they were built in —
                the call `livestock` made for its daily round. */}
            <Button asChild variant="outline">
              <Link href="/dashboard/m/inventory/counts">
                <ClipboardList className="mr-2 h-4 w-4" />
                Counting
              </Link>
            </Button>
            {/* Not owner-gated either. What stock is worth is a question a
                bookkeeper asks far more often than an owner does, and the
                figure is a read over movements they can already see. */}
            <Button asChild variant="outline">
              <Link href="/dashboard/m/inventory/value">
                <Coins className="mr-2 h-4 w-4" />
                What it is worth
              </Link>
            </Button>
            {/* Not owner-gated: seeing what has arrived and what has been
                billed for it is a bookkeeper's daily question. Only the acts
                — matching, unpicking, switching posting on — are owner-only,
                and those are gated on the page itself. */}
            <Button asChild variant="outline">
              <Link href="/dashboard/m/inventory/matching">
                <FileCheck className="mr-2 h-4 w-4" />
                Deliveries & invoices
              </Link>
            </Button>
            {/* OWNER ONLY, unlike the three above, and it is the only one of
                the four that is not a daily question. Recording what an
                accountant decided about a tax election is a decision about the
                business, not a chore, and it sits on the same line as every
                other cost-object act in this pack. */}
            {isOwner && (
              <Button asChild variant="outline">
                <Link href="/dashboard/m/inventory/tax">
                  <Scale className="mr-2 h-4 w-4" />
                  When it is deducted
                </Link>
              </Button>
            )}
            {isOwner && (
              <ItemForm
                kindsInUse={kinds.map((k) => k.kind)}
                enterprises={enterpriseOptions}
                enterpriseWord={enterpriseWord}
                livestockEnabled={livestockEnabled}
              />
            )}
          </div>
        }
      />

      {expiring.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Going off soon</CardTitle>
          </CardHeader>
          <CardContent>
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
            <p className="mt-3 text-xs text-muted-foreground">
              {/* The design asks for the two views that prevent loss — oldest
                  first, and expiring soon. Sorted by date IS both. */}
              Soonest first. Use these before the rest; nothing here refuses a
              later batch, because you can see which one is already open and
              this cannot.
            </p>
          </CardContent>
        </Card>
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

      {items.length === 0 ? (
        /**
         * **"NOTHING MATCHES" AND "NOTHING TRACKED YET" ARE DIFFERENT FACTS,
         * and showing the second for the first is how a filter convinces
         * somebody their data is gone.** The old copy told an owner with forty
         * items and a stale search box to go and add their first one.
         */
        filtering ? (
          <EmptyState
            panel
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
            panel
            icon={<Boxes className="h-5 w-5" />}
            title="Nothing tracked yet"
            description={
              isOwner
                ? `Add the first ${itemWord.toLowerCase()} you hold — feed, cartons, meat in a freezer. What it is measured in decides how every number about it reads, so it is worth a moment.`
                : "An owner adds what the business holds. Once they do, it shows up here."
            }
          />
        )
      ) : (
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
      )}

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
