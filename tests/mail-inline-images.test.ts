import { describe, expect, it } from "vitest";
import { draftObject } from "@/lib/email/jmap/draft";
import type { JmapComposedMessage } from "@/lib/email/jmap/types";
import { sanitizeOutboundHtml } from "@/modules/email/compose/html";
import { htmlToPlainText } from "@/modules/email/compose/to-text";
import { composeBodies } from "@/modules/email/compose/bodies";
import {
  isInlineImageType,
  isValidCid,
  mintCid,
  MAX_INLINE_IMAGE_BYTES,
} from "@/modules/email/compose/inline";

/**
 * Inline images.
 *
 * Two things are being guarded here and they pull in opposite directions.
 *
 * The SHAPE: a `cid:` reference only resolves inside a `multipart/related`
 * (RFC 2387). `npm run mail:probe-compose` found that the convenience
 * properties produce `multipart/mixed` instead — the picture ends up a sibling
 * of the alternative and arrives as a broken image with the file underneath —
 * and that an explicit `bodyStructure` is honoured verbatim. The tests over
 * `draftObject` pin the tree the probe proved, so a refactor cannot quietly go
 * back to the shape that does not work.
 *
 * The RULE: `<img>` is admitted only for a cid this message minted, and its
 * `src` is REBUILT rather than read. That is what keeps "no remote images ever"
 * true while offering inline ones at all, and it is asserted from both ends.
 */

const CID = "0123456789abcdef0123456789abcdef@yosher.mail";
const OTHER_CID = "fedcba9876543210fedcba9876543210@yosher.mail";

function message(over: Partial<JmapComposedMessage> = {}): JmapComposedMessage {
  return {
    identityId: "i1",
    from: { name: "Dan", email: "dan@example.com" },
    to: [{ name: null, email: "them@example.com" }],
    cc: [],
    bcc: [],
    subject: "Hello",
    textBody: "Above.\n\n[image]\n\nBelow.",
    htmlBody: `<p>Above.</p><img src="cid:${CID}"><p>Below.</p>`,
    draftsMailboxId: "drafts",
    envelopeRcptTo: ["them@example.com"],
    ...over,
  };
}

/** Walk a bodyStructure to the list of types, depth first. */
function shapeOf(part: unknown): string {
  const node = part as { type: string; subParts?: unknown[] };
  if (!node.subParts) return node.type;
  return `${node.type}(${node.subParts.map(shapeOf).join(",")})`;
}

describe("draftObject — how the message is described to the server", () => {
  it("uses the convenience properties when there are no inline images", () => {
    // Simpler, and it is what every message before inline images shipped with.
    // The server assembling the MIME is the whole reason not to do it by hand.
    const draft = draftObject(message({ htmlBody: "<p>Hi</p>" }));
    expect(draft.textBody).toEqual([{ partId: "text", type: "text/plain" }]);
    expect(draft.htmlBody).toEqual([{ partId: "html", type: "text/html" }]);
    expect(draft.bodyStructure).toBeUndefined();
  });

  it("builds an explicit multipart/related when there IS an inline image", () => {
    // THE SHAPE THE PROBE PROVED. Handed `disposition: "inline"` through the
    // convenience properties instead, the server produces multipart/MIXED with
    // the picture as a sibling of the alternative — where a cid reference does
    // not resolve, so the recipient gets a broken image and a stray file.
    const draft = draftObject(
      message({
        inlineImages: [
          { blobId: "b1", cid: CID, type: "image/png", name: "dot.png" },
        ],
      }),
    );
    expect(draft.textBody).toBeUndefined();
    expect(draft.htmlBody).toBeUndefined();
    expect(shapeOf(draft.bodyStructure)).toBe(
      "multipart/related(multipart/alternative(text/plain,text/html),image/png)",
    );
  });

  it("keeps a real attachment OUTSIDE the related part", () => {
    // A PDF is not a resource the body renders. Putting it inside `related`
    // invites clients to treat it as one and hide it from the attachment list.
    const draft = draftObject(
      message({
        inlineImages: [
          { blobId: "b1", cid: CID, type: "image/png", name: "dot.png" },
        ],
        attachments: [
          { blobId: "b2", type: "application/pdf", name: "quote.pdf" },
        ],
      }),
    );
    expect(shapeOf(draft.bodyStructure)).toBe(
      "multipart/mixed(" +
        "multipart/related(multipart/alternative(text/plain,text/html),image/png)," +
        "application/pdf)",
    );
  });

  it("carries the cid and the inline disposition onto the picture's part", () => {
    const draft = draftObject(
      message({
        inlineImages: [
          { blobId: "b1", cid: CID, type: "image/png", name: "dot.png" },
        ],
      }),
    );
    const structure = draft.bodyStructure as { subParts: Record<string, unknown>[] };
    const image = structure.subParts[1];
    expect(image).toMatchObject({
      blobId: "b1",
      cid: CID,
      disposition: "inline",
      type: "image/png",
      name: "dot.png",
    });
  });

  it("still supplies both bodyValues, so the alternative has content", () => {
    const draft = draftObject(
      message({
        inlineImages: [
          { blobId: "b1", cid: CID, type: "image/png", name: "dot.png" },
        ],
      }),
    );
    expect(draft.bodyValues).toMatchObject({
      text: { value: expect.stringContaining("Above.") },
      html: { value: expect.stringContaining("cid:") },
    });
  });
});

