/**
 * What the Documents module accepts, and how it is allowed to be served.
 *
 * Pure and dependency-free so the client can pre-check a file before starting
 * an upload and the server can re-check the blob's REAL metadata afterwards.
 * The module owns its own copy rather than importing the accounting one: a
 * filing cabinet takes Office files and drawings, a receipt inbox does not,
 * and the DMS must work for a tenant that never enabled accounting.
 */

/**
 * Notably absent: text/html, image/svg+xml, application/xhtml+xml.
 *
 * Serving those inline from our own origin is stored XSS against the whole
 * dashboard session — Clerk's cookie is HttpOnly, but injected script can still
 * make same-origin authenticated calls to every server action. SVG is the
 * classic bypass precisely because it looks like an image. They are refused at
 * upload, not merely served as attachments, so they can never be in the store
 * to be mis-served later.
 */
export const ALLOWED_MIME_TYPES = [
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/tiff",
  // Documents
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  // Office
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Archives
  "application/zip",
  /**
   * A whole email message, as filed by the mail seam (and uploadable by hand,
   * which is the same artifact arriving by a different route).
   *
   * Safe for the same reason `application/zip` is: it is NOT in INLINE_SAFE, so
   * it can only ever be served as `attachment` + `nosniff`, which no browser
   * renders. The bytes are inert until a mail client opens them, and a mail
   * client applies its own rules.
   *
   * It earns its place because it is the only lossless snapshot of a message.
   * Filing a rendering of an email and calling it the record would be a
   * comfortable lie — a dispute about what somebody agreed to is settled by the
   * message, not by our HTML-to-text pass over it. The readable version lives
   * alongside, in `documents.extracted_text`, where search can reach it.
   */
  "message/rfc822",
] as const;

/** 100MB — a set of drawings is not a phone photo. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

const ALLOWED = new Set<string>(ALLOWED_MIME_TYPES);

/**
 * Only these may be rendered in the browser. Everything else is forced to
 * download, so a type we accept but do not fully trust can never execute in
 * our origin.
 */
const INLINE_SAFE = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "text/plain",
]);

export function isAllowedUpload(mimeType: string, sizeBytes: number): boolean {
  if (!ALLOWED.has(mimeType)) return false;
  if (!Number.isFinite(sizeBytes)) return false;
  return sizeBytes > 0 && sizeBytes <= MAX_FILE_BYTES;
}

export function dispositionFor(mimeType: string): "inline" | "attachment" {
  return INLINE_SAFE.has(mimeType) ? "inline" : "attachment";
}

/** The accept attribute for the file input — a hint, never the enforcement. */
export const UPLOAD_ACCEPT_ATTR = ALLOWED_MIME_TYPES.join(",");

/**
 * Moved to `src/lib/file-headers.ts` so the mail module can use it too —
 * `src/modules/email/` may not import from `src/modules/documents/`. Re-exported
 * here because this is where the DMS has always looked for it.
 */
export { sanitizeFileName } from "@/lib/file-headers";
