import "server-only";
import { schema, type Tx } from "@/db";
import { hasAny } from "@/lib/setup-sources/has-any";
import type { SetupCtx, SetupSource, SetupStep } from "@/lib/setup-sources/types";

/**
 * What Livestock is waiting for: animals.
 *
 * One step, on the lot table — a named animal is a lot of one, so one table
 * answers for both. The stock line an animal is counted in can be created from
 * the same dialog (`newItemName` in `createLivestockLot`), so inventory's step
 * is not a prerequisite of this one.
 *
 * EVER, not NOW, matters most here: a farm that batches broilers through the
 * season has no lot standing all winter, and must not be told to add animals
 * every December.
 */
export const livestockSetupSource: SetupSource = {
  slug: "livestock-animals",
  moduleSlug: "livestock",
  label: "Livestock",

  async collect(tx: Tx, ctx: SetupCtx): Promise<SetupStep[]> {
    if (await hasAny(tx, schema.livestockLots, ctx.tenantId)) return [];
    return [
      {
        key: "livestock.animals",
        title: "Add your animals",
        detail:
          "Start a group, or add an animal you name. The daily round, feed, weights and the breeding calendar all hang off them.",
        href: "/dashboard/m/livestock",
        cta: "Add animals",
        guide: "livestock/lots",
      },
    ];
  },
};
