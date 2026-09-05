import "server-only";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { foregroundOn, type HexColor } from "@/lib/brand/core";
import { initialsFor, normalizeSpec } from "@/lib/brand/logo-spec";
import { renderLogoSvg } from "@/lib/brand/logo-svg";
import { rasterizeSvgToPng } from "@/lib/brand/raster";
import { loadLogoBytes, resolveBrandFor } from "@/lib/brand/read";
import type { SiteHit } from "./read";
import { hash32, iconSizeFrom, type IconSize } from "./seo";

/**
 * The site's icon — the tab, the home screen, the install — from the brand
 * kit (slice 11). A logo that is roughly square is used as it is, fitted on
 * white; a wide wordmark squeezed into a tab is a smudge, so anything else
 * gets a MONOGRAM: the business's initials on a rounded square in the
 * brand colour, drawn by the kit's own logo machinery (`renderLogoSvg`),
 * which is what a business with no logo at all gets too. Public for a
 * published site, cached like a photo, and named by what it was made from
 * so a new logo or colour is a new picture.
 */
const CACHE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";

function nearSquare(width: number, height: number): boolean {
  return width > 0 && height > 0 && width / height >= 0.8 && width / height <= 1.25;
}

async function fromLogo(bytes: Uint8Array, size: IconSize): Promise<Buffer> {
  return sharp(Buffer.from(bytes))
    .resize(size, size, { fit: "contain", background: "#ffffff" })
    .png()
    .toBuffer();
}

/** The initials on a rounded square in the brand colour, at `size` px, on nothing: the icon, and the share image's corner. */
export async function monogramPng(title: string, primary: HexColor, size: number): Promise<Buffer> {
  const spec = normalizeSpec({
    layout: "monogram",
    line1: title,
    line2: "",
    initials: initialsFor(title).slice(0, 2),
    weight: "bold",
    textCase: "upper",
    tracking: 0.02,
    mark: "rounded",
    colors: { text: primary, mark: primary, markText: foregroundOn(primary) },
    rationale: "",
  });
  const { png } = await rasterizeSvgToPng(renderLogoSvg(spec).svg);
  return sharp(Buffer.from(png))
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

export async function siteIconResponse(
  hit: SiteHit | null,
  sizeParam: string,
  ifNoneMatch: string | null,
): Promise<Response> {
  const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });
  const size = iconSizeFrom(sizeParam);
  if (!hit || hit.status !== "published" || !size) return notFound();
  const found = await withTenant(hit.tenantId, async (tx) => {
    const site = await tx.query.sites.findFirst({
      where: and(eq(schema.sites.tenantId, hit.tenantId), eq(schema.sites.id, hit.id)),
      columns: { title: true, status: true },
    });
    if (!site || site.status !== "published") return null;
    const brand = await resolveBrandFor(tx, hit.tenantId, null);
    return { brand, title: site.title || brand.displayName };
  });
  if (!found) return notFound();
  const { brand, title } = found;
  const primary: HexColor = brand.primaryColor ?? "#1f2937";
  const etag = `"${hash32(`${brand.logo?.pathname ?? ""}|${primary}|${title}|${size}`)}"`;
  if (ifNoneMatch === etag) return new Response(null, { status: 304 });

  let png: Buffer | null = null;
  if (brand.logo && nearSquare(brand.logo.width, brand.logo.height)) {
    const bytes = await loadLogoBytes(brand.logo.pathname);
    if (bytes) png = await fromLogo(bytes, size);
  }
  png ??= await monogramPng(title, primary, size);
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(png.length),
      "Cache-Control": CACHE,
      ETag: etag,
    },
  });
}
