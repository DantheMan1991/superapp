import "server-only";
import { and, desc, eq, inArray, notExists, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { LedgerError, type LedgerCtx } from "../core";
import { countDocumentLinks, loadDocument } from "./documents";

/**
 * Document ↔ record attachments. Exactly one target per link (DB CHECK);
 * the target FKs are NO ACTION, so every hard-delete path for a target
 * calls `detachAllForTargets` first — the FK is the backstop that turns
 * a forgotten call into a loud failure instead of a silent orphan.
 */

export type LinkTargetType = "entry" | "bank_transaction" | "invoice" | "bill";

export interface LinkTarget {
  type: LinkTargetType;
  id: string;
}

function targetColumns(target: LinkTarget): {
  journalEntryId: string | null;
  bankTransactionId: string | null;
  invoiceId: string | null;
  billId: string | null;
} {
  return {
    journalEntryId: target.type === "entry" ? target.id : null,
    bankTransactionId: target.type === "bank_transaction" ? target.id : null,
    invoiceId: target.type === "invoice" ? target.id : null,
    billId: target.type === "bill" ? target.id : null,
  };
}

async function assertTargetExists(
  tx: Tx,
  tenantId: string,
  target: LinkTarget,
): Promise<void> {
  const table =
    target.type === "entry"
      ? schema.journalEntries
      : target.type === "bank_transaction"
        ? schema.bankTransactions
        : target.type === "invoice"
          ? schema.invoices
          : schema.bills;
  const row = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.tenantId, tenantId), eq(table.id, target.id)))
    .limit(1);
  if (row.length === 0) {
    throw new LedgerError("DOCUMENT_TARGET_INVALID", `${target.type}:${target.id}`);
  }
}

