import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { hashIp, verifySession } from "@/lib/public-token";
import { streamBlobResponse } from "@/lib/blob-stream";
import { resolveShare } from "@/modules/documents/shares/resolve";
import { resolveSharedFile } from "@/modules/documents/shares/contents";
import { recordShareEvent } from "@/modules/documents/shares/events";
import {
  bytesServedToday,
  isOverByteBudget,
} from "@/modules/documents/shares/limits";
import {
  dispositionFor,
  sanitizeFileName,
} from "@/modules/documents/allowlist";

export const runtime = "nodejs";

/**
 * Anonymous file streaming for a share link.
 *
 * Every request re-resolves the token and re-checks scope from scratch. The
 * listing on the landing page is a render; THIS is the gate. A file that left
 * the share between the two — trashed, moved into a private folder, link
 * revoked — is refused here even though it was on the page a second ago.
 *
 * Headers come from the same streamBlobResponse helper the authenticated
 * routes use, so the sandbox CSP, nosniff and no-referrer protections cannot
 * drift apart between the private and public surfaces. Referrer-Policy matters
 * more here than anywhere else in the app: without it the token sits in the
 * Referer header of every outbound request the rendered file makes.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; documentId: string }> },
): Promise<NextResponse | Response> {
  const { token, documentId } = await params;
  const ipHash = hashIp(
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "",
  );

  const notFound = () =>
    NextResponse.json({ error: "not found" }, { status: 404 });

  const resolved = await resolveShare(token, ipHash);
  if (!resolved.ok) return notFound();
  const { share } = resolved;

  // A passcode-protected link only streams to a browser that passed it.
  if (share.passcodeHash) {
    const cookie = req.cookies.get(`share_${share.id}`)?.value;
    if (!verifySession(cookie, share.id)) return notFound();
  }

  const file = await resolveSharedFile(share, documentId);
  if (!file) {
    await recordShareEvent({
      tenantId: share.tenantId,
      shareId: share.id,
      kind: "denied_scope",
      ipHash,
    });
    return notFound();
  }

  // A public link is an egress amplifier: one leaked token pointed at a large
  // file is an unbounded storage bill, and nothing else would stop it.
  const served = await bytesServedToday(share.tenantId, share.id);
  if (isOverByteBudget(served, file.sizeBytes)) {
    await recordShareEvent({
      tenantId: share.tenantId,
      shareId: share.id,
      kind: "budget_hit",
      ipHash,
    });
    return notFound();
  }

  const wantsDownload = req.nextUrl.searchParams.get("download") === "1";
  // View-only hides the download affordance and forces inline rendering. Say
  // plainly in the UI that this is not a security control — a viewer can
  // always save the bytes their browser already fetched.
  const disposition =
    share.canDownload && wantsDownload
      ? "attachment"
      : dispositionFor(file.mimeType);

  const response = await streamBlobResponse({
    pathname: file.blobPathname,
    mimeType: file.mimeType,
    fileName: sanitizeFileName(file.fileName),
    disposition,
    ifNoneMatch: req.headers.get("if-none-match") ?? undefined,
  });
  if (!response) return notFound();

  await recordShareEvent({
    tenantId: share.tenantId,
    shareId: share.id,
    documentId,
    kind: wantsDownload ? "downloaded" : "viewed",
    ipHash,
    userAgentHash: createHash("sha256")
      .update(req.headers.get("user-agent") ?? "")
      .digest("hex")
      .slice(0, 32),
    // Charged on a 200; a 304 costs nothing to serve.
    bytesSent: response.status === 200 ? file.sizeBytes : 0,
  });

  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}
