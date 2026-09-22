import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { resolveTenantContext } from "@/lib/auth";
import { routeGate } from "@/lib/modules";
import { sheetThumbPath } from "@/lib/blob";
import { streamBlobResponse } from "@/lib/blob-stream";
import { PACK } from "@/packs/jobs/vocabulary";

export const runtime = "nodejs";

/**
 * A drawing page's picture, for the sheet cards.
 *
 * **THE SHEET ROW IS THE PERMISSION.** The pathname is derived rather than
 * stored (`sheetThumbPath`), so nothing stops a caller asking for any
 * document id and page number — which is why this reads a `job_sheets` row
 * for that pair through RLS, carrying the caller's role, before it streams
 * anything. No sheet, no picture, and the same 404 either way.
 *
 * A thumbnail that was never made (a set read before this shipped, or a page
 * past the thumbnail limit) is also a 404, and the card falls back to its
 * number and title. Nothing is regenerated here: rendering a PDF page needs
 * a browser, which is exactly why these are made and stored at index time.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ documentId: string; page: string }> },
): Promise<NextResponse | Response> {
  const { documentId, page } = await params;
  const pageNumber = Number.parseInt(page, 10);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const ctx = await resolveTenantContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const refused = await routeGate(ctx.tenant.id, PACK);
  if (refused) return refused;

  const sheet = await withTenant(
    ctx.tenant.id,
    async (tx) =>
      tx.query.jobSheets.findFirst({
        where: and(
          eq(schema.jobSheets.tenantId, ctx.tenant.id),
          eq(schema.jobSheets.documentId, documentId),
          eq(schema.jobSheets.pageNumber, pageNumber),
        ),
        columns: { id: true },
      }),
    { role: ctx.role },
  );
  if (!sheet) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const streamed = await streamBlobResponse({
      pathname: sheetThumbPath(ctx.tenant.id, documentId, pageNumber),
      mimeType: "image/jpeg",
      fileName: `page-${pageNumber}.jpg`,
      disposition: "inline",
    });
    if (streamed) return streamed;
  } catch {
    /** A missing blob is the ordinary case, not a fault worth logging. */
  }
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
