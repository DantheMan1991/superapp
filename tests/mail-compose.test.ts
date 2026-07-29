import { describe, expect, it } from "vitest";
import type { JmapEmail, JmapEmailAddress } from "@/lib/email/jmap/types";
import {
  forwardSubject,
  MAX_REFERENCES,
  replyRecipients,
  replySubject,
  selfAddresses,
  stripMarkers,
  threadHeaders,
} from "@/modules/email/compose/reply";
import {
  attributionLine,
  forwardText,
  quoteHtml,
  quoteText,
} from "@/modules/email/compose/quote";
import {
  devDeliveryNotice,
  guardComposedRecipients,
} from "@/modules/email/compose/guard";
import {
  parseRecipient,
  parseRecipients,
  splitRecipients,
} from "@/modules/email/compose/addresses";
import { pickIdentity } from "@/modules/email/compose/send";

/**
 * Composing a reply.
 *
 * The most consequential pure code in the module: a mistake here does not
 * render wrong, it SENDS wrong, to real people, under the user's own name. So
 * the recipient rules get the same treatment the SSRF ranges did — every case
 * asserted, including the ones that only show up when somebody replies to their
 * own message.
 */

function addr(email: string, name: string | null = null): JmapEmailAddress {
  return { name, email };
}

/** Only the fields the functions under test actually read. */
function message(over: Partial<JmapEmail> = {}): JmapEmail {
  return {
    id: "m1",
    blobId: "b1",
    threadId: "t1",
    mailboxIds: {},
    keywords: {},
    from: [addr("dana@supplier.test", "Dana Rowe")],
    to: [addr("office@acme.test")],
    cc: [],
    bcc: [],
    replyTo: [],
    messageId: ["<parent@supplier.test>"],
    inReplyTo: null,
    references: null,
    subject: "Revised quote",
    sentAt: new Date("2026-07-28T09:00:00.000Z"),
    receivedAt: new Date("2026-07-28T09:15:00.000Z"),
    size: 100,
    preview: "",
    hasAttachment: false,
    attachments: [],
    textBody: "The price is 4200.",
    htmlBody: null,
    bodyTruncated: false,
    ...over,
  };
}

const SELF = selfAddresses("office@acme.test");

