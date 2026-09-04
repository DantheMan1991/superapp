import "server-only";
import { loadSharp } from "@/lib/vision-image";

/**
 * SVG → PNG for the logo, the one place `sharp` touches the brand kit.
 *
 * Two callers: a generated wordmark (our own SVG, paths only) and an uploaded
 * SVG (somebody else's, never kept — see logo-ingest.ts). The PNG is what the
 * PDF renderer draws and what the store holds; 1200px wide is plenty for a
 * 160pt box at print resolution and small enough to fetch on every invoice.
 *
 * `sharp` is loaded lazily through `loadSharp` for the reason written on it:
 * a native library that fails to load must break IMAGE PROCESSING, not the
 * Marketing screen. The route this runs under is traced in next.config.ts.
 */
export const LOGO_RASTER_WIDTH = 1200;

/** Pixels an uploaded SVG may ask to render. A logo is not a poster. */
const MAX_INPUT_PIXELS = 4096 * 4096;

export interface RasterizedLogo {
  png: Uint8Array;
  width: number;
  height: number;
}

export async function rasterizeSvgToPng(svg: Uint8Array | string): Promise<RasterizedLogo> {
  const sharp = (await loadSharp()).default;
  const input = typeof svg === "string" ? Buffer.from(svg) : Buffer.from(svg);
  // A density high enough that librsvg draws the vector at (at least) the
  // output size rather than upscaling a 72dpi render of a small viewBox.
  const { data, info } = await sharp(input, {
    density: 300,
    limitInputPixels: MAX_INPUT_PIXELS,
  })
    .resize({ width: LOGO_RASTER_WIDTH, fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { png: new Uint8Array(data), width: info.width, height: info.height };
}
