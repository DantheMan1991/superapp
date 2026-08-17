import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Asset } from "@/db/schema";
import {
  entityForDocument,
  getClosedThrough,
  listDimensionMembers,
  postEntry,
} from "@/modules/accounting/core";
import { AssetError, ASSET_DIMENSION, type AssetCtx } from "./ops";
import {
  buildSchedule,
  catchUpKey,
  disposalMaths,
  periodEndDate,
  periodKey,
  periodOf,
  periodsCoveredByKey,
  splitAtClose,
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

/**
 * Periods already in the ledger for this asset, as `YYYY-MM`.
 *
 * Read from the IDEMPOTENCY KEY, not the entry date. A catch-up entry covers
 * many periods under one date, so the date cannot say what was posted — the
 * key can, and it is already stored and uniquely indexed. Reading dates here
 * would make every caught-up period look unposted forever.
 */
export async function listPostedPeriods(
  tx: Tx,
  tenantId: string,
  assetId: string,
  schedule: DepreciationPeriod[],
): Promise<string[]> {
  const rows = await tx
    .select({
      entryDate: schema.journalEntries.entryDate,
      idempotencyKey: schema.journalEntries.idempotencyKey,
    })
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.tenantId, tenantId),
        eq(schema.journalEntries.source, "depreciation"),
        eq(schema.journalEntries.sourceId, assetId),
      ),
    );
  const periods = new Set<string>();
  for (const row of rows) {
    if (row.idempotencyKey) {
      for (const p of periodsCoveredByKey(row.idempotencyKey, schedule)) {
        periods.add(p);
      }
    } else {
      // An entry with no key predates this scheme or was hand-made. Fall back
      // to its date so it still counts as covering its own month.
      periods.add(periodOf(row.entryDate));
    }
  }
  return [...periods];
}

/**
 * What has ACTUALLY been posted for this asset, in cents.
 *
 * Summed from the journal lines rather than re-derived from the schedule, and
 * the difference is not academic: **a schedule can change after posting**.
 * Editing an in-service date reshuffles which periods carry the remainder cent,
 * so recomputing would report a number the books do not contain. Found on the
 * live tenant 2026-08-15 — the panel said 6,706.76 while the ledger held
 * 6,706.78.
 *
 * This is the file header's own rule, applied the whole way: accumulated
 * depreciation is what the ledger says, not what the schedule predicts.
 *
 * Only `posted` entries count. A voided depreciation entry is money that came
 * back out of the books and must stop counting the moment it does.
 */
export async function postedToDateCents(
  tx: Tx,
  tenantId: string,
  assetId: string,
): Promise<number> {
  const rows = await tx
    .select({ total: sql<number>`coalesce(sum(${schema.journalLines.amountCents}), 0)::int` })
    .from(schema.journalLines)
    .innerJoin(
      schema.journalEntries,
      and(
        eq(schema.journalEntries.tenantId, schema.journalLines.tenantId),
        eq(schema.journalEntries.id, schema.journalLines.entryId),
      ),
    )
    .where(
      and(
        eq(schema.journalLines.tenantId, tenantId),
        eq(schema.journalEntries.source, "depreciation"),
        eq(schema.journalEntries.sourceId, assetId),
        eq(schema.journalEntries.status, "posted"),
        // The debit half. Each entry is one debit to expense and one credit to
        // accumulated, so the positives are the depreciation taken.
        gt(schema.journalLines.amountCents, 0),
      ),
    );
  return rows[0]?.total ?? 0;
}

