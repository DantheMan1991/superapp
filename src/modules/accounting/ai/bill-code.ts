import "server-only";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/db";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import { logAuditInTx } from "@/lib/audit";
import { LedgerError, type LedgerCtx } from "../core";
import { loadBill, loadBillLines } from "../payables/bills";
import { loadVendor } from "../payables/vendors";
import {
  BILL_CODING_SYSTEM_PROMPT,
  CODE_BILL_TOOL,
  buildBillCodingUserTurn,
  type BillPromptAccount,
  type BillPromptHistoryRow,
  type BillPromptLine,
} from "./bill-prompt";
import { validateBillCoding, type BillCoding } from "./bill-validate";
import { getPackGuidance } from "./pack-context";

const COOLDOWN_MS = 15_000;
const MAX_TOKENS = 4000;
const VENDOR_HISTORY_LIMIT = 30;

export interface BillCodingGathered {
  billId: string;
  vendorName: string;
  billDate: string;
  billNumber: string;
  lines: BillPromptLine[];
  coa: BillPromptAccount[];
  vendorHistory: BillPromptHistoryRow[];
  packGuidance: string[];
  accountsByCode: Map<string, { id: string; isActive: boolean }>;
}

/**
 * Everything the prompt needs, in one tenant read. Also claims the
 * cooldown slot inside the gating tx so concurrent runs serialize.
 * Data minimization per P15: COA, this vendor's history, the bill's own
 * lines, the vendor name, pack guidance — nothing else.
 */
export async function gatherBillCodingInputs(
  tx: Tx,
  ctx: LedgerCtx,
  billId: string,
): Promise<BillCodingGathered> {
  const bill = await loadBill(tx, ctx.tenantId, billId);
  if (bill.status !== "draft" && bill.status !== "awaiting_approval") {
    throw new LedgerError("BILL_NOT_DRAFT", "only open drafts can be coded");
  }
  const vendor = await loadVendor(tx, ctx.tenantId, bill.vendorId);
  const lines = await loadBillLines(tx, ctx.tenantId, bill.id);
  const codable = lines.filter((l) => l.amountCents !== 0);
  if (codable.length === 0) {
    throw new LedgerError("BILL_EMPTY", "no lines to code");
  }

  const settings = await tx.query.accountingSettings.findFirst({
    where: eq(schema.accountingSettings.tenantId, ctx.tenantId),
  });
  if (settings?.aiLastBillCodedAt) {
    const age = Date.now() - settings.aiLastBillCodedAt.getTime();
    if (age < COOLDOWN_MS) {
      throw new LedgerError("AI_COOLDOWN", `last coding ${age}ms ago`);
    }
  }
  await tx
    .update(schema.accountingSettings)
    .set({ aiLastBillCodedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.accountingSettings.tenantId, ctx.tenantId));

  // Eligible COA (P15): active accounts minus the AR/AP system accounts,
  // OBE, and bank-register ledger accounts (a bill line is never coded
  // to the bank — that's what payments are).
  const accounts = await tx.query.accounts.findMany({
    where: and(
      eq(schema.accounts.tenantId, ctx.tenantId),
      eq(schema.accounts.isActive, true),
    ),
  });
  const registers = await tx.query.bankAccounts.findMany({
    where: eq(schema.bankAccounts.tenantId, ctx.tenantId),
  });
  const registerLedgerIds = new Set(registers.map((r) => r.accountId));
  const eligible = accounts.filter(
    (a) =>
      !registerLedgerIds.has(a.id) &&
      a.subtype !== "opening_balance" &&
      !(a.isSystem &&
        (a.subtype === "accounts_receivable" || a.subtype === "accounts_payable")),
  );

  // Few-shot: this vendor's prior approved-bill lines (description → code),
  // joined back through bills.journal_entry_id.
  const historyRows = await tx
    .select({
      description: schema.journalLines.memo,
      code: schema.accounts.code,
      createdAt: schema.bills.updatedAt,
    })
    .from(schema.bills)
    .innerJoin(
      schema.journalLines,
      and(
        eq(schema.journalLines.tenantId, schema.bills.tenantId),
        eq(schema.journalLines.entryId, schema.bills.journalEntryId),
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
        eq(schema.bills.tenantId, ctx.tenantId),
        eq(schema.bills.vendorId, bill.vendorId),
        inArray(schema.bills.status, ["approved", "partial", "paid"]),
        notInArray(
          schema.accounts.subtype,
          ["accounts_payable", "accounts_receivable"],
        ),
      ),
    )
    .orderBy(desc(schema.bills.updatedAt))
    .limit(VENDOR_HISTORY_LIMIT);

  const packGuidance = await getPackGuidance(tx, ctx.tenantId, "bill_coding");

  return {
    billId: bill.id,
    vendorName: vendor.name,
    billDate: bill.billDate,
    billNumber: bill.billNumber,
    lines: codable.map((l) => ({
      id: l.id,
      description: l.description,
      amountCents: l.amountCents,
    })),
    coa: eligible.map((a) => ({
      code: a.code,
      name: a.name,
      accountType: a.accountType,
      subtype: a.subtype,
    })),
    vendorHistory: historyRows
      .filter((h) => h.description !== "")
      .map((h) => ({ description: h.description, code: h.code })),
    packGuidance,
    accountsByCode: new Map(
      eligible.map((a) => [a.code, { id: a.id, isActive: a.isActive }]),
    ),
  };
}

