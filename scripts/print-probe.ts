import "./lib/load-env";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { printHtmlToPdf } from "../src/lib/pdf/print-html";
import { pressFor } from "../src/lib/pdf/print-press";
import { existsSync } from "node:fs";
import { renderProposalHtml } from "../src/packs/jobs/proposal-html";
import type { ProposalDocument } from "../src/packs/jobs/proposal-sections";

/**
 * `npm run print:probe` — prove this machine (or this deployment) can print an
 * HTML document, and MEASURE the one thing about it that only paper shows.
 *
 *   npm run print:probe              resolve the press, print, measure
 *   npm run print:probe -- --keep    leave the PDF behind and say where
 *
 * WHY THIS EXISTS. The estimate's brochure is HTML printed by a headless
 * Chromium (E5b, ADR 0084), and the failure that cost this slice an hour was
 * invisible everywhere except on the page: the running footer is
 * `position: fixed`, so it repeats on every sheet and reserves room on none,
 * and a FULL page printed its last line straight through it. No screen shows
 * it — on screen the sheet's own padding holds the footer off the text — and
 * no unit test can, because it is a fact about pagination.
 *
 * So this renders a brochure long enough to fill several pages through the
 * REAL stylesheet, prints it, reads it back with the same `pdfjs-dist` the
 * Documents module reads uploads with, and compares the footer's baseline to
 * the lowest body text on every page. It needs no database and no tenant: the
 * words are made up, the layout is the product's.
 *
 * It exits 1 and names the page when the clearance is gone.
 */

/** Below this the footer's rule starts touching descenders. Measured, not guessed. */
const MIN_CLEARANCE_PT = 12;

const paragraph =
  "Every trade is to protect finished work and to leave the site broom clean at the end of each " +
  "day, and the builder is to co-ordinate deliveries with the owner a week ahead.";

function sample(): ProposalDocument {
  const paragraphs = Array.from({ length: 24 }, (_, i) => `Paragraph ${i + 1} of the terms. ${paragraph}`);
  return {
    format: "brochure",
    title: "Print probe",
    model: {
      title: "PROPOSAL",
      footer: "Ops Builder LLC · Proposal EST-PROBE · 24-000",
      // No watermark: it is letter-spaced, so a reader splits it into pieces
      // that look like body text, and on a short page it would be the lowest
      // thing on the sheet. It has nothing to do with the footer's band.
      watermark: "",
    },
    sections: [
      {
        kind: "cover",
        title: "A house, as drawn",
        project: "24-000 · Probe residence",
        site: "1 Probe Lane",
        toName: "A Client",
        date: "1 January 2026",
        businessName: "Ops Builder LLC",
      },
      { kind: "text", title: "Terms", paragraphs },
      { kind: "text", title: "More terms", paragraphs },
    ],
    // Only the fields the renderer reads are needed; it computes nothing.
  } as unknown as ProposalDocument;
}

interface PageMeasure {
  page: number;
  footerY: number | null;
  lowestBodyY: number | null;
}

async function measure(bytes: Uint8Array): Promise<PageMeasure[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  const out: PageMeasure[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    const items = content.items
      .filter((i): i is Extract<typeof i, { str: string }> => "str" in i && i.str.trim() !== "")
      // transform[5] is the text baseline, in points up from the paper's edge.
      .map((i) => ({ str: i.str, y: "transform" in i ? (i.transform[5] as number) : 0 }));
    const footer = items.filter((i) => i.str.includes("EST-PROBE") || i.str === "PROPOSAL");
    const footerY = footer.length > 0 ? Math.min(...footer.map((i) => i.y)) : null;
    const body = items.filter((i) => !footer.includes(i));
    out.push({
      page: n,
      footerY: footerY === null ? null : Math.round(footerY),
      lowestBodyY: body.length > 0 ? Math.round(Math.min(...body.map((i) => i.y))) : null,
    });
  }
  return out;
}

async function main() {
  const keep = process.argv.includes("--keep");
  const press = pressFor(process.env, process.platform, existsSync);
  console.log(`press: ${press.kind}${press.kind === "local" ? ` — ${press.executablePath}` : ""}`);
  if (press.kind === "pack") console.log(`  pack: ${press.packUrl}`);
  if (press.kind === "none") {
    console.error(`\n${press.why}`);
    process.exit(1);
  }

  const html = renderProposalHtml(sample(), {
    businessName: "Ops Builder LLC",
    tagline: "Built right",
    primaryColor: "#1d4ed8",
    logo: null,
  });
  const started = Date.now();
  const bytes = await printHtmlToPdf(html);
  console.log(`printed ${bytes.length} bytes in ${Date.now() - started}ms`);

  const dir = keep ? mkdtempSync(join(tmpdir(), "print-probe-")) : null;
  if (dir) {
    writeFileSync(join(dir, "probe.pdf"), bytes);
    writeFileSync(join(dir, "probe.html"), html, "utf8");
    console.log(`kept: ${dir}`);
  }

  const pages = await measure(bytes);
  console.log(`\n${pages.length} pages · footer clearance, in points:`);
  let worst = Number.POSITIVE_INFINITY;
  const failed: number[] = [];
  for (const p of pages) {
    if (p.footerY === null) {
      console.log(`  page ${p.page}: NO FOOTER — it is not being printed at all`);
      failed.push(p.page);
      continue;
    }
    if (p.lowestBodyY === null) {
      console.log(`  page ${p.page}: footer at ${p.footerY}, no body text`);
      continue;
    }
    const clearance = p.lowestBodyY - p.footerY;
    worst = Math.min(worst, clearance);
    const verdict = clearance >= MIN_CLEARANCE_PT ? "ok" : "TOO CLOSE";
    console.log(
      `  page ${p.page}: footer at ${p.footerY}, lowest text at ${p.lowestBodyY} — ${clearance}pt ${verdict}`,
    );
    if (clearance < MIN_CLEARANCE_PT) failed.push(p.page);
  }

  if (failed.length > 0) {
    console.error(
      `\nFAILED. The running footer has less than ${MIN_CLEARANCE_PT}pt of clearance on ` +
        `page ${failed.join(", ")} — body text is printing into it. The band is reserved by the ` +
        `empty tfoot in proposal-html.ts; something has removed or shrunk it.`,
    );
    process.exit(1);
  }
  console.log(`\nOK. Worst clearance ${worst}pt across ${pages.length} pages.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
