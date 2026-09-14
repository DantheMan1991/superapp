import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { LedgerError, postEntry, type LedgerCtx } from "../core";
import { loadWritableBankAccount } from "./accounts";

/**
 * MONEY IN OR OUT OF ONE REGISTER, in one act.
 *
 * ── WHY IT IS HERE AND NOT IN `actions.ts` ───────────────────────────────────
 *
 * It used to be the body of `quickAddTransactionAction`, which is where it was
 * written and where it could only ever be called from a screen. Slice C1 needs
 * the same thing from a SENTENCE — *"paid the feed store two hundred forty
 * cash"* — and a tell source records through the module's own verb
 * ([ADR 0039](../../../../docs/decisions/0039-a-pack-declares-what-it-can-be-told-in-one-sentence.md)'s
 * third rule), inside the transaction the platform opened for it.
 *
 * A server action cannot be that verb: it opens its own transaction and reads
 * its own session. So the rule moves down here, where both doors can reach it,
 * and the action becomes the thin thing it should always have been.
 *
 * **Nothing about the behaviour changed in the move.** Same lines, same
 * statuses, same refusals, same audit.
 */

export interface QuickAddInput {
  bankAccountId: string;
  /**
   * `transfer` moves money into another of the business's own accounts:
   * `categoryAccountId` is then that register's LEDGER account, and the posting
   * is the expense shape — Dr the account the money reached, Cr the one it
   * left. Same company only; `postEntry` refuses a foreign register.
   */
  direction: "expense" | "income" | "transfer";
  txnDate: string;
  categoryAccountId: string;
  amountCents: number;
  memo?: string;
  dimensionMemberIds?: string[];
}

export interface QuickAddResult {
  entryId: string;
  /** The far end of a transfer, so a caller knows what else to revalidate. */
  otherRegisterId: string | null;
  /**
   * **A NON-OWNER'S ENTRY IS A DRAFT**, and that is the module's own rule
   * rather than anything this function decided. Returned rather than left
   * implicit because a caller that does not say so is telling somebody their
   * money is in the books when it is waiting for an owner.
   */
  status: "posted" | "draft";
}

export async function quickAddTransaction(
  tx: Tx,
  ctx: LedgerCtx,
  input: QuickAddInput,
): Promise<QuickAddResult> {
  /*
   * FAIL CLOSED FOR THE ACCOUNTANT. `actions.ts`'s own gate refuses `expert`
   * for every write, and a second door into the ledger that did not would hand
   * the outside accountant writes their own screens refuse them. The check is
   * on the verb now, which is where ADR 0039 says the rule lives.
   */
  if (ctx.role === "expert") {
    throw new LedgerError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }

  const bankAccount = await loadWritableBankAccount(tx, ctx.tenantId, input.bankAccountId);
  const a = input.amountCents;

  // A transfer's far end must be one of the business's own OPEN registers, and
  // not the one the money is leaving. A tag makes no sense on it: a transfer
  // belongs to no line of business.
  const other =
    input.direction === "transfer"
      ? await tx.query.bankAccounts.findFirst({
          where: and(
            eq(schema.bankAccounts.tenantId, ctx.tenantId),
            eq(schema.bankAccounts.accountId, input.categoryAccountId),
            eq(schema.bankAccounts.isActive, true),
          ),
        })
      : null;
  if (input.direction === "transfer" && (!other || other.id === bankAccount.id)) {
    throw new LedgerError(
      "BANK_ACCOUNT_NOT_FOUND",
      "a transfer needs another of the business's own open accounts",
    );
  }

  const dims = input.direction === "transfer" ? undefined : input.dimensionMemberIds;
  const lines =
    input.direction === "income"
      ? [
          { accountId: bankAccount.accountId, amountCents: a },
          {
            accountId: input.categoryAccountId,
            amountCents: -a,
            dimensionMemberIds: dims,
          },
        ]
      : [
          {
            accountId: input.categoryAccountId,
            amountCents: a,
            dimensionMemberIds: dims,
          },
          { accountId: bankAccount.accountId, amountCents: -a },
        ];

  const status = ctx.role === "owner" ? ("posted" as const) : ("draft" as const);
  const { entry } = await postEntry(tx, ctx, {
    // THE REGISTER'S company — this is money in one account, so there is
    // nothing to pick.
    entityId: bankAccount.entityId,
    status,
    entryDate: input.txnDate,
    memo: input.memo ?? "",
    source: "manual",
    lines,
  });

  return { entryId: entry.id, otherRegisterId: other?.id ?? null, status };
}

/**
 * What this entry WILL do, in the two lines a person can check.
 *
 * Separate from the write and deliberately read-only: slice C1 shows it above
 * the button ([ADR 0054](../../../../docs/decisions/0054-tell-may-draft-never-send.md) §2),
 * because a card reading `Feed store · $240 · today` looks exactly as correct
 * whether it is about to hit `5010 Feed` or `6200 Supplies` — **and the wrong
 * account is the commonest error in the whole of bookkeeping.**
 *
 * It builds the same lines the write does, from the same input, rather than
 * describing them in prose alongside. Two descriptions of one posting is how a
 * preview comes to be confidently wrong.
 */
export async function quickAddPosting(
  tx: Tx,
  ctx: LedgerCtx,
  input: QuickAddInput,
): Promise<Array<{ accountId: string; amountCents: number }>> {
  const bankAccount = await loadWritableBankAccount(tx, ctx.tenantId, input.bankAccountId);
  const a = input.amountCents;
  return input.direction === "income"
    ? [
        { accountId: bankAccount.accountId, amountCents: a },
        { accountId: input.categoryAccountId, amountCents: -a },
      ]
    : [
        { accountId: input.categoryAccountId, amountCents: a },
        { accountId: bankAccount.accountId, amountCents: -a },
      ];
}
