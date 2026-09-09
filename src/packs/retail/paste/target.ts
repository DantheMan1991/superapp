import type { Tx } from "@/db";
import {
  PasteRefusal,
  type PasteChoice,
  type PasteCtx,
  type PasteField,
  type PasteRow,
  type PasteSaved,
  type PasteTarget,
} from "@/lib/paste-targets/types";
import { listItems } from "@/packs/inventory/ops";
import { listChannels, RetailError, setPrice } from "../ops";

/**
 * Prices as a paste target (ADR 0036): the price list — the chalkboard at
 * the stall, the sheet taped inside the freezer lid, the column on the order
 * form. Each line names a thing the business already holds and what it
 * charges for it somewhere.
 *
 * THE ITEM AND THE CHANNEL ARE CHOICES, by name, because a price is a fact
 * about an existing thing at an existing place: nothing is created here. A
 * list that names something the farm does not hold comes back with the words
 * beside an empty cell, and the person adds the item first. With one place
 * to sell, a blank channel means that one.
 *
 * NO DUPLICATES, ON PURPOSE. A price change is a new row, never an edit
 * (`setPrice`'s header), so a list that re-prices what is already priced is
 * the normal case and nothing here unticks it. Setting the same day twice
 * replaces that day's row, which is the pack's own rule and stays it.
 *
 * Dollars in, cents stored; per pound only where the pack allows it — a
 * thing already measured in pounds is refused per pound, in the pack's words.
 */

const BASIS_CHOICES: PasteChoice[] = [
  { value: "unit", label: "Each" },
  { value: "lb", label: "Per pound" },
];

const text = (v: PasteRow[string]): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

const today = () => new Date().toISOString().slice(0, 10);

function refusal(err: unknown): unknown {
  return err instanceof RetailError ? new PasteRefusal(err.message) : err;
}

const NO_CHANNEL = "Add somewhere to sell first.";
const NO_ITEMS = "Add what you sell first, under Inventory.";

export const pricesPasteTarget: PasteTarget = {
  slug: "retail.prices",
  moduleSlug: "retail",
  label: "Prices",
  noun: { one: "price", many: "prices" },
  about:
    "prices — what the business charges for each thing it sells, at the place it sells it",
  async describe(tx: Tx, ctx: PasteCtx) {
    const channels = await listChannels(tx, ctx.tenantId, { status: "active" });
    if (channels.length === 0) return { fields: [], blocked: NO_CHANNEL };
    const items = await listItems(tx, ctx.tenantId, { status: "active" });
    if (items.length === 0) return { fields: [], blocked: NO_ITEMS };
    const one = channels.length === 1;
    const fields: PasteField[] = [
      {
        key: "item",
        label: "Item",
        kind: "choice",
        required: true,
        hint: "What is being priced, copied exactly from the choices.",
        choices: items.map((i) => ({ value: i.id, label: i.name })),
      },
      {
        key: "channel",
        label: "Where",
        kind: "choice",
        required: !one,
        hint: one
          ? "Where it sells at this price. Left blank, the only place to sell is used."
          : "Where it sells at this price.",
        choices: channels.map((c) => ({ value: c.id, label: c.name })),
      },
      {
        key: "price",
        label: "Price",
        kind: "number",
        required: true,
        hint: "The price in dollars — 8.50 for $8.50.",
      },
      {
        key: "per",
        label: "Per",
        kind: "choice",
        hint: "Per pound when the list prices by weight; otherwise each.",
        choices: BASIS_CHOICES,
      },
      {
        key: "from",
        label: "From",
        kind: "date",
        hint: "The day the price starts, when the list says. Blank means today.",
      },
      { key: "notes", label: "Notes", kind: "text", hint: "Anything else the list says about it." },
    ];
    return { fields };
  },
  async duplicates(_tx: Tx, _ctx: PasteCtx, rows: PasteRow[]) {
    return rows.map(() => null);
  },
  async save(tx: Tx, ctx: PasteCtx, row: PasteRow): Promise<PasteSaved> {
    let channelId = text(row.channel);
    if (!channelId) {
      const channels = await listChannels(tx, ctx.tenantId, { status: "active" });
      if (channels.length !== 1) throw new PasteRefusal("Where is missing.");
      channelId = channels[0].id;
    }
    try {
      const price = await setPrice(tx, ctx, {
        channelId,
        itemId: text(row.item)!,
        priceCents: Math.round((row.price as number) * 100),
        priceBasis: text(row.per) ?? "unit",
        effectiveFrom: text(row.from) ?? today(),
        notes: text(row.notes) ?? undefined,
      });
      return { id: price.id, label: `${text(row.item)}` };
    } catch (err) {
      throw refusal(err);
    }
  },
  revalidate: ["/dashboard/m/retail", "/dashboard"],
};
