import "server-only";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { getDefaultEntityId, postEntry, type LedgerCtx } from "@/modules/accounting/core";
import { allowsWrite } from "@/lib/packs/authorize";
import { InventoryError, type InventoryCtx } from "./ops";

/**
 * Where inventory's money lands in the books.
 *
 * Separate from `ops.ts` for the same reason `assets` keeps `depreciation-ops.ts`
 * apart: **this is the only part of the pack that touches core's tables, and the
 * boundary is worth being able to see.** Everything that writes goes through
 * `postEntry`, the same public entry point a hand-written journal uses. The pack
 * never inserts a journal line itself.
 *
 * **NO VALUATION IS STORED, EVER.** What stock is worth is a fold over the
 * movements — `core/valuation.ts` — exactly as an account balance is a fold over
 * journal lines rather than a maintained column. A stored valuation would be a
 * second source of truth that must agree with the ledger forever, which
 * [ADR 0007](../../../docs/decisions/0007-cash-basis-reporting.md) names as
 * accounting software's worst bug class.
 */

/** Cents. Positive = debit, negative = credit — the ledger's own convention. */
export interface InventoryAccounts {
  /** `1300 Inventory`. What stock on hand is carried as. */
  inventoryAccountId: string;
  /** `5000 Cost of Goods Sold`. Where cost goes when stock is consumed. */
  cogsAccountId: string;
  /**
   * Where a shrinkage or count variance is written off to.
   *
   * **Defaults to COGS, and that default is a judgement rather than an
   * accident.** Stock that went missing is genuinely a cost of the goods the
   * business sells, and inventing a separate account by convention would put a
   * line on the P&L that no chart in this repo actually contains. The
   * DIAGNOSTIC that slice 2 fought for is not lost by sharing an account: the
   * adjustment's reason travels in the entry memo, and grouping by reason still
   * happens where it always did, over `inventory_movements.reason`. A tenant
   * that wants shrinkage broken out sets `varianceAccountId` in config.
   */
  varianceAccountId: string;
}

/**
 * Which accounts this pack posts to.
 *
 * Resolution order, most specific first — the same shape as
 * `resolveDepreciationAccounts`:
 *   1. `tenant_modules.config.inventory` — Layer 3 tailoring, the sanctioned
 *      home for one company's differences (ADR 0009). No UI writes it yet.
 *   2. Convention: code first, then subtype.
 *
 * **REFUSES RATHER THAN GUESSING**, and the COGS case is why that matters here
 * rather than being boilerplate. The general chart ships TWO accounts with
 * subtype `cogs` — `5000 Cost of Goods Sold` and `5100 Subcontractor Expense` —
 * so a subtype lookup alone is ambiguous, and a resolver that picked the first
 * row would silently book a farm's meat against subcontractors. Code `5000` is
 * tried first for exactly that reason, and the subtype is only consulted when it
 * identifies exactly one account.
 *
 * Getting this wrong is worse than not posting at all: it is wrong quietly, and
 * it compounds with every movement until somebody reconciles.
 */
