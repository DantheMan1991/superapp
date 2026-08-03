import { sanitizeOutboundHtml } from "../compose/html";
import { htmlToPlainText } from "../compose/to-text";

/**
 * What a template is allowed to be, and what happens to it on the way in.
 *
 * Pure, and outside `actions.ts` for the reason recorded when `compose/bodies.ts`
 * was split out: a `"use server"` module may only export async functions, so
 * anything worth testing directly has to live beside it rather than in it.
 */

/**
 * Generous but bounded. A canned response is a paragraph or two; the cap is
 * there so a paste of an entire newsletter fails with a message rather than
 * becoming a row nobody can edit.
 */
export const MAX_TEMPLATE_HTML = 20_000;
export const MAX_TEMPLATE_NAME = 80;
export const MAX_TEMPLATE_SUBJECT = 200;

/**
 * The name, folded so that near-duplicates collide.
 *
 * "Payment terms", "payment terms" and "Payment  Terms" are the same template
 * as far as anybody choosing one from a list is concerned, and the unique index
 * is on this rather than on `name` — so the second one is refused at save time
 * instead of producing two rows that look identical in the picker.
 */
export function templateNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Markup in, storable markup out.
 *
 * SANITIZED ON WRITE, not only at send. The send path sanitizes every body
 * regardless, so this is not the guarantee — it is what stops the editor
 * showing one thing and the recipient receiving another, which for a template
 * matters more than for a one-off message because the divergence would repeat
 * on every use. Same reasoning the signature slice recorded, and a template is
 * in the same class: markup written once and sent many times.
 *
 * NO CID ALLOWLIST IS PASSED, so inline images are dropped rather than stored.
 * A `cid:` is minted per message and lives in that message's MIME, so a stored
 * template referencing one would show a broken image on every mail it was later
 * inserted into. The editor has no picture button for the same reason.
 *
 * THE CAP IS ON THE INPUT, and the output may be a few characters longer —
 * which a test found rather than a reviewer. Slicing raw markup at a byte
 * boundary cuts through a tag, and the sanitizer then CLOSES it, so 20,000
 * characters in can be 20,004 out. That is fine and the alternative is worse:
 * truncating the sanitized result would reintroduce exactly the unbalanced
 * markup the sanitizer just fixed. What the cap guarantees is that the stored
 * size does not grow with the paste, not that it lands under a round number.
 */
export function prepareTemplateBody(html: string): string {
  return sanitizeOutboundHtml(html.slice(0, MAX_TEMPLATE_HTML));
}

/**
 * Is there anything here worth saving?
 *
 * Asked of the SANITIZED body and of its text rendering, not of the raw input.
 * An editor left untouched emits `<div><br></div>`, and markup that sanitizes
 * to nothing visible would store a template that inserts nothing — which reads
 * as a broken feature rather than as an empty template.
 */
export function templateIsEmpty(sanitizedHtml: string): boolean {
  return htmlToPlainText(sanitizedHtml).trim().length === 0;
}

/**
 * What inserting a template does to a draft that is already open.
 *
 * INSERTS, NEVER REPLACES — the one decision in this file that a user would
 * notice. Replacing the body is the obvious reading of "apply a template" and
 * is wrong the first time somebody uses one in a REPLY: the quoted message and
 * their signature are already in that editor, and both would vanish. Gmail
 * inserts at the caret; so does this.
 *
 * The SUBJECT is filled only when empty, so applying a template to a reply
 * cannot rewrite "Re: …". A template with no subject of its own never touches
 * it either way.
 */
export function applyTemplateSubject(
  current: string,
  templateSubject: string,
): string {
  if (current.trim().length > 0) return current;
  return templateSubject;
}
