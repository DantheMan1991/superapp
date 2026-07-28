import { fileResponseHeaders } from "@/lib/file-headers";
import { authorizedClient } from "@/lib/email/oauth/accounts";
import { gateMailRoute, mailRouteNotFound } from "@/modules/email/route-auth";
import { verifyBlobClaim } from "@/modules/email/render/signing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One route for attachments AND inline images.
 *
 * Deliberately one, not two: the header block cannot drift between the inline
 * path and the download path if there is only one path. Same reasoning that
 * makes `blob-stream.ts` the single way a stored blob reaches a browser.
 *
 * THE ORDER OF CHECKS IS THE SECURITY OF THIS ROUTE:
 *
 *   1. session + module + account ownership (gateMailRoute, RLS-enforced)
 *   2. signature — BEFORE any I/O, because it is pure CPU. An unauthenticated
 *      flood therefore costs no Neon query and no JMAP round trip.
 *   3. the signed tenant/user must equal the live session's. The signature
 *      proves *we* authorized this blob for this person; the session proves it
 *      *is* that person. A leaked URL is useless without both.
 *   4. only then the mail server.
 *
 * Everything that fails returns the SAME 404 — never a 403, which would confirm
 * that a blob exists.
 *
 * `servedType` and `disposition` are inside the signed payload rather than
 * taken from the query, so a caller cannot ask for `text/html; inline` and get
 * active content rendered from our own origin. That is the whole reason this
 * route signs at all.
 */

/** A mail attachment larger than this is a download problem, not a preview. */
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ accountId: string; blobId: string }> },
): Promise<Response> {
  const { accountId, blobId } = await params;
  const gate = await gateMailRoute(accountId);
  if (!gate.ok) return gate.response;

  const query = new URL(request.url).searchParams;
  const servedType = query.get("type") ?? "";
  const fileName = query.get("name") ?? "";
  const disposition = query.get("disp") === "inline" ? "inline" : "attachment";
  const expiresAt = Number(query.get("exp") ?? "0");
  const signature = query.get("sig") ?? "";

  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return mailRouteNotFound();

  const claim = {
    tenantId: gate.tenantId,
    clerkUserId: gate.userId,
    mailAccountId: gate.account.id,
    blobId,
    servedType,
    fileName,
    disposition: disposition as "inline" | "attachment",
    expiresAt,
  };
  // Rebuilt from the LIVE session's tenant and user, so a URL minted for
  // somebody else cannot verify here even though it verified for them.
  if (!verifyBlobClaim(claim, signature)) return mailRouteNotFound();

  const client = await authorizedClient(gate.account);
  if (!client.ok) return mailRouteNotFound();

  // The token stays inside the client — this route never holds a credential.
  const upstream = await client.data.downloadBlob(blobId, fileName, servedType);
  if (!upstream.ok) return mailRouteNotFound();

  // The mail server reports Content-Length (verified live), so an oversized
  // attachment is refused before a byte is streamed rather than after.
  const declared = Number(upstream.data.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_BYTES) {
    return mailRouteNotFound();
  }

  return new Response(upstream.data.body, {
    status: 200,
    headers: fileResponseHeaders({
      mimeType: servedType,
      fileName,
      disposition,
      // Blob ids are content-addressed and immutable, so a short private cache
      // stops a thread re-fetching the same inline logo once per message. Still
      // `private`: this is one person's correspondence.
      cacheControl:
        disposition === "inline" ? "private, max-age=600" : "private, no-store",
    }),
  });
}