export async function resolveInventoryAccounts(
  tx: Tx,
  tenantId: string,
  config?: unknown,
): Promise<InventoryAccounts> {
  const configured = readConfiguredAccounts(config);
  const rows = await tx
    .select({
      id: schema.accounts.id,
      code: schema.accounts.code,
      subtype: schema.accounts.subtype,
      accountType: schema.accounts.accountType,
      isActive: schema.accounts.isActive,
    })
    .from(schema.accounts)
    .where(eq(schema.accounts.tenantId, tenantId));
  const active = rows.filter((r) => r.isActive);
  const byId = new Map(active.map((r) => [r.id, r]));

  const inventory =
    (configured.inventoryAccountId && byId.get(configured.inventoryAccountId)) ||
    pickOne(active.filter((r) => r.code === "1300")) ||
    pickOne(active.filter((r) => r.subtype === "inventory"));
  if (!inventory || inventory.accountType !== "asset") {
    throw new InventoryError(
      "LEDGER_ACCOUNTS",
      "Could not find exactly one active Inventory asset account (code 1300).",
    );
  }

  const cogs =
    (configured.cogsAccountId && byId.get(configured.cogsAccountId)) ||
    pickOne(active.filter((r) => r.code === "5000")) ||
    pickOne(active.filter((r) => r.subtype === "cogs"));
  if (!cogs || cogs.accountType !== "expense") {
    throw new InventoryError(
      "LEDGER_ACCOUNTS",
      "Could not find exactly one active Cost of Goods Sold account (code 5000).",
    );
  }

  // Shares COGS unless configured. See `varianceAccountId` above for why that
  // is deliberate rather than a shortcut.
  const variance =
    (configured.varianceAccountId && byId.get(configured.varianceAccountId)) ||
    cogs;
  if (variance.accountType !== "expense") {
    throw new InventoryError(
      "LEDGER_ACCOUNTS",
      "The configured inventory variance account is not an expense account.",
    );
  }

  return {
    inventoryAccountId: inventory.id,
    cogsAccountId: cogs.id,
    varianceAccountId: variance.id,
  };
}

function pickOne<T>(rows: T[]): T | null {
  return rows.length === 1 ? rows[0] : null;
}

/** `tenant_modules.config` is jsonb with no shape constraint, so parse totally. */
function readConfiguredAccounts(config: unknown): {
  inventoryAccountId?: string;
  cogsAccountId?: string;
  varianceAccountId?: string;
} {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  const inv = (config as Record<string, unknown>).inventory;
  if (!inv || typeof inv !== "object" || Array.isArray(inv)) return {};
  const i = inv as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    inventoryAccountId: str(i.inventoryAccountId),
    cogsAccountId: str(i.cogsAccountId),
    varianceAccountId: str(i.varianceAccountId),
  };
}

// ------------------------------------------------------------- the posting ---

/**
 * Whether this tenant's inventory reaches the books at all, and how.
 *
 * **`none` is the default and the honest answer for most tenants** — cost
 * accumulation runs regardless (it is always on, and wanted whatever basis a
 * business files on), it simply does not post. A tenant with no accounting
 * module at all necessarily reads `none`, and asking the settings row for one
 * that does not exist is not an error here: it is the answer.
 */
export async function inventoryTreatmentOf(
  tx: Tx,
  tenantId: string,
): Promise<"none" | "capitalise"> {
  const row = await tx.query.accountingSettings.findFirst({
    where: eq(schema.accountingSettings.tenantId, tenantId),
    columns: { inventoryTreatment: true },
  });
  return row?.inventoryTreatment ?? "none";
}

/**
 * The GRNI account — `2050 Goods Received Not Invoiced`.
 *
 * Resolved by SUBTYPE rather than by code, because a tenant may legitimately
 * renumber their chart, and because `2050` could already be in use by a tenant
 * who built their own before this shipped. Refuses rather than guessing, for the
 * same reason `resolveInventoryAccounts` does: an entry landing in the wrong
 * account is worse than no entry, because it is wrong quietly.
 */
export async function resolveGrniAccount(
  tx: Tx,
  tenantId: string,
): Promise<string> {
  const rows = await tx
    .select({
      id: schema.accounts.id,
      accountType: schema.accounts.accountType,
      isActive: schema.accounts.isActive,
    })
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.tenantId, tenantId),
        eq(schema.accounts.subtype, "goods_received"),
      ),
    );
  const active = rows.filter((r) => r.isActive && r.accountType === "liability");
  if (active.length !== 1) {
    throw new InventoryError(
      "LEDGER_ACCOUNTS",
      "Could not find exactly one active Goods Received Not Invoiced account (code 2050). Re-provision the chart of accounts.",
    );
  }
  return active[0].id;
}

/** The ledger context a machine posting runs under. See ADR 0011. */
function ledgerCtx(ctx: InventoryCtx): LedgerCtx {
  return { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role };
}

