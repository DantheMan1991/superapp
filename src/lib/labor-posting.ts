import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { postEntry, reverseEntry } from "@/modules/accounting/core";
import type { LedgerCtx } from "@/modules/accounting/core";

/**
 * Re-exported so `src/modules/time/` can name the type it passes in.
 *
 * A module may not import another module AT ALL — eslint's rule is on the
 * import path and does not care that `import type` erases at build time. The
 * door has to hand the shape out as well as take it in.
 */
export type { LedgerCtx };

/**
 * THE DOOR FROM A CORE MODULE ONTO THE LEDGER, for labor and nothing else.
 *
 * At `src/lib/` because **`src/modules/time/` may not import
 * `src/modules/accounting/`** — eslint.config.mjs's `MODULE_SLUGS` rule, which
 * binds modules and deliberately leaves `src/packs/` and Layer 0 alone. That is
 * why inventory can call `postEntry` from its own directory and Time cannot.
 * `src/lib/dimensions.ts` was written for the same reason in slice 4, for the
 * dimension READ; this is the write.
 *
 * **It is narrow on purpose.** Nothing here takes a list of accounts or a set
 * of lines: it takes a period's labor and posts the one entry that means, and
 * the account choice is made here rather than by a caller. A general "post
 * anything from anywhere" helper in Layer 0 would be a second door into the
 * ledger with none of `postEntry`'s guards in front of it, which is exactly
 * what ADR 0011 refused when it rejected `postMachineEntry`.
 *
 * Everything takes the CALLER'S `tx`, per `src/lib/enterprises/`: the RLS
 * context is already established from a `requireTenant()` result, so what this
 * can write is exactly what the person pressing the button may.
 */

/** Nothing here guesses; a chart that cannot answer is a refusal. */
export class LaborPostingError extends Error {
  constructor(
    readonly code:
      | "LEDGER_ACCOUNTS"
      | "NO_ENTITY"
      | "NOTHING_TO_POST"
      | "ALREADY_POSTED",
    message: string,
  ) {
    super(message);
    this.name = "LaborPostingError";
  }
}

/** One posting line's worth of labor: what it was for, and what it cost. */
export interface LaborAccrualLine {
  /**
   * Dimension member ids to tag the line with, at most one per type. Empty
   * means the hours were never attributed, which posts untagged rather than
   * not posting.
   */
  memberIds: readonly string[];
  /** Gross pay, in cents. What the people receive. */
  wagesCents: number;
  /** The employer's on-costs, in cents. What the business additionally spends. */
  burdenCents: number;
  /** What the line says in the journal — the enterprise's name, usually. */
  memo: string;
}

export interface PostLaborAccrualInput {
  /** The `time_periods` row this accrual is for. */
  periodId: string;
  /** The bookkeeping day: the last day of the pay period. */
  entryDate: string;
  memo: string;
  lines: readonly LaborAccrualLine[];
}

interface LaborAccounts {
  wagesAccountId: string;
  payrollTaxAccountId: string;
  liabilityAccountId: string;
}

/** Exactly one, or nothing. Ambiguity is never a first-row pick. */
function pickOne<T>(rows: T[]): T | null {
  return rows.length === 1 ? rows[0] : null;
}

/**
 * The three accounts a wage accrual needs, from the tenant's own chart.
 *
 * **Code first for the two expenses, subtype first for the liability**, which
 * is the same split inventory's resolvers make and for the same two reasons.
 * `6450 Salaries & Wages` and `6500 Payroll Taxes` BOTH carry subtype
 * `payroll_expense`, so subtype cannot tell them apart — `pickOne` returns null
 * on the pair and the code is what decides. The liability inverts it because a
 * tenant may renumber their chart but is far less likely to retype a subtype.
 *
 * All three ship in the general chart template, so no tenant with a provisioned
 * chart needs anything added. A tenant who has deleted or duplicated one gets a
 * refusal naming the code, not a guess — booking wages to the wrong account is
 * the kind of error nobody finds until a tax return.
 */
async function resolveLaborAccounts(
  tx: Tx,
  tenantId: string,
): Promise<LaborAccounts> {
  const active = await tx.query.accounts.findMany({
    where: and(
      eq(schema.accounts.tenantId, tenantId),
      eq(schema.accounts.isActive, true),
    ),
    columns: { id: true, code: true, subtype: true, accountType: true },
  });

  const wages = pickOne(active.filter((r) => r.code === "6450"));
  if (!wages || wages.accountType !== "expense") {
    throw new LaborPostingError(
      "LEDGER_ACCOUNTS",
      "Could not find exactly one active Salaries & Wages expense account (code 6450).",
    );
  }

  const payrollTax = pickOne(active.filter((r) => r.code === "6500"));
  if (!payrollTax || payrollTax.accountType !== "expense") {
    throw new LaborPostingError(
      "LEDGER_ACCOUNTS",
      "Could not find exactly one active Payroll Taxes expense account (code 6500).",
    );
  }

  const liability =
    pickOne(active.filter((r) => r.subtype === "payroll_liability")) ??
    pickOne(active.filter((r) => r.code === "2300"));
  if (!liability || liability.accountType !== "liability") {
    throw new LaborPostingError(
      "LEDGER_ACCOUNTS",
      "Could not find exactly one active Payroll Liabilities account (code 2300).",
    );
  }

  return {
    wagesAccountId: wages.id,
    payrollTaxAccountId: payrollTax.id,
    liabilityAccountId: liability.id,
  };
}

