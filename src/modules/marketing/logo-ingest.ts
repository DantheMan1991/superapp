import "server-only";
import { del, head } from "@vercel/blob";
import { blobToken, brandPathPrefix, isTenantBlobPath } from "@/lib/blob";
import { BRAND_LOGO_MAX_BYTES } from "@/lib/brand/core";
import { sniffImage } from "@/lib/brand/image-sniff";
import { loadLogoBytes } from "@/lib/brand/read";
import { MarketingError } from "./core/errors";
import type { KitLogo } from "./kit-ops";

/**
 * Turning an uploaded blob into a logo the kit will vouch for.
 *
 * Same shape as Documents' `inspectUploadedBlob`: blob work OUTSIDE any
 * transaction (network calls never hold one open), then the row inside the
 * caller's `withTenant`. And the same trust rule — the presigned token
 * restricted the declared type and size, but registration is a separate
 * request and re-checks everything against the blob's REAL bytes, because the
 * client can declare anything.
 */
export async function inspectUploadedLogo(
  tenantId: string,
  pathname: string,
): Promise<KitLogo> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new MarketingError("STORAGE_UNAVAILABLE", "blob token not set");
  }
  if (
    !pathname.startsWith(brandPathPrefix(tenantId)) ||
    !isTenantBlobPath(tenantId, pathname)
  ) {
    throw new MarketingError(
      "INVALID_INPUT",
      "pathname outside tenant namespace",
    );
  }
  let size: number;
  try {
    size = (await head(pathname, { token: blobToken() })).size;
  } catch {
    throw new MarketingError("LOGO_MISSING", `blob missing: ${pathname}`);
  }
  if (size > BRAND_LOGO_MAX_BYTES) {
    throw new MarketingError("LOGO_TOO_LARGE", `size=${size}`);
  }
  const bytes = await loadLogoBytes(pathname);
  if (!bytes) throw new MarketingError("LOGO_MISSING", `unreadable: ${pathname}`);
  // The type is what the bytes say, never what the upload was labelled.
  const image = sniffImage(bytes);
  if (!image) {
    throw new MarketingError("LOGO_NOT_AN_IMAGE", "not a PNG or JPEG");
  }
  return {
    pathname,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    bytes: size,
  };
}

/**
 * Best effort, and only ever AFTER the row that pointed at the blob has
 * committed (or was never written). A blob nobody references is waste, not a
 * fault; a row referencing a blob that was deleted first would be the fault.
 */
export async function discardLogoBlob(pathname: string | null): Promise<void> {
  if (!pathname) return;
  try {
    await del(pathname, { token: blobToken() });
  } catch (err) {
    console.error("brand logo delete failed", err);
  }
}