/**
 * The only network-touching function — injectable in tests. Forced tool
 * choice; no extended thinking (incompatible with forced tools).
 */
export async function callBillCodingModel(
  gathered: BillCodingGathered,
): Promise<unknown> {
  const stream = getClaude().messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text",
        text: BILL_CODING_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [CODE_BILL_TOOL],
    tool_choice: { type: "tool", name: "code_bill_lines" },
    messages: [
      {
        role: "user",
        content: buildBillCodingUserTurn(
          gathered.coa,
          gathered.vendorHistory,
          {
            vendorName: gathered.vendorName,
            billDate: gathered.billDate,
            billNumber: gathered.billNumber,
          },
          gathered.lines,
          gathered.packGuidance,
        ),
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

export async function persistBillCoding(
  tx: Tx,
  ctx: LedgerCtx,
  billId: string,
  coding: BillCoding,
): Promise<void> {
  // Conditional on still-draft: a bill approved mid-call keeps no
  // stale suggestions.
  await tx
    .update(schema.bills)
    .set({ aiCoding: coding, updatedAt: new Date() })
    .where(
      and(
        eq(schema.bills.tenantId, ctx.tenantId),
        eq(schema.bills.id, billId),
        inArray(schema.bills.status, ["draft", "awaiting_approval"]),
      ),
    );
  // Identifiers only — no descriptions or amounts in the audit trail.
  await logAuditInTx(tx, {
    action: "bill.ai_coded",
    tenantId: ctx.tenantId,
    actorClerkUserId: ctx.userId.startsWith("system:") ? null : ctx.userId,
    actorLabel: ctx.userId.startsWith("system:") ? ctx.userId : null,
    targetType: "bill",
    targetId: billId,
    meta: { model: coding.model, suggested: coding.suggestions.length },
  });
}

/**
 * Full pipeline: gather → call model → validate → persist. Deliberately
 * NOT one transaction — the model call takes seconds and must never hold
 * a DB transaction open.
 */
export async function suggestBillCodingForBill(
  ctx: LedgerCtx,
  billId: string,
  callModel: (g: BillCodingGathered) => Promise<unknown> = callBillCodingModel,
): Promise<BillCoding> {
  const gathered = await withTenant(ctx.tenantId, (tx) =>
    gatherBillCodingInputs(tx, ctx, billId),
  );
  const rawOutput = await callModel(gathered);
  const coding = validateBillCoding(
    rawOutput,
    new Set(gathered.lines.map((l) => l.id)),
    gathered.accountsByCode,
    CLAUDE_MODEL,
    new Date().toISOString(),
  );
  await withTenant(ctx.tenantId, (tx) =>
    persistBillCoding(tx, ctx, billId, coding),
  );
  return coding;
}

/**
 * Auto-run wrapper for create-from-document: cooldown → skip silently
 * (the manual "Suggest coding" button remains); other failures logged.
 */
export async function trySuggestBillCoding(
  ctx: LedgerCtx,
  billId: string,
  callModel?: (g: BillCodingGathered) => Promise<unknown>,
): Promise<void> {
  try {
    await suggestBillCodingForBill(ctx, billId, callModel);
  } catch (err) {
    if (err instanceof LedgerError && err.code === "AI_COOLDOWN") return;
    console.error(`auto bill coding failed for bill ${billId}`, err);
  }
}
