import type { HexColor } from "@/lib/brand/core";
import type { CertificateBrand } from "./certificate-model";
import type { ProposalDocument, ProposalSection } from "./proposal-sections";

/**
 * A PROPOSAL AS ONE HTML DOCUMENT, print-first (E5a, ADR 0083).
 *
 * **Layout only.** Every word and every figure was decided by
 * `proposal-sections.ts` over `proposal-model.ts`; this file chooses type,
 * rules and page breaks and computes nothing. So the same sections can be a
 * letter on screen, a brochure in print, and — when the Chromium route lands —
 * a PDF of this exact page, with no third opinion about the money.
 *
 * **Why HTML and not more `@react-pdf`.** The founder asked for magazine-grade
 * for luxury work, which is past what react-pdf lays out: no real page
 * furniture, no `break-inside`, no orphan control, one font pipeline. A
 * browser has all of it, and the same file is what a client link will serve
 * and what a headless print will consume — one document, three doors, the
 * entry bar's rule applied to paper.
 *
 * Self-contained on purpose: the CSS is inline and the logo is a data URI, so
 * the page prints the same offline, in a headless browser, and from a saved
 * copy. No external font — a document that needs the network to look right is
 * not a document.
 */

export interface ProposalHtmlBrand {
  businessName: string;
  tagline: string;
  /** The accent: rules, the cover band, the heading colour. */
  primaryColor: HexColor | null;
  /**
   * Inlined as a data URI; nothing is fetched. The format is the brand kit's
   * own spelling (`jpg`, not `jpeg`) — taken from `CertificateBrand` rather
   * than restated here, so the two cannot drift apart.
   */
  logo: CertificateBrand["logo"];
}

const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dataUri(logo: ProposalHtmlBrand["logo"]): string | null {
  if (!logo) return null;
  let binary = "";
  for (const byte of logo.data) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(logo.data).toString("base64");
  // `jpg` is the brand kit's spelling; the media type is `jpeg`.
  const media = logo.format === "png" ? "png" : "jpeg";
  return `data:image/${media};base64,${base64}`;
}

/**
 * The stylesheet. Print is the primary medium and the screen is print on a
 * grey desk, which is why the page is a fixed measure with a shadow rather
 * than a fluid layout: what somebody sees is what comes out of the printer.
 */
