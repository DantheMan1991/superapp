import "server-only";
import { schema, withSystem } from "@/db";
import type { ShareEventKind } from "@/db/schema";

/**
 * Append to a share's access log.
 *
 * Runs under withSystem because document_share_events is member-READ-only:
 * the log is the tenant's evidence in a dispute, so members consult it and
 * only trusted server code writes it. This helper is deliberately narrow — it
 * takes no free-form input and is the only writer.
 *
 * Never throws. A log write failing must not take down a link that is
 * otherwise working; a missing event is a smaller problem than a broken share.
 */
export async function recordShareEvent(input: {
  tenantId: string;
  shareId: string;
  documentId?: string | null;
  kind: ShareEventKind;
  ipHash?: string;
  userAgentHash?: string;
  bytesSent?: number;
}): Promise<void> {
  try {
    await withSystem((tx) =>
      tx.insert(schema.documentShareEvents).values({
        tenantId: input.tenantId,
        shareId: input.shareId,
        documentId: input.documentId ?? null,
        kind: input.kind,
        ipHash: input.ipHash ?? "",
        userAgentHash: input.userAgentHash ?? "",
        bytesSent: input.bytesSent ?? 0,
      }),
    );
  } catch (err) {
    console.error("share event write failed", err);
  }
}
