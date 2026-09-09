import "server-only";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { hasAny } from "@/lib/setup-sources/has-any";
import type { SetupCtx, SetupSource, SetupStep } from "@/lib/setup-sources/types";

/**
 * What Inventory is waiting for: kinds of thing, and somewhere to keep them.
 *
 * Two steps that can stand together:
 *
 *  1. **Something to hold.** Feed, eggs, cuts, cartons — the kinds, not the
 *     bags. Nothing in the pack exists without one.
 *  2. **Somewhere to keep it.** Stock sits in an asset with `Things are kept
 *     here` turned on (`assets.is_storage_location`). This step waits until at
 *     least one asset exists, because before that the assets step is already
 *     asking for the first one and two rows pointing at the same page would be
 *     the same ask twice. `inventory` requires `assets`, so the assets source is
 *     always running alongside this one.
 *
 * Not a step: the first delivery or count. Recording stock is the daily work,
 * and a business that has added its kinds and its places is set up — telling it
 * to also record something would be advice (ADR 0033).
 *
 * The words avoid the pack's renameable label (`item`): the card is plain text
 * on the Overview and does not run the vocabulary the guides do.
 */
export const inventorySetupSource: SetupSource = {
  slug: "inventory-shelf",
  moduleSlug: "inventory",
  label: "Inventory",

  async collect(tx: Tx, ctx: SetupCtx): Promise<SetupStep[]> {
    const [hasItems, hasAssets, hasPlace] = await Promise.all([
      hasAny(tx, schema.inventoryItems, ctx.tenantId),
      hasAny(tx, schema.assets, ctx.tenantId),
      hasAny(tx, schema.assets, ctx.tenantId, eq(schema.assets.isStorageLocation, true)),
    ]);
    const steps: SetupStep[] = [];
    if (!hasItems) {
      steps.push({
        key: "inventory.items",
        title: "Add what you hold",
        detail:
          "Feed, eggs, cuts, cartons: the kinds of thing you keep a quantity of. Each is counted in one unit, chosen once.",
        href: "/dashboard/m/inventory",
        cta: "Add a kind",
        guide: "inventory/items",
      });
    }
    if (hasAssets && !hasPlace) {
      steps.push({
        key: "inventory.place",
        title: "Add somewhere to keep it",
        detail:
          "Stock sits in a place: a freezer, a barn, a walk-in. Turn on Things are kept here on an asset, or add one.",
        href: "/dashboard/m/assets",
        cta: "Open Assets",
        guide: "assets/assets",
      });
    }
    return steps;
  },
};
