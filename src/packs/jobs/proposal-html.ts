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
 * not a document. Since E5b (ADR 0084) that is not a hope: the brochure's PDF
 * is a headless print of this exact string, and `load` is reached with nothing
 * on the wire.
 *
 * **One control, and it is not part of the document.** `Print` calls the
 * browser's own print, which is what makes the PDF route's failure page tell
 * the truth when it says to print from the browser, and what a client on a
 * shared link (E5c) will reach for to keep their own copy. It is hidden in
 * print media, so it is on no sheet of paper and in no headless render.
 *
 * **WHY THE SECTIONS SIT IN A TABLE WITH AN EMPTY `tfoot`.** The running
 * footer is `position: fixed`, so it repeats on every page and reserves room
 * for itself on NONE: the last line of a FULL page printed straight through
 * it — body text measured at 62pt off the paper against the footer's own
 * baseline at 57pt. On screen it never happened, because there the sheet's
 * 1.1in bottom padding holds the footer off the text; print drops that
 * padding and reserved nothing in its place, so the collision existed only on
 * paper. Found by printing a full page headlessly (E5b, ADR 0084): no screen
 * and no unit test could have shown it, and `npm run print:probe` is what
 * measures it now.
 *
 * A `tfoot` is the only thing that reserves a band page after page, so an
 * empty one holds `.band` open and the fixed footer is pinned into it. Two
 * mechanisms, one each for the two jobs: **tfoot reserves, fixed pins.** A
 * bottom padding on the sheet was tried first and does NOT do it — it
 * appeared to on a synthetic page, which was the page breaks falling
 * differently, and the real document still printed through the footer. The
 * wrapper's own cells have to undo the price sheet's `td` rules and the
 * `break-inside: avoid` that would otherwise make the whole document one
 * unbreakable row.
 *
 * **NO BACKTICK MAY APPEAR IN THE STYLESHEET, INCLUDING IN A COMMENT.** It is
 * a template literal: one backtick in a CSS comment ended the string and made
 * the `@page` after it a TypeScript statement.
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
/* The orphan control a browser has and react-pdf does not — ADR 0083's own argument for HTML. */
p { margin: 0 0 8px; max-width: 34em; orphans: 2; widows: 2; }
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
/* The price sheet: a running number, the item, its qualifier, its amount.
   Tight rows because a real one runs to two hundred of them. */
table.worksheet td { padding: 3px 6px; font-size: 9.5pt; }
table.worksheet td.num { width: 2.6em; color: var(--muted); text-align: right; padding-right: 10px; }
table.worksheet tr.sheet-section td { font-weight: 600; padding-top: 13px; border-bottom: none; text-transform: uppercase; letter-spacing: 0.04em; font-size: 9pt; }
.qualifier { color: var(--muted); font-weight: 400; margin-left: 10px; }
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

/* The wrapper whose empty tfoot reserves the footer's band on every page. Its
   own cells must undo the price sheet's table rules and the no-break rule. */
table.paper { width: 100%; border-collapse: collapse; }
table.paper > tbody > tr > td, table.paper > tfoot > tr > td { padding: 0; border: 0; break-inside: auto; }
table.paper > tbody > tr, table.paper > tfoot > tr { break-inside: auto; }
.band { height: 0; }

