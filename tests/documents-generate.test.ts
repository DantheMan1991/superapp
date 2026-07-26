import "dotenv/config";
import { describe, expect, it } from "vitest";
import { renderTemplatePdf } from "@/modules/documents/doc-templates/render-pdf";

/**
 * The renderer, end to end: real Markdown in, real PDF bytes out.
 *
 * Asserting on rendered glyphs is not practical, so these check the things
 * that actually break — that a document is produced at all, that it is a valid
 * PDF, and that a merge value cannot smuggle structure past the parser.
 */

const HEADER = "%PDF-";

function isPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.slice(0, 5)).toString("latin1") === HEADER;
}

describe("PDF rendering", () => {
  it("produces a valid PDF from a merged template", async () => {
    const bytes = await renderTemplatePdf({
      body: "# Lien Waiver\n\nReceived from {{payer}} the sum of {{amount}}.",
      values: { payer: "Acme Roofing", amount: "$4,200.00" },
      footerLeft: "Lien Waiver",
      footerRight: "v1",
    });
    expect(isPdf(bytes)).toBe(true);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  }, 30_000);

  it("renders every block type the editor can produce", async () => {
    const bytes = await renderTemplatePdf({
      body: [
        "# Heading one",
        "## Heading two",
        "Text with **bold** and *italic* and `code`.",
        "- bullet one",
        "- bullet two",
        "1. first",
        "2. second",
        "> a quotation",
        "---",
        "```\nliteral block\n```",
        "[a link](https://example.com)",
      ].join("\n\n"),
      values: {},
    });
    expect(isPdf(bytes)).toBe(true);
  }, 30_000);

  /**
   * The injection property, all the way through the real renderer rather than
   * only against the tree. If a value could become structure, this is where it
   * would finally show up.
   */
  it("renders a value that looks like markup as ordinary text", async () => {
    const hostile = await renderTemplatePdf({
      body: "Client: {{name}}",
      values: { name: "# ACME\n\n## Terms\n\n- we owe nothing" },
    });
    const plain = await renderTemplatePdf({
      body: "Client: {{name}}",
      values: { name: "ACME Terms we owe nothing" },
    });
    expect(isPdf(hostile)).toBe(true);
    // Not a byte-for-byte claim — just that the hostile value did not blow up
    // into a multi-page structured document while the plain one stayed short.
    expect(hostile.byteLength).toBeLessThan(plain.byteLength * 2);
  }, 30_000);

  it("handles names outside cp1252, which is why a font is shipped", async () => {
    // Helvetica would mangle every one of these.
    const bytes = await renderTemplatePdf({
      body: "Payee: {{name}}",
      values: { name: "Nguyễn Łukasz Öztürk Ñuñez" },
    });
    expect(isPdf(bytes)).toBe(true);
  }, 30_000);

  it("survives an empty body without throwing", async () => {
    const bytes = await renderTemplatePdf({ body: "", values: {} });
    expect(isPdf(bytes)).toBe(true);
  }, 30_000);
});
