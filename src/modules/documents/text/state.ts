/**
 * The vocabulary of "can search reach inside this file?".
 *
 * Pure and marker-free on purpose — the same rule as `doc-templates/fields.ts`.
 * `extract.ts` owns pdfjs and exceljs and is `server-only`; importing even a
 * TYPE from it drags those parsers toward the browser bundle. Anything a client
 * component needs to know about extraction lives here.
 */

/**
 * Why a document's contents are, or are not, in the search index.
 *
 * Six states rather than a boolean, because "I searched for a phrase I can see
 * in this file and got nothing" has six different answers and only one of them
 * is a bug. This column is the operational record that tells them apart — in
 * particular it is what measures how much OCR would actually buy before anyone
 * pays for OCR.
 *
 * `text` + CHECK rather than a pgEnum, following the module's standing rule:
 * `ALTER TYPE ... ADD VALUE` cannot be used in the transaction that adds it and
 * Drizzle wraps each migration in one, so a seventh state would need its own
 * migration file containing one statement.
 */
export const TEXT_EXTRACTION_STATES = [
  /** Never attempted. Every row that predates this feature, and the backfill's queue. */
  "pending",
  /** A strategy ran and produced text. */
  "done",
  /**
   * A strategy ran and the file genuinely says nothing: a scanned PDF with no
   * text layer, a blank sheet. NOT a failure — this is the OCR work queue, and
   * counting these rows is how the vision question gets decided with evidence.
   */
  "empty",
  /** No strategy exists for this type. Images, Word, PowerPoint, zip. */
  "unsupported",
  /** Over EXTRACT_MAX_BYTES. A supported type we declined to parse. */
  "too_large",
  /** A strategy threw — corrupt bytes, an unreadable blob, or the timeout. Retried by the backfill. */
  "failed",
] as const;

export type TextExtractionState = (typeof TEXT_EXTRACTION_STATES)[number];

/**
 * The character budget, and it is not a taste — it is the number baked into
 * the search index.
 *
 * `search_tsv` indexes `left(extracted_text, 200000)` (drizzle/0026, kept by
 * 0027) because a tsvector has a hard 1MB limit and an unbounded dump would
 * make INSERTs start failing later, in production, on a table that was fine
 * yesterday. Storing more than the index reads is bytes nobody can ever find,
 * so the producer honours the consumer's bound rather than letting the index
 * truncate silently.
 *
 * Change this and drizzle/0026's `left(...)` together, or the two disagree.
 */
export const EXTRACT_MAX_CHARS = 200_000;

/**
 * Refuse to parse a blob larger than this. The same number the spreadsheet
 * preview refuses at, so the module has one legibility rule rather than two.
 *
 * Uploads are allowed up to 100MB (a set of drawings is not a phone photo), so
 * this genuinely declines some files — hence `too_large` being a state you can
 * count rather than a silent skip.
 */
export const EXTRACT_MAX_BYTES = 25 * 1024 * 1024;

/** Pages of a PDF to walk. Past this the cost is real and the tail is boilerplate. */
export const EXTRACT_MAX_PDF_PAGES = 100;

/**
 * Wall-clock budget for one document. A pathological PDF must not be able to
 * hang an upload — extraction runs inline in the action that registers the
 * file, so its worst case is the user's worst case.
 */
export const EXTRACT_TIMEOUT_MS = 20_000;

/**
 * MIME types a strategy exists for. Everything else is `unsupported`, which is
 * a recorded answer rather than a silent one.
 *
 * Notably absent and deliberately so:
 *  - images — a photo of a job site has no text layer to read; that is OCR.
 *  - Word / PowerPoint — OOXML is a zip, and no zip reader is a declared
 *    dependency here. The module already tells users these cannot be previewed.
 *  - legacy .doc / .xls — binary formats with no library worth the risk.
 *  - application/zip — a container, not a document.
 *  - message/rfc822 — ALREADY populated, by the mail seam, with the message
 *    transcript. Re-extracting would overwrite a better answer with a worse one.
 */
export const TEXT_EXTRACTABLE_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

const EXTRACTABLE = new Set<string>(TEXT_EXTRACTABLE_MIME_TYPES);

export function isTextExtractable(mimeType: string): boolean {
  return EXTRACTABLE.has(mimeType);
}

/**
 * What to tell somebody who cannot find a file by its contents.
 *
 * Lives here rather than in a component so both the browse UI and the backfill
 * script's summary say the same thing about the same state.
 */
export function describeTextExtraction(state: TextExtractionState): string {
  switch (state) {
    case "done":
      return "Contents are searchable.";
    case "empty":
      return "No text layer — this looks like a scan or a photo, so only its name and details are searchable.";
    case "unsupported":
      return "This file type's contents cannot be read yet, so only its name and details are searchable.";
    case "too_large":
      return "Too large to read — only its name and details are searchable.";
    case "failed":
      return "Its contents could not be read.";
    case "pending":
      return "Not read yet.";
  }
}

/**
 * True when a file's CONTENTS are in the search index.
 *
 * The negative is what the UI acts on, and it is deliberately not
 * `state !== "done"` written out at each call site: `done` is the only state
 * that means "searchable", and a seventh state added later must default to
 * "say something" rather than silently join the searchable pile.
 */
export function isContentSearchable(state: TextExtractionState): boolean {
  return state === "done";
}

/** How many documents sit in each state. Counts only — never a document id. */
export type TextExtractionTally = Partial<Record<TextExtractionState, number>>;

/**
 * A short phrase per state, for the aggregate note on the search page.
 *
 * Separate from `describeTextExtraction` because the grammar is different: that
 * one is a sentence about ONE file you are looking at, this one is a fragment
 * counting many ("3 scans with no text layer"). Sharing one string would make
 * both read badly.
 */
function countPhrase(state: TextExtractionState, n: number): string {
  const plural = n === 1 ? "" : "s";
  switch (state) {
    case "empty":
      return `${n} scan${plural} with no text layer`;
    case "unsupported":
      return `${n} file${plural} of a type we cannot read yet`;
    case "too_large":
      return `${n} file${plural} too large to read`;
    case "failed":
      return `${n} file${plural} we could not read`;
    case "pending":
      return `${n} file${plural} not read yet`;
    case "done":
      return `${n} file${plural}`;
  }
}

export interface UnsearchableSummary {
  /** Documents whose CONTENTS are not in the index. Never zero — null instead. */
  total: number;
  /** "3 scans with no text layer", "1 file we could not read" — worst first. */
  parts: string[];
}

/**
 * Turn a tally into the note shown under a search.
 *
 * Returns **null when there is nothing to say**, which is the whole point: a
 * cabinet whose files all read cleanly must not carry a permanent banner about
 * a problem it does not have. Announcing the absence of a problem is how a
 * useful warning becomes furniture people stop seeing.
 *
 * `done` is excluded rather than reported as good news, for the same reason.
 *
 * Ordered by how actionable the state is, not by count: `pending` leads because
 * somebody can fix it today by running the backfill, whereas `empty` needs OCR
 * that does not exist yet. A user reading this should meet the fixable thing
 * first.
 */
export function summarizeUnsearchable(
  tally: TextExtractionTally,
): UnsearchableSummary | null {
  const order: TextExtractionState[] = [
    "pending",
    "failed",
    "too_large",
    "unsupported",
    "empty",
  ];
  const parts: string[] = [];
  let total = 0;
  for (const state of order) {
    const n = tally[state] ?? 0;
    if (n <= 0) continue;
    total += n;
    parts.push(countPhrase(state, n));
  }
  return total === 0 ? null : { total, parts };
}
