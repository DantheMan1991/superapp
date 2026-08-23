import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { allowsWrite, type WriteLevel } from "@/lib/packs/authorize";
import type {
  InventoryItem,
  RetailChannel,
  RetailMarketDay,
  RetailPrice,
  RetailSale,
  RetailSaleLine,
  RetailStockout,
} from "@/db/schema";
import {
  getItem,
  issueStock,
  listItems,
  stockAtLocation,
  transferStock,
  type InventoryCtx,
  type LocationStockLine,
} from "@/packs/inventory/ops";
import { isValidSlug } from "./vocabulary";
import {
  marketDayCost,
  nextPrice,
  priceHistory,
  priceOn,
  type MarketDayCost,
  type PriceRow,
} from "./core/pricing";
import {
  cashCount,
  dayResult,
  lineTotalCents,
  saleTotalCents,
  takings,
  type CashCount,
  type DayResult,
  type Takings,
} from "./core/till";

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
      | "MARKET_DAY_INVALID"
      | "SALE_INVALID"
      | "NO_LINES",
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


// ------------------------------------------------------------- the truck ---

const asInventory = (ctx: RetailCtx): InventoryCtx => ctx;

/**
 * Load or unload the truck.
 *
 * **THE WHOLE OFFLINE ARCHITECTURE IS THIS ONE SENTENCE**: the market truck is a
 * mobile inventory location, so loading it is a TRANSFER and there is no
 * distributed-inventory problem to solve. The app knows exactly what left, sales
 * draw down the truck's own stock, and what did not sell transfers back. Nothing
 * is shared, so nothing can conflict.
 *
 * Wrapping `inventory.transferStock` rather than reimplementing it: the ledger
 * is that pack's, and a second way to move stock is the duplication the pack
 * model exists to stop.
 */
export async function moveStockToTruck(
  tx: Tx,
  ctx: RetailCtx,
  input: {
    itemId: string;
    lotId?: string | null;
    quantity: number;
    fromLocationAssetId?: string | null;
    truckAssetId: string;
    occurredOn: string;
    notes?: string;
  },
): Promise<void> {
  requireWrite(ctx, "member");
  await transferStock(tx, asInventory(ctx), {
    itemId: input.itemId,
    lotId: input.lotId ?? null,
    quantity: input.quantity,
    fromLocationAssetId: input.fromLocationAssetId ?? null,
    toLocationAssetId: input.truckAssetId,
    occurredOn: input.occurredOn,
    extensionSlug: "retail",
    notes: input.notes,
  });
}

/** And back again at the end of the day. Unsold stock is not lost stock. */
export async function returnStockFromTruck(
  tx: Tx,
  ctx: RetailCtx,
  input: {
    itemId: string;
    lotId?: string | null;
    quantity: number;
    truckAssetId: string;
    toLocationAssetId?: string | null;
    occurredOn: string;
    notes?: string;
  },
): Promise<void> {
  requireWrite(ctx, "member");
  await transferStock(tx, asInventory(ctx), {
    itemId: input.itemId,
    lotId: input.lotId ?? null,
    quantity: input.quantity,
    fromLocationAssetId: input.truckAssetId,
    toLocationAssetId: input.toLocationAssetId ?? null,
    occurredOn: input.occurredOn,
    extensionSlug: "retail",
    notes: input.notes,
  });
}

/** What is on the truck right now, straight from `inventory`'s ledger. */
export async function truckStock(
  tx: Tx,
  tenantId: string,
  truckAssetId: string,
): Promise<LocationStockLine[]> {
  return stockAtLocation(tx, tenantId, truckAssetId);
}

// ---------------------------------------------------------------- selling ---

export interface SaleLineInput {
  itemId: string;
  lotId?: string | null;
  quantity: number;
  /** What was actually charged, per stocking unit. Stamped, never looked up. */
  unitPriceCents: number;
}

