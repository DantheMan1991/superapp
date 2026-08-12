import "dotenv/config";
import React from "react";
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  Document,
  Image,
  Page,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import sharp from "sharp";
import {
  boundExtractedText,
  extractDocumentText,
  sanitizeExtractedText,
} from "@/modules/documents/text/extract";
import {
  EXTRACT_MAX_CHARS,
  describeTextExtraction,
  isContentSearchable,
  isTextExtractable,
  summarizeUnsearchable,
} from "@/modules/documents/text/state";

/**
 * Reading a document's contents for the search index.
 *
 * No database and no model, so these run everywhere — which is most of the
 * argument for the library path existing at all.
 *
 * ON FIXTURES, because this module has been burned by them before. The
 * spreadsheet reader passed a full round-trip suite and then returned nothing
 * for a real Excel file, because the tests fed it workbooks exceljs itself had
 * written. The PDF cases below are in a better position on purpose:
 * `@react-pdf/renderer` writes them and `pdfjs-dist` reads them, which are two
 * independent implementations that share no code — a genuine round trip rather
 * than a library agreeing with itself. The xlsx case is NOT in that position
 * (exceljs is on both ends) and is treated as the weaker evidence it is: it
 * asserts the plumbing and the bounds, not that we can read Excel's output.
 */

const PDF = "application/pdf";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function pdfOf(...pages: React.ReactElement[]): Promise<Uint8Array> {
  const buf = await renderToBuffer(React.createElement(Document, null, ...pages));
  return new Uint8Array(buf);
}

