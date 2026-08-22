import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Account } from "@/db/schema";
import { LedgerError } from "./errors";
import { requireOwnerRole } from "./guards";
import type { LedgerCtx } from "./types";

export const MAX_COA_DEPTH = 3;

// Defined in the pure report-builders module (client-safe); re-exported
// here so server code keeps one import path.
import type { AccountTypeValue } from "./report-builders";
export { NORMAL_BALANCE, type AccountTypeValue } from "./report-builders";

export async function listAccounts(tx: Tx, tenantId: string): Promise<Account[]> {
  return tx.query.accounts.findMany({
    where: eq(schema.accounts.tenantId, tenantId),
    orderBy: asc(schema.accounts.code),
  });
}

/** Depth of a node in the tree (root = 1), following parent links. */
function depthOf(byId: Map<string, Account>, account: Account): number {
  let depth = 1;
  let cur = account;
  const seen = new Set<string>([account.id]);
  while (cur.parentId) {
    const parent = byId.get(cur.parentId);
    if (!parent || seen.has(parent.id)) break; // corrupt tree — treat as root
    seen.add(parent.id);
    depth += 1;
    cur = parent;
  }
  return depth;
}

/** Height of the subtree rooted at id (leaf = 1). */
function heightOf(childrenOf: Map<string | null, Account[]>, id: string): number {
  const children = childrenOf.get(id) ?? [];
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map((c) => heightOf(childrenOf, c.id)));
}

/**
 * Hierarchy rules for create/reparent: no self-parent, no cycles, child
 * type = parent type, and the whole affected chain stays within
 * MAX_COA_DEPTH (including the moved node's descendants).
 */
function validateParent(
  all: Account[],
  accountId: string | null,
  parentId: string | null,
  accountType: AccountTypeValue,
): void {
  if (!parentId) return;
  if (accountId && parentId === accountId) {
    throw new LedgerError("COA_SELF_PARENT", "account cannot be its own parent");
  }
  const byId = new Map(all.map((a) => [a.id, a]));
  const parent = byId.get(parentId);
  if (!parent) {
    throw new LedgerError("ACCOUNT_NOT_FOUND", `parent ${parentId} not found`);
  }
  if (parent.accountType !== accountType) {
    throw new LedgerError("COA_TYPE_MISMATCH", "sub-account type must match parent");
  }
  // Cycle: walk up from the proposed parent; hitting the account = loop.
  let cur: Account | undefined = parent;
  while (cur) {
    if (accountId && cur.id === accountId) {
      throw new LedgerError("COA_CYCLE", "reparenting would create a cycle");
    }
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  const childrenOf = new Map<string | null, Account[]>();
  for (const a of all) {
    const list = childrenOf.get(a.parentId) ?? [];
    list.push(a);
    childrenOf.set(a.parentId, list);
  }
  const parentDepth = depthOf(byId, parent);
  const subtreeHeight = accountId ? heightOf(childrenOf, accountId) : 1;
  if (parentDepth + subtreeHeight > MAX_COA_DEPTH) {
    throw new LedgerError("COA_DEPTH", `chart of accounts max depth is ${MAX_COA_DEPTH}`);
  }
}

export async function createAccount(
  tx: Tx,
  ctx: LedgerCtx,
  input: {
    code: string;
    name: string;
    accountType: AccountTypeValue;
    subtype?: string;
    parentId?: string | null;
    description?: string;
  },
): Promise<Account> {
  requireOwnerRole(ctx);
  const all = await listAccounts(tx, ctx.tenantId);
  validateParent(all, null, input.parentId ?? null, input.accountType);
  const rows = await tx
    .insert(schema.accounts)
    .values({
      tenantId: ctx.tenantId,
      code: input.code,
      name: input.name,
      accountType: input.accountType,
      subtype: input.subtype ?? "other",
      parentId: input.parentId ?? null,
      description: input.description ?? "",
    })
    .onConflictDoNothing()
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("DUPLICATE_CODE", `code ${input.code} already in use`);
  }
  return rows[0];
}

export async function updateAccount(
  tx: Tx,
  ctx: LedgerCtx,
  args: {
    accountId: string;
    expectedVersion: number;
    patch: {
      code?: string;
      name?: string;
      subtype?: string;
      parentId?: string | null;
      description?: string;
    };
  },
): Promise<{ before: Account; after: Account }> {
  requireOwnerRole(ctx);
  const all = await listAccounts(tx, ctx.tenantId);
  const before = all.find((a) => a.id === args.accountId);
  if (!before) {
    throw new LedgerError("ACCOUNT_NOT_FOUND", `account ${args.accountId} not found`);
  }
  // System accounts keep their identity: name/description/subtype edits
  // only — code and position are load-bearing.
  if (
    before.isSystem &&
    (args.patch.code !== undefined || args.patch.parentId !== undefined)
  ) {
    throw new LedgerError("SYSTEM_ACCOUNT", "system accounts cannot be moved or recoded");
  }
  if (args.patch.parentId !== undefined) {
    validateParent(all, before.id, args.patch.parentId, before.accountType);
  }
  const rows = await tx
    .update(schema.accounts)
    .set({
      ...(args.patch.code !== undefined ? { code: args.patch.code } : {}),
      ...(args.patch.name !== undefined ? { name: args.patch.name } : {}),
      ...(args.patch.subtype !== undefined ? { subtype: args.patch.subtype } : {}),
      ...(args.patch.parentId !== undefined ? { parentId: args.patch.parentId } : {}),
      ...(args.patch.description !== undefined
        ? { description: args.patch.description }
        : {}),
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.accounts.tenantId, ctx.tenantId),
        eq(schema.accounts.id, args.accountId),
        eq(schema.accounts.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "account changed since loaded");
  }
  return { before, after: rows[0] };
}

