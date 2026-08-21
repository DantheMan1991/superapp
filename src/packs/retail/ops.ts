import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { allowsWrite, type WriteLevel } from "@/lib/packs/authorize";
import type {
  InventoryItem,
  RetailChannel,
  RetailMarketDay,
  RetailPrice,
} from "@/db/schema";
import { listItems } from "@/packs/inventory/ops";
import { isValidSlug } from "./vocabulary";
import {
  marketDayCost,
  nextPrice,
  priceHistory,
  priceOn,
  type MarketDayCost,
  type PriceRow,
} from "./core/pricing";

/**
 * Retail operations. Every function takes a `Tx` so the caller owns the
 * transaction — the house rule.
 *
 * **THIS PACK COMPOSES `inventory` AND NOTHING ELSE.** `retail.requires =
 * ["inventory"]`, because a price is a price OF something and that something is
 * an inventory item. It deliberately does not require `production`: a shop
 * reselling what it bought in is a legitimate composition, and the commitment
 * machinery that does need production is slice 3.
 *
 * **NOTHING HERE STORES A PRICE AS A FIELD.** Prices are effective-dated rows
 * and the current one is a fold — see `core/pricing.ts`, which is where the
 * reasoning lives.
 */

export class RetailError extends Error {
  constructor(
    readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "INVALID_KIND"
      | "CHANNEL_INVALID"
      | "ITEM_INVALID"
      | "INVALID_PRICE"
      | "MARKET_DAY_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "RetailError";
  }
}

export interface RetailCtx {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
}

/**
 * Who may write, and at which level — `src/lib/packs/authorize.ts`'s rule: **is
 * this a decision, or is it a chore?**
 *
 * `createChannel`, `closeChannel` and `setPrice` are OWNER. Deciding that the
 * farm sells at a new market, and deciding what it charges there, are the two
 * most consequential decisions in this pack — a price is the number the whole
 * business turns on, and it is not something whoever is standing at the stall
 * should be able to move.
 *
 * `recordMarketDay` and its edits are MEMBER. What the pitch cost and how long
 * somebody stood there is a chore recorded by the person who stood there, and a
 * record only the owner can enter is a record that stays empty — which is
 * exactly what this table exists to avoid.
 */
function requireWrite(ctx: RetailCtx, level: WriteLevel): void {
  if (!allowsWrite(ctx.role, level)) {
    throw new RetailError("FORBIDDEN", "only an owner can change this");
  }
}

// --------------------------------------------------------------- channels ---

export interface ChannelInput {
  name: string;
  channelKind?: string;
  location?: string;
  notes?: string;
}