/**
 * Which set of books the wages land in.
 *
 * **The default entity, and only the default entity.** A person is employed by
 * one company, and a tenant running several has already told the platform which
 * one an unattributed entry belongs to — `entities.is_default`, exactly one per
 * tenant by a partial unique index. Inventory resolves its company from where
 * the stock physically is; labor has no equivalent fact to read, and inventing
 * a second place to declare it would be a setting that disagrees with the
 * default sooner or later.
 *
 * A tenant whose second company employs its own people needs Time to know that,
 * and it does not yet. That is a real limit, recorded rather than papered over.
 */
async function resolveLaborEntity(tx: Tx, tenantId: string): Promise<string> {
  const entity = await tx.query.entities.findFirst({
    where: and(
      eq(schema.entities.tenantId, tenantId),
      eq(schema.entities.isDefault, true),
      eq(schema.entities.isActive, true),
    ),
    columns: { id: true },
  });
  if (!entity) {
    throw new LaborPostingError(
      "NO_ENTITY",
      "This business has no default company to post wages to. Set one in Accounting first.",
    );
  }
  return entity.id;
}

/**
 * Every accrual ever posted for one pay period, newest first.
 *
 * Read from the LEDGER by `source` + `source_id`, never from a column on
 * `time_periods` — the same rule production's `openProcessingAccruals` follows.
 * What posted is a fact about the journal; a pointer on the source row is a
 * second copy of that fact, and the two drift the first time an entry is voided
 * from the journal screen.
 *
 * **DOES NOT include the reversals**, and cannot: `reverseEntry` writes
 * `source = 'reversal'` with no `source_id` at all, so a reversal is only
 * reachable through `reverses_entry_id`. That is what `reversedAccruals` below
 * is for, and getting it wrong is silent — the reversal posts, and the period
 * still looks accrued.
 *
 * The COUNT is what keeps idempotency keys unique across a lock / unlock /
 * re-lock, and counting only the accruals is right for that: the first post
 * keys on 0, the one after a reversal on 1.
 */
export async function laborAccrualEntries(
  tx: Tx,
  tenantId: string,
  periodId: string,
): Promise<Array<{ id: string; status: string; reversesEntryId: string | null }>> {
  return await tx.query.journalEntries.findMany({
    where: and(
      eq(schema.journalEntries.tenantId, tenantId),
      eq(schema.journalEntries.source, "payroll_accrual"),
      eq(schema.journalEntries.sourceId, periodId),
    ),
    columns: { id: true, status: true, reversesEntryId: true },
    orderBy: [desc(schema.journalEntries.createdAt)],
  });
}

/**
 * Which of these entries have already been reversed.
 *
 * A reversal carries `source = 'reversal'` and no `source_id`, so it is NEVER
 * in a `laborAccrualEntries` result. The only link back is `reverses_entry_id`,
 * and reading it is the difference between a period that can be posted again
 * and one that is stuck forever.
 */
async function reversedAccruals(
  tx: Tx,
  tenantId: string,
  entryIds: readonly string[],
): Promise<Set<string>> {
  if (entryIds.length === 0) return new Set();
  const rows = await tx.query.journalEntries.findMany({
    where: and(
      eq(schema.journalEntries.tenantId, tenantId),
      eq(schema.journalEntries.status, "posted"),
      inArray(schema.journalEntries.reversesEntryId, [...entryIds]),
    ),
    columns: { reversesEntryId: true },
  });
  return new Set(
    rows
      .map((r) => r.reversesEntryId)
      .filter((id): id is string => id !== null),
  );
}

/** The accrual still standing for a period, if there is one. */
export async function openLaborAccrual(
  tx: Tx,
  tenantId: string,
  periodId: string,
): Promise<string | null> {
  const entries = (await laborAccrualEntries(tx, tenantId, periodId)).filter(
    (e) => e.status === "posted",
  );
  const reversed = await reversedAccruals(
    tx,
    tenantId,
    entries.map((e) => e.id),
  );
  return entries.find((e) => !reversed.has(e.id))?.id ?? null;
}

/**
 * Is any wage accrual still standing anywhere in this business?
 *
 * The question `setPostsLabor(false)` has to ask. "Has anything ever posted" is
 * the wrong one and would be a trap: a business that tried the feature, changed
 * its mind and unlocked every period would be unable to turn it off for ever,
 * with nothing left in the ledger to justify the refusal.
 *
 * An accrual is standing when it is posted and nothing reverses it, which is
 * the same test `openLaborAccrual` makes for one period.
 */
