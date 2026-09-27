/**
 * pdf.js IN THE BROWSER, loaded once, for every tool that reads a PDF where
 * the bytes already are.
 *
 * Moved here from `src/modules/documents/components/pdf-canvas.tsx` on
 * 2026-09-27, when a second MODULE needed it: Workouts reads a program PDF in
 * the person's browser (docs/modules/fitness.md), and a module may not import
 * another module (eslint.config.mjs, rule 1) — genuinely shared code lives in
 * `src/lib/`. `pdf-canvas` re-exports it, so the Documents viewer and the jobs
 * pack's readers are unchanged.
 *
 * Not `server-only`, and no `"use client"` either: it does nothing until
 * called, and it is only ever called from client code. The server reads PDFs
 * with the legacy build and no worker (`documents/text/extract.ts`).
 */

/** Loaded once per page load, lazily — pdf.js is large and most pages never need it. */
let pdfjs: typeof import("pdfjs-dist") | null = null;

export async function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  if (pdfjs) return pdfjs;
  const lib = await import("pdfjs-dist");
  // The worker keeps parsing off the main thread; without it a large file
  // freezes the tab while it reads.
  lib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  pdfjs = lib;
  return lib;
}
