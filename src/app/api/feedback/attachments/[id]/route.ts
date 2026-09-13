import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withSystem, withTenant } from "@/db";
import { isSuperAdmin, resolveTenantContext } from "@/lib/auth";
import { streamBlobResponse } from "@/lib/blob-stream";
import { dispositionFor, sanitizeFileName } from "@/lib/feedback/attachments";

export const runtime = "nodejs";

/**
 * Streaming a feedback screenshot, to the person who sent it or to us.
 *
 * ── ONE ROUTE, TWO READERS, AND WHY THAT IS NOT THE MISTAKE THE DMS WARNS
 *    ABOUT ──────────────────────────────────────────────────────────────────
 *
 * `/api/documents/blob/upload` argues against one route serving two gates, and
 * it is right — about two MODULES. This is one resource with the two audiences
 * it was designed for: a feedback thread has a client end and an operator end,
 * and the pages themselves are already built that way. A second route would be
 * a copy of this one differing in four lines, and a copy is how the two
 * quietly stop agreeing about what may be seen.
 *
 * The branch is therefore explicit and total: superadmin reads under
 * `withSystem`, everybody else reads under their own tenant with their own
 * user, and there is no path that reaches the blob without having gone through
 * one of them.
 *
 * ── AUTHORIZATION IS RE-CHECKED ON EVERY FETCH ───────────────────────────────
 *
 * A blob URL is not a capability here: the store is private, nothing is
 * pre-signed for reading, and an `<img src>` on the thread page is a request
 * that arrives back through this handler with the reader's own session on it.
 * A report that is not yours returns the same 404 as one that does not exist.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  const { id } = await params;

  const columns = {
    blobPathname: schema.feedbackAttachments.blobPathname,
    fileName: schema.feedbackAttachments.fileName,
    mimeType: schema.feedbackAttachments.mimeType,
  };

  let target: {
    blobPathname: string;
    fileName: string;
    mimeType: string;
  } | null = null;

  if (await isSuperAdmin()) {
    /*
      THE CONSOLE. `withSystem`, because the operator is not a member of the
      workspace the file belongs to — the posture every console read in this
      module takes. It sees internal notes' attachments too, which is the
      whole point of the console half.
    */
    const [row] = await withSystem((tx) =>
      tx
        .select(columns)
        .from(schema.feedbackAttachments)
        .where(eq(schema.feedbackAttachments.id, id))
        .limit(1),
    );
    target = row ?? null;
  } else {
    const ctx = await resolveTenantContext();
    if (!ctx) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    /*
      THE REPORTER. Their own transaction, carrying their own user id — which
      is half the policy — so RLS is what decides, and the `tenant_id` clause
      below is the second net rather than the first.
    */
    const [row] = await withTenant(
      ctx.tenant.id,
      (tx) =>
        tx
          .select(columns)
          .from(schema.feedbackAttachments)
          .where(
            and(
              eq(schema.feedbackAttachments.id, id),
              eq(schema.feedbackAttachments.tenantId, ctx.tenant.id),
            ),
          )
          .limit(1),
      { role: ctx.role, userId: ctx.userId },
    );
    target = row ?? null;
  }

  if (!target?.blobPathname) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const response = await streamBlobResponse({
    pathname: target.blobPathname,
    fileName: sanitizeFileName(target.fileName),
    mimeType: target.mimeType,
    // From the allowlist, never from the request: a caller cannot ask for a
    // file to be rendered inline that the list says must be downloaded.
    disposition:
      req.nextUrl.searchParams.get("download") === "1"
        ? "attachment"
        : dispositionFor(target.mimeType),
    ifNoneMatch: req.headers.get("if-none-match") ?? undefined,
  });
  if (!response) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return response;
}
