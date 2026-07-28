import { TEXT_BODY_CSS } from "./text-to-html";

/**
 * Wrap sanitized body markup in the document the iframe actually loads.
 *
 * We own everything outside `<body>` — the doctype, the head, the stylesheet —
 * so the message contributes content and nothing else. That is why the
 * sanitizer can drop `<meta>`, `<base>` and `<link>` without losing anything
 * legitimate: a message has no business setting those, and ours are already
 * correct.
 */

/**
 * `overflow-y: hidden` on the root is what removes the nested scrollbar: the
 * PARENT measures scrollHeight and grows the frame instead. Horizontal overflow
 * is kept scrollable because fixed-width tables are endemic in real mail, and
 * clipping one silently hides a column of an invoice.
 */
const RESET = `
/*
 * Forced light, and NOT following the OS. Two reasons, and the second is the
 * real one:
 *
 *  1. Mail HTML is written assuming a white page — senders set text colours and
 *     leave the background alone. Rendering it on a dark canvas produces black
 *     text on black, which is how a message becomes unreadable rather than
 *     merely ugly.
 *  2. A "light dark" color-scheme here made the frame pick a dark canvas
 *     inside a light app. The frame must match the app, not the OS.
 *
 * (No backticks in this comment: it lives inside a template literal, and one
 *  stray backtick ends the string mid-stylesheet.)
 */
:root { color-scheme: light; }
/*
 * NO overflow-y:hidden here, deliberately. Hiding the root's vertical overflow
 * makes documentElement.scrollHeight report the VIEWPORT height rather than the
 * content height in several browsers — which makes the parent's measurement
 * circular: the frame reports the size it already is, keeps that size, and a
 * long message is silently clipped with no scrollbar to reveal it.
 *
 * The frame does not need a scrollbar anyway, because the parent sizes it to
 * its content. Horizontal overflow IS scrollable, because fixed-width tables
 * are endemic in real mail and clipping one hides a column of an invoice.
 */
html { overflow-x: auto; }
body {
  margin: 0; padding: 0;
  font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #111; background: #fff;
  overflow-wrap: break-word;
}
/* A message cannot be allowed to size itself past the pane. */
img, video, table { max-width: 100%; }
img { height: auto; }
table { border-collapse: collapse; }
blockquote { margin: 0.4em 0 0.4em 0.8em; padding-left: 0.8em;
  border-left: 2px solid currentColor; opacity: 0.75; }
a { color: inherit; }
${TEXT_BODY_CSS}
`;

export interface FrameInput {
  /** Already sanitized. This function does no escaping of its own. */
  bodyHtml: string;
  /** Shown as a banner when the server cut the body short. */
  truncated?: boolean;
}

export function buildMessageFrame(input: FrameInput): string {
  const notice = input.truncated
    ? '<p class="y-notice">This message was shortened because it is unusually ' +
      "large. Open it in your mail app to see all of it.</p>"
    : "";
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    `<style>${RESET}
.y-notice { margin: 0 0 12px; padding: 8px 10px; border-radius: 6px;
  background: rgba(180,140,0,0.12); font-size: 13px; }</style>`,
    "</head><body>",
    notice,
    input.bodyHtml,
    "</body></html>",
  ].join("");
}

/**
 * What to render when a message carries neither an HTML nor a text body.
 *
 * Says nothing was there, rather than inventing "(no content)" — the same rule
 * jmap/parse.ts holds to: presentation decides how to show an absence, it never
 * manufactures one.
 */
export const EMPTY_BODY_HTML =
  '<p style="opacity:0.6">This message has no text — check its attachments.</p>';