describe("replyRecipients", () => {
  it("replies to the sender, and to nobody else", () => {
    const r = replyRecipients(message(), "reply", SELF);
    expect(r.to.map((a) => a.email)).toEqual(["dana@supplier.test"]);
    expect(r.cc).toEqual([]);
  });

  it("Reply-To beats From", () => {
    // The everyday case: a no-reply From with a real Reply-To. Ignoring it
    // sends the answer into a void.
    const r = replyRecipients(
      message({
        from: [addr("no-reply@supplier.test")],
        replyTo: [addr("billing@supplier.test")],
      }),
      "reply",
      SELF,
    );
    expect(r.to.map((a) => a.email)).toEqual(["billing@supplier.test"]);
  });

  it("reply-all keeps the original To in To, not demoted to Cc", () => {
    const r = replyRecipients(
      message({
        to: [addr("office@acme.test"), addr("site@acme.test")],
        cc: [addr("quantity@acme.test")],
      }),
      "reply_all",
      SELF,
    );
    expect(r.to.map((a) => a.email)).toEqual([
      "dana@supplier.test",
      "site@acme.test",
    ]);
    expect(r.cc.map((a) => a.email)).toEqual(["quantity@acme.test"]);
  });

  it("never puts the same person in both To and Cc", () => {
    const r = replyRecipients(
      message({ cc: [addr("dana@supplier.test"), addr("pm@acme.test")] }),
      "reply_all",
      SELF,
    );
    expect(r.to.map((a) => a.email)).toContain("dana@supplier.test");
    expect(r.cc.map((a) => a.email)).not.toContain("dana@supplier.test");
    expect(r.cc.map((a) => a.email)).toEqual(["pm@acme.test"]);
  });

  it("excludes self from a reply-all", () => {
    const r = replyRecipients(
      message({ to: [addr("office@acme.test")], cc: [addr("OFFICE@ACME.TEST")] }),
      "reply_all",
      SELF,
    );
    const all = [...r.to, ...r.cc].map((a) => a.email.toLowerCase());
    expect(all).not.toContain("office@acme.test");
  });

  it("matches self case-insensitively", () => {
    // Local-parts are technically case-sensitive and in practice never are.
    // Matching case-sensitively puts the sender on their own reply.
    const r = replyRecipients(
      message({ to: [addr("Office@Acme.Test"), addr("site@acme.test")] }),
      "reply_all",
      SELF,
    );
    expect(r.to.map((a) => a.email)).toEqual([
      "dana@supplier.test",
      "site@acme.test",
    ]);
  });

  it("replying to YOUR OWN message writes to the people you wrote to", () => {
    // The case the naive rule breaks on: the author is you, so excluding self
    // would leave an empty To and a reply addressed to nobody.
    const own = message({
      from: [addr("office@acme.test", "Me")],
      to: [addr("dana@supplier.test"), addr("pm@acme.test")],
    });
    const r = replyRecipients(own, "reply", SELF);
    expect(r.to.map((a) => a.email)).toEqual([
      "dana@supplier.test",
      "pm@acme.test",
    ]);
  });

  it("reply-all on your own message does not re-add you", () => {
    const own = message({
      from: [addr("office@acme.test")],
      to: [addr("dana@supplier.test")],
      cc: [addr("office@acme.test"), addr("pm@acme.test")],
    });
    const r = replyRecipients(own, "reply_all", SELF);
    expect([...r.to, ...r.cc].map((a) => a.email)).not.toContain(
      "office@acme.test",
    );
    expect(r.to.map((a) => a.email)).toEqual(["dana@supplier.test"]);
    expect(r.cc.map((a) => a.email)).toEqual(["pm@acme.test"]);
  });

  it("a note to yourself still replies somewhere", () => {
    // From: me, To: me. Excluding self would produce a draft that cannot be
    // sent, so the author wins over the exclusion.
    const own = message({
      from: [addr("office@acme.test")],
      to: [addr("office@acme.test")],
    });
    const r = replyRecipients(own, "reply", SELF);
    expect(r.to).toHaveLength(1);
    expect(r.to[0].email).toBe("office@acme.test");
  });

  it("dedupes, and a display name upgrades a bare address", () => {
    const r = replyRecipients(
      message({
        to: [addr("site@acme.test"), addr("site@acme.test", "Site Office")],
      }),
      "reply_all",
      SELF,
    );
    const site = r.to.filter((a) => a.email === "site@acme.test");
    expect(site).toHaveLength(1);
    expect(site[0].name).toBe("Site Office");
  });

  it("drops blank addresses rather than emitting empty recipients", () => {
    const r = replyRecipients(
      message({ to: [addr(""), addr("  "), addr("pm@acme.test")] }),
      "reply_all",
      SELF,
    );
    expect(r.to.map((a) => a.email)).toEqual([
      "dana@supplier.test",
      "pm@acme.test",
    ]);
  });
});

describe("subjects", () => {
  it("prefixes, and does not stack", () => {
    expect(replySubject("Revised quote")).toBe("Re: Revised quote");
    expect(replySubject("Re: Revised quote")).toBe("Re: Revised quote");
    expect(replySubject("RE: re: Re: Revised quote")).toBe("Re: Revised quote");
    expect(forwardSubject("Fwd: Fwd: drawings")).toBe("Fwd: drawings");
  });

  it("handles counter and cross-language markers", () => {
    expect(replySubject("Re[2]: quote")).toBe("Re: quote");
    expect(replySubject("Re(3): quote")).toBe("Re: quote");
    // A thread that crossed a language boundary would otherwise accumulate one
    // marker per client.
    expect(replySubject("AW: Re: quote")).toBe("Re: quote");
    expect(replySubject("SV: quote")).toBe("Re: quote");
  });

  it("does NOT eat a subject that merely starts with the letters", () => {
    // The regression this regex exists to avoid. Both are real subjects.
    expect(replySubject("Review: Q3 numbers")).toBe("Re: Review: Q3 numbers");
    expect(replySubject("Reference: 4471")).toBe("Re: Reference: 4471");
    expect(stripMarkers("Retention release")).toBe("Retention release");
  });

  it("survives a subject made only of markers", () => {
    expect(replySubject("Re: Re: Re:")).toBe("Re:");
    expect(replySubject("")).toBe("Re:");
    // Absurd input strips completely rather than leaving a fragment behind.
    expect(replySubject("Re: ".repeat(500))).toBe("Re:");
  });
});

