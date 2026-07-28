import { describe, expect, it } from "vitest";
import {
  contentDisposition,
  FILE_RESPONSE_CSP,
  fileResponseHeaders,
} from "@/lib/file-headers";
import {
  MESSAGE_FRAME_CSP,
  MESSAGE_FRAME_SANDBOX,
  messageFrameHeaders,
} from "@/modules/email/render/policy";
import {
  escapeHtml,
  linkifyLine,
  renderTextBody,
  trimUrlTail,
} from "@/modules/email/render/text-to-html";
import { mailAttachmentPolicy } from "@/modules/email/render/attachment-policy";
import { buildCidMap, lookupCid, type InlinePart } from "@/modules/email/render/cid";
import { sanitizeMessageHtml } from "@/modules/email/render/sanitize";
import {
  signBlobClaim,
  signImageClaim,
  verifyBlobClaim,
  verifyImageClaim,
  type BlobClaim,
} from "@/modules/email/render/signing";

/**
 * Message rendering.
 *
 * All pure, all free of `server-only`, so the security-critical string handling
 * can be tested without a network, a database or a server runtime — the same
 * reason jmap/parse.ts and migadu-parse.ts are split out from their clients.
 *
 * The tests that earn their keep here are the ones asserting what does NOT
 * appear in the output. A sanitizer that merely produces plausible HTML looks
 * healthy right up until it doesn't.
 */

describe("file response headers", () => {
  /**
   * GOLDEN. blob-stream.ts carried this list inline before it was extracted so
   * mail attachments could share it. Byte-identical or the refactor silently
   * dropped a header from every file route in the product.
   */
  it("emits exactly the header set blob-stream.ts used to build inline", () => {
    expect(
      fileResponseHeaders({
        mimeType: "application/pdf",
        fileName: "invoice.pdf",
        disposition: "attachment",
        etag: '"abc123"',
      }),
    ).toEqual({
      "Content-Type": "application/pdf",
      "Content-Disposition":
        "attachment; filename=\"invoice.pdf\"; filename*=UTF-8''invoice.pdf",
      "Content-Security-Policy":
        "default-src 'none'; sandbox; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
      "Referrer-Policy": "no-referrer",
      ETag: '"abc123"',
    });
  });

  it("keeps the sandbox and frame-ancestors directives", () => {
    // These are what stop a stored file being framed on one of our own pages.
    expect(FILE_RESPONSE_CSP).toContain("sandbox");
    expect(FILE_RESPONSE_CSP).toContain("frame-ancestors 'none'");
    expect(FILE_RESPONSE_CSP).toContain("default-src 'none'");
  });

  it("falls back to octet-stream rather than emitting an empty type", () => {
    const headers = fileResponseHeaders({
      mimeType: "",
      fileName: "x",
      disposition: "attachment",
    });
    expect(headers["Content-Type"]).toBe("application/octet-stream");
  });

  it("omits ETag entirely when there isn't one", () => {
    // An empty ETag is not the same as no ETag; a browser would cache against it.
    const headers = fileResponseHeaders({
      mimeType: "text/plain",
      fileName: "x.txt",
      disposition: "attachment",
    });
    expect("ETag" in headers).toBe(false);
  });

  describe("content-disposition", () => {
    it("carries a non-ASCII name in both forms", () => {
      // RFC 5987. One line of code that breaks silently, so it is asserted
      // exactly rather than by contains().
      expect(contentDisposition("attachment", "Facturación año.pdf")).toBe(
        'attachment; filename="Facturaci_n a_o.pdf"; ' +
          "filename*=UTF-8''Facturaci%C3%B3n%20a%C3%B1o.pdf",
      );
    });

    it("neutralises a header-injection attempt in the filename", () => {
      // Attacker-supplied filenames arrive on every message. CR and LF must
      // never reach the header intact.
      const out = contentDisposition("attachment", "a\r\nSet-Cookie: x=1");
      expect(out).not.toContain("\r");
      expect(out).not.toContain("\n");
      expect(out).toContain("Set-Cookie");
      expect(out.startsWith("attachment; ")).toBe(true);
    });
  });
});

