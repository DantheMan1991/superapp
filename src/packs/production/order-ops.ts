import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  ProductionOrder,
  ProductionOrderLine,
  ProductionProcessorPriceItem,
} from "@/db/schema";
import { loadParty } from "@/lib/parties";
import { ProductionError, type ProductionCtx, requireWrite } from "./ops";
import {
  isPriceUnit,
  isValidSlug,
  priceCategoryRank,
  type PriceUnit,
} from "./vocabulary";

/**
 * THE CUT SHEET — what this farm asked one plant to do with one lot of animals.
 *
 * **SPLIT FROM `processor-ops.ts` FOR THE OPPOSITE REASON THAT FILE WAS SPLIT
 * FROM `ops.ts`.** A processor and its prices are standing facts that stay true
 * between runs; an order is a thing that happened once, on one date, at prices
 * that were current then. Mixing the two would put a lifetime that ends in the
 * file holding lifetimes that do not.
 *
 * **NOTHING HERE POSTS EITHER, and that is worth being explicit about now that
 * a number on this table reaches the ledger.** An order is a QUOTE — the same
 * standing the price items have and for the same reason. What crosses into cost
 * is `production_runs.processing_fee_cents`, stamped by `completeRun` from a
 * figure a person confirmed. The order itself never changes because a run
 * completed.
 *
 * **THE FEE IS FOLDED IN `runDetail`, NOT HERE**, and that is deliberate rather
 * than an oversight about where it belongs. That function already has the
 * orders and the run's measures in hand; a second entry point would be a second
 * way to answer one question, which is the shape this codebase keeps finding
 * disagrees with itself within a season. `core/fee.ts` is the arithmetic, and
 * it is pure.
 *
 * **WRITES ARE MEMBER, WHICH IS THE OPPOSITE CALL FROM `setPriceItem`.**
 * Recording what a plant charges is the terms of a commercial relationship and
 * is OWNER; choosing which of those options you want this time is a working
 * decision made with a customer on the phone or a clipboard in the yard, and
 * the design says on a half-beef sale it is *the customer's* choice rather than
 * the farm's at all. It also posts nothing: the fee that reaches the ledger is
 * stamped by `completeRun`, which is owner.
 */

export interface OrderInput {
  processorId: string;
  bookingId?: string | null;
  runId?: string | null;
  title?: string;
  kind?: string;
  headCount?: number | null;
  notes?: string;
}

export type OrderPatch = Partial<Omit<OrderInput, "processorId">>;

export interface OrderLineInput {
  /** Where the price came from. Absent for a pure instruction. */
  priceItemId?: string | null;
  category?: string;
  label?: string;
  unitPriceCents?: number | null;
  unit?: string | null;
  minimumCents?: number | null;
  quantity?: number | null;
  notes?: string;
}

/** An order with its lines, for a screen and for the printed sheet. */
export interface OrderDetail {
  order: ProductionOrder;
  /** The plant's name, from the party. Never copied onto this table. */
  processorName: string;
  lines: ProductionOrderLine[];
}

/**
 * The order's lines in the order the sheet reads: the way the paper groups
 * itself, then the plant's own words, with anything unanticipated last.
 *
 * Sorted here rather than in SQL for the reason `sheetOrder` gives in
 * `processor-ops.ts` — the grouping is a rank over an open taxonomy.
 */
function lineOrder(rows: ProductionOrderLine[]): ProductionOrderLine[] {
  return [...rows].sort(
    (a, b) =>
      priceCategoryRank(a.category) - priceCategoryRank(b.category) ||
      a.category.localeCompare(b.category) ||
      a.label.localeCompare(b.label),
  );
}