describe("the <img> rule", () => {
  const allow = { allowedCids: new Set([CID]) };

  it("keeps an image whose cid this message minted", () => {
    const out = sanitizeOutboundHtml(
      `<img src="/api/mail/a/blob/b?sig=x" data-cid="${CID}" alt="a dot">`,
      allow,
    );
    expect(out).toContain(`src="cid:${CID}"`);
    expect(out).toContain('alt="a dot"');
    // The preview URL must not survive: it is a signed, expiring link to OUR
    // server, and a recipient following it would get a 404 at best.
    expect(out).not.toContain("/api/mail/");
    expect(out).not.toContain("sig=");
  });

  it("REBUILDS the src rather than copying it", () => {
    // The strongest form of "no remote images": there is no code path in which
    // a caller-supplied src reaches the output, so a tracking pixel cannot be
    // smuggled through by pairing it with a valid cid.
    const out = sanitizeOutboundHtml(
      `<img src="https://tracker.example/p.gif" data-cid="${CID}">`,
      allow,
    );
    expect(out).toContain(`src="cid:${CID}"`);
    expect(out).not.toContain("tracker.example");
  });

  it("drops an image naming a cid this message did not mint", () => {
    const out = sanitizeOutboundHtml(
      `<p>a</p><img src="x" data-cid="${OTHER_CID}"><p>b</p>`,
      allow,
    );
    expect(out).not.toContain("img");
    expect(out).toContain("a");
    expect(out).toContain("b");
  });

  it("drops an image with no cid at all, leaving no broken icon", () => {
    // Both halves matter: stripping the attributes loses the URL, and removing
    // the element is what stops a bare <img> rendering as a broken-image icon
    // in a message whose sender believed it carried a picture.
    const out = sanitizeOutboundHtml(
      '<img src="https://tracker.example/p.gif" width="1" height="1">',
      allow,
    );
    expect(out).not.toContain("img");
    expect(out).not.toContain("tracker.example");
  });

  it("admits NO image when no allowlist is supplied", () => {
    // The default, and what every path that is not the composer gets.
    const out = sanitizeOutboundHtml(`<img src="x" data-cid="${CID}">`);
    expect(out).not.toContain("img");
  });

  it("emits a max-width so a phone photograph does not blow out the layout", () => {
    const out = sanitizeOutboundHtml(`<img src="x" data-cid="${CID}">`, allow);
    expect(out).toContain("max-width:100%");
  });

  it("keeps only integer dimensions", () => {
    const out = sanitizeOutboundHtml(
      `<img src="x" data-cid="${CID}" width="640" height="480px">`,
      allow,
    );
    expect(out).toContain('width="640"');
    expect(out).not.toContain("480");
  });

  it("does not let an image carry anything else", () => {
    const out = sanitizeOutboundHtml(
      `<img src="x" data-cid="${CID}" onerror="steal()" class="x" ` +
        `usemap="#m" style="position:fixed">`,
      allow,
    );
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("class");
    expect(out).not.toContain("usemap");
    expect(out).not.toContain("position:fixed");
  });
});

