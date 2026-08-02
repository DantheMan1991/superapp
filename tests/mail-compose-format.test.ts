import { describe, expect, it } from "vitest";
import {
  ALIGNMENTS,
  ALLOWED_DECLARATIONS,
  FONTS,
  fontFromFace,
  INDENT_STEP_EM,
  MAX_INDENT,
  normalizeColor,
  PALETTE,
  sanitizeStyle,
  SIZES,
  sizeFromLegacy,
} from "@/modules/email/compose/formatting";
import { sanitizeOutboundHtml } from "@/modules/email/compose/html";
import { htmlToPlainText } from "@/modules/email/compose/to-text";
import { normalizeLinkInput } from "@/modules/email/compose/link-url";
import { EMOJI_GROUPS, searchEmoji } from "@/modules/email/compose/emoji";

/**
 * Colours, fonts, sizes, alignment and indent.
 *
 * These are the features that made `compose/html.ts` open the `style` attribute
 * it had previously dropped wholesale, so the tests here are guarding the seam
 * that replaced the blanket rule. The one at the bottom — "the toolbar can only
 * emit what the sanitizer accepts" — is the whole design in one assertion: it
 * walks every table and checks both directions, so adding a swatch to
 * `formatting.ts` without teaching the sanitizer about it is a test failure
 * rather than a message that silently loses its colour.
 */

describe("normalizeColor", () => {
  it("reads the spellings a browser hands back", () => {
    // THE REASON THIS EXISTS. execCommand is given `#cc4125` and the DOM comes
    // back holding `rgb(204, 65, 37)`, so a sanitizer comparing raw strings
    // would reject every colour the toolbar had just applied.
    expect(normalizeColor("rgb(204, 65, 37)")).toBe("#cc4125");
    expect(normalizeColor("rgb(204 65 37)")).toBe("#cc4125");
    expect(normalizeColor("#CC4125")).toBe("#cc4125");
    expect(normalizeColor("  #cc4125  ")).toBe("#cc4125");
  });

  it("expands the short hex form", () => {
    expect(normalizeColor("#fff")).toBe("#ffffff");
    expect(normalizeColor("#F00")).toBe("#ff0000");
  });

  it("refuses a translucent colour rather than flattening it", () => {
    // Alpha is how text is made almost-invisible without ever naming a colour
    // that looks wrong on inspection, and no swatch produces it.
    expect(normalizeColor("rgba(0, 0, 0, 0.02)")).toBeNull();
    expect(normalizeColor("rgba(0,0,0,0)")).toBeNull();
    // Fully opaque is the same colour as the rgb() form, so it is allowed.
    expect(normalizeColor("rgba(204, 65, 37, 1)")).toBe("#cc4125");
  });

  it("returns null for anything it cannot read", () => {
    for (const bad of [
      "red",
      "var(--brand)",
      "color-mix(in srgb, red, blue)",
      "#12345",
      "rgb(300, 0, 0)",
      "",
      "url(https://tracker.example/x)",
    ]) {
      expect(normalizeColor(bad)).toBeNull();
    }
  });
});

describe("sanitizeStyle", () => {
  it("keeps a declaration the toolbar can make", () => {
    expect(sanitizeStyle("color:#cc4125")).toBe("color:#cc4125");
    expect(sanitizeStyle("text-align:center")).toBe("text-align:center");
    expect(sanitizeStyle(`font-size:${SIZES[2].css}`)).toBe(`font-size:${SIZES[2].css}`);
  });

  it("drops everything else, whatever it looks like", () => {
    for (const hostile of [
      "display:none",
      "visibility:hidden",
      "opacity:0",
      "position:fixed;top:0",
      "font-size:1px",
      "background-image:url(https://tracker.example/x)",
      "behavior:url(#default#time2)",
      "-moz-binding:url(evil.xml)",
      "width:0;height:0",
      "text-indent:-9999px",
      "transform:scale(0)",
      "color:red",
    ]) {
      expect(sanitizeStyle(hostile)).toBe("");
    }
  });

  it("keeps the good half of a mixed declaration list", () => {
    const out = sanitizeStyle("color:#cc4125;display:none;text-align:center");
    expect(out).toContain("color:#cc4125");
    expect(out).toContain("text-align:center");
    expect(out).not.toContain("display");
  });

  it("survives the round trip through a browser's own serialization", () => {
    // What the DOM actually returns: rgb(), a re-quoted font stack, spacing of
    // the engine's choosing, and a trailing semicolon.
    const out = sanitizeStyle(
      'COLOR: rgb(204, 65, 37); font-family: "Courier New", courier, monospace;',
    );
    expect(out).toContain("color:#cc4125");
    expect(out).toContain("font-family:");
    expect(out.toLowerCase()).toContain("courier new");
  });

  it("strips !important rather than letting it fail the match", () => {
    expect(sanitizeStyle("color:#cc4125 !important")).toBe("color:#cc4125");
  });

  it("never throws on malformed input", () => {
    for (const bad of ["", ";;;", "color", ":", "color:", ":#fff", "a:b:c"]) {
      expect(() => sanitizeStyle(bad)).not.toThrow();
    }
  });
});