export async function hasOpenLaborAccrual(
  tx: Tx,
  tenantId: string,
): Promise<boolean> {
  const entries = await tx.query.journalEntries.findMany({
    where: and(
      eq(schema.journalEntries.tenantId, tenantId),
      eq(schema.journalEntries.source, "payroll_accrual"),
      eq(schema.journalEntries.status, "posted"),
    ),
    columns: { id: true },
  });
  const reversed = await reversedAccruals(
    tx,
    tenantId,
    entries.map((e) => e.id),
  );
  return entries.some((e) => !reversed.has(e.id));
}

/**
 * Post one pay period's labor: expense by dimension, one liability for the lot.
 *
 * **A CREDIT TO A LIABILITY, NOT TO CASH.** Nothing has been paid at this
 * point — the hours are agreed, the money is not out of the door, and the whole
 * reason this is called an accrual is that the expense belongs to the period
 * that earned it rather than the day the bank moves. `2300` is relieved when
 * the payroll provider's run is entered as a bill or a bank transaction, the
 * same way `2060` is relieved by the plant's invoice.
 *
 * Wages and on-costs are separate EXPENSE lines against one shared liability.
 * A P&L that folded the employer's tax into wages would tell an owner their
 * people cost less than they do, and splitting the expense costs one line.
 *
 * Returns null when there is nothing to post — an empty period, or one where
 * nobody has a rate — rather than posting a zero entry or throwing. A business
 * that keeps hours and no wages must still be able to lock a period.
 */
export async function postLaborAccrual(
  tx: Tx,
  ctx: LedgerCtx,
  input: PostLaborAccrualInput,
): Promise<{ entryId: string } | null> {
  const lines = input.lines.filter(
    (l) => l.wagesCents > 0 || l.burdenCents > 0,
  );
  if (lines.length === 0) return null;

  const total = lines.reduce((sum, l) => sum + l.wagesCents + l.burdenCents, 0);
  if (total <= 0) return null;

  if (await openLaborAccrual(tx, ctx.tenantId, input.periodId)) {
    throw new LaborPostingError(
      "ALREADY_POSTED",
      "This period's wages are already in the books.",
    );
  }

  const accounts = await resolveLaborAccounts(tx, ctx.tenantId);
  const entityId = await resolveLaborEntity(tx, ctx.tenantId);

  /*
   * The key carries how many entries this period has already produced, so a
   * period that was unlocked and locked again posts a SECOND accrual rather
   * than silently deduping onto the first — the shape `approveBill` uses
   * (`bill:${id}:${prior.length}`). Reversals count, because they are entries
   * for this period too.
   */
  const prior = await laborAccrualEntries(tx, ctx.tenantId, input.periodId);

  const entryLines = [
    ...lines.flatMap((line) => {
      const dimensionMemberIds =
        line.memberIds.length > 0 ? [...line.memberIds] : undefined;
      const out = [];
      if (line.wagesCents > 0) {
        out.push({
          accountId: accounts.wagesAccountId,
          amountCents: line.wagesCents,
          memo: line.memo,
          dimensionMemberIds,
        });
      }
      if (line.burdenCents > 0) {
        out.push({
          accountId: accounts.payrollTaxAccountId,
          amountCents: line.burdenCents,
          memo: line.memo,
          dimensionMemberIds,
        });
      }
      return out;
    }),
    { accountId: accounts.liabilityAccountId, amountCents: -total },
  ];

  const { entry } = await postEntry(tx, ctx, {
    entityId,
    status: "posted",
    entryDate: input.entryDate,
    memo: input.memo,
    source: "payroll_accrual",
    sourceId: input.periodId,
    idempotencyKey: `time:payroll_accrual:${input.periodId}:${prior.length}`,
    lines: entryLines,
  });
  return { entryId: entry.id };
}

/**
 * Take a period's wages back out of the books.
 *
 * An OFFSETTING ENTRY, never a delete: the original stays posted and both show
 * on the journal, netting to zero. That is `reverseEntry`'s contract and the
 * right one — an accrual that was in the books for a week and then vanished
 * without trace is how a trial balance stops reconciling to anything.
 *
 * Silent when there is nothing standing, so unlocking a period that never
 * posted is not an error. The caller is undoing a lock, not asserting a fact
 * about the ledger.
 */
export async function reverseLaborAccrual(
  tx: Tx,
  ctx: LedgerCtx,
  input: { periodId: string; entryDate?: string; memo?: string },
): Promise<{ entryId: string } | null> {
  const entryId = await openLaborAccrual(tx, ctx.tenantId, input.periodId);
  if (!entryId) return null;

  const { entry } = await reverseEntry(tx, ctx, {
    entryId,
    entryDate: input.entryDate,
    memo: input.memo,
  });
  return { entryId: entry.id };
}
