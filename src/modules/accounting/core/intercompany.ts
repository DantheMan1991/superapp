import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JournalEntry } from "@/db/schema";
import { LedgerError } from "./errors";
import { listAccounts } from "./coa";
import { requireOwnerRole } from "./guards";
import { postEntry, voidEntryUnchecked } from "./posting";
import type { EntryLineInput, LedgerCtx } from "./types";

/**
 * INTERCOMPANY: money moving between two companies of one client.
 * ADR 0010 slice 2.
 *
 * The problem it solves, in the ADR's own words the thing such a client does
 * constantly: Oak Row owes a vendor, and Maple Street pays it. As ONE entry
 * that is `Dr AP (Oak) / Cr Checking (Maple)` tagged to a single company, which
 * leaves Oak's balance sheet showing cash leaving an account it does not own
 * and Maple's showing nothing — while the ledger still balances. Both
 * statements are wrong and nothing notices.
 *
 * So it is a PAIR, one entry per company, sharing an `intercompany_id`:
 *
 *   Oak Row     Dr Accounts Payable      500
 *               Cr Due to Affiliates     500      <- Oak now owes Maple
 *   Maple St    Dr Due from Affiliates   500      <- Maple is owed by Oak
 *               Cr Checking              500
 *
 * EACH ENTRY BALANCES ON ITS OWN, so the posting invariant at the heart of this
 * module is untouched — the same reason `entity_id` went on the entry rather
 * than the line. And note what this does NOT require: neither entry touches a
 * register belonging to the other company, so `assertNoForeignRegisters` needs
 * no exception. The guard still refuses the unlinked single entry, which is
 * still wrong; this is the shape that makes the transaction representable.
 *
 * ONE PAIR OF ACCOUNTS, not one per counterparty. Ten LLCs would otherwise mean
 * ninety accounts in a chart every company can see. Who owes whom is a property
 * of the transaction and comes from the link at read time —
 * `affiliateBalances` below — the way an invoice's status comes from its
 * payments rather than from a column.
 */

/** Subtypes of the two shared accounts. Found by SUBTYPE, never by code. */
const DUE_FROM = "due_from_affiliate";
const DUE_TO = "due_to_affiliate";

export interface IntercompanyPair {
  intercompanyId: string;
  /** The company whose money moved. */
  from: JournalEntry;
  /** The company that benefited. */
  to: JournalEntry;
}

async function affiliateAccounts(
  tx: Tx,
  tenantId: string,
): Promise<{ dueFromId: string; dueToId: string }> {
  const accounts = await listAccounts(tx, tenantId);
  const dueFrom = accounts.find((a) => a.subtype === DUE_FROM && a.isSystem);
  const dueTo = accounts.find((a) => a.subtype === DUE_TO && a.isSystem);
  if (!dueFrom || !dueTo) {
    // A tenant provisioned before slice 2 has neither. Re-provisioning the
    // chart adds them and is the documented repair, exactly as it is for the
    // catalogue lists — so the message points at a fix rather than a fault.
    throw new LedgerError(
      "AFFILIATE_ACCOUNTS_MISSING",
      "the Due from / Due to Affiliates accounts are missing",
    );
  }
  return { dueFromId: dueFrom.id, dueToId: dueTo.id };
}

/**
 * Record money moving from one company to another, as a linked pair.
 *
 * WRITTEN TOGETHER OR NOT AT ALL, which is free: both `postEntry` calls run
 * inside the caller's single `withTenant` transaction, so a failure on the
 * second rolls back the first. The deferred trigger in `drizzle/0149` is the
 * backstop for anything this function gets wrong.
 *
 * `payerLines` and `payeeLines` are the OTHER side of each entry — what the
 * money did at each end. The due-to/due-from legs are generated here rather
 * than passed in, so a caller cannot get the direction backwards.
 */
