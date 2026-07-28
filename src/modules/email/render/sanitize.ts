import sanitizeHtml from "sanitize-html";
import { lookupCid, type InlinePart } from "./cid";

/**
 * Sanitize an HTML message body.
 *
 * WHERE THIS SITS IN THE DESIGN, because it decides how much weight it carries:
 * the body renders inside an iframe whose sandbox attribute omits
 * `allow-scripts` and whose response CSP is `script-src 'none'` (policy.ts).
 * Scripting is therefore already impossible before this function runs. That is
 * deliberate — it means a bypass here is a rendering bug rather than a
 * compromise, and it is the reason a pure-Node sanitizer is a proportionate
 * choice instead of DOMPurify in a full DOM emulation.
 *
 * What this function IS the primary control for is remote content. Blocking a
 * tracking pixel is not something the sandbox can do; the CSP enforces it
 * (`img-src 'self'`), and the rewriting below is what makes "show images" mean
 * anything at all.
 *
 * Hand-rolling was rejected. The instinct to hand-roll pure parsers is right in
 * this codebase for CSV, MX records and JMAP payloads; it is wrong for HTML,
 * where mutation XSS lives in the disagreements BETWEEN parsers and a
 * hand-written one is wrong in ways nobody can enumerate.
 */

export interface SanitizeOptions {
  /** Inline parts this message carries, for resolving `cid:` references. */
  cidMap: Map<string, InlinePart>;
  /** Build the URL that serves an inline part. */
  inlineUrl: (part: InlinePart) => string;
  /**
   * Build the URL that proxies a remote image. Absent means images stay
   * blocked, which is the default and the state every message opens in.
   */
  remoteUrl?: (url: string) => string;
}

export interface SanitizeResult {
  html: string;
  /** How many remote images were withheld — drives the "show images" bar. */
  blockedRemoteCount: number;
}

/**
 * Does this body reference anything remote?
 *
 * A HEURISTIC, and only ever used to decide whether to offer the "Show images"
 * bar. It is not a security control — the sanitizer and the CSP are — so a
 * false positive costs an unnecessary bar and a false negative costs a missing
 * one. Deliberately cheap: the alternative is sanitizing the body twice, once
 * in the reading pane and once in the frame route, to answer a UI question.
 */