describe("threadHeaders", () => {
  it("builds In-Reply-To and References from the parent", () => {
    const h = threadHeaders(message());
    expect(h.inReplyTo).toEqual(["<parent@supplier.test>"]);
    expect(h.references).toEqual(["<parent@supplier.test>"]);
  });

  it("extends an existing chain, parent last", () => {
    const h = threadHeaders(
      message({ references: ["<root@x.test>", "<mid@x.test>"] }),
    );
    expect(h.references).toEqual([
      "<root@x.test>",
      "<mid@x.test>",
      "<parent@supplier.test>",
    ]);
  });

  it("emits nothing rather than fabricating an id", () => {
    // No Message-Id means no chain can honestly be built. An unthreaded reply
    // beats an invented identifier.
    const h = threadHeaders(message({ messageId: null }));
    expect(h.inReplyTo).toEqual([]);
    expect(h.references).toEqual([]);
  });

  it("keeps the root and the parent when truncating a long chain", () => {
    const long = Array.from({ length: 100 }, (_, i) => `<n${i}@x.test>`);
    const h = threadHeaders(message({ references: long }));
    expect(h.references).toHaveLength(MAX_REFERENCES);
    // Root first: most threading algorithms key on it.
    expect(h.references[0]).toBe("<n0@x.test>");
    // Parent last: without it the reply detaches from what it answers.
    expect(h.references[h.references.length - 1]).toBe("<parent@supplier.test>");
  });

  it("does not repeat an id already in the chain", () => {
    const h = threadHeaders(
      message({ references: ["<parent@supplier.test>", "<other@x.test>"] }),
    );
    expect(h.references.filter((r) => r === "<parent@supplier.test>")).toHaveLength(1);
  });
});

describe("quoting", () => {
  it("attributes with the received time, not the spoofable sent time", () => {
    const line = attributionLine(
      message({
        sentAt: new Date("2030-01-01T00:00:00.000Z"),
        receivedAt: new Date("2026-07-28T09:15:00.000Z"),
      }),
    );
    expect(line).toContain("2026-07-28 09:15");
    expect(line).not.toContain("2030");
    expect(line).toContain("Dana Rowe <dana@supplier.test>");
  });

  it("prefixes every line, and blank lines get a bare marker", () => {
    const q = quoteText(message({ textBody: "one\n\ntwo" }));
    expect(q).toContain("> one");
    expect(q).toContain("\n>\n");
    expect(q).toContain("> two");
  });

  it("falls back to the HTML body when there is no text part", () => {
    const q = quoteText(message({ textBody: null, htmlBody: "<p>Only HTML</p>" }));
    expect(q).toContain("> Only HTML");
  });

  it("NEVER passes the original markup through into an HTML quote", () => {
    // The property this file turns on. A quoted body is attacker-controlled
    // markup about to be sent under OUR user's name — so it is converted to
    // text and re-emitted as markup we built, never forwarded verbatim.
    const hostile =
      '<p>hi</p><script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)">x</a>';
    const q = quoteHtml(message({ textBody: null, htmlBody: hostile }));
    expect(q).not.toContain("<script");
    expect(q).not.toContain("onerror");
    expect(q).not.toContain("javascript:");
    expect(q).toContain("<blockquote");
  });

  it("escapes text that looks like markup", () => {
    const q = quoteHtml(message({ textBody: "5 < 6 & 7 > 2 <b>not bold</b>" }));
    expect(q).toContain("&lt;b&gt;not bold&lt;/b&gt;");
    expect(q).toContain("&amp;");
  });

  it("a forward carries the envelope the recipient has not seen", () => {
    const f = forwardText(
      message({ cc: [addr("pm@acme.test")], subject: "Revised quote" }),
    );
    expect(f).toContain("---------- Forwarded message ----------");
    expect(f).toContain("From: Dana Rowe <dana@supplier.test>");
    expect(f).toContain("Subject: Revised quote");
    expect(f).toContain("Cc: pm@acme.test");
  });

  it("caps a runaway quote", () => {
    const q = quoteText(message({ textBody: "x".repeat(200_000) }));
    expect(q.length).toBeLessThan(60_000);
    expect(q).toContain("[…]");
  });
});

