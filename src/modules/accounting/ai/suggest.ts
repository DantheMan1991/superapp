import "server-only";
import { and, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/db";
import { CLAUDE_MODEL, CLAUDE_THINKING_OFF, getClaude } from "@/lib/claude";
import { LedgerError, requireOwnerRole, type LedgerCtx } from "../core";
import { loadBankAccount } from "../banking/accounts";
import {
  PERSONAL_CODE,
  SUGGEST_SYSTEM_PROMPT,
  SUGGEST_TOOL,
  buildSuggestUserTurn,
  type PromptAccount,
  type PromptHistoryRow,
  type PromptTxn,
} from "./prompt";
import { validateSuggestions, type AiSuggestion } from "./validate";

const BATCH_LIMIT = 50;
const HISTORY_LIMIT = 30;
const COOLDOWN_MS = 30_000;

export interface SuggestGathered {
  batch: PromptTxn[];
  coa: PromptAccount[];
  history: PromptHistoryRow[];
  accountsByCode: Map<string, { id: string; isActive: boolean }>;
  /**
   * True for a PERSONAL register (ADR 0034): the prompt inverts its prior,
   * the model may answer `PERSONAL`, and the validator accepts it.
   */
  personal: boolean;
}

/** Everything the prompt needs, in one tenant read. */
export async function gatherSuggestInputs(
  tx: Tx,
  ctx: LedgerCtx,
  bankAccountId: string,
): Promise<SuggestGathered> {
  const bankAccount = await loadBankAccount(tx, ctx.tenantId, bankAccountId);

  const settings = await tx.query.accountingSettings.findFirst({
    where: eq(schema.accountingSettings.tenantId, ctx.tenantId),
  });
  if (settings?.aiLastSuggestedAt) {
    const age = Date.now() - settings.aiLastSuggestedAt.getTime();
    if (age < COOLDOWN_MS) {
      throw new LedgerError("AI_COOLDOWN", `last suggestion ${age}ms ago`);
    }
  }

  const txns = await tx.query.bankTransactions.findMany({
    where: and(
      eq(schema.bankTransactions.tenantId, ctx.tenantId),
      eq(schema.bankTransactions.bankAccountId, bankAccountId),
      eq(schema.bankTransactions.status, "unreviewed"),
      isNull(schema.bankTransactions.aiSuggestion),
    ),
    orderBy: [
      desc(schema.bankTransactions.txnDate),
      desc(schema.bankTransactions.createdAt),
    ],
    limit: BATCH_LIMIT,
  });

  // Ledger accounts of ALL registers are excluded as categorization
  // targets only when they'd be nonsense (the register's own account);
  // other registers stay listed so transfers can be coded.
  const allBankAccounts = await tx.query.bankAccounts.findMany({
    where: eq(schema.bankAccounts.tenantId, ctx.tenantId),
  });
  const obeIds = new Set(
    (
      await tx.query.accounts.findMany({
        where: and(
          eq(schema.accounts.tenantId, ctx.tenantId),
          eq(schema.accounts.subtype, "opening_balance"),
        ),
      })
    ).map((a) => a.id),
  );
  const accounts = await tx.query.accounts.findMany({
    where: and(
      eq(schema.accounts.tenantId, ctx.tenantId),
      eq(schema.accounts.isActive, true),
    ),
  });
  const eligible = accounts.filter(
    (a) => a.id !== bankAccount.accountId && !obeIds.has(a.id),
  );

  // Few-shot: recent categorizations across all registers (tenant behavior).
  const bankLedgerIds = allBankAccounts.map((b) => b.accountId);
  const historyRows = await tx
    .select({
      description: schema.bankTransactions.description,
      code: schema.accounts.code,
      updatedAt: schema.bankTransactions.updatedAt,
    })
    .from(schema.bankTransactions)
    .innerJoin(
      schema.journalLines,
      and(
        eq(schema.journalLines.tenantId, schema.bankTransactions.tenantId),
        eq(schema.journalLines.entryId, schema.bankTransactions.journalEntryId),
      ),
    )
    .innerJoin(
      schema.accounts,
      and(
        eq(schema.accounts.tenantId, schema.journalLines.tenantId),
        eq(schema.accounts.id, schema.journalLines.accountId),
      ),
    )
    .where(
      and(
        eq(schema.bankTransactions.tenantId, ctx.tenantId),
        eq(schema.bankTransactions.status, "posted"),
        sql`${schema.bankTransactions.journalEntryId} is not null`,
        bankLedgerIds.length > 0
          ? notInArray(schema.journalLines.accountId, bankLedgerIds)
          : undefined,
      ),
    )
    .orderBy(desc(schema.bankTransactions.updatedAt))
    .limit(HISTORY_LIMIT);

  /**
   * On a PERSONAL register the decisions worth learning from are mostly the
   * ones that posted nothing: the grocer set aside last week is the strongest
   * signal about the grocer this week. Those rows are history too, under the
   * one code that means "not the business's", and they compete for the same
   * window so the prompt stays the size it was.
   */
  const personal = bankAccount.kind === "personal";
  const setAsideRows = personal
    ? await tx
        .select({
          description: schema.bankTransactions.description,
          updatedAt: schema.bankTransactions.updatedAt,
        })
        .from(schema.bankTransactions)
        .where(
          and(
            eq(schema.bankTransactions.tenantId, ctx.tenantId),
            eq(schema.bankTransactions.bankAccountId, bankAccountId),
            eq(schema.bankTransactions.status, "excluded"),
          ),
        )
        .orderBy(desc(schema.bankTransactions.updatedAt))
        .limit(HISTORY_LIMIT)
    : [];
  const history = [
    ...historyRows.map((h) => ({ description: h.description, code: h.code, at: h.updatedAt })),
    ...setAsideRows.map((r) => ({
      description: r.description,
      code: PERSONAL_CODE,
      at: r.updatedAt,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, HISTORY_LIMIT);

  return {
    batch: txns.map((t) => ({
      id: t.id,
      txnDate: t.txnDate,
      amountCents: t.amountCents,
      description: t.description,
    })),
    coa: eligible.map((a) => ({
      code: a.code,
      name: a.name,
      accountType: a.accountType,
      subtype: a.subtype,
    })),
    history: history.map((h) => ({ description: h.description, code: h.code })),
    accountsByCode: new Map(
      eligible.map((a) => [a.code, { id: a.id, isActive: a.isActive }]),
    ),
    personal,
  };
}

/**
 * The only network-touching function — injectable in tests. Forced tool
 * choice, with thinking pinned OFF for the token budget rather than for
 * compatibility — forced tools work with thinking on (verified against the
 * live API on claude-opus-5); the old claim here was stale.
 */
export async function callSuggestModel(
  gathered: SuggestGathered,
): Promise<unknown> {
  const stream = getClaude().messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    // Pinned, not inherited: an omitted `thinking` runs ADAPTIVE on
    // claude-opus-5, and max_tokens caps thinking AND response together.
    // Disabled preserves this call's 4.8 behaviour exactly. See lib/claude.ts.
    thinking: CLAUDE_THINKING_OFF,
    system: [
      {
        type: "text",
        text: SUGGEST_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [SUGGEST_TOOL],
    tool_choice: { type: "tool", name: "suggest_categories" },
    messages: [
      {
        role: "user",
        content: buildSuggestUserTurn(gathered.coa, gathered.history, gathered.batch, {
          personal: gathered.personal,
        }),
      },
    ],
  });
  const msg = await stream.finalMessage();
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) {
    throw new LedgerError("AI_UNAVAILABLE", "no tool_use block in response");
  }
  return toolUse.input;
}

/**
 * Persist validated suggestions: staging metadata updates + cooldown
 * marker + ONE audit row. Not a financial mutation — nothing posts here.
 */
export async function persistSuggestions(
  tx: Tx,
  ctx: LedgerCtx,
  bankAccountId: string,
  validated: Map<string, AiSuggestion>,
): Promise<void> {
  for (const [transactionId, suggestion] of validated) {
    await tx
      .update(schema.bankTransactions)
      .set({ aiSuggestion: suggestion, updatedAt: new Date() })
      .where(
        and(
          eq(schema.bankTransactions.tenantId, ctx.tenantId),
          eq(schema.bankTransactions.id, transactionId),
          eq(schema.bankTransactions.status, "unreviewed"),
        ),
      );
  }
  await tx
    .update(schema.accountingSettings)
    .set({ aiLastSuggestedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.accountingSettings.tenantId, ctx.tenantId));
}

/**
 * Full pipeline: gather → call model → validate → persist. Deliberately
 * NOT one transaction — the model call takes seconds and must never hold
 * a DB transaction open. Gather and persist each run in their own
 * withTenant; the conditional updates in persist tolerate rows changing
 * state in between.
 */
export async function suggestCategoriesForBankAccount(
  ctx: LedgerCtx,
  bankAccountId: string,
  callModel: (g: SuggestGathered) => Promise<unknown> = callSuggestModel,
): Promise<{ requested: number; returned: number }> {
  requireOwnerRole(ctx);
  // The caller's role travels with the transaction: a personal register's
  // rows are visible to owners and the accountant only (drizzle/0279), and a
  // sweep opened as the default `staff` would find no rows and say so.
  const scope = { role: ctx.role, userId: ctx.userId };
  const gathered = await withTenant(
    ctx.tenantId,
    (tx) => gatherSuggestInputs(tx, ctx, bankAccountId),
    scope,
  );
  if (gathered.batch.length === 0) return { requested: 0, returned: 0 };
  const rawOutput = await callModel(gathered);
  const validated = validateSuggestions(
    rawOutput,
    new Set(gathered.batch.map((t) => t.id)),
    gathered.accountsByCode,
    CLAUDE_MODEL,
    new Date().toISOString(),
    { allowPersonal: gathered.personal },
  );
  await withTenant(
    ctx.tenantId,
    (tx) => persistSuggestions(tx, ctx, bankAccountId, validated),
    scope,
  );
  return { requested: gathered.batch.length, returned: validated.size };
}
