/**
 * Which of an inbound email's files are actually documents.
 *
 * Shared by the receipts inbox and Documents folder addresses — both receive
 * mail on the same domain and both face the same problem, so the heuristics
 * live in one place rather than being copied. Pure; the caller supplies its own
 * allowlist, so the two features can accept different file types.
 */

export const MAX_EMAIL_ATTACHMENTS = 10;

/** Floor for regular attachments (tracking pixels, stray icons). */
export const MIN_ATTACHMENT_BYTES = 8 * 1024;

/**
 * Floor for INLINE images considered as documents. Signature logos are
 * typically well under this; a pasted receipt photo is well over it.
 */
export const MIN_INLINE_IMAGE_BYTES = 100 * 1024;

export interface EmailAttachmentMeta {
  content_type: string;
  size: number;
  content_disposition?: string | null;
}

/**
 * Signature logos and tracking pixels arrive as INLINE images alongside the
 * real bill or drawing. The rules that separate them:
 *  - PDFs are always documents, inline or not.
 *  - Regular (disposition "attachment") files are documents.
 *  - Inline images count ONLY when the email has no regular document at all
 *    (a photo pasted into the body) AND they are large enough to plausibly be
 *    a photo rather than a logo.
 */
export function selectEmailAttachments<T extends EmailAttachmentMeta>(
  attachments: readonly T[],
  isAllowed: (mimeType: string, sizeBytes: number) => boolean,
): T[] {
  const allowed = attachments.filter((a) => isAllowed(a.content_type, a.size));
  const isInlineImage = (a: EmailAttachmentMeta) =>
    a.content_disposition === "inline" && a.content_type !== "application/pdf";
  const regular = allowed.filter(
    (a) => !isInlineImage(a) && a.size >= MIN_ATTACHMENT_BYTES,
  );
  if (regular.length > 0) return regular.slice(0, MAX_EMAIL_ATTACHMENTS);
  return allowed
    .filter((a) => isInlineImage(a) && a.size >= MIN_INLINE_IMAGE_BYTES)
    .slice(0, MAX_EMAIL_ATTACHMENTS);
}
