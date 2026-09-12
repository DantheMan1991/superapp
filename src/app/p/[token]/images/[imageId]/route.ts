import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { schema, withTenant } from "@/db";
import { streamBlobResponse } from "@/lib/blob-stream";
import { imageFileName } from "@/lib/sites/images";
import { hashIp } from "@/lib/public-token";
import { resolvePreview } from "@/lib/sites/previews";

export const runtime = "nodejs";

/**
 * A photo on a site somebody is being shown before it is published
 * (ADR 0046).
 *
 * **THIS ROUTE EXISTS BECAUSE A PREVIEW WITHOUT PHOTOS IS WORTHLESS.** An
 * unpublished site's images are reachable two ways and a client can use
 * neither: `/api/marketing/sites/images/<id>` wants a member session, and
 * `/sites/<slug>/images/<id>` wants the site published. A preview of a farm's
 * website with every picture missing is not a preview of anything.
 *
 * The token is the authorization and it is re-resolved on EVERY fetch — a
 * revoked link stops serving pictures at the same moment it stops serving
 * pages, not when a cache decides. The image must belong to the site the
 * token names: another site's image id, even inside the same tenant, is the
 * same 404 as no image at all.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; imageId: string }> },
): Promise<Response> {
  const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });
  const { token, imageId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(imageId)) return notFound();

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const hit = await resolvePreview(token, hashIp(ip));
  if (!hit.ok) return notFound();

  const image = await withTenant(
    hit.tenantId,
    (tx) =>
      tx.query.siteImages.findFirst({
        where: and(
          eq(schema.siteImages.tenantId, hit.tenantId),
          eq(schema.siteImages.siteId, hit.siteId),
          eq(schema.siteImages.id, imageId),
        ),
        columns: { pathname: true, mimeType: true },
      }),
    { role: "staff" },
  );
  if (!image) return notFound();

  const response = await streamBlobResponse({
    pathname: image.pathname,
    mimeType: image.mimeType,
    fileName: imageFileName(image),
    disposition: "inline",
    ifNoneMatch: req.headers.get("if-none-match") ?? undefined,
    // PRIVATE, and short. The link is meant to be shared with one client, not
    // cached by anything in between — and a revoked preview must stop serving
    // its pictures promptly.
    cacheControl: "private, max-age=300",
  });
  return response ?? notFound();
}