describe("guardComposedRecipients", () => {
  const LIVE = { vercelEnv: "production", redirect: "dev@yosher.test" };
  const PREVIEW = { vercelEnv: "preview", nodeEnv: "production", redirect: "dev@yosher.test" };
  const LOCAL = { nodeEnv: "development", redirect: "dev@yosher.test" };

  it("delivers to the real recipients in production", () => {
    const g = guardComposedRecipients(["a@x.test", "b@x.test"], LIVE);
    expect(g).toEqual({ rcptTo: ["a@x.test", "b@x.test"], redirected: false });
  });

  it("redirects a VERCEL PREVIEW, which builds with NODE_ENV=production", () => {
    // The trap the whole guard exists for. NODE_ENV says production here, and a
    // preview is exactly where somebody tries out a compose screen.
    const g = guardComposedRecipients(["client@real.test"], PREVIEW);
    expect(g).toEqual({ rcptTo: ["dev@yosher.test"], redirected: true });
  });

  it("redirects locally, collapsing many recipients to one", () => {
    const g = guardComposedRecipients(["a@x.test", "b@x.test", "c@x.test"], LOCAL);
    expect(g).toEqual({ rcptTo: ["dev@yosher.test"], redirected: true });
  });

  it("REFUSES outside production when EMAIL_DEV_REDIRECT is unset", () => {
    // Refusing rather than falling back: the failure mode of guessing is
    // mailing a real customer from somebody's laptop.
    const g = guardComposedRecipients(["client@real.test"], { nodeEnv: "development" });
    expect(g).toHaveProperty("blocked");
  });

  it("refuses an empty recipient list in every environment", () => {
    expect(guardComposedRecipients([], LIVE)).toHaveProperty("blocked");
    // Also in dev, so the path that matters in production is exercised locally.
    expect(guardComposedRecipients(["  "], LOCAL)).toHaveProperty("blocked");
  });

  it("dedupes and normalises before delivery", () => {
    const g = guardComposedRecipients(["A@X.test", "a@x.test", " b@x.test "], LIVE);
    expect(g).toEqual({ rcptTo: ["a@x.test", "b@x.test"], redirected: false });
  });

  it("tells the user where their test message is actually going", () => {
    expect(devDeliveryNotice(LIVE)).toBeNull();
    expect(devDeliveryNotice(LOCAL)).toContain("dev@yosher.test");
    expect(devDeliveryNotice({ nodeEnv: "development" })).toContain("disabled");
  });
});

describe("parsing what somebody typed into the To line", () => {
  it("reads names, bare addresses, and both at once", () => {
    const r = parseRecipients("Dana Rowe <dana@x.test>, billing@y.test");
    expect(r.invalid).toEqual([]);
    expect(r.addresses).toEqual([
      { name: "Dana Rowe", email: "dana@x.test" },
      { name: null, email: "billing@y.test" },
    ]);
  });

  it("does NOT split a display name containing a comma", () => {
    // The failure this parser exists for: naive splitting turns one person into
    // two recipients, one of them nonsense.
    const r = parseRecipients('"Smith, John" <j@z.test>, other@z.test');
    expect(r.addresses).toEqual([
      { name: "Smith, John", email: "j@z.test" },
      { name: null, email: "other@z.test" },
    ]);
  });

  it("does not split on a comma inside angle brackets either", () => {
    expect(splitRecipients("<a,b@x.test>, c@x.test")).toEqual([
      "<a,b@x.test>",
      "c@x.test",
    ]);
  });

  it("accepts semicolons, because Outlook pastes them", () => {
    const r = parseRecipients("a@x.test; b@x.test");
    expect(r.addresses.map((a) => a.email)).toEqual(["a@x.test", "b@x.test"]);
  });

  it("REPORTS what it could not read rather than dropping it", () => {
    // Dropping means a message goes to three people when four were meant, and
    // nothing anywhere says so.
    const r = parseRecipients("good@x.test, Dana Rowe, also good@y.test");
    expect(r.addresses.map((a) => a.email)).toEqual(["good@x.test"]);
    expect(r.invalid).toEqual(["Dana Rowe", "also good@y.test"]);
  });

  it("dedupes case-insensitively", () => {
    const r = parseRecipients("A@X.test, a@x.test");
    expect(r.addresses).toHaveLength(1);
  });

  it("tolerates trailing separators and blank fragments", () => {
    const r = parseRecipients("a@x.test, , ;b@x.test,");
    expect(r.addresses.map((a) => a.email)).toEqual(["a@x.test", "b@x.test"]);
    expect(r.invalid).toEqual([]);
  });

  it("refuses an angle form with no address", () => {
    expect(parseRecipient("Dana <>")).toBeNull();
    expect(parseRecipient("   ")).toBeNull();
  });
});

describe("pickIdentity", () => {
  const identities = [
    { id: "1", name: "Shared", email: "info@acme.test", replyTo: null, bcc: null, textSignature: "", htmlSignature: "", mayDelete: true },
    { id: "2", name: "Me", email: "dan@acme.test", replyTo: null, bcc: null, textSignature: "sig", htmlSignature: "", mayDelete: true },
  ];

  it("prefers the identity matching the mailbox being sent from", () => {
    expect(pickIdentity(identities, "dan@acme.test")?.id).toBe("2");
    expect(pickIdentity(identities, "DAN@ACME.TEST")?.id).toBe("2");
  });

  it("falls back to the first rather than refusing to send", () => {
    expect(pickIdentity(identities, "someone@else.test")?.id).toBe("1");
  });

  it("returns null when there are none, so the caller can say why", () => {
    expect(pickIdentity([], "dan@acme.test")).toBeNull();
  });
});
