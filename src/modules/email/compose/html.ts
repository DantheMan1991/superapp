import sanitizeHtml from "sanitize-html";
import {
  fontFromFace,
  INDENT_STEP_EM,
  normalizeColor,
  sanitizeStyle,
  sizeFromLegacy,
} from "./formatting";

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
 *   • no REMOTE image, ever. `<img>` is admitted only for a `cid:` this message
 *     minted, and its `src` is REBUILT from that cid rather than read — so there
 *     is no code path in which a caller-supplied URL reaches a recipient. A
 *     pasted tracking pixel would otherwise make our user's message track the
 *     person they wrote to, on their behalf and without their knowing.
 *   • no `<style>` block, ever
 *   • no `<table>` — nothing in the toolbar makes one, so anything that arrives
 *     as one came from somewhere else
 *   • no classes, ids, or `target`/`rel`, which mean nothing in a mail client
 *
 * THE `style` ATTRIBUTE IS THE ONE PLACE THAT RULE HAD TO GROW TEETH RATHER
 * THAN JUST SAY NO. Colours, fonts, sizes, alignment and indent are all style
 * features, and the first version of this file dropped the attribute outright
 * for exactly the reasons above — hidden text, white-on-white, `position:fixed`.
 *
 * What makes them safe to offer is that every one of them is a FIXED
 * ENUMERATION. `formatting.ts` holds the tables, the toolbar builds its menus
 * from them, and `sanitizeStyle` keeps a declaration only if it is an exact
 * member of the set generated from the same tables. So this file never parses
 * CSS — it recognizes strings — and the toolbar can only emit what the
 * sanitizer accepts, because both read one file. `display:none` is not rejected
 * by a rule about hiding things; it simply is not in any table.
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
 * What every inline image is emitted with.
 *
 * EMITTED, never passed through, like the quote styling. A photograph off a
 * phone is 4000px wide, and without this it arrives at its natural size and
 * blows out the layout of the message around it in every client that does not
 * clamp images itself.
 */
const INLINE_IMAGE_STYLE = "max-width:100%;height:auto;";

/** Shared empty set, so the default costs no allocation per call. */
const EMPTY_CIDS: ReadonlySet<string> = new Set();

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
export interface OutboundOptions {
  /**
   * Content-IDs the composer minted for THIS message, and the only ones an
   * `<img>` may reference. Absent means no images at all, which is the default
   * and what every path that is not the composer gets.
   */
  allowedCids?: ReadonlySet<string>;
}