/**
 * **ONE MOVEMENT, ONE ENTRY, FOREVER.**
 *
 * The idempotency key is the movement's own id, so a retried write, a replayed
 * action or a double-submitted form lands exactly once — the same property
 * `retail`'s till gets from its `clientRef`, obtained here for free because a
 * movement already has an identity by the time it can be posted.
 */
function movementKey(kind: string, movementId: string): string {
  return `inventory:${kind}:${movementId}`;
}

export interface PostMovementInput {
  movementId: string;
  /** `receipt`, `issue` or `adjustment`. Decides which pair of accounts. */
  kind: "receipt" | "issue" | "adjustment";
  occurredOn: string;
  /**
   * Signed, and the sign only matters for an adjustment: POSITIVE is stock
   * leaving (a loss — `Dr variance / Cr inventory`), NEGATIVE is stock arriving.
   *
   * A gain does not occur today and that is deliberate rather than unhandled:
   * `adjustStock` stamps a negative adjustment at the average and a positive one
   * at NULL, because stock that turns up was never bought. A null cost posts
   * nothing, so the gain branch is unreachable until something starts costing
   * found stock — at which point it already works.
   */
  costCents: number;
  /** Named in the entry memo, so the ledger says what moved. */
  itemId: string;
  /** Appended to the memo when there is one — "(Kill day 2026-08-20)". */
  lotCode?: string | null;
}

const MEMO_VERB = {
  receipt: "Stock received",
  issue: "Stock issued",
  adjustment: "Stock adjusted",
} as const;

/**
 * Post one stock movement to the ledger, if this tenant posts at all.
 *
 * | Movement | Debit | Credit |
 * | --- | --- | --- |
 * | receipt | Inventory | Goods Received Not Invoiced |
 * | issue | the consumption account | Inventory |
 * | adjustment (loss) | the variance account | Inventory |
 * | adjustment (gain) | Inventory | the variance account |
 *
 * **TRANSFERS, SPLITS AND MERGES ARE ABSENT ON PURPOSE**, not forgotten: they
 * move cost within one account, so the entry would be `Dr 1300 / Cr 1300` — a
 * row that says nothing and balances. ADR 0012 §A.3.
 *
 * Returns `null` when nothing was posted, which is the ordinary case: a tenant
 * on `none`, or a movement with no cost. **A movement with no cost posts
 * NOTHING rather than posting zero** — the distinction `carriedValue` exists to
 * keep, arriving in the ledger.
 */
export async function postMovement(
  tx: Tx,
  ctx: InventoryCtx,
  input: PostMovementInput,
): Promise<{ entryId: string } | null> {
  if (input.costCents === 0) return null;
  const treatment = await inventoryTreatmentOf(tx, ctx.tenantId);
  if (treatment === "none") return null;

  const accounts = await resolveInventoryAccounts(tx, ctx.tenantId);
  const entityId = await getDefaultEntityId(tx, ctx.tenantId);
  // Read AFTER the `none` check, so a tenant that does not post pays for
  // nothing. A ledger line nobody can read back to a thing is a ledger line
  // somebody will ask about in a year, so the name is worth one lookup.
  const item = await tx.query.inventoryItems.findFirst({
    where: eq(schema.inventoryItems.id, input.itemId),
    columns: { name: true },
  });
  const memo =
    `${MEMO_VERB[input.kind]} — ${item?.name ?? "stock"}` +
    (input.lotCode ? ` (${input.lotCode})` : "");

  // Positive = debit, negative = credit — the ledger's own convention.
  const lines =
    input.kind === "receipt"
      ? [
          { accountId: accounts.inventoryAccountId, amountCents: input.costCents },
          {
            accountId: await resolveGrniAccount(tx, ctx.tenantId),
            amountCents: -input.costCents,
          },
        ]
      : input.kind === "issue"
        ? [
            { accountId: accounts.cogsAccountId, amountCents: input.costCents },
            {
              accountId: accounts.inventoryAccountId,
              amountCents: -input.costCents,
            },
          ]
        : [
            { accountId: accounts.varianceAccountId, amountCents: input.costCents },
            {
              accountId: accounts.inventoryAccountId,
              amountCents: -input.costCents,
            },
          ];

  const source =
    input.kind === "receipt"
      ? ("inventory_receipt" as const)
      : input.kind === "issue"
        ? ("inventory_issue" as const)
        : ("inventory_adjustment" as const);

  const { entry } = await postEntry(tx, ledgerCtx(ctx), {
    entityId,
    status: "posted",
    entryDate: input.occurredOn,
    memo,
    // ADR 0011: this source posts without the owner check, because the
    // authorisation happened where the stock moved.
    source,
    sourceId: input.movementId,
    idempotencyKey: movementKey(input.kind, input.movementId),
    lines,
  });
  return { entryId: entry.id };
}

