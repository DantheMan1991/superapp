import { describe, expect, it } from "vitest";
import {
  getBuildDoc,
  listBuildDocs,
} from "../src/lib/build-docs";

/**
 * `/admin/docs` reads the real `docs/` tree off disk, so these run against the
 * actual build record rather than a fixture. That is the point: the failures
 * this guards are ones where a doc is written correctly and the PAGE shows
 * something else.
 *
 * No database anywhere near it — `build-docs.ts` is filesystem only, which is
 * why this belongs on the parallel side.
 */
describe("build docs", () => {
  it("STRIPS AUTHORING COMMENTS OUT OF WHAT THE PAGE RENDERS", async () => {
    /**
     * **`<!-- keep Status on ONE line ... -->` was rendering as visible text**
     * in the header of 21 of the 29 docs that carry a `Status:` line —
     * `react-markdown` runs without `rehype-raw`, so an HTML comment is not
     * rendered as markup and is not dropped either; it comes through as the
     * literal characters.
     *
     * The index cards were always clean, because `stripInline` removes
     * comments when it builds a summary. Only the doc pages were wrong, which
     * is why it survived this long.
     */
    const doc = await getBuildDoc("modules/inventory");
    expect(doc).not.toBeNull();
    expect(doc!.content).not.toContain("<!--");
    // The comment sits ON the Status line, so the line has to survive it.
    expect(doc!.statusLine).toContain("available");
  });

  it("renders a doc from every folder under docs/, not just modules/", async () => {
    /**
     * The walker takes the whole tree, and it exists because it once did not:
     * four platform docs and every ADR were invisible on the page no matter how
     * carefully they were written. `briefs/` is the newest folder and the
     * cheapest thing to get wrong, because nothing else reads it.
     */
    const sections = await listBuildDocs();
    const keys = new Set(sections.map((s) => s.key));
    for (const key of ["", "modules", "decisions", "briefs", "runbooks"]) {
      expect(keys).toContain(key);
    }
    const briefs = sections.find((s) => s.key === "briefs")!;
    expect(briefs.docs.length).toBeGreaterThan(0);
    expect(briefs.blurb).not.toBe("");
  });

  it("gives the accountant brief a title, a summary and a status", async () => {
    // It is the one doc here written to leave the building, so a broken header
    // on it is worse than a broken header anywhere else on the page.
    const doc = await getBuildDoc("briefs/inventory-tax-treatment");
    expect(doc).not.toBeNull();
    /**
     * **NOT the exact wording.** The first version of this asserted the title
     * contained "deduction", and the very next edit to the brief retitled it
     * from "become a deduction" to "be deducted". A test that fails when prose
     * is improved is a test that teaches people not to improve prose.
     *
     * What it actually guards is the fallback: `parseMeta` uses the SLUG as the
     * title when a file has no `# ` heading, so a doc with a broken header
     * renders as "inventory-tax-treatment" and nobody notices.
     */
    expect(doc!.title).not.toBe("inventory-tax-treatment");
    expect(doc!.title.length).toBeGreaterThan(10);
    expect(doc!.summary).not.toBe("");
    expect(doc!.statusLine).toContain("brief");
  });

  it("never lists the tenant guides as build docs", async () => {
    // `docs/help/` is written for the client and rendered inside the product
    // by guides.ts, with its `{{vocabulary}}` resolved per tenant. On this
    // page it would appear as an unexplained "Help" section full of
    // placeholders — so the walker skips the folder, and this is the check
    // that it keeps doing so.
    const sections = await listBuildDocs();
    expect(sections.map((s) => s.key)).not.toContain("help");
    expect(await getBuildDoc("help/workspace/getting-around")).toBeNull();
  });
});