export interface DepreciationStatus {
  schedule: DepreciationPeriod[];
  postedPeriods: string[];
  /** Sum of what has actually been posted — read from the ledger, not stored. */
  postedToDateCents: number;
  /** cost − postedToDate. What the books say it is worth right now. */
  bookValueCents: number;
  due: DepreciationPeriod[];
  /** Of `due`, the periods stranded behind a close — they collapse into one entry. */
  strandedCount: number;
  /** Where the catch-up entry will be dated, when there is one. */
  catchUpPeriod: string | null;
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
  const postedPeriods = await listPostedPeriods(tx, tenantId, asset.id, schedule);
  // From the LEDGER, not the schedule — see postedToDateCents.
  const posted = await postedToDateCents(tx, tenantId, asset.id);
  const due = unpostedPeriods(input, through, postedPeriods);

  // The lock of the company this asset's depreciation posts into (ADR 0010
   // slice 4). A fixed asset still has no company of its own — the assets pack
   // is `entityForDocument`'s last caller — so the answer comes from where its
   // entries have always landed, which is the same source the posting path
   // below uses. Give `assets` an `entity_id` and both read it directly.
  const closedThrough = await getClosedThrough(
    tx,
    tenantId,
    await entityForDocument(tx, tenantId, "depreciation", asset.id),
  );
  const { stranded, open } = splitAtClose(due, closedThrough);
  return {
    schedule,
    postedPeriods,
    postedToDateCents: posted,
    bookValueCents: (asset.acquisitionCostCents ?? 0) - posted,
    due,
    strandedCount: stranded.length,
    catchUpPeriod:
      stranded.length > 0 ? (open[0]?.period ?? periodOf(through)) : null,
  };
}

export interface PostDepreciationResult {
  postedPeriods: string[];
  totalCents: number;
  /** How many pre-close periods were rolled into a single catch-up entry. */
  caughtUpCount: number;
}

/**
 * Post every period that is due, up to and including `through`.
 *
 * ONE ENTRY PER OPEN PERIOD, dated to that period's month end. A single lump
 * for several open months would put their expense in one month and misstate
 * every P&L in between, which is the report people run depreciation for.
 *
 * THE ONE EXCEPTION IS THE CLOSE. Periods whose month-end falls on or before
 * `closedThrough` cannot be posted at all, and refusing the whole run because
 * of them strands every open month behind them — which is what happens to any
 * asset entered with a truthful backdated in-service date. So those periods
 * are summed into a SINGLE catch-up entry dated in the first open period,
 * which is what a bookkeeper does by hand: the expense is recognised, the
 * accumulated balance ends up correct, and no closed period is reopened.
 *
 * Idempotent via the entry's idempotency key — per period for the ordinary
 * ones, and `through:<period>` for the catch-up, which is also how
 * `listPostedPeriods` knows what a catch-up covered.
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
  const schedule = buildSchedule(input);
  const posted = await listPostedPeriods(tx, ctx.tenantId, asset.id, schedule);
  const due = unpostedPeriods(input, through, posted);
  if (due.length === 0) {
    return { postedPeriods: [], totalCents: 0, caughtUpCount: 0 };
  }

  const closedThrough = await getClosedThrough(
    tx,
    ctx.tenantId,
    await entityForDocument(tx, ctx.tenantId, "depreciation", asset.id),
  );
  const { stranded, open } = splitAtClose(due, closedThrough);

  const members = await listDimensionMembers(tx, ctx.tenantId, ASSET_DIMENSION);
  const member = members.find((m) => m.packEntityId === asset.id);
  // Every line is tagged with the asset, which is what makes "what has this
  // tractor cost me" answerable from the P&L rather than from this pack.
  const dimensionMemberIds = member ? [member.id] : undefined;

  const lines = (amountCents: number) => [
    {
      accountId: accounts.expenseAccountId,
      amountCents,
      memo: asset.name,
      dimensionMemberIds,
    },
    {
      accountId: accounts.accumulatedAccountId,
      amountCents: -amountCents,
      memo: asset.name,
      dimensionMemberIds,
    },
  ];

  const donePeriods: string[] = [];
  let total = 0;

  if (stranded.length > 0) {
    // Dated in the first open period. When every due period is stranded — an
    // asset fully depreciated before the close — there is no open period to
    // borrow, so fall back to the month being posted through.
    const catchUpPeriod = open[0]?.period ?? periodOf(`${through}-01`);
    const amount = stranded.reduce((s, r) => s + r.amountCents, 0);
    const first = stranded[0].period;
    const last = stranded.at(-1)!.period;
    await postEntry(tx, ctx, {
      // Every entry an asset ever posts lands in the company its FIRST one did
      // — a depreciation schedule split across two sets of books by a moved
      // default would understate one and overstate the other for years.
      entityId: await entityForDocument(tx, ctx.tenantId, "depreciation", asset.id),
      status: "posted",
      entryDate: periodEndDate(catchUpPeriod),
      memo: `Depreciation catch-up — ${asset.name} (${first} to ${last}, ${stranded.length} months before close)`,
      source: "depreciation",
      sourceId: asset.id,
      idempotencyKey: catchUpKey(asset.id, last),
      lines: lines(amount),
    });
    donePeriods.push(...stranded.map((r) => r.period));
    total += amount;
  }

  for (const row of open) {
    await postEntry(tx, ctx, {
      entityId: await entityForDocument(tx, ctx.tenantId, "depreciation", asset.id),
      status: "posted",
      entryDate: periodEndDate(row.period),
      memo: `Depreciation — ${asset.name} (${row.period})`,
      source: "depreciation",
      sourceId: asset.id,
      idempotencyKey: periodKey(asset.id, row.period),
      lines: lines(row.amountCents),
    });
    donePeriods.push(row.period);
    total += row.amountCents;
  }

  return {
    postedPeriods: donePeriods,
    totalCents: total,
    caughtUpCount: stranded.length,
  };
}

/** The account a gain or loss on disposal lands in. */
async function resolveGainLossAccount(
  tx: Tx,
  tenantId: string,
): Promise<string> {
  const rows = await tx
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.tenantId, tenantId),
        eq(schema.accounts.code, "4950"),
        eq(schema.accounts.isActive, true),
      ),
    );
  if (rows.length !== 1) {
    throw new AssetError(
      "DEPRECIATION_ACCOUNTS",
      "Could not find a Gain (Loss) on Asset Disposal account (code 4950). Re-run accounting provisioning to add it.",
    );
  }
  return rows[0].id;
}

