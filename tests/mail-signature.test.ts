import { describe, expect, it } from "vitest";
import {
  hasSeparator,
  MAX_SIGNATURE_HTML,
  prepareSignature,
} from "@/modules/email/signature/validate";

/**
 * Signatures.
 *
 * THE REASON THESE MATTER MORE THAN THEIR SIZE SUGGESTS: a signature is the
 * most-sent markup in the product. A message body goes out once; this goes out
 * on every message the person ever writes, from Yosher and from every other
 * client pointed at the same mailbox. A mistake here is not one bad email, it is
 * every email until somebody notices.
 *
 * Two properties are asserted throughout. It goes through the SAME outbound
 * sanitizer a body does — not a laxer one on the grounds that it is "our own"
 * content, because it is the user's content and the user can paste. And the text
 * version is DERIVED, so the two halves cannot describe different signatures.
 */

describe("hasSeparator", () => {
  it("recognizes the RFC 3676 line, with or without its trailing space", () => {
    expect(hasSeparator("-- \nDan")).toBe(true);
    // The space is exactly what a stray trimEnd eats, so a signature that lost
    // it should be recognized and repaired rather than given a second one.
    expect(hasSeparator("--\nDan")).toBe(true);
    expect(hasSeparator("-- ")).toBe(true);
  });

  it("is not fooled by something that merely starts with dashes", () => {
    expect(hasSeparator("--- \nDan")).toBe(false);
    expect(hasSeparator("-- Dan")).toBe(false);
    expect(hasSeparator("Dan\n-- ")).toBe(false);
    expect(hasSeparator("")).toBe(false);
  });
});

describe("prepareSignature", () => {
  it("keeps the formatting the composer's toolbar can produce", () => {
    const { htmlSignature } = prepareSignature(
      '<div><b>Dan Houser</b><br><span style="color:#1155cc">Yosher</span><br>' +
        '<a href="https://yosher.example">yosher.example</a></div>',
    );
    expect(htmlSignature).toContain("<b>Dan Houser</b>");
    expect(htmlSignature).toContain("color:#1155cc");
    expect(htmlSignature).toContain('href="https://yosher.example"');
  });

  it("runs the OUTBOUND sanitizer, not a laxer one", () => {
    const { htmlSignature, textSignature } = prepareSignature(
      "<div>Dan</div><script>steal()</script>" +
        '<img src="https://tracker.example/p.gif">' +
        '<div style="display:none">hidden</div>' +
        '<a href="javascript:alert(1)">click</a>',
    );
    for (const gone of [
      "steal",
      "tracker.example",
      "display:none",
      "javascript:",
    ]) {
      expect(htmlSignature, gone).not.toContain(gone);
      expect(textSignature, gone).not.toContain(gone);
    }
    expect(htmlSignature).toContain("Dan");
  });

  it("admits NO inline image, even one that looks like the composer's", () => {
    // A cid is minted per message and lives in that message's MIME. A stored
    // signature referencing one would show a broken image on every mail it was
    // later pasted into — so `prepareSignature` passes no allowlist at all.
    const { htmlSignature } = prepareSignature(
      '<div>Dan</div><img src="x" data-cid="0123456789abcdef0123456789abcdef@yosher.mail">',
    );
    expect(htmlSignature).not.toContain("img");
    expect(htmlSignature).not.toContain("cid:");
  });

  describe("the separator", () => {
    it("is added when it is not there", () => {
      const { htmlSignature, textSignature } = prepareSignature("<div>Dan</div>");
      expect(textSignature.split("\n")[0]).toBe("-- ");
      expect(htmlSignature.startsWith("<div>-- </div>")).toBe(true);
    });

    it("is NOT doubled when the signature already opens with one", () => {
      const { textSignature } = prepareSignature(
        "<div>-- </div><div>Dan Houser</div>",
      );
      expect(textSignature.split("\n").filter((l) => l.trimEnd() === "--")).toHaveLength(1);
      expect(textSignature).toBe("-- \nDan Houser");
    });

    it("recognizes the separator however the last client spelled it", () => {
      // `<div>-- </div>`, `<p>--&nbsp;</p>` and a bare `-- ` all mean the same
      // thing, which is why the check runs on the TEXT rendering rather than
      // matching markup.
      for (const spelling of [
        "<div>-- </div><div>Dan</div>",
        "<p>--&nbsp;</p><p>Dan</p>",
        "<div>--</div><div>Dan</div>",
      ]) {
        const { textSignature } = prepareSignature(spelling);
        expect(
          textSignature.split("\n").filter((l) => l.trimEnd() === "--"),
          spelling,
        ).toHaveLength(1);
      }
    });

    it("keeps the trailing space, which is the whole point of it", () => {
      // Mail clients fold everything after a line of exactly "-- " out of quoted
      // replies. Lose the space and the signature is quoted back into every
      // message in a thread.
      const { textSignature } = prepareSignature("<div>Dan</div>");
      expect(textSignature.split("\n")).toContain("-- ");
    });
  });

  it("derives the text version from the sanitized html", () => {
    const { textSignature } = prepareSignature(
      "<div>-- </div><div><b>Dan Houser</b></div><div>Yosher</div>" +
        '<div><a href="https://yosher.example">Our terms</a></div>',
    );
    expect(textSignature).toBe(
      "-- \nDan Houser\nYosher\nOur terms <https://yosher.example>",
    );
  });

  it("clears to empty rather than refusing — removing a signature is a thing people do", () => {
    for (const empty of ["", "<p><br></p>", "<div></div>", "   ", "<script>x</script>"]) {
      const prepared = prepareSignature(empty);
      expect(prepared.htmlSignature, empty).toBe("");
      expect(prepared.textSignature, empty).toBe("");
    }
  });

  it("does not add a separator to an empty signature", () => {
    // A signature consisting only of "-- " would put a dangling separator at the
    // bottom of every message.
    expect(prepareSignature("").htmlSignature).toBe("");
  });

  it("caps its input", () => {
    const prepared = prepareSignature(`<div>${"x".repeat(60_000)}</div>`);
    expect(prepared.htmlSignature.length).toBeLessThanOrEqual(MAX_SIGNATURE_HTML + 200);
  });

  it("never throws on malformed markup", () => {
    for (const bad of ["<div>unclosed", "<<>>", "<a href=", "</div>", "<b><i></b></i>"]) {
      expect(() => prepareSignature(bad)).not.toThrow();
    }
  });

  it("is idempotent — saving twice changes nothing", () => {
    // The form loads what was saved and saves it again on every edit, so a
    // transform that was not idempotent would grow a separator, or an extra
    // wrapper, on each pass.
    const once = prepareSignature("<div><b>Dan</b></div>");
    const twice = prepareSignature(once.htmlSignature);
    expect(twice).toEqual(once);
  });
});
