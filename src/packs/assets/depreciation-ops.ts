import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Asset } from "@/db/schema";
import { listDimensionMembers, postEntry } from "@/modules/accounting/core";
import { AssetError, ASSET_DIMENSION, type AssetCtx } from "./ops";
import {
  buildSchedule,
  periodEndDate,
  periodOf,
  unpostedPeriods,
  type DepreciationInput,
  type DepreciationPeriod,
  isDepreciationMethod,
} from "./core/depreciation";

/**
 * Posting depreciation into the ledger.
 *
 * Separate from `ops.ts` because this is the only part of the pack that writes
 * to core's tables, and the boundary is worth being able to see: everything
 * here goes through `postEntry`, the same public entry point a human journal
 * uses. The pack never inserts a journal line itself.
 *
 * ACCUMULATED DEPRECIATION IS NOT STORED ON THE ASSET. It is the sum of what
 * has been posted, exactly as `balances.ts` computes account balances on read
 * rather than maintaining a table. A column would be a second source of truth
 * that must agree with the ledger forever, and ADR 0007 already names that as
 * accounting software's worst bug class.
 */

/** Cents. Positive = debit, negative = credit — the ledger's own convention. */
interface ResolvedAccounts {
  expenseAccountId: string;
  accumulatedAccountId: string;
}

/**
 * Which accounts depreciation posts to.
 *
 * Resolution order, most specific first:
 *   1. `tenant_modules.config.depreciation` — Layer 3 tailoring, the sanctioned
 *      home for one company's differences (ADR 0009). No UI writes it yet.
 *   2. Convention: subtype `accumulated_depreciation` for the credit, and the
 *      `6900` code for the debit.
 *
 * Refuses rather than guessing when it cannot resolve exactly one of each. A
 * depreciation entry landing in the wrong account is worse than no entry: it is
 * wrong quietly, and it compounds every month until somebody reconciles.
 */
export async function resolveDepreciationAccounts(
  tx: Tx,
  tenantId: string,
  config?: unknown,
): Promise<ResolvedAccounts> {
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

  const accumulated =
    (configured.accumulatedAccountId &&
      byId.get(configured.accumulatedAccountId)) ||
    pickOne(active.filter((r) => r.subtype === "accumulated_depreciation"));
  if (!accumulated) {
    throw new AssetError(
      "DEPRECIATION_ACCOUNTS",
      "Could not find exactly one active Accumulated Depreciation account.",
    );
  }

  const expense =
    (configured.expenseAccountId && byId.get(configured.expenseAccountId)) ||
    pickOne(active.filter((r) => r.code === "6900")) ||
    pickOne(active.filter((r) => r.subtype === "depreciation_expense"));
  if (!expense || expense.accountType !== "expense") {
    throw new AssetError(
      "DEPRECIATION_ACCOUNTS",
      "Could not find a Depreciation Expense account (code 6900).",
    );
  }

  return { expenseAccountId: expense.id, accumulatedAccountId: accumulated.id };
}

function pickOne<T>(rows: T[]): T | null {
  return rows.length === 1 ? rows[0] : null;
}

/** `tenant_modules.config` is jsonb with no shape constraint, so parse totally. */
function readConfiguredAccounts(config: unknown): {
  expenseAccountId?: string;
  accumulatedAccountId?: string;
} {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  const dep = (config as Record<string, unknown>).depreciation;
  if (!dep || typeof dep !== "object" || Array.isArray(dep)) return {};
  const d = dep as Record<string, unknown>;
  return {
    expenseAccountId:
      typeof d.expenseAccountId === "string" ? d.expenseAccountId : undefined,
    accumulatedAccountId:
      typeof d.accumulatedAccountId === "string"
        ? d.accumulatedAccountId
        : undefined,
  };
}

/** The schedule inputs an asset carries, or null when it does not depreciate. */
export function scheduleInputFor(asset: Asset): DepreciationInput | null {
  if (!isDepreciationMethod(asset.depreciationMethod)) return null;
  if (asset.depreciationMethod === "none") return null;
  // The `assets_depreciable_is_complete` CHECK guarantees these three are
  // present whenever the method is not 'none'. Re-checked anyway, because a
  // null here would silently produce an empty schedule.
  if (
    asset.acquisitionCostCents === null ||
    asset.usefulLifeMonths === null ||
    asset.inServiceOn === null
  ) {
    return null;
  }
  return {
    costCents: asset.acquisitionCostCents,
    salvageValueCents: asset.salvageValueCents ?? 0,
    method: asset.depreciationMethod,
    usefulLifeMonths: asset.usefulLifeMonths,
    inServiceOn: asset.inServiceOn,
  };
}

