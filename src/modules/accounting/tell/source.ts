import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { formatCents, formatMoney, parseMoneyToCents } from "@/lib/money";
import { saidWords } from "@/lib/tell-sources/shape";
import {
  TellRefusal,
  type TellAction,
  type TellCandidate,
  type TellCtx,
  type TellSource,
  type TellValues,
} from "@/lib/tell-sources/types";
import { LedgerError, friendlyMessage } from "../core";
import { isCodableAccount, listAccounts } from "../core/coa";
import { quickAddPosting, quickAddTransaction } from "../banking/quick-add";

/**
 * What the books can be told in one sentence (tell.md, Phase C, slice C1).
 *
 * **THE FIRST SOURCE THAT TOUCHES MONEY**, and the one every rule in
 * [ADR 0054](../../../../docs/decisions/0054-tell-may-draft-never-send.md) was
 * written for. The founder's ask, on the day the plan was made: *"I'm even ok
 * with it doing financial stuff as long as there is good feedback
 * verification."*
 *
 * ── WHAT IT RECORDS, AND WHAT IT WILL NEVER DO ───────────────────────────────
 *
 * Money that has already LEFT — *"paid the feed store two hundred forty cash"*.
 * That is a claim about the past, and a wrong one is corrected the way every
 * wrong entry is: double-entry was built for it.
 *
 * It does not send, it does not pay, and it does not issue. Those reach a third
 * party, and **a confirm card cannot un-send an email or un-charge a card**, so
 * they are not proposable at all — enforced by `tests/tell-forbidden-verbs.test.ts`
 * rather than remembered.
 *
 * ── THE PREVIEW IS NOT DECORATION HERE ───────────────────────────────────────
 *
 * A card reading `Feed store · $240 · today` looks exactly as correct whether it
 * is about to hit `5010 Feed` or `6200 Supplies`, and **the wrong account is the
 * commonest error in the whole of bookkeeping**. So the posting is read back
 * above the button, built by `quickAddPosting` from the same input the write
 * uses — two descriptions of one posting is how a preview comes to be
 * confidently wrong.
 *
 * ── AND NOTHING HERE RECORDS ITSELF ──────────────────────────────────────────
 *
 * It moves money, which fails [ADR 0050](../../../../docs/decisions/0050-a-safe-verb-records-itself.md)'s
 * third test outright and always will.
 */

const text = (v: TellValues[string]): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/** The ledger's own refusals, in its own words — ADR 0039's third rule. */
function refusal(err: unknown): unknown {
  return err instanceof LedgerError ? new TellRefusal(friendlyMessage(err)) : err;
}

interface Named {
  value: string;
  label: string;
  detail?: string;
}

/**
 * WHICH OF THESE THOSE WORDS MEAN — the three passes every source uses, loosest
 * last, and **never edit distance**. "Feed" and "Fees" are one letter apart and
 * are not the same account; picking the nearest here is picking somebody's
 * books apart.
 */
function findNamed(all: Named[], said: string): TellCandidate[] {
  const asked = saidWords(said);
  if (asked.length === 0) return all;
  const phrase = asked.join(" ");

  const named = all.filter((item) => {
    const label = saidWords(item.label).join(" ");
    return label !== "" && (label === phrase || phrase.includes(label) || label.includes(phrase));
  });
  if (named.length > 0) return named;

  const spoken = new Set(asked);
  const overlapping = all.filter((item) => saidWords(item.label).some((w) => spoken.has(w)));
  if (overlapping.length > 0) return overlapping;

  return all;
}

/** The registers money can leave, with the company each belongs to. */
async function registers(tx: Tx, tenantId: string): Promise<Named[]> {
  const rows = await tx.query.bankAccounts.findMany({
    where: and(
      eq(schema.bankAccounts.tenantId, tenantId),
      eq(schema.bankAccounts.isActive, true),
    ),
  });
  return rows
    .filter((row) => row.name.trim() !== "")
    .map((row) => ({ value: row.id, label: row.name }));
}