export interface RecordSaleInput {
  /**
   * The till's own id for this sale, minted before it reached the network.
   *
   * **THIS IS WHAT MAKES POSTING SAFE TO RETRY.** Omitting it is allowed and is
   * what a server-side sale does; supplying it means the same sale can be sent
   * as many times as the network demands and land exactly once.
   */
  clientRef?: string | null;
  channelId: string;
  marketDayId?: string | null;
  soldAt: Date;
  paymentMethod?: string;
  locationAssetId?: string | null;
  lines: SaleLineInput[];
  notes?: string;
}

export interface RecordSaleResult {
  sale: RetailSale;
  lines: RetailSaleLine[];
  totalCents: number;
  /** True when this exact sale had already been posted and nothing was written. */
  alreadyPosted: boolean;
}

/**
 * Take a sale: stamp the prices, draw the stock off the truck, and be safe to
 * send twice.
 *
 * **IDEMPOTENT BY `clientRef`, AND THAT IS THE POINT OF THE WHOLE FUNCTION.** A
 * till at a market with no signal queues its sales and flushes them later; a
 * flush whose request succeeded but whose reply never arrived WILL be retried,
 * and without this the customer's money would be taken twice and the stock
 * issued twice with it. Checking first and returning what is already there is
 * cheaper and clearer than catching a unique violation, and it lets the caller
 * tell "posted" from "already posted" rather than guessing.
 *
 * **EVERY LINE ISSUES STOCK, at the truck's location.** A sale line without a
 * movement would be revenue with nothing behind it — and the truck's balance is
 * what the till's own arithmetic is built on.
 *
 * **THE PRICE COMES FROM THE CALLER, NOT FROM THE PRICE LIST.** The list is
 * where the till READS a suggestion; what the customer paid is what is recorded.
 * A market haggles, and *two for twenty* is a real transaction.
 */
