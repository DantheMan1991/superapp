import "server-only";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { InventoryError } from "./ops";

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
