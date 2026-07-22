"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import {
  LedgerError,
  friendlyMessage,
  requireOwnerRole,
  type LedgerCtx,
} from "../core";
import { MAX_AMOUNT_CENTS, formatCents, isValidIsoDate } from "../lib/money";
import { extractDocument, tryExtractDocument } from "../ai/extract";
import { readExtraction } from "../ai/extract-validate";
import { createDocumentRecord, inspectUploadedBlob } from "./ingest";
import {
  listDocuments,
  loadDocument,
  restoreDocument,
  trashDocument,
} from "./documents";
import { attachDocument, detachDocument, type LinkTarget } from "./links";
import { recordExpenseFromReceipt } from "./expense";
import {
  findBankTxnCandidatesForDocument,
  type BankTxnCandidate,
} from "./match";

const BASE = "/dashboard/m/accounting";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(): Promise<LedgerCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (err instanceof LedgerError) return { error: friendlyMessage(err) };
  console.error("documents action failed", err);
  const msg = err instanceof Error ? err.message : "";
  if (msg.includes("BLOB_READ_WRITE_TOKEN")) {
    return { error: "File storage isn't configured yet — add BLOB_READ_WRITE_TOKEN to .env (see SETUP.md)." };
  }
  if (msg.includes("RESEND_API_KEY")) {
    return { error: "Email-in isn't configured yet — add the Resend keys to .env (see SETUP.md)." };
  }
  if (msg.includes("ANTHROPIC_API_KEY")) {
    return { error: "The Claude API key isn't configured yet — see SETUP.md." };
  }
  return { error: "Something went wrong. Please try again." };
}