/** Periods already in the ledger for this asset, as `YYYY-MM`. */
export async function listPostedPeriods(
  tx: Tx,
  tenantId: string,
  assetId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ entryDate: schema.journalEntries.entryDate })
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.tenantId, tenantId),
        eq(schema.journalEntries.source, "depreciation"),
        eq(schema.journalEntries.sourceId, assetId),
      ),
    );
  return rows.map((r) => periodOf(r.entryDate));
}

export interface DepreciationStatus {
  schedule: DepreciationPeriod[];
  postedPeriods: string[];
  /** Sum of what has actually been posted — read from the ledger, not stored. */
  postedToDateCents: number;
  /** cost − postedToDate. What the books say it is worth right now. */
  bookValueCents: number;
  due: DepreciationPeriod[];
}

/** Everything the detail page needs to describe where an asset stands. */
export async function getDepreciationStatus(
  tx: Tx,
  tenantId: string,
  asset: Asset,
  through: string,
): Promise<DepreciationStatus | null> {
  const input = scheduleInputFor(asset);
  if (!input) return null;
  const schedule = buildSchedule(input);
  const postedPeriods = await listPostedPeriods(tx, tenantId, asset.id);
  const posted = new Set(postedPeriods);
  const postedToDateCents = schedule
    .filter((r) => posted.has(r.period))
    .reduce((s, r) => s + r.amountCents, 0);
  return {
    schedule,
    postedPeriods,
    postedToDateCents,
    bookValueCents: (asset.acquisitionCostCents ?? 0) - postedToDateCents,
    due: unpostedPeriods(input, through, postedPeriods),
  };
}

export interface PostDepreciationResult {
  postedPeriods: string[];
  totalCents: number;
}

/**
 * Post every period that is due, up to and including `through`.
 *
 * ONE ENTRY PER PERIOD, dated to that period's month end — never one lump for
 * a catch-up. A single combined entry would put six months of expense in one
 * month and quietly misstate every P&L in between, which is precisely the
 * report people run depreciation for.
 *
 * Idempotent per period via the entry's idempotency key, so a double-click, a
 * retry, or two people pressing the button at once post once.
 */
export async function postDepreciation(
  tx: Tx,
  ctx: AssetCtx,
  asset: Asset,
  through: string,
  config?: unknown,
): Promise<PostDepreciationResult> {
  if (ctx.role !== "owner") {
    throw new AssetError("FORBIDDEN", "owner role required");
  }
  const input = scheduleInputFor(asset);
  if (!input) {
    throw new AssetError(
      "NOT_DEPRECIABLE",
      "This asset has no depreciation schedule.",
    );
  }

  const accounts = await resolveDepreciationAccounts(tx, ctx.tenantId, config);
  const posted = await listPostedPeriods(tx, ctx.tenantId, asset.id);
  const due = unpostedPeriods(input, through, posted);
  if (due.length === 0) return { postedPeriods: [], totalCents: 0 };

  const members = await listDimensionMembers(tx, ctx.tenantId, ASSET_DIMENSION);
  const member = members.find((m) => m.packEntityId === asset.id);
  // Every line is tagged with the asset, which is what makes "what has this
  // tractor cost me" answerable from the P&L rather than from this pack.
  const dimensionMemberIds = member ? [member.id] : undefined;

  const donePeriods: string[] = [];
  let total = 0;
  for (const row of due) {
    await postEntry(tx, ctx, {
      status: "posted",
      entryDate: periodEndDate(row.period),
      memo: `Depreciation — ${asset.name} (${row.period})`,
      source: "depreciation",
      sourceId: asset.id,
      idempotencyKey: `depreciation:${asset.id}:${row.period}`,
      lines: [
        {
          accountId: accounts.expenseAccountId,
          amountCents: row.amountCents,
          memo: asset.name,
          dimensionMemberIds,
        },
        {
          accountId: accounts.accumulatedAccountId,
          amountCents: -row.amountCents,
          memo: asset.name,
          dimensionMemberIds,
        },
      ],
    });
    donePeriods.push(row.period);
    total += row.amountCents;
  }
  return { postedPeriods: donePeriods, totalCents: total };
}