function styles(accent: string, brochure: boolean): string {
  return `
:root { --ink: ${INK}; --muted: ${MUTED}; --rule: ${RULE}; --accent: ${accent}; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #f3f4f6; color: var(--ink); }
body {
  font: 11pt/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.sheet {
  width: 8.5in; min-height: 11in; margin: 24px auto; padding: 0.85in 0.9in 1.1in;
  background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.18), 0 8px 24px rgba(0,0,0,.08); position: relative;
}
h1, h2, h3 { font-family: ui-serif, Georgia, "Times New Roman", serif; font-weight: 600; margin: 0; }
h1 { font-size: ${brochure ? "34pt" : "17pt"}; line-height: 1.08; letter-spacing: -0.01em; }
h2 {
  font-size: ${brochure ? "16pt" : "10.5pt"};
  ${brochure ? "" : "text-transform: uppercase; letter-spacing: .09em; font-family: inherit; font-weight: 600;"}
  color: ${brochure ? "var(--accent)" : "var(--ink)"};
  border-bottom: 1px solid ${brochure ? "var(--rule)" : "var(--ink)"};
  padding-bottom: ${brochure ? "6px" : "3px"}; margin: 0 0 10px;
}
p { margin: 0 0 8px; max-width: 34em; }
.section { margin: 0 0 ${brochure ? "30px" : "18px"}; break-inside: avoid; }
.muted { color: var(--muted); }
.small { font-size: 8.5pt; }
.eyebrow { font-size: 7.5pt; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }

/* the cover */
.cover { display: flex; min-height: 9in; flex-direction: column; justify-content: space-between; }
.cover .band { height: 6px; background: var(--accent); width: 96px; margin: 0 0 28px; }
.cover h1 { margin: 0 0 14px; max-width: 22ch; }
.cover .for { font-size: 13pt; color: var(--muted); font-family: ui-serif, Georgia, serif; }
.cover .foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
.logo { max-height: 54px; max-width: 200px; display: block; }

/* facts and parties */
.facts { display: flex; flex-wrap: wrap; gap: 22px 34px; margin: 0 0 16px; }
.facts div { min-width: 96px; }
.facts .v { font-size: 10.5pt; }
.parties { display: flex; gap: 48px; margin: 0 0 18px; }

/* the price sheet */
table { width: 100%; border-collapse: collapse; }
th { font-size: 7.5pt; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); text-align: left;
     border-bottom: 1px solid var(--ink); padding: 0 0 5px; font-weight: 600; }
td { padding: 7px 0; border-bottom: 1px solid var(--rule); vertical-align: top; }
th.n, td.n { text-align: right; }
tr, td, th { break-inside: avoid; }
.row-note { color: var(--muted); font-size: 8.5pt; margin: 2px 0 0; max-width: 40em; }
.heading-row td { font-weight: 600; border-bottom: none; padding-top: 14px; padding-bottom: 2px; }
.total td { border-top: 2px solid var(--ink); border-bottom: none; font-weight: 700; font-size: ${brochure ? "13pt" : "11.5pt"}; padding-top: 9px; }
.sum { display: flex; justify-content: space-between; border-top: 2px solid var(--ink); border-bottom: 2px solid var(--ink);
       padding: 12px 0; font-weight: 700; font-size: 13pt; }

/* the narrative */
.items { margin: 0; padding: 0; list-style: none; }
.items li { padding: 9px 0; border-bottom: 1px solid var(--rule); break-inside: avoid; }
.items .name { font-family: ui-serif, Georgia, serif; font-size: 12pt; }

/* acceptance */
.sigs { display: flex; gap: 48px; margin-top: 14px; }
.sigs > div { flex: 1; }
.sigline { border-bottom: 1px solid var(--ink); height: 26px; margin-top: 16px; }
.watermark {
  position: absolute; inset: 42% 0 auto; text-align: center; font-size: 74pt; font-weight: 700;
  color: rgba(185, 28, 28, .10); letter-spacing: .1em; pointer-events: none; font-family: inherit;
}
.footer { position: absolute; left: 0.9in; right: 0.9in; bottom: 0.5in; display: flex; justify-content: space-between;
          font-size: 7.5pt; color: var(--muted); border-top: 1px solid var(--rule); padding-top: 6px; }

@media print {
  html, body { background: #fff; }
  .sheet { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
  .page-break { break-before: page; }
  .footer { position: fixed; left: 0; right: 0; bottom: 0; }
  .watermark { position: fixed; }
}
@page { size: letter; margin: 0.75in; }
`.trim();
}

function factsHtml(rows: Array<[string, string]>): string {
  return `<div class="facts">${rows
    .map(([label, value]) => `<div><div class="eyebrow">${esc(label)}</div><div class="v">${esc(value)}</div></div>`)
    .join("")}</div>`;
}

