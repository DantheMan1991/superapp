import { htmlHasContent, sanitizeOutboundHtml } from "./html";
import { htmlToPlainText } from "./to-text";

/**
 * The two bodies a message goes out with.
 *
 * Lives here rather than in `compose-actions.ts` for a mundane reason worth
 * knowing: a `"use server"` module may only export async functions, so anything
 * pure that an action needs has to sit outside it. That constraint is doing us a
 * favour — this is the most consequential ordering in the composer and it is now
 * testable without a mail server, like the rest of this directory.
 *
 * **SANITIZE, THEN DERIVE.** The reverse reads identically and is wrong: a text
 * part built from the submitted markup carries the words the sanitizer removed,
 * which is the exact shape of "the HTML looks clean and the text part still has
 * the phishing link in it". Half the recipients would read one message and half
 * the other, and only one of those halves is the one anybody checked.
 */
export function composeBodies(
  htmlBody: string | undefined,
  textBody: string,
  /**
   * Content-IDs this message minted. An `<img>` naming anything else is dropped
   * — the allowlist is the ONLY thing that admits an image, and it is threaded
   * from the action rather than defaulted here so that a caller who forgets it
   * gets no images rather than unchecked ones.
   */
  allowedCids: ReadonlySet<string> = new Set(),
): { textBody: string; htmlBody: string | null } {
  if (!htmlBody) return { textBody, htmlBody: null };

  const clean = sanitizeOutboundHtml(htmlBody, { allowedCids });
  if (!htmlHasContent(clean)) {
    // Nothing visible survived, so there is no HTML message. Sending it anyway
    // would produce a `multipart/alternative` whose HTML half is blank — and
    // every client that prefers HTML, which is most of them, would render an
    // empty message. Anything the caller sent as text still goes: refusing here
    // would lose something somebody wrote.
    return { textBody, htmlBody: null };
  }

  // Derived from `clean`, never from `htmlBody`. See above.
  return { textBody: htmlToPlainText(clean), htmlBody: clean };
}