export interface DisposalPosting {
  posted: boolean;
  /** Why nothing was posted, when nothing was. */
  reason?: "no_cost" | "no_asset_account";
  gainCents?: number;
  bookValueCents?: number;
}

/**
 * Take a disposed asset off the balance sheet.
 *
 * Removes the cost and the accumulated depreciation, records any proceeds, and
 * recognises the difference as a gain or a loss. Without this a sold tractor
 * stays on the books forever, which is the state this pack shipped in.
 *
 * POSTS NOTHING, AND SAYS SO, when it cannot know what to remove. An asset with
 * no cost, or one whose cost was never linked to a fixed-asset account, has no
 * balance to clear — and guessing an account would put a real number in the
 * wrong place, which is worse than a disposal that is only a status. The caller
 * surfaces `reason` rather than swallowing it.
 */
export async function postDisposal(
  tx: Tx,
  ctx: AssetCtx,
  asset: Asset,
  args: {
    disposedOn: string;
    proceedsCents: number;
    /** Where the money landed. Required only when there are proceeds. */
    proceedsAccountId?: string | null;
  },
  config?: unknown,
): Promise<DisposalPosting> {
  if (ctx.role !== "owner") {
    throw new AssetError("FORBIDDEN", "owner role required");
  }
  if (asset.acquisitionCostCents === null) {
    return { posted: false, reason: "no_cost" };
  }
  if (!asset.assetAccountId) {
    return { posted: false, reason: "no_asset_account" };
  }
  if (args.proceedsCents > 0 && !args.proceedsAccountId) {
    throw new AssetError(
      "DEPRECIATION_ACCOUNTS",
      "Choose the account the sale proceeds went into.",
    );
  }

  const accounts = await resolveDepreciationAccounts(tx, ctx.tenantId, config);
  const gainLossAccountId = await resolveGainLossAccount(tx, ctx.tenantId);
  const accumulated = await postedToDateCents(tx, ctx.tenantId, asset.id);
  const maths = disposalMaths({
    costCents: asset.acquisitionCostCents,
    accumulatedCents: accumulated,
    proceedsCents: args.proceedsCents,
  });

  const members = await listDimensionMembers(tx, ctx.tenantId, ASSET_DIMENSION);
  const member = members.find((m) => m.packEntityId === asset.id);
  const dimensionMemberIds = member ? [member.id] : undefined;

  // Signed cents: positive is a debit. Zero-amount lines are dropped because
  // the ledger rejects them — an asset with no depreciation taken, or one given
  // away for nothing, simply has fewer legs.
  const lines = [
    { accountId: accounts.accumulatedAccountId, amountCents: accumulated },
    {
      accountId: args.proceedsAccountId ?? "",
      amountCents: args.proceedsCents,
    },
    {
      accountId: asset.assetAccountId,
      amountCents: -asset.acquisitionCostCents,
    },
    { accountId: gainLossAccountId, amountCents: -maths.gainCents },
  ]
    .filter((l) => l.amountCents !== 0 && l.accountId !== "")
    .map((l) => ({ ...l, memo: asset.name, dimensionMemberIds }));

  await postEntry(tx, ctx, {
    entityId: await entityForDocument(tx, ctx.tenantId, "depreciation", asset.id),
    status: "posted",
    entryDate: args.disposedOn,
    memo: `Disposal — ${asset.name}`,
    source: "depreciation",
    sourceId: asset.id,
    idempotencyKey: `disposal:${asset.id}`,
    lines,
  });

  return {
    posted: true,
    gainCents: maths.gainCents,
    bookValueCents: maths.bookValueCents,
  };
}

