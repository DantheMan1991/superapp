import type { StarterScene } from "@/lib/site-templates/types";

/**
 * The platform's starter scenes — pure SVG (slice 15).
 *
 * A template's picture slots are filled at build with these: text-free
 * compositions in the brand's own colours, so a site looks deliberate
 * before any photography exists and reads as the owner's from the first
 * minute. They are decoration a real photo replaces in the editor, one
 * click each; nothing here is a stock photo and nothing carries a licence.
 * Every scene is 1600 by 1000 and safe to darken behind words.
 */
export const STARTER_WIDTH = 1600;
export const STARTER_HEIGHT = 1000;

export interface StarterPalette {
  primary: string;
  accent: string;
}

/** A hex colour mixed toward white (t > 0) or black (t < 0), for tints and shades of the brand. */
export function mix(hex: string, t: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return t > 0 ? "#dddddd" : "#333333";
  const n = parseInt(m[1], 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const target = t > 0 ? 255 : 0;
  const k = Math.min(1, Math.abs(t));
  const out = channels.map((c) => Math.round(c + (target - c) * k));
  return `#${out.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const W = STARTER_WIDTH;
const H = STARTER_HEIGHT;

/** Rolling hills under a soft sky, the sun in the brand's accent: a pasture, a valley, open ground. */
function hills(p: StarterPalette): string {
  const sky = mix(p.primary, 0.92);
  const skyLow = mix(p.accent, 0.82);
  const far = mix(p.primary, 0.55);
  const mid = mix(p.primary, 0.3);
  const near = mix(p.primary, 0.05);
  const nearest = mix(p.primary, -0.2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="${skyLow}"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <circle cx="1180" cy="300" r="110" fill="${p.accent}" opacity="0.9"/>
  <path d="M0 560 C 260 470, 520 470, 780 560 S 1300 650, 1600 540 L1600 1000 L0 1000 Z" fill="${far}"/>
  <path d="M0 680 C 300 590, 560 600, 820 690 S 1320 790, 1600 660 L1600 1000 L0 1000 Z" fill="${mid}"/>
  <path d="M0 800 C 280 730, 600 720, 900 800 S 1360 900, 1600 790 L1600 1000 L0 1000 Z" fill="${near}"/>
  <path d="M0 920 C 400 860, 800 880, 1200 930 S 1500 960, 1600 930 L1600 1000 L0 1000 Z" fill="${nearest}"/>
  <g fill="${mix(p.primary, -0.35)}" opacity="0.85">
    <ellipse cx="420" cy="770" rx="44" ry="60"/><rect x="414" y="800" width="12" height="40"/>
    <ellipse cx="1240" cy="735" rx="36" ry="50"/><rect x="1235" y="760" width="10" height="34"/>
    <ellipse cx="1310" cy="748" rx="28" ry="40"/><rect x="1306" y="770" width="8" height="28"/>
  </g>
</svg>`;
}

/** Furrows drawn to a low horizon: rows in a field, a garden, a planted slope. */
function furrows(p: StarterPalette): string {
  const sky = mix(p.accent, 0.88);
  const skyLow = mix(p.primary, 0.8);
  const soil = mix(p.primary, -0.1);
  const soilLight = mix(p.primary, 0.2);
  const rows: string[] = [];
  const horizon = 430;
  for (let i = -9; i <= 9; i++) {
    const x1 = 800 + i * 60;
    const x2 = 800 + i * 420;
    rows.push(`<path d="M${x1} ${horizon} L${x2} ${H}" stroke="${soilLight}" stroke-width="${10 + Math.abs(i)}" opacity="0.55"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="${skyLow}"/></linearGradient>
    <linearGradient id="soil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(p.primary, 0.15)}"/><stop offset="1" stop-color="${soil}"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <rect y="${horizon - 40}" width="${W}" height="60" fill="${mix(p.primary, 0.45)}"/>
  <rect y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#soil)"/>
  <g stroke-linecap="round">${rows.join("")}</g>
  <circle cx="330" cy="240" r="90" fill="${p.accent}" opacity="0.85"/>
</svg>`;
}

/** First light over a ridge with a gable against it: a farmstead, a yard, a place people work early. */
function dawn(p: StarterPalette): string {
  const top = mix(p.primary, -0.45);
  const glow = mix(p.accent, 0.35);
  const ridge = mix(p.primary, -0.55);
  const ground = mix(p.primary, -0.65);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="0.7" stop-color="${glow}"/><stop offset="1" stop-color="${mix(p.accent, 0.1)}"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <circle cx="800" cy="700" r="150" fill="${mix(p.accent, 0.6)}" opacity="0.9"/>
  <path d="M0 720 C 300 650, 600 660, 900 730 S 1400 790, 1600 700 L1600 1000 L0 1000 Z" fill="${ridge}"/>
  <g fill="${ground}">
    <rect x="1060" y="600" width="220" height="150"/>
    <path d="M1040 606 L1170 500 L1300 606 Z"/>
    <rect x="1290" y="640" width="90" height="110"/>
    <rect x="1330" y="540" width="14" height="110"/>
  </g>
  <path d="M0 850 C 400 800, 900 810, 1600 860 L1600 1000 L0 1000 Z" fill="${ground}"/>
</svg>`;
}

const SCENES: Record<StarterScene, (p: StarterPalette) => string> = { hills, furrows, dawn };

export function starterSceneSvg(scene: StarterScene, palette: StarterPalette): string {
  return SCENES[scene](palette);
}
