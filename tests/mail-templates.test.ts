import { describe, expect, it } from "vitest";
import {
  applyTemplateSubject,
  prepareTemplateBody,
  templateIsEmpty,
  templateNameKey,
  MAX_TEMPLATE_HTML,
} from "@/modules/email/templates/validate";

/**
 * Canned responses — the one compose feature stored in our own database.
 *
 * `npm run mail:probe-templates` is why it is a table rather than something on
 * the mail server: the server CAN hold a template (a `$draft` message in a
 * mailbox of its own, exactly Gmail's original canned responses, markup intact
 * and no pollution of the Drafts folder) but every such location is scoped to
 * ONE ACCOUNT. Sharing the company's wording would mean granting a colleague
 * the mailbox and every message in it.
 */

describe("templateNameKey", () => {
  it("folds case and runs of whitespace, so near-duplicates collide", () => {
    // The unique index is on this rather than on `name`, so the second save is
    // refused with a message instead of producing two rows that look identical
    // in a picker somebody is scanning mid-sentence.
    expect(templateNameKey("Payment terms")).toBe("payment terms");
    expect(templateNameKey("  Payment   TERMS  ")).toBe("payment terms");
    expect(templateNameKey("Payment\tterms")).toBe("payment terms");
  });

  it("keeps genuinely different names apart", () => {
    expect(templateNameKey("Payment terms")).not.toBe(
      templateNameKey("Payment terms (overdue)"),
    );
  });
});

describe("prepareTemplateBody", () => {
  it("keeps the formatting the composer's own toolbar can produce", () => {
    const html = prepareTemplateBody(
      "<p>Our terms are <b>30 days</b> from <i>invoice date</i>.</p>",
    );
    expect(html).toContain("<b>30 days</b>");
    expect(html).toContain("<i>invoice date</i>");
  });

  it("strips script and event handlers", () => {
    const html = prepareTemplateBody(
      '<p onclick="steal()">Hi</p><script>alert(1)</script>',
    );
    expect(html).not.toContain("script");
    expect(html).not.toContain("onclick");
    expect(html).toContain("Hi");
  });

  it("DROPS INLINE IMAGES rather than storing them", () => {
    // The one rule specific to templates. A `cid:` is minted per message and
    // lives in that message's MIME, so a stored template referencing one would
    // show a broken image on every mail it was later inserted into. No cid
    // allowlist is passed, and the sanitizer's default is an empty set.
    const html = prepareTemplateBody(
      '<p>Logo: <img src="cid:abc123" data-cid="abc123" alt="Logo"></p>',
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("cid:");
  });

  it("drops a remote image too, so a template cannot carry a tracking pixel", () => {
    const html = prepareTemplateBody(
      '<p>Hi<img src="https://tracker.example/p.gif" width="1" height="1"></p>',
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("tracker.example");
  });

  it("does not let the stored size grow with the paste", () => {
    // The cap is on the INPUT. Slicing raw markup cuts through a tag and the
    // sanitizer then closes it, so the output can be a handful of characters
    // longer than the cap — truncating the sanitized result instead would
    // reintroduce the unbalanced markup it just fixed. What matters is that a
    // paste twice the size and a paste ten times the size store the same
    // bounded amount.
    const twice = prepareTemplateBody(`<p>${"x".repeat(MAX_TEMPLATE_HTML * 2)}</p>`);
    const tenfold = prepareTemplateBody(`<p>${"x".repeat(MAX_TEMPLATE_HTML * 10)}</p>`);
    expect(twice.length).toBe(tenfold.length);
    expect(twice.length).toBeLessThan(MAX_TEMPLATE_HTML + 100);
  });
});

describe("templateIsEmpty", () => {
  it("treats an untouched editor as empty", () => {
    // A contenteditable nobody typed in emits this. Storing it would create a
    // template that inserts nothing, which reads as a broken feature rather
    // than as an empty template.
    expect(templateIsEmpty(prepareTemplateBody("<div><br></div>"))).toBe(true);
    expect(templateIsEmpty(prepareTemplateBody(""))).toBe(true);
  });

  it("treats markup that sanitizes away as empty", () => {
    // Asked of the SANITIZED body, so a paste of only a script tag is refused
    // at save rather than stored as a template that does nothing.
    expect(templateIsEmpty(prepareTemplateBody("<script>alert(1)</script>"))).toBe(
      true,
    );
  });

  it("does not treat real content as empty", () => {
    expect(templateIsEmpty(prepareTemplateBody("<p>Our terms are 30 days.</p>"))).toBe(
      false,
    );
  });
});

describe("applyTemplateSubject", () => {
  it("fills an empty subject", () => {
    expect(applyTemplateSubject("", "Payment terms")).toBe("Payment terms");
  });

  it("NEVER overwrites a subject that is already there", () => {
    // The case that decides it: applying a template to a reply must not rewrite
    // "Re: …". A template is a shortcut, not a takeover.
    expect(applyTemplateSubject("Re: Invoice 1042", "Payment terms")).toBe(
      "Re: Invoice 1042",
    );
  });

  it("treats a whitespace-only subject as empty", () => {
    expect(applyTemplateSubject("   ", "Payment terms")).toBe("Payment terms");
  });

  it("leaves the subject alone when the template has none", () => {
    // An empty template subject means "this template says nothing about the
    // subject", which must not clear one somebody typed.
    expect(applyTemplateSubject("Quote for the roof", "")).toBe(
      "Quote for the roof",
    );
    expect(applyTemplateSubject("", "")).toBe("");
  });
});
