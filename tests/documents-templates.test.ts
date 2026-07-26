import "dotenv/config";
import { describe, expect, it } from "vitest";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString as mdToString } from "mdast-util-to-string";
import {
  extractMergeFields,
  injectValues,
  isValidFieldName,
  missingFields,
  placeholderFor,
  type MdNode,
} from "@/modules/documents/doc-templates/merge";

/**
 * The merge engine. Pure, so these run everywhere.
 *
 * The injection tests are the point of this file. A merge value is content, not
 * syntax, and the only way to keep that true is to put it into the tree AFTER
 * parsing. Everything below is a way of asking "did a value manage to become
 * structure?" — and the answer must always be no.
 */

/** Parse real Markdown so the tests exercise a real mdast tree, not a mock. */
const parse = (src: string) => fromMarkdown(src) as unknown as MdNode;

/** Node types present anywhere in the tree — how we detect smuggled syntax. */
function typesIn(node: MdNode): string[] {
  const out: string[] = [node.type];
  for (const child of node.children ?? []) out.push(...typesIn(child));
  return out;
}

describe("merge field names", () => {
  it("accepts identifier-shaped names and rejects the rest", () => {
    expect(isValidFieldName("client_name")).toBe(true);
    expect(isValidFieldName("amount2")).toBe(true);
    expect(isValidFieldName("2amount")).toBe(false);
    expect(isValidFieldName("client name")).toBe(false);
    expect(isValidFieldName("client-name")).toBe(false);
    expect(isValidFieldName("")).toBe(false);
    expect(isValidFieldName("x".repeat(41))).toBe(false);
  });

  it("extracts distinct fields in the order a form should ask for them", () => {
    const source = "Dear {{client_name}}, re {{job}}. Regards, {{client_name}}.";
    expect(extractMergeFields(source)).toEqual(["client_name", "job"]);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(extractMergeFields("{{ amount }} and {{amount}}")).toEqual(["amount"]);
  });

  it("ignores things that only look like fields", () => {
    expect(extractMergeFields("{{ not-a-name }} {{2bad}} {{}} {single}")).toEqual(
      [],
    );
  });

  it("reports which fields a set of values fails to cover", () => {
    const source = "{{a}} {{b}} {{c}}";
    expect(missingFields(source, { a: "x", b: "  " })).toEqual(["b", "c"]);
    expect(missingFields(source, { a: "x", b: "y", c: "z" })).toEqual([]);
  });
});

describe("value injection", () => {
  it("replaces a placeholder with the value", () => {
    const tree = parse("Dear {{client_name}}, hello.");
    const count = injectValues(tree, { client_name: "Acme Roofing" });
    expect(count).toBe(1);
    expect(mdToString(tree as never)).toBe("Dear Acme Roofing, hello.");
  });

  /**
   * The headline case from the design note. A customer literally named
   * "# ACME" must appear as text, not become a heading.
   */
  it("cannot turn a value into a heading", () => {
    const tree = parse("Dear {{client_name}}, hello.");
    injectValues(tree, { client_name: "# ACME" });
    expect(typesIn(tree)).not.toContain("heading");
    expect(mdToString(tree as never)).toBe("Dear # ACME, hello.");
  });

  it("cannot turn a value into a link", () => {
    const tree = parse("Signed by {{signer}}.");
    injectValues(tree, { signer: "[click here](http://evil.example)" });
    expect(typesIn(tree)).not.toContain("link");
    expect(mdToString(tree as never)).toContain("[click here](http://evil.example)");
  });

  it("cannot turn a value into emphasis, an image, or a list", () => {
    const cases: Array<[string, string]> = [
      ["**shouty**", "strong"],
      ["*sly*", "emphasis"],
      ["![x](http://evil.example/x.png)", "image"],
      ["- one\n- two", "list"],
      ["> quoted", "blockquote"],
      ["`code`", "inlineCode"],
    ];
    for (const [value, forbidden] of cases) {
      const tree = parse("Name: {{name}}");
      injectValues(tree, { name: value });
      expect(typesIn(tree)).not.toContain(forbidden);
      expect(mdToString(tree as never)).toContain(value);
    }
  });

  /**
   * Splitting the SOURCE on placeholders and rendering the pieces separately
   * would break this — the bold would be left unterminated. Injecting into the
   * parsed tree keeps the surrounding structure intact.
   */
  it("preserves markup that spans the placeholder", () => {
    const tree = parse("**Hello {{name}}!**");
    injectValues(tree, { name: "Dan" });
    expect(typesIn(tree)).toContain("strong");
    expect(mdToString(tree as never)).toBe("Hello Dan!");
  });

  it("fills every occurrence and counts each one", () => {
    const tree = parse("{{a}} then {{a}} then {{b}}");
    const count = injectValues(tree, { a: "1", b: "2" });
    expect(count).toBe(3);
    expect(mdToString(tree as never)).toBe("1 then 1 then 2");
  });

  it("leaves placeholders inside code samples alone", () => {
    // A template documenting its own syntax is showing the placeholder, not
    // using it.
    const tree = parse("Use `{{amount}}` like this.");
    const count = injectValues(tree, { amount: "500" });
    expect(count).toBe(0);
    expect(mdToString(tree as never)).toContain("{{amount}}");
  });

  it("shows an obvious placeholder rather than a silent gap", () => {
    const tree = parse("Received from {{payer}} the sum of {{amount}}.");
    injectValues(tree, { payer: "   " });
    const text = mdToString(tree as never);
    // Neither an empty hole nor a lie — both read as "still needs filling in".
    expect(text).toBe(
      `Received from ${placeholderFor("payer")} the sum of ${placeholderFor("amount")}.`,
    );
  });

  it("works across block structure, not just one paragraph", () => {
    const tree = parse("# {{title}}\n\n- item {{n}}\n\n> from {{who}}");
    const count = injectValues(tree, { title: "Waiver", n: "1", who: "Dan" });
    expect(count).toBe(3);
    // The template's OWN structure survives — it is the values that cannot
    // create structure.
    expect(typesIn(tree)).toContain("heading");
    expect(typesIn(tree)).toContain("list");
    expect(typesIn(tree)).toContain("blockquote");
    expect(mdToString(tree as never)).toContain("Waiver");
    expect(mdToString(tree as never)).toContain("from Dan");
  });

  it("is a no-op on a tree with no placeholders", () => {
    const tree = parse("Nothing to merge here.");
    expect(injectValues(tree, { unused: "x" })).toBe(0);
    expect(mdToString(tree as never)).toBe("Nothing to merge here.");
  });
});
