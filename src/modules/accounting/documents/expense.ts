import "server-only";
import { and, eq, isNotNull, like } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { LedgerError, postEntry, type LedgerCtx } from "../core";
import { loadDocument } from "./documents";
import { attachDocument } from "./links";

export interface RecordExpenseInput {
  documentId: string;
  entryDate: string;
  amountCents: number;
  memo?: string;
  paidFromAccountId: string;
  categoryAccountId: string;
}

/**
 * Cash/no-feed purchases: post Dr category / Cr paid-from (prefilled from
 * the extraction by the UI — a human submitted these numbers) and attach
 * the receipt to the entry in the same tx. Owner posts; staff creates a
 * draft (mirrors banking quick add).
 */
export async function recordExpenseFromReceipt(
  tx: Tx,
  ctx: LedgerCtx,
  input: RecordExpenseInput,
): Promise<{ entryId: string; status: "posted" | "draft" }> {
  const doc = await loadDocument(tx, ctx.tenantId, input.documentId);
  if (doc.status === "trashed") {
    throw new LedgerError("DOCUMENT_TRASHED", doc.id);
  }
  // Idempotency: entries born from this receipt carry keys
  // `docexp:{docId}:{n}`. If the document is STILL linked to one of them,
  // this is a double-click — return it. A deliberate second expense
  // requires detaching first, which frees the next n.
  const priorEntries = await tx
    .select({
      id: schema.journalEntries.id,
      status: schema.journalEntries.status,
    })
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.tenantId, ctx.tenantId),
        like(schema.journalEntries.idempotencyKey, `docexp:${doc.id}:%`),
      ),
    );
  if (priorEntries.length > 0) {
    const priorIds = new Set(priorEntries.map((e) => e.id));
    const currentLinks = await tx
      .select({ journalEntryId: schema.documentLinks.journalEntryId })
      .from(schema.documentLinks)
      .where(
        and(
          eq(schema.documentLinks.tenantId, ctx.tenantId),
          eq(schema.documentLinks.documentId, doc.id),
          isNotNull(schema.documentLinks.journalEntryId),
        ),
      );
    const stillLinked = currentLinks.find(
      (l) => l.journalEntryId && priorIds.has(l.journalEntryId),
    );
    if (stillLinked?.journalEntryId) {
      const prior = priorEntries.find((e) => e.id === stillLinked.journalEntryId)!;
      return {
        entryId: prior.id,
        status: prior.status === "draft" ? "draft" : "posted",
      };
    }
  }

  const status = ctx.role === "owner" ? ("posted" as const) : ("draft" as const);
  const { entry, deduped } = await postEntry(tx, ctx, {
    status,
    entryDate: input.entryDate,
    memo: input.memo ?? "",
    source: "manual",
    idempotencyKey: `docexp:${doc.id}:${priorEntries.length}`,
    lines: [
      { accountId: input.categoryAccountId, amountCents: input.amountCents },
      { accountId: input.paidFromAccountId, amountCents: -input.amountCents },
    ],
  });
  if (!deduped) {
    await attachDocument(tx, ctx, {
      documentId: doc.id,
      target: { type: "entry", id: entry.id },
    });
  }
  return { entryId: entry.id, status };
}
