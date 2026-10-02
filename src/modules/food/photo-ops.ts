import "server-only";
import { del, put } from "@vercel/blob";
import { blobToken, foodPhotoPathPrefix } from "@/lib/blob";
import { streamBlobResponse } from "@/lib/blob-stream";
import { isSvg } from "@/lib/brand/image-sniff";
import { fetchRemoteImage } from "@/lib/net/fetch-image";
import { PhotoError, preparePhoto, type PreparedPhoto } from "@/lib/sites/photo";
import { FoodError } from "./core/errors";

/**
 * A RECIPE'S PHOTO (D1, docs/modules/food.md).
 *
 * One derivative is kept per recipe, made by `preparePhoto` (ADR 0023's
 * rule): a JPEG, its long edge at most 1,600 px, its orientation baked in and
 * every tag a camera wrote (where, when, which phone) dropped. It comes from
 * the person's phone, already made smaller there and sent with Save, or from
 * the recipe page's own photo, fetched through the same guarded door the mail
 * image proxy uses. Either way it is written only by the server, under
 * `food/<tenant>/photos/`, and served only through the recipe's own route.
 *
 * A photo of a cookbook page is NOT this: it is read by Claude and never kept.
 */

export interface StoredPhoto {
  pathname: string;
  width: number;
  height: number;
}

/** Keep a photo: prepared, then stored. Throws `FoodError` with a sentence for the person. */
export async function storeRecipePhoto(tenantId: string, bytes: Uint8Array): Promise<StoredPhoto> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new FoodError("STORAGE", "blob token not set");
  if (isSvg(bytes)) throw new FoodError("PHOTO", "svg is not a photo");
  let prepared: PreparedPhoto;
  try {
    prepared = await preparePhoto(bytes);
  } catch (err) {
    if (err instanceof Error && /sharp could not load/.test(err.message)) {
      console.error("food photo processing unavailable", err);
      throw new FoodError("STORAGE", err.message);
    }
    throw new FoodError("PHOTO", err instanceof PhotoError ? err.message : "not readable as a photo");
  }
  const extension = prepared.mimeType === "image/png" ? "png" : "jpg";
  const stored = await put(`${foodPhotoPathPrefix(tenantId)}recipe.${extension}`, Buffer.from(prepared.bytes), {
    access: "private",
    token: blobToken(),
    addRandomSuffix: true,
    contentType: prepared.mimeType,
  });
  return { pathname: stored.pathname, width: prepared.width, height: prepared.height };
}

/**
 * The recipe page's own photo, kept for the draft. A page whose photo cannot
 * be fetched or read still gives its recipe: the photo is a nicety, so this
 * answers null rather than failing the read.
 */
export async function storePagePhoto(tenantId: string, url: string | null): Promise<StoredPhoto | null> {
  if (!url || !process.env.BLOB_READ_WRITE_TOKEN) return null;
  const fetched = await fetchRemoteImage(url);
  if (!fetched.ok) {
    console.error("food page photo not fetched", fetched.reason);
    return null;
  }
  try {
    return await storeRecipePhoto(tenantId, new Uint8Array(fetched.body));
  } catch (err) {
    console.error("food page photo not kept", err);
    return null;
  }
}

export async function discardPhoto(pathname: string | null | undefined): Promise<void> {
  if (!pathname) return;
  try {
    await del(pathname, { token: blobToken() });
  } catch (err) {
    console.error("food photo delete failed", err);
  }
}

/**
 * The photo to the browser. The caller has already read the row it belongs
 * to under RLS, which is the authorization; the URL carries a version (`?v=`)
 * that changes with the photo, so the browser may keep it for a long time.
 */
export function photoResponse(pathname: string, ifNoneMatch: string | null): Promise<Response | null> {
  return streamBlobResponse({
    pathname,
    mimeType: pathname.endsWith(".png") ? "image/png" : "image/jpeg",
    fileName: pathname.endsWith(".png") ? "recipe.png" : "recipe.jpg",
    disposition: "inline",
    ...(ifNoneMatch ? { ifNoneMatch } : {}),
    cacheControl: "private, max-age=31536000, immutable",
  });
}

/** A short version for a photo's URL, from its pathname: a new photo is a new URL. */
export function photoVersion(pathname: string): string {
  let hash = 0;
  for (let i = 0; i < pathname.length; i += 1) hash = (hash * 31 + pathname.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}
