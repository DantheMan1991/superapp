import "server-only";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { BankRule } from "@/db/schema";
import {
  LedgerError,
  listEntities,
  requireOwnerRole,
  type LedgerCtx,
} from "../core";
import {
  matchRules,
  parseConditions,
  type MatchableRule,
  type RuleCondition,
  type RuleMatch,
} from "./rules-match";
import {
  RULE_PROPOSAL_THRESHOLD,
  SUGGESTED_RULE_PRIORITY,
  commonDescriptionPhrase,
  suggestedRuleName,
} from "./rules-learn";
// One-way: rules post THROUGH the review path, review knows nothing of rules.
// Proposing a rule is driven from the action layer to keep it that way.
import { categorizeTransaction } from "./review";

/**
 * Reading and writing bank rules. All the deciding lives in the two pure
 * modules beside this one; this file only touches rows.
 */

/** Shape of the rule_suggestion jsonb on bank_transactions. */
export interface StoredRuleSuggestion {
  ruleId: string;
  ruleName: string;
  accountId: string;
  accountCode: string;
  /** Snapshot of the payee the rule named, for the same reason as the rest. */
  vendorId?: string;
  vendorName?: string;
  memo?: string;
  at: string;
}

export function readRuleSuggestion(txn: {
  ruleSuggestion: unknown;
}): StoredRuleSuggestion | null {
  const s = txn.ruleSuggestion as StoredRuleSuggestion | null;
  return s && typeof s.accountId === "string" && typeof s.ruleId === "string"
    ? s
    : null;
}

export async function listRules(tx: Tx, tenantId: string): Promise<BankRule[]> {
  return tx.query.bankRules.findMany({
    where: eq(schema.bankRules.tenantId, tenantId),
    orderBy: (r, { asc: a }) => [a(r.priority), a(r.createdAt), a(r.id)],
  });
}

async function loadRule(
  tx: Tx,
  tenantId: string,
  ruleId: string,
): Promise<BankRule> {
  const rule = await tx.query.bankRules.findFirst({
    where: and(
      eq(schema.bankRules.tenantId, tenantId),
      eq(schema.bankRules.id, ruleId),
    ),
  });
  if (!rule) throw new LedgerError("ACCOUNT_NOT_FOUND", "rule not found");
  return rule;
}

/** The category must be a real, active, non-register account. */
async function assertUsableCategory(
  tx: Tx,
  tenantId: string,
  accountId: string,
): Promise<void> {
  const account = await tx.query.accounts.findFirst({
    where: and(
      eq(schema.accounts.tenantId, tenantId),
      eq(schema.accounts.id, accountId),
    ),
    columns: { id: true, isActive: true },
  });
  if (!account || !account.isActive) {
    throw new LedgerError("ACCOUNT_NOT_FOUND", "category is not an active account");
  }
  const register = await tx.query.bankAccounts.findFirst({
    where: and(
      eq(schema.bankAccounts.tenantId, tenantId),
      eq(schema.bankAccounts.accountId, accountId),
    ),
    columns: { id: true },
  });
  if (register) {
    throw new LedgerError(
      "ACCOUNT_NOT_FOUND",
      "a rule cannot code to a register's own account",
    );
  }
}

/** A rule may only name a vendor that exists, belongs here, and is active. */
async function assertUsableVendor(
  tx: Tx,
  tenantId: string,
  vendorId: string | null,
): Promise<void> {
  if (vendorId === null) return;
  const vendor = await tx.query.vendors.findFirst({
    where: and(eq(schema.vendors.tenantId, tenantId), eq(schema.vendors.id, vendorId)),
    columns: { id: true, isActive: true },
  });
  if (!vendor || !vendor.isActive) {
    throw new LedgerError("VENDOR_NOT_FOUND", "payee is not an active vendor");
  }
}

