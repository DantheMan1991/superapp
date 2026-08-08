import "server-only";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import { cellText, type SheetCellValue } from "../preview/cell";
import {
  EXTRACT_MAX_BYTES,
  EXTRACT_MAX_CHARS,
  EXTRACT_MAX_PDF_PAGES,
  EXTRACT_TIMEOUT_MS,
  isTextExtractable,
  type TextExtractionState,
} from "./state";

/**
 * The producer for `documents.extracted_text` — the column the search index has
 * read at weight D since drizzle/0026 and that nothing ever wrote.
 *
 * WHY THERE IS NO MODEL IN THIS FILE. The house pattern for AI here
 * (accounting/ai/extract.ts) is gather-and-gate in one tenant transaction, one
 * injectable network function, a per-tenant cooldown, Zod at the boundary. None
 * of that machinery is needed for a library call: there is no per-document
 * bill, so there is no cooldown to claim; there is no network hop, so there is
 * nothing to inject and nothing that must stay out of a transaction; and the
 * output is a string, so there is no shape to validate. Copying the pattern
 * anyway would be cargo-culting it.
 *
 * The split it DOES borrow is the honest one: a PDF carrying a text layer needs
 * nothing but a parser, while a scan needs vision. Rather than build two
 * pipelines, this is one dispatcher with a strategy per type — and the file
 * that needs vision is not guessed at, it is RECORDED as `empty`. That state is
 * the work queue an OCR pass would consume, and counting it is how the vision
 * question gets decided with evidence instead of with an estimate.
 *
 * Everything here is bounded before a byte is parsed. Extraction runs inline in
 * the action that registers an upload, so this function's worst case is a
 * person watching a spinner.
 */

export interface ExtractedText {
  text: string;
  state: TextExtractionState;
  /** Pages/sheets actually walked. Diagnostics for the backfill — never persisted. */
  scanned: number;
}

const EMPTY: ExtractedText = { text: "", state: "empty", scanned: 0 };

/**
 * Strip what Postgres cannot store and what a tsvector cannot use.
 *
 * The NUL is the one that matters and it is not hypothetical: a Postgres `text`
 * column CANNOT hold U+0000, so a mislabeled binary uploaded as `text/plain`
 * would take the whole INSERT down with `unsupported Unicode escape sequence` —
 * a failed upload, caused by a file we only meant to index. Every other control
 * character goes for the same reason it would be useless: the parser treats it
 * as a lexeme boundary anyway.
 *
 * Lone surrogates go too. `TextDecoder` never emits them, but a PDF string
 * table can, and Postgres rejects those as invalid UTF-8 just as firmly. A
 * correctly PAIRED surrogate is a single code point outside this class, so an
 * emoji or a CJK extension character survives.
 *
 * Written with Unicode property escapes rather than code-point ranges so this
 * source file contains no control characters of its own — an editor or a patch
 * that mangles one would otherwise silently change what gets stripped.
 *
 * Whitespace collapses last, and that is a capacity decision rather than
 * tidiness: a PDF text layer is mostly spacing, and the budget below is a
 * CHARACTER budget, so every run of spaces removed is another real word that
 * fits inside what the index will read.
 */