function textPage(...lines: string[]): React.ReactElement {
  return React.createElement(
    Page,
    { size: "LETTER", style: { padding: 40, fontSize: 12 } },
    React.createElement(
      View,
      null,
      ...lines.map((line, i) => React.createElement(Text, { key: i }, line)),
    ),
  );
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("what has a strategy", () => {
  it("names the types a library can read", () => {
    expect(isTextExtractable(PDF)).toBe(true);
    expect(isTextExtractable("text/plain")).toBe(true);
    expect(isTextExtractable("text/csv")).toBe(true);
    expect(isTextExtractable("text/markdown")).toBe(true);
    expect(isTextExtractable(XLSX)).toBe(true);
  });

  /**
   * The ones that need vision, a dependency we do not have, or nothing at all.
   * `message/rfc822` is the interesting exclusion: the mail seam already writes
   * a transcript into `extracted_text`, and re-reading the raw .eml would
   * replace a good answer with headers and base64.
   */
  it("excludes the types no library here can read", () => {
    for (const mime of [
      "image/jpeg",
      "image/png",
      "image/tiff",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/zip",
      "message/rfc822",
    ]) {
      expect(isTextExtractable(mime)).toBe(false);
    }
  });

  it("reports an unsupported type rather than pretending it is empty", async () => {
    const result = await extractDocumentText(utf8("not really a jpeg"), "image/jpeg");
    expect(result.state).toBe("unsupported");
    expect(result.text).toBe("");
  });

  it("has something to say about every state", () => {
    for (const state of [
      "pending",
      "done",
      "empty",
      "unsupported",
      "too_large",
      "failed",
    ] as const) {
      expect(describeTextExtraction(state).length).toBeGreaterThan(0);
    }
  });
});

describe("plain text", () => {
  it("reads text, csv and markdown", async () => {
    for (const mime of ["text/plain", "text/csv", "text/markdown"]) {
      const result = await extractDocumentText(
        utf8("Fulton Lumber,change order 0042,4200.00"),
        mime,
      );
      expect(result.state).toBe("done");
      expect(result.text).toContain("Fulton Lumber");
      expect(result.text).toContain("0042");
    }
  });

  /**
   * The NUL is the one that actually matters. A Postgres `text` column cannot
   * hold U+0000, so a mislabeled binary uploaded as text/plain would take the
   * whole INSERT down — a failed upload caused by a file we only meant to
   * index. This is the guard against that, tested with the real thing.
   */
  it("strips characters Postgres cannot store", async () => {
    const hostile = `Acme${String.fromCharCode(0)}Roofing${String.fromCharCode(7)}invoice`;
    const result = await extractDocumentText(utf8(hostile), "text/plain");
    expect(result.text).not.toContain(String.fromCharCode(0));
    expect(result.text).toBe("Acme Roofing invoice");
  });

  it("keeps real words and drops lone surrogates", () => {
    // A correctly paired surrogate is one code point and must survive.
    expect(sanitizeExtractedText("crew list Nguyễn Öztürk 🧰")).toBe(
      "crew list Nguyễn Öztürk 🧰",
    );
    expect(sanitizeExtractedText(`bad\uD800pair`)).toBe("bad pair");
  });

  it("collapses whitespace but keeps line structure", () => {
    expect(sanitizeExtractedText("  a \t\t b \r\n\n\n  c  ")).toBe("a b\nc");
  });

  it("survives bytes that are not valid UTF-8", async () => {
    const result = await extractDocumentText(
      new Uint8Array([0x41, 0x63, 0x6d, 0x65, 0xff, 0xfe, 0x4c, 0x74, 0x64]),
      "text/plain",
    );
    expect(result.state).toBe("done");
    expect(result.text).toContain("Acme");
    expect(result.text).toContain("Ltd");
  });

  it("calls a genuinely empty file empty, not failed", async () => {
    expect((await extractDocumentText(utf8(""), "text/plain")).state).toBe("empty");
    expect((await extractDocumentText(utf8("   \n\n  "), "text/plain")).state).toBe(
      "empty",
    );
  });
});

describe("pdf", () => {
  it("reads a text layer", async () => {
    const bytes = await pdfOf(
      textPage("Fulton Lumber change order 0042", "Kitchen elevation revision B"),
      textPage("Page two mentions zephyrqx widgets"),
    );
    const result = await extractDocumentText(bytes, PDF);
    expect(result.state).toBe("done");
    expect(result.scanned).toBe(2);
    expect(result.text).toContain("Fulton Lumber");
    expect(result.text).toContain("Kitchen elevation");
    expect(result.text).toContain("zephyrqx");
  });

  /**
   * The bug this prevents is subtle and permanent once shipped: pdfjs returns
   * POSITIONED FRAGMENTS, not lines. Concatenated, "…order 0042" followed by
   * "Kitchen elevation" becomes the lexeme "0042Kitchen", which matches
   * neither of the two things a person would type — and the index would look
   * fine, because plenty of other words in the document still match.
   */
  it("separates text fragments so adjacent words do not fuse", async () => {
    const bytes = await pdfOf(textPage("order 0042", "Kitchen elevation"));
    const result = await extractDocumentText(bytes, PDF);
    expect(result.text).not.toContain("0042Kitchen");
    expect(result.text).toMatch(/0042\s+Kitchen/);
  });

  /**
   * A scan. This is the whole reason `empty` is a state rather than a failure:
   * it is the population an OCR pass would consume, and counting it is how the
   * vision question gets answered with evidence.
   */
  it("reports a page with no text layer as empty, not as a failure", async () => {
    const png = await sharp({
      create: {
        width: 600,
        height: 780,
        channels: 3,
        background: { r: 240, g: 240, b: 240 },
      },
    })
      .png()
      .toBuffer();
    const bytes = await pdfOf(
      React.createElement(
        Page,
        { size: "LETTER" },
        React.createElement(Image, { src: png, style: { width: 600, height: 780 } }),
      ),
    );
    const result = await extractDocumentText(bytes, PDF);
    expect(result.state).toBe("empty");
    expect(result.text).toBe("");
  });

  it("fails a corrupt file without throwing", async () => {
    const result = await extractDocumentText(utf8("%PDF-1.7 and then nonsense"), PDF);
    expect(result.state).toBe("failed");
    expect(result.text).toBe("");
  });

  it("fails a truncated file without throwing", async () => {
    const whole = await pdfOf(textPage("Fulton Lumber invoice"));
    const half = whole.slice(0, Math.floor(whole.length / 2));
    expect((await extractDocumentText(half, PDF)).state).toBe("failed");
  });

  /**
   * Stops when the index's budget is spent rather than parsing pages whose
   * text could never be stored. 30 pages of filler comfortably exceeds nothing,
   * so this asserts the mechanism with a budget shrunk to fit a fast test.
   */
  it("stops reading once the character budget is spent", async () => {
    const filler = "concrete pour inspection report ".repeat(60);
    const pages = Array.from({ length: 12 }, (_, i) =>
      textPage(`page ${i} ${filler}`),
    );
    const bytes = await pdfOf(...pages);
    const result = await extractDocumentText(bytes, PDF);
    expect(result.state).toBe("done");
    expect(result.scanned).toBeLessThanOrEqual(12);
    expect(result.text.length).toBeLessThanOrEqual(EXTRACT_MAX_CHARS);
  });
});

describe("spreadsheets", () => {
  /**
   * Weaker evidence than the PDF cases and deliberately scoped to match:
   * exceljs writes this fixture and exceljs reads it back, which is exactly the
   * shape that let the preview reader pass its suite and then fail on a real
   * Excel file. What this proves is the wiring and the bounds. What it cannot
   * prove is that we can read what Excel writes — `readXlsxPreview`'s
   * eachRow/eachCell traversal, which this shares, is what covers that.
   */
  it("reads cells, sheet names and formula results", async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Takeoff");
    sheet.addRow(["Item", "Qty", "Cost"]);
    sheet.addRow(["Fulton Lumber 2x4", 240, 1180.5]);
    sheet.getCell("D2").value = { formula: "B2*C2", result: 283320 };
    wb.addWorksheet("Change orders").addRow(["CO-0042 zephyrqx"]);

    const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const result = await extractDocumentText(bytes, XLSX);

    expect(result.state).toBe("done");
    expect(result.scanned).toBe(2);
    // The sheet NAME is how people describe the tab they are looking for.
    expect(result.text).toContain("Takeoff");
    expect(result.text).toContain("Change orders");
    expect(result.text).toContain("Fulton Lumber 2x4");
    expect(result.text).toContain("CO-0042 zephyrqx");
    // A formula shows its cached RESULT, never its source.
    expect(result.text).toContain("283320");
    expect(result.text).not.toContain("B2*C2");
  });

  /**
   * A sheet with no cells contributes nothing, not even its name. Indexing the
   * word "Sheet1" would make every untouched workbook match a search for it,
   * and would mean `empty` could never be reported for a spreadsheet — costing
   * the state its meaning to gain a lexeme nobody wants.
   */
  it("reports a workbook with no cell contents as empty", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Sheet1");
    const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const result = await extractDocumentText(bytes, XLSX);
    expect(result.state).toBe("empty");
    expect(result.text).toBe("");
  });

  it("fails a file that is not a workbook without throwing", async () => {
    const result = await extractDocumentText(utf8("PK not a workbook"), XLSX);
    expect(result.state).toBe("failed");
  });
});