function sectionHtml(section: ProposalSection, brand: ProposalHtmlBrand, logo: string | null): string {
  switch (section.kind) {
    case "cover": {
      const logoTag = logo ? `<img class="logo" src="${logo}" alt="${esc(brand.businessName)}">` : "";
      return `<section class="section cover">
  <div>
    <div class="band"></div>
    <h1>${esc(section.title)}</h1>
    ${section.toName ? `<p class="for">Prepared for ${esc(section.toName)}</p>` : ""}
  </div>
  <div class="foot">
    <div>
      ${logoTag}
      <div class="${logo ? "small muted" : ""}" style="margin-top:6px">${esc(brand.businessName)}</div>
      ${brand.tagline ? `<div class="small muted">${esc(brand.tagline)}</div>` : ""}
    </div>
    <div class="small muted" style="text-align:right">
      <div>${esc(section.project)}</div>
      ${section.site ? `<div>${esc(section.site)}</div>` : ""}
      ${section.date ? `<div>${esc(section.date)}</div>` : ""}
    </div>
  </div>
</section>
<div class="page-break"></div>`;
    }
    case "letter":
      return `<section class="section">
  ${section.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}
  <p style="margin-top:18px">${esc(section.signOff)}</p>
</section>`;
    case "facts":
      return `<section class="section">${factsHtml(section.rows)}</section>`;
    case "parties":
      return `<section class="section parties">
  <div><div class="eyebrow">To</div>${section.toLines.map((l) => `<div>${esc(l)}</div>`).join("")}</div>
  <div><div class="eyebrow">From</div>${section.fromLines.map((l) => `<div>${esc(l)}</div>`).join("")}</div>
</section>`;
    case "text":
      return `<section class="section"><h2>${esc(section.title)}</h2>${section.paragraphs
        .map((p) => `<p>${esc(p)}</p>`)
        .join("")}</section>`;
    case "narrative":
      return `<section class="section"><h2>${esc(section.title)}</h2>
  <ul class="items">${section.items
    .map(
      (i) =>
        `<li><div class="name">${esc(i.name)}</div>${i.note ? `<p class="row-note">${esc(i.note)}</p>` : ""}</li>`,
    )
    .join("")}</ul></section>`;
    case "price": {
      const { price } = section;
      if (price.rows.length === 0 && price.rounding === null) {
        return `<section class="section"><h2>${esc(price.heading)}</h2>
  <div class="sum"><span>${esc(price.total.label)}</span><span>${esc(price.total.amount)}</span></div></section>`;
      }
      const cols = 1 + (price.columns.quantity ? 1 : 0) + (price.columns.unitPrice ? 1 : 0) + 1;
      const row = (r: (typeof price.rows)[number]) =>
        r.heading
          ? `<tr class="heading-row"><td colspan="${cols}">${esc(r.description)}</td></tr>`
          : `<tr>
  <td>${esc(r.description)}${r.note ? `<p class="row-note">${esc(r.note)}</p>` : ""}</td>
  ${price.columns.quantity ? `<td class="n">${esc(r.quantity)}</td>` : ""}
  ${price.columns.unitPrice ? `<td class="n">${esc(r.unitPrice)}</td>` : ""}
  <td class="n">${esc(r.amount)}</td>
</tr>`;
      return `<section class="section"><h2>${esc(price.heading)}</h2>
  <table>
    <thead><tr><th>Item</th>${price.columns.quantity ? '<th class="n">Quantity</th>' : ""}${
      price.columns.unitPrice ? '<th class="n">Per unit</th>' : ""
    }<th class="n">Amount</th></tr></thead>
    <tbody>
      ${price.rows.map(row).join("")}
      ${price.rounding ? row(price.rounding) : ""}
      <tr class="total"><td>${esc(price.total.label)}</td>${
        price.columns.quantity ? "<td></td>" : ""
      }${price.columns.unitPrice ? "<td></td>" : ""}<td class="n">${esc(price.total.amount)}</td></tr>
    </tbody>
  </table></section>`;
    }
    case "allowances":
      return `<section class="section"><h2>${esc(section.title)}</h2>
  <p class="muted small">${esc(section.intro)}</p>
  <table>
    <thead><tr><th>Item</th><th>Allowed</th><th>Chosen</th></tr></thead>
    <tbody>${section.rows
      .map(
        (r) =>
          `<tr><td>${esc(r.name)}</td><td>${esc(r.allowance)}</td><td>${
            r.chosen ? esc(r.chosen) : `<span class="muted">${esc(r.standing)}</span>`
          }</td></tr>`,
      )
      .join("")}</tbody>
  </table></section>`;
    case "milestones":
      return `<section class="section"><h2>${esc(section.title)}</h2>
  <p class="muted small">${esc(section.intro)}</p>
  <table>
    <thead><tr><th>Stage</th><th>When</th><th>Who</th></tr></thead>
    <tbody>${section.rows
      .map(
        (r) =>
          `<tr><td>${esc(r.name)}</td><td>${esc(r.when)}</td><td class="muted">${esc(r.who)}</td></tr>`,
      )
      .join("")}</tbody>
  </table></section>`;
    case "acceptance":
      return `<section class="section">
  ${section.validity ? `<p class="small muted">${esc(section.validity)}</p>` : ""}
  <p class="small">${esc(section.words)}</p>
  <div class="sigs">${section.signatures
    .map(
      (s) =>
        `<div><div class="eyebrow">${esc(s.heading)}</div>${s.lines
          .map((l) => `<div class="sigline"></div><div class="small muted">${esc(l)}</div>`)
          .join("")}</div>`,
    )
    .join("")}</div>
</section>`;
  }
}

/** The whole page. One string, nothing fetched, printable as it stands. */
export function renderProposalHtml(doc: ProposalDocument, brand: ProposalHtmlBrand): string {
  const accent = brand.primaryColor ?? INK;
  const logo = dataUri(brand.logo);
  const brochure = doc.format === "brochure";
  const body = doc.sections.map((s) => sectionHtml(s, brand, logo)).join("\n");
  const watermark = doc.model.watermark ? `<div class="watermark">${esc(doc.model.watermark)}</div>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.model.title)} · ${esc(doc.title)}</title>
<style>${styles(accent, brochure)}</style>
</head>
<body>
<div class="sheet">
${watermark}
${body}
<div class="footer"><span>${esc(doc.model.footer)}</span><span>${esc(doc.model.title)}</span></div>
</div>
</body>
</html>`;
}