describe("an image in the plain-text alternative", () => {
  it("says a picture was there, and what it showed", () => {
    // Silently dropping it is how "see the photo below" arrives with nothing
    // below it for anyone reading the text part.
    const html = sanitizeOutboundHtml(
      `<p>See below.</p><img src="x" data-cid="${CID}" alt="the north elevation">`,
      { allowedCids: new Set([CID]) },
    );
    expect(htmlToPlainText(html)).toBe("See below.\n\n[image: the north elevation]");
  });

  it("falls back to a bare marker when there is no alt text", () => {
    const html = sanitizeOutboundHtml(`<p>Look</p><img src="x" data-cid="${CID}">`, {
      allowedCids: new Set([CID]),
    });
    expect(htmlToPlainText(html)).toBe("Look\n\n[image]");
  });
});

describe("composeBodies with images", () => {
  it("threads the allowlist through to the sanitizer", () => {
    const { htmlBody, textBody } = composeBodies(
      `<p>Hi</p><img src="preview" data-cid="${CID}" alt="dot">`,
      "",
      new Set([CID]),
    );
    expect(htmlBody).toContain(`cid:${CID}`);
    expect(textBody).toContain("[image: dot]");
  });

  it("admits nothing when the caller forgets the allowlist", () => {
    // The default is an EMPTY set rather than "allow everything", so forgetting
    // to pass it loses images rather than admitting unchecked ones.
    const { htmlBody } = composeBodies(
      `<p>Hi</p><img src="preview" data-cid="${CID}">`,
      "",
    );
    expect(htmlBody).not.toContain("img");
    expect(htmlBody).toContain("Hi");
  });
});

describe("the inline-image rules", () => {
  it("accepts the raster types and refuses SVG", () => {
    for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(isInlineImageType(type)).toBe(true);
    }
    // SVG is a document that can carry script and external references, not a
    // picture — and this one leaves under the user's own name where nothing of
    // ours looks at it again.
    expect(isInlineImageType("image/svg+xml")).toBe(false);
    expect(isInlineImageType("application/pdf")).toBe(false);
    expect(isInlineImageType("text/html")).toBe(false);
  });

  it("is case- and whitespace-tolerant about the type", () => {
    expect(isInlineImageType("  IMAGE/PNG ")).toBe(true);
  });

  it("mints cids that validate, and are distinct", () => {
    const minted = Array.from({ length: 50 }, () => mintCid());
    for (const cid of minted) expect(isValidCid(cid)).toBe(true);
    expect(new Set(minted).size).toBe(minted.length);
  });

  it("refuses a content id that could break out of a header", () => {
    // This value lands in a MIME header AND inside a `cid:` URL in the body, so
    // anything carrying a quote, a bracket or whitespace is a header-injection
    // question rather than a formatting one.
    for (const bad of [
      "",
      "not-a-cid",
      'x"@yosher.mail',
      "x @yosher.mail",
      "x>@yosher.mail",
      "x\n@yosher.mail",
      "0123456789abcdef0123456789abcdef@evil.example",
      "0123456789abcdef0123456789abcdef@yosher.mail extra",
      "../../etc@yosher.mail",
    ]) {
      expect(isValidCid(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("caps a single image well under a mail server's attachment limit", () => {
    expect(MAX_INLINE_IMAGE_BYTES).toBeLessThanOrEqual(10 * 1024 * 1024);
  });
});
