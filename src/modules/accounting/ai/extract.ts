import "server-only";
import { eq } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/db";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import { logAuditInTx } from "@/lib/audit";
import { LedgerError, type LedgerCtx } from "../core";
import { isExtractableMime } from "../documents/allowlist";
import { loadDocument } from "../documents/documents";
import { readBlobBytes } from "../documents/ingest";
import {
  EXTRACT_SYSTEM_PROMPT,
  EXTRACT_TOOL,
  buildExtractContent,
} from "./extract-prompt";
import { normalizeImageForVision } from "./extract-image";
import { validateExtraction, type DocumentExtraction } from "./extract-validate";

const COOLDOWN_MS = 15_000;
const MAX_TOKENS = 4000;

export interface ExtractGathered {
  documentId: string;
  mimeType: string;
  base64: string;
}

/**
 * Load + gate in one tenant read, then fetch and normalize the bytes
 * OUTSIDE any transaction (network work must never hold a tx open).
 * Throws AI_COOLDOWN when called within the per-tenant window — auto-run
 * callers swallow that (leave status pending), manual callers surface it.
 */
export async function gatherExtractInput(
  ctx: LedgerCtx,
  documentId: string,
): Promise<ExtractGathered> {
  const doc = await withTenant(ctx.tenantId, async (tx) => {
    const d = await loadDocument(tx, ctx.tenantId, documentId);
    if (!d.blobPathname || !isExtractableMime(d.mimeType)) {
      throw new LedgerError("DOCUMENT_NOT_EXTRACTABLE", documentId, {
        mimeType: d.mimeType,
      });
    }
    const settings = await tx.query.accountingSettings.findFirst({
      where: eq(schema.accountingSettings.tenantId, ctx.tenantId),
    });
    if (settings?.aiLastExtractedAt) {
      const age = Date.now() - settings.aiLastExtractedAt.getTime();
      if (age < COOLDOWN_MS) {
        throw new LedgerError("AI_COOLDOWN", `last extraction ${age}ms ago`);
      }
    }
    // Claim the cooldown slot inside the gating tx so concurrent
    // auto-runs serialize instead of double-calling the model.
    await tx
      .update(schema.accountingSettings)
      .set({ aiLastExtractedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.accountingSettings.tenantId, ctx.tenantId));
    return d;
  });

  const raw = await readBlobBytes(doc.blobPathname!);
  const normalized = await normalizeImageForVision(raw, doc.mimeType);
  return {
    documentId,
    mimeType: normalized.mimeType,
    base64: Buffer.from(normalized.bytes).toString("base64"),
  };
}

/**
 * The only network-touching function — injectable in tests. Forced tool
 * choice; no extended thinking (incompatible with forced tools). Data
 * minimization: the document bytes are the ENTIRE tenant payload.
 */
export async function callExtractModel(
  gathered: ExtractGathered,
): Promise<unknown> {
  const stream = getClaude().messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text",
        text: EXTRACT_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "extract_document" },
    messages: [
      {
        role: "user",
        content: buildExtractContent(gathered.mimeType, gathered.base64),
      },
    ],
  });
  const msg = await stream.finalMessage();
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) {
    throw new LedgerError("AI_UNAVAILABLE", "no tool_use block in response");
  }
  return toolUse.input;
}

export async function persistExtraction(
  tx: Tx,
  ctx: LedgerCtx,
  documentId: string,
  extraction: DocumentExtraction | null,
): Promise<void> {
  await tx
    .update(schema.documents)
    .set(
      extraction
        ? { extraction, extractionStatus: "done", updatedAt: new Date() }
        : { extractionStatus: "failed", updatedAt: new Date() },
    )
    .where(eq(schema.documents.id, documentId));
  // Identifiers only — extracted contents never reach the audit log.
  await logAuditInTx(tx, {
    action: "documents.extracted",
    tenantId: ctx.tenantId,
    actorClerkUserId: ctx.userId.startsWith("system:") ? null : ctx.userId,
    actorLabel: ctx.userId.startsWith("system:") ? ctx.userId : null,
    targetType: "document",
    targetId: documentId,
    meta: { model: CLAUDE_MODEL, ok: extraction !== null },
  });
}

/**
 * Full pipeline: gather → call model → validate → persist. Deliberately
 * NOT one transaction (the model call takes seconds). Model/API failures
 * persist status "failed" and rethrow; validation never throws.
 */
export async function extractDocument(
  ctx: LedgerCtx,
  documentId: string,
  callModel: (g: ExtractGathered) => Promise<unknown> = callExtractModel,
): Promise<DocumentExtraction> {
  const gathered = await gatherExtractInput(ctx, documentId);
  let rawOutput: unknown;
  try {
    rawOutput = await callModel(gathered);
  } catch (err) {
    await withTenant(ctx.tenantId, (tx) =>
      persistExtraction(tx, ctx, documentId, null),
    );
    throw err;
  }
  const extraction = validateExtraction(
    rawOutput,
    CLAUDE_MODEL,
    new Date().toISOString(),
  );
  await withTenant(ctx.tenantId, (tx) =>
    persistExtraction(tx, ctx, documentId, extraction),
  );
  return extraction;
}

/**
 * Auto-run wrapper for arrival paths (upload action, email webhook):
 * cooldown → skip silently (status stays pending, the manual Extract
 * button remains); anything else → logged, status already "failed".
 */
export async function tryExtractDocument(
  ctx: LedgerCtx,
  documentId: string,
  callModel?: (g: ExtractGathered) => Promise<unknown>,
): Promise<void> {
  try {
    await extractDocument(ctx, documentId, callModel);
  } catch (err) {
    if (err instanceof LedgerError && err.code === "AI_COOLDOWN") return;
    console.error(`auto-extraction failed for document ${documentId}`, err);
  }
}