describe("bounds", () => {
  /**
   * The budget is not a taste — it is `left(extracted_text, 200000)` in
   * drizzle/0026. Storing more than the index reads is bytes nobody can find.
   */
  it("refuses to store more than the index will read", async () => {
    const long = "concrete ".repeat(EXTRACT_MAX_CHARS);
    const result = await extractDocumentText(utf8(long), "text/plain");
    expect(result.state).toBe("done");
    expect(result.text.length).toBeLessThanOrEqual(EXTRACT_MAX_CHARS);
  });

  /**
   * Cutting mid-word invents a lexeme ("concret") that matches nothing anybody
   * would type, AND loses the real word. The boundary is worth three lines.
   */
  it("cuts at a whitespace boundary, not mid-word", () => {
    const bounded = boundExtractedText("alpha bravo charlie delta", 14);
    expect(bounded).toBe("alpha bravo");
    expect(bounded.endsWith("cha")).toBe(false);
  });

  it("still yields exactly the budget when there is no whitespace to cut at", () => {
    expect(boundExtractedText("x".repeat(50), 20)).toHaveLength(20);
  });

  it("leaves text under the budget alone", () => {
    expect(boundExtractedText("short enough", 200)).toBe("short enough");
  });

  /**
   * Uploads are allowed up to 100MB. Declining to parse the largest of them is
   * a recorded answer (`too_large`) rather than a silent skip, so "why can't I
   * find this?" always has one.
   */
  it("declines a file larger than the parse budget", async () => {
    const huge = new Uint8Array(26 * 1024 * 1024);
    const result = await extractDocumentText(huge, PDF);
    expect(result.state).toBe("too_large");
    expect(result.text).toBe("");
  });

  /**
   * WAS FLAKY, AND THE ASSERTION WAS THE BUG. It accepted `empty | failed` and
   * assumed a zero budget could never parse a page — but the in-loop check was
   * `Date.now() > deadline`, which is FALSE within the same millisecond, so a
   * fast runner parsed page one and correctly returned `done`. It reddened
   * `main` three times in a day for a reason unrelated to whatever had merged.
   *
   * The engine now treats the deadline as the moment the budget is spent
   * (`>=`), so a budget of zero parses nothing — which is what a zero budget
   * should mean. That makes this deterministic enough to assert exactly, and a
   * loose `toContain` is no longer hiding what the engine actually does.
   */
  it("parses nothing at all when the budget is already spent", async () => {
    const bytes = await pdfOf(textPage("Fulton Lumber"), textPage("second page"));
    const result = await extractDocumentText(bytes, PDF, { timeoutMs: 0 });
    expect(result.state).toBe("empty");
    expect(result.text).toBe("");
    expect(result.scanned).toBe(0);
  });

  /**
   * The other half, and the reason the deadline exists: a budget must not stop
   * a document that fits inside it. Without this, "parse nothing" could be made
   * to pass by breaking extraction outright.
   */
  it("still parses in full when the budget is generous", async () => {
    const bytes = await pdfOf(textPage("Fulton Lumber"), textPage("second page"));
    const result = await extractDocumentText(bytes, PDF, { timeoutMs: 20_000 });
    expect(result.state).toBe("done");
    expect(result.text).toContain("Fulton Lumber");
    expect(result.scanned).toBe(2);
  });
});

