/**
 * The response headers every file we serve carries, and the rules for building
 * them.
 *
 * Extracted from blob-stream.ts, which says it best: "Adding a route must not
 * mean re-deriving this list." That helper serves Vercel blobs; mail
 * attachments come from a mail server over JMAP and cannot use it. Re-deriving
 * the header block in a second file is exactly the drift that comment forbids,
 * so the pure half lives here and both callers import it.
 *
 * Deliberately free of `server-only` and of any provider import, so it is
 * testable without a network — the same reasoning that keeps jmap/parse.ts and
 * migadu-parse.ts separate from the clients that use them.
 */

/**
 * Belt and braces against user-supplied content executing in our origin.
 *
 * `sandbox` with no allow-* tokens neuters scripting even when a browser
 * decides to render something inline, and `default-src 'none'` stops the
 * document reaching back out. This matters most for the types we do NOT accept
 * today — it means a future widening of the allowlist is not automatically a
 * stored-XSS hole.
 */
export const FILE_RESPONSE_CSP =
  "default-src 'none'; sandbox; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export type Disposition = "inline" | "attachment";

/**
 * Strip anything that must not reach a Content-Disposition header. Control
 * characters (CR/LF especially) are header injection; quotes break out of the
 * quoted-string form. Callers additionally emit an RFC 5987 filename* so
 * non-ASCII names survive.
 *
 * Lives here rather than in the Documents module because mail needs it too, and
 * `src/modules/email/` may not import from `src/modules/documents/` — the
 * isolation rule in docs/extension-model.md. A filename destined for a header
 * is a header concern, so this is its natural home anyway.
 *
 * NEVER rewrites the extension. `invoice.pdf.exe` must display as
 * `invoice.pdf.exe`; hiding the second extension is how a disguised executable
 * gets opened.
 */
export function sanitizeFileName(raw: string): string {
  let out = "";
  for (const char of raw) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) continue;
    if (char === '"' || char === "\\" || char === "/") continue;
    out += char;
  }
  out = out.trim().slice(0, 120);
  return out.length > 0 ? out : "download";
}

/** RFC 5987 — lets a non-ASCII filename survive without breaking the header. */
export function contentDisposition(
  disposition: Disposition,
  fileName: string,
): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(fileName);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export interface FileHeaderInput {
  mimeType: string;
  fileName: string;
  disposition: Disposition;
  etag?: string;
  /**
   * Defaults to `private, no-cache`: a revoked or re-filed document must never
   * be served from a shared cache. A caller may pass something longer ONLY for
   * content addressed by an immutable id — a mail blob id, for instance — and
   * even then it stays `private`.
   */
  cacheControl?: string;
}

export function fileResponseHeaders(
  input: FileHeaderInput,
): Record<string, string> {
  return {
    "Content-Type": input.mimeType || "application/octet-stream",
    "Content-Disposition": contentDisposition(input.disposition, input.fileName),
    "Content-Security-Policy": FILE_RESPONSE_CSP,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": input.cacheControl ?? "private, no-cache",
    "Referrer-Policy": "no-referrer",
    ...(input.etag ? { ETag: input.etag } : {}),
  };
}
