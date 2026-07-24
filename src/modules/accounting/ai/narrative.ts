import "server-only";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { schema, withTenant, type Tx } from "@/db";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import { logAuditInTx } from "@/lib/audit";
import { LedgerError, type LedgerCtx } from "../core";
import { closePeriodStart, getCloseChecklist, loadClose } from "../core/close";
import { getSettings } from "../core/guards";
import {
  getBalanceSheet,
  getCashActivity,
  getProfitAndLoss,
} from "../core/reports";
import {
  CLOSE_NARRATIVE_SYSTEM_PROMPT,
  WRITE_CLOSE_NARRATIVE_TOOL,
  buildCloseNarrativeUserTurn,
  type CloseNarrativeInputs,
} from "./narrative-prompt";
import {
  validateCloseNarrative,
  type CloseNarrative,
} from "./narrative-validate";

const COOLDOWN_MS = 15_000;
const MAX_TOKENS = 2000;
const TOP_ENTRIES = 10;

export interface CloseNarrativeGathered {
  closeId: string;
  inputs: CloseNarrativeInputs;
}

/**
 * Everything the prompt needs, in one tenant read; claims the cooldown
 * slot inside the gathering tx (bill-code precedent) so concurrent runs
 * serialize. Completed closes only.
 */
export async function gatherCloseNarrativeInputs(
  tx: Tx,
  ctx: LedgerCtx,
  closeId: string,
): Promise<CloseNarrativeGathered> {
  const close = await loadClose(tx, ctx.tenantId, closeId);
  if (close.status !== "completed") {
    throw new LedgerError("CLOSE_NOT_COMPLETED", "narrative needs a completed close");
  }
  const settings = await getSettings(tx, ctx.tenantId);
  if (settings.aiLastNarrativeAt) {
    const age = Date.now() - settings.aiLastNarrativeAt.getTime();
    if (age < COOLDOWN_MS) {
      throw new LedgerError("AI_COOLDOWN", `last narrative ${age}ms ago`);
    }
  }
  await tx
    .update(schema.accountingSettings)
    .set({ aiLastNarrativeAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.accountingSettings.id, settings.id));

  const periodStart = closePeriodStart(close, settings.fiscalYearStartMonth);
  const periodEnd = close.periodEnd;

  const pnl = await getProfitAndLoss(tx, ctx.tenantId, {
    from: periodStart,
    to: periodEnd,
    compare: "prev-period",
  });
  const cash = await getCashActivity(tx, ctx.tenantId, {
    from: periodStart,
    to: periodEnd,
  });
  const bs = await getBalanceSheet(tx, ctx.tenantId, { asOf: periodEnd });
  const checklist = await getCloseChecklist(tx, ctx.tenantId, periodEnd);

  // Largest posted entries in the period, by total debit magnitude.
  const topEntries = await tx
    .select({
      date: schema.journalEntries.entryDate,
      memo: schema.journalEntries.memo,
      source: schema.journalEntries.source,
      amount: sql<string>`sum(case when ${schema.journalLines.amountCents} > 0 then ${schema.journalLines.amountCents} else 0 end)`,
    })
    .from(schema.journalEntries)
    .innerJoin(
      schema.journalLines,
      and(
        eq(schema.journalLines.tenantId, schema.journalEntries.tenantId),
        eq(schema.journalLines.entryId, schema.journalEntries.id),
      ),
    )
    .where(
      and(
        eq(schema.journalEntries.tenantId, ctx.tenantId),
        eq(schema.journalEntries.status, "posted"),
        gte(schema.journalEntries.entryDate, periodStart),
        lte(schema.journalEntries.entryDate, periodEnd),
      ),
    )
    .groupBy(
      schema.journalEntries.id,
      schema.journalEntries.entryDate,
      schema.journalEntries.memo,
      schema.journalEntries.source,
    )
    .orderBy(desc(sql`sum(case when ${schema.journalLines.amountCents} > 0 then ${schema.journalLines.amountCents} else 0 end)`))
    .limit(TOP_ENTRIES);

  // Names only of parties created in the period (P11).
  const periodFrom = new Date(`${periodStart}T00:00:00Z`);
  const periodTo = new Date(`${periodEnd}T23:59:59Z`);
  const periodTsFilter = (col: PgColumn) =>
    and(gte(col, periodFrom), lte(col, periodTo));
  const newVendors = await tx
    .select({ name: schema.vendors.name })
    .from(schema.vendors)
    .where(
      and(
        eq(schema.vendors.tenantId, ctx.tenantId),
        periodTsFilter(schema.vendors.createdAt),
      ),
    )
    .limit(20);
  const newCustomers = await tx
    .select({ name: schema.customers.name })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.tenantId, ctx.tenantId),
        periodTsFilter(schema.customers.createdAt),
      ),
    )
    .limit(20);

  const inputs: CloseNarrativeInputs = {
    periodStart,
    periodEnd,
    pnlRows: pnl.rows
      .filter((r) => typeof r.cents === "number")
      .map((r) => ({
        label: r.label,
        cents: r.cents as number,
        prevCents: r.comparisonCents ?? null,
      })),
    netIncomeCents: pnl.netIncomeCents,
    prevNetIncomeCents: pnl.comparisonNetIncomeCents ?? null,
    cashRows: cash.groups.flatMap((g) =>
      g.rows.map((r) => ({
        label: `${g.label}: ${r.label}`,
        openingCents: r.openingCents,
        netCents: r.netCents,
        closingCents: r.closingCents,
      })),
    ),
    totals: {
      assetsCents: bs.totalAssetsCents,
      liabilitiesCents: bs.totalLiabilitiesCents,
      equityCents: bs.totalEquityCents,
    },
    openItems: checklist.items
      .filter((i) => !i.ok)
      .map((i) => ({ label: i.label, count: i.count })),
    topEntries: topEntries.map((e) => ({
      date: e.date,
      memo: e.memo,
      amountCents: Number(e.amount),
      source: e.source,
    })),
    newVendors: newVendors.map((v) => v.name),
    newCustomers: newCustomers.map((c) => c.name),
  };

  return { closeId: close.id, inputs };
}

