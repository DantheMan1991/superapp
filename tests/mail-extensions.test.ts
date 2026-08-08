import { describe, expect, it, vi } from "vitest";
import type { Tx } from "@/db";
import {
  entityKey,
  entityTypeIndex,
  filingTargetFor,
  resolveLinkEntities,
  searchLinkTargets,
} from "@/lib/mail-extensions/resolve";
import type {
  LinkableEntity,
  MailEntityType,
  MailExtension,
  MailExtensionCtx,
} from "@/lib/mail-extensions/types";
import {
  buildTranscript,
  decodeEntities,
  htmlToText,
  TRANSCRIPT_MAX_CHARS,
} from "@/modules/email/render/transcript";

/**
 * The extension seam, and the transcript that goes into a filed copy.
 *
 * Both halves are pure, which is the point: the resolver's whole job is to keep
 * one badly-behaved extension from taking the inbox down with it, and that is
 * testable with fakes rather than a mail server. The transcript is the readable
 * half of a published message, so it is worth a corpus of its own.
 *
 * The one thing NOT tested here is the property that matters most — that an
 * extension cannot see rows RLS hid from the caller. It is not testable with
 * fakes because it is not enforced in TypeScript; it is enforced by the hooks
 * taking the caller's `tx` and by Postgres. `tests/isolation/mail.test.ts`
 * certifies it against a real database.
 */

const CTX: MailExtensionCtx = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  userId: "user-a",
  role: "staff",
};

/** No hook here touches it — every extension below is a fake. */
const TX = {} as Tx;

function entity(type: string, id: string, label = `${type} ${id}`): LinkableEntity {
  return { entityType: type, entityId: id, label };
}

function fakeType(
  type: string,
  overrides: Partial<MailEntityType> = {},
): MailEntityType {
  return {
    type,
    label: type,
    pluralLabel: `${type}s`,
    icon: "file",
    search: async () => [entity(type, "1"), entity(type, "2")],
    resolve: async (_tx, _ctx, ids) => ids.map((id) => entity(type, id)),
    ...overrides,
  };
}

function fakeExtension(
  slug: string,
  types: MailEntityType[],
  extra: Partial<MailExtension> = {},
): MailExtension {
  return {
    slug,
    moduleSlug: slug,
    name: slug,
    entityTypes: types,
    ...extra,
  };
}

describe("entity type index", () => {
  it("maps every registered type back to its extension", () => {
    const index = entityTypeIndex([
      fakeExtension("accounting", [fakeType("invoice"), fakeType("bill")]),
      fakeExtension("documents", [fakeType("document")]),
    ]);
    expect([...index.keys()].sort()).toEqual(["bill", "document", "invoice"]);
    expect(index.get("invoice")?.extension.slug).toBe("accounting");
  });

  it("first registration wins when two extensions claim one type", () => {
    // A collision is a registry bug, and resolving it by guessing at runtime
    // would hide the bug rather than fix it. Deterministic beats clever.
    const index = entityTypeIndex([
      fakeExtension("first", [fakeType("invoice")]),
      fakeExtension("second", [fakeType("invoice")]),
    ]);
    expect(index.get("invoice")?.extension.slug).toBe("first");
  });

  it("finds the one extension that can file copies", () => {
    const filing = {
      destinationLabel: "the Documents inbox",
      fileMessage: vi.fn(),
    };
    const extensions = [
      fakeExtension("accounting", [fakeType("invoice")]),
      fakeExtension("documents", [fakeType("document")], { filing }),
    ];
    expect(filingTargetFor(extensions)?.slug).toBe("documents");
    // No filing target is a real state — a tenant without Documents — and it has
    // to be expressible rather than crash the pane.
    expect(filingTargetFor([extensions[0]])).toBeNull();
  });
});

