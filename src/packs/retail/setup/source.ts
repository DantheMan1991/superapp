import "server-only";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { hasAny } from "@/lib/setup-sources/has-any";
import type { SetupCtx, SetupSource, SetupStep } from "@/lib/setup-sources/types";

/**
 * What Retail is waiting for: somewhere to sell, and prices there.
 *
 * Two steps, one at a time:
 *
 *  1. **A channel.** A price belongs to the place it is charged at, not to the
 *     thing (docs/modules/retail.md), so the place comes first.
 *  2. **Prices.** The till can only sell what has a price where you are
 *     selling it. With one channel the step points at that channel's page,
 *     where the price list is; with several, at the list.
 *
 * Not a step: the first market day. Selling is the daily work.
 *
 * The words avoid the pack's renameable label (`channel`): the card is plain
 * text on the Overview and does not run the vocabulary the guides do.
 */
export const retailSetupSource: SetupSource = {
  slug: "retail-stall",
  moduleSlug: "retail",
  label: "Retail",

  async collect(tx: Tx, ctx: SetupCtx): Promise<SetupStep[]> {
    const channels = await tx
      .select({ id: schema.retailChannels.id })
      .from(schema.retailChannels)
      .where(eq(schema.retailChannels.tenantId, ctx.tenantId))
      .limit(2);

    if (channels.length === 0) {
      return [
        {
          key: "retail.channel",
          title: "Add where you sell",
          detail:
            "A market stall, the farm gate, a shop. Prices belong to the place, so it comes first.",
          href: "/dashboard/m/retail",
          cta: "Add a place to sell",
          guide: "retail/channels",
        },
      ];
    }

    if (await hasAny(tx, schema.retailPrices, ctx.tenantId)) return [];

    const only = channels.length === 1 ? channels[0].id : null;
    return [
      {
        key: "retail.prices",
        title: "Set your prices",
        detail: "The till can only sell what has a price where you are selling it.",
        href: only ? `/dashboard/m/retail/${only}` : "/dashboard/m/retail",
        cta: "Set prices",
        guide: only ? "retail/channel" : "retail/channels",
      },
    ];
  },
};