// ------------------------------------------------------- matching the bill ---

export interface UnbilledReceipt {
  movementId: string;
  itemId: string;
  itemName: string;
  unit: string;
  lotId: string | null;
  lotCode: string | null;
  occurredOn: string;
  quantity: number;
  costCents: number;
  /** Already matched against this receipt by some bill line. */
  matchedQuantity: number;
  matchedCostCents: number;
  /** What is still waiting for an invoice. Can be zero; never negative here. */
  openQuantity: number;
  openCostCents: number;
}

/**
 * **STOCK THAT HAS ARRIVED AND HAS NOT BEEN INVOICED** — the working list for
 * matching a bill, and the detail behind the GRNI balance.
 *
 * A receipt with no cost is EXCLUDED: it credited nothing to GRNI, so there is
 * nothing for a bill to clear against it. That is not the same as saying it is
 * settled, and the valuation screen's "what this figure leaves out" card is
 * where an uncosted delivery shows up. Two different questions, two different
 * screens, and conflating them would make an unpriced delivery look reconciled.
 */
export async function unbilledReceipts(
  tx: Tx,
  tenantId: string,
  opts: { itemId?: string; limit?: number } = {},
): Promise<UnbilledReceipt[]> {
  const rows = await tx
    .select({
      movementId: schema.inventoryMovements.id,
      itemId: schema.inventoryMovements.itemId,
      itemName: schema.inventoryItems.name,
      unit: schema.inventoryItems.stockingUnit,
      lotId: schema.inventoryMovements.lotId,
      lotCode: schema.inventoryLots.code,
      occurredOn: schema.inventoryMovements.occurredOn,
      quantity: schema.inventoryMovements.quantity,
      costCents: schema.inventoryMovements.costCents,
      matchedQuantity: sql<string>`coalesce((
        select sum(a.quantity_matched) from bill_line_stock_allocations a
         where a.tenant_id = ${schema.inventoryMovements.tenantId}
           and a.inventory_movement_id = ${schema.inventoryMovements.id}
      ), 0)`,
      matchedCostCents: sql<string>`coalesce((
        select sum(a.receipt_cost_cents) from bill_line_stock_allocations a
         where a.tenant_id = ${schema.inventoryMovements.tenantId}
           and a.inventory_movement_id = ${schema.inventoryMovements.id}
      ), 0)`,
    })
    .from(schema.inventoryMovements)
    .innerJoin(
      schema.inventoryItems,
      and(
        eq(schema.inventoryItems.tenantId, schema.inventoryMovements.tenantId),
        eq(schema.inventoryItems.id, schema.inventoryMovements.itemId),
      ),
    )
    .leftJoin(
      schema.inventoryLots,
      and(
        eq(schema.inventoryLots.tenantId, schema.inventoryMovements.tenantId),
        eq(schema.inventoryLots.id, schema.inventoryMovements.lotId),
      ),
    )
    .where(
      and(
        eq(schema.inventoryMovements.tenantId, tenantId),
        eq(schema.inventoryMovements.movementKind, "receipt"),
        isNotNull(schema.inventoryMovements.costCents),
        opts.itemId
          ? eq(schema.inventoryMovements.itemId, opts.itemId)
          : undefined,
      ),
    )
    .orderBy(asc(schema.inventoryMovements.occurredOn))
    .limit(opts.limit ?? 200);

  return rows
    .map((r) => {
      const matchedQuantity = round4(Number(r.matchedQuantity));
      const matchedCostCents = Number(r.matchedCostCents);
      const costCents = r.costCents ?? 0;
      return {
        movementId: r.movementId,
        itemId: r.itemId,
        itemName: r.itemName,
        unit: r.unit,
        lotId: r.lotId,
        lotCode: r.lotCode,
        occurredOn: r.occurredOn,
        quantity: r.quantity,
        costCents,
        matchedQuantity,
        matchedCostCents,
        openQuantity: round4(r.quantity - matchedQuantity),
        openCostCents: costCents - matchedCostCents,
      };
    })
    .filter((r) => r.openQuantity > 0);
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export interface AllocateBillLineInput {
  billLineId: string;
  /** What the invoice charges for this line, in cents. Split across the matches. */
  invoiceCostCents: number;
  matches: { movementId: string; quantityMatched: number }[];
}

/**
 * **MATCH A BILL LINE TO THE DELIVERIES IT IS PAYING FOR**, and point the line
 * at GRNI so approving the bill clears what the receipts credited.
 *
 * **THE BILL LINE'S ACCOUNT IS SET HERE, NOT AT APPROVAL, and that is a layering
 * decision rather than a convenience.** `approveBill` lives in accounting core,
 * which is industry-blind and must not reach into a pack — so the substitution
 * cannot happen there. Setting the account at match time means `approveBill`
 * copies it verbatim, exactly as it does for every other line, and the bill path
 * is untouched by this slice.
 *
 * The invoice cost is split across the matches **by the receipts' own costs**,
 * not evenly: two deliveries of the same feed at different prices should each
 * carry its share of a combined invoice in proportion to what it was worth, and
 * splitting evenly would misstate both. The largest-remainder rule keeps the
 * parts summing to the whole.
 */
export async function allocateBillLineToStock(
  tx: Tx,
  ctx: InventoryCtx,
  input: AllocateBillLineInput,
): Promise<{ allocations: number; varianceCents: number }> {
  // OWNER. Matching a bill to a delivery decides what stock cost and clears a
  // liability — a decision, not a chore, which is the same line `livestock`
  // drew when it made movements member-level and lots owner-level.
  if (!allowsWrite(ctx.role, "owner")) {
    throw new InventoryError("FORBIDDEN", "only an owner can match a bill to stock");
  }
  if (input.matches.length === 0) {
    throw new InventoryError(
      "LOT_INVALID",
      "pick at least one delivery for this line",
    );
  }

  const line = await tx.query.billLines.findFirst({
    where: and(
      eq(schema.billLines.tenantId, ctx.tenantId),
      eq(schema.billLines.id, input.billLineId),
    ),
  });
  if (!line) throw new InventoryError("NOT_FOUND", "bill line");

  const open = await unbilledReceipts(tx, ctx.tenantId);
  const byId = new Map(open.map((r) => [r.movementId, r]));

  let receiptTotal = 0;
  for (const match of input.matches) {
    const receipt = byId.get(match.movementId);
    if (!receipt) {
      throw new InventoryError(
        "NOT_FOUND",
        "that delivery is already fully invoiced, or carries no cost to settle",
      );
    }
    if (match.quantityMatched <= 0) {
      throw new InventoryError("ZERO_QUANTITY", "match a quantity above zero");
    }
    if (round4(match.quantityMatched) > receipt.openQuantity) {
      throw new InventoryError(
        "INSUFFICIENT",
        `that delivery only has ${receipt.openQuantity} ${receipt.unit} left to invoice`,
      );
    }
    // The receipt's own cost for the matched share, at its own rate.
    receiptTotal += Math.round(
      (receipt.costCents * match.quantityMatched) / receipt.quantity,
    );
  }

  // Largest remainder, so the parts sum to the invoice exactly.
  const shares = input.matches.map((match) => {
    const receipt = byId.get(match.movementId)!;
    const receiptShare = Math.round(
      (receipt.costCents * match.quantityMatched) / receipt.quantity,
    );
    return { match, receipt, receiptShare };
  });
  const allocated = allocateByWeight(
    input.invoiceCostCents,
    shares.map((s) => s.receiptShare),
  );

  const grniAccountId = await resolveGrniAccount(tx, ctx.tenantId);
  const accounts = await resolveInventoryAccounts(tx, ctx.tenantId);

  for (let i = 0; i < shares.length; i += 1) {
    const { match, receiptShare } = shares[i];
    await tx
      .insert(schema.billLineStockAllocations)
      .values({
        tenantId: ctx.tenantId,
        billLineId: input.billLineId,
        inventoryMovementId: match.movementId,
        quantityMatched: match.quantityMatched,
        receiptCostCents: receiptShare,
        invoiceCostCents: allocated[i],
      })
      .onConflictDoNothing();
  }

  // Positive: the invoice asks for more than the tickets said.
  const varianceCents = input.invoiceCostCents - receiptTotal;

  /**
   * **THE LINE IS SPLIT SO THAT GRNI CLEARS EXACTLY.**
   *
   * `approveBill` posts each bill line to its own account at its own amount, so
   * a single line for the invoice total would debit GRNI 6,500 against the
   * 6,000 the receipt credited — and the 500 would sit in GRNI forever, where it
   * means neither "received not invoiced" nor anything else. That is not a
   * rounding difference; it is the price variance with nowhere to go, and ADR
   * 0012 §A.5 says it lands in an account rather than being absorbed.
   *
   * So the matched line carries exactly what the receipts credited, and a
   * sibling line carries the difference. AP is unaffected — the two still sum
   * to the invoice — and the entry `approveBill` builds becomes
   * `Dr GRNI 6,000 / Dr Variance 500 / Cr AP 6,500`.
   *
   * Found by a test that asserted GRNI clears. The test before it asserted only
   * that the variance was CALCULATED, which it was, and which is not the same
   * as it being recorded.
   */
  await tx
    .update(schema.billLines)
    .set({ accountId: grniAccountId, amountCents: receiptTotal })
    .where(
      and(
        eq(schema.billLines.tenantId, ctx.tenantId),
        eq(schema.billLines.id, input.billLineId),
      ),
    );

  if (varianceCents !== 0) {
    const siblings = await tx
      .select({ lineNo: schema.billLines.lineNo })
      .from(schema.billLines)
      .where(
        and(
          eq(schema.billLines.tenantId, ctx.tenantId),
          eq(schema.billLines.billId, line.billId),
        ),
      );
    const nextLineNo =
      siblings.reduce((max, r) => Math.max(max, r.lineNo), 0) + 1;
    // A NEGATIVE line is legal and is the cheaper-than-quoted case: the schema
    // calls it a credit line, and it credits the variance account instead.
    await tx.insert(schema.billLines).values({
      tenantId: ctx.tenantId,
      billId: line.billId,
      lineNo: nextLineNo,
      description: `Price difference against delivery — ${line.description}`,
      amountCents: varianceCents,
      accountId: accounts.varianceAccountId,
    });
  }

  return { allocations: shares.length, varianceCents };
}

/**
 * Split a total across weights so the parts sum to the whole, largest remainder
 * first. The same rule the cash-basis allocator uses, and for the same reason:
 * without it a split in integer cents loses or invents pennies.
 *
 * All-zero weights fall back to an even split, because "two deliveries that both
 * recorded no cost" still has to put the invoice somewhere.
 */
function allocateByWeight(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    const even = Math.floor(total / weights.length);
    const out = weights.map(() => even);
    let left = total - even * weights.length;
    for (let i = 0; left > 0; i += 1, left -= 1) out[i % out.length] += 1;
    return out;
  }
  const exact = weights.map((w) => (total * w) / sum);
  const floors = exact.map((e) => Math.floor(e));
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}
