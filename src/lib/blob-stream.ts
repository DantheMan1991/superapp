import "server-only";
import { get } from "@vercel/blob";
import { blobToken } from "./blob";
import { fileResponseHeaders } from "./file-headers";

/**
 * The single way a stored BLOB reaches a browser.
 *
 * Every blob-backed file route — the accounting one, the Documents one, and the
 * public share routes — goes through here, so the security headers cannot drift
 * apart between them.
 *
 * The header block itself now lives in file-headers.ts, because mail
 * attachments arrive over JMAP rather than from Vercel Blob and so cannot use
 * this function — and re-deriving the list in a second file is precisely the
 * drift this comment has always warned about. One list, two body sources.
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
    headers: fileResponseHeaders({
      mimeType: input.mimeType || result.blob.contentType,
      fileName: input.fileName,
      disposition: input.disposition,
      etag: result.blob.etag,
    }),
  });
}
