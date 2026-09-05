import "server-only";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { SiteBlockProvider } from "@/lib/site-blocks/types";
import { todayInTimezone } from "@/lib/timezone";
import { onHandByItem } from "@/packs/inventory/ops";
import { parsePriceBlockConfig, presentPriceList, priceBlockFields } from "./core/site-prices";
import { listChannels, priceListFor } from "./ops";

/**
 * Retail's block on the website (Marketing 9b): one channel's price list,
 * with what has run out marked. The first thing to fill the declared slot
 * (`src/lib/site-blocks`), and the only file in the pack that knows a
 * website exists.
 *
 * It reads through the pack's own verbs (`listChannels`, `priceListFor`,
 * and inventory's `onHandByItem` for the balance, the way the till does)
 * as whoever the site's transaction is: on a public page that is the
 * anonymous reader, and the member policies on `retail_*` and
 * `inventory_*` answer by tenant alone. What a visitor learns is what the
 * owner chose to publish: names, prices and "sold out". Never a cost, a
 * quantity or a lot.
 */
export const retailPricesBlock: SiteBlockProvider<Tx> = {
  kind: "retail.prices",
  pack: "retail",
  label: "Price list",
  hint: "What you sell and what it costs, from one of your Retail channels, with what has run out marked. Needs Retail switched on.",
  async fields(tx, tenantId) {
    const channels = await listChannels(tx, tenantId, { status: "active" });
    return priceBlockFields(channels.map((c) => ({ value: c.id, label: c.name })));
  },
  parseConfig: parsePriceBlockConfig,
  async load(tx, tenantId, config, now) {
    const parsed = parsePriceBlockConfig(config);
    if (!parsed) return { rows: [], footnote: "" };
    const tenant = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
      columns: { currencySymbol: true, timezone: true },
    });
    const today = todayInTimezone(tenant?.timezone || "UTC", now);
    const [list, onHand] = await Promise.all([priceListFor(tx, tenantId, parsed.channel, today), onHandByItem(tx, tenantId)]);
    return presentPriceList(
      list.map((p) => ({ id: p.item.id, name: p.item.name, stockingUnit: p.item.stockingUnit, current: p.current })),
      onHand,
      parsed,
      // A public price wants a symbol; a business that never set one is shown in dollars.
      tenant?.currencySymbol || "$",
    );
  },
};
