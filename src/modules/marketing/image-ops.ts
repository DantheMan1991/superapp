import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { SiteImage } from "@/db/schema";
import { SITE_IMAGES_MAX } from "@/lib/sites/photo";
import { MarketingError } from "./core/errors";
import type { MarketingCtx } from "./kit-ops";
import type { StoredPhoto } from "./photo-ingest";

/**
 * Writing the site's photo library. Takes the caller's `tx`; the action
 * layer owns the transaction, the gate, the audit row and every call to
 * the blob store (network, never inside a transaction). Reading the
 * library is `listSiteImages` in `src/lib/sites/read.ts`, because the
 * public renderer and the editor both need it.
 */
export async function insertSiteImage(
  tx: Tx,
  ctx: MarketingCtx,
  siteId: string,
  photo: StoredPhoto,
): Promise<SiteImage> {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.siteImages)
    .where(and(eq(schema.siteImages.tenantId, ctx.tenantId), eq(schema.siteImages.siteId, siteId)));
  if (n >= SITE_IMAGES_MAX) throw new MarketingError("PHOTO_LIMIT", "limit");
  const [created] = await tx
    .insert(schema.siteImages)
    .values({
      tenantId: ctx.tenantId,
      siteId,
      pathname: photo.pathname,
      mimeType: photo.mimeType,
      width: photo.width,
      height: photo.height,
      bytes: photo.bytes.byteLength,
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  if (!created) throw new MarketingError("FORBIDDEN", "photo not created");
  return created;
}

export async function deleteSiteImage(
  tx: Tx,
  ctx: MarketingCtx,
  id: string,
): Promise<SiteImage> {
  const [deleted] = await tx
    .delete(schema.siteImages)
    .where(and(eq(schema.siteImages.tenantId, ctx.tenantId), eq(schema.siteImages.id, id)))
    .returning();
  // Zero rows is how RLS says no to a DELETE; treat it as the refusal it is.
  if (!deleted) throw new MarketingError("PHOTO_MISSING", "no such photo");
  return deleted;
}
