import { describe, expect, it } from "vitest";
import type { JmapEmail } from "@/lib/email/jmap/types";
import {
  htmlHasContent,
  sanitizeOutboundHtml,
} from "@/modules/email/compose/html";
import { htmlToPlainText } from "@/modules/email/compose/to-text";
import { composeBodies } from "@/modules/email/compose/bodies";
import {
  openingBodyHtml,
  quoteHtml,
  quoteText,
  textSignatureToHtml,
} from "@/modules/email/compose/quote";

/**
 * Rich-text composing.
 *
 * The write path carries more weight than the read path's tests do, and the
 * reason is in `compose/html.ts`: reading happens inside a sandbox that makes a
 * sanitizer bypass a rendering bug, and SENDING has nothing behind it. Whatever
 * survives here goes out over the user's own From header to somebody we have no
 * relationship with. So the sanitizer is asserted the way the SSRF ranges were —
 * every category named, and the negative case asserted rather than assumed.
 *
 * The other half is the `multipart/alternative` invariant: the text part and the
 * HTML part must be the same message. `composeBodies` is where that is decided
 * and the ordering test at the bottom is the one that would catch it silently
 * breaking.
 */

/** Every tag name still present in a fragment. */
function tags(html: string): string[] {
  return [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) =>
    m[1].toLowerCase(),
  );
}

