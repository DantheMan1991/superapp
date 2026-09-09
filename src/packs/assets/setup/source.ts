import "server-only";
import { schema, type Tx } from "@/db";
import { hasAny } from "@/lib/setup-sources/has-any";
import type { SetupCtx, SetupSource, SetupStep } from "@/lib/setup-sources/types";

/**
 * What Assets is waiting for: the first thing the business owns.
 *
 * One step. Where stock is KEPT is inventory's question and inventory's step
 * (`inventory.place`), which only appears once an asset exists — so a new
 * business is walked from "add a tractor" to "now say which of these things
 * holds stock" rather than being asked both at once about the same page.
 */
export const assetsSetupSource: SetupSource = {
  slug: "assets-first",
  moduleSlug: "assets",
  label: "Assets",

  async collect(tx: Tx, ctx: SetupCtx): Promise<SetupStep[]> {
    if (await hasAny(tx, schema.assets, ctx.tenantId)) return [];
    return [
      {
        key: "assets.first",
        title: "Add your equipment and buildings",
        detail:
          "Tractors, freezers, the barn. Anything you own, keep things in, or write down over time.",
        href: "/dashboard/m/assets",
        cta: "Add an asset",
        guide: "assets/assets",
      },
    ];
  },
};
