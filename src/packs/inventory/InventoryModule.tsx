import Link from "next/link";
import { Boxes } from "lucide-react";
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
import { labelFor } from "@/lib/packs/resolve";
import { listItems, listKindsInUse, listLocations, onHandByItem } from "./ops";
import { slugLabel } from "./vocabulary";
import { formatQuantity } from "./core/units";
import { ItemForm } from "./components/item-form";

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
  const showArchived = searchParams.archived === "1";

  const { items, onHand, kinds, locations, labels } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [items, onHand, kinds, locations, pack] = await Promise.all([
        listItems(tx, ctx.tenant.id, {
          kind,
          status: showArchived ? undefined : "active",
        }),
        onHandByItem(tx, ctx.tenant.id),
        listKindsInUse(tx, ctx.tenant.id),
        listLocations(tx, ctx.tenant.id),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "inventory"),
      ]);
      return { items, onHand, kinds, locations, labels: pack.labels };
    },
    { role: ctx.role },
  );

  const isOwner = ctx.role === "owner";
  const itemWord = labelFor(labels, "item", "Item");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="What the business holds, where it is, and which batch it came from."
        actions={
          isOwner ? (
            <ItemForm kindsInUse={kinds.map((k) => k.kind)} />
          ) : null
        }
      />

      {items.length === 0 ? (
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
