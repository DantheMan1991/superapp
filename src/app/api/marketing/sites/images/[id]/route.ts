import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { resolveTenantContext } from "@/lib/auth";
import { streamBlobResponse } from "@/lib/blob-stream";
import { imageFileName } from "@/lib/sites/images";

export const runtime = "nodejs";

/**
 * A site photo for signed-in members of its tenant: the editor's picker and
 * the draft preview read from here, so a photo on a site nobody has
 * published yet is seen only by the people who put it there.
 *
 * Auth is re-checked on every fetch: the tenant, then RLS proves the row is
 * this tenant's. Another tenant's photo id returns the same 404 as no photo
 * at all. Not gated on the Marketing module: a member looking at the
 * business's own photos needs no feature switched on to do it.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  const { id } = await params;
  const ctx = await resolveTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const image = await withTenant(
    ctx.tenant.id,
    (tx) =>
      tx.query.siteImages.findFirst({
        where: and(eq(schema.siteImages.tenantId, ctx.tenant.id), eq(schema.siteImages.id, id)),
        columns: { pathname: true, mimeType: true },
      }),
    { role: ctx.role },
  );
  if (!image) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const response = await streamBlobResponse({
    pathname: image.pathname,
    mimeType: image.mimeType,
    fileName: imageFileName(image),
    disposition: "inline",
    ifNoneMatch: req.headers.get("if-none-match") ?? undefined,
    cacheControl: "private, max-age=3600",
  });
  if (!response) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return response;
}
