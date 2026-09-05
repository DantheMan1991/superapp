import "server-only";
import { del, get, head, put } from "@vercel/blob";
import { blobToken, isTenantBlobPath, sitePhotoPathPrefix } from "@/lib/blob";
import { isSvg } from "@/lib/brand/image-sniff";
import { PHOTO_MAX_BYTES, PhotoError, preparePhoto, type PreparedPhoto } from "@/lib/sites/photo";
import { MarketingError } from "./core/errors";

/**
 * Turning an uploaded blob into a photo the site's library will vouch for.
 *
 * The same shape as the logo's `inspectUploadedLogo`: blob work OUTSIDE any
 * transaction, then the row inside the caller's `withTenant`; and the same
 * trust rule — the presigned token restricted the declared type and size,
 * but registration is a separate request and re-checks everything against
 * the blob's REAL bytes, because the client can declare anything.
 *
 * **THE UPLOAD IS NEVER KEPT.** `preparePhoto` makes the one derivative the
 * site serves (ADR 0023), that is stored, and the upload is deleted in the
 * same breath — so the store never holds an SVG (refused outright, the
 * stored-XSS rule), a decompression bomb, or a file with its metadata
 * intact.
 */
export interface StoredPhoto extends PreparedPhoto {
  pathname: string;
}

async function readBlob(pathname: string): Promise<Uint8Array | null> {
  try {
    const result = await get(pathname, { access: "private", token: blobToken() });
    if (!result || result.statusCode !== 200) return null;
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  } catch (err) {
    console.error("site photo read failed", err);
    return null;
  }
}

export async function inspectUploadedPhoto(
  tenantId: string,
  pathname: string,
): Promise<StoredPhoto> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new MarketingError("STORAGE_UNAVAILABLE", "blob token not set");
  }
  if (
    !pathname.startsWith(sitePhotoPathPrefix(tenantId)) ||
    !isTenantBlobPath(tenantId, pathname)
  ) {
    throw new MarketingError("INVALID_INPUT", "pathname outside tenant namespace");
  }
  let size: number;
  try {
    size = (await head(pathname, { token: blobToken() })).size;
  } catch {
    throw new MarketingError("PHOTO_MISSING", `blob missing: ${pathname}`);
  }
  if (size > PHOTO_MAX_BYTES) {
    await discardPhotoBlob(pathname);
    throw new MarketingError("PHOTO_TOO_LARGE", `size=${size}`);
  }
  const bytes = await readBlob(pathname);
  if (!bytes) throw new MarketingError("PHOTO_MISSING", `unreadable: ${pathname}`);

  if (isSvg(bytes)) {
    await discardPhotoBlob(pathname);
    throw new MarketingError("PHOTO_NOT_A_PHOTO", "svg is not a photo");
  }

  let prepared: PreparedPhoto;
  try {
    prepared = await preparePhoto(bytes);
  } catch (err) {
    await discardPhotoBlob(pathname);
    if (err instanceof Error && /sharp could not load/.test(err.message)) {
      console.error("photo processing unavailable", err);
      throw new MarketingError("IMAGE_UNAVAILABLE", err.message);
    }
    throw new MarketingError(
      "PHOTO_NOT_A_PHOTO",
      err instanceof PhotoError ? err.message : "could not be read as a photo",
    );
  }

  const base = pathname
    .slice(pathname.lastIndexOf("/") + 1)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .slice(0, 60) || "photo";
  const extension = prepared.mimeType === "image/png" ? "png" : "jpg";
  const stored = await put(
    `${sitePhotoPathPrefix(tenantId)}${base}.${extension}`,
    Buffer.from(prepared.bytes),
    {
      access: "private",
      token: blobToken(),
      addRandomSuffix: true,
      contentType: prepared.mimeType,
    },
  );
  // The upload's job is done; the store must never hold it.
  await discardPhotoBlob(pathname);
  return { ...prepared, pathname: stored.pathname };
}

export async function discardPhotoBlob(pathname: string | null): Promise<void> {
  if (!pathname) return;
  try {
    await del(pathname, { token: blobToken() });
  } catch (err) {
    console.error("site photo delete failed", err);
  }
}