describe("the legacy attributes a browser emits", () => {
  it("maps <font size=n> back to a named size", () => {
    for (const size of SIZES) {
      expect(sizeFromLegacy(String(size.legacy))?.id).toBe(size.id);
    }
    expect(sizeFromLegacy("4")).toBeNull();
    expect(sizeFromLegacy("99")).toBeNull();
    expect(sizeFromLegacy("nonsense")).toBeNull();
  });

  it("maps <font face> back to one of our stacks, from a full stack or a name", () => {
    expect(fontFromFace(FONTS[1].css)?.id).toBe(FONTS[1].id);
    // `execCommand("fontName")` is often handed, and returns, a bare family.
    expect(fontFromFace("Georgia")?.id).toBe("georgia");
    expect(fontFromFace('"Courier New", Courier, monospace')?.id).toBe("mono");
    expect(fontFromFace("Wingdings")).toBeNull();
  });
});

describe("sanitizeOutboundHtml — the formatting features", () => {
  it("translates <font> into one of our own spans", () => {
    // The browser emits `<font>` for colour, family and size while
    // `styleWithCSS` is off — which is the mode the editor runs in, because it
    // is also what makes bold come out as `<b>`.
    const out = sanitizeOutboundHtml(
      '<font color="#cc4125" face="Georgia" size="5">coloured</font>',
    );
    expect(out).toContain("<span");
    expect(out).not.toContain("<font");
    expect(out).toContain("color:#cc4125");
    expect(out).toContain("Georgia");
    expect(out).toContain(`font-size:${SIZES[2].css}`);
    expect(out).toContain("coloured");
  });

  it("drops a <font> whose values are not ours, keeping the text", () => {
    const out = sanitizeOutboundHtml(
      '<font color="rgba(0,0,0,0.01)" face="Wingdings" size="1">text</font>',
    );
    expect(out).not.toContain("style=");
    expect(out).not.toContain("Wingdings");
    expect(out).toContain("text");
  });

  it("keeps a highlight", () => {
    const out = sanitizeOutboundHtml(
      `<span style="background-color: rgb(255, 229, 153)">warned</span>`,
    );
    expect(out).toContain("background-color:#ffe599");
  });

  it("keeps alignment and indent on a block", () => {
    const out = sanitizeOutboundHtml(
      `<p style="text-align:center">middle</p>` +
        `<div style="margin-left:${INDENT_STEP_EM}em">in</div>`,
    );
    expect(out).toContain("text-align:center");
    expect(out).toContain(`margin-left:${INDENT_STEP_EM}em`);
  });

  it("refuses an indent deeper than the toolbar can produce", () => {
    const tooFar = `${(MAX_INDENT + 1) * INDENT_STEP_EM}em`;
    const out = sanitizeOutboundHtml(`<div style="margin-left:${tooFar}">far</div>`);
    expect(out).not.toContain("margin-left");
    expect(out).toContain("far");
  });

  it("refuses a colour that is not on the palette", () => {
    // #ff00ff is a perfectly ordinary colour and is still refused, because the
    // rule is membership of the table rather than a judgement about the value.
    const out = sanitizeOutboundHtml('<span style="color:#ff00ff">magenta</span>');
    expect(out).not.toContain("#ff00ff");
    expect(out).toContain("magenta");
  });

  it("leaves no formatting in the plain-text alternative", () => {
    const text = htmlToPlainText(
      sanitizeOutboundHtml(
        '<p style="text-align:center"><font color="#cc4125">Red and centred</font></p>',
      ),
    );
    expect(text).toBe("Red and centred");
  });
});