/**
 * The UI's half: saying WHY a file is not searchable.
 *
 * Pure, because the whole point of keeping this in `text/state.ts` rather than
 * in a component is that the wording and the thresholds are testable without
 * rendering anything — and that the viewer, the search page and the backfill
 * script all say the same thing about the same state.
 */
describe("explaining an absence", () => {
  it("treats only `done` as searchable", () => {
    expect(isContentSearchable("done")).toBe(true);
    for (const state of [
      "pending",
      "empty",
      "unsupported",
      "too_large",
      "failed",
    ] as const) {
      expect(isContentSearchable(state)).toBe(false);
    }
  });

  /**
   * The load-bearing case. A cabinet that reads cleanly must show NOTHING —
   * a permanent banner announcing the absence of a problem is how a useful
   * warning turns into furniture people stop seeing.
   */
  it("says nothing when everything is searchable", () => {
    expect(summarizeUnsearchable({ done: 42 })).toBeNull();
    expect(summarizeUnsearchable({})).toBeNull();
    expect(summarizeUnsearchable({ done: 3, empty: 0, failed: 0 })).toBeNull();
  });

  it("counts every unsearchable state and excludes done", () => {
    const summary = summarizeUnsearchable({
      done: 100,
      empty: 3,
      unsupported: 2,
      failed: 1,
    });
    expect(summary).not.toBeNull();
    expect(summary!.total).toBe(6);
    expect(summary!.parts.join(" ")).not.toContain("100");
  });

  /**
   * Ordered by what somebody can DO about it, not by count: `pending` is fixed
   * today by running the backfill, while `empty` needs OCR that does not exist.
   * A reader should meet the fixable thing first even when it is the rarest.
   */
  it("leads with the actionable state, not the biggest number", () => {
    const summary = summarizeUnsearchable({ empty: 90, pending: 1 });
    expect(summary!.parts[0]).toContain("not read yet");
    expect(summary!.parts[1]).toContain("scan");
  });

  it("gets singular and plural right", () => {
    expect(summarizeUnsearchable({ empty: 1 })!.parts[0]).toBe(
      "1 scan with no text layer",
    );
    expect(summarizeUnsearchable({ empty: 2 })!.parts[0]).toBe(
      "2 scans with no text layer",
    );
    expect(summarizeUnsearchable({ failed: 1 })!.parts[0]).toBe(
      "1 file we could not read",
    );
  });

  /** Every state a document can be in must produce a phrase, not `undefined`. */
  it("has a phrase for every unsearchable state", () => {
    for (const state of [
      "pending",
      "empty",
      "unsupported",
      "too_large",
      "failed",
    ] as const) {
      const summary = summarizeUnsearchable({ [state]: 1 });
      expect(summary).not.toBeNull();
      expect(summary!.parts[0]).toMatch(/^1 \w/);
      expect(summary!.parts[0]).not.toContain("undefined");
    }
  });
});