export async function postIntercompanyPair(
  tx: Tx,
  ctx: LedgerCtx,
  input: {
    /** The company whose money moved. */
    fromEntityId: string;
    /** The company that benefited. */
    toEntityId: string;
    amountCents: number;
    entryDate: string;
    memo: string;
    /**
     * What the money did in the PAYING company, minus the affiliate leg —
     * normally a credit to the register it left.
     */
    payerLines: EntryLineInput[];
    /**
     * What the money did in the BENEFITING company, minus the affiliate leg —
     * a debit to AP when a bill was settled, to a register when cash arrived,
     * to an expense when the payer bought something on their behalf.
     *
     * REQUIRED AND NON-EMPTY. There is no "the money went nowhere": if one
     * company is better off by an amount, its books have to say what it got.
     * The first cut of the transfer dialog made this optional, offering "it did
     * not reach their account" — and produced a one-line entry that could not
     * balance and could not post. Found by driving it. `postEntry` would refuse
     * it anyway, with `TOO_FEW_LINES`, which is a true error message about the
     * wrong thing.
     */
    payeeLines: EntryLineInput[];
    /**
     * Both legs are `intercompany`, and there is deliberately no override. The
     * leg that settles a bill could have carried `bill_payment` instead, but
     * then half a transfer would be hiding behind a source that says otherwise
     * — and the bill's own `bill_payments` row points at that entry anyway, so
     * AP, aging and status derivation do not care which source it wears.
     */
    sourceId?: string | null;
    /**
     * Deduped per SIDE by suffixing `:from` / `:to`, so a retry cannot write
     * one half twice or — worse — write one half and dedupe the other into
     * nothing, which the trigger would then reject at commit.
     */
    idempotencyKey?: string;
  },
): Promise<IntercompanyPair> {
  requireOwnerRole(ctx);
  if (input.fromEntityId === input.toEntityId) {
    throw new LedgerError(
      "INTERCOMPANY_SAME_COMPANY",
      "an intercompany transfer needs two different companies",
    );
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new LedgerError(
      "INTERCOMPANY_AMOUNT_INVALID",
      "an intercompany amount must be a positive whole number of cents",
    );
  }

  if (input.payerLines.length === 0 || input.payeeLines.length === 0) {
    throw new LedgerError(
      "INTERCOMPANY_INCOMPLETE",
      "both sides of a transfer need a line of their own",
    );
  }

  const { dueFromId, dueToId } = await affiliateAccounts(tx, ctx.tenantId);
  const intercompanyId = crypto.randomUUID();

  // The PAYER is owed by the other company afterwards, so it holds the asset.
  const from = await postEntry(tx, ctx, {
    entityId: input.fromEntityId,
    intercompanyId,
    status: "posted",
    entryDate: input.entryDate,
    memo: input.memo,
    source: "intercompany",
    sourceId: input.sourceId ?? null,
    ...(input.idempotencyKey ? { idempotencyKey: `${input.idempotencyKey}:from` } : {}),
    lines: [
      { accountId: dueFromId, amountCents: input.amountCents },
      ...input.payerLines,
    ],
  });

  // The PAYEE owes it, so it holds the liability.
  const to = await postEntry(tx, ctx, {
    entityId: input.toEntityId,
    intercompanyId,
    status: "posted",
    entryDate: input.entryDate,
    memo: input.memo,
    source: "intercompany",
    sourceId: input.sourceId ?? null,
    ...(input.idempotencyKey ? { idempotencyKey: `${input.idempotencyKey}:to` } : {}),
    lines: [
      ...input.payeeLines,
      { accountId: dueToId, amountCents: -input.amountCents },
    ],
  });

  return { intercompanyId, from: from.entry, to: to.entry };
}

/** Both halves of a pair, or an empty list when the id names nothing. */
export async function loadIntercompanyEntries(
  tx: Tx,
  tenantId: string,
  intercompanyId: string,
): Promise<JournalEntry[]> {
  return tx.query.journalEntries.findMany({
    where: and(
      eq(schema.journalEntries.tenantId, tenantId),
      eq(schema.journalEntries.intercompanyId, intercompanyId),
    ),
    orderBy: asc(schema.journalEntries.createdAt),
  });
}

/**
 * VOID both halves.
 *
 * The undo `unapplyPayment` and `unapplyBillPayment` need: unapplying says the
 * payment did not happen, which removes it from every report rather than
 * recording a correcting entry — so both legs go, or neither does. Voiding one
 * leaves the other company holding an affiliate balance with nothing to explain
 * it, and `affiliateBalances` cannot even report it, because a group with one
 * surviving entry is skipped as half a pair.
 *
 * Distinct from `reverseIntercompanyPair`, which posts a NEW pair and leaves
 * the original standing — that is the answer when the transfer really happened
 * and is being undone after the fact. This one is for a transfer that should
 * not have been recorded at all.
 *
 * The mutability tiers apply to EACH leg through `voidEntryUnchecked`, so a
 * reconciled register line or a closed period on either side refuses, and the
 * caller's transaction rolls back whole.
 */
export async function voidIntercompanyPair(
  tx: Tx,
  ctx: LedgerCtx,
  intercompanyId: string,
): Promise<JournalEntry[]> {
  requireOwnerRole(ctx);
  const entries = await loadIntercompanyEntries(tx, ctx.tenantId, intercompanyId);
  if (entries.length !== 2) {
    throw new LedgerError(
      "INTERCOMPANY_NOT_FOUND",
      `intercompany ${intercompanyId} is not a pair`,
    );
  }
  const voided: JournalEntry[] = [];
  for (const entry of entries) {
    // Already void is not an error: unapply can be reached twice, and the
    // second pass has nothing left to do on that side.
    if (entry.status !== "posted") continue;
    voided.push(
      await voidEntryUnchecked(tx, ctx, {
        entryId: entry.id,
        expectedVersion: entry.version,
      }),
    );
  }
  return voided;
}