describe("message frame policy", () => {
  /**
   * THE regression test of the whole rendering design.
   *
   * `allow-scripts` together with `allow-same-origin` lets a framed document
   * reach into the parent and delete its own sandbox attribute — no sandbox at
   * all, on markup written by an anonymous sender.
   */
  it("never contains both allow-scripts and allow-same-origin", () => {
    expect(MESSAGE_FRAME_SANDBOX).toContain("allow-same-origin");
    expect(MESSAGE_FRAME_SANDBOX).not.toContain("allow-scripts");
    expect(MESSAGE_FRAME_CSP).not.toContain("allow-scripts");
  });

  it("is the exact sandbox token list", () => {
    expect(MESSAGE_FRAME_SANDBOX).toBe(
      "allow-same-origin allow-popups allow-popups-to-escape-sandbox",
    );
  });

  it("withholds every token that would let the frame act on its own", () => {
    for (const token of [
      "allow-forms",
      "allow-modals",
      "allow-downloads",
      "allow-top-navigation",
      "allow-pointer-lock",
      "allow-presentation",
    ]) {
      expect(MESSAGE_FRAME_SANDBOX).not.toContain(token);
    }
  });

  it("locks every fetch directive down", () => {
    for (const directive of [
      "default-src 'none'",
      "script-src 'none'",
      "img-src 'self'",
      "connect-src 'none'",
      "object-src 'none'",
      "frame-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      "frame-ancestors 'self'",
    ]) {
      expect(MESSAGE_FRAME_CSP).toContain(directive);
    }
  });

  it("repeats the sandbox tokens in the header, matching the attribute", () => {
    // The browser takes the UNION of element and header restrictions, so a
    // mismatch silently drops allow-same-origin and breaks height measurement.
    expect(MESSAGE_FRAME_CSP).toContain(`sandbox ${MESSAGE_FRAME_SANDBOX}`);
  });

  it("never allows a remote image host, in any mode", () => {
    // Unblocking images changes what the sanitizer EMITS, never what the
    // browser permits — proxied images are 'self'. A policy with a permissive
    // mode would also re-open CSS exfiltration for the whole document.
    expect(MESSAGE_FRAME_CSP).not.toContain("img-src https:");
    expect(MESSAGE_FRAME_CSP).not.toContain("img-src *");
  });

  it("serves the frame as no-store, no-referrer, noindex", () => {
    const headers = messageFrameHeaders();
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["Cache-Control"]).toBe("private, no-store");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Robots-Tag"]).toContain("noindex");
  });
});