export function hasRemoteContent(html: string): boolean {
  return /(?:src|srcset|background)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html)
    || /url\(\s*["']?\s*(?:https?:)?\/\//i.test(html);
}

/** The only schemes an anchor may point at. Never a denylist. */
const SAFE_SCHEMES = ["http", "https", "mailto", "tel"];

/**
 * Strip characters attackers use to smuggle a scheme past a naive check —
 * `java\tscript:`, a leading NUL, an embedded newline. If anything suspicious
 * survives, the href is dropped rather than repaired.
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
  // No scheme at all is a relative link, which inside an opaque-ish frame with
  // `base-uri 'none'` resolves nowhere useful. Allowed as harmless.
  if (scheme === null) return true;
  return SAFE_SCHEMES.includes(scheme);
}

/** CSS constructs that reach out of the document or over our own chrome. */
function stripHostileCss(css: string, allowRemote: boolean): string {
  let out = css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/@charset[^;]*;?/gi, "")
    .replace(/@namespace[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "void(")
    .replace(/-moz-binding\s*:/gi, "void:")
    .replace(/behavior\s*:/gi, "void:")
    // position:fixed/sticky would let a message paint over the app's own UI.
    .replace(/position\s*:\s*(fixed|sticky)/gi, "position:static");
  if (!allowRemote) {
    // Any url() that is not already one of ours becomes nothing. CSS is a
    // perfectly good tracking channel — background-image is a pixel too.
    out = out.replace(/url\(\s*['"]?(?!\/api\/)[^)]*\)/gi, "none");
  }
  return out.slice(0, 100_000);
}

export function sanitizeMessageHtml(
  html: string,
  options: SanitizeOptions,
): SanitizeResult {
  const allowRemote = typeof options.remoteUrl === "function";
  let blockedRemoteCount = 0;

  const clean = sanitizeHtml(html, {
    allowedTags: [
      "a", "abbr", "b", "blockquote", "br", "caption", "center", "code", "col",
      "colgroup", "dd", "div", "dl", "dt", "em", "figcaption", "figure", "h1",
      "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre",
      "q", "s", "small", "span", "strike", "strong", "sub", "sup", "table",
      "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul", "wbr", "style",
    ],
    // sanitize-html warns that allowing <style> is "inherently vulnerable",
    // and it is right about its OWN guarantees: it does not filter style
    // contents at all. We keep the tag because real mail leans on <style>
    // blocks and dropping them wrecks the layout of most business email, and
    // the warning is answered rather than ignored:
    //
    //   • style contents go through stripHostileCss in a post-pass below
    //     (@import, expression(), -moz-binding, behavior, remote url())
    //   • CSS cannot execute script here regardless: the frame has
    //     script-src 'none' AND no allow-scripts, so the historical
    //     CSS-to-script vectors have nothing to reach
    //   • position:fixed/sticky is neutralized, so a stylesheet cannot paint
    //     over the app — and the frame is confined to its own box anyway
    //
    // Acknowledged explicitly so the warning does not train the next reader to
    // ignore console output.
    allowVulnerableTags: true,
    // Dropped tag AND contents, rather than unwrapped: keeping the text inside
    // a <script> would render its source as visible prose. `style` is NOT here
    // — it is allowed above and its contents are cleaned by textFilter, because
    // real mail leans on <style> blocks and discarding them wrecks the layout.
    nonTextTags: ["script", "textarea", "option", "noscript", "title"],
    allowedAttributes: {
      // target and rel are listed because transformTags ADDS them — the
      // allowlist is applied after the transform, so anything omitted here is
      // silently discarded again. That mistake produced links with no
      // rel="noopener" and was caught only by asserting the output.
      a: ["href", "name", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      "*": ["style", "align", "valign", "colspan", "rowspan", "border", "cellpadding", "cellspacing", "dir", "lang", "class"],
    },
    // An allowlist of attributes already excludes every on* handler; this is
    // belt for a future widening.
    allowedSchemes: SAFE_SCHEMES,
    allowedSchemesByTag: { img: ["http", "https", "cid"] },
    allowProtocolRelative: false,
    // <style> contents are not parsed by sanitize-html, so they get their own
    // pass below via transformTags.
    // An <img> whose src was refused is kept, WITHOUT a src attribute, so the
    // browser renders its alt text — which is often the only description of
    // what was withheld. Omitting the attribute entirely is what makes this
    // safe: `src=""` re-requests the current document, a bare <img> requests
    // nothing.
    allowedStyles: {},
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href ?? "";
        if (href && !isSafeHref(href)) {
          // Keep the text, drop the destination. The reader still sees what the
          // message said; it simply is not clickable.
          const rest: Record<string, string> = { ...attribs };
          delete rest.href;
          return { tagName, attribs: rest };
        }
        let host = "";
        try {
          host = new URL(href).host;
        } catch {
          host = "";
        }
        return {
          tagName,
          attribs: {
            ...attribs,
            ...(href ? { href } : {}),
            target: "_blank",
            // noopener matters because allow-popups-to-escape-sandbox makes the
            // popup a normal browsing context; noreferrer keeps the message id
            // out of the destination's logs.
            rel: "noopener noreferrer nofollow",
            ...(host ? { title: host } : {}),
          },
        };
      },
      img: (tagName, attribs) => {
        const src = (attribs.src ?? "").trim();
        const rest: Record<string, string> = { ...attribs };
        // srcset is the one everybody forgets — a blocked src with a live
        // srcset loads the tracker anyway. Removed before any branch, so no
        // path can emit it.
        delete rest.srcset;
        delete rest.src;

        /** No src at all: the browser shows alt and requests nothing. */
        const withheld = (): { tagName: string; attribs: Record<string, string> } => ({
          tagName,
          attribs: rest.alt ? { alt: rest.alt } : {},
        });

        if (/^cid:/i.test(src)) {
          const part = lookupCid(options.cidMap, src);
          // An unmatched cid renders nothing and NEVER falls through to the
          // remote path — a missing inline image must not become a request.
          if (!part) return withheld();
          return { tagName, attribs: { ...rest, src: options.inlineUrl(part) } };
        }

        const scheme = schemeOf(src);
        if (scheme !== "http" && scheme !== "https") return withheld();

        if (!allowRemote) {
          blockedRemoteCount += 1;
          // The original URL must not survive anywhere in the output, or a
          // later change that starts trusting attributes leaks it.
          return withheld();
        }
        return { tagName, attribs: { ...rest, src: options.remoteUrl!(src) } };
      },
      "*": (tagName, attribs) => {
        if (typeof attribs.style === "string") {
          return {
            tagName,
            attribs: { ...attribs, style: stripHostileCss(attribs.style, allowRemote) },
          };
        }
        return { tagName, attribs };
      },
    },
  });

  // <style> CONTENTS are not something sanitize-html filters — it treats them
  // as text and hands them back untouched, so a stylesheet full of @import and
  // remote url() sails straight through. Cleaned here, on already-sanitized
  // output, because at this point the markup structure is known-good and a
  // regex over it is answering a much smaller question than parsing would.
  //
  // Found by the corpus, not by reading the docs: the first version relied on
  // `textFilter`, which is never called for style content.
  const withCleanStyles = clean.replace(
    /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_match, open: string, css: string, close: string) =>
      `${open}${stripHostileCss(css, allowRemote)}${close}`,
  );

  return { html: withCleanStyles, blockedRemoteCount };
}
