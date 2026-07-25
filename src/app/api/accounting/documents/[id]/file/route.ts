import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { resolveTenantContext } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules";
import { streamBlobResponse } from "@/lib/blob-stream";

export const runtime = "nodejs";

/**
 * Authenticated document streaming. Auth is re-checked on EVERY fetch
 * (strictly stronger than a TTL'd signed URL): tenant + module gate, then
 * RLS proves the document belongs to the caller's tenant. No raw blob URL
 * ever reaches a client.
 *
 * The lookup is a bare id match, so the caller's ROLE has to reach RLS too:
 * `documents` is shared with the Documents module, and without the role this
 * route would stream an owners-only DMS file to any staff member who learned
 * its uuid. This is the reason app.tenant_role exists (drizzle/0024) — the
 * folder-visibility rule has to hold here, not just in the DMS module's own
 * queries.
 *
 * Headers come from the shared streamBlobResponse helper so this route and the
 * Documents one cannot drift apart. Receipts are always served inline: the
 * accounting allowlist is five safe image/PDF types.
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
  if (!(await isModuleEnabled(ctx.tenant.id, "accounting"))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const doc = await withTenant(
    ctx.tenant.id,
    (tx) =>
      tx.query.documents.findFirst({
        where: and(
          eq(schema.documents.tenantId, ctx.tenant.id),
          eq(schema.documents.id, id),
        ),
      }),
    { role: ctx.role },
  );
  if (!doc?.blobPathname) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const response = await streamBlobResponse({
    pathname: doc.blobPathname,
    mimeType: doc.mimeType,
    fileName: doc.fileName,
    disposition: "inline",
    ifNoneMatch: req.headers.get("if-none-match") ?? undefined,
  });
  if (!response) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return response;
}
