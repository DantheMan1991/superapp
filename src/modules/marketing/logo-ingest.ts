import "server-only";
import { del, head, put } from "@vercel/blob";
import { blobToken, brandPathPrefix, isTenantBlobPath } from "@/lib/blob";
import { BRAND_LOGO_MAX_BYTES } from "@/lib/brand/core";
import { isSvg, sniffImage } from "@/lib/brand/image-sniff";
import { rasterizeSvgToPng } from "@/lib/brand/raster";
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
 *
 * **AN SVG IS ACCEPTED AT THE DOOR AND NEVER KEPT.** It is rasterised to a
 * PNG here, the PNG is stored, and the SVG blob is deleted in the same breath
 * — so nothing in the store can ever be served as markup, which is the
 * stored-XSS rule the Documents allowlist spells out. The price is that a
 * designer's vector is not preserved; the website slice will want a
 * sanitiser if that ever matters more than the rule.
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

  if (isSvg(bytes)) {
    const raster = await rasterizeOrExplain(bytes);
    const base = pathname
      .slice(pathname.lastIndexOf("/") + 1)
      .replace(/\.svg$/i, "");
    const stored = await putLogoPng(tenantId, raster.png, base);
    // The vector's job is done; the store must never hold it.
    await discardLogoBlob(pathname);
    return {
      pathname: stored.pathname,
      mimeType: "image/png",
      width: raster.width,
      height: raster.height,
      bytes: stored.bytes,
      source: "upload",
      spec: {},
    };
  }

  // The type is what the bytes say, never what the upload was labelled.
  const image = sniffImage(bytes);
  if (!image) {
    throw new MarketingError("LOGO_NOT_AN_IMAGE", "not a PNG, JPEG or SVG");
  }
  return {
    pathname,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    bytes: size,
    source: "upload",
    spec: {},
  };
}

/**
 * A failure to rasterise is one of two very different things, and the owner
 * should be told which: the file is not a drawable SVG (their problem, try
 * another file), or libvips could not load on this deployment (ours, and
 * uploading a PNG sidesteps it).
 */
export async function rasterizeOrExplain(svg: Uint8Array | string) {
  try {
    return await rasterizeSvgToPng(svg);
  } catch (err) {
    if (err instanceof Error && /sharp could not load/.test(err.message)) {
      console.error("logo rasterisation unavailable", err);
      throw new MarketingError("IMAGE_UNAVAILABLE", err.message);
    }
    throw new MarketingError(
      "LOGO_NOT_AN_IMAGE",
      err instanceof Error ? err.message : "svg did not rasterise",
    );
  }
}

/** A PNG the server produced, into the tenant's brand namespace. */
export async function putLogoPng(
  tenantId: string,
  png: Uint8Array,
  baseName: string,
): Promise<{ pathname: string; bytes: number }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new MarketingError("STORAGE_UNAVAILABLE", "blob token not set");
  }
  const safe = baseName.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 60) || "logo";
  const result = await put(`${brandPathPrefix(tenantId)}${safe}.png`, Buffer.from(png), {
    access: "private",
    token: blobToken(),
    addRandomSuffix: true,
    contentType: "image/png",
  });
  return { pathname: result.pathname, bytes: png.byteLength };
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