export async function createChannel(
  tx: Tx,
  ctx: RetailCtx,
  input: ChannelInput,
): Promise<RetailChannel> {
  requireWrite(ctx, "owner");
  const channelKind = (input.channelKind ?? "direct").trim().toLowerCase();
  if (!isValidSlug(channelKind)) {
    throw new RetailError("INVALID_KIND", `invalid kind: ${input.channelKind}`);
  }
  const rows = await tx
    .insert(schema.retailChannels)
    .values({
      tenantId: ctx.tenantId,
      name: input.name.trim(),
      channelKind,
      location: input.location?.trim() ?? "",
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  return rows[0];
}

export async function updateChannel(
  tx: Tx,
  ctx: RetailCtx,
  id: string,
  patch: {
    name?: string;
    channelKind?: string;
    location?: string;
    status?: string;
    notes?: string;
  },
): Promise<RetailChannel> {
  requireWrite(ctx, "owner");
  const existing = await getChannel(tx, ctx.tenantId, id);
  if (!existing) throw new RetailError("NOT_FOUND", "that channel is gone");

  const channelKind = patch.channelKind?.trim().toLowerCase();
  if (channelKind !== undefined && !isValidSlug(channelKind)) {
    throw new RetailError("INVALID_KIND", `invalid kind: ${patch.channelKind}`);
  }
  if (patch.status !== undefined && !["active", "closed"].includes(patch.status)) {
    throw new RetailError("CHANNEL_INVALID", "a channel is selling or closed");
  }

  const rows = await tx
    .update(schema.retailChannels)
    .set({
      name: patch.name?.trim() || existing.name,
      channelKind: channelKind || existing.channelKind,
      location: patch.location === undefined ? existing.location : patch.location.trim(),
      status: patch.status ?? existing.status,
      notes: patch.notes === undefined ? existing.notes : patch.notes.trim(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.retailChannels.tenantId, ctx.tenantId),
        eq(schema.retailChannels.id, id),
      ),
    )
    .returning();
  return rows[0];
}

export async function listChannels(
  tx: Tx,
  tenantId: string,
  filter: { status?: string } = {},
): Promise<RetailChannel[]> {
  const where = [eq(schema.retailChannels.tenantId, tenantId)];
  if (filter.status) where.push(eq(schema.retailChannels.status, filter.status));
  return tx.query.retailChannels.findMany({
    where: and(...where),
    orderBy: (c, { asc: byAsc }) => [byAsc(c.status), byAsc(c.name)],
  });
}

export async function getChannel(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<RetailChannel | null> {
  const row = await tx.query.retailChannels.findFirst({
    where: and(
      eq(schema.retailChannels.tenantId, tenantId),
      eq(schema.retailChannels.id, id),
    ),
  });
  return row ?? null;
}

// ----------------------------------------------------------------- prices ---

/**
 * Set what an item costs in a channel, from a day.
 *
 * **A PRICE CHANGE IS A NEW ROW, NEVER AN EDIT.** Updating in place would answer
 * "what do I charge" and destroy "what did I charge in June" — and the second is
 * the only version a margin report can ask. Setting the SAME day twice replaces
 * that day's row, because two prices starting the same morning is not a change,
 * it is a question about which one is real.
 */
export async function setPrice(
  tx: Tx,
  ctx: RetailCtx,
  input: {
    channelId: string;
    itemId: string;
    priceCents: number;
    effectiveFrom: string;
    notes?: string;
  },
): Promise<RetailPrice> {
  requireWrite(ctx, "owner");
  const channel = await getChannel(tx, ctx.tenantId, input.channelId);
  if (!channel) {
    throw new RetailError("CHANNEL_INVALID", "that channel does not exist");
  }
  const item = await tx.query.inventoryItems.findFirst({
    where: and(
      eq(schema.inventoryItems.tenantId, ctx.tenantId),
      eq(schema.inventoryItems.id, input.itemId),
    ),
  });
  if (!item) throw new RetailError("ITEM_INVALID", "that item does not exist");

  const priceCents = Math.round(input.priceCents);
  if (!Number.isFinite(priceCents) || priceCents < 0) {
    // Free is a real price. Negative is a refund, and that is a sale's business.
    throw new RetailError("INVALID_PRICE", "a price cannot be negative");
  }

  const existing = await tx.query.retailPrices.findFirst({
    where: and(
      eq(schema.retailPrices.tenantId, ctx.tenantId),
      eq(schema.retailPrices.channelId, input.channelId),
      eq(schema.retailPrices.itemId, input.itemId),
      eq(schema.retailPrices.effectiveFrom, input.effectiveFrom),
    ),
  });
  if (existing) {
    const rows = await tx
      .update(schema.retailPrices)
      .set({ priceCents, notes: input.notes?.trim() ?? existing.notes })
      .where(
        and(
          eq(schema.retailPrices.tenantId, ctx.tenantId),
          eq(schema.retailPrices.id, existing.id),
        ),
      )
      .returning();
    return rows[0];
  }

  const rows = await tx
    .insert(schema.retailPrices)
    .values({
      tenantId: ctx.tenantId,
      channelId: input.channelId,
      itemId: input.itemId,
      priceCents,
      effectiveFrom: input.effectiveFrom,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  return rows[0];
}

/**
 * Remove a price row.
 *
 * **THE SAME CALL `livestock` MADE FOR WEIGHTS AND TREATMENTS.** A price is a
 * decision recorded, not a ledger entry: one typed as $80 where the sign said
 * $8 never applied to anything, so there is nothing to compensate for. Removing
 * it uncovers whatever price ran before, which is the right answer.
 *
 * It stops being right the day a SALE references the row — a sale made at that
 * price would be left explaining itself. Slice 1 has to make this refuse then,
 * and this comment is the note to whoever builds it.
 */
export async function removePrice(
  tx: Tx,
  ctx: RetailCtx,
  id: string,
): Promise<RetailPrice> {
  requireWrite(ctx, "owner");
  const rows = await tx
    .delete(schema.retailPrices)
    .where(
      and(
        eq(schema.retailPrices.tenantId, ctx.tenantId),
        eq(schema.retailPrices.id, id),
      ),
    )
    .returning();
  if (rows.length === 0) throw new RetailError("NOT_FOUND", "that price is gone");
  return rows[0];
}

/** Every price row for one channel. The fold happens in `core/pricing.ts`. */
export async function pricesForChannel(
  tx: Tx,
  tenantId: string,
  channelId: string,
): Promise<RetailPrice[]> {
  return tx.query.retailPrices.findMany({
    where: and(
      eq(schema.retailPrices.tenantId, tenantId),
      eq(schema.retailPrices.channelId, channelId),
    ),
  });
}

export interface PricedItem {
  item: InventoryItem;
  current: PriceRow | null;
  upcoming: PriceRow | null;
  history: PriceRow[];
}

/**
 * The price list for one channel: every active item, priced or not.
 *
 * **ITEMS WITH NO PRICE ARE INCLUDED, and that is the point of the screen.** A
 * farm sells six of the forty things it holds, and the useful question at a
 * price list is as often *what have I not decided about* as *what do I charge*.
 * Showing only priced rows would make the gap invisible.
 */
export async function priceListFor(
  tx: Tx,
  tenantId: string,
  channelId: string,
  today: string,
): Promise<PricedItem[]> {
  const [items, prices] = await Promise.all([
    listItems(tx, tenantId, { status: "active" }),
    pricesForChannel(tx, tenantId, channelId),
  ]);
  const byItem = new Map<string, PriceRow[]>();
  for (const row of prices) {
    const list = byItem.get(row.itemId);
    if (list) list.push(row);
    else byItem.set(row.itemId, [row]);
  }
  return items.map((item) => {
    const rows = byItem.get(item.id) ?? [];
    return {
      item,
      current: priceOn(rows, today),
      upcoming: nextPrice(rows, today),
      history: priceHistory(rows),
    };
  });
}

/** How many items each of these channels prices today — the list-page number. */
export async function pricedCountByChannel(
  tx: Tx,
  tenantId: string,
  channelIds: string[],
  today: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (channelIds.length === 0) return out;
  const rows = await tx.query.retailPrices.findMany({
    where: and(
      eq(schema.retailPrices.tenantId, tenantId),
      inArray(schema.retailPrices.channelId, channelIds),
    ),
  });
  const byChannel = new Map<string, Map<string, PriceRow[]>>();
  for (const row of rows) {
    let items = byChannel.get(row.channelId);
    if (!items) {
      items = new Map();
      byChannel.set(row.channelId, items);
    }
    const list = items.get(row.itemId);
    if (list) list.push(row);
    else items.set(row.itemId, [row]);
  }
  for (const channelId of channelIds) {
    const items = byChannel.get(channelId);
    if (!items) {
      out.set(channelId, 0);
      continue;
    }
    // Counted through the same fold the screen uses, so a price set for next
    // season does not make an item look priced today.
    let priced = 0;
    for (const rowsForItem of items.values()) {
      if (priceOn(rowsForItem, today)) priced += 1;
    }
    out.set(channelId, priced);
  }
  return out;
}

// ----------------------------------------------------------- market days ---

export interface MarketDayInput {
  channelId: string;
  heldOn: string;
  stallFeeCents?: number | null;
  travelCents?: number | null;
  crewSize?: number | null;
  hours?: number | null;
  weather?: string;
  notes?: string;
}

export async function recordMarketDay(
  tx: Tx,
  ctx: RetailCtx,
  input: MarketDayInput,
): Promise<RetailMarketDay> {
  requireWrite(ctx, "member");
  const channel = await getChannel(tx, ctx.tenantId, input.channelId);
  if (!channel) {
    throw new RetailError("CHANNEL_INVALID", "that channel does not exist");
  }
  const rows = await tx
    .insert(schema.retailMarketDays)
    .values({
      tenantId: ctx.tenantId,
      channelId: input.channelId,
      heldOn: input.heldOn,
      stallFeeCents: input.stallFeeCents ?? null,
      travelCents: input.travelCents ?? null,
      crewSize: input.crewSize ?? null,
      hours: input.hours ?? null,
      weather: input.weather?.trim() ?? "",
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  return rows[0];
}

/**
 * Correct a day.
 *
 * Edits in place, and for the reason this repo has now settled three times: a
 * stall fee typed wrong never happened, so there is nothing to compensate for.
 * It stops being true when sales hang off the day — slice 1's problem, and the
 * same note `removePrice` carries.
 */
export async function updateMarketDay(
  tx: Tx,
  ctx: RetailCtx,
  id: string,
  patch: Partial<Omit<MarketDayInput, "channelId">>,
): Promise<RetailMarketDay> {
  requireWrite(ctx, "member");
  const existing = await tx.query.retailMarketDays.findFirst({
    where: and(
      eq(schema.retailMarketDays.tenantId, ctx.tenantId),
      eq(schema.retailMarketDays.id, id),
    ),
  });
  if (!existing) throw new RetailError("NOT_FOUND", "that day is gone");

  const rows = await tx
    .update(schema.retailMarketDays)
    .set({
      heldOn: patch.heldOn ?? existing.heldOn,
      stallFeeCents:
        patch.stallFeeCents === undefined
          ? existing.stallFeeCents
          : patch.stallFeeCents,
      travelCents:
        patch.travelCents === undefined ? existing.travelCents : patch.travelCents,
      crewSize: patch.crewSize === undefined ? existing.crewSize : patch.crewSize,
      hours: patch.hours === undefined ? existing.hours : patch.hours,
      weather: patch.weather === undefined ? existing.weather : patch.weather.trim(),
      notes: patch.notes === undefined ? existing.notes : patch.notes.trim(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.retailMarketDays.tenantId, ctx.tenantId),
        eq(schema.retailMarketDays.id, id),
      ),
    )
    .returning();
  return rows[0];
}

export async function removeMarketDay(
  tx: Tx,
  ctx: RetailCtx,
  id: string,
): Promise<RetailMarketDay> {
  requireWrite(ctx, "member");
  const rows = await tx
    .delete(schema.retailMarketDays)
    .where(
      and(
        eq(schema.retailMarketDays.tenantId, ctx.tenantId),
        eq(schema.retailMarketDays.id, id),
      ),
    )
    .returning();
  if (rows.length === 0) throw new RetailError("NOT_FOUND", "that day is gone");
  return rows[0];
}

export interface MarketDayRow {
  day: RetailMarketDay;
  channelName: string;
  cost: MarketDayCost;
}

/**
 * Days of selling, newest first, with what each cost.
 *
 * Two queries whatever the day count. The cost is folded rather than stored —
 * re-running after a correction gives the corrected answer, which is the
 * property every report in these packs is built on.
 */
export async function marketDays(
  tx: Tx,
  tenantId: string,
  filter: { channelId?: string; limit?: number } = {},
): Promise<MarketDayRow[]> {
  const where = [eq(schema.retailMarketDays.tenantId, tenantId)];
  if (filter.channelId) {
    where.push(eq(schema.retailMarketDays.channelId, filter.channelId));
  }
  const [days, channels] = await Promise.all([
    tx.query.retailMarketDays.findMany({
      where: and(...where),
      orderBy: (d, { desc: byDesc }) => [byDesc(d.heldOn), byDesc(d.createdAt)],
      limit: filter.limit,
    }),
    listChannels(tx, tenantId),
  ]);
  const byId = new Map(channels.map((c) => [c.id, c.name]));
  return days.map((day) => ({
    day,
    channelName: byId.get(day.channelId) ?? "—",
    cost: marketDayCost(day),
  }));
}
