import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Account, BankAccount } from "@/db/schema";
import {
  LedgerError,
  createAccount,
  listAccounts,
  postEntry,
  requireOwnerRole,
  type LedgerCtx,
} from "../core";

export type BankAccountKind = BankAccount["kind"];

/**
 * Deterministic ledger-account code suggestion: 1000-range for bank/cash,
 * 2100-range for credit cards. Tens first, then +1 steps, then anywhere
 * in the block.
 */
export function suggestBankAccountCode(
  existingCodes: string[],
  kind: BankAccountKind,
): string {
  const base = kind === "credit_card" ? 2100 : 1000;
  const taken = new Set(existingCodes);
  for (let c = base; c <= base + 90; c += 10) {
    if (!taken.has(String(c))) return String(c);
  }
  for (let c = base; c <= base + 999; c += 1) {
    if (!taken.has(String(c))) return String(c);
  }
  // Pathological COA — let the unique index catch a collision.
  return String(base);
}

export async function loadBankAccount(
  tx: Tx,
  tenantId: string,
  bankAccountId: string,
): Promise<BankAccount> {
  const row = await tx.query.bankAccounts.findFirst({
    where: and(
      eq(schema.bankAccounts.tenantId, tenantId),
      eq(schema.bankAccounts.id, bankAccountId),
    ),
  });
  if (!row) {
    throw new LedgerError("BANK_ACCOUNT_NOT_FOUND", `bank account ${bankAccountId} missing`);
  }
  return row;
}

/**
 * Create a register + its ledger account in one transaction; optionally
 * post the opening balance against Opening Balance Equity (idempotent via
 * `obal:{bankAccountId}`).
 */
export async function createBankAccount(
  tx: Tx,
  ctx: LedgerCtx,
  input: {
    name: string;
    kind: BankAccountKind;
    institution?: string;
    last4?: string;
    /** Statement convention: credit cards positive = amount owed. */
    openingBalanceCents?: number | null;
    openingBalanceDate?: string | null;
    plaidItemId?: string | null;
    plaidAccountId?: string | null;
  },
): Promise<{ bankAccount: BankAccount; ledgerAccount: Account }> {
  requireOwnerRole(ctx);
  const existing = await listAccounts(tx, ctx.tenantId);
  const code = suggestBankAccountCode(existing.map((a) => a.code), input.kind);
  const ledgerAccount = await createAccount(tx, ctx, {
    code,
    name: input.name,
    accountType: input.kind === "credit_card" ? "liability" : "asset",
    subtype: input.kind === "credit_card" ? "credit_card" : "bank",
    description: input.institution
      ? `${input.institution} — connected register`
      : "Bank register",
  });
  const [bankAccount] = await tx
    .insert(schema.bankAccounts)
    .values({
      tenantId: ctx.tenantId,
      accountId: ledgerAccount.id,
      name: input.name,
      kind: input.kind,
      institution: input.institution ?? "",
      last4: input.last4 ?? "",
      plaidItemId: input.plaidItemId ?? null,
      plaidAccountId: input.plaidAccountId ?? null,
    })
    .returning();

  if (input.openingBalanceCents != null && input.openingBalanceCents !== 0) {
    if (!input.openingBalanceDate) {
      throw new LedgerError("PERIOD_CLOSED", "opening balance needs a date");
    }
    const obe = existing.find(
      (a) => a.subtype === "opening_balance" && a.isSystem,
    );
    if (!obe) {
      throw new LedgerError("ACCOUNT_NOT_FOUND", "Opening Balance Equity missing");
    }
    const cents = input.openingBalanceCents;
    const lines =
      input.kind === "credit_card"
        ? [
            { accountId: obe.id, amountCents: cents },
            { accountId: ledgerAccount.id, amountCents: -cents },
          ]
        : [
            { accountId: ledgerAccount.id, amountCents: cents },
            { accountId: obe.id, amountCents: -cents },
          ];
    await postEntry(tx, ctx, {
      status: "posted",
      entryDate: input.openingBalanceDate,
      memo: `Opening balance — ${input.name}`,
      source: "opening_balance",
      sourceId: bankAccount.id,
      idempotencyKey: `obal:${bankAccount.id}`,
      lines,
    });
  }
  return { bankAccount, ledgerAccount };
}

export async function updateBankAccount(
  tx: Tx,
  ctx: LedgerCtx,
  args: {
    bankAccountId: string;
    expectedVersion: number;
    patch: { name?: string; institution?: string; last4?: string };
  },
): Promise<{ before: BankAccount; after: BankAccount }> {
  requireOwnerRole(ctx);
  const before = await loadBankAccount(tx, ctx.tenantId, args.bankAccountId);
  const rows = await tx
    .update(schema.bankAccounts)
    .set({
      ...(args.patch.name !== undefined ? { name: args.patch.name } : {}),
      ...(args.patch.institution !== undefined
        ? { institution: args.patch.institution }
        : {}),
      ...(args.patch.last4 !== undefined ? { last4: args.patch.last4 } : {}),
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.bankAccounts.tenantId, ctx.tenantId),
        eq(schema.bankAccounts.id, args.bankAccountId),
        eq(schema.bankAccounts.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "bank account changed since loaded");
  }
  return { before, after: rows[0] };
}

export async function setBankAccountActive(
  tx: Tx,
  ctx: LedgerCtx,
  args: { bankAccountId: string; expectedVersion: number; active: boolean },
): Promise<BankAccount> {
  requireOwnerRole(ctx);
  const rows = await tx
    .update(schema.bankAccounts)
    .set({ isActive: args.active, version: args.expectedVersion + 1, updatedAt: new Date() })
    .where(
      and(
        eq(schema.bankAccounts.tenantId, ctx.tenantId),
        eq(schema.bankAccounts.id, args.bankAccountId),
        eq(schema.bankAccounts.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "bank account changed since loaded");
  }
  return rows[0];
}