export async function attachDocument(
  tx: Tx,
  ctx: LedgerCtx,
  args: { documentId: string; target: LinkTarget },
) {
  const doc = await loadDocument(tx, ctx.tenantId, args.documentId);
  if (doc.status === "trashed") {
    throw new LedgerError("DOCUMENT_TRASHED", doc.id);
  }
  await assertTargetExists(tx, ctx.tenantId, args.target);

  const cols = targetColumns(args.target);
  const inserted = await tx
    .insert(schema.documentLinks)
    .values({
      tenantId: ctx.tenantId,
      documentId: doc.id,
      ...cols,
      createdByClerkUserId: ctx.userId,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) {
    throw new LedgerError("DOCUMENT_LINK_EXISTS", doc.id);
  }
  if (doc.status !== "filed") {
    await tx
      .update(schema.documents)
      .set({ status: "filed", updatedAt: new Date() })
      .where(
        and(
          eq(schema.documents.tenantId, ctx.tenantId),
          eq(schema.documents.id, doc.id),
        ),
      );
  }
  return inserted[0];
}

export async function detachDocument(
  tx: Tx,
  ctx: LedgerCtx,
  args: { linkId: string },
) {
  const deleted = await tx
    .delete(schema.documentLinks)
    .where(
      and(
        eq(schema.documentLinks.tenantId, ctx.tenantId),
        eq(schema.documentLinks.id, args.linkId),
      ),
    )
    .returning();
  if (deleted.length === 0) {
    throw new LedgerError("DOCUMENT_NOT_FOUND", args.linkId);
  }
  const link = deleted[0];
  const remaining = await countDocumentLinks(tx, ctx.tenantId, link.documentId);
  if (remaining === 0) {
    await tx
      .update(schema.documents)
      .set({ status: "inbox", updatedAt: new Date() })
      .where(
        and(
          eq(schema.documents.tenantId, ctx.tenantId),
          eq(schema.documents.id, link.documentId),
          eq(schema.documents.status, "filed"),
        ),
      );
  }
  return link;
}

export interface DocumentLinkView {
  link: typeof schema.documentLinks.$inferSelect;
  targetType: LinkTargetType;
  targetId: string;
  label: string;
}

export async function listLinksForDocument(
  tx: Tx,
  tenantId: string,
  documentId: string,
): Promise<DocumentLinkView[]> {
  const links = await tx.query.documentLinks.findMany({
    where: and(
      eq(schema.documentLinks.tenantId, tenantId),
      eq(schema.documentLinks.documentId, documentId),
    ),
    orderBy: [desc(schema.documentLinks.createdAt)],
  });

  const views: DocumentLinkView[] = [];
  for (const link of links) {
    if (link.journalEntryId) {
      const entry = await tx.query.journalEntries.findFirst({
        where: and(
          eq(schema.journalEntries.tenantId, tenantId),
          eq(schema.journalEntries.id, link.journalEntryId),
        ),
      });
      views.push({
        link,
        targetType: "entry",
        targetId: link.journalEntryId,
        label: entry
          ? `Journal entry · ${entry.entryDate}${entry.memo ? ` · ${entry.memo}` : ""}`
          : "Journal entry",
      });
    } else if (link.bankTransactionId) {
      const txn = await tx.query.bankTransactions.findFirst({
        where: and(
          eq(schema.bankTransactions.tenantId, tenantId),
          eq(schema.bankTransactions.id, link.bankTransactionId),
        ),
      });
      views.push({
        link,
        targetType: "bank_transaction",
        targetId: link.bankTransactionId,
        label: txn
          ? `Bank transaction · ${txn.txnDate} · ${txn.description}`
          : "Bank transaction",
      });
    } else if (link.invoiceId) {
      const invoice = await tx.query.invoices.findFirst({
        where: and(
          eq(schema.invoices.tenantId, tenantId),
          eq(schema.invoices.id, link.invoiceId),
        ),
      });
      views.push({
        link,
        targetType: "invoice",
        targetId: link.invoiceId,
        label: invoice ? `Invoice ${invoice.invoiceNumber}` : "Invoice",
      });
    } else if (link.billId) {
      const bill = await tx.query.bills.findFirst({
        where: and(
          eq(schema.bills.tenantId, tenantId),
          eq(schema.bills.id, link.billId),
        ),
      });
      const vendor = bill
        ? await tx.query.vendors.findFirst({
            where: and(
              eq(schema.vendors.tenantId, tenantId),
              eq(schema.vendors.id, bill.vendorId),
            ),
          })
        : undefined;
      views.push({
        link,
        targetType: "bill",
        targetId: link.billId,
        label: bill
          ? `Bill — ${vendor?.name ?? "vendor"}${bill.billNumber ? ` · ${bill.billNumber}` : ""}`
          : "Bill",
      });
    }
  }
  return views;
}

export async function listDocumentsForTarget(
  tx: Tx,
  tenantId: string,
  target: LinkTarget,
) {
  const column =
    target.type === "entry"
      ? schema.documentLinks.journalEntryId
      : target.type === "bank_transaction"
        ? schema.documentLinks.bankTransactionId
        : target.type === "invoice"
          ? schema.documentLinks.invoiceId
          : schema.documentLinks.billId;
  const rows = await tx
    .select({
      link: schema.documentLinks,
      document: schema.documents,
    })
    .from(schema.documentLinks)
    .innerJoin(
      schema.documents,
      and(
        eq(schema.documents.tenantId, schema.documentLinks.tenantId),
        eq(schema.documents.id, schema.documentLinks.documentId),
      ),
    )
    .where(
      and(
        eq(schema.documentLinks.tenantId, tenantId),
        eq(column, target.id),
      ),
    )
    .orderBy(desc(schema.documentLinks.createdAt));
  return rows;
}

/**
 * P21 coordination: called by every hard-delete path whose target rows
 * carry NO ACTION link FKs (journal draft delete, invoice draft delete,
 * Plaid removed-txn cleanup). Detaches in the same tx as the delete and
 * sends now-linkless documents back to the inbox.
 */
export async function detachAllForTargets(
  tx: Tx,
  tenantId: string,
  targetType: LinkTargetType,
  targetIds: string[],
): Promise<void> {
  if (targetIds.length === 0) return;
  const column =
    targetType === "entry"
      ? schema.documentLinks.journalEntryId
      : targetType === "bank_transaction"
        ? schema.documentLinks.bankTransactionId
        : targetType === "invoice"
          ? schema.documentLinks.invoiceId
          : schema.documentLinks.billId;
  const deleted = await tx
    .delete(schema.documentLinks)
    .where(
      and(
        eq(schema.documentLinks.tenantId, tenantId),
        inArray(column, targetIds),
      ),
    )
    .returning({ documentId: schema.documentLinks.documentId });
  const docIds = [...new Set(deleted.map((d) => d.documentId))];
  if (docIds.length === 0) return;
  await tx
    .update(schema.documents)
    .set({ status: "inbox", updatedAt: new Date() })
    .where(
      and(
        eq(schema.documents.tenantId, tenantId),
        inArray(schema.documents.id, docIds),
        eq(schema.documents.status, "filed"),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(schema.documentLinks)
            .where(
              and(
                eq(schema.documentLinks.tenantId, tenantId),
                eq(schema.documentLinks.documentId, schema.documents.id),
              ),
            ),
        ),
      ),
    );
}
