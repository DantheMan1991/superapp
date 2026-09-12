import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";

/**
 * Reading the preview links on a site (ADR 0046).
 *
 * Here rather than in `preview-actions.ts` because that file is `"use
 * server"`: every async export of one is a server action, and a plain read
 * the screen does inside its own transaction is not that. Takes the caller's
 * `tx`, like every other op in this module.
 */

export interface PreviewLinkView {
  id: string;
  label: string;
  expiresAt: string;
  /** Revoked OR expired — the screen has no reason to tell those apart, and neither does the reader. */
  revoked: boolean;
  viewCount: number;
  lastViewedAt: string | null;
}

export async function listPreviewLinksIn(
  tx: Tx,
  tenantId: string,
  siteId: string,
): Promise<PreviewLinkView[]> {
  const rows = await tx.query.sitePreviews.findMany({
    where: and(
      eq(schema.sitePreviews.tenantId, tenantId),
      eq(schema.sitePreviews.siteId, siteId),
    ),
    orderBy: desc(schema.sitePreviews.createdAt),
    columns: {
      id: true,
      label: true,
      expiresAt: true,
      revokedAt: true,
      viewCount: true,
      lastViewedAt: true,
    },
  });
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    expiresAt: r.expiresAt.toISOString(),
    revoked: r.revokedAt !== null || r.expiresAt.getTime() <= now,
    viewCount: r.viewCount,
    lastViewedAt: r.lastViewedAt?.toISOString() ?? null,
  }));
}