/**
 * What a line may be coded to, which is NOT simply "the expense accounts".
 *
 * `isCodableAccount` is the module's own rule and using anything else here
 * would be a second opinion about somebody's books: it keeps a line off the
 * registers themselves, off owner funds, off opening balances — and off GRNI
 * and Inventory, where coding by hand capitalises a delivery twice
 * ([ADR 0012](../../../../docs/decisions/0012-what-capitalises-stock.md)).
 */
async function codableExpenses(tx: Tx, tenantId: string): Promise<Named[]> {
  const [accounts, banks] = await Promise.all([
    listAccounts(tx, tenantId),
    tx.query.bankAccounts.findMany({
      where: eq(schema.bankAccounts.tenantId, tenantId),
    }),
  ]);
  const registerAccountIds = new Set(banks.map((b) => b.accountId));
  return accounts
    .filter((a) => a.isActive)
    .filter((a) => a.accountType === "expense")
    .filter((a) => isCodableAccount(a, registerAccountIds))
    .map((a) => ({ value: a.id, label: a.name, detail: a.code }));
}

export const accountingTellSource: TellSource = {
  slug: "accounting",
  moduleSlug: "accounting",
  label: "Books",
  revalidate: ["/dashboard/m/accounting", "/dashboard/m/accounting/banking", "/dashboard/today"],

  async actions(tx: Tx, ctx: TellCtx): Promise<TellAction[]> {
    /*
     * THE OUTSIDE ACCOUNTANT IS READ-ONLY IN THIS MODULE, so they are offered
     * nothing rather than offered something that refuses. `quickAddTransaction`
     * throws for `expert` either way — this is the courtesy, not the control.
     */
    if (ctx.role === "expert") return [];

    const [from, categories, tenant] = await Promise.all([
      registers(tx, ctx.tenantId),
      codableExpenses(tx, ctx.tenantId),
      tx.query.tenants.findFirst({ where: eq(schema.tenants.id, ctx.tenantId) }),
    ]);
    /*
     * The symbol is a TENANT setting, not a module choice, and money shown two
     * ways inside one workspace is worse than either way consistently. Null
     * gives exactly the house style, so doing nothing is already right.
     */
    const symbol = tenant?.currencySymbol ?? null;
    // Nothing to say a sentence about until the business has both an account
    // the money left and somewhere to put it.
    if (from.length === 0 || categories.length === 0) return [];

    const asInput = (values: TellValues) => {
      const bankAccountId = text(values.account);
      const categoryAccountId = text(values.category);
      const dollars = Number(values.amount);
      if (!bankAccountId || !categoryAccountId || !Number.isFinite(dollars)) return null;

      /*
       * **DOLLARS TO CENTS THROUGH `parseMoneyToCents`, AND NOT BY MULTIPLYING.**
       *
       * It is the module's own converter and it refuses what multiplying would
       * quietly accept: more than two decimals, anything past `MAX_AMOUNT_CENTS`,
       * and the floating-point debris a spoken number can arrive as —
       * `String(0.1 + 0.2)` is "0.30000000000000004", which this rejects and
       * `Math.round(x * 100)` would turn into 30 cents with a straight face.
       *
       * A refused amount previews as NOTHING rather than as a rounded guess,
       * which is the whole argument of [ADR 0054](../../../../docs/decisions/0054-tell-may-draft-never-send.md) §2
       * applied to the one field where being approximately right is being wrong.
       */
      const amountCents = parseMoneyToCents(String(dollars));
      if (amountCents === null || amountCents <= 0) return null;
      return {
        bankAccountId,
        direction: "expense" as const,
        txnDate: text(values.on)!,
        categoryAccountId,
        amountCents,
        memo: text(values.payee) ?? undefined,
      };
    };

    return [
      {
        slug: "accounting.paid",
        title: "Money paid out",
        about:
          "Money that has already LEFT one of the business's accounts. Examples: “paid the feed store two hundred forty cash”, “forty dollars of diesel on the farm card”. Only for money ALREADY GONE — never a bill that is not paid yet, and never money coming in.",
        fields: [
          {
            key: "account",
            label: "Paid from",
            kind: "choice",
            required: true,
            hint: "The account it left — the card, the chequing account, the cash box. Leave out unless the sentence says which.",
            find: async (_tx: Tx, _ctx: TellCtx, said: string) => findNamed(from, said),
          },
          {
            key: "amount",
            label: "How much",
            kind: "number",
            required: true,
            hint: "IN DOLLARS. “two hundred forty” is 240, “ninety eight fifty” is 98.50. Never cents.",
          },
          {
            key: "category",
            label: "What for",
            kind: "choice",
            required: true,
            hint: "What it was spent ON, in the sentence's own words — “feed”, “diesel”. Never guess when the sentence does not say.",
            find: async (_tx: Tx, _ctx: TellCtx, said: string) => findNamed(categories, said),
          },
          {
            key: "payee",
            label: "Who to",
            kind: "text",
            hint: "Who was paid, as the sentence names them. Becomes the memo.",
          },
          {
            key: "on",
            label: "When",
            kind: "date",
            required: true,
            hint: "The day the money left.",
            defaultToday: true,
          },
        ],

        /**
         * **THE POSTING, NOT THE WORDS** ([ADR 0054](../../../../docs/decisions/0054-tell-may-draft-never-send.md) §2).
         *
         * Built by `quickAddPosting` from the same input the write takes, so the
         * two cannot drift. A positive figure against each account with `Dr` and
         * `Cr` said out loud — never a signed number, because a minus sign in a
         * money column is the one thing everybody reads differently.
         */
        async preview(tx, previewCtx, values) {
          const input = asInput(values);
          if (!input) return null;

          const [lines, accounts] = await Promise.all([
            quickAddPosting(tx, previewCtx, input),
            listAccounts(tx, previewCtx.tenantId),
          ]);
          const nameOf = (id: string) => {
            const account = accounts.find((a) => a.id === id);
            return account ? `${account.code} ${account.name}` : "an account";
          };

          /*
           * **`formatCents` HERE, AND THAT IS DELIBERATE.** It is symbol-free
           * because it was written for debit and credit columns, where the
           * header carries the currency and a symbol on every row is noise a
           * bookkeeper reads past. The summary below is a sentence, so it gets
           * the symbol.
           *
           * It is also SIGN-BLIND — `Math.abs` inside — so a negative would
           * render as its own opposite. Nothing here can: the sign is spent on
           * choosing the word, and only a positive figure is ever printed.
           */
          return {
            lines: lines.map((line) => ({
              label: `${line.amountCents >= 0 ? "Dr" : "Cr"} ${nameOf(line.accountId)}`,
              value: formatCents(Math.abs(line.amountCents)),
            })),
            /*
             * **A DRAFT IS NOT A RECORDING, AND SAYING SO IS THE POINT.** A
             * non-owner's entry waits for an owner to post it (`quick-add.ts`),
             * and somebody who walks away believing their books are up to date
             * has been misled by a confirmation that was technically true.
             */
            warning:
              previewCtx.role === "owner"
                ? undefined
                : "This will wait as a draft until an owner posts it.",
          };
        },

        async record(tx, recordCtx, values) {
          const input = asInput(values);
          if (!input) throw new TellRefusal("say how much, what for, and which account");

          let status: "posted" | "draft";
          try {
            ({ status } = await quickAddTransaction(tx, recordCtx, input));
          } catch (err) {
            throw refusal(err);
          }

          const who = text(values.payee);
          const amount = formatMoney(input.amountCents, symbol);
          const said = who ? `${amount} to ${who}` : amount;
          return {
            summary: status === "posted" ? `${said} — paid` : `${said} — draft, for an owner to post`,
          };
        },
      },
    ];
  },
};
