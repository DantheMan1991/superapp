/**
 * Generates the placeholder artwork in `public/marketing/`.
 *
 * Why this exists rather than a checked-in grey box: the marketing pages use
 * next/image, which needs a real file at a real size. A missing file is a
 * broken image in production, and "we'll add the photo later" is how it stays
 * broken. So every image slot in `src/lib/site.ts` ships with a generated
 * stand-in at the exact dimensions the real asset should have.
 *
 * These are brand-coloured compositions, not "PLACEHOLDER" stamps, so the site
 * looks deliberate before any photography exists. Drop a real file at the same
 * path to replace one — no code change.
 *
 * Deliberately text-free: SVG text rasterization depends on system fonts, and
 * this needs to produce byte-identical output on a laptop and in CI.
 *
 *   npx tsx scripts/marketing-placeholders.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { IMAGES } from "../src/lib/site";

/** Brand palette, matching the design tokens in src/app/globals.css. */
const NAVY_DEEP = "#111a2e";
const NAVY = "#1e2a4a";
const NAVY_SOFT = "#2c3a63";
const TEAL = "#34b39b";
const MIST = "#eef1f5";

const OUT_DIR = join(process.cwd(), "public", "marketing");

/**
 * Hero: a stylized application window. Reads as a product shot at a glance,
 * which is what belongs in a hero, and survives being replaced by a real
 * screenshot at the same aspect ratio.
 */