describe("THE INVARIANT: the toolbar can only emit what the sanitizer accepts", () => {
  /**
   * Both directions, over every table.
   *
   * This is the assertion the whole design rests on. `formatting.ts` is read by
   * the toolbar to build its menus AND by the sanitizer to build its allowlist,
   * so the two cannot drift — but "cannot drift" is a claim about a file nobody
   * re-reads, and this is what turns it into a failing test. Adding a swatch or
   * a font without the sanitizer learning about it breaks here rather than
   * shipping a message that silently loses its colour.
   */
  it("accepts every declaration the tables can produce", () => {
    for (const declaration of ALLOWED_DECLARATIONS) {
      expect(sanitizeStyle(declaration), declaration).toBe(declaration);
    }
  });

  it("covers every menu entry the toolbar renders", () => {
    for (const font of FONTS) {
      expect(ALLOWED_DECLARATIONS.has(`font-family:${font.css}`)).toBe(true);
    }
    for (const size of SIZES) {
      expect(ALLOWED_DECLARATIONS.has(`font-size:${size.css}`)).toBe(true);
    }
    for (const colour of PALETTE) {
      expect(ALLOWED_DECLARATIONS.has(`color:${colour}`)).toBe(true);
      expect(ALLOWED_DECLARATIONS.has(`background-color:${colour}`)).toBe(true);
    }
    for (const alignment of ALIGNMENTS) {
      expect(ALLOWED_DECLARATIONS.has(`text-align:${alignment}`)).toBe(true);
    }
  });

  it("gives no two fonts the same leading family", () => {
    // `fontFromFace` falls back to matching a BARE family name, because that is
    // what `execCommand("fontName")` round-trips as. Two stacks leading with
    // the same family would make one menu entry unreachable — which is exactly
    // what "Serif" starting with Georgia did.
    const leads = FONTS.map((f) =>
      f.css.split(",")[0].trim().replace(/^["']|["']$/g, "").toLowerCase(),
    );
    expect(new Set(leads).size).toBe(leads.length);
  });

  it("has a palette of normalized, distinct colours", () => {
    for (const colour of PALETTE) {
      expect(colour, colour).toMatch(/^#[0-9a-f]{6}$/);
      expect(normalizeColor(colour)).toBe(colour);
    }
    expect(new Set(PALETTE).size).toBe(PALETTE.length);
  });

  it("admits nothing beyond the tables", () => {
    // A property nobody enumerated cannot appear however it is spelled.
    const properties = new Set(
      [...ALLOWED_DECLARATIONS].map((d) => d.slice(0, d.indexOf(":"))),
    );
    expect([...properties].sort()).toEqual([
      "background-color",
      "color",
      "font-family",
      "font-size",
      "margin-left",
      "text-align",
    ]);
  });
});

describe("normalizeLinkInput", () => {
  it("keeps a scheme it allows", () => {
    expect(normalizeLinkInput("https://example.com")).toBe("https://example.com");
    expect(normalizeLinkInput("mailto:dan@example.com")).toBe("mailto:dan@example.com");
    expect(normalizeLinkInput("tel:+441234567890")).toBe("tel:+441234567890");
  });

  it("adds a scheme to a bare host and a bare address", () => {
    expect(normalizeLinkInput("example.com")).toBe("https://example.com");
    expect(normalizeLinkInput("dan@example.com")).toBe("mailto:dan@example.com");
  });

  it("REFUSES a scheme it does not allow rather than repairing it", () => {
    // Prefixing https:// would quietly produce a link to a host called
    // "javascript", which is a stranger outcome than doing nothing.
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "file:///etc/passwd",
    ]) {
      expect(normalizeLinkInput(bad), bad).toBeNull();
    }
  });

  it("returns null for nothing", () => {
    expect(normalizeLinkInput("")).toBeNull();
    expect(normalizeLinkInput("   ")).toBeNull();
  });
});

describe("emoji", () => {
  it("is characters, not markup — which is why it needed no sanitizer rule", () => {
    for (const group of EMOJI_GROUPS) {
      for (const [character] of group.emoji) {
        expect(character).not.toContain("<");
        expect(character).not.toContain("&");
        expect(character.length).toBeLessThanOrEqual(8);
      }
    }
  });

  it("survives sanitizing and reaches the plain-text alternative", () => {
    const html = sanitizeOutboundHtml("<p>Shipped 🎉 and signed ✅</p>");
    expect(html).toContain("🎉");
    expect(htmlToPlainText(html)).toBe("Shipped 🎉 and signed ✅");
  });

  it("finds by term, preferring a prefix match", () => {
    expect(searchEmoji("thumbs").map((e) => e[0])).toContain("👍");
    expect(searchEmoji("invoice").map((e) => e[0])).toContain("🧾");
    expect(searchEmoji("truck").map((e) => e[0])).toContain("🚚");
    expect(searchEmoji("tick")[0][0]).toBe("✅");
  });

  it("finds an emoji by pasting it, which is how you ask what it is called", () => {
    expect(searchEmoji("🚚").map((e) => e[0])).toContain("🚚");
  });

  it("returns nothing for an empty query rather than everything", () => {
    // The caller shows its browsable groups in that case; 300 results for no
    // input would replace a picker with a wall.
    expect(searchEmoji("")).toEqual([]);
    expect(searchEmoji("   ")).toEqual([]);
  });

  it("has no duplicate characters across groups", () => {
    const all = EMOJI_GROUPS.flatMap((g) => g.emoji.map((e) => e[0]));
    expect(new Set(all).size).toBe(all.length);
  });
});
