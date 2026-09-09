import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Asset } from "@/db/schema";
import {
  findOpeningBalanceAccountId,
  getBooksStartOn,
  getClosedThrough,
  listDimensionMembers,
  postEntry,
} from "@/modules/accounting/core";
import { AssetError, ASSET_DIMENSION, type AssetCtx } from "./ops";

/**
 * The company whose books this asset depreciates in.
 *
 * `entity_id` is legitimately nullable — an asset can be registered by a tenant
 * with no accounting at all (see the schema note) — and such an asset cannot
 * depreciate, because there are no books to depreciate in. It REFUSES rather
 * than falling back to the tenant default: a default chosen at posting time is
 * exactly the behaviour this column replaced, and reintroducing it as an error
 * path would put one asset's schedule in two sets of books.
 *
 * Reaching this means accounting was provisioned after the asset was created
 * AND the adoption in `provisionAccounting` did not run, so the message names
 * the repair rather than the symptom.
 */
function entityOf(asset: Pick<Asset, "id" | "entityId">): string {
  if (!asset.entityId) {
    throw new AssetError(
      "ASSET_NO_COMPANY",
      `asset ${asset.id} belongs to no company — open the books for this tenant first`,
    );
  }
  return asset.entityId;
}
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
        /**
         * The debit half. An ordinary entry is one debit to expense and one
         * credit to accumulated; the opening entry of an asset owned before
         * the books began (ADR 0038) debits Opening Balance Equity instead.
         * Either way the positive line IS the depreciation taken, which is why
         * the cost half of that opening balance is deliberately a separate
         * entry under another source.
         */
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

  // The lock of the company that OWNS this asset. It reads the column now
  // rather than inferring the company from where the first entry landed, which
  // is what `entityForDocument` did and why that helper is gone.
  const closedThrough = await getClosedThrough(tx, tenantId, entityOf(asset));
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

  const closedThrough = await getClosedThrough(tx, ctx.tenantId, entityOf(asset));
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
      entityId: entityOf(asset),
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
      entityId: entityOf(asset),
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
    entityId: entityOf(asset),
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

/* -- Owned before the books began (ADR 0038) ------------------------------ */

/** The cost entry's key. One per asset, for ever — see `getAssetOpeningState`. */
function openingCostKey(assetId: string): string {
  return `opening:asset:${assetId}`;
}

export interface AssetOpeningState {
  /** The company's first day, or null when nobody has said (ADR 0035). */
  booksStartOn: string | null;
  /**
   * Why an opening balance cannot be recorded, or null when it can. Read by
   * the asset's page so it can explain BEFORE the button is pressed, which is
   * the lesson `postDisposal`'s `reason` learned the other way round.
   */
  blocked:
    | "no_books_start"
    | "no_cost"
    | "no_asset_account"
    | "not_before_start"
    | "already_recorded"
    | null;
  /**
   * The last scheduled period whose month ENDED before the start day — what
   * the depreciation entry's key says it covers. Null when the asset is not
   * depreciated, or when its schedule starts on or after the day.
   */
  throughPeriod: string | null;
  /** What the schedule says was taken through that period. A suggestion, never the answer. */
  scheduleAccumulatedCents: number;
  costCents: number | null;
}

/**
 * Can this asset's opening balance be recorded, and what does the schedule
 * think was already taken?
 */
export async function getAssetOpeningState(
  tx: Tx,
  tenantId: string,
  asset: Asset,
): Promise<AssetOpeningState> {
  const booksStartOn = asset.entityId
    ? await getBooksStartOn(tx, tenantId, asset.entityId)
    : null;

  const input = scheduleInputFor(asset);
  const schedule = input ? buildSchedule(input) : [];
  /**
   * A period belongs to the OLD books when its month ENDED before the day.
   * Books that begin mid-month leave that month to the new books, where its
   * depreciation is posted month by month like any other.
   */
  const covered = booksStartOn
    ? schedule.filter((r) => periodEndDate(r.period) < booksStartOn)
    : [];
  const state = {
    booksStartOn,
    throughPeriod: covered.at(-1)?.period ?? null,
    scheduleAccumulatedCents: covered.at(-1)?.accumulatedCents ?? 0,
    costCents: asset.acquisitionCostCents,
  };

  if (!booksStartOn) return { ...state, blocked: "no_books_start" as const };
  if (asset.acquisitionCostCents === null) return { ...state, blocked: "no_cost" as const };
  if (!asset.assetAccountId) return { ...state, blocked: "no_asset_account" as const };
  const ownedFrom = asset.acquiredOn ?? asset.inServiceOn;
  if (!ownedFrom || ownedFrom >= booksStartOn) {
    return { ...state, blocked: "not_before_start" as const };
  }

  /**
   * ALREADY IN THE BOOKS, by either half. The cost entry's key is one per
   * asset for ever — the ledger's unique index on it is not freed by a void —
   * and depreciation already posted would be double-counted by an opening
   * figure laid on top. Both are the same answer to the person: this is
   * recorded, and a correction is a journal entry.
   */
  const prior = await tx
    .select({ id: schema.journalEntries.id })
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.tenantId, tenantId),
        eq(schema.journalEntries.idempotencyKey, openingCostKey(asset.id)),
      ),
    );
  if (prior.length > 0) return { ...state, blocked: "already_recorded" as const };
  if ((await postedToDateCents(tx, tenantId, asset.id)) > 0) {
    return { ...state, blocked: "already_recorded" as const };
  }

  return { ...state, blocked: null };
}

