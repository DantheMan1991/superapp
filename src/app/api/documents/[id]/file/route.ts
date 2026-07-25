import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { resolveTenantContext } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules";
import { streamBlobResponse } from "@/lib/blob-stream";
import { dispositionFor, sanitizeFileName } from "@/modules/documents/allowlist";

export const runtime = "nodejs";

/**
 * Authenticated streaming for the Documents module. Auth is re-checked on
 * every fetch: tenant + module gate, then RLS — carrying the caller's ROLE —
 * proves both that the document belongs to this tenant and that the caller may
 * see it. An owners-only file requested by staff returns the same 404 as a
 * document that does not exist.
 *
 * `?v=<versionId>` streams a historical revision; `?download=1` forces a save
 * dialog. Disposition otherwise comes from the allowlist, which permits inline
 * rendering only for types that cannot execute.
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
  if (!(await isModuleEnabled(ctx.tenant.id, "documents"))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const versionId = req.nextUrl.searchParams.get("v");
  const forceDownload = req.nextUrl.searchParams.get("download") === "1";

  const target = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const doc = await tx.query.documents.findFirst({
        where: and(
          eq(schema.documents.tenantId, ctx.tenant.id),
          eq(schema.documents.id, id),
        ),
      });
      if (!doc) return null;
      if (!versionId) return doc;

      // The version is fetched through RLS too, and document_versions
      // inherits the parent's visibility via its policy's EXISTS clause —
      // so a hidden document's history is hidden with it.
      const version = await tx.query.documentVersions.findFirst({
        where: and(
          eq(schema.documentVersions.tenantId, ctx.tenant.id),
          eq(schema.documentVersions.id, versionId),
          eq(schema.documentVersions.documentId, doc.id),
        ),
      });
      if (!version) return null;
      return {
        blobPathname: version.blobPathname,
        mimeType: version.mimeType,
        fileName: version.fileName,
      };
    },
    { role: ctx.role },
  );

  if (!target?.blobPathname) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const response = await streamBlobResponse({
    pathname: target.blobPathname,
    mimeType: target.mimeType,
    fileName: sanitizeFileName(target.fileName),
    disposition: forceDownload ? "attachment" : dispositionFor(target.mimeType),
    ifNoneMatch: req.headers.get("if-none-match") ?? undefined,
  });
  if (!response) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return response;
}
