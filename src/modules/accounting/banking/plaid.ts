import "server-only";
import { and, eq } from "drizzle-orm";
import { CountryCode, Products, type Transaction as PlaidTransaction } from "plaid";
import { schema, withTenant, type Tx } from "@/db";
import type { BankAccount, PlaidItem } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getPlaid } from "@/lib/plaid";
import { LedgerError, requireOwnerRole, type LedgerCtx } from "../core";

/**
 * Plaid live connections. The access token is encrypted at rest and only
 * ever decrypted server-side for API calls. Sync lands settled
 * transactions in the same bank_transactions staging the CSV import
 * feeds — external_hash = Plaid's transaction_id, so the dedup unique
 * makes re-syncs and CSV/Plaid overlap collisions impossible to
 * double-import per account.
 */

const SYNC_COOLDOWN_MS = 60_000;

export async function createLinkToken(ctx: LedgerCtx): Promise<string> {
  requireOwnerRole(ctx);
  const res = await getPlaid().linkTokenCreate({
    user: { client_user_id: ctx.tenantId },
    client_name: "Yosher",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
  });
  return res.data.link_token;
}

export interface PlaidLinkableAccount {
  plaidAccountId: string;
  name: string;
  mask: string;
  /** Suggested register kind from Plaid type/subtype. */
  kind: BankAccount["kind"];
}

/**
 * Exchange the public token from Link, store the encrypted access token,
 * and return the item's accounts for the linking dialog.
 */
export async function exchangePublicToken(
  ctx: LedgerCtx,
  args: { publicToken: string; institutionName: string },
): Promise<{ plaidItemId: string; accounts: PlaidLinkableAccount[] }> {
  requireOwnerRole(ctx);
  const plaid = getPlaid();
  const exchange = await plaid.itemPublicTokenExchange({
    public_token: args.publicToken,
  });
  const accessToken = exchange.data.access_token;
  const itemId = exchange.data.item_id;

  await withTenant(ctx.tenantId, (tx) =>
    tx
      .insert(schema.plaidItems)
      .values({
        tenantId: ctx.tenantId,
        plaidItemId: itemId,
        accessTokenEnc: encryptSecret(accessToken),
        institutionName: args.institutionName,
      })
      .onConflictDoNothing(),
  );

  const accountsRes = await plaid.accountsGet({ access_token: accessToken });
  return {
    plaidItemId: itemId,
    accounts: accountsRes.data.accounts.map((a) => ({
      plaidAccountId: a.account_id,
      name: a.official_name ?? a.name,
      mask: a.mask ?? "",
      kind:
        a.type === "credit"
          ? "credit_card"
          : a.subtype === "savings"
            ? "savings"
            : "checking",
    })),
  };
}

async function loadItem(
  tx: Tx,
  tenantId: string,
  plaidItemId: string,
): Promise<PlaidItem> {
  const item = await tx.query.plaidItems.findFirst({
    where: and(
      eq(schema.plaidItems.tenantId, tenantId),
      eq(schema.plaidItems.plaidItemId, plaidItemId),
    ),
  });
  if (!item) {
    throw new LedgerError("BANK_ACCOUNT_NOT_FOUND", "Plaid connection missing");
  }
  return item;
}

export interface StagedPlaidTxn {
  plaidAccountId: string;
  transactionId: string;
  txnDate: string;
  description: string;
  amountCents: number;
  raw: Record<string, unknown>;
}

/**
 * Pure mapper (exported for tests): Plaid txn → staging shape.
 * - Pending transactions are skipped (ids/amounts mutate until settled).
 * - Plaid reports positive = money OUT; we store positive = money IN, so
 *   the amount is negated exactly once here.
 * - external_hash = Plaid transaction_id verbatim.
 */
export function plaidTxnToStaging(t: PlaidTransaction): StagedPlaidTxn | null {
  if (t.pending) return null;
  const amountCents = -Math.round(t.amount * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents === 0) return null;
  return {
    plaidAccountId: t.account_id,
    transactionId: t.transaction_id,
    txnDate: t.date,
    description: (t.merchant_name ?? t.name ?? "").trim().replace(/\s+/g, " "),
    amountCents,
    raw: {
      name: t.name,
      merchant_name: t.merchant_name ?? null,
      category: t.personal_finance_category?.primary ?? null,
    },
  };
}

export interface SyncResult {
  added: number;
  modified: number;
  removed: number;
  skippedUnlinked: number;
}

/**
 * /transactions/sync with the stored cursor. Added rows insert through
 * the dedup unique; modified updates unreviewed rows only; removed
 * deletes unreviewed/excluded and warns on posted. The Plaid API loop
 * runs OUTSIDE any DB transaction; each page's writes are their own tx.
 */
