import "server-only";
import { get } from "@vercel/blob";
import { blobToken } from "./blob";

/**
 * The single way a stored blob reaches a browser.
 *
 * Every file route — the accounting one, the Documents one, and the public
 * share routes later — goes through here, so the security headers cannot drift
 * apart between them. Adding a route must not mean re-deriving this list.
 *
 * Callers are responsible for authorization BEFORE calling: this helper
 * assumes the row was already read through RLS in the caller's tenant context.
 */

export interface StreamBlobInput {
  pathname: string;
  mimeType: string;
  fileName: string;
  disposition: "inline" | "attachment";
  ifNoneMatch?: string;
}

/**
 * Belt and braces against user-uploaded content executing in our origin.
 *
 * `sandbox` with no allow-* tokens neuters scripting even when a browser
 * decides to render something inline, and `default-src 'none'` stops the
 * document reaching back out. This matters most for the types we do NOT accept
 * today — it means a future widening of the allowlist is not automatically a
 * stored-XSS hole.
 */
const CSP =
  "default-src 'none'; sandbox; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** RFC 5987 — lets a non-ASCII filename survive without breaking the header. */
function contentDisposition(
  disposition: "inline" | "attachment",
  fileName: string,
): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(fileName);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function streamBlobResponse(
  input: StreamBlobInput,
): Promise<Response | null> {
  const result = await get(input.pathname, {
    access: "private",
    token: blobToken(),
    ...(input.ifNoneMatch ? { ifNoneMatch: input.ifNoneMatch } : {}),
  });
  if (!result) return null;

  if (result.statusCode === 304) {
    return new Response(null, {
      status: 304,
      headers: { ETag: result.blob.etag },
    });
  }

  return new Response(result.stream, {
    status: 200,
    headers: {
      "Content-Type":
        input.mimeType || result.blob.contentType || "application/octet-stream",
      "Content-Disposition": contentDisposition(
        input.disposition,
        input.fileName,
      ),
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      // A revoked or re-filed document must never be served from a shared cache.
      "Cache-Control": "private, no-cache",
      "Referrer-Policy": "no-referrer",
      ETag: result.blob.etag,
    },
  });
}
