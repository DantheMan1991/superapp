import "server-only";
import { existsSync } from "node:fs";
import { pressFor, PrintUnavailableError } from "./print-press";

/**
 * AN HTML DOCUMENT, PRINTED (E5b, ADR 0084).
 *
 * One function, and the only place in the repo that knows a browser exists.
 * `@react-pdf/renderer` lays out the invoices, the certificates and the
 * letterhead proposal and will go on doing so; this is for the documents that
 * are HTML because they need the page furniture a browser has and react-pdf
 * does not — today the estimate's brochure (ADR 0083), tomorrow whatever else
 * is written as a page.
 *
 * **THE HTML IS PASSED IN, NEVER FETCHED.** The caller has already rendered
 * the document in this process, so `setContent` prints the string it was
 * handed. A headless browser asking the app for its own URL would have to
 * carry the caller's session into Chromium to get past `requireTenant()`, and
 * a document assembled twice is a document that can differ from itself. This
 * is also where ADR 0083's rule pays for itself: the stylesheet is inline and
 * the logo is a data URI, so `load` is reached with nothing on the wire.
 *
 * **THE PAGE IS THE DOCUMENT'S BUSINESS.** `preferCSSPageSize` hands the paper
 * size and the margins to the document's own `@page` rule, so this file
 * chooses no measurements — the same discipline the HTML renderer keeps about
 * money.
 */

/** A dev browser prints our own page, so the flags are the two that matter. */
const LOCAL_ARGS = [
  // Containers give /dev/shm 64MB and Chromium wants more; this uses /tmp.
  "--disable-dev-shm-usage",
  // A root container cannot open the sandbox, and the page is our own HTML.
  "--no-sandbox",
  // Text metrics that match the pack's, so a local proof means something.
  "--font-render-hinting=none",
];

/** Long enough for a graceful close, short enough not to eat the function. */
const CLOSE_GRACE_MS = 5_000;

function after(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Nothing should be held open waiting for this.
    timer.unref?.();
  });
}

/**
 * The bytes of a PDF of `html`, printed by whatever browser this deployment
 * has. Throws `PrintUnavailableError` when it has none — a configuration fact,
 * not a failure — and anything else when the print itself broke.
 */
export async function printHtmlToPdf(html: string): Promise<Uint8Array> {
  const press = pressFor(process.env, process.platform, existsSync);
  if (press.kind === "none") throw new PrintUnavailableError(press.why);

  // Imported here and nowhere else: no route that does not print pays for
  // puppeteer, and the pack loader is never even reached on a laptop.
  const puppeteer = (await import("puppeteer-core")).default;

  let executablePath: string;
  let args: string[];
  let headless: boolean | "shell";
  if (press.kind === "pack") {
    const chromium = (await import("@sparticuz/chromium-min")).default;
    // Nothing on this page draws, so WebGL off — which also means swiftshader
    // is never extracted, saving both the time and the room in /tmp.
    chromium.setGraphicsMode = false;
    // First call downloads and inflates into /tmp; a warm one finds it there.
    executablePath = await chromium.executablePath(press.packUrl);
    args = chromium.args;
    // The pack ships chrome-headless-shell, which does not understand the
    // `--headless=new` that `headless: true` would ask for.
    headless = "shell";
  } else {
    executablePath = press.executablePath;
    args = LOCAL_ARGS;
    // A local Chrome or Edge is the full browser, so the modern mode.
    headless = true;
  }

  const browser = await puppeteer.launch({ executablePath, args, headless });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const bytes = await page.pdf({
      // The document's own `@page` decides the paper and the margins.
      preferCSSPageSize: true,
      // Without this the cover band, the accent rules and the DRAFT
      // watermark print white on white — the document would lose its colour.
      printBackground: true,
    });
    return new Uint8Array(bytes);
  } finally {
    /**
     * A `--single-process` Chromium can hang on a graceful close, and a hung
     * close spends the whole function timeout on a PDF that is already made.
     * So the close is given a few seconds and the process is killed after it.
     */
    await Promise.race([browser.close().catch(() => undefined), after(CLOSE_GRACE_MS)]);
    browser.process()?.kill("SIGKILL");
  }
}
