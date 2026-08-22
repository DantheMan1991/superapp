import "server-only";

/**
 * Vision payload normalization. The Claude API caps images at 5MB and
 * ~1600px is where its accuracy plateaus; oversized uploads (phone
 * photos) are downscaled to a JPEG before the call — ~3x token savings,
 * no visible extraction quality loss. PDFs pass through untouched.
 *
 * **`sharp` IS IMPORTED LAZILY, AND THAT IS A PRODUCTION INCIDENT WRITTEN
 * DOWN.** It was a top-level `import sharp from "sharp"`, and `extract.ts`
 * imports this file, and `payables/actions.ts` reaches `extract.ts` — so when
 * sharp failed to load its native library on Vercel, **every server action in
 * the payables module died with it**. Approving a bill returned a 500 whose
 * only clue was a digest:
 *
 * > Could not load the "sharp" module using the linux-x64 runtime
 * > ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.3: cannot open shared object file
 *
 * A native optional dependency that may not load is not something to put on the
 * static import graph of a module people need for accounting. Loaded here, a
 * missing libvips breaks IMAGE NORMALISATION — which is what it actually
 * affects — and nothing else.
 *
 * **The install is still wrong and this does not fix it.** It makes the blast
 * radius honest. See the dossier for the deployment side.
 */

type SharpModule = typeof import("sharp");
let sharpPromise: Promise<SharpModule> | null = null;

/**
 * Cached so a page that normalises several images pays the load once.
 *
 * **THE CATCH IS THE POINT.** When this broke in production the only thing a
 * person could see was `digest: '508730998'` — the real message lived in a
 * Vercel log nobody was reading, and finding it took a deliberate hunt. A
 * native library that fails to load is an infrastructure fault, not a bad
 * upload, and the error should say which so the next person starts in the right
 * place.
 */
function loadSharp(): Promise<SharpModule> {
  sharpPromise ??= import("sharp").catch((cause) => {
    // Do not cache the failure: a redeploy that fixes the install should not
    // need a cold start to be believed.
    sharpPromise = null;
    throw new Error(
      "Image processing is unavailable on this deployment: sharp could not load its native library. " +
        "This is a build/deploy problem, not a problem with the file — see next.config.ts " +
        "`SHARP_NATIVE` and docs/modules/accounting.md.",
      { cause },
    );
  });
  return sharpPromise;
}

export const VISION_MAX_BYTES = 4 * 1024 * 1024; // headroom under the 5MB API cap
export const VISION_MAX_EDGE_PX = 2576;

export async function normalizeImageForVision(
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (mimeType === "application/pdf") return { bytes, mimeType };

  const { default: sharp } = await loadSharp();
  const image = sharp(Buffer.from(bytes), { animated: false });
  const meta = await image.metadata();
  const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  const oversized = bytes.byteLength > VISION_MAX_BYTES || longEdge > VISION_MAX_EDGE_PX;
  if (!oversized) return { bytes, mimeType };

  const out = await image
    .rotate() // honor EXIF orientation before it's stripped
    .resize({
      width: VISION_MAX_EDGE_PX,
      height: VISION_MAX_EDGE_PX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { bytes: new Uint8Array(out), mimeType: "image/jpeg" };
}