export interface RuleInput {
  name: string;
  appliesTo: "money_in" | "money_out" | "both";
  bankAccountId: string | null;
  matchMode: "all" | "any";
  conditions: RuleCondition[];
  setAccountId: string;
  /** Null = the rule says nothing about the payee. */
  setVendorId: string | null;
  setMemo: string | null;
  autoPost: boolean;
  isActive?: boolean;
}

export async function createRule(
  tx: Tx,
  ctx: LedgerCtx,
  input: RuleInput,
): Promise<BankRule> {
  requireOwnerRole(ctx);
  await assertUsableCategory(tx, ctx.tenantId, input.setAccountId);
  await assertUsableVendor(tx, ctx.tenantId, input.setVendorId);
  const rows = await tx
    .insert(schema.bankRules)
    .values({
      tenantId: ctx.tenantId,
      name: input.name,
      appliesTo: input.appliesTo,
      bankAccountId: input.bankAccountId,
      matchMode: input.matchMode,
      conditions: input.conditions,
      setAccountId: input.setAccountId,
      setVendorId: input.setVendorId,
      setMemo: input.setMemo,
      autoPost: input.autoPost,
      isActive: input.isActive ?? true,
    })
    .returning();
  return rows[0];
}

export async function updateRule(
  tx: Tx,
  ctx: LedgerCtx,
  args: { ruleId: string } & RuleInput,
): Promise<BankRule> {
  requireOwnerRole(ctx);
  await loadRule(tx, ctx.tenantId, args.ruleId);
  await assertUsableCategory(tx, ctx.tenantId, args.setAccountId);
  await assertUsableVendor(tx, ctx.tenantId, args.setVendorId);
  const rows = await tx
    .update(schema.bankRules)
    .set({
      name: args.name,
      appliesTo: args.appliesTo,
      bankAccountId: args.bankAccountId,
      matchMode: args.matchMode,
      conditions: args.conditions,
      setAccountId: args.setAccountId,
      setVendorId: args.setVendorId,
      setMemo: args.setMemo,
      autoPost: args.autoPost,
      isActive: args.isActive ?? true,
      // Editing a proposal adopts it: it is now a decision somebody made.
      isSuggested: false,
      version: sql`${schema.bankRules.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.bankRules.tenantId, ctx.tenantId),
        eq(schema.bankRules.id, args.ruleId),
      ),
    )
    .returning();
  return rows[0];
}

/**
 * Confirming a suggestion is just "this is mine now" — it keeps its conditions
 * and moves up to normal priority so it stops sorting behind hand-written rules.
 */
export async function confirmSuggestedRule(
  tx: Tx,
  ctx: LedgerCtx,
  args: { ruleId: string },
): Promise<BankRule> {
  requireOwnerRole(ctx);
  const rows = await tx
    .update(schema.bankRules)
    .set({
      isSuggested: false,
      isActive: true,
      priority: 100,
      version: sql`${schema.bankRules.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.bankRules.tenantId, ctx.tenantId),
        eq(schema.bankRules.id, args.ruleId),
      ),
    )
    .returning();
  if (rows.length === 0) throw new LedgerError("ACCOUNT_NOT_FOUND", "rule not found");
  return rows[0];
}

/**
 * Dismissing DEACTIVATES rather than deletes.
 *
 * A deleted proposal would be re-proposed the moment the same mapping was
 * chosen again — the duplicate check below only sees rules that still exist.
 * Keeping the row inactive is what makes "no thanks" stick, and it stays
 * visible so it can be turned back on.
 */