export async function listOrders(
  tx: Tx,
  tenantId: string,
  filter: { bookingId?: string; runId?: string } = {},
): Promise<OrderDetail[]> {
  const where = [eq(schema.productionOrders.tenantId, tenantId)];
  if (filter.bookingId) {
    where.push(eq(schema.productionOrders.bookingId, filter.bookingId));
  }
  if (filter.runId) where.push(eq(schema.productionOrders.runId, filter.runId));

  const orders = await tx.query.productionOrders.findMany({
    where: and(...where),
    orderBy: [asc(schema.productionOrders.createdAt)],
  });
  if (orders.length === 0) return [];

  // Two reads, not one per order — the same rule `listProcessors` follows.
  const [lines, processors] = await Promise.all([
    tx.query.productionOrderLines.findMany({
      where: eq(schema.productionOrderLines.tenantId, tenantId),
    }),
    tx.query.productionProcessors.findMany({
      where: eq(schema.productionProcessors.tenantId, tenantId),
    }),
  ]);
  const parties = await tx.query.parties.findMany({
    where: eq(schema.parties.tenantId, tenantId),
  });
  const nameByParty = new Map(parties.map((p) => [p.id, p.displayName]));
  const nameByProcessor = new Map(
    processors.map((p) => [p.id, nameByParty.get(p.partyId) ?? ""]),
  );

  return orders.map((order) => ({
    order,
    processorName: nameByProcessor.get(order.processorId) ?? "",
    lines: lineOrder(lines.filter((l) => l.orderId === order.id)),
  }));
}

export async function getOrder(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<OrderDetail | null> {
  const order = await tx.query.productionOrders.findFirst({
    where: and(
      eq(schema.productionOrders.tenantId, tenantId),
      eq(schema.productionOrders.id, id),
    ),
  });
  if (!order) return null;
  const [lines, processor] = await Promise.all([
    tx.query.productionOrderLines.findMany({
      where: and(
        eq(schema.productionOrderLines.tenantId, tenantId),
        eq(schema.productionOrderLines.orderId, id),
      ),
    }),
    tx.query.productionProcessors.findFirst({
      where: and(
        eq(schema.productionProcessors.tenantId, tenantId),
        eq(schema.productionProcessors.id, order.processorId),
      ),
    }),
  ]);
  const party = processor
    ? await loadParty(tx, tenantId, processor.partyId)
    : null;
  return {
    order,
    processorName: party?.displayName ?? "",
    lines: lineOrder(lines),
  };
}

/**
 * Start a cut sheet.
 *
 * **IT MUST NAME A BOOKING OR A RUN**, checked here as well as by the CHECK
 * constraint, because the constraint's message is a constraint name and this
 * one has an actual answer: an order attached to nothing is a sheet for a day
 * that does not exist.
 */
export async function createOrder(
  tx: Tx,
  ctx: ProductionCtx,
  input: OrderInput,
): Promise<ProductionOrder> {
  requireWrite(ctx, "member");
  const bookingId = input.bookingId ?? null;
  const runId = input.runId ?? null;
  if (!bookingId && !runId) {
    throw new ProductionError(
      "ORDER_INVALID",
      "say which date or which run this is for",
    );
  }
  const kind = (input.kind ?? "").trim().toLowerCase();
  if (kind !== "" && !isValidSlug(kind)) {
    throw new ProductionError(
      "INVALID_KIND",
      "use lowercase letters, numbers and underscores",
    );
  }
  if (input.headCount !== undefined && input.headCount !== null && input.headCount <= 0) {
    throw new ProductionError("ORDER_INVALID", "a sheet covers at least one head");
  }
  await requireProcessor(tx, ctx.tenantId, input.processorId);

  const [row] = await tx
    .insert(schema.productionOrders)
    .values({
      tenantId: ctx.tenantId,
      processorId: input.processorId,
      bookingId,
      runId,
      title: (input.title ?? "").trim(),
      kind,
      headCount: input.headCount ?? null,
      notes: (input.notes ?? "").trim(),
    })
    .returning();
  return row;
}

export async function updateOrder(
  tx: Tx,
  ctx: ProductionCtx,
  id: string,
  patch: OrderPatch,
): Promise<ProductionOrder> {
  requireWrite(ctx, "member");
  if (patch.kind !== undefined) {
    const kind = patch.kind.trim().toLowerCase();
    if (kind !== "" && !isValidSlug(kind)) {
      throw new ProductionError(
        "INVALID_KIND",
        "use lowercase letters, numbers and underscores",
      );
    }
  }
  const [row] = await tx
    .update(schema.productionOrders)
    .set({
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.kind !== undefined
        ? { kind: patch.kind.trim().toLowerCase() }
        : {}),
      ...(patch.headCount !== undefined ? { headCount: patch.headCount } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes.trim() } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.productionOrders.tenantId, ctx.tenantId),
        eq(schema.productionOrders.id, id),
      ),
    )
    .returning();
  if (!row) throw new ProductionError("NOT_FOUND", "that sheet is gone");
  return row;
}

