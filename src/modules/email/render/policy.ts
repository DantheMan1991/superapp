/**
 * What a message body is allowed to do.
 *
 * An HTML email is the most hostile input this platform accepts: anyone on the
 * internet can put arbitrary markup in front of a signed-in staff user, and
 * unlike an upload there is no gate to refuse it at. So the body renders in an
 * iframe pointed at its own route, and these two strings are what confine it.
 *
 * WHICH CONTROL IS LOAD-BEARING, stated plainly because it decides what may be
 * changed casually and what may not:
 *
 *   • Against script execution — the ABSENCE of `allow-scripts` in the sandbox
 *     attribute. It is a browser bit computed before any content parses, and
 *     nothing inside the document can turn it back on. `script-src 'none'` and
 *     the sanitizer are defence in depth, not the boundary.
 *   • Against tracking and exfiltration — the response CSP (`img-src 'self'`,
 *     `connect-src 'none'`). The sanitizer's URL rewriting is what makes the
 *     "show images" toggle mean anything, but the CSP is what enforces it.
 *   • Against the message reaching our chrome — the iframe boundary itself.
 *
 * There is no app-wide CSP in this codebase (next.config.ts sets no headers), so
 * every guarantee here has to be carried by the response and the element. That
 * is the same approach blob-stream.ts already takes for stored files, and the
 * reasoning pdf-canvas.ts spells out: response headers govern the file AS A
 * DOCUMENT, which is exactly what an iframe makes it.
 */

/**
 * `allow-same-origin` is present for ONE reason: so the parent can read
 * `contentDocument.documentElement.scrollHeight` and size the frame to its
 * content. Without it the frame is an opaque origin, the height is unknowable,
 * and a reading pane grows a nested scrollbar — which is the single most
 * irritating thing a mail client can do.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  NEVER ADD `allow-scripts` TO THIS STRING.                               │
 * │                                                                          │
 * │  `allow-scripts` TOGETHER WITH `allow-same-origin` lets the framed        │
 * │  document reach into the parent and remove its own sandbox attribute.     │
 * │  That is not a weakened sandbox, it is no sandbox at all, on a document   │
 * │  whose author is an anonymous sender.                                     │
 * │                                                                          │
 * │  If script inside the frame is ever genuinely needed, the answer is to    │
 * │  move the frame to a SEPARATE ORIGIN and use `allow-scripts` WITHOUT      │
 * │  `allow-same-origin` — not to add a token here.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `allow-popups` + `allow-popups-to-escape-sandbox` exist so a link can open in
 * a new tab; without the second token the popup would inherit the sandbox and
 * open a crippled page. Every anchor is forced to `rel="noopener noreferrer"`
 * precisely because the popup is then a normal browsing context.
 */
export const MESSAGE_FRAME_SANDBOX =
  "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

/**
 * The response CSP for a message body.
 *
 * `img-src 'self'` and nothing else is the tracking defence: inline `cid:`
 * images are rewritten to our own blob route, and remote images — when the
 * reader asks for them — come through our proxy, so they are `'self'` too.
 *
 * THE POLICY HAS NO PERMISSIVE MODE. This string is byte-identical whether or
 * not the reader has unblocked images, because unblocking changes what the
 * sanitizer emits, never what the browser permits. A toggle that widened the
 * CSP would also re-open CSS-based exfiltration for the whole document, and
 * there is a test asserting the two modes produce the same policy.
 *
 * `style-src 'unsafe-inline'` is unavoidable — mail is made of inline styles —
 * and is acceptable only because scripting is off: CSS alone cannot exfiltrate
 * when every fetch directive is `'none'` or `'self'`.
 *
 * The `sandbox` directive repeats the element's attribute on purpose. The
 * browser takes the UNION of the restrictions, so both must list the same
 * tokens or the frame silently loses `allow-same-origin` and the height
 * measurement breaks. The header's copy is also what protects a direct
 * navigation to the frame URL in a tab, where no element attribute exists.
 */
export const MESSAGE_FRAME_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self'",
  "font-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
  `sandbox ${MESSAGE_FRAME_SANDBOX}`,
].join("; ");

/** Headers for the body frame's own response. */
export function messageFrameHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": MESSAGE_FRAME_CSP,
    "X-Content-Type-Options": "nosniff",
    // Without this the destination of every click learns the message id from
    // the Referer. The anchors also carry rel="noreferrer"; this is the one
    // that does not depend on the sanitizer having got it right.
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
}