export async function dismissSuggestedRule(
  tx: Tx,
  ctx: LedgerCtx,
  args: { ruleId: string },
): Promise<BankRule> {
  requireOwnerRole(ctx);
  const rows = await tx
    .update(schema.bankRules)
    .set({
      isActive: false,
      version: sql`${schema.bankRules.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.bankRules.tenantId, ctx.tenantId),
        eq(schema.bankRules.id, args.ruleId),
        eq(schema.bankRules.isSuggested, true),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("ACCOUNT_NOT_FOUND", "suggested rule not found");
  }
  return rows[0];
}

export async function setRuleActive(
  tx: Tx,
  ctx: LedgerCtx,
  args: { ruleId: string; active: boolean },
): Promise<BankRule> {
  requireOwnerRole(ctx);
  const rows = await tx
    .update(schema.bankRules)
    .set({
      isActive: args.active,
      version: sql`${schema.bankRules.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.bankRules.tenantId, ctx.tenantId),
        eq(schema.bankRules.id, args.ruleId),
      ),
    )
    .returning();
  if (rows.length === 0) throw new LedgerError("ACCOUNT_NOT_FOUND", "rule not found");
  return rows[0];
}

export async function deleteRule(
  tx: Tx,
  ctx: LedgerCtx,
  args: { ruleId: string },
): Promise<void> {
  requireOwnerRole(ctx);
  // Suggestions already written onto bank rows are snapshots and survive this
  // deliberately — they record what the owner was shown, not what is current.
  const rows = await tx
    .delete(schema.bankRules)
    .where(
      and(
        eq(schema.bankRules.tenantId, ctx.tenantId),
        eq(schema.bankRules.id, args.ruleId),
      ),
    )
    .returning({ id: schema.bankRules.id });
  if (rows.length === 0) throw new LedgerError("ACCOUNT_NOT_FOUND", "rule not found");
}

/** Rewrites priority from the given order — index 0 matches first. */
export async function reorderRules(
  tx: Tx,
  ctx: LedgerCtx,
  args: { ruleIds: string[] },
): Promise<void> {
  requireOwnerRole(ctx);
  for (const [index, ruleId] of args.ruleIds.entries()) {
    await tx
      .update(schema.bankRules)
      .set({ priority: (index + 1) * 10, updatedAt: new Date() })
      .where(
        and(
          eq(schema.bankRules.tenantId, ctx.tenantId),
          eq(schema.bankRules.id, ruleId),
        ),
      );
  }
}

function toMatchable(rule: BankRule): MatchableRule {
  return {
    id: rule.id,
    name: rule.name,
    priority: rule.priority,
    isActive: rule.isActive,
    appliesTo: rule.appliesTo,
    bankAccountId: rule.bankAccountId,
    matchMode: rule.matchMode,
    conditions: rule.conditions,
    setAccountId: rule.setAccountId,
    setVendorId: rule.setVendorId,
    setMemo: rule.setMemo,
    autoPost: rule.autoPost,
    createdAt: rule.createdAt,
  };
}

export interface ApplyRulesResult {
  /** Rows that gained a rule suggestion. */
  matched: number;
  /** Rows an auto-post rule categorized outright. */
  autoPosted: number;
  /** Auto-post rows left alone because their date is in a closed period. */
  skippedLocked: number;
}

/**
 * Apply every active rule to the unreviewed rows of one register (or all).
 *
 * Auto-post yields to the period lock rather than failing: a rule must never be
 * able to break a bank import, and the row is still there to be reviewed by
 * hand. The lock is read ONCE up front rather than caught per row — catching
 * PERIOD_CLOSED mid-transaction risks working on a transaction Postgres has
 * already aborted for an unrelated reason.
 */