/**
 * The only network-touching function — injectable in tests. Forced tool
 * choice; no extended thinking (incompatible with forced tools).
 */
export async function callCloseNarrativeModel(
  gathered: CloseNarrativeGathered,
): Promise<unknown> {
  const stream = getClaude().messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text",
        text: CLOSE_NARRATIVE_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [WRITE_CLOSE_NARRATIVE_TOOL],
    tool_choice: { type: "tool", name: "write_close_narrative" },
    messages: [
      { role: "user", content: buildCloseNarrativeUserTurn(gathered.inputs) },
    ],
  });
  const msg = await stream.finalMessage();
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) {
    throw new LedgerError("AI_UNAVAILABLE", "no tool_use block in response");
  }
  return toolUse.input;
}

export async function persistCloseNarrative(
  tx: Tx,
  ctx: LedgerCtx,
  closeId: string,
  narrative: CloseNarrative,
): Promise<void> {
  // Conditional on still-completed: a close reopened mid-call keeps its
  // historical narrative untouched.
  await tx
    .update(schema.periodCloses)
    .set({
      narrative,
      narrativeGeneratedAt: new Date(),
      narrativeModel: narrative.model,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.periodCloses.tenantId, ctx.tenantId),
        eq(schema.periodCloses.id, closeId),
        eq(schema.periodCloses.status, "completed"),
      ),
    );
  // Identifiers only — never narrative contents.
  await logAuditInTx(tx, {
    action: "close.narrative_generated",
    tenantId: ctx.tenantId,
    actorClerkUserId: ctx.userId.startsWith("system:") ? null : ctx.userId,
    actorLabel: ctx.userId.startsWith("system:") ? ctx.userId : null,
    targetType: "period_close",
    targetId: closeId,
    meta: { model: narrative.model },
  });
}

/**
 * Full pipeline: gather → call model → validate → persist. Deliberately
 * NOT one transaction — the model call never holds a DB tx.
 */
export async function generateCloseNarrativeForClose(
  ctx: LedgerCtx,
  closeId: string,
  callModel: (g: CloseNarrativeGathered) => Promise<unknown> = callCloseNarrativeModel,
): Promise<CloseNarrative> {
  const gathered = await withTenant(ctx.tenantId, (tx) =>
    gatherCloseNarrativeInputs(tx, ctx, closeId),
  );
  const rawOutput = await callModel(gathered);
  const narrative = validateCloseNarrative(
    rawOutput,
    CLAUDE_MODEL,
    new Date().toISOString(),
  );
  if (narrative.narrative === "") {
    throw new LedgerError("AI_UNAVAILABLE", "model returned no usable narrative");
  }
  await withTenant(ctx.tenantId, (tx) =>
    persistCloseNarrative(tx, ctx, closeId, narrative),
  );
  return narrative;
}

/**
 * Auto-run wrapper for completeClose: cooldown or missing key → skip
 * silently (the manual Generate button remains); other failures logged.
 */
export async function tryGenerateCloseNarrative(
  ctx: LedgerCtx,
  closeId: string,
  callModel?: (g: CloseNarrativeGathered) => Promise<unknown>,
): Promise<void> {
  try {
    await generateCloseNarrativeForClose(ctx, closeId, callModel);
  } catch (err) {
    if (err instanceof LedgerError && err.code === "AI_COOLDOWN") return;
    console.error(`auto close narrative failed for close ${closeId}`, err);
  }
}