export function sanitizeExtractedText(raw: string): string {
  return (
    raw
      // Control characters except newline. `[^\P{Cc}\n]` reads as "is Cc AND
      // is not a newline" — \t and \r land here and become spaces.
      .replace(/[^\P{Cc}\n]/gu, " ")
      .replace(/\p{Cs}/gu, " ")
      // Horizontal whitespace runs -> one space. `[^\S\n]` is "whitespace that
      // is not a newline", which keeps line structure while flattening the rest.
      .replace(/[^\S\n]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim()
  );
}

/** How far back to look for a word boundary before giving up and cutting hard. */
const BOUNDARY_LOOKBACK = 100;

/**
 * Cut to the index's budget at a whitespace boundary.
 *
 * The boundary is worth the few lines: slicing mid-word invents a lexeme
 * ("concret") that matches nothing anyone would type, AND loses the real word.
 *
 * The lookback is an absolute window rather than a fraction of the budget. A
 * fraction reads as principled and is not: at a 200,000-character budget the
 * last space is essentially always within a handful of characters of the end,
 * so any percentage threshold either never fires or fires always depending on
 * a number nobody can reason about. "Is there a word boundary within the last
 * hundred characters?" is a question with an obvious answer either way, and it
 * degrades correctly — a single 200,000-character run-on has no boundary to
 * find and gets exactly the budget, hard cut.
 */
export function boundExtractedText(text: string, max = EXTRACT_MAX_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const window = Math.max(0, max - BOUNDARY_LOOKBACK);
  const lastBreak = cut.search(/\s\S*$/);
  return (lastBreak >= window && lastBreak > 0 ? cut.slice(0, lastBreak) : cut).trimEnd();
}

function finish(raw: string, scanned: number): ExtractedText {
  const text = boundExtractedText(sanitizeExtractedText(raw));
  return { text, state: text.length > 0 ? "done" : "empty", scanned };
}

/* -- PDF ------------------------------------------------------------------ */

type PdfModule = typeof import("pdfjs-dist");
let pdfjs: PdfModule | null = null;

/**
 * `legacy/build/` is the entry that runs without DOM globals — the default
 * `build/pdf.mjs`, which the browser preview uses, assumes a window. No worker
 * is configured on purpose: pdfjs then runs on the calling thread, which is
 * what we want in a serverless function that has no second thread to give it.
 */
async function loadPdfjs(): Promise<PdfModule> {
  if (!pdfjs) {
    pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as PdfModule;
  }
  return pdfjs;
}

async function extractPdf(bytes: Uint8Array, deadline: number): Promise<ExtractedText> {
  const lib = await loadPdfjs();
  let task: PDFDocumentLoadingTask | null = null;
  try {
    task = lib.getDocument({
      // pdfjs takes ownership of the buffer it is handed, so a copy keeps the
      // caller's bytes intact — they are also the bytes we hashed.
      data: new Uint8Array(bytes),
      // No font loading — we want the text layer, not a rendering, and a
      // stored file is untrusted input. (There is deliberately no
      // `isEvalSupported: false` alongside it: pdfjs 6 dropped the option
      // because it dropped the eval path it guarded. Re-adding it would not
      // fail the build, it would be silently ignored.)
      disableFontFace: true,
      // ERRORS only. Otherwise every document without embedded standard fonts
      // prints a `standardFontDataUrl` warning that is irrelevant to text.
      verbosity: 0,
    });
    const pdf = await task.promise;
    const pages = Math.min(pdf.numPages, EXTRACT_MAX_PDF_PAGES);
    const parts: string[] = [];
    let chars = 0;

    for (let n = 1; n <= pages; n++) {
      if (Date.now() > deadline) break;
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      // Joined with a space, never concatenated. Text items are positioned
      // fragments, so "...order 0042" and "Kitchen elevation" would run
      // together into the lexeme "0042Kitchen" — which matches neither of the
      // two words somebody would actually type.
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      page.cleanup();
      parts.push(pageText);
      chars += pageText.length;
      // Stop once the index's budget is spent. Parsing pages whose text can
      // never be stored is work nobody can benefit from.
      if (chars >= EXTRACT_MAX_CHARS) break;
    }
    return finish(parts.join("\n"), parts.length);
  } finally {
    // Releases the parsed document and its transport. Skipping it leaks for the
    // life of the process, which in a warm serverless container is long.
    await task?.destroy().catch(() => {});
  }
}

/* -- Spreadsheets --------------------------------------------------------- */

/**
 * Bounded by CHARACTERS rather than by the preview's 200 rows.
 *
 * The preview is a look, so it stops at a screenful. This is an index, so the
 * right bound is the one the index imposes — otherwise a 5,000-row takeoff
 * would be searchable for its first 200 rows and silently unsearchable for the
 * rest, which is the worst kind of partial because it looks like it works.
 */
async function extractXlsx(bytes: Uint8Array, deadline: number): Promise<ExtractedText> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );

  const parts: string[] = [];
  let chars = 0;
  let sheets = 0;

  for (const sheet of workbook.worksheets) {
    if (Date.now() > deadline || chars >= EXTRACT_MAX_CHARS) break;
    const lines: string[] = [];
    // eachRow/eachCell, never rowCount/columnCount — those are derived from
    // metadata the WRITING application chooses to emit, and a real Excel file
    // can report zero for a sheet full of data. The preview reader learned that
    // the expensive way; see the dossier.
    sheet.eachRow((row) => {
      if (chars >= EXTRACT_MAX_CHARS) return;
      const cells: string[] = [];
      row.eachCell((cell) => {
        const text = cellText(cell.value as SheetCellValue);
        if (text !== "") cells.push(text);
      });
      if (cells.length === 0) return;
      const line = cells.join(" ");
      lines.push(line);
      chars += line.length;
    });
    // A sheet that contributed nothing contributes NOTHING — not even its name.
    // Otherwise a brand-new workbook indexes the word "Sheet1", every such
    // workbook matches a search for it, and `empty` could never be reported for
    // a spreadsheet at all, which would quietly cost the state its meaning.
    if (lines.length === 0) continue;
    sheets += 1;
    // The sheet NAME goes in alongside its rows: "Takeoff", "Change orders",
    // "Sheet index" are how people describe the tab they are trying to find.
    parts.push(sheet.name ?? "", ...lines);
  }
  return finish(parts.join("\n"), sheets);
}

