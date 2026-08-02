/**
 * The rules an inline image has to satisfy, in one pure file.
 *
 * Shared by the upload route, the Documents insert action, the send action and
 * the sanitizer's caller — four places that must agree about what counts as a
 * picture, or one of them becomes the way round the others.
 */

/**
 * The types a composed message may carry inline.
 *
 * SVG IS ABSENT, and it is the only interesting entry. It is a document that can
 * carry script and external references, not a picture — the same reason it is
 * refused as a mail attachment and left out of the read path's magic-byte sniff
 * table. This one is going OUT under the user's own name, where nothing of ours
 * gets a second look at it.
 */
export const INLINE_IMAGE_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

/** Per image. Well under the mail server's own attachment limit. */
export const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;
/** Per message. Twenty photographs in one email is a shared album, not mail. */
export const MAX_INLINE_IMAGES = 20;

export function isInlineImageType(type: string): boolean {
  return INLINE_IMAGE_TYPES.includes(type.trim().toLowerCase());
}

/**
 * What a Content-ID may look like.
 *
 * Deliberately much narrower than RFC 2392 permits. This value lands in a MIME
 * header AND inside a `cid:` URL in the HTML body, so anything that could carry
 * a quote, an angle bracket or whitespace would be a header-injection question
 * rather than a formatting one. Since the server mints these, a narrow shape
 * costs nothing.
 */
export const CID_PATTERN = /^[a-z0-9]{16,64}@yosher\.mail$/;

export function isValidCid(cid: string): boolean {
  return CID_PATTERN.test(cid);
}

/**
 * Mint one.
 *
 * SERVER-SIDE, always, which is why this file is imported by the route and the
 * action rather than by the editor. The client could perfectly well generate a
 * random string, but then the id in a MIME header would be a value a caller
 * chose, and every later check would have to treat it as untrusted input. Minted
 * here it is ours, and `isValidCid` is a cheap assertion rather than a guard.
 */
export function mintCid(): string {
  // 32 hex characters. `randomUUID` is available in every runtime this ships to
  // and saves reaching for a Buffer in code that also runs on the edge.
  return `${crypto.randomUUID().replace(/-/g, "")}@yosher.mail`;
}

/** What the composer holds for each inserted picture. */
export interface InlineImage {
  blobId: string;
  cid: string;
  type: string;
  name: string;
  size: number;
  /** A signed URL the EDITOR can display. Never sent; see `compose/html.ts`. */
  previewUrl: string;
}
