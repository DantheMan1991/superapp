import { describe, expect, it } from "vitest";
import {
  PLACEHOLDERS,
  composerPlaceholderValues,
  extractPlaceholders,
  fillPlaceholders,
  isKnownPlaceholder,
  stripQuotedRegions,
  unfilledPlaceholders,
  validateTemplateBody,
} from "@/modules/email/templates/placeholders";

/**
 * Fill-in-the-blanks for canned responses.
 *
 * The vocabulary is a CLOSED enumeration, the same call `compose/formatting.ts`
 * made for colours and fonts — so a typo is refused at save rather than
 * shipped to a client as literal braces.
 */

describe("the vocabulary is an enumeration", () => {
  it("has no duplicate keys", () => {
    const keys = PLACEHOLDERS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every key is one the token pattern can actually match", () => {
    // The pattern is deliberately narrow (lowercase, dots, underscores). A
    // definition the pattern could not match would be listed in the editor and
    // then refused on save — a table that lies about itself, which is the class
    // of bug the font-stack invariant test exists for.
    for (const p of PLACEHOLDERS) {
      expect(extractPlaceholders(`{{${p.key}}}`)).toEqual([p.key]);
      expect(isKnownPlaceholder(p.key)).toBe(true);
    }
  });

  it("every definition carries a hint, since the editor lists them", () => {
    for (const p of PLACEHOLDERS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("extractPlaceholders", () => {
  it("finds tokens with or without inner spaces, deduplicated in order", () => {
    expect(
      extractPlaceholders("Hi {{recipient.name}}, from {{ me.name }} — {{recipient.name}}"),
    ).toEqual(["recipient.name", "me.name"]);
  });

  it("ignores things that are not tokens", () => {
    // A pattern loose enough to match these would turn every pasted snippet of
    // CSS or JSON into an "unknown placeholder" error on save.
    expect(extractPlaceholders("{ not a token }")).toEqual([]);
    expect(extractPlaceholders("{{ Not-A-Token }}")).toEqual([]);
    expect(extractPlaceholders("style={{ color: red }}")).toEqual([]);
    expect(extractPlaceholders("{{}}")).toEqual([]);
  });
});

describe("validateTemplateBody", () => {
  it("accepts a body using only known placeholders", () => {
    expect(
      validateTemplateBody("<p>Hi {{recipient.first_name}}, — {{me.name}}</p>"),
    ).toBe(null);
  });

  it("accepts a body with no placeholders at all", () => {
    expect(validateTemplateBody("<p>Our terms are 30 days.</p>")).toBe(null);
  });

  it("REFUSES a typo, and names it", () => {
    const problem = validateTemplateBody("<p>Hi {{cusotmer}}</p>");
    expect(problem?.kind).toBe("unknown");
    expect(problem?.keys).toEqual(["cusotmer"]);
  });

  it("REFUSES a token broken up by formatting", () => {
    // The failure nobody would guess. Bolding half a token — or a browser
    // splitting a text node mid-word — leaves markup inside the braces. It
    // reads perfectly to a human and no regex over the HTML can match it, so
    // without this check it would survive substitution and reach a customer.
    const problem = validateTemplateBody("<p>Hi {{recipient.<b>name}}</b></p>");
    expect(problem?.kind).toBe("split");
    expect(problem?.keys).toEqual(["recipient.name"]);
  });

  it("reports a SPLIT token as split rather than unknown", () => {
    // Ordering matters: the split token is a valid key, so checking "unknown"
    // against the HTML would have reported a nonsense name like
    // `recipient.` — the message has to be actionable.
    const problem = validateTemplateBody("<p>{{me.<i>name}}</i></p>");
    expect(problem?.kind).toBe("split");
  });

  it("catches a typo that is ALSO split, as a typo first", () => {
    const problem = validateTemplateBody("<p>{{cus<b>otmer}}</b></p>");
    expect(problem?.kind).toBe("unknown");
  });
});

describe("fillPlaceholders", () => {
  const values = {
    "recipient.name": "Aoife Ó Braonáin",
    "recipient.first_name": "Aoife",
    "me.name": "Dan",
  };

  it("substitutes what it has", () => {
    expect(fillPlaceholders("<p>Hi {{recipient.first_name}},</p>", values)).toBe(
      "<p>Hi Aoife,</p>",
    );
  });

  it("LEAVES a token it cannot resolve, rather than emptying it", () => {
    // "Hi ," reads as a careless message and sails past the writer. The token
    // is unmistakable, and because the fill happens at insert it is on screen
    // while somebody is still there to fix it.
    expect(fillPlaceholders("<p>Hi {{recipient.name}} at {{business.name}}</p>", values))
      .toBe("<p>Hi Aoife Ó Braonáin at {{business.name}}</p>");
  });

  it("treats an empty value as unresolved", () => {
    expect(fillPlaceholders("<p>{{me.name}}</p>", { "me.name": "" })).toBe(
      "<p>{{me.name}}</p>",
    );
  });

  it("ESCAPES the value, so a display name cannot inject markup", () => {
    // The value comes from a recipient's display name, which is chosen by
    // whoever emailed us. The outbound sanitizer would strip anything dangerous
    // at send, but relying on it here would mean the editor showed one thing
    // and the recipient received another.
    const filled = fillPlaceholders("<p>Hi {{recipient.name}}</p>", {
      "recipient.name": '<img src=x onerror="steal()">',
    });
    expect(filled).not.toContain("<img");
    expect(filled).toContain("&lt;img");
  });

  it("normalizes inner spacing so `{{ key }}` fills too", () => {
    expect(fillPlaceholders("<p>{{ me.name }}</p>", values)).toBe("<p>Dan</p>");
  });
});

describe("unfilledPlaceholders — the send guard", () => {
  it("reports a known placeholder still in the body", () => {
    expect(unfilledPlaceholders("<p>Hi {{recipient.name}}</p>")).toEqual([
      "recipient.name",
    ]);
  });

  it("says nothing about an unknown token", () => {
    // NARROW BY CONSTRUCTION. Somebody writing to a developer about mustache
    // syntax, or pasting a config file, must be able to send it. Only exact
    // members of the closed vocabulary block a send.
    expect(unfilledPlaceholders("<p>Use {{mustache}} syntax like {{foo.bar}}</p>")).toEqual(
      [],
    );
  });

  it("looks at the TEXT rendering, so a split token is still caught", () => {
    // A token broken by markup cannot be filled, so it must not slip past the
    // guard just because the HTML regex misses it.
    expect(unfilledPlaceholders("<p>Hi {{recipient.<b>name}}</b></p>")).toEqual([
      "recipient.name",
    ]);
  });

  it("passes a fully filled body", () => {
    expect(unfilledPlaceholders("<p>Hi Aoife, from Dan</p>")).toEqual([]);
  });
});

/**
 * The quote is somebody else's words, and blocking a reply because of what the
 * ORIGINAL said would be the guard's worst failure — it would recur every time
 * they tried, about a token they never wrote.
 */
describe("stripQuotedRegions", () => {
  it("lets a reply quoting a placeholder be sent", () => {
    const html =
      "<p>You type it like that, yes.</p>" +
      '<blockquote type="cite"><p>How do I use {{recipient.name}}?</p></blockquote>';
    expect(unfilledPlaceholders(stripQuotedRegions(html, ""))).toEqual([]);
  });

  it("still catches one the writer left ABOVE the quote", () => {
    const html =
      "<p>Hi {{recipient.first_name}},</p>" +
      '<blockquote type="cite"><p>original</p></blockquote>';
    expect(unfilledPlaceholders(stripQuotedRegions(html, ""))).toEqual([
      "recipient.first_name",
    ]);
  });

  it("strips `>`-prefixed lines from the plain-text body too", () => {
    // Plain-text mode has no blockquote — the quote is `> ` prefixes, which is
    // what `quoteText` and the derived alternative both produce.
    const text = ["Answered below.", "", "> How do I use {{me.name}}?", "> Thanks"].join(
      "\n",
    );
    expect(unfilledPlaceholders(stripQuotedRegions("", text))).toEqual([]);
  });

  it("catches one above the quote in plain text", () => {
    const text = ["Hi {{recipient.name}},", "", "> original"].join("\n");
    expect(unfilledPlaceholders(stripQuotedRegions("", text))).toEqual([
      "recipient.name",
    ]);
  });

  it("handles a nested quote without leaking the inner one", () => {
    const html =
      "<p>ok</p><blockquote><p>a {{me.email}}</p><blockquote><p>b {{me.name}}</p></blockquote></blockquote>";
    // The non-greedy match ends at the FIRST closing tag, so the outer quote's
    // tail survives — over-stripping is the safe direction and under-stripping
    // here would only re-introduce a false positive, so assert what matters:
    // nothing the writer typed is missed, and the reply is not blocked.
    expect(unfilledPlaceholders(stripQuotedRegions(html, ""))).toEqual([]);
  });
});

describe("composerPlaceholderValues", () => {
  const base = {
    senderName: "Dan Rasmussen",
    senderEmail: "dan@acme.example",
    businessName: "Acme Builders",
    today: new Date("2026-08-03T12:00:00Z"),
  };

  it("uses the recipient's display name and its first word", () => {
    const values = composerPlaceholderValues({
      ...base,
      recipientName: "Aoife Ó Braonáin",
      recipientEmail: "aoife@example.com",
    });
    expect(values["recipient.name"]).toBe("Aoife Ó Braonáin");
    expect(values["recipient.first_name"]).toBe("Aoife");
    expect(values["recipient.email"]).toBe("aoife@example.com");
  });

  it("falls back to the LOCAL PART when there is no display name", () => {
    // "dan" is a serviceable greeting and an empty one is not — and unlike the
    // missing-value case, the information genuinely is available.
    const values = composerPlaceholderValues({
      ...base,
      recipientName: null,
      recipientEmail: "aoife@example.com",
    });
    expect(values["recipient.name"]).toBe("aoife");
    expect(values["recipient.first_name"]).toBe("aoife");
  });

  it("omits recipient values entirely when there is no recipient", () => {
    // Omitted rather than empty, so `fillPlaceholders` leaves the token visible
    // instead of blanking it.
    const values = composerPlaceholderValues({
      ...base,
      recipientName: null,
      recipientEmail: null,
    });
    expect(values["recipient.name"]).toBeUndefined();
    expect(values["recipient.email"]).toBeUndefined();
    expect(values["me.name"]).toBe("Dan Rasmussen");
  });

  it("carries the sender and business through", () => {
    const values = composerPlaceholderValues({
      ...base,
      recipientName: null,
      recipientEmail: null,
    });
    expect(values["me.email"]).toBe("dan@acme.example");
    expect(values["business.name"]).toBe("Acme Builders");
    expect(values["date.today"]).toBeTruthy();
  });

  it("produces values for every key the vocabulary declares", () => {
    // The invariant that keeps the two halves honest: a placeholder listed in
    // the editor that nothing ever resolves would be a control that silently
    // does nothing.
    const values = composerPlaceholderValues({
      ...base,
      recipientName: "Aoife",
      recipientEmail: "aoife@example.com",
    });
    for (const p of PLACEHOLDERS) {
      expect(values[p.key], `no value produced for {{${p.key}}}`).toBeDefined();
    }
  });
});
