/**
 * Upload allowlist — pure, client-shareable. Enforced in three places:
 * the blob token route, the inbound email webhook, and registration.
 * HEIC is deliberately absent: iOS transcodes to JPEG for web uploads;
 * anything that slips through gets a pointed error, not a mystery.
 */
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

/** Types Claude vision can read (all of the allowlist, today). */
export const EXTRACTABLE_MIME_TYPES = ALLOWED_MIME_TYPES;

export function isAllowedUpload(mimeType: string, sizeBytes: number): boolean {
  return (
    (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType) &&
    sizeBytes > 0 &&
    sizeBytes <= MAX_FILE_BYTES
  );
}

export function isExtractableMime(mimeType: string): boolean {
  return (EXTRACTABLE_MIME_TYPES as readonly string[]).includes(mimeType);
}

/** For <input accept=…> — advisory only; the server allowlist decides. */
export const UPLOAD_ACCEPT_ATTR = ".jpg,.jpeg,.png,.webp,.gif,.pdf,image/jpeg,image/png,image/webp,image/gif,application/pdf";
