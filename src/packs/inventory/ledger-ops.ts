import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { getDefaultEntityId, postEntry, type LedgerCtx } from "@/modules/accounting/core";
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