describe("searchLinkTargets", () => {
  it("groups results per entity type and drops the empty ones", async () => {
    const groups = await searchLinkTargets(
      TX,
      CTX,
      [
        fakeExtension("accounting", [
          fakeType("invoice"),
          fakeType("bill", { search: async () => [] }),
        ]),
      ],
      "acme",
    );
    expect(groups.map((g) => g.entityType)).toEqual(["invoice"]);
    expect(groups[0].results).toHaveLength(2);
  });

  it("returns nothing for a blank query without calling any extension", async () => {
    const search = vi.fn(async () => [entity("invoice", "1")]);
    const groups = await searchLinkTargets(
      TX,
      CTX,
      [fakeExtension("accounting", [fakeType("invoice", { search })])],
      "   ",
    );
    expect(groups).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it("truncates an extension that ignores the limit", async () => {
    // Trusting an extension's own bound would let one type flood the picker.
    const groups = await searchLinkTargets(
      TX,
      CTX,
      [
        fakeExtension("greedy", [
          fakeType("invoice", {
            search: async () =>
              Array.from({ length: 50 }, (_, i) => entity("invoice", String(i))),
          }),
        ]),
      ],
      "acme",
      3,
    );
    expect(groups[0].results).toHaveLength(3);
  });

  it("a throwing extension costs its own group, never the others", async () => {
    const noisy = vi.spyOn(console, "error").mockImplementation(() => {});
    const groups = await searchLinkTargets(
      TX,
      CTX,
      [
        fakeExtension("broken", [
          fakeType("rfi", {
            search: async () => {
              throw new Error("pack exploded");
            },
          }),
        ]),
        fakeExtension("accounting", [fakeType("invoice")]),
      ],
      "acme",
    );
    expect(groups.map((g) => g.entityType)).toEqual(["invoice"]);
    noisy.mockRestore();
  });

  it("a hung extension does not hold the picker open", async () => {
    vi.useFakeTimers();
    const noisy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const pending = searchLinkTargets(
        TX,
        CTX,
        [
          fakeExtension("wedged", [
            // Never settles. Without the timeout this await never returns, and
            // the reading pane never renders.
            fakeType("rfi", { search: () => new Promise<LinkableEntity[]>(() => {}) }),
          ]),
          fakeExtension("accounting", [fakeType("invoice")]),
        ],
        "acme",
      );
      await vi.advanceTimersByTimeAsync(5_000);
      const groups = await pending;
      expect(groups.map((g) => g.entityType)).toEqual(["invoice"]);
    } finally {
      vi.useRealTimers();
      noisy.mockRestore();
    }
  });
});

describe("resolveLinkEntities", () => {
  const extensions = [
    fakeExtension("accounting", [fakeType("invoice"), fakeType("bill")]),
    fakeExtension("documents", [fakeType("document")]),
  ];

  it("calls each entity type ONCE, however many links there are", async () => {
    // The batching that stops a thread with six links becoming six round trips
    // behind the reading pane. This is the assertion that guards it.
    const resolve = vi.fn(async (_tx: Tx, _ctx: MailExtensionCtx, ids: readonly string[]) =>
      ids.map((id) => entity("invoice", id)),
    );
    const map = await resolveLinkEntities(
      TX,
      CTX,
      [fakeExtension("accounting", [fakeType("invoice", { resolve })])],
      [
        { entityType: "invoice", entityId: "a" },
        { entityType: "invoice", entityId: "b" },
        { entityType: "invoice", entityId: "c" },
      ],
    );
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0][2]).toHaveLength(3);
    expect(map.size).toBe(3);
  });

  it("de-duplicates ids before asking", async () => {
    const resolve = vi.fn(async (_tx: Tx, _ctx: MailExtensionCtx, ids: readonly string[]) =>
      ids.map((id) => entity("invoice", id)),
    );
    await resolveLinkEntities(
      TX,
      CTX,
      [fakeExtension("accounting", [fakeType("invoice", { resolve })])],
      [
        { entityType: "invoice", entityId: "a" },
        { entityType: "invoice", entityId: "a" },
      ],
    );
    expect(resolve.mock.calls[0][2]).toEqual(["a"]);
  });

  it("ignores a link whose type belongs to a switched-off module", async () => {
    // An uninstalled layer's links are ignored, never invalid — which is what
    // entity_type carrying no whitelist bought.
    const map = await resolveLinkEntities(TX, CTX, extensions, [
      { entityType: "rfi", entityId: "x" },
      { entityType: "invoice", entityId: "a" },
    ]);
    expect(map.has("rfi:x")).toBe(false);
    expect(map.has("invoice:a")).toBe(true);
  });

  it("an id that does not resolve is simply absent", async () => {
    // Deleted and RLS-hidden must be the same answer — a distinguishable
    // "restricted" would confirm the row exists.
    const map = await resolveLinkEntities(
      TX,
      CTX,
      [fakeExtension("accounting", [fakeType("invoice", { resolve: async () => [] })])],
      [{ entityType: "invoice", entityId: "gone" }],
    );
    expect(map.size).toBe(0);
  });

  it("one broken resolver does not lose the other types' chips", async () => {
    const noisy = vi.spyOn(console, "error").mockImplementation(() => {});
    const map = await resolveLinkEntities(
      TX,
      CTX,
      [
        fakeExtension("broken", [
          fakeType("bill", {
            resolve: async () => {
              throw new Error("nope");
            },
          }),
        ]),
        fakeExtension("documents", [fakeType("document")]),
      ],
      [
        { entityType: "bill", entityId: "b" },
        { entityType: "document", entityId: "d" },
      ],
    );
    expect(map.has("bill:b")).toBe(false);
    expect(map.has("document:d")).toBe(true);
    noisy.mockRestore();
  });

  it("does nothing at all for no links", async () => {
    const resolve = vi.fn();
    const map = await resolveLinkEntities(
      TX,
      CTX,
      [fakeExtension("accounting", [fakeType("invoice", { resolve })])],
      [],
    );
    expect(map.size).toBe(0);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("entityKey agrees with what resolveLinkEntities stores", () => {
    expect(entityKey({ entityType: "invoice", entityId: "a" })).toBe("invoice:a");
  });
});

describe("htmlToText", () => {
  it("drops script and style CONTENTS, not just their tags", () => {
    // A stylesheet's text in the search index is noise at best; a script's is
    // noise that looks like a payload to whoever reads the row next.
    const text = htmlToText(
      "<p>Hello</p><style>.a{color:red}</style><script>alert(1)</script><p>Bye</p>",
    );
    expect(text).toContain("Hello");
    expect(text).toContain("Bye");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("alert");
  });

  it("survives a body cut mid-tag", () => {
    // Exactly what maxBodyValueBytes produces, and the reason bodyTruncated is
    // carried through the JMAP layer at all.
    expect(htmlToText("<p>Half a message</p><div class=\"x")).toBe("Half a message");
    expect(htmlToText("<p>Text</p><script>alert(")).toBe("Text");
    expect(htmlToText("<p>Text</p><!-- unterminated")).toBe("Text");
  });

  it("turns structure into line breaks", () => {
    expect(htmlToText("<p>One</p><p>Two</p>")).toBe("One\nTwo");
    expect(htmlToText("a<br>b")).toBe("a\nb");
    expect(htmlToText("<ul><li>One</li><li>Two</li></ul>")).toBe("• One\n• Two");
  });

  it("decodes entities AFTER stripping, so markup cannot reappear", () => {
    // Decoding first would turn &lt;b&gt; into a tag the stripper then ate,
    // silently losing the text the sender actually wrote.
    expect(htmlToText("<p>&lt;b&gt;bold&lt;/b&gt;</p>")).toBe("<b>bold</b>");
  });

  it("collapses whitespace without destroying paragraphs", () => {
    expect(htmlToText("<p>a   b</p><p>c</p>")).toBe("a b\nc");
    // Source newlines between blocks add to the break the tag already made.
    // Capped at one blank line, so a prettily-indented newsletter does not
    // arrive as a column of air.
    expect(htmlToText("<p>a   b</p>\n\n\n<p>c</p>")).toBe("a b\n\nc");
    expect(htmlToText("<p>a</p><p></p><p></p><p>b</p>")).toBe("a\n\nb");
  });

  it("eats Outlook's conditional comments", () => {
    expect(
      htmlToText("<p>Real</p><!--[if mso]><table><tr><td>Fake<![endif]-->"),
    ).toBe("Real");
  });
});

describe("decodeEntities", () => {
  it("handles named, decimal and hex forms", () => {
    expect(decodeEntities("a &amp; b")).toBe("a & b");
    expect(decodeEntities("&#65;&#x42;")).toBe("AB");
    expect(decodeEntities("caf&eacute;")).toBe("café");
  });

  it("leaves an unknown entity exactly as written", () => {
    // Guessing produces a wrong expansion nobody can spot; leaving it produces
    // a visibly odd string in a search index, which is harmless.
    expect(decodeEntities("&notanentity;")).toBe("&notanentity;");
  });

  it("refuses lone surrogates and out-of-range code points", () => {
    // Postgres rejects a lone surrogate outright, so decoding one would turn a
    // filed message into a failed insert.
    expect(decodeEntities("&#xD800;")).toBe("&#xD800;");
    expect(decodeEntities("&#x110000;")).toBe("&#x110000;");
    expect(decodeEntities("&#0;")).toBe("&#0;");
  });
});

describe("buildTranscript", () => {
  const base = {
    subject: "Revised quote",
    from: [{ name: "Dana Rowe", email: "dana@supplier.test" }],
    to: [{ name: null, email: "office@acme.test" }],
    cc: [],
    receivedAt: new Date("2026-07-28T09:15:00.000Z"),
    textBody: null as string | null,
    htmlBody: null as string | null,
    attachmentNames: [] as string[],
    truncated: false,
  };

  it("puts the headers people search by at the top", () => {
    const out = buildTranscript({ ...base, textBody: "The price is 4200." });
    expect(out).toContain("Subject: Revised quote");
    expect(out).toContain("From: Dana Rowe <dana@supplier.test>");
    expect(out).toContain("To: office@acme.test");
    expect(out).toContain("The price is 4200.");
  });

  it("prefers the text alternative over stripped HTML", () => {
    // What the sender wrote beats what is left of their markup.
    const out = buildTranscript({
      ...base,
      textBody: "Plain version",
      htmlBody: "<p>HTML version</p>",
    });
    expect(out).toContain("Plain version");
    expect(out).not.toContain("HTML version");
  });

  it("falls back to HTML when there is no text part", () => {
    const out = buildTranscript({ ...base, htmlBody: "<p>Only HTML</p>" });
    expect(out).toContain("Only HTML");
  });

  it("ignores a text part that is only whitespace", () => {
    const out = buildTranscript({
      ...base,
      textBody: "   \n  ",
      htmlBody: "<p>Real content</p>",
    });
    expect(out).toContain("Real content");
  });

  it("names attachments, because that is how people search for the email", () => {
    const out = buildTranscript({
      ...base,
      textBody: "See attached.",
      attachmentNames: ["Facturación año.pdf", "site-plan.pdf"],
    });
    expect(out).toContain("Attachments: Facturación año.pdf, site-plan.pdf");
  });

  it("says so when the mail server shortened the body", () => {
    // A partial transcript presented as whole is the same class of wrong as a
    // message shown as complete when it is not.
    const out = buildTranscript({ ...base, textBody: "Start…", truncated: true });
    expect(out).toContain("shortened by the mail server");
  });

  it("caps its own length and admits it", () => {
    const out = buildTranscript({ ...base, textBody: "x".repeat(500_000) });
    expect(out.length).toBeLessThan(TRANSCRIPT_MAX_CHARS + 100);
    expect(out.endsWith("[Truncated when filed.]")).toBe(true);
  });

  it("never invents a subject line", () => {
    // Same rule the JMAP parser follows: a missing subject is "", not
    // "(no subject)" — except in the one place a label is unavoidable.
    const out = buildTranscript({ ...base, subject: "", textBody: "body" });
    expect(out.startsWith("Subject: (no subject)")).toBe(true);
  });
});