export async function syncPlaidItem(
  ctx: LedgerCtx,
  plaidItemId: string,
): Promise<SyncResult> {
  requireOwnerRole(ctx);
  const item = await withTenant(ctx.tenantId, (tx) =>
    loadItem(tx, ctx.tenantId, plaidItemId),
  );
  if (item.lastSyncedAt && Date.now() - item.lastSyncedAt.getTime() < SYNC_COOLDOWN_MS) {
    throw new LedgerError("AI_COOLDOWN", "sync ran moments ago");
  }
  const linked = await withTenant(ctx.tenantId, (tx) =>
    tx.query.bankAccounts.findMany({
      where: and(
        eq(schema.bankAccounts.tenantId, ctx.tenantId),
        eq(schema.bankAccounts.plaidItemId, plaidItemId),
      ),
    }),
  );
  const byPlaidAccount = new Map(linked.map((b) => [b.plaidAccountId!, b]));
  const accessToken = decryptSecret(item.accessTokenEnc);

  const result: SyncResult = { added: 0, modified: 0, removed: 0, skippedUnlinked: 0 };
  let cursor = item.syncCursor ?? undefined;
  let hasMore = true;

  try {
    while (hasMore) {
      const page = await getPlaid().transactionsSync({
        access_token: accessToken,
        cursor,
        count: 500,
      });
      const { added, modified, removed, next_cursor, has_more } = page.data;

      await withTenant(ctx.tenantId, async (tx) => {
        for (const t of added) {
          const staged = plaidTxnToStaging(t);
          if (!staged) continue;
          const bank = byPlaidAccount.get(staged.plaidAccountId);
          if (!bank) {
            result.skippedUnlinked += 1;
            continue;
          }
          const rows = await tx
            .insert(schema.bankTransactions)
            .values({
              tenantId: ctx.tenantId,
              bankAccountId: bank.id,
              txnDate: staged.txnDate,
              description: staged.description,
              amountCents: staged.amountCents,
              externalHash: staged.transactionId,
              source: "plaid",
              raw: staged.raw,
            })
            .onConflictDoNothing()
            .returning({ id: schema.bankTransactions.id });
          result.added += rows.length;
        }
        for (const t of modified) {
          const staged = plaidTxnToStaging(t);
          if (!staged) continue;
          const bank = byPlaidAccount.get(staged.plaidAccountId);
          if (!bank) continue;
          const rows = await tx
            .update(schema.bankTransactions)
            .set({
              txnDate: staged.txnDate,
              description: staged.description,
              amountCents: staged.amountCents,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.bankTransactions.tenantId, ctx.tenantId),
                eq(schema.bankTransactions.bankAccountId, bank.id),
                eq(schema.bankTransactions.externalHash, staged.transactionId),
                eq(schema.bankTransactions.status, "unreviewed"),
              ),
            )
            .returning({ id: schema.bankTransactions.id });
          result.modified += rows.length;
        }
        for (const r of removed) {
          const deleted = await tx
            .delete(schema.bankTransactions)
            .where(
              and(
                eq(schema.bankTransactions.tenantId, ctx.tenantId),
                eq(schema.bankTransactions.externalHash, r.transaction_id),
                eq(schema.bankTransactions.source, "plaid"),
                // Only unreviewed/excluded — posted rows stay (books stand).
                eq(schema.bankTransactions.status, "unreviewed"),
              ),
            )
            .returning({ id: schema.bankTransactions.id });
          const deletedExcluded = await tx
            .delete(schema.bankTransactions)
            .where(
              and(
                eq(schema.bankTransactions.tenantId, ctx.tenantId),
                eq(schema.bankTransactions.externalHash, r.transaction_id),
                eq(schema.bankTransactions.source, "plaid"),
                eq(schema.bankTransactions.status, "excluded"),
              ),
            )
            .returning({ id: schema.bankTransactions.id });
          result.removed += deleted.length + deletedExcluded.length;
          if (deleted.length === 0 && deletedExcluded.length === 0) {
            console.warn("plaid removed a transaction that is already posted:", r.transaction_id);
          }
        }
        // Persist cursor page-by-page so a mid-sync failure resumes cleanly.
        await tx
          .update(schema.plaidItems)
          .set({ syncCursor: next_cursor, lastSyncedAt: new Date(), status: "active", updatedAt: new Date() })
          .where(
            and(
              eq(schema.plaidItems.tenantId, ctx.tenantId),
              eq(schema.plaidItems.id, item.id),
            ),
          );
      });

      cursor = next_cursor;
      hasMore = has_more;
    }
  } catch (err) {
    const code = (err as { response?: { data?: { error_code?: string } } })
      ?.response?.data?.error_code;
    if (code === "ITEM_LOGIN_REQUIRED") {
      await withTenant(ctx.tenantId, (tx) =>
        tx
          .update(schema.plaidItems)
          .set({ status: "error", updatedAt: new Date() })
          .where(
            and(
              eq(schema.plaidItems.tenantId, ctx.tenantId),
              eq(schema.plaidItems.id, item.id),
            ),
          ),
      );
    }
    throw err;
  }
  return result;
}

/**
 * Remove the connection at Plaid and locally. Bank accounts, staging
 * rows, and ledger data all remain — history is never lost; the account
 * simply becomes CSV-only again.
 */
export async function disconnectPlaidItem(
  ctx: LedgerCtx,
  plaidItemId: string,
): Promise<void> {
  requireOwnerRole(ctx);
  const item = await withTenant(ctx.tenantId, (tx) =>
    loadItem(tx, ctx.tenantId, plaidItemId),
  );
  try {
    await getPlaid().itemRemove({ access_token: decryptSecret(item.accessTokenEnc) });
  } catch (err) {
    // Best effort at Plaid; local cleanup proceeds either way.
    console.error("plaid item remove failed", err);
  }
  await withTenant(ctx.tenantId, async (tx) => {
    await tx
      .update(schema.bankAccounts)
      .set({ plaidItemId: null, plaidAccountId: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.bankAccounts.tenantId, ctx.tenantId),
          eq(schema.bankAccounts.plaidItemId, plaidItemId),
        ),
      );
    await tx
      .delete(schema.plaidItems)
      .where(
        and(
          eq(schema.plaidItems.tenantId, ctx.tenantId),
          eq(schema.plaidItems.id, item.id),
        ),
      );
  });
}
