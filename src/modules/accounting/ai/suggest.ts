import "server-only";
import { and, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/db";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import { LedgerError, requireOwnerRole, type LedgerCtx } from "../core";
import { loadBankAccount } from "../banking/accounts";
import {
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
    history: historyRows.map((h) => ({ description: h.description, code: h.code })),
    accountsByCode: new Map(
      eligible.map((a) => [a.code, { id: a.id, isActive: a.isActive }]),
    ),
  };
}

/**
 * The only network-touching function — injectable in tests. Forced tool
 * choice; no extended thinking (incompatible with forced tools).
 */
export async function callSuggestModel(
  gathered: SuggestGathered,
): Promise<unknown> {
  const stream = getClaude().messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 8000,
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
        content: buildSuggestUserTurn(gathered.coa, gathered.history, gathered.batch),
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
  const gathered = await withTenant(ctx.tenantId, (tx) =>
    gatherSuggestInputs(tx, ctx, bankAccountId),
  );
  if (gathered.batch.length === 0) return { requested: 0, returned: 0 };
  const rawOutput = await callModel(gathered);
  const validated = validateSuggestions(
    rawOutput,
    new Set(gathered.batch.map((t) => t.id)),
    gathered.accountsByCode,
    CLAUDE_MODEL,
    new Date().toISOString(),
  );
  await withTenant(ctx.tenantId, (tx) =>
    persistSuggestions(tx, ctx, bankAccountId, validated),
  );
  return { requested: gathered.batch.length, returned: validated.size };
}
