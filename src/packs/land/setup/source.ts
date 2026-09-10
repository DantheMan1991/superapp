import "server-only";
import { schema, type Tx } from "@/db";
import { hasAny } from "@/lib/setup-sources/has-any";
import type { SetupCtx, SetupSource, SetupStep } from "@/lib/setup-sources/types";

/**
 * What Land is waiting for: ground.
 *
 * One step, on the parcel table. Zones, fences, water and the rotation are all
 * drawn inside a parcel, so nothing in the pack exists before one does. Where
 * the county's parcel service is connected the parcel arrives with its boundary
 * and acreage already drawn; elsewhere it is added by hand and traced.
 *
 * The words avoid the pack's renameable labels (`parcel`, `zone`): the card is
 * plain text on the Overview and does not run the vocabulary the guides do.
 */
export const landSetupSource: SetupSource = {
  slug: "land-ground",
  moduleSlug: "land",
  label: "Land",

  async collect(tx: Tx, ctx: SetupCtx): Promise<SetupStep[]> {
    if (await hasAny(tx, schema.landParcels, ctx.tenantId)) return [];
    return [
      {
        key: "land.parcels",
        title: "Add your ground",
        detail:
          // **NO RENAMEABLE NOUN, which is what the note above already says
          // this file does** — and it said `Paddocks` anyway. Rewritten around
          // the word rather than interpolating one: the card is plain text on
          // the Overview and adding a lookup for one sentence is the wrong
          // trade.
          "Bring it in from the county's records with the boundary already drawn, or add it by hand and trace it. Dividing it up and the rotation come after.",
        href: "/dashboard/m/land",
        cta: "Add ground",
        guide: "land/parcels",
      },
    ];
  },
};
