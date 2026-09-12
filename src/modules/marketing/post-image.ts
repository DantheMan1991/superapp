import "server-only";
import { get } from "@vercel/blob";
import { blobToken } from "@/lib/blob";
import { cropBox, type PostShape } from "@/lib/social/posts";
import { loadSharp } from "@/lib/vision-image";
import { MarketingError } from "./core/errors";

/**
 * The picture a post actually carries: the library photo, cut to the post's
 * shape around its focus point (slice S1).
 *
 * **CUT ON THE WAY OUT, NEVER STORED.** ADR 0023 says one derivative per
 * photo and a replaced photo is a new row; a crop per post would be a second
 * blob whose life nothing owns — deleted when? replaced when the owner moves
 * the focus? — and the whole point of `cropBox` is that the crop is a pure
 * function of two numbers already on the row. So it is rendered on demand and
 * cached, and a post whose focus moves is simply a different URL response.
 *
 * The source is at most 1,600px on its long edge (`PHOTO_MAX_EDGE`), so this
 * is a small amount of work; sharp is already loaded in this process for the
 * logo and the photo pipeline.
 */

/** What a saved file is called when it reaches the owner's phone. */
export function postImageFileName(shape: PostShape): string {
  return `post-${shape}.jpg`;
}

async function readBlob(pathname: string): Promise<Uint8Array | null> {
  try {
    const result = await get(pathname, { access: "private", token: blobToken() });
    if (!result || result.statusCode !== 200) return null;
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  } catch (err) {
    console.error("post image read failed", err);
    return null;
  }
}

export interface RenderedPostImage {
  bytes: Uint8Array;
  mimeType: "image/jpeg";
  width: number;
  height: number;
}

/**
 * JPEG ALWAYS, even from a PNG source. What leaves here is going to a social
 * network, every one of which re-encodes to JPEG anyway, and a transparent
 * corner becomes black on most of them — so the alpha is flattened onto white
 * here, where it can be seen in the preview, rather than by Instagram where
 * it cannot.
 */
export async function renderPostImage(
  source: { pathname: string; width: number; height: number },
  shape: PostShape,
  focus: { x: number; y: number },
): Promise<RenderedPostImage> {
  const bytes = await readBlob(source.pathname);
  if (!bytes) throw new MarketingError("PHOTO_MISSING", `unreadable: ${source.pathname}`);
  const box = cropBox(source, shape, focus);
  let sharp;
  try {
    sharp = (await loadSharp()).default;
  } catch (err) {
    console.error("post image processing unavailable", err);
    throw new MarketingError("IMAGE_UNAVAILABLE", "sharp unavailable");
  }
  const { data, info } = await sharp(Buffer.from(bytes))
    // `extract` takes the box in the SOURCE's own pixels, which is what
    // `cropBox` returns and why its numbers are rounded and clamped there
    // rather than here.
    .extract(box)
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return {
    bytes: new Uint8Array(data),
    mimeType: "image/jpeg",
    width: info.width,
    height: info.height,
  };
}