/**
 * Reverse BOTH halves, as a new pair.
 *
 * Neither leg can be reversed or voided on its own — `guards.ts` refuses that,
 * the way it already refuses voiding an invoice's entry from the journal.
 * Undoing one side of an intercompany transfer would leave the other company
 * still owing, which is the same silent asymmetry the pair exists to prevent.
 */
export async function reverseIntercompanyPair(
  tx: Tx,
  ctx: LedgerCtx,
  args: { intercompanyId: string; entryDate: string; memo?: string },
): Promise<IntercompanyPair> {
  requireOwnerRole(ctx);
  const entries = await loadIntercompanyEntries(tx, ctx.tenantId, args.intercompanyId);
  if (entries.length !== 2) {
    throw new LedgerError(
      "INTERCOMPANY_NOT_FOUND",
      `intercompany ${args.intercompanyId} is not a pair`,
    );
  }
  if (entries.some((e) => e.status !== "posted")) {
    throw new LedgerError(
      "ENTRY_NOT_POSTED",
      "only a posted intercompany transfer can be reversed",
    );
  }

  const lines = await tx
    .select()
    .from(schema.journalLines)
    .where(
      and(
        eq(schema.journalLines.tenantId, ctx.tenantId),
        inArray(
          schema.journalLines.entryId,
          entries.map((e) => e.id),
        ),
      ),
    )
    .orderBy(asc(schema.journalLines.lineNo));

  const intercompanyId = crypto.randomUUID();
  const memo = args.memo ?? `Reversal of transfer dated ${entries[0].entryDate}`;
  const posted: JournalEntry[] = [];
  for (const entry of entries) {
    // Every line negated, in the SAME company it was posted in. There is no
    // `reversesEntryId` here: that column carries a partial unique allowing one
    // reversal per entry, and the pair is reversed as a unit through its own
    // link — recording it twice would be two answers to one question.
    const r = await postEntry(tx, ctx, {
      entityId: entry.entityId,
      intercompanyId,
      status: "posted",
      entryDate: args.entryDate,
      memo,
      source: "intercompany",
      idempotencyKey: `icreverse:${args.intercompanyId}:${entry.entityId}`,
      lines: lines
        .filter((l) => l.entryId === entry.id)
        .map((l) => ({
          accountId: l.accountId,
          amountCents: -l.amountCents,
          memo: l.memo,
        })),
    });
    posted.push(r.entry);
  }
  return { intercompanyId, from: posted[0], to: posted[1] };
}

export interface AffiliateBalance {
  entityId: string;
  counterpartyEntityId: string;
  /** Positive = this company is OWED by the counterparty. */
  netCents: number;
}

/**
 * Who owes whom, derived from the pairs.
 *
 * This is why one shared account per side is enough. The chart says "Due from
 * Affiliates 12,400"; this says which affiliates, by walking the links rather
 * than by holding ninety accounts open. Same habit as invoice status, the
 * closed-through date and retained earnings — computed on read, so it cannot
 * drift from the entries it describes.
 *
 * Only POSTED entries count, exactly as `getBalances` does.
 */
export async function affiliateBalances(
  tx: Tx,
  tenantId: string,
): Promise<AffiliateBalance[]> {
  const je = schema.journalEntries;
  const jl = schema.journalLines;
  const accounts = await listAccounts(tx, tenantId);
  const affiliateIds = accounts
    .filter((a) => a.subtype === DUE_FROM || a.subtype === DUE_TO)
    .map((a) => a.id);
  if (affiliateIds.length === 0) return [];

  const rows = await tx
    .select({
      intercompanyId: je.intercompanyId,
      entityId: je.entityId,
      amountCents: jl.amountCents,
    })
    .from(jl)
    .innerJoin(je, and(eq(jl.tenantId, je.tenantId), eq(jl.entryId, je.id)))
    .where(
      and(
        eq(jl.tenantId, tenantId),
        eq(je.status, "posted"),
        inArray(jl.accountId, affiliateIds),
      ),
    );

  // One pair has one entry per company, so the counterparty of a row is simply
  // the other company in its group.
  const byPair = new Map<string, Array<{ entityId: string; amountCents: number }>>();
  for (const r of rows) {
    if (!r.intercompanyId) continue;
    const list = byPair.get(r.intercompanyId) ?? [];
    list.push({ entityId: r.entityId, amountCents: r.amountCents });
    byPair.set(r.intercompanyId, list);
  }

  const net = new Map<string, AffiliateBalance>();
  for (const legs of byPair.values()) {
    const entities = [...new Set(legs.map((l) => l.entityId))];
    if (entities.length !== 2) continue; // half a pair says nothing about anybody
    for (const leg of legs) {
      const counterparty = entities.find((e) => e !== leg.entityId)!;
      const key = `${leg.entityId}|${counterparty}`;
      const row = net.get(key) ?? {
        entityId: leg.entityId,
        counterpartyEntityId: counterparty,
        netCents: 0,
      };
      row.netCents += leg.amountCents;
      net.set(key, row);
    }
  }
  return [...net.values()].filter((r) => r.netCents !== 0);
}
