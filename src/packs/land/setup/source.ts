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
          "Bring it in from the county's records with the boundary already drawn, or add it by hand and trace it. Paddocks and rotation come after.",
        href: "/dashboard/m/land",
        cta: "Add ground",
        guide: "land/parcels",
      },
    ];
  },
};