/** Soft delete. Allowed even with history (it's deactivation, not deletion). */
export async function deactivateAccount(
  tx: Tx,
  ctx: LedgerCtx,
  args: { accountId: string; expectedVersion: number; active: boolean },
): Promise<Account> {
  requireOwnerRole(ctx);
  const account = await tx.query.accounts.findFirst({
    where: and(
      eq(schema.accounts.tenantId, ctx.tenantId),
      eq(schema.accounts.id, args.accountId),
    ),
  });
  if (!account) {
    throw new LedgerError("ACCOUNT_NOT_FOUND", `account ${args.accountId} not found`);
  }
  if (account.isSystem && !args.active) {
    throw new LedgerError("SYSTEM_ACCOUNT", "system accounts cannot be deactivated");
  }
  const rows = await tx
    .update(schema.accounts)
    .set({
      isActive: args.active,
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.accounts.tenantId, ctx.tenantId),
        eq(schema.accounts.id, args.accountId),
        eq(schema.accounts.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "account changed since loaded");
  }
  return rows[0];
}

/**
 * Accounts a DOCUMENT LINE may be coded to — a bill line, a recurring bill
 * line, or the AI coder's candidate list.
 *
 * ONE PREDICATE, WHERE THERE WERE FOUR COPIES. The rule lived in the new-bill
 * page, the bill detail page, the recurring dialog and `ai/bill-code.ts`, all
 * spelling out the same three exclusions — so the affiliate accounts arriving in
 * ADR 0010 slice 2 would have had to be remembered in four places, and were
 * remembered in none. That is what put "Due from Affiliates" in a bill's
 * category dropdown.
 *
 * What it excludes, and why each one:
 *
 *  - REGISTERS. A bill line is what was bought, not where the money left; the
 *    paid-from account is a separate question the payment dialog asks.
 *  - OPENING BALANCE EQUITY. It exists to absorb the start of the books.
 *  - AR and AP. The document itself posts the control leg; coding a line there
 *    would double it.
 *  - THE AFFILIATE PAIR. `due_from_affiliate` / `due_to_affiliate` are written
 *    only by `postIntercompanyPair`, which keeps them explainable by the link.
 *    A hand-coded line into one produces an affiliate balance that "who owes
 *    whom" cannot attribute to anybody — and unlike a cross-company register,
 *    the posting engine has no reason to refuse it, so the list is the only
 *    place it can be prevented.
 *
 * NOT applied to the JOURNAL, deliberately. A journal may name any account,
 * the way it may already touch AR and AP directly (see the cash-basis note in
 * docs/modules/accounting.md) — that is what a journal is for. The cost is
 * accepted and stated: a manual entry into an affiliate account is a balance
 * the who-owes-whom table will not explain.
 */
export function isCodableAccount(
  account: Pick<Account, "id" | "subtype" | "isSystem">,
  registerAccountIds: ReadonlySet<string>,
): boolean {
  if (registerAccountIds.has(account.id)) return false;
  if (account.subtype === "opening_balance") return false;
  if (account.subtype === "due_from_affiliate") return false;
  if (account.subtype === "due_to_affiliate") return false;
  // GRNI is set by ALLOCATING a bill line to a stock receipt, never by hand.
  // Coding a line to it directly would clear a balance no receipt created.
  if (account.subtype === "goods_received") return false;
  /**
   * **INVENTORY IS CAPITALISED BY THE RECEIPT, NEVER BY THE BILL** —
   * [ADR 0012](../../../../docs/decisions/0012-what-capitalises-stock.md) §A.1.
   * Stock arriving posts `Dr Inventory / Cr GRNI`, and the bill for it CLEARS
   * GRNI. A line coded straight to Inventory capitalises the same delivery a
   * second time, which is the "both capitalise" failure that ADR opens with:
   * the stock is on the books twice and nothing reconciles it.
   *
   * Same reasoning as the line above, and it should have been written at the
   * same time. It was not, because GRNI was the account somebody had just been
   * bitten by.
   *
   * **Existing lines are unaffected.** This filters the PICKERS; nothing
   * validates it on save, and the bill edit page already re-adds any account a
   * bill has actually used, which is the fix that had to be made for GRNI when
   * a matched line rendered with an empty account box.
   */
  if (account.subtype === "inventory") return false;
  if (
    account.isSystem &&
    (account.subtype === "accounts_receivable" ||
      account.subtype === "accounts_payable")
  ) {
    return false;
  }
  return true;
}