function revalidateReceipts(documentId?: string): void {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/receipts`);
  if (documentId) revalidatePath(`${BASE}/receipts/${documentId}`);
}

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidIsoDate, "Not a real calendar date");

// ---------------------------------------------------------------- upload

const registerUploadSchema = z.object({
  pathname: z.string().min(1).max(500),
});

/**
 * Part 2 of the client-direct upload (part 1 wrote the blob via the token
 * route). Verifies namespace + allowlist against the REAL blob, hashes
 * the actual bytes, inserts the row, then auto-runs extraction after the
 * registration tx commits.
 */
export async function registerUploadedDocumentAction(
  input: z.infer<typeof registerUploadSchema>,
): Promise<ActionResult<{ documentId: string; duplicateOfId: string | null }>> {
  const ctx = await gate();
  const parsed = registerUploadSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    // Blob inspection is network work — before the tx, per house rule.
    const inspected = await inspectUploadedBlob(ctx, parsed.data.pathname);
    const result = await withTenant(ctx.tenantId, async (tx) => {
      const r = await createDocumentRecord(tx, ctx.tenantId, {
        blobPathname: parsed.data.pathname,
        fileName: inspected.fileName,
        mimeType: inspected.mimeType,
        sizeBytes: inspected.sizeBytes,
        sha256: inspected.sha256,
        source: "upload",
        uploadedByClerkUserId: ctx.userId,
      });
      await logAuditInTx(tx, {
        action: "documents.uploaded",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "document",
        targetId: r.document.id,
        meta: {
          sizeBytes: inspected.sizeBytes,
          mimeType: inspected.mimeType,
          duplicateOfId: r.duplicateOfId,
        },
      });
      return r;
    });
    // Auto-extraction (P13): after the row committed; cooldown skips
    // silently, failures persist status "failed" — never blocks upload.
    await tryExtractDocument(ctx, result.document.id);
    revalidateReceipts(result.document.id);
    return {
      ok: true,
      data: {
        documentId: result.document.id,
        duplicateOfId: result.duplicateOfId,
      },
    };
  } catch (err) {
    return fail(err);
  }
}

// ------------------------------------------------------------ extraction

const documentRefSchema = z.object({ documentId: z.string().uuid() });

export async function extractDocumentAction(
  input: z.infer<typeof documentRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = documentRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await extractDocument(ctx, parsed.data.documentId);
    revalidateReceipts(parsed.data.documentId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ----------------------------------------------------------- attach/detach

const attachSchema = z.object({
  documentId: z.string().uuid(),
  target: z.object({
    type: z.enum(["entry", "bank_transaction", "invoice"]),
    id: z.string().uuid(),
  }),
});

export async function attachDocumentAction(
  input: z.infer<typeof attachSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = attachSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const link = await attachDocument(tx, ctx, {
        documentId: parsed.data.documentId,
        target: parsed.data.target as LinkTarget,
      });
      await logAuditInTx(tx, {
        action: "documents.attached",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "document",
        targetId: parsed.data.documentId,
        meta: {
          linkId: link.id,
          targetType: parsed.data.target.type,
          targetId: parsed.data.target.id,
        },
      });
    });
    revalidateReceipts(parsed.data.documentId);
    revalidatePath(`${BASE}/journal`);
    revalidatePath(`${BASE}/banking`);
    revalidatePath(`${BASE}/sales`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const detachSchema = z.object({
  linkId: z.string().uuid(),
});

export async function detachDocumentAction(
  input: z.infer<typeof detachSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = detachSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    let documentId = "";
    await withTenant(ctx.tenantId, async (tx) => {
      const link = await detachDocument(tx, ctx, parsed.data);
      documentId = link.documentId;
      await logAuditInTx(tx, {
        action: "documents.detached",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "document",
        targetId: link.documentId,
        meta: {
          linkId: link.id,
          targetType: link.journalEntryId
            ? "entry"
            : link.bankTransactionId
              ? "bank_transaction"
              : "invoice",
          targetId:
            link.journalEntryId ?? link.bankTransactionId ?? link.invoiceId,
        },
      });
    });
    revalidateReceipts(documentId);
    revalidatePath(`${BASE}/journal`);
    revalidatePath(`${BASE}/banking`);
    revalidatePath(`${BASE}/sales`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ------------------------------------------------------------ trash/restore

const versionedRefSchema = z.object({
  documentId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
});

export async function trashDocumentAction(
  input: z.infer<typeof versionedRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = versionedRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      await trashDocument(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "documents.trashed",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "document",
        targetId: parsed.data.documentId,
      });
    });
    revalidateReceipts(parsed.data.documentId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function restoreDocumentAction(
  input: z.infer<typeof versionedRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = versionedRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      await restoreDocument(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "documents.restored",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "document",
        targetId: parsed.data.documentId,
      });
    });
    revalidateReceipts(parsed.data.documentId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// --------------------------------------------------- match + record expense

export async function findMatchCandidatesAction(
  input: z.infer<typeof documentRefSchema>,
): Promise<ActionResult<{ candidates: BankTxnCandidate[] }>> {
  const ctx = await gate();
  const parsed = documentRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const candidates = await withTenant(ctx.tenantId, async (tx) => {
      const doc = await loadDocument(tx, ctx.tenantId, parsed.data.documentId);
      const extraction = readExtraction(doc.extraction);
      const totalCents = extraction?.fields.totalCents.value ?? null;
      if (totalCents === null) return [];
      const documentDate =
        extraction?.fields.documentDate.value ??
        doc.createdAt.toISOString().slice(0, 10);
      return findBankTxnCandidatesForDocument(tx, ctx.tenantId, {
        totalCents,
        documentDate,
      });
    });
    return { ok: true, data: { candidates } };
  } catch (err) {
    return fail(err);
  }
}

/** Inbox documents for the attach-existing picker on record pages. */
export async function listInboxDocumentsAction(): Promise<
  ActionResult<{
    documents: Array<{
      id: string;
      fileName: string;
      vendorName: string | null;
      totalLabel: string | null;
    }>;
  }>
> {
  try {
    const ctx = await gate();
    const docs = await withTenant(ctx.tenantId, (tx) =>
      listDocuments(tx, ctx.tenantId, "inbox"),
    );
    return {
      ok: true,
      data: {
        documents: docs.map((doc) => {
          const extraction = readExtraction(doc.extraction);
          const total = extraction?.fields.totalCents.value ?? null;
          return {
            id: doc.id,
            fileName: doc.fileName,
            vendorName: extraction?.fields.vendorName.value ?? null,
            totalLabel:
              total !== null ? `$${formatCents(Math.abs(total))}` : null,
          };
        }),
      },
    };
  } catch (err) {
    return fail(err);
  }
}

/** Recent attachable records for the attach dialog's entry/invoice tabs. */
export async function listAttachTargetsAction(): Promise<
  ActionResult<{
    entries: Array<{ id: string; entryDate: string; memo: string; status: string }>;
    invoices: Array<{ id: string; invoiceNumber: string; status: string }>;
  }>
> {
  try {
    const ctx = await gate();
    const data = await withTenant(ctx.tenantId, async (tx) => {
      const entries = await tx.query.journalEntries.findMany({
        where: eq(schema.journalEntries.tenantId, ctx.tenantId),
        orderBy: (e, { desc }) => [desc(e.entryDate), desc(e.createdAt)],
        limit: 20,
      });
      const invoices = await tx.query.invoices.findMany({
        where: eq(schema.invoices.tenantId, ctx.tenantId),
        orderBy: (i, { desc }) => [desc(i.issueDate), desc(i.createdAt)],
        limit: 20,
      });
      return {
        entries: entries.map((e) => ({
          id: e.id,
          entryDate: e.entryDate,
          memo: e.memo,
          status: e.status,
        })),
        invoices: invoices.map((i) => ({
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          status: i.status,
        })),
      };
    });
    return { ok: true, data };
  } catch (err) {
    return fail(err);
  }
}

const recordExpenseSchema = z.object({
  documentId: z.string().uuid(),
  entryDate: dateStr,
  amountCents: z
    .number()
    .int()
    .positive()
    .refine((n) => n <= MAX_AMOUNT_CENTS),
  memo: z.string().trim().max(500).optional(),
  paidFromAccountId: z.string().uuid(),
  categoryAccountId: z.string().uuid(),
});

/**
 * Cash/no-feed purchases: post Dr category / Cr paid-from prefilled from
 * the extraction, and attach the receipt to the entry in the same tx.
 * Owner posts; staff creates a draft (mirrors banking quick add).
 */
export async function recordExpenseFromReceiptAction(
  input: z.infer<typeof recordExpenseSchema>,
): Promise<ActionResult<{ entryId: string }>> {
  const ctx = await gate();
  const parsed = recordExpenseSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const p = parsed.data;
  try {
    const entryId = await withTenant(ctx.tenantId, async (tx) => {
      const result = await recordExpenseFromReceipt(tx, ctx, p);
      await logAuditInTx(tx, {
        action: "documents.expense_recorded",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "journal_entry",
        targetId: result.entryId,
        meta: { documentId: p.documentId, status: result.status },
      });
      return result.entryId;
    });
    revalidateReceipts(p.documentId);
    revalidatePath(`${BASE}/journal`);
    revalidatePath(`${BASE}/trial-balance`);
    return { ok: true, data: { entryId } };
  } catch (err) {
    return fail(err);
  }
}

// ------------------------------------------------------------- email-in

export async function enableEmailInAction(): Promise<
  ActionResult<{ token: string }>
> {
  return setEmailToken("documents.email_token_generated");
}

export async function regenerateEmailInTokenAction(): Promise<
  ActionResult<{ token: string }>
> {
  return setEmailToken("documents.email_token_regenerated");
}

async function setEmailToken(
  auditAction: string,
): Promise<ActionResult<{ token: string }>> {
  try {
    const ctx = await gate();
    requireOwnerRole(ctx);
    const token = randomBytes(18).toString("base64url");
    await withTenant(ctx.tenantId, async (tx) => {
      await tx
        .update(schema.accountingSettings)
        .set({ inboundEmailToken: token, updatedAt: new Date() })
        .where(eq(schema.accountingSettings.tenantId, ctx.tenantId));
      await logAuditInTx(tx, {
        action: auditAction,
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "accounting_settings",
      });
    });
    revalidateReceipts();
    return { ok: true, data: { token } };
  } catch (err) {
    return fail(err);
  }
}

export async function disableEmailInAction(): Promise<ActionResult> {
  try {
    const ctx = await gate();
    requireOwnerRole(ctx);
    await withTenant(ctx.tenantId, async (tx) => {
      await tx
        .update(schema.accountingSettings)
        .set({ inboundEmailToken: null, updatedAt: new Date() })
        .where(eq(schema.accountingSettings.tenantId, ctx.tenantId));
      await logAuditInTx(tx, {
        action: "documents.email_token_disabled",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "accounting_settings",
      });
    });
    revalidateReceipts();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
