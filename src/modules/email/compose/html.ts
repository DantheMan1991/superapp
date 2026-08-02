import sanitizeHtml from "sanitize-html";

/**
 * The WRITE path: HTML on its way out of this building.
 *
 * `render/sanitize.ts` is the read path and this is its mirror, but the two are
 * not symmetric and the asymmetry is the whole point of this file.
 *
 * THE READ PATH HAS A SANDBOX BEHIND IT. Its own header says so: the body
 * renders in an iframe with no `allow-scripts` and `script-src 'none'`, so a
 * bypass there is a rendering bug rather than a compromise. That is what makes a
 * permissive allowlist — tables, `<style>`, inline CSS, remote images behind a
 * proxy — a proportionate choice for reading somebody else's mail.
 *
 * THIS PATH HAS NOTHING BEHIND IT. Whatever survives here leaves our origin,
 * arrives in a stranger's mail client, and is rendered there under OUR USER'S
 * From header. There is no sandbox to fail into, no CSP we control, and no
 * second chance. `quote.ts` already states the threat for quoted bodies — "our
 * user unknowingly forwarding something hostile over their own signature" — and
 * this is that argument generalized to everything the composer can emit.
 *
 * So the allowlist here is much SMALLER than the read path's, and the rule that
 * sets it is one sentence: **the composer emits only what its own toolbar can
 * produce.** Bold, italic, underline, lists, links, paragraphs, and the quote
 * block replies are built from. Nothing else has a way in:
 *
 *   • no `<img>` — a pasted tracking pixel would make our user's message track
 *     its recipient, which is a thing done on their behalf without their knowing
 *   • no `<style>` and no `style` attribute (except the one we EMIT ourselves,
 *     below) — hidden text, white-on-white and `position:fixed` are how a pasted
 *     block turns into something the sender never saw
 *   • no `<table>` — nothing in the toolbar makes one, so anything that arrives
 *     as one came from somewhere else
 *   • no classes, ids, or `target`/`rel`, which mean nothing in a mail client
 *
 * The editor is the other half of this. It pastes as PLAIN TEXT (see
 * `rich-text-editor.tsx`), so hostile markup never enters the document at all
 * and this function is defence in depth rather than the only guard. It still
 * runs on the server, because a server action is a boundary and the client's
 * good behaviour is not something the server may assume.
 *
 * Pure, and free of `server-only`, so it is testable without a network — same
 * rule as every other file in this directory.
 */

/** Longest outbound body we will sanitize. Matches the action's own cap. */
export const MAX_HTML_CHARS = 500_000;

/** The only schemes a composed link may point at. Never a denylist. */
const SAFE_SCHEMES = ["http", "https", "mailto", "tel"];

/**
 * What every `<blockquote>` is re-dressed with on the way out.
 *
 * EMITTED, never passed through — see `transformTags` below. Mail clients indent
 * a bare `<blockquote>` inconsistently and several of them key their "show
 * quoted text" fold off the left border, so a reply with no styling reads as one
 * long undifferentiated wall in about half the clients that receive it.
 */
const QUOTE_STYLE =
  "margin:0 0 0 0.8em;padding-left:0.8em;border-left:2px solid #ccc;";

/**
 * Strip the characters used to smuggle a scheme past a naive check —
 * `java\tscript:`, a leading NUL, an embedded newline. Anything suspicious means
 * the href is dropped rather than repaired.
 *
 * Deliberately identical in behaviour to the read path's copy. They are not
 * shared because `render/sanitize.ts` is the reading pane's and this is the
 * composer's: a future widening on one side must not silently widen the other,
 * and this is the side with no sandbox behind it.
 */
function schemeOf(value: string): string | null {
  const cleaned = Array.from(value)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code > 0x20 && code !== 0x7f;
    })
    .join("");
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned);
  return match ? match[1].toLowerCase() : null;
}

function isSafeHref(value: string): boolean {
  const scheme = schemeOf(value);
  // No scheme is a relative link. Harmless when READING (the frame has
  // `base-uri 'none'`, so it resolves nowhere), but a relative href in a sent
  // message resolves against whatever the recipient's client considers the base
  // — which is not ours and not knowable. Refused rather than guessed at.
  if (scheme === null) return false;
  return SAFE_SCHEMES.includes(scheme);
}

/**
 * Sanitize a composed HTML body.
 *
 * Returns markup safe to hand to the mail server as the `text/html` alternative.
 * Never throws: a body that cannot be understood sanitizes to something smaller,
 * and the worst case is a message that sends as less than it looked like rather
 * than one that refuses to send at all.
 */
export function sanitizeOutboundHtml(html: string): string {
  const input = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;

  return sanitizeHtml(input, {
    allowedTags: [
      // Structure
      "p", "div", "br", "blockquote",
      // Emphasis — both the semantic and the presentational spellings, because
      // execCommand emits `<b>`/`<i>` in some browsers and `<strong>`/`<em>` in
      // others and normalizing them apart would be a distinction with no reader.
      "b", "strong", "i", "em", "u", "s", "strike", "sub", "sup", "code", "pre",
      // Lists
      "ul", "ol", "li",
      // Links
      "a",
    ],
    // Dropped tag AND contents. `<style>` and `<script>` would otherwise have
    // their source rendered as visible prose in the recipient's client, which is
    // worse than dropping them; `<img>` is void and simply goes.
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "title", "head"],
    allowedAttributes: {
      a: ["href"],
      // `style` and `type` are listed HERE because transformTags ADDS them —
      // sanitize-html applies the allowlist AFTER the transform, so anything
      // omitted from this map is silently discarded again. That exact mistake
      // shipped links with no rel="noopener" on the read path and was caught
      // only by asserting the output. Asserted here too.
      blockquote: ["style", "type"],
    },
    allowedSchemes: SAFE_SCHEMES,
    // No `img` entry: images are not an allowed tag at all, so there is no
    // scheme that admits one.
    allowProtocolRelative: false,
    // Belt for a future widening of allowedAttributes: even if `style` were
    // added somewhere, no declaration would survive.
    allowedStyles: {},
    transformTags: {
      a: (tagName, attribs) => {
        const href = (attribs.href ?? "").trim();
        // Keep the text, drop the destination — the same call the read path
        // makes. A recipient still reads what our user wrote; it simply is not
        // a link. Silently deleting the text would change the meaning of a
        // message somebody is sending under their own name.
        const kept: Record<string, string> =
          href && isSafeHref(href) ? { href } : {};
        return { tagName, attribs: kept };
      },
      // Every quote gets OUR styling, whatever it arrived with. Nothing the
      // caller supplied reaches the output, so there is no attacker-controlled
      // CSS to reason about — and nested quotes from a long reply chain all
      // render the same way instead of inheriting whatever four different mail
      // clients did to them on the way here.
      blockquote: () => ({
        tagName: "blockquote",
        attribs: { type: "cite", style: QUOTE_STYLE },
      }),
    },
  });
}

/**
 * Is there anything in this HTML a recipient would actually see?
 *
 * Used to decide whether a message is empty, which the composer refuses to send.
 * A contenteditable that somebody cleared still contains `<br>` or an empty
 * `<div>` in most browsers, so a length check on the markup answers the wrong
 * question — "did the editor leave anything behind" rather than "did this person
 * write anything".
 */
export function htmlHasContent(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/g, "").length > 0;
}
