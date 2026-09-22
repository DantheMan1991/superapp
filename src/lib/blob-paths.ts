/**
 * Blob pathnames that BOTH sides need.
 *
 * `blob.ts` is `server-only` — it holds the read-write token — and the
 * browser has to build a pathname before it can ask for a presigned URL to
 * write to. So the pure naming lives here, with no secret and no SDK, and
 * `blob.ts` re-exports it so there is still one place a prefix is written
 * down. A second copy in a client file is how a prefix quietly drifts from
 * the door that validates it.
 */

/** A picture of one page of a drawing set (jobs, ADR 0072). */
export function sheetThumbPathPrefix(tenantId: string): string {
  return `jobs/${tenantId}/sheet-thumbs/`;
}

/**
 * The one pathname a page's picture can live at. **Keyed by the page, not by
 * the sheet**: a thumbnail is a picture of page 12 of a file, while which
 * sheet number that page is called is the office's decision and can be
 * corrected on a re-read. It also means the picture can be stored before the
 * sheet row exists, and that re-indexing overwrites rather than orphans.
 */
export function sheetThumbPath(tenantId: string, documentId: string, pageNumber: number): string {
  return `${sheetThumbPathPrefix(tenantId)}${documentId}/${pageNumber}.jpg`;
}
