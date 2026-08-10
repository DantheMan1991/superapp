import "server-only";
import path from "node:path";
import { Font } from "@react-pdf/renderer";

/**
 * Noto Sans, registered with @react-pdf/renderer once per process.
 *
 * Lives in `src/lib/` rather than inside a module because two modules now
 * generate PDFs — Documents (templates) and Accounting (invoices) — and
 * eslint.config.mjs forbids one module importing another. Same reasoning that
 * moved the money helpers to `@/lib/money`: genuinely shared code goes here,
 * and a second copy of a 1MB font binary is not a second implementation but it
 * is one more thing to keep in step.
 *
 * WHY NOT the built-in Helvetica: PDF's built-in faces are WinAnsi (cp1252)
 * only. That covers `ñ` but silently mangles `Nguyễn`, `Łukasz`, `Öztürk` —
 * ordinary names on an ordinary invoice, and an invoice that misspells the
 * customer is a defective document.
 *
 * Registered from disk paths rather than a URL so generation never makes a
 * network call. Every route that renders a PDF must trace this directory into
 * its serverless bundle — see `outputFileTracingIncludes` in next.config.ts,
 * without which the fonts are absent in production and generation fails at
 * request time, a failure that cannot reproduce locally.
 */
let fontsReady = false;

export function ensureNotoSans(): void {
  if (fontsReady) return;
  // Absolute path off process.cwd(), matching src/lib/build-docs.ts, which
  // already reads repo files at request time on this deployment.
  const dir = path.join(process.cwd(), "src", "lib", "pdf", "fonts");
  // All FOUR faces. react-pdf does not synthesize: it throws "Could not
  // resolve font for NotoSans, fontStyle italic" at render time if a face is
  // missing, so an unregistered combination is a failed document rather than a
  // slightly wrong one.
  Font.register({
    family: "NotoSans",
    fonts: [
      { src: path.join(dir, "NotoSans-Regular.ttf") },
      { src: path.join(dir, "NotoSans-Bold.ttf"), fontWeight: "bold" },
      { src: path.join(dir, "NotoSans-Italic.ttf"), fontStyle: "italic" },
      {
        src: path.join(dir, "NotoSans-BoldItalic.ttf"),
        fontWeight: "bold",
        fontStyle: "italic",
      },
    ],
  });
  // Without this, long unbroken strings (a URL, a 40-character part number)
  // overflow the page instead of wrapping.
  Font.registerHyphenationCallback((word) => [word]);
  fontsReady = true;
}

/** The directory the TTFs live in — for next.config.ts tracing and tests. */
export const NOTO_SANS_DIR = "./src/lib/pdf/fonts";