export interface BulkDepreciationResult {
  assetsPosted: number;
  periodsPosted: number;
  totalCents: number;
  caughtUpCount: number;
}

/**
 * Post depreciation for every depreciable asset, in one go.
 *
 * At three assets the per-asset button is fine. At a hundred it is not a
 * feature, it is a chore — and month-end is exactly when nobody has an hour to
 * spend clicking. This is the same posting path, looped.
 *
 * ONE TRANSACTION for the whole run, deliberately. A month-end close that
 * half-posted would leave books nobody can reason about, and the caller has to
 * be able to say "that did not happen" rather than "some of that happened".
 * The catch-up collapsing above is what keeps the volume sane: without it a
 * first run over 100 backdated assets would be thousands of entries.
 */
export async function postAllDepreciation(
  tx: Tx,
  ctx: AssetCtx,
  through: string,
  config?: unknown,
): Promise<BulkDepreciationResult> {
  if (ctx.role !== "owner") {
    throw new AssetError("FORBIDDEN", "owner role required");
  }
  const assets = await tx.query.assets.findMany({
    where: and(
      eq(schema.assets.tenantId, ctx.tenantId),
      eq(schema.assets.status, "active"),
    ),
    orderBy: (a, { asc }) => [asc(a.name)],
  });

  const result: BulkDepreciationResult = {
    assetsPosted: 0,
    periodsPosted: 0,
    totalCents: 0,
    caughtUpCount: 0,
  };
  for (const asset of assets) {
    if (!scheduleInputFor(asset)) continue;
    const one = await postDepreciation(tx, ctx, asset, through, config);
    if (one.postedPeriods.length === 0) continue;
    result.assetsPosted += 1;
    result.periodsPosted += one.postedPeriods.length;
    result.totalCents += one.totalCents;
    result.caughtUpCount += one.caughtUpCount;
  }
  return result;
}