describe("sanitizeOutboundHtml — what may leave the building", () => {
  it("keeps everything the toolbar can produce", () => {
    const out = sanitizeOutboundHtml(
      "<p>Hello <b>bold</b> <strong>strong</strong> <i>it</i> <em>em</em> " +
        "<u>under</u></p><ul><li>one</li></ul><ol><li>two</li></ol>" +
        '<div>line<br>break</div><a href="https://example.com">link</a>',
    );
    for (const tag of ["p", "b", "strong", "i", "em", "u", "ul", "ol", "li", "div", "br", "a"]) {
      expect(tags(out)).toContain(tag);
    }
    expect(out).toContain("Hello");
  });

  it("drops script and style along with their contents", () => {
    const out = sanitizeOutboundHtml(
      "<p>before</p><script>alert(1)</script><style>body{color:red}</style><p>after</p>",
    );
    expect(out).not.toContain("alert");
    // The stylesheet's SOURCE must not survive as visible prose either — the
    // read path's own bug report, in reverse.
    expect(out).not.toContain("color:red");
    expect(tags(out)).not.toContain("script");
    expect(tags(out)).not.toContain("style");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("removes images entirely — a pasted pixel must not track on our user's behalf", () => {
    const out = sanitizeOutboundHtml(
      '<p>hi</p><img src="https://tracker.example/p.gif?u=42" width="1" height="1">',
    );
    expect(tags(out)).not.toContain("img");
    expect(out).not.toContain("tracker.example");
  });

  it("removes event handlers", () => {
    const out = sanitizeOutboundHtml('<p onclick="steal()" onmouseover="x()">text</p>');
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("onmouseover");
    expect(out).toContain("text");
  });

  it("drops every declaration that is not something the toolbar can make", () => {
    // The toolbar gained colours, fonts and sizes, so `style` is no longer
    // dropped wholesale — see `formatting.ts`. What replaced the blanket rule is
    // narrower and stronger: a declaration survives only if it is an exact
    // member of the set the toolbar generates from. `display:none` is not
    // refused by a rule about hiding things; it is simply not in any table.
    const out = sanitizeOutboundHtml(
      '<p style="display:none">invisible</p>' +
        '<div style="visibility:hidden;opacity:0">gone</div>' +
        '<span style="position:fixed;top:0">over the app</span>' +
        '<p style="font-size:1px">tiny</p>' +
        '<div style="background-image:url(https://tracker.example/x)">pixel</div>' +
        '<p style="color:rgba(0,0,0,0.02)">almost invisible</p>',
    );
    for (const gone of [
      "display:none",
      "visibility:hidden",
      "opacity",
      "position:fixed",
      "font-size:1px",
      "background-image",
      "tracker.example",
      "rgba",
    ]) {
      expect(out).not.toContain(gone);
    }
    // The TEXT survives. A sanitizer that deleted words would change the
    // meaning of a message somebody is sending under their own name.
    for (const kept of ["invisible", "gone", "over the app", "tiny", "pixel"]) {
      expect(out).toContain(kept);
    }
  });

  it("unwraps tags it does not allow, keeping their text", () => {
    const out = sanitizeOutboundHtml(
      "<table><tr><td>cell</td></tr></table><h1>heading</h1><marquee>moving</marquee>",
    );
    for (const tag of ["table", "tr", "td", "h1", "marquee"]) {
      expect(tags(out)).not.toContain(tag);
    }
    for (const text of ["cell", "heading", "moving"]) {
      expect(out).toContain(text);
    }
  });

  it("drops iframes, forms and objects", () => {
    const out = sanitizeOutboundHtml(
      '<iframe src="https://evil.example"></iframe>' +
        '<form action="https://evil.example"><input name="pw"></form>' +
        '<object data="x.swf"></object><embed src="y">',
    );
    for (const tag of ["iframe", "form", "input", "object", "embed"]) {
      expect(tags(out)).not.toContain(tag);
    }
    expect(out).not.toContain("evil.example");
  });

  describe("links", () => {
    it("keeps http, https, mailto and tel", () => {
      for (const href of [
        "https://example.com/x?a=1",
        "http://example.com",
        "mailto:dan@example.com",
        "tel:+441234567890",
      ]) {
        const out = sanitizeOutboundHtml(`<a href="${href}">go</a>`);
        expect(out).toContain(`href="${href}"`);
      }
    });

    it("keeps the text and drops the destination for anything else", () => {
      for (const href of [
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "vbscript:msgbox",
        "file:///etc/passwd",
      ]) {
        const out = sanitizeOutboundHtml(`<a href="${href}">click here</a>`);
        expect(out).toContain("click here");
        expect(out).not.toContain("href=");
      }
    });

    it("refuses a scheme smuggled past a naive check", () => {
      // Tab, newline and NUL inside the scheme — all of which a browser
      // tolerates and a substring test does not catch.
      for (const href of [
        "java\tscript:alert(1)",
        "java\nscript:alert(1)",
        "\u0000javascript:alert(1)",
        " javascript:alert(1)",
      ]) {
        const out = sanitizeOutboundHtml(`<a href="${href}">x</a>`);
        expect(out).not.toMatch(/href=/);
      }
    });

    it("refuses a relative href — which the READ path allows, deliberately", () => {
      // The reading pane resolves relative links nowhere, inside a frame with
      // `base-uri 'none'`. In a SENT message there is no such guarantee: the
      // base is the recipient's client's, which is not ours and not knowable.
      const out = sanitizeOutboundHtml('<a href="/dashboard/secret">x</a>');
      expect(out).not.toContain("href=");
    });

    it("refuses a protocol-relative href", () => {
      const out = sanitizeOutboundHtml('<a href="//evil.example/x">x</a>');
      expect(out).not.toContain("evil.example");
    });

    it("does not add target or rel — they mean nothing in a mail client", () => {
      const out = sanitizeOutboundHtml('<a href="https://example.com">x</a>');
      expect(out).not.toContain("target=");
      expect(out).not.toContain("rel=");
    });
  });

  describe("blockquote", () => {
    it("emits our own styling and discards whatever arrived", () => {
      const out = sanitizeOutboundHtml(
        '<blockquote type="cite" style="position:fixed;background:url(https://tracker.example/x)" ' +
          'class="gmail_quote" id="q1">quoted</blockquote>',
      );
      expect(out).toContain("quoted");
      expect(out).toContain('type="cite"');
      expect(out).toContain("border-left:2px solid #ccc");
      // Nothing the caller supplied survived — this is the whole reason the
      // style is EMITTED by transformTags rather than allowed through.
      expect(out).not.toContain("position:fixed");
      expect(out).not.toContain("tracker.example");
      expect(out).not.toContain("gmail_quote");
      expect(out).not.toContain('id="q1"');
    });

    it("REGRESSION: the emitted attributes survive the allowlist", () => {
      // sanitize-html applies `allowedAttributes` AFTER `transformTags`, so a
      // style added by the transform and not listed in the allowlist is
      // silently discarded again. That exact mistake shipped links with no
      // rel="noopener" on the read path. Pinned here so it cannot recur.
      const out = sanitizeOutboundHtml("<blockquote>q</blockquote>");
      expect(out).toMatch(/<blockquote[^>]*type="cite"/);
      expect(out).toMatch(/<blockquote[^>]*style="/);
    });

    it("nests", () => {
      const out = sanitizeOutboundHtml(
        "<blockquote>outer<blockquote>inner</blockquote></blockquote>",
      );
      expect(tags(out).filter((t) => t === "blockquote")).toHaveLength(4);
    });

    it("defaults an unmarked blockquote to a quote, not an indent", () => {
      // `execCommand("formatBlock", "blockquote")` emits a BARE blockquote, so
      // the Quote button would be indistinguishable from Indent without this
      // default. The editor stamps `type="cite"` as well; this is the fallback
      // for when that stamping does not find its element.
      const out = sanitizeOutboundHtml("<blockquote>pressed Quote</blockquote>");
      expect(out).toContain('type="cite"');
      expect(out).toContain("border-left");
    });

    it("reads an engine's indent wrapper as an indent, not a quote", () => {
      // What `execCommand("indent")` actually produces. The border reset is the
      // signal — no quote in this codebase has ever carried one.
      const out = sanitizeOutboundHtml(
        '<blockquote style="margin: 0 0 0 40px; border: none; padding: 0px;">indented</blockquote>',
      );
      expect(tags(out)).not.toContain("blockquote");
      expect(out).toContain("margin-left:2.5em");
      expect(out).not.toContain("border-left");
      expect(out).toContain("indented");
    });
  });

  it("caps its input rather than working unboundedly", () => {
    const out = sanitizeOutboundHtml(`<p>${"x".repeat(600_000)}</p>`);
    expect(out.length).toBeLessThanOrEqual(500_100);
  });

  it("never throws on malformed markup", () => {
    for (const bad of ["<p>unclosed", "<<>>", "<a href=", "</p></div>", "<b><i></b></i>"]) {
      expect(() => sanitizeOutboundHtml(bad)).not.toThrow();
    }
  });

  it("leaves no HTML comments for the text converter to trip over", () => {
    // The converter's tokenizer only recognizes tags. A surviving comment would
    // reach a recipient's text part as visible source.
    const out = sanitizeOutboundHtml("<p>a<!-- secret note -->b</p>");
    expect(out).not.toContain("secret note");
  });
});

describe("htmlHasContent", () => {
  it("sees through what an emptied contenteditable leaves behind", () => {
    expect(htmlHasContent("<p><br></p>")).toBe(false);
    expect(htmlHasContent("<div></div>")).toBe(false);
    expect(htmlHasContent("<p>&nbsp;</p>")).toBe(false);
    expect(htmlHasContent("   ")).toBe(false);
    expect(htmlHasContent("<p>a</p>")).toBe(true);
  });
});

describe("htmlToPlainText — the alternative a person actually reads", () => {
  it("turns br into a line and a paragraph into a blank line", () => {
    expect(htmlToPlainText("<p>one<br>two</p><p>three</p>")).toBe(
      "one\ntwo\n\nthree",
    );
  });

  it("bullets an unordered list", () => {
    expect(htmlToPlainText("<ul><li>alpha</li><li>beta</li></ul>")).toBe(
      "- alpha\n- beta",
    );
  });

  it("numbers an ordered list", () => {
    expect(htmlToPlainText("<ol><li>first</li><li>second</li></ol>")).toBe(
      "1. first\n2. second",
    );
  });

  it("indents a nested list", () => {
    const out = htmlToPlainText(
      "<ul><li>outer</li><ul><li>inner</li></ul></ul>",
    );
    expect(out).toContain("- outer");
    expect(out).toContain("  - inner");
  });

  it("prefixes a quote, and keeps the prefix across a line break", () => {
    // THE ONE THAT MATTERS. A `<br>` inside a quote has to carry the prefix
    // too, or the quote unravels on its second line and the whole reply chain
    // flattens the next time somebody answers from a text-only client.
    const out = htmlToPlainText("<blockquote>one<br>two</blockquote>");
    expect(out).toBe("> one\n> two");
  });

  it("deepens the prefix for a nested quote", () => {
    const out = htmlToPlainText(
      "<blockquote>outer<blockquote>inner</blockquote></blockquote>",
    );
    expect(out).toContain("> outer");
    expect(out).toContain("> > inner");
  });

  describe("links", () => {
    it("appends the destination when the label is not the destination", () => {
      expect(
        htmlToPlainText('<p>see <a href="https://example.com/x">our terms</a></p>'),
      ).toBe("see our terms <https://example.com/x>");
    });

    it("says a bare URL once", () => {
      expect(
        htmlToPlainText('<a href="https://example.com">https://example.com</a>'),
      ).toBe("https://example.com");
    });

    it("does not repeat a mailto whose label is the address", () => {
      expect(
        htmlToPlainText('<a href="mailto:dan@example.com">dan@example.com</a>'),
      ).toBe("dan@example.com");
    });

    it("emits the href when the anchor has no text", () => {
      expect(htmlToPlainText('<a href="https://example.com"></a>')).toBe(
        "https://example.com",
      );
    });
  });

  it("decodes entities and normalizes a non-breaking space", () => {
    const out = htmlToPlainText("<p>Tom &amp; Jerry&nbsp;&mdash;&nbsp;&pound;5</p>");
    expect(out).toBe("Tom & Jerry — £5");
    expect(out).not.toContain(" ");
  });

  it("collapses insignificant whitespace and markup indentation", () => {
    expect(htmlToPlainText("<div>\n   spaced   out\n</div>")).toBe("spaced out");
  });

  it("contributes no markers for emphasis", () => {
    // Plain text has no way to say "bold". Inventing `*bold*` would put
    // asterisks into messages nobody typed.
    expect(htmlToPlainText("<p><b>bold</b> and <i>italic</i></p>")).toBe(
      "bold and italic",
    );
  });

  it("keeps the RFC 3676 signature separator, trailing space and all", () => {
    // "-- " with the space is what mail clients fold a signature on. A blanket
    // trimEnd would eat it and the signature would be quoted back in every
    // reply for the rest of the thread.
    const out = htmlToPlainText("<div>body</div><div>-- </div><div>Dan</div>");
    expect(out.split("\n")).toContain("-- ");
  });

  it("does not stack up the blank lines a contenteditable leaves behind", () => {
    const out = htmlToPlainText("<p>a</p><p></p><p></p><div><br></div><p>b</p>");
    expect(out).not.toMatch(/\n\n\n/);
  });

  it("returns nothing for an empty document", () => {
    expect(htmlToPlainText("<p><br></p>")).toBe("");
    expect(htmlToPlainText("")).toBe("");
  });
});

describe("the text part and the HTML part are the same message", () => {
  const parent: Pick<
    JmapEmail,
    "from" | "receivedAt" | "sentAt" | "textBody" | "htmlBody"
  > = {
    from: [{ name: "Supplier Test", email: "billing@supplier.example" }],
    receivedAt: new Date("2026-07-28T21:12:00Z"),
    sentAt: null,
    textBody: "The price is agreed.\n\nRegards",
    htmlBody: null,
  };

  it("a derived quote carries the same lines as the purpose-built text one", () => {
    // `quoteText` is the SPECIFICATION of what a plain-text quote should look
    // like, and this asserts the derived one matches it — the same role the
    // golden test in `file-headers.ts` plays for the blob header block. If they
    // ever diverge, the derived text alternative has stopped being as good as
    // the one it replaced.
    const derived = htmlToPlainText(sanitizeOutboundHtml(quoteHtml(parent)));
    const direct = quoteText(parent);

    const meaningful = (s: string) =>
      s.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0);

    expect(meaningful(derived)).toEqual(meaningful(direct));
  });

  it("survives a signature round trip", () => {
    const sig = "-- \nDan Houser\nYosher\nhttps://yosher.example";
    const derived = htmlToPlainText(
      sanitizeOutboundHtml(textSignatureToHtml(sig)),
    );
    expect(derived).toBe(sig);
  });

  it("opens a reply with room above the quote", () => {
    // A contenteditable whose first child is a blockquote gives most browsers
    // nowhere to put the caret above it, and the first keystroke lands inside
    // what the person is replying to.
    const doc = openingBodyHtml("<div>Dan</div>", quoteHtml(parent));
    expect(doc.indexOf("<p><br></p>")).toBe(0);
    expect(doc.indexOf("Dan")).toBeLessThan(doc.indexOf("blockquote"));
  });
});

describe("composeBodies — sanitize, then derive", () => {
  it("derives the text part from the SANITIZED html, not the submitted html", () => {
    // THE ORDERING TEST. Both orders read identically at the call site and only
    // one is right: derive from the raw input and the text part carries the
    // words the sanitizer removed, so half the recipients read a message nobody
    // checked. The `javascript:` href is the tell — it must be in neither part.
    const submitted =
      '<p>Hello</p><a href="javascript:steal()">click here</a>' +
      '<img src="https://tracker.example/p.gif">' +
      "<style>body{background:url(https://tracker.example/c.png)}</style>";

    const { textBody, htmlBody } = composeBodies(submitted, "");

    expect(htmlBody).not.toContain("javascript:");
    expect(htmlBody).not.toContain("tracker.example");
    expect(textBody).not.toContain("javascript:");
    expect(textBody).not.toContain("tracker.example");
    // The words survive in both. Only the destination went.
    expect(textBody).toContain("Hello");
    expect(textBody).toContain("click here");
  });

  it("sends no HTML part when nothing visible survives sanitizing", () => {
    // A multipart/alternative whose HTML half is blank renders as an empty
    // message in every client that prefers HTML, which is most of them.
    const { textBody, htmlBody } = composeBodies(
      "<script>alert(1)</script><p><br></p>",
      "the real message",
    );
    expect(htmlBody).toBeNull();
    expect(textBody).toBe("the real message");
  });

  it("passes a plain-text-only send straight through", () => {
    const { textBody, htmlBody } = composeBodies(undefined, "just text");
    expect(htmlBody).toBeNull();
    expect(textBody).toBe("just text");
  });

  it("replaces the caller's text body when there is an HTML one", () => {
    // One source of truth. A caller supplying both would otherwise decide what
    // text-only recipients read, independently of what everyone else got.
    const { textBody } = composeBodies("<p>the actual message</p>", "stale draft");
    expect(textBody).toBe("the actual message");
  });
});