function heroSvg(w: number, h: number): string {
  // Window inset inside the gradient field.
  const pad = Math.round(w * 0.07);
  const win = { x: pad, y: pad, w: w - pad * 2, h: h - pad * 2 };
  const chrome = Math.round(win.h * 0.075);
  const rail = Math.round(win.w * 0.22);
  const r = Math.round(w * 0.012);

  // Sidebar nav items.
  const navRows = Array.from({ length: 7 }, (_, i) => {
    const y = win.y + chrome + Math.round(win.h * 0.09) + i * Math.round(win.h * 0.085);
    const active = i === 1;
    return `<rect x="${win.x + Math.round(rail * 0.14)}" y="${y}" width="${Math.round(rail * 0.62)}" height="${Math.round(win.h * 0.032)}" rx="${Math.round(win.h * 0.016)}" fill="${active ? TEAL : "#8794b5"}" opacity="${active ? 0.95 : 0.4}"/>`;
  }).join("");

  // Content: three stat cards over a chart panel and a table.
  const contentX = win.x + rail + Math.round(win.w * 0.035);
  const contentW = win.w - rail - Math.round(win.w * 0.07);
  const cardW = Math.round((contentW - Math.round(win.w * 0.03) * 2) / 3);
  const cardY = win.y + chrome + Math.round(win.h * 0.08);
  const cardH = Math.round(win.h * 0.15);

  const cards = Array.from({ length: 3 }, (_, i) => {
    const x = contentX + i * (cardW + Math.round(win.w * 0.03));
    return `
      <rect x="${x}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${r}" fill="#ffffff" opacity="0.07"/>
      <rect x="${x + Math.round(cardW * 0.08)}" y="${cardY + Math.round(cardH * 0.22)}" width="${Math.round(cardW * 0.42)}" height="${Math.round(cardH * 0.12)}" rx="${Math.round(cardH * 0.06)}" fill="#8794b5" opacity="0.5"/>
      <rect x="${x + Math.round(cardW * 0.08)}" y="${cardY + Math.round(cardH * 0.48)}" width="${Math.round(cardW * 0.6)}" height="${Math.round(cardH * 0.2)}" rx="${Math.round(cardH * 0.1)}" fill="${i === 0 ? TEAL : "#ffffff"}" opacity="${i === 0 ? 0.9 : 0.75}"/>`;
  }).join("");

  // Bar chart panel.
  const chartY = cardY + cardH + Math.round(win.h * 0.05);
  const chartH = Math.round(win.h * 0.34);
  const chartW = Math.round(contentW * 0.58);
  const barCount = 9;
  const barGap = Math.round(chartW * 0.03);
  const barW = Math.round((chartW * 0.84 - barGap * (barCount - 1)) / barCount);
  const heights = [0.35, 0.52, 0.44, 0.68, 0.58, 0.79, 0.66, 0.88, 0.74];
  const bars = heights
    .map((frac, i) => {
      const bh = Math.round(chartH * 0.62 * frac);
      const x = contentX + Math.round(chartW * 0.08) + i * (barW + barGap);
      const y = chartY + chartH - Math.round(chartH * 0.16) - bh;
      return `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="${Math.round(barW * 0.25)}" fill="${TEAL}" opacity="${0.35 + frac * 0.55}"/>`;
    })
    .join("");

  // Table panel, filling the lower band so the window does not read as
  // half-empty at hero size.
  const tableY = chartY + chartH + Math.round(win.h * 0.05);
  const tableH = win.y + win.h - tableY - Math.round(win.h * 0.06);
  const colXs = [0.05, 0.36, 0.58, 0.78].map(
    (f) => contentX + Math.round(contentW * f),
  );
  const colWs = [0.24, 0.16, 0.14, 0.15].map((f) => Math.round(contentW * f));
  const rowCount = 4;
  const rowH = Math.round((tableH * 0.72) / rowCount);
  const tableRows = Array.from({ length: rowCount }, (_, row) => {
    const y = tableY + Math.round(tableH * 0.2) + row * rowH;
    return colXs
      .map((x, col) => {
        const isStatus = col === 3;
        const wCell = Math.round(colWs[col] * (isStatus ? 0.55 : 1 - row * 0.06));
        return `<rect x="${x}" y="${y}" width="${wCell}" height="${Math.round(rowH * 0.28)}" rx="${Math.round(rowH * 0.14)}" fill="${isStatus && row < 2 ? TEAL : "#ffffff"}" opacity="${isStatus && row < 2 ? 0.8 : 0.22}"/>`;
      })
      .join("");
  }).join("");

  const tableHead = colXs
    .map(
      (x, col) =>
        `<rect x="${x}" y="${tableY + Math.round(tableH * 0.08)}" width="${Math.round(colWs[col] * 0.6)}" height="${Math.round(tableH * 0.05)}" rx="${Math.round(tableH * 0.025)}" fill="#8794b5" opacity="0.5"/>`,
    )
    .join("");

  // Side list panel.
  const listX = contentX + chartW + Math.round(win.w * 0.03);
  const listW = contentW - chartW - Math.round(win.w * 0.03);
  const listRows = Array.from({ length: 5 }, (_, i) => {
    const y = chartY + Math.round(chartH * 0.14) + i * Math.round(chartH * 0.17);
    return `
      <circle cx="${listX + Math.round(listW * 0.12)}" cy="${y + Math.round(chartH * 0.05)}" r="${Math.round(chartH * 0.038)}" fill="${i < 2 ? TEAL : "#8794b5"}" opacity="${i < 2 ? 0.9 : 0.45}"/>
      <rect x="${listX + Math.round(listW * 0.24)}" y="${y + Math.round(chartH * 0.028)}" width="${Math.round(listW * (0.62 - i * 0.07))}" height="${Math.round(chartH * 0.045)}" rx="${Math.round(chartH * 0.022)}" fill="#ffffff" opacity="0.3"/>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="field" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${NAVY_DEEP}"/>
        <stop offset="55%" stop-color="${NAVY}"/>
        <stop offset="100%" stop-color="${NAVY_SOFT}"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.78" cy="0.15" r="0.72">
        <stop offset="0%" stop-color="${TEAL}" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="${TEAL}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#field)"/>
    <rect width="${w}" height="${h}" fill="url(#glow)"/>
    <rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" rx="${r * 1.6}" fill="#ffffff" opacity="0.05"/>
    <rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" rx="${r * 1.6}" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="${Math.max(2, Math.round(w * 0.0012))}"/>
    <rect x="${win.x}" y="${win.y}" width="${rail}" height="${win.h}" rx="${r * 1.6}" fill="${NAVY_DEEP}" opacity="0.55"/>
    <rect x="${win.x + rail - r * 1.6}" y="${win.y}" width="${r * 1.6}" height="${win.h}" fill="${NAVY_DEEP}" opacity="0.55"/>
    <circle cx="${win.x + Math.round(rail * 0.2)}" cy="${win.y + Math.round(chrome * 0.62)}" r="${Math.round(chrome * 0.2)}" fill="${TEAL}" opacity="0.9"/>
    <rect x="${win.x + Math.round(rail * 0.34)}" y="${win.y + Math.round(chrome * 0.5)}" width="${Math.round(rail * 0.42)}" height="${Math.round(chrome * 0.24)}" rx="${Math.round(chrome * 0.12)}" fill="#ffffff" opacity="0.35"/>
    ${navRows}
    <rect x="${contentX}" y="${win.y + Math.round(chrome * 0.46)}" width="${Math.round(contentW * 0.3)}" height="${Math.round(chrome * 0.3)}" rx="${Math.round(chrome * 0.15)}" fill="#ffffff" opacity="0.28"/>
    <rect x="${contentX + contentW - Math.round(contentW * 0.14)}" y="${win.y + Math.round(chrome * 0.4)}" width="${Math.round(contentW * 0.14)}" height="${Math.round(chrome * 0.42)}" rx="${Math.round(chrome * 0.21)}" fill="${TEAL}" opacity="0.85"/>
    ${cards}
    <rect x="${contentX}" y="${chartY}" width="${chartW}" height="${chartH}" rx="${r}" fill="#ffffff" opacity="0.06"/>
    ${bars}
    <rect x="${listX}" y="${chartY}" width="${listW}" height="${chartH}" rx="${r}" fill="#ffffff" opacity="0.06"/>
    ${listRows}
    <rect x="${contentX}" y="${tableY}" width="${contentW}" height="${tableH}" rx="${r}" fill="#ffffff" opacity="0.06"/>
    ${tableHead}
    ${tableRows}
  </svg>`;
}

/**
 * Editorial slots (About story, Contact aside). A soft light composition of
 * overlapping rounded forms — reads as intentional brand artwork, and a real
 * photograph dropped in its place is a straight upgrade rather than a
 * redesign.
 */
function editorialSvg(w: number, h: number, variant: 0 | 1): string {
  const flip = variant === 1;
  const cx = flip ? w * 0.34 : w * 0.66;
  const r1 = Math.round(Math.min(w, h) * 0.42);
  const r2 = Math.round(Math.min(w, h) * 0.28);

  const bands = Array.from({ length: 6 }, (_, i) => {
    const y = Math.round(h * (0.18 + i * 0.115));
    const width = Math.round(w * (0.3 - i * 0.028));
    const x = flip ? w - Math.round(w * 0.1) - width : Math.round(w * 0.1);
    return `<rect x="${x}" y="${y}" width="${width}" height="${Math.round(h * 0.022)}" rx="${Math.round(h * 0.011)}" fill="${NAVY}" opacity="${0.16 - i * 0.02}"/>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="wash" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${MIST}"/>
        <stop offset="100%" stop-color="#dfe5ee"/>
      </linearGradient>
      <linearGradient id="disc" x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0%" stop-color="${TEAL}" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="${NAVY}" stop-opacity="0.7"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#wash)"/>
    <circle cx="${cx}" cy="${h * 0.52}" r="${r1}" fill="url(#disc)" opacity="0.85"/>
    <circle cx="${cx + (flip ? r1 * 0.5 : -r1 * 0.5)}" cy="${h * 0.74}" r="${r2}" fill="${NAVY_DEEP}" opacity="0.22"/>
    <circle cx="${cx + (flip ? -r1 * 0.2 : r1 * 0.2)}" cy="${h * 0.3}" r="${Math.round(r2 * 0.55)}" fill="${TEAL}" opacity="0.5"/>
    ${bands}
  </svg>`;
}

async function main() {
  await mkdir(join(OUT_DIR, "team"), { recursive: true });

  const jobs: Array<{ file: string; svg: string }> = [
    {
      file: IMAGES.hero.src,
      svg: heroSvg(IMAGES.hero.width, IMAGES.hero.height),
    },
    {
      file: IMAGES.aboutStory.src,
      svg: editorialSvg(IMAGES.aboutStory.width, IMAGES.aboutStory.height, 0),
    },
    {
      file: IMAGES.contactAside.src,
      svg: editorialSvg(
        IMAGES.contactAside.width,
        IMAGES.contactAside.height,
        1,
      ),
    },
  ];

  for (const job of jobs) {
    // site.ts paths are web-absolute ("/marketing/hero.png").
    const out = join(process.cwd(), "public", job.file.replace(/^\//, ""));
    const png = await sharp(Buffer.from(job.svg)).png({ quality: 90 }).toBuffer();
    await writeFile(out, png);
    console.log(`wrote ${job.file} (${png.length.toLocaleString()} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