/* -- Plain text ----------------------------------------------------------- */

/**
 * `fatal: false` so a file with one bad byte still indexes the rest, with the
 * offender replaced by U+FFFD, rather than throwing the lot away.
 *
 * This path covers CSV and Markdown as well, and that is deliberate rather than
 * lazy: for a search index a CSV's delimiters and a Markdown file's syntax are
 * punctuation the tsquery parser discards anyway, so parsing either properly
 * would cost a dependency and change nothing anybody can search for.
 */
function extractPlainText(bytes: Uint8Array): ExtractedText {
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return finish(decoded, 1);
}

/* -- The dispatcher ------------------------------------------------------- */

/**
 * Read a document's text, or say why not. NEVER THROWS: every failure is a
 * state, because a file failing to index must not fail the upload that carried
 * it. The caller stores whatever comes back.
 */
export async function extractDocumentText(
  bytes: Uint8Array,
  mimeType: string,
  options: { timeoutMs?: number } = {},
): Promise<ExtractedText> {
  if (!isTextExtractable(mimeType)) {
    return { ...EMPTY, state: "unsupported" };
  }
  if (bytes.byteLength > EXTRACT_MAX_BYTES) {
    return { ...EMPTY, state: "too_large" };
  }
  if (bytes.byteLength === 0) return EMPTY;

  const timeoutMs = options.timeoutMs ?? EXTRACT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  // The deadline checked inside each loop is the one that normally fires, and
  // it stops cleanly — keeping the pages already read. This race is the
  // backstop for a SINGLE operation that hangs (one malformed page pdfjs never
  // returns from), where an in-loop check never gets its turn.
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<ExtractedText>((resolve) => {
    timer = setTimeout(() => resolve({ ...EMPTY, state: "failed" }), timeoutMs + 1_000);
  });

  // The catch is attached HERE rather than around the race, and that placement
  // is the whole point: if `guard` wins, the race settles and a `work` that
  // rejects a moment later would be an UNHANDLED rejection — which Node kills
  // the process for by default. A hung-then-failing PDF would take the server
  // down rather than failing one upload. Catching on `work` itself means it can
  // never reject, whoever wins.
  const work = (async (): Promise<ExtractedText> => {
    if (mimeType === "application/pdf") return extractPdf(bytes, deadline);
    if (
      mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) {
      return extractXlsx(bytes, deadline);
    }
    return extractPlainText(bytes);
  })().catch((err: unknown): ExtractedText => {
    // Corrupt bytes, a truncated PDF, a zip that is not a workbook. Logged
    // without the file's contents or its name — the identifier-only rule the
    // audit log follows, which console logging has no excuse to break.
    console.error(
      `text extraction failed (${mimeType}, ${bytes.byteLength} bytes)`,
      err instanceof Error ? err.message : err,
    );
    return { ...EMPTY, state: "failed" };
  });

  try {
    return await Promise.race([work, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