export async function removeOrder(
  tx: Tx,
  ctx: ProductionCtx,
  id: string,
): Promise<ProductionOrder> {
  requireWrite(ctx, "member");
  const [row] = await tx
    .delete(schema.productionOrders)
    .where(
      and(
        eq(schema.productionOrders.tenantId, ctx.tenantId),
        eq(schema.productionOrders.id, id),
      ),
    )
    .returning();
  if (!row) throw new ProductionError("NOT_FOUND", "that is already gone");
  return row;
}

/**
 * Put a line on a sheet.
 *
 * **A LINE QUOTING A PRICE ITEM COPIES IT AND THEN FORGETS IT.** The label, the
 * price, the unit and the minimum are read once, here, and written onto the
 * line. `price_item_id` survives only as provenance — it is nulled if the price
 * is later deleted, and the line still says what was asked for and what it was
 * quoted at. That is this pack's stamping rule, applied to a quote rather than
 * to a movement: a rate sheet updated in March must not restate what an October
 * order was quoted.
 *
 * **A LINE WITH NO PRICE ITEM IS AN INSTRUCTION**, which is half of what a cut
 * sheet actually is — *"ribeyes at one inch, grind the chuck"* specifies
 * treatment, not money. It needs a label and nothing else.
 */
export async function addOrderLine(
  tx: Tx,
  ctx: ProductionCtx,
  orderId: string,
  input: OrderLineInput,
): Promise<ProductionOrderLine> {
  requireWrite(ctx, "member");
  const order = await tx.query.productionOrders.findFirst({
    where: and(
      eq(schema.productionOrders.tenantId, ctx.tenantId),
      eq(schema.productionOrders.id, orderId),
    ),
  });
  if (!order) throw new ProductionError("NOT_FOUND", "that sheet is gone");

  let quoted: ProductionProcessorPriceItem | null = null;
  if (input.priceItemId) {
    const row = await tx.query.productionProcessorPriceItems.findFirst({
      where: and(
        eq(schema.productionProcessorPriceItems.tenantId, ctx.tenantId),
        eq(schema.productionProcessorPriceItems.id, input.priceItemId),
      ),
    });
    if (!row) throw new ProductionError("NOT_FOUND", "that price is gone");
    /**
     * **A SHEET CANNOT QUOTE ANOTHER PLANT'S RATE.** The FK only says the price
     * belongs to this tenant, and an order handed to Miller's carrying Valley
     * Poultry's per-bird cutting fee would be a number nobody could account for
     * later. Caught here because there is no constraint that can say it: the
     * link runs order → processor and line → price item → processor, and
     * Postgres has no way to insist the two ends meet.
     */
    if (row.processorId !== order.processorId) {
      throw new ProductionError(
        "ORDER_INVALID",
        "that price belongs to somebody else — a sheet quotes the rates of the place it is going to",
      );
    }
    quoted = row;
  }

  const label = (input.label ?? quoted?.label ?? "").trim();
  if (!label) {
    throw new ProductionError("ORDER_INVALID", "say what you are asking for");
  }
  const category = (input.category ?? quoted?.category ?? "extra")
    .trim()
    .toLowerCase();
  if (!isValidSlug(category)) {
    throw new ProductionError(
      "INVALID_KIND",
      "use lowercase letters, numbers and underscores",
    );
  }

  const unitPriceCents =
    input.unitPriceCents !== undefined
      ? input.unitPriceCents
      : (quoted?.priceCents ?? null);
  const unitRaw = input.unit !== undefined ? input.unit : (quoted?.unit ?? null);
  const unit: PriceUnit | null =
    unitRaw !== null && unitRaw !== "" && isPriceUnit(unitRaw) ? unitRaw : null;
  if (unitRaw !== null && unitRaw !== "" && unit === null) {
    throw new ProductionError(
      "ORDER_INVALID",
      "say what the price is per — a head, a pound, a package, a box, a drop-off or an hour",
    );
  }
  // The CHECK says so too; this says it in words rather than in a constraint
  // name, and it is the itemised sheet's central rule arriving on the order.
  if (unitPriceCents !== null && unit === null) {
    throw new ProductionError(
      "ORDER_INVALID",
      "a price needs to say what it is per",
    );
  }
  for (const [value, what] of [
    [unitPriceCents, "the price"],
    [input.minimumCents, "the minimum"],
  ] as const) {
    if (value !== undefined && value !== null && value < 0) {
      throw new ProductionError("ORDER_INVALID", `${what} cannot be negative`);
    }
  }
  if (input.quantity !== undefined && input.quantity !== null && input.quantity <= 0) {
    throw new ProductionError(
      "ORDER_INVALID",
      "nought of something is not a line — take it off instead",
    );
  }

  const [row] = await tx
    .insert(schema.productionOrderLines)
    .values({
      tenantId: ctx.tenantId,
      orderId,
      priceItemId: input.priceItemId ?? null,
      category,
      label,
      unitPriceCents,
      unit,
      minimumCents:
        input.minimumCents !== undefined
          ? input.minimumCents
          : (quoted?.minimumCents ?? null),
      quantity: input.quantity ?? null,
      notes: (input.notes ?? "").trim(),
    })
    .returning();
  return row;
}