export async function applyRulesToUnreviewed(
  tx: Tx,
  ctx: LedgerCtx,
  args: { bankAccountId?: string } = {},
): Promise<ApplyRulesResult> {
  requireOwnerRole(ctx);
  const rules = (await listRules(tx, ctx.tenantId)).filter((r) => r.isActive);
  const result: ApplyRulesResult = { matched: 0, autoPosted: 0, skippedLocked: 0 };
  if (rules.length === 0) return result;

  const matchable = rules.map(toMatchable);
  // THE LOCK IS PER COMPANY (ADR 0010 slice 4), and a bulk apply spans every
  // register, so one date cannot answer for all of them. Read once into a map
  // rather than per transaction: this loop already runs over hundreds of rows,
  // and the closed-through of a company cannot change mid-transaction.
  const closedByEntity = new Map(
    (await listEntities(tx, ctx.tenantId, { includeInactive: true })).map((e) => [
      e.id,
      e.closedThrough,
    ]),
  );
  const entityOfAccount = new Map(
    (
      await tx.query.bankAccounts.findMany({
        where: eq(schema.bankAccounts.tenantId, ctx.tenantId),
        columns: { id: true, entityId: true },
      })
    ).map((a) => [a.id, a.entityId]),
  );

  const txns = await tx.query.bankTransactions.findMany({
    where: and(
      eq(schema.bankTransactions.tenantId, ctx.tenantId),
      eq(schema.bankTransactions.status, "unreviewed"),
      ...(args.bankAccountId
        ? [eq(schema.bankTransactions.bankAccountId, args.bankAccountId)]
        : []),
    ),
    orderBy: (t, { asc: a }) => [a(t.txnDate), a(t.id)],
  });
  if (txns.length === 0) return result;

  // Account codes are resolved once for the snapshot — the suggestion has to
  // render without re-reading the chart of accounts on every row.
  const accountIds = [...new Set(matchable.map((r) => r.setAccountId))];
  const accounts = await tx.query.accounts.findMany({
    where: and(
      eq(schema.accounts.tenantId, ctx.tenantId),
      inArray(schema.accounts.id, accountIds),
    ),
    columns: { id: true, code: true },
  });
  const codeById = new Map(accounts.map((a) => [a.id, a.code]));

  const vendorIds = [
    ...new Set(matchable.map((r) => r.setVendorId).filter((v): v is string => !!v)),
  ];
  const vendorRows =
    vendorIds.length === 0
      ? []
      : await tx.query.vendors.findMany({
          where: and(
            eq(schema.vendors.tenantId, ctx.tenantId),
            inArray(schema.vendors.id, vendorIds),
          ),
          columns: { id: true, name: true },
        });
  const vendorNameById = new Map(vendorRows.map((v) => [v.id, v.name]));

  const autoPostable: Array<{ txnId: string; match: RuleMatch }> = [];
  const now = new Date().toISOString();

  for (const txn of txns) {
    const match = matchRules(
      {
        bankAccountId: txn.bankAccountId,
        description: txn.description,
        amountCents: txn.amountCents,
      },
      matchable,
    );
    if (!match) continue;

    const suggestion: StoredRuleSuggestion = {
      ruleId: match.ruleId,
      ruleName: match.ruleName,
      accountId: match.accountId,
      accountCode: codeById.get(match.accountId) ?? "",
      ...(match.vendorId
        ? {
            vendorId: match.vendorId,
            vendorName: vendorNameById.get(match.vendorId) ?? "",
          }
        : {}),
      ...(match.memo ? { memo: match.memo } : {}),
      at: now,
    };
    await tx
      .update(schema.bankTransactions)
      .set({
        ruleSuggestion: suggestion,
        // The payee is applied straight to the row, not merely suggested:
        // unlike the category it posts nothing, so there is nothing to accept.
        // A payee already set by hand is never overwritten.
        ...(match.vendorId && !txn.vendorId ? { vendorId: match.vendorId } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.bankTransactions.tenantId, ctx.tenantId),
          eq(schema.bankTransactions.id, txn.id),
          eq(schema.bankTransactions.status, "unreviewed"),
        ),
      );
    result.matched += 1;

    if (!match.autoPost) continue;
    // The register's own company decides. A transaction on Maple's account is
    // not locked by Oak having closed its June.
    const closedThrough = closedByEntity.get(
      entityOfAccount.get(txn.bankAccountId) ?? "",
    );
    if (closedThrough && txn.txnDate <= closedThrough) {
      result.skippedLocked += 1;
      continue;
    }
    autoPostable.push({ txnId: txn.id, match });
  }

  // Posting happens after every suggestion is written, so a failure part-way
  // through cannot leave some rows suggested and others silently untouched.
  for (const { txnId, match } of autoPostable) {
    await categorizeTransaction(tx, ctx, {
      transactionId: txnId,
      accountId: match.accountId,
      ...(match.memo ? { memo: match.memo } : {}),
    });
    result.autoPosted += 1;
  }

  return result;
}

