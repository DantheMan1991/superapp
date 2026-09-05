import "server-only";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { foregroundOn, type HexColor } from "@/lib/brand/core";
import { textPaths } from "@/lib/brand/logo-svg";
import { loadLogoBytes } from "@/lib/brand/read";
import { monogramPng } from "./icon";
import { PUBLIC_IMAGE_CACHE } from "./images";
import { loadPublishedSite, loadPublishedSiteByDomain, type PublicSite } from "./read";
import { shareFacts, shareKey, siteBaseUrlFor, type ShareFacts } from "./seo";

/**
 * The share image — what a link to a page shows when it is pasted into a
 * message or a feed (slice 11b): the page's title in the kit's type on the
 * brand colour, the site's name or tagline under it, the address in the
 * corner, and the logo (or the monogram) in a white panel. Drawn on the
 * server from paths and the logo's own pixels, so no font is needed at
 * raster time; a published site only; cached like a photo under a name
 * made from its ingredients, so a retitled page is a new picture.
 */
export const SHARE_WIDTH = 1200;
export const SHARE_HEIGHT = 630;
const PAD = 80;
const PANEL = { x: PAD, y: 72, width: 272, height: 122, inset: 16 };

function fitted(text: string, weight: "regular" | "bold", size: number, colour: string, x: number, y: number, maxWidth: number) {
  const probe = textPaths(text, { weight, size, color: colour, x, y });
  if (probe.width <= maxWidth || probe.width === 0) return probe;
  const shrunk = Math.max(34, Math.floor((size * maxWidth) / probe.width));
  return textPaths(text, { weight, size: shrunk, color: colour, x, y });
}

/** The words as one SVG document, ready to rasterise; the panel is drawn here and filled after. */
function shareSvg(facts: ShareFacts, hasMark: boolean): string {
  const fg = foregroundOn(facts.colour as HexColor);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_WIDTH}" height="${SHARE_HEIGHT}" viewBox="0 0 ${SHARE_WIDTH} ${SHARE_HEIGHT}">`,
    `<rect width="${SHARE_WIDTH}" height="${SHARE_HEIGHT}" fill="${facts.colour}"/>`,
  ];
  if (hasMark) {
    parts.push(
      `<rect x="${PANEL.x}" y="${PANEL.y}" width="${PANEL.width}" height="${PANEL.height}" rx="20" fill="#ffffff"/>`,
    );
  }
  const title = fitted(facts.title, "bold", 72, fg, PAD, 268, SHARE_WIDTH - PAD * 2);
  parts.push(title.svg);
  if (facts.subtitle) {
    const subtitle = fitted(facts.subtitle, "regular", 36, fg, PAD, 268 + title.height + 28, SHARE_WIDTH - PAD * 2);
    parts.push(`<g opacity="0.85">${subtitle.svg}</g>`);
  }
  const host = fitted(facts.host, "regular", 28, fg, PAD, SHARE_HEIGHT - PAD - 28, SHARE_WIDTH - PAD * 2);
  parts.push(`<g opacity="0.7">${host.svg}</g>`);
  parts.push("</svg>");
  return parts.join("");
}

/** The logo's pixels, or the monogram, fitted inside the white panel. */
async function markPng(facts: ShareFacts): Promise<{ png: Buffer; width: number; height: number } | null> {
  const boxWidth = PANEL.width - PANEL.inset * 2;
  const boxHeight = PANEL.height - PANEL.inset * 2;
  const bytes = facts.logoPathname ? await loadLogoBytes(facts.logoPathname) : null;
  const source = bytes ? Buffer.from(bytes) : await monogramPng(facts.title, facts.colour as HexColor, boxHeight);
  const { data, info } = await sharp(source)
    .resize(boxWidth, boxHeight, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { png: data, width: info.width, height: info.height };
}

export async function renderShareImage(facts: ShareFacts): Promise<Buffer> {
  const mark = await markPng(facts);
  const base = sharp(Buffer.from(shareSvg(facts, mark !== null)), { density: 144 }).resize(SHARE_WIDTH, SHARE_HEIGHT);
  if (!mark) return base.png().toBuffer();
  const left = PANEL.x + Math.round((PANEL.width - mark.width) / 2);
  const top = PANEL.y + Math.round((PANEL.height - mark.height) / 2);
  return base.composite([{ input: mark.png, left, top }]).png().toBuffer();
}

export type SiteSource = { by: "slug"; slug: string } | { by: "domain"; host: string };

function load(source: SiteSource): Promise<PublicSite | null> {
  return source.by === "slug" ? loadPublishedSite(source.slug) : loadPublishedSiteByDomain(source.host);
}

/** A published page's share image, found by its key among the site's pages; anything else is a 404. */
export async function siteShareResponse(source: SiteSource, key: string, ifNoneMatch: string | null): Promise<Response> {
  const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });
  if (!/^[0-9a-f]{8}$/.test(key)) return notFound();
  const site = await load(source);
  if (!site) return notFound();
  const mode = source.by === "domain" ? "host" : "path";
  const base = siteBaseUrlFor(site, mode, process.env);
  const facts = site.pages.map((page) => shareFacts(site, page, base)).find((f) => shareKey(f) === key);
  if (!facts) return notFound();
  if (ifNoneMatch === `"${key}"`) return new Response(null, { status: 304 });
  const png = await renderShareImage(facts);
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(png.length),
      "Cache-Control": PUBLIC_IMAGE_CACHE,
      ETag: `"${key}"`,
    },
  });
}
