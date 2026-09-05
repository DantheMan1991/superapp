import "server-only";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import type { SiteImage } from "@/db/schema";
import { streamBlobResponse } from "@/lib/blob-stream";
import type { SiteHit } from "./read";

/**
 * A site's photo, served to the internet — ADR 0023.
 *
 * The same trust shape as the pages: the slug (or the domain) was turned
 * into a tenant by one trusted lookup, and everything after runs inside
 * that tenant as `staff`. Only a PUBLISHED site's photos are public; the
 * draft preview and the editor use the member route instead, so a photo
 * uploaded for a site nobody has published yet is not on the internet.
 *
 * The bytes never change under an id (a replaced photo is a new row), so
 * the cache may hold them for a week at the edge and an hour in the
 * browser; a removed photo is gone from every page at the next publish
 * and from the cache when that runs out.
 */
export const PUBLIC_IMAGE_CACHE = "public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400";

const UUID = /^[0-9a-f-]{36}$/i;

export function imageFileName(image: Pick<SiteImage, "mimeType">): string {
  return image.mimeType === "image/png" ? "photo.png" : "photo.jpg";
}

export async function siteImageResponse(
  hit: SiteHit | null,
  imageId: string,
  ifNoneMatch: string | null,
): Promise<Response> {
  const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });
  if (!hit || hit.status !== "published" || !UUID.test(imageId)) return notFound();
  const image = await withTenant(hit.tenantId, (tx) =>
    tx.query.siteImages.findFirst({
      where: and(
        eq(schema.siteImages.tenantId, hit.tenantId),
        eq(schema.siteImages.siteId, hit.id),
        eq(schema.siteImages.id, imageId),
      ),
      columns: { pathname: true, mimeType: true },
    }),
  );
  if (!image) return notFound();
  const response = await streamBlobResponse({
    pathname: image.pathname,
    mimeType: image.mimeType,
    fileName: imageFileName(image),
    disposition: "inline",
    ifNoneMatch: ifNoneMatch ?? undefined,
    cacheControl: PUBLIC_IMAGE_CACHE,
  });
  return response ?? notFound();
}