/* the client link's reply card: screen only, never part of the document */
.accept { width: 8.5in; max-width: 100%; margin: 0 auto 40px; padding: 22px 0.9in 26px; background: #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,.18), 0 8px 24px rgba(0,0,0,.08); }
.accept h3 { font-family: ui-serif, Georgia, serif; font-size: 15pt; margin: 0 0 8px; color: var(--accent); }
.accept label { display: block; font-size: 7.5pt; letter-spacing: .12em; text-transform: uppercase;
                color: var(--muted); margin: 14px 0 5px; }
.accept input { font: inherit; font-size: 13pt; padding: 9px 11px; width: 100%; max-width: 22em;
                border: 1px solid #9ca3af; border-radius: 5px; background: #fff; color: var(--ink); }
.accept input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.accept button { display: block; margin: 16px 0 0; font: inherit; font-size: 11pt; font-weight: 600;
                 padding: 11px 22px; cursor: pointer; border: 0; border-radius: 6px;
                 background: var(--accent); color: #fff; }
.accept button:hover { filter: brightness(1.1); }
.accept .bad { color: #b91c1c; font-weight: 600; }

/* print it yourself: the only thing on this page that is not the document */
.print-me { position: fixed; top: 16px; right: 16px; z-index: 10; font: inherit; font-size: 9.5pt;
            padding: 7px 15px; cursor: pointer; background: var(--ink); color: #fff; border: 0;
            border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,.25); }
.print-me:hover { background: #374151; }

/**
 * ON A PHONE THE PAPER DOES NOT FIT, SO THE SCREEN BECOMES READABLE INSTEAD.
 * Screen only — print is untouched below, and the Print button still gives the
 * exact sheet. See the file header for why this overrides the grey-desk rule.
 */
@media screen and (max-width: 8.9in) {
  html, body { background: #fff; }
  .sheet { width: auto; min-height: 0; margin: 0; padding: 22px 18px 40px; box-shadow: none; }
  /* A 9in column and a 74pt watermark are furniture for paper, not for a hand. */
  .cover { min-height: 0; display: block; }
  .cover .foot { display: block; }
  .cover .foot > div { text-align: left !important; margin-top: 18px; }
  .watermark { display: none; }
  h1 { font-size: ${brochure ? "24pt" : "16pt"}; max-width: none; }
  h2 { font-size: ${brochure ? "14pt" : "10pt"}; }
  p, .items .name { max-width: none; }
  .facts { gap: 14px 24px; }
  .parties, .sigs { display: block; }
  .parties > div + div, .sigs > div + div { margin-top: 18px; }
  /* Four columns in 375px: the description wraps and the numbers stay whole. */
  table { font-size: 9.5pt; }
  th { font-size: 6.5pt; letter-spacing: .06em; }
  td { padding: 6px 0; }
  th.n, td.n { padding-left: 6px; }
  .row-note, .small { font-size: 8pt; }
  /* In the flow at the end: there are no pages to run a footer along. */
  .footer { position: static; left: auto; right: auto; bottom: auto; margin-top: 28px; }
  .accept { width: auto; margin: 0 0 32px; padding: 20px 18px 24px; box-shadow: none;
            border-top: 1px solid var(--rule); }
  .accept input { max-width: none; font-size: 16pt; }
  /**
   * IN THE FLOW, ABOVE THE DOCUMENT. Floating top-right is exactly where the
   * amounts are right-aligned, so on a narrow screen the one control on the
   * page would sit on top of the money. Static costs a scroll to reach and
   * covers nothing.
   */
  .print-me { position: static; display: block; margin: 14px 18px 0; padding: 7px 14px; }
}

@media print {
  html, body { background: #fff; }
  .sheet { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
  .page-break { break-before: page; }
  /* tfoot reserves the band, page after page; fixed pins the footer into it. */
  .band { height: 0.4in; }
  .footer { position: fixed; left: 0; right: 0; bottom: 0; }
  .watermark { position: fixed; }
  /* Never on the paper — and so never in the headless print either. */
  .print-me, .accept { display: none; }
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
    /**
      * THE PRICE SHEET. One table, numbered straight through, with the parts
      * of the bid as rows of their own — the shape the pilot's company has
      * handed clients for years.
      *
      * **A ROW AT `$0.00` PRINTS.** Those rows are the document's exclusions
      * — *"By Owner"*, *"(N/A)"*, *"Included in the plumbing quote"* — said
      * where the client reads them, and about a third of a real sheet.
      */
    case "worksheet":
      return `<section class="section"><h2>${esc(section.heading)}</h2>
  <table class="worksheet">
    <tbody>
      ${section.rows
        .map((r) =>
          r.isSection
            ? `<tr class="sheet-section"><td class="num">${r.number}</td><td colspan="2">${esc(r.description)}</td></tr>`
            : `<tr>
  <td class="num">${r.number}</td>
  <td>${esc(r.description)}${r.note ? `<span class="qualifier">${esc(r.note)}</span>` : ""}</td>
  <td class="n">${esc(r.amount)}</td>
</tr>`,
        )
        .join("")}
      <tr class="total"><td></td><td>${esc(section.total.label)}</td><td class="n">${esc(section.total.amount)}</td></tr>
    </tbody>
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

/**
 * WHAT A CLIENT LINK ADDS, AND IT IS NOT PART OF THE DOCUMENT (E5c, ADR 0085).
 *
 * A screen-only panel after the last section: type your name, press Accept.
 * Screen-only for the same reason the Print control is, and for one more —
 * **the paper a client prints is byte-identical to the paper the builder
 * prints.** The document does not change because of who is looking at it, so
 * there is still one document, and the PDF of a shared proposal is the PDF of
 * the proposal.
 */
export interface ProposalAcceptView {
  /** Where the form posts. Same-origin, and the token is already in the path. */
  acceptUrl: string;
  /** The version being SHOWN, posted back so a revision refuses rather than overwrites. */
  estimateVersion: number;
  /** Already accepted: who and when. The panel says so and asks nothing. */
  signed: { name: string; on: string } | null;
  /** A refusal from the last attempt, shown above the field. */
  error?: string;
}

function acceptPanelHtml(view: ProposalAcceptView, businessName: string): string {
  if (view.signed) {
    return `<aside class="accept">
  <h3>Accepted</h3>
  <p><strong>${esc(view.signed.name)}</strong> accepted this proposal on ${esc(view.signed.on)}.</p>
  <p class="small muted">Keep a copy with the Print button above. ${esc(businessName)} will be in touch.</p>
</aside>`;
  }
  return `<aside class="accept">
  <h3>Accept this proposal</h3>
  ${view.error ? `<p class="bad">${esc(view.error)}</p>` : ""}
  <form method="post" action="${esc(view.acceptUrl)}">
    <input type="hidden" name="version" value="${view.estimateVersion}">
    <label for="accept-name">Your full name</label>
    <input id="accept-name" name="name" type="text" autocomplete="name" maxlength="120" required
           placeholder="Type your name">
    <button type="submit">Accept this proposal</button>
  </form>
  <p class="small muted">Typing your name and pressing Accept records that you accept the price and
  the terms above, on today's date. If you would rather sign on paper, use the Print button and send
  the signed page back to ${esc(businessName)}.</p>
</aside>`;
}

/** The whole page. One string, nothing fetched, printable as it stands. */
export function renderProposalHtml(
  doc: ProposalDocument,
  brand: ProposalHtmlBrand,
  accept?: ProposalAcceptView,
): string {
  const accent = brand.primaryColor ?? INK;
  const logo = dataUri(brand.logo);
  const brochure = doc.format === "brochure";
  const body = doc.sections.map((s) => sectionHtml(s, brand, logo)).join("\n");
  const watermark = doc.model.watermark ? `<div class="watermark">${esc(doc.model.watermark)}</div>` : "";
  // Nothing at all when there is no link, so a document served through any
  // other door is byte-identical to the one that existed before E5c.
  const panel = accept ? `\n${acceptPanelHtml(accept, brand.businessName)}` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.model.title)} · ${esc(doc.title)}</title>
<style>${styles(accent, brochure)}</style>
</head>
<body>
<button class="print-me" type="button" onclick="window.print()">Print</button>
<div class="sheet">
${watermark}
<table class="paper"><tfoot><tr><td class="band"></td></tr></tfoot><tbody><tr><td>
${body}
</td></tr></tbody></table>
<div class="footer"><span>${esc(doc.model.footer)}</span><span>${esc(doc.model.title)}</span></div>
</div>${panel}
</body>
</html>`;
}