/**
 * Propose a rule when the same mapping has been chosen by hand enough times.
 *
 * Called AFTER a successful hand categorization, from the action layer rather
 * than from `categorizeTransaction`, so that posting never depends on this and
 * `review.ts` never has to import this module.
 *
 * Returns the proposed rule, or null when there is nothing worth proposing —
 * which is the common case and not an error.
 */
export async function proposeRuleFromHistory(
  tx: Tx,
  ctx: LedgerCtx,
  args: { bankAccountId: string; accountId: string },
): Promise<BankRule | null> {
  const register = await tx.query.bankAccounts.findFirst({
    where: and(
      eq(schema.bankAccounts.tenantId, ctx.tenantId),
      eq(schema.bankAccounts.id, args.bankAccountId),
    ),
    columns: { accountId: true },
  });
  if (!register) return null;

  // Descriptions of every posted row on this register whose entry touched the
  // category — joined through the staging row's own entry link, so a
  // re-categorized row counts once, under its current coding.
  const rows = await tx
    .select({ description: schema.bankTransactions.description })
    .from(schema.bankTransactions)
    .innerJoin(
      schema.journalLines,
      and(
        eq(schema.journalLines.tenantId, schema.bankTransactions.tenantId),
        eq(schema.journalLines.entryId, schema.bankTransactions.journalEntryId),
      ),
    )
    .where(
      and(
        eq(schema.bankTransactions.tenantId, ctx.tenantId),
        eq(schema.bankTransactions.bankAccountId, args.bankAccountId),
        eq(schema.bankTransactions.status, "posted"),
        eq(schema.journalLines.accountId, args.accountId),
        ne(schema.journalLines.accountId, register.accountId),
      ),
    )
    .orderBy(asc(schema.bankTransactions.txnDate));

  const descriptions = rows.map((r) => r.description).filter((d) => d.trim() !== "");
  if (descriptions.length < RULE_PROPOSAL_THRESHOLD) return null;

  const phrase = commonDescriptionPhrase(descriptions);
  if (phrase === null) return null;

  // One proposal per phrase, regardless of category or active state: a second
  // rule matching the same text would only ever shadow the first.
  const existing = await listRules(tx, ctx.tenantId);
  const alreadyCovered = existing.some((rule) => {
    const conditions = parseConditions(rule.conditions);
    return (conditions ?? []).some(
      (c) =>
        c.field === "description" &&
        c.op === "contains" &&
        c.value.trim().toLowerCase() === phrase,
    );
  });
  if (alreadyCovered) return null;

  const account = await tx.query.accounts.findFirst({
    where: and(
      eq(schema.accounts.tenantId, ctx.tenantId),
      eq(schema.accounts.id, args.accountId),
    ),
    columns: { name: true },
  });
  if (!account) return null;

  const inserted = await tx
    .insert(schema.bankRules)
    .values({
      tenantId: ctx.tenantId,
      name: suggestedRuleName(phrase, account.name),
      priority: SUGGESTED_RULE_PRIORITY,
      isSuggested: true,
      isActive: true,
      appliesTo: "both",
      bankAccountId: args.bankAccountId,
      matchMode: "all",
      conditions: [{ field: "description", op: "contains", value: phrase }],
      setAccountId: args.accountId,
      // Never auto-post something nobody asked for.
      autoPost: false,
    })
    .returning();
  return inserted[0];
}