export async function recordSale(
  tx: Tx,
  ctx: RetailCtx,
  input: RecordSaleInput,
): Promise<RecordSaleResult> {
  requireWrite(ctx, "member");

  const clientRef = input.clientRef?.trim() || null;
  if (clientRef) {
    const existing = await tx.query.retailSales.findFirst({
      where: and(
        eq(schema.retailSales.tenantId, ctx.tenantId),
        eq(schema.retailSales.clientRef, clientRef),
      ),
    });
    if (existing) {
      const lines = await saleLines(tx, ctx.tenantId, existing.id);
      return {
        sale: existing,
        lines,
        totalCents: saleTotalCents(
          lines.map((l) => ({
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
          })),
        ),
        alreadyPosted: true,
      };
    }
  }

  if (input.lines.length === 0) {
    throw new RetailError("NO_LINES", "a sale with nothing in it is not a sale");
  }
  const channel = await getChannel(tx, ctx.tenantId, input.channelId);
  if (!channel) {
    throw new RetailError("CHANNEL_INVALID", "that channel does not exist");
  }
  const paymentMethod = (input.paymentMethod ?? "cash").trim().toLowerCase();
  if (!isValidSlug(paymentMethod)) {
    throw new RetailError("SALE_INVALID", "that is not a payment method");
  }

  for (const line of input.lines) {
    if (line.quantity <= 0) {
      throw new RetailError("SALE_INVALID", "a sale line has to be a positive quantity");
    }
    if (line.unitPriceCents < 0) {
      // Free is a real line. A refund is its own sale rather than a negative one.
      throw new RetailError("INVALID_PRICE", "a price cannot be negative");
    }
    const item = await getItem(tx, ctx.tenantId, line.itemId);
    if (!item) throw new RetailError("ITEM_INVALID", "that item does not exist");
  }

  const saleRows = await tx
    .insert(schema.retailSales)
    .values({
      tenantId: ctx.tenantId,
      clientRef,
      channelId: input.channelId,
      marketDayId: input.marketDayId ?? null,
      soldAt: input.soldAt,
      paymentMethod,
      locationAssetId: input.locationAssetId ?? null,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  const sale = saleRows[0];

  const occurredOn = input.soldAt.toISOString().slice(0, 10);
  const lines: RetailSaleLine[] = [];
  for (const line of input.lines) {
    // The stock leaves from wherever the sale was served from — the truck at a
    // market, nothing recorded at a gate. `issueStock` stamps the COST at the
    // item's average, which is what makes margin answerable later; the PRICE is
    // a separate fact and lives on the line.
    const movement = await issueStock(tx, asInventory(ctx), {
      itemId: line.itemId,
      lotId: line.lotId ?? null,
      quantity: line.quantity,
      occurredOn,
      locationAssetId: input.locationAssetId ?? null,
      extensionSlug: "retail",
    });
    const rows = await tx
      .insert(schema.retailSaleLines)
      .values({
        tenantId: ctx.tenantId,
        saleId: sale.id,
        itemId: line.itemId,
        lotId: line.lotId ?? null,
        quantity: line.quantity,
        unitPriceCents: Math.round(line.unitPriceCents),
        inventoryMovementId: movement.id,
      })
      .returning();
    lines.push(rows[0]);
  }

  return {
    sale,
    lines,
    totalCents: saleTotalCents(
      lines.map((l) => ({ quantity: l.quantity, unitPriceCents: l.unitPriceCents })),
    ),
    alreadyPosted: false,
  };
}

export async function saleLines(
  tx: Tx,
  tenantId: string,
  saleId: string,
): Promise<RetailSaleLine[]> {
  return tx.query.retailSaleLines.findMany({
    where: and(
      eq(schema.retailSaleLines.tenantId, tenantId),
      eq(schema.retailSaleLines.saleId, saleId),
    ),
    orderBy: (l, { asc: byAsc }) => [byAsc(l.createdAt)],
  });
}

/**
 * Void a sale.
 *
 * **THE STOCK ISSUE IS DELIBERATELY NOT UNWRITTEN**, which is the call
 * `livestock` made when a treatment is removed and the medicine has already left
 * the shelf. The goods went over the table; a movement records what happened,
 * and unwriting it would rewrite that. The sale row goes, the issue stays, and
 * the screen names the loose end rather than letting somebody find it later as
 * stock they cannot account for.
 *
 * Putting it right is `inventory`'s adjustment — which slice 2 built, so for the
 * first time in this repo the remedy actually exists.
 */
export async function voidSale(
  tx: Tx,
  ctx: RetailCtx,
  id: string,
): Promise<RetailSale> {
  requireWrite(ctx, "member");
  const rows = await tx
    .delete(schema.retailSales)
    .where(
      and(
        eq(schema.retailSales.tenantId, ctx.tenantId),
        eq(schema.retailSales.id, id),
      ),
    )
    .returning();
  if (rows.length === 0) throw new RetailError("NOT_FOUND", "that sale is gone");
  return rows[0];
}

// -------------------------------------------------------------- stockouts ---

/**
 * Record running out of something, at the time it happened.
 *
 * **NOTHING CAN INFER THIS**, which is why it is a table and a one-tap button
 * rather than a report. A stall that sold its last dozen at closing time and one
 * that ran dry at eleven and turned people away for four hours produce identical
 * sales data, and only one of them is a reason to bring more next week.
 *
 * Upserts: running out is one fact about one day, and a second tap should
 * correct the time rather than create a second event.
 */
export async function recordStockout(
  tx: Tx,
  ctx: RetailCtx,
  input: {
    marketDayId: string;
    itemId: string;
    noticedAt: Date;
    notes?: string;
  },
): Promise<RetailStockout> {
  requireWrite(ctx, "member");
  const existing = await tx.query.retailStockouts.findFirst({
    where: and(
      eq(schema.retailStockouts.tenantId, ctx.tenantId),
      eq(schema.retailStockouts.marketDayId, input.marketDayId),
      eq(schema.retailStockouts.itemId, input.itemId),
    ),
  });
  if (existing) {
    const rows = await tx
      .update(schema.retailStockouts)
      .set({
        noticedAt: input.noticedAt,
        notes: input.notes?.trim() ?? existing.notes,
      })
      .where(
        and(
          eq(schema.retailStockouts.tenantId, ctx.tenantId),
          eq(schema.retailStockouts.id, existing.id),
        ),
      )
      .returning();
    return rows[0];
  }
  const rows = await tx
    .insert(schema.retailStockouts)
    .values({
      tenantId: ctx.tenantId,
      marketDayId: input.marketDayId,
      itemId: input.itemId,
      noticedAt: input.noticedAt,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  return rows[0];
}

export async function removeStockout(
  tx: Tx,
  ctx: RetailCtx,
  id: string,
): Promise<RetailStockout> {
  requireWrite(ctx, "member");
  const rows = await tx
    .delete(schema.retailStockouts)
    .where(
      and(
        eq(schema.retailStockouts.tenantId, ctx.tenantId),
        eq(schema.retailStockouts.id, id),
      ),
    )
    .returning();
  if (rows.length === 0) throw new RetailError("NOT_FOUND", "that is gone");
  return rows[0];
}

// ---------------------------------------------------------- the day's till ---

export interface SaleRow {
  sale: RetailSale;
  lines: (RetailSaleLine & { itemName: string; unit: string })[];
  totalCents: number;
}

/** Every sale on a day, with its lines and its total folded. */
export async function salesForDay(
  tx: Tx,
  tenantId: string,
  marketDayId: string,
): Promise<SaleRow[]> {
  const sales = await tx.query.retailSales.findMany({
    where: and(
      eq(schema.retailSales.tenantId, tenantId),
      eq(schema.retailSales.marketDayId, marketDayId),
    ),
    orderBy: (s, { desc: byDesc }) => [byDesc(s.soldAt)],
  });
  if (sales.length === 0) return [];

  const rows = await tx
    .select({
      line: schema.retailSaleLines,
      itemName: schema.inventoryItems.name,
      unit: schema.inventoryItems.stockingUnit,
    })
    .from(schema.retailSaleLines)
    .innerJoin(
      schema.inventoryItems,
      and(
        eq(schema.inventoryItems.tenantId, schema.retailSaleLines.tenantId),
        eq(schema.inventoryItems.id, schema.retailSaleLines.itemId),
      ),
    )
    .where(
      and(
        eq(schema.retailSaleLines.tenantId, tenantId),
        inArray(
          schema.retailSaleLines.saleId,
          sales.map((s) => s.id),
        ),
      ),
    );

  const bySale = new Map<string, (RetailSaleLine & { itemName: string; unit: string })[]>();
  for (const row of rows) {
    const entry = { ...row.line, itemName: row.itemName, unit: row.unit };
    const list = bySale.get(row.line.saleId);
    if (list) list.push(entry);
    else bySale.set(row.line.saleId, [entry]);
  }

  return sales.map((sale) => {
    const lines = bySale.get(sale.id) ?? [];
    return {
      sale,
      lines,
      totalCents: saleTotalCents(
        lines.map((l) => ({
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
        })),
      ),
    };
  });
}

export interface DayTill {
  day: RetailMarketDay;
  channelName: string;
  sales: SaleRow[];
  takings: Takings;
  cash: CashCount;
  cost: MarketDayCost;
  result: DayResult;
  stockouts: (RetailStockout & { itemName: string })[];
}

/**
 * Everything one selling day's page needs — and the first time in this build
 * that **profit per market day** is a number rather than a promise.
 *
 * Folded, never stored. Re-running after a correction gives the corrected
 * answer, which is the property every report in these packs rests on.
 */
export async function dayTill(
  tx: Tx,
  tenantId: string,
  marketDayId: string,
): Promise<DayTill | null> {
  const day = await tx.query.retailMarketDays.findFirst({
    where: and(
      eq(schema.retailMarketDays.tenantId, tenantId),
      eq(schema.retailMarketDays.id, marketDayId),
    ),
  });
  if (!day) return null;

  const [sales, channel, stockoutRows] = await Promise.all([
    salesForDay(tx, tenantId, marketDayId),
    getChannel(tx, tenantId, day.channelId),
    tx
      .select({
        stockout: schema.retailStockouts,
        itemName: schema.inventoryItems.name,
      })
      .from(schema.retailStockouts)
      .innerJoin(
        schema.inventoryItems,
        and(
          eq(schema.inventoryItems.tenantId, schema.retailStockouts.tenantId),
          eq(schema.inventoryItems.id, schema.retailStockouts.itemId),
        ),
      )
      .where(
        and(
          eq(schema.retailStockouts.tenantId, tenantId),
          eq(schema.retailStockouts.marketDayId, marketDayId),
        ),
      ),
  ]);

  const took = takings(
    sales.map((s) => ({
      paymentMethod: s.sale.paymentMethod,
      totalCents: s.totalCents,
    })),
  );
  const cost = marketDayCost(day);

  return {
    day,
    channelName: channel?.name ?? "—",
    sales,
    takings: took,
    cash: cashCount({
      openingFloatCents: day.openingFloatCents,
      cashCountedCents: day.cashCountedCents,
      cashSalesCents: took.cashCents,
    }),
    cost,
    result: dayResult({
      takings: took,
      outOfPocketCents: cost.outOfPocketCents,
      personHours: cost.personHours,
      costUnrecorded: cost.unrecorded,
    }),
    stockouts: stockoutRows.map((r) => ({ ...r.stockout, itemName: r.itemName })),
  };
}

/** Takings per day, for the list page. One query whatever the day count. */
export async function takingsByDay(
  tx: Tx,
  tenantId: string,
  marketDayIds: string[],
): Promise<Map<string, Takings>> {
  const out = new Map<string, Takings>();
  if (marketDayIds.length === 0) return out;

  const rows = await tx
    .select({
      marketDayId: schema.retailSales.marketDayId,
      saleId: schema.retailSales.id,
      paymentMethod: schema.retailSales.paymentMethod,
      quantity: schema.retailSaleLines.quantity,
      unitPriceCents: schema.retailSaleLines.unitPriceCents,
    })
    .from(schema.retailSales)
    .leftJoin(
      schema.retailSaleLines,
      and(
        eq(schema.retailSaleLines.tenantId, schema.retailSales.tenantId),
        eq(schema.retailSaleLines.saleId, schema.retailSales.id),
      ),
    )
    .where(
      and(
        eq(schema.retailSales.tenantId, tenantId),
        inArray(schema.retailSales.marketDayId, marketDayIds),
      ),
    );

  // Fold to sale totals first, because the sale total is the sum of ROUNDED
  // lines — adding the raw quantities up per day would round once and disagree
  // with every receipt.
  const perSale = new Map<string, { dayId: string; method: string; cents: number }>();
  for (const row of rows) {
    if (!row.marketDayId) continue;
    const entry = perSale.get(row.saleId) ?? {
      dayId: row.marketDayId,
      method: row.paymentMethod,
      cents: 0,
    };
    if (row.quantity !== null && row.unitPriceCents !== null) {
      entry.cents += lineTotalCents({
        quantity: row.quantity,
        unitPriceCents: row.unitPriceCents,
      });
    }
    perSale.set(row.saleId, entry);
  }

  const byDay = new Map<string, { paymentMethod: string; totalCents: number }[]>();
  for (const entry of perSale.values()) {
    const list = byDay.get(entry.dayId);
    const sale = { paymentMethod: entry.method, totalCents: entry.cents };
    if (list) list.push(sale);
    else byDay.set(entry.dayId, [sale]);
  }
  for (const dayId of marketDayIds) {
    out.set(dayId, takings(byDay.get(dayId) ?? []));
  }
  return out;
}

export interface MarketDayInput {
  channelId: string;
  heldOn: string;
  stallFeeCents?: number | null;
  travelCents?: number | null;
  crewSize?: number | null;
  hours?: number | null;
  /** The change taken to the stall, and what was in the tin at the end. */
  openingFloatCents?: number | null;
  cashCountedCents?: number | null;
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
      openingFloatCents: input.openingFloatCents ?? null,
      cashCountedCents: input.cashCountedCents ?? null,
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
      openingFloatCents:
        patch.openingFloatCents === undefined
          ? existing.openingFloatCents
          : patch.openingFloatCents,
      cashCountedCents:
        patch.cashCountedCents === undefined
          ? existing.cashCountedCents
          : patch.cashCountedCents,
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
