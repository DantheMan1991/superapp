import type { BlockConfig, BlockField, BlockFieldOption, BlockRow, BlockView } from "@/lib/site-blocks/types";
import { formatMoney } from "@/lib/money";
import type { PriceRow } from "./pricing";

/**
 * The price list block, the pure half (Marketing 9b): what the public page
 * shows of one channel's prices, and what it never shows.
 *
 * **ONLY PRICED, ACTIVE ITEMS, EVER.** `priceListFor` includes unpriced
 * items on purpose because the owner's screen is about what has not been
 * decided; a visitor's page is the opposite, and a row with no figure would
 * read as "ask us" when it means "nobody chose". Sold out is a fact from
 * inventory's own balance (nothing on hand anywhere) and the owner says
 * whether it is marked or dropped; an item inventory has never counted is
 * shown as for sale, because "not tracked" is not "none left".
 */
export const SOLD_OUT_OPTIONS: BlockFieldOption[] = [
  { value: "mark", label: "Show it, marked sold out" },
  { value: "hide", label: "Leave it off the list" },
];

export function priceBlockFields(channels: BlockFieldOption[]): BlockField[] {
  return [
    {
      key: "channel",
      label: "Prices from",
      hint: "One of your Retail channels. Make a channel called Website if the site should have prices of its own.",
      kind: "select",
      options: channels,
      default: channels.length === 1 ? channels[0].value : "",
    },
    {
      key: "soldOut",
      label: "When something has run out",
      hint: "Run out means nothing on hand anywhere in Inventory.",
      kind: "select",
      options: SOLD_OUT_OPTIONS,
      default: "mark",
    },
  ];
}

export interface PriceBlockConfig extends BlockConfig {
  channel: string;
  soldOut: "mark" | "hide";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The saved config, checked: a channel id and a sold-out rule, or null. */
export function parsePriceBlockConfig(config: BlockConfig): PriceBlockConfig | null {
  const channel = config.channel;
  if (typeof channel !== "string" || !UUID.test(channel)) return null;
  const soldOut = config.soldOut === "hide" ? "hide" : "mark";
  return { channel, soldOut };
}

export interface PricedForSite {
  id: string;
  name: string;
  stockingUnit: string;
  current: Pick<PriceRow, "priceCents" | "priceBasis"> | null;
}

const EACH_UNITS = new Set(["each", "ea", "unit", "units", "piece", "pieces", "package", "packages", "pkg", "pack", "item", "items"]);

/** "per lb" for a by-the-pound price; "each" for a thing; "per dozen" for a dozen. */
export function priceDetail(item: Pick<PricedForSite, "stockingUnit">, price: Pick<PriceRow, "priceBasis">): string {
  if (price.priceBasis === "lb") return "per lb";
  const unit = item.stockingUnit.trim().toLowerCase();
  if (!unit || EACH_UNITS.has(unit)) return "each";
  return `per ${unit}`;
}

/**
 * The rows a visitor sees: priced, active items by name, each with the
 * figure in the tenant's money and what it is per, and sold out marked or
 * dropped as the owner chose.
 */
export function presentPriceList(
  items: PricedForSite[],
  onHand: ReadonlyMap<string, number>,
  config: PriceBlockConfig,
  currencySymbol: string | null,
): BlockView {
  const rows: BlockRow[] = [];
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const item of sorted) {
    if (!item.current) continue;
    const balance = onHand.get(item.id);
    const soldOut = balance !== undefined && balance <= 0;
    if (soldOut && config.soldOut === "hide") continue;
    rows.push({
      name: item.name,
      detail: priceDetail(item, item.current),
      amount: formatMoney(item.current.priceCents, currencySymbol),
      status: soldOut ? "sold_out" : "",
    });
  }
  return { rows, footnote: "" };
}