export interface AssetOpeningPosted {
  entryDate: string;
  costCents: number;
  accumulatedCents: number;
  /** The period the depreciation entry covers, or null when none was written. */
  throughPeriod: string | null;
}

/**
 * Put an asset the business already owned onto the books it is starting.
 *
 * TWO ENTRIES, both dated on the day the books begin (ADR 0038):
 *
 *   Dr  Cost sits in              cost           source `opening_balance`
 *       Cr  Opening Balance Equity
 *
 *   Dr  Opening Balance Equity    already taken  source `depreciation`
 *       Cr  Accumulated depreciation
 *
 * THE SPLIT IS NOT COSMETIC. `postedToDateCents` sums the POSITIVE lines of
 * this asset's `depreciation` entries, so a cost debit inside one would be
 * read as depreciation taken. Keeping the cost under `opening_balance` also
 * makes it the same shape as a register's opening balance, which is the only
 * other thing in the product that puts a starting figure on the books.
 *
 * The depreciation entry's key is `catchUpKey(asset, throughPeriod)`, which
 * `periodsCoveredByKey` already reads as "every scheduled period up to and
 * including this one". So the old books' months are marked posted by the very
 * mechanism a catch-up uses, and the next `postDepreciation` starts at the
 * first month the new books own. No new concept, and nothing to keep in step.
 *
 * THE FIGURE IS THE PERSON'S, not the schedule's. The old books were kept by
 * somebody, possibly on a convention this app does not model, and their number
 * is the true one. The schedule's figure is offered beside it as a suggestion,
 * and where the two disagree the asset finishes above or below its salvage
 * value — which the guide says plainly rather than quietly correcting.
 */
export async function recordAssetOpening(
  tx: Tx,
  ctx: AssetCtx,
  asset: Asset,
  args: { accumulatedCents: number },
  config?: unknown,
): Promise<AssetOpeningPosted> {
  if (ctx.role !== "owner") {
    throw new AssetError("FORBIDDEN", "owner role required");
  }
  const state = await getAssetOpeningState(tx, ctx.tenantId, asset);
  if (state.blocked) {
    throw new AssetError("ASSET_OPENING_BLOCKED", state.blocked);
  }
  const entryDate = state.booksStartOn!;
  const cost = asset.acquisitionCostCents!;
  const accumulated = Math.round(args.accumulatedCents);
  if (accumulated < 0 || accumulated > cost) {
    throw new AssetError(
      "ASSET_OPENING_AMOUNT",
      "Depreciation already taken cannot be negative, or more than what it cost.",
    );
  }
  if (accumulated > 0 && !state.throughPeriod) {
    throw new AssetError(
      "ASSET_OPENING_AMOUNT",
      "This asset's depreciation starts on or after the day your books begin, so none was taken before it.",
    );
  }

  const obeAccountId = await findOpeningBalanceAccountId(tx, ctx.tenantId);
  const members = await listDimensionMembers(tx, ctx.tenantId, ASSET_DIMENSION);
  const member = members.find((m) => m.packEntityId === asset.id);
  const dimensionMemberIds = member ? [member.id] : undefined;

  await postEntry(tx, ctx, {
    entityId: entityOf(asset),
    status: "posted",
    entryDate,
    memo: `Opening balance — ${asset.name}`,
    source: "opening_balance",
    sourceId: asset.id,
    idempotencyKey: openingCostKey(asset.id),
    lines: [
      {
        accountId: asset.assetAccountId!,
        amountCents: cost,
        memo: asset.name,
        dimensionMemberIds,
      },
      { accountId: obeAccountId, amountCents: -cost, memo: asset.name },
    ],
  });

  if (accumulated > 0) {
    const accounts = await resolveDepreciationAccounts(tx, ctx.tenantId, config);
    await postEntry(tx, ctx, {
      entityId: entityOf(asset),
      status: "posted",
      entryDate,
      memo: `Depreciation already taken — ${asset.name} (through ${state.throughPeriod})`,
      source: "depreciation",
      sourceId: asset.id,
      idempotencyKey: catchUpKey(asset.id, state.throughPeriod!),
      lines: [
        { accountId: obeAccountId, amountCents: accumulated, memo: asset.name },
        {
          accountId: accounts.accumulatedAccountId,
          amountCents: -accumulated,
          memo: asset.name,
          dimensionMemberIds,
        },
      ],
    });
  }

  return {
    entryDate,
    costCents: cost,
    accumulatedCents: accumulated,
    throughPeriod: accumulated > 0 ? state.throughPeriod : null,
  };
}