describe("plain text bodies", () => {
  it("escapes the five characters that matter", () => {
    expect(escapeHtml(`<b>&'"`)).toBe("&lt;b&gt;&amp;&#39;&quot;");
  });

  it("escapes markup a sender typed as literal text", () => {
    const out = renderTextBody("<script>alert(1)</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("does not let a sender close our own tags", () => {
    // The text contains </details>; if it escaped, quote folding could be
    // broken out of.
    const out = renderTextBody("> a\n> b\n> c\n> d\n</details><img src=x>");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;/details&gt;");
  });

  describe("linkification", () => {
    it("links a plain URL", () => {
      const out = linkifyLine("see https://example.com/x for details");
      expect(out).toContain('href="https://example.com/x"');
      expect(out).toContain('target="_blank"');
      expect(out).toContain('rel="noopener noreferrer nofollow"');
    });

    it("leaves trailing sentence punctuation out of the href", () => {
      const out = linkifyLine("see https://example.com/x.");
      expect(out).toContain('href="https://example.com/x"');
      // The full stop belongs to the sentence, so it lands AFTER the anchor
      // rather than inside the link target.
      expect(out).toContain("</a>.");
      expect(out).not.toContain('href="https://example.com/x."');
    });

    it("keeps a closing paren the URL itself opened", () => {
      expect(trimUrlTail("https://example.com/wiki/Foo_(bar)")).toBe(
        "https://example.com/wiki/Foo_(bar)",
      );
      expect(trimUrlTail("https://example.com/x)")).toBe("https://example.com/x");
    });

    it("gives a bare www. host a scheme but keeps the label", () => {
      const out = linkifyLine("visit www.example.com today");
      expect(out).toContain('href="https://www.example.com"');
      expect(out).toContain(">www.example.com</a>");
    });

    it("links a bare email address as mailto", () => {
      const out = linkifyLine("write to dan@example.com please");
      expect(out).toContain('href="mailto:dan@example.com"');
    });

    it("escapes an ampersand in a URL exactly once", () => {
      // The double-escape regression: linkify-after-escape yields &amp;amp;.
      const out = linkifyLine("https://example.com/?a=1&b=2");
      expect(out).toContain('href="https://example.com/?a=1&amp;b=2"');
      expect(out).not.toContain("&amp;amp;");
    });

    it("does not linkify a javascript: scheme", () => {
      const out = linkifyLine("javascript:alert(1)");
      expect(out).not.toContain("<a ");
      expect(out).not.toContain("javascript:alert(1)</a>");
    });

    it("shows the real host in a title, for a script-free phishing tell", () => {
      const out = linkifyLine("https://evil.invalid/login");
      expect(out).toContain('title="evil.invalid"');
    });
  });

  describe("quoting", () => {
    it("nests by quote depth", () => {
      const out = renderTextBody("top\n> one\n>> two");
      expect(out).toContain("<blockquote>");
      expect(out).toContain("<blockquote><blockquote>");
    });

    it("leaves a short quote unfolded", () => {
      const out = renderTextBody("> a\n> b");
      expect(out).toContain("<blockquote>");
      expect(out).not.toContain("<details>");
    });

    it("folds a long quote behind a disclosure", () => {
      const long = Array.from({ length: 20 }, (_, i) => `> line ${i}`).join("\n");
      const out = renderTextBody(long);
      expect(out).toContain("<details>");
      expect(out).toContain("20 lines");
    });

    it("folds an RFC 3676 signature", () => {
      const out = renderTextBody("Body here\n-- \nDan\nYosher");
      expect(out).toContain("y-sig");
      expect(out).toContain("Dan");
    });
  });

  it("normalizes CRLF and lone CR identically", () => {
    const lf = renderTextBody("a\nb");
    expect(renderTextBody("a\r\nb")).toBe(lf);
    expect(renderTextBody("a\rb")).toBe(lf);
  });

  it("renders an empty body as empty, inventing nothing", () => {
    // parse.ts's standing rule carried up: presentation decides how to show an
    // absence; it never manufactures one.
    expect(renderTextBody("")).toBe('<div class="y-text"></div>');
  });
});

describe("attachment policy", () => {
  it("refuses to serve HTML as HTML", () => {
    // Mail has no upload gate, so the refusal moves to serving time. Stripped
    // of its type and forced to download, no browser will render it.
    const p = mailAttachmentPolicy("text/html", "report.html");
    expect(p.servedType).toBe("application/octet-stream");
    expect(p.disposition).toBe("attachment");
    expect(p.warn).toBe(true);
  });

  it("treats SVG as active content, not as an image", () => {
    // The classic bypass: it looks like an image and is a scriptable document.
    const p = mailAttachmentPolicy("image/svg+xml", "logo.svg");
    expect(p.servedType).toBe("application/octet-stream");
    expect(p.warn).toBe(true);
  });

  it("flags a dangerous extension even when the type looks harmless", () => {
    // The sender controls the bytes AND the metadata, so they are not trusted
    // to agree with each other.
    const p = mailAttachmentPolicy("application/pdf", "invoice.pdf.exe");
    expect(p.servedType).toBe("application/octet-stream");
    expect(p.warn).toBe(true);
  });

  it("never rewrites the extension it warned about", () => {
    // Hiding the second extension is how a disguised executable gets opened.
    expect(mailAttachmentPolicy("application/pdf", "invoice.pdf.exe").fileName).toBe(
      "invoice.pdf.exe",
    );
  });

  it("serves a PDF as a PDF but never inline", () => {
    // The reading pane paints PDFs with the existing PdfCanvas, so there is one
    // PDF path in the product rather than two.
    const p = mailAttachmentPolicy("application/pdf", "invoice.pdf", true);
    expect(p.servedType).toBe("application/pdf");
    expect(p.disposition).toBe("attachment");
    expect(p.warn).toBe(false);
  });

  it("allows a real image inline, but only when asked", () => {
    expect(mailAttachmentPolicy("image/png", "logo.png", true).disposition).toBe("inline");
    expect(mailAttachmentPolicy("image/png", "logo.png").disposition).toBe("attachment");
  });

  it("ignores charset parameters and casing on the declared type", () => {
    const p = mailAttachmentPolicy("TEXT/HTML; charset=utf-8", "x.html");
    expect(p.servedType).toBe("application/octet-stream");
    expect(p.warn).toBe(true);
  });

  it("passes an ordinary document through as a download, unflagged", () => {
    const p = mailAttachmentPolicy(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "contract.docx",
    );
    expect(p.disposition).toBe("attachment");
    expect(p.warn).toBe(false);
  });

  it("sanitizes a filename carrying header separators", () => {
    const injected = mailAttachmentPolicy("text/plain", "a\r\nSet-Cookie: x=1").fileName;
    expect(injected).not.toMatch(/[\r\n]/);
    expect(mailAttachmentPolicy("text/plain", " ").fileName).toBe("download");
  });
});

describe("inline cid images", () => {
  /** Captured from a live Stalwart — brackets already stripped by the server. */
  const PARTS = [
    {
      partId: "5",
      blobId: "blob-logo",
      size: 70,
      name: "logo.png",
      type: "image/png",
      charset: null,
      disposition: "inline",
      cid: "logo-part-1@yosher.test",
    },
    {
      partId: "6",
      blobId: "blob-pdf",
      size: 192,
      name: "Facturación año.pdf",
      type: "application/pdf",
      charset: null,
      disposition: "attachment",
      cid: null,
    },
  ];

  it("keys the map on the bare id, however the reference is written", () => {
    const map = buildCidMap(PARTS);
    for (const reference of [
      "logo-part-1@yosher.test",
      "<logo-part-1@yosher.test>",
      "cid:logo-part-1@yosher.test",
      "cid:%3Clogo-part-1@yosher.test%3E",
      "  logo-part-1@yosher.test  ",
    ]) {
      expect(lookupCid(map, reference)?.blobId, reference).toBe("blob-logo");
    }
  });

  it("falls back to a case-insensitive match", () => {
    // RFC 2392 says case-sensitive; real senders disagree often enough that the
    // fallback rescues more messages than it endangers, and matching still only
    // ever resolves to one of this message's own parts.
    const map = buildCidMap(PARTS);
    expect(lookupCid(map, "LOGO-PART-1@YOSHER.TEST")?.blobId).toBe("blob-logo");
  });

  it("excludes parts with no cid", () => {
    const map = buildCidMap(PARTS);
    expect(map.size).toBe(1);
  });

  it("excludes a cid part with no blobId, rather than emitting a broken URL", () => {
    expect(buildCidMap([{ ...PARTS[0], blobId: null }]).size).toBe(0);
  });

  it("refuses to inline an SVG even when it is a proper cid part", () => {
    expect(
      buildCidMap([{ ...PARTS[0], type: "image/svg+xml", cid: "vector@x" }]).size,
    ).toBe(0);
  });

  it("returns null for an unmatched reference so the image can be dropped", () => {
    expect(lookupCid(buildCidMap(PARTS), "cid:nothing@here")).toBeNull();
  });

  it("lets the first of two duplicate Content-IDs win", () => {
    const map = buildCidMap([
      PARTS[0],
      { ...PARTS[0], blobId: "blob-shadow", partId: "9" },
    ]);
    expect(lookupCid(map, PARTS[0].cid!)?.blobId).toBe("blob-logo");
  });
});

describe("html sanitizer", () => {
  const cidMap = new Map<string, InlinePart>([
    [
      "logo@x",
      { cid: "logo@x", blobId: "blob-logo", type: "image/png", name: "logo.png", size: 70 },
    ],
  ]);
  const inlineUrl = (p: InlinePart) => `/api/mail/acct/blob/${p.blobId}`;
  const remoteUrl = (u: string) => `/api/mail/img?u=${encodeURIComponent(u)}`;

  /** Images blocked — the state every message opens in. */
  const blocked = (html: string) => sanitizeMessageHtml(html, { cidMap, inlineUrl });
  const unblocked = (html: string) =>
    sanitizeMessageHtml(html, { cidMap, inlineUrl, remoteUrl });

  /**
   * The corpus. Every entry is run through the same invariants below, so adding
   * a payload here automatically tests all of them — which is the point.
   */
  const XSS_CORPUS = [
    "<script>alert(1)</script>",
    "<SCRIPT >alert(1)</SCRIPT>",
    "<scr<script>ipt>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "<img src=x OnErRoR=alert(1)>",
    "<div onclick=alert(1)>click</div>",
    "<a href=\"javascript:alert(1)\">x</a>",
    "<a href=\"JaVaScRiPt:alert(1)\">x</a>",
    "<a href=\"  javascript:alert(1)\">x</a>",
    "<a href=\"vbscript:msgbox(1)\">x</a>",
    "<a href=\"data:text/html,<script>alert(1)</script>\">x</a>",
    "<iframe src=\"https://evil.invalid\"></iframe>",
    "<object data=\"evil.swf\"></object>",
    "<embed src=\"evil.swf\">",
    "<form action=\"https://evil.invalid\"><input name=p></form>",
    "<meta http-equiv=\"refresh\" content=\"0;url=https://evil.invalid\">",
    "<base href=\"https://evil.invalid/\">",
    "<link rel=stylesheet href=\"https://evil.invalid/x.css\">",
    "<svg><script>alert(1)</script></svg>",
    "<math><mtext><script>alert(1)</script></mtext></math>",
    "<template><script>alert(1)</script></template>",
    // Outlook conditional comments — present in a large share of real mail.
    "<!--[if mso]><script>alert(1)</script><![endif]-->",
    // mXSS classics: these catch a parser swap introducing a mutation bug.
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    '<svg></p><style><a id="</style><img src=1 onerror=alert(2)>">',
    '<a href="x" title="a&quot;onmouseover=alert(1)">t</a>',
    // Truncated mid-tag — exactly what a body cut at maxBodyValueBytes looks like.
    '<div><p>hello<img src="https://tracker.invalid/p.gif',
  ];

  it("never emits a script tag, an event handler, or an unsafe scheme", () => {
    for (const payload of XSS_CORPUS) {
      for (const mode of [blocked, unblocked]) {
        const { html } = mode(payload);
        expect(html.toLowerCase(), payload).not.toContain("<script");
        expect(html.toLowerCase(), payload).not.toContain("<iframe");
        expect(html.toLowerCase(), payload).not.toContain("<object");
        expect(html.toLowerCase(), payload).not.toContain("<embed");
        expect(html.toLowerCase(), payload).not.toContain("<form");
        expect(html.toLowerCase(), payload).not.toContain("<base");
        expect(html.toLowerCase(), payload).not.toContain("javascript:");
        expect(html.toLowerCase(), payload).not.toContain("vbscript:");
        expect(html.toLowerCase(), payload).not.toContain("data:text/html");
        // No on* handler survives, in any casing or spacing.
        expect(html, payload).not.toMatch(/\son[a-z]+\s*=/i);
      }
    }
  });

  it("keeps link text when it refuses the destination", () => {
    // The reader still sees what the message said; it just is not clickable.
    const { html } = blocked('<a href="javascript:alert(1)">Click here</a>');
    expect(html).toContain("Click here");
    expect(html).not.toContain("javascript:");
  });

  it("forces target and rel on every surviving link", () => {
    const { html } = blocked('<a href="https://example.com/x">go</a>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("noopener");
    expect(html).toContain("noreferrer");
    expect(html).toContain('title="example.com"');
  });

  describe("remote content", () => {
    it("does not leak the tracker URL ANYWHERE in the output when blocked", () => {
      // String absence is the real leak test — not merely that src changed.
      const { html, blockedRemoteCount } = blocked(
        '<img src="https://tracker.invalid/open.gif?id=abc" alt="pixel">',
      );
      expect(html).not.toContain("tracker.invalid");
      expect(html).not.toContain("id=abc");
      expect(blockedRemoteCount).toBe(1);
      expect(html).toContain('alt="pixel"');
    });

    it("strips srcset, which would load the tracker despite a blocked src", () => {
      const { html } = blocked(
        '<img src="https://tracker.invalid/1x.gif" srcset="https://tracker.invalid/2x.gif 2x">',
      );
      expect(html).not.toContain("srcset");
      expect(html).not.toContain("tracker.invalid");
    });

    it("blocks a remote url() in a style attribute", () => {
      const { html } = blocked(
        '<div style="background-image:url(https://tracker.invalid/bg.png)">x</div>',
      );
      expect(html).not.toContain("tracker.invalid");
    });

    it("blocks a remote url() inside a style block", () => {
      const { html } = blocked(
        "<style>body{background:url(https://tracker.invalid/bg.png)}</style><p>x</p>",
      );
      expect(html).not.toContain("tracker.invalid");
    });

    it("routes an unblocked image through the proxy, never direct", () => {
      const { html, blockedRemoteCount } = unblocked(
        '<img src="https://cdn.example.com/logo.png">',
      );
      expect(html).toContain("/api/mail/img?u=");
      expect(html).not.toContain('src="https://cdn.example.com/logo.png"');
      expect(blockedRemoteCount).toBe(0);
    });

    it("treats a protocol-relative src as remote", () => {
      const { html } = blocked('<img src="//tracker.invalid/p.gif">');
      expect(html).not.toContain("tracker.invalid");
    });
  });

  describe("inline images", () => {
    it("renders a cid image EVEN WHILE remote images are blocked", () => {
      // The independence that matters: cid bytes came in the same envelope and
      // reach no third party, so showing them reports nothing to anyone.
      const { html, blockedRemoteCount } = blocked('<img src="cid:logo@x" alt="logo">');
      expect(html).toContain("/api/mail/acct/blob/blob-logo");
      expect(blockedRemoteCount).toBe(0);
    });

    it("matches a bracketed cid reference", () => {
      const { html } = blocked('<img src="cid:%3Clogo@x%3E">');
      expect(html).toContain("blob-logo");
    });

    it("drops an unmatched cid image, keeping the alt, never falling through to remote", () => {
      const { html } = blocked('<img src="cid:missing@x" alt="gone">');
      expect(html).not.toContain("cid:");
      expect(html).toContain('alt="gone"');
    });
  });

  describe("hostile css", () => {
    it("neutralises position:fixed so a message cannot paint over our chrome", () => {
      const { html } = blocked('<div style="position:fixed;top:0">overlay</div>');
      expect(html).not.toContain("position:fixed");
    });

    it("removes @import and expression()", () => {
      const { html } = blocked(
        "<style>@import url('https://evil.invalid/x.css'); a{width:expression(alert(1))}</style>",
      );
      expect(html).not.toContain("@import");
      expect(html).not.toContain("expression(");
      expect(html).not.toContain("evil.invalid");
    });
  });

  it("survives a body truncated mid-tag without throwing", () => {
    // maxBodyValueBytes cuts at an arbitrary byte, which for HTML means
    // mid-tag. This is the input class the sanitizer must never crash on.
    expect(() => blocked('<div><p>hi<img src="https://x.invalid/a.gif')).not.toThrow();
    expect(() => blocked("<table><tr><td>unclosed")).not.toThrow();
  });

  it("keeps ordinary formatting intact", () => {
    // A sanitizer that eats the message is also a failure.
    const { html } = blocked(
      "<p><strong>Invoice</strong> 4471</p><table><tr><td>Item</td><td>£10</td></tr></table>",
    );
    expect(html).toContain("<strong>Invoice</strong>");
    expect(html).toContain("<table>");
    expect(html).toContain("£10");
  });
});

describe("url signing", () => {
  // A 32-byte base64 key, so the derivation has something to work with.
  process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

  const claim = (over: Partial<BlobClaim> = {}): BlobClaim => ({
    tenantId: "11111111-1111-1111-1111-111111111111",
    clerkUserId: "user_abc",
    mailAccountId: "22222222-2222-2222-2222-222222222222",
    blobId: "blob-1",
    servedType: "application/pdf",
    fileName: "invoice.pdf",
    disposition: "attachment",
    expiresAt: 4_000_000_000_000,
    ...over,
  });

  it("verifies a claim it signed", () => {
    const c = claim();
    expect(verifyBlobClaim(c, signBlobClaim(c))).toBe(true);
  });

  it("refuses when ANY signed field is altered", () => {
    // Each field is in the payload, so none can be swapped for a nicer value —
    // notably disposition and servedType, which are the policy's decision.
    const original = claim();
    const signature = signBlobClaim(original);
    const tampered: Partial<BlobClaim>[] = [
      { tenantId: "33333333-3333-3333-3333-333333333333" },
      { clerkUserId: "user_someone_else" },
      { mailAccountId: "44444444-4444-4444-4444-444444444444" },
      { blobId: "blob-2" },
      { servedType: "text/html" },
      { fileName: "other.pdf" },
      { disposition: "inline" },
      { expiresAt: 4_100_000_000_000 },
    ];
    for (const change of tampered) {
      expect(verifyBlobClaim(claim(change), signature), JSON.stringify(change)).toBe(
        false,
      );
    }
  });

  it("refuses an expired claim even when the signature is perfect", () => {
    const c = claim({ expiresAt: 1_000 });
    expect(verifyBlobClaim(c, signBlobClaim(c), 2_000)).toBe(false);
    expect(verifyBlobClaim(c, signBlobClaim(c), 500)).toBe(true);
  });

  it("refuses a garbage or empty signature without throwing", () => {
    const c = claim();
    for (const bad of ["", "x", "!!!!", "a".repeat(200)]) {
      expect(() => verifyBlobClaim(c, bad)).not.toThrow();
      expect(verifyBlobClaim(c, bad)).toBe(false);
    }
  });

  it("cannot move a field boundary to forge an identical payload", () => {
    // The separator-collision class: with a joinable separator, ("ab","c") and
    // ("a","bc") serialize the same. NUL cannot appear in any of these fields.
    const a = signBlobClaim(claim({ blobId: "ab", servedType: "c/d" }));
    const b = signBlobClaim(claim({ blobId: "a", servedType: "bc/d" }));
    expect(a).not.toBe(b);
  });

  it("keys blob and image URLs separately", () => {
    // A signature for one purpose must not open the other, which is what the
    // labelled derivation buys.
    const img = { tenantId: "t", clerkUserId: "u", url: "https://x/y.png", expiresAt: 4e12 };
    expect(verifyImageClaim(img, signImageClaim(img))).toBe(true);
    expect(verifyImageClaim({ ...img, url: "https://evil/z.png" }, signImageClaim(img))).toBe(
      false,
    );
  });
});
