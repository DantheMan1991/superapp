import type { JournalEntry } from "@/db/schema";

/**
 * The identity a core call runs as. Derived from TenantContext by the
 * action layer — core never touches Clerk directly.
 */
export interface LedgerCtx {
  tenantId: string;
  userId: string;
  /** "expert" = outside accountant: read + close-review only, never posts. */
  role: "owner" | "staff" | "expert";
}

export interface EntryLineInput {
  accountId: string;
  /** Signed cents: positive = debit, negative = credit. Never zero. */
  amountCents: number;
  memo?: string;
  /** Dimension members to tag this line with (at most one per type). */
  dimensionMemberIds?: string[];
}

export interface NewEntryInput {
  /**
   * Which legal entity's books this entry belongs to (ADR 0010). REQUIRED —
   * there is no default here, deliberately.
   *
   * A caller that cannot choose (an invoice, a bill, a bank row — none of which
   * carry an entity yet) passes `await getDefaultEntityId(tx, tenantId)`
   * explicitly. Making that call visible at the call site is what turns the
   * document slice's to-do list into a grep.
   */
  entityId: string;
  /** ISO date (yyyy-mm-dd) — the bookkeeping day. */
  entryDate: string;
  memo?: string;
  lines: EntryLineInput[];
  source?: JournalEntry["source"];
  sourceId?: string | null;
  /** Dedup key: retries and double-clicks with the same key post once. */
  idempotencyKey?: string | null;
}

export interface PostResult {
  entry: JournalEntry;
  /** True when an existing entry with the same idempotency key was returned. */
  deduped: boolean;
}