export function sanitizeOutboundHtml(
  html: string,
  options: OutboundOptions = {},
): string {
  const input = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;
  const allowedCids = options.allowedCids ?? EMPTY_CIDS;

  return sanitizeHtml(input, {
    allowedTags: [
      // Structure
      "p", "div", "br", "blockquote", "span",
      // Emphasis — both the semantic and the presentational spellings, because
      // execCommand emits `<b>`/`<i>` in some browsers and `<strong>`/`<em>` in
      // others and normalizing them apart would be a distinction with no reader.
      "b", "strong", "i", "em", "u", "s", "strike", "sub", "sup", "code", "pre",
      // Lists
      "ul", "ol", "li",
      // Links
      "a",
      // Inline images, and ONLY the ones this message minted a cid for — see
      // the transform below. Listing the tag here is not what admits an image;
      // the transform is, and it drops any `<img>` it cannot account for.
      "img",
    ],
    // Dropped tag AND contents. `<style>` and `<script>` would otherwise have
    // their source rendered as visible prose in the recipient's client, which is
    // worse than dropping them.
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "title", "head"],
    allowedAttributes: {
      a: ["href"],
      // `style` is listed on every tag that can carry one because transformTags
      // ADDS it — sanitize-html applies this allowlist AFTER the transform, so
      // anything omitted here is silently discarded again. That exact mistake
      // shipped links with no rel="noopener" on the read path, and it is why
      // there is a regression test asserting the emitted attributes survive.
      blockquote: ["style", "type"],
      // Emitted by the transform, never passed through. `src` is rebuilt from
      // the cid, so nothing the caller wrote in it survives.
      img: ["src", "alt", "width", "height", "style"],
      span: ["style"],
      p: ["style"],
      div: ["style"],
      li: ["style"],
      ul: ["style"],
      ol: ["style"],
    },
    allowedSchemes: SAFE_SCHEMES,
    // `cid` is listed for `img` alone. It is belt rather than the control — the
    // transform rebuilds every `src` from a cid it has already checked against
    // the allowlist, so no caller-supplied URL reaches this stage in the first
    // place — but a future edit that started copying `src` should still find a
    // scheme allowlist standing in front of it.
    allowedSchemesByTag: { img: ["cid"] },
    allowProtocolRelative: false,
    /**
     * Remove an `<img>` that the transform could not account for.
     *
     * The transform strips its attributes, which is what loses the URL; this is
     * what loses the element. Without it a refused image ships as a bare `<img>`
     * and renders in the recipient's client as a broken-image icon — which reads
     * as "the sender attached something that did not arrive" rather than as the
     * nothing it actually is.
     */
    exclusiveFilter: (frame) =>
      frame.tag === "img" && !(frame.attribs.src ?? "").startsWith("cid:"),
    // NOT sanitize-html's own style filtering. Its `allowedStyles` matches
    // values with regexes, and a regex over CSS is the losing side of this
    // problem. Every surviving declaration goes through `sanitizeStyle`, which
    // does not parse CSS at all — it recognizes the exact strings the toolbar
    // is able to generate. See `formatting.ts`.
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
      /**
       * `<font>` is what a browser emits for colour, family and size when
       * `styleWithCSS` is off — which is the mode the editor runs in, because it
       * is also what makes bold come out as `<b>` rather than a span full of
       * CSS. So the tag is not banned, it is TRANSLATED: its three attributes
       * are looked up in the tables and re-emitted as a span whose style is one
       * of ours. An unrecognized value produces no declaration, and a `<font>`
       * carrying nothing recognizable becomes a bare span the browser ignores.
       */
      font: (_tagName, attribs) => {
        const declarations: string[] = [];
        const colour = attribs.color ? normalizeColor(attribs.color) : null;
        if (colour) declarations.push(`color:${colour}`);
        const face = attribs.face ? fontFromFace(attribs.face) : null;
        if (face) declarations.push(`font-family:${face.css}`);
        const size = attribs.size ? sizeFromLegacy(attribs.size) : null;
        if (size) declarations.push(`font-size:${size.css}`);
        // Back through sanitizeStyle rather than trusted directly: it is the one
        // gate, and a lookup that started returning something unexpected must
        // not get a second door.
        const style = sanitizeStyle(declarations.join(";"));
        const attrs: Record<string, string> = style ? { style } : {};
        return { tagName: "span", attribs: attrs };
      },
      /**
       * An inline image.
       *
       * THE RULE IS NOT "IMAGES ARE ALLOWED". It is: an `<img>` survives if and
       * only if it names a `data-cid` this message actually minted, and the
       * `src` is then REBUILT from that cid rather than read. Nothing the caller
       * wrote in `src` reaches the output, which is what makes a remote tracking
       * pixel impossible to smuggle in — there is no code path where a `src`
       * attribute is copied.
       *
       * The composer works this way round because the editor has to SHOW the
       * picture while somebody writes, and a browser cannot render `cid:`. So it
       * carries a signed preview URL in `src` and the identity in `data-cid`,
       * and the two are swapped here, at the boundary, once.
       *
       * `alt` is kept because it is what a recipient with images off reads, and
       * it is the sender's own words. `width`/`height` are kept only as bare
       * integers. `max-width` is EMITTED rather than allowed: a photograph
       * straight off a phone is 4000px wide and would otherwise blow out the
       * layout of the message it arrives in.
       */
      img: (tagName, attribs) => {
        const cid = (attribs["data-cid"] ?? "").trim();
        // An image with no accounted-for cid keeps no attributes here and is
        // then REMOVED by the exclusiveFilter below. Both halves are needed:
        // stripping the attributes is what loses the remote URL, and the filter
        // is what stops the empty `<img>` rendering as a broken-image icon in a
        // message whose sender believed it carried a picture.
        if (!cid || !allowedCids.has(cid)) return { tagName: "img", attribs: {} };

        const kept: Record<string, string> = {
          src: `cid:${cid}`,
          style: INLINE_IMAGE_STYLE,
        };
        if (typeof attribs.alt === "string" && attribs.alt.length > 0) {
          kept.alt = attribs.alt.slice(0, 300);
        }
        for (const dimension of ["width", "height"] as const) {
          const value = attribs[dimension];
          if (typeof value === "string" && /^[0-9]{1,5}$/.test(value)) {
            kept[dimension] = value;
          }
        }
        return { tagName, attribs: kept };
      },
      /**
       * A blockquote is either a QUOTE or an INDENT, and telling them apart is
       * the whole job here.
       *
       * `execCommand("indent")` does not emit an indented div. It wraps the
       * block in a `<blockquote>` — in every engine — so an indented paragraph
       * would arrive in the recipient's client looking as though the writer were
       * quoting somebody. Both buttons produce the same tag.
       *
       * TWO SIGNALS, and the DEFAULT is what makes this safe to get wrong:
       *
       *   • `type="cite"` means quote, definitively. `quoteHtml` emits it, this
       *     transform re-emits it, and the toolbar's Quote button stamps it onto
       *     the element `formatBlock` just created — because `formatBlock`
       *     itself produces a BARE blockquote, which is the bug this ordering
       *     was written to fix.
       *   • a `border` reset means indent. Engines emit
       *     `margin: 0 0 0 40px; border: none` for `indent`, and no quote in
       *     this codebase has ever carried a border reset.
       *
       * Anything else defaults to QUOTE, deliberately. If the editor's stamping
       * fails, the user pressed Quote and gets a quote; the cost of the opposite
       * default was an indent button silently relabelling itself. Both mistakes
       * are cosmetic, which is what makes a heuristic acceptable here when it
       * would not be for anything security-bearing.
       */
      blockquote: (tagName, attribs) => {
        const quoteAttrs: Record<string, string> = { type: "cite", style: QUOTE_STYLE };
        const indentAttrs: Record<string, string> = {
          style: `margin-left:${INDENT_STEP_EM}em`,
        };
        const declaredQuote = (attribs.type ?? "").trim().toLowerCase() === "cite";
        const style = (attribs.style ?? "").toLowerCase();
        const looksIndented =
          !declaredQuote && /border(?:-[a-z]+)?\s*:\s*(?:none|0)/.test(style);

        if (looksIndented) {
          // Re-emitted as a plain div so no recipient's client draws a
          // quotation bar around what was only ever an indent.
          return { tagName: "div", attribs: indentAttrs };
        }
        // Nothing the caller supplied reaches the output, so there is no
        // attacker-controlled CSS to reason about — and nested quotes from a
        // long reply chain all render the same way instead of inheriting
        // whatever four different mail clients did to them on the way here.
        return { tagName, attribs: quoteAttrs };
      },
      // Everything else that may carry a style: filtered, never trusted.
      //
      // LISTED EXPLICITLY RATHER THAN AS `"*"`, and that is not cosmetic.
      // sanitize-html runs a `"*"` transform IN ADDITION to a tag's own, after
      // it — so a wildcard here re-filtered the style that the `blockquote`
      // transform had just emitted, and quotes shipped with no left border. The
      // tests caught it; the lesson is that `"*"` is not a fallback.
      //
      // The list is exactly the tags `allowedAttributes` lets keep a `style`,
      // minus `blockquote`, which sets its own. Any other tag loses the
      // attribute to the allowlist regardless of what happens here.
      ...Object.fromEntries(
        (["span", "p", "div", "li", "ul", "ol"] as const).map((tag) => [
          tag,
          (tagName: string, attribs: sanitizeHtml.Attributes) => {
            if (typeof attribs.style !== "string") return { tagName, attribs };
            const style = sanitizeStyle(attribs.style);
            const rest: Record<string, string> = { ...attribs };
            if (style) rest.style = style;
            else delete rest.style;
            return { tagName, attribs: rest };
          },
        ]),
      ),
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
