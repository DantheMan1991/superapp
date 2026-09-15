"use server";

import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { friendlyMessage } from "./core/errors";
import { normalizeSearchQuery, searchDocuments } from "./search";

/** One file a record may point at, as the picker lists it. All serialisable. */
export interface PickableDocument {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

/**
 * THE FILES A RECORD MAY POINT AT: the cabinet's own search, newest first
 * with no term, twelve at a time — for the "From Documents" door on a
 * record's gallery (`RecordPhotos`). Reading only, under the reader's own
 * role, so an owners-only file is not offered to staff; the ATTACH is the
 * owning pack's action, which names the record and holds the gate.
 */
export async function pickDocumentsAction(input: {
  q?: string;
}): Promise<{ hits: PickableDocument[] } | { error: string }> {
  try {
    const ctx = await requireTenant();
    await requireModuleEnabled(ctx.tenant.id, "documents");
    const q = normalizeSearchQuery(input.q ?? "");
    const result = await withTenant(
      ctx.tenant.id,
      (tx) => searchDocuments(tx, ctx.tenant.id, { q, pageSize: 12 }),
      { role: ctx.role },
    );
    return {
      hits: result.hits.map((h) => ({
        id: h.id,
        title: h.title,
        fileName: h.fileName,
        mimeType: h.mimeType,
        sizeBytes: h.sizeBytes,
        createdAt: h.createdAt.toISOString(),
      })),
    };
  } catch (err) {
    return { error: friendlyMessage(err) };
  }
}
