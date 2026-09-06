import "server-only";
import { put } from "@vercel/blob";
import { schema, withTenant, type Tx } from "@/db";
import { and, eq } from "drizzle-orm";
import { blobToken, sitePhotoPathPrefix } from "@/lib/blob";
import type { ResolvedBrand } from "@/lib/brand/core";
import { loadSharp } from "@/lib/vision-image";
import type { StarterScene } from "@/lib/site-templates/types";
import { STARTER_HEIGHT, STARTER_WIDTH, starterSceneSvg } from "@/lib/sites/starters";
import { insertSiteImage } from "./image-ops";
import type { MarketingCtx } from "./kit-ops";
import type { StoredPhoto } from "./photo-ingest";

/**
 * The starter pictures a template asks for, made for one site (slice 15):
 * each scene drawn in the brand's colours, rasterised to a JPEG the size
 * the photo pipeline keeps, put in the tenant's photo namespace with a
 * name that says which scene it is, and given a library row like any
 * upload. The owner replaces one from the editor in a click; the site is
 * never asked to hold a stock photo.
 *
 * Network first, rows second, like every photo: the puts happen outside
 * any transaction, and a row is written only for bytes that are there.
 * A scene already in the library (by its name) is reused rather than made
 * again, which is what a rewrite of the words relies on.
 */
const PREFIX = "starter-";

function starterName(scene: StarterScene): string {
  return `${PREFIX}${scene}`;
}

/** Which scenes this site already holds, by the name its pathname carries. */
async function existingStarters(tx: Tx, tenantId: string, siteId: string, scenes: StarterScene[]): Promise<Partial<Record<StarterScene, string>>> {
  const rows = await tx.query.siteImages.findMany({
    where: and(eq(schema.siteImages.tenantId, tenantId), eq(schema.siteImages.siteId, siteId)),
    columns: { id: true, pathname: true },
  });
  const found: Partial<Record<StarterScene, string>> = {};
  for (const scene of scenes) {
    const marker = `/${starterName(scene)}`;
    const row = rows.find((r) => r.pathname.includes(marker));
    if (row) found[scene] = row.id;
  }
  return found;
}

async function drawStarter(scene: StarterScene, brand: ResolvedBrand): Promise<Omit<StoredPhoto, "pathname">> {
  const sharp = (await loadSharp()).default;
  const svg = starterSceneSvg(scene, { primary: brand.primaryColor ?? "#1f2937", accent: brand.accentColor ?? brand.primaryColor ?? "#1f2937" });
  const { data, info } = await sharp(Buffer.from(svg), { density: 96 })
    .resize({ width: STARTER_WIDTH, height: STARTER_HEIGHT, fit: "fill" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { bytes: new Uint8Array(data), mimeType: "image/jpeg", width: info.width, height: info.height };
}

/**
 * The ids of the scenes asked for, made where missing. Never throws for a
 * picture: a scene that cannot be drawn or stored is left out, logged, and
 * the site is built without it, because a picture is decoration.
 */
export async function ensureStarterPictures(
  ctx: MarketingCtx,
  siteId: string,
  brand: ResolvedBrand,
  scenes: StarterScene[],
): Promise<Partial<Record<StarterScene, string>>> {
  if (scenes.length === 0) return {};
  const have = await withTenant(ctx.tenantId, (tx) => existingStarters(tx, ctx.tenantId, siteId, scenes), { role: ctx.role });
  const ids: Partial<Record<StarterScene, string>> = { ...have };
  for (const scene of scenes) {
    if (ids[scene]) continue;
    try {
      const drawn = await drawStarter(scene, brand);
      const stored = await put(`${sitePhotoPathPrefix(ctx.tenantId)}${starterName(scene)}.jpg`, Buffer.from(drawn.bytes), {
        access: "private",
        token: blobToken(),
        addRandomSuffix: true,
        contentType: drawn.mimeType,
      });
      const row = await withTenant(
        ctx.tenantId,
        (tx) => insertSiteImage(tx, ctx, siteId, { ...drawn, pathname: stored.pathname }),
        { role: ctx.role },
      );
      ids[scene] = row.id;
    } catch (err) {
      console.error(`starter picture ${scene} failed`, err instanceof Error ? err.message : err);
    }
  }
  return ids;
}