/**
 * Change a line — the quantity somebody counted, or the instruction beside it.
 *
 * **THE PRICE IS NOT PATCHABLE HERE, ON PURPOSE.** A quote that can be edited
 * after the fact is not a quote, and the one question this table exists to keep
 * answerable is whether the plant charged more than it said. Somebody who
 * quoted the wrong option takes the line off and adds the right one.
 */
export async function updateOrderLine(
  tx: Tx,
  ctx: ProductionCtx,
  id: string,
  patch: { quantity?: number | null; notes?: string },
): Promise<ProductionOrderLine> {
  requireWrite(ctx, "member");
  if (patch.quantity !== undefined && patch.quantity !== null && patch.quantity <= 0) {
    throw new ProductionError(
      "ORDER_INVALID",
      "nought of something is not a line — take it off instead",
    );
  }
  const [row] = await tx
    .update(schema.productionOrderLines)
    .set({
      ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes.trim() } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.productionOrderLines.tenantId, ctx.tenantId),
        eq(schema.productionOrderLines.id, id),
      ),
    )
    .returning();
  if (!row) throw new ProductionError("NOT_FOUND", "that line is gone");
  return row;
}

export async function removeOrderLine(
  tx: Tx,
  ctx: ProductionCtx,
  id: string,
): Promise<ProductionOrderLine> {
  requireWrite(ctx, "member");
  const [row] = await tx
    .delete(schema.productionOrderLines)
    .where(
      and(
        eq(schema.productionOrderLines.tenantId, ctx.tenantId),
        eq(schema.productionOrderLines.id, id),
      ),
    )
    .returning();
  if (!row) throw new ProductionError("NOT_FOUND", "that is already gone");
  return row;
}

/**
 * **THE SHEETS A BOOKING CARRIES, HANDED ON TO THE RUN IT BECAME.**
 *
 * Called by `startRunFromBooking`, so the cut sheet written months before the
 * kill day is the one the fee is worked out from. Without this the order would
 * stay pointing at a booking nothing reads again, and the run would have no way
 * to know what was asked for.
 *
 * Guarded to orders with no run, so re-running it cannot move a sheet already
 * attached elsewhere. Returns how many moved, for the audit entry.
 */
export async function attachOrdersToRun(
  tx: Tx,
  ctx: ProductionCtx,
  bookingId: string,
  runId: string,
): Promise<number> {
  const rows = await tx
    .update(schema.productionOrders)
    .set({ runId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.productionOrders.tenantId, ctx.tenantId),
        eq(schema.productionOrders.bookingId, bookingId),
        isNull(schema.productionOrders.runId),
      ),
    )
    .returning();
  return rows.length;
}

async function requireProcessor(
  tx: Tx,
  tenantId: string,
  processorId: string,
): Promise<void> {
  const row = await tx.query.productionProcessors.findFirst({
    where: and(
      eq(schema.productionProcessors.tenantId, tenantId),
      eq(schema.productionProcessors.id, processorId),
    ),
  });
  if (!row) throw new ProductionError("NOT_FOUND", "that processor is gone");
}
