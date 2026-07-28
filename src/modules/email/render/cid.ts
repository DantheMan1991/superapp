import type { JmapEmailBodyPart } from "@/lib/email/jmap/types";

/**
 * Inline images — the parts an HTML body references as `cid:something`.
 *
 * These render EVEN WHILE REMOTE IMAGES ARE BLOCKED, and the distinction is
 * precise rather than cosmetic: a cid part arrived in the same envelope as the
 * message and is fetched from our own mail server with the reader's own token.
 * There is no per-open callback to the sender, so displaying it leaks nothing.
 * A remote image is the opposite — loading it is the report.
 */

/**
 * Normalize both sides of the comparison.
 *
 * Verified against a live Stalwart: a part sent as
 * `Content-ID: <logo-part-1@yosher.test>` comes back as
 * `logo-part-1@yosher.test`, brackets stripped. Another server may not strip
 * them, and the HTML may percent-encode the reference, so every form is folded
 * to the same key. Getting this wrong does not throw — it silently produces a
 * message with missing images, which is why it is worth being thorough.
 */
export function normalizeCid(raw: string): string {
  let out = raw.trim();
  if (/^cid:/i.test(out)) out = out.slice(4);
  try {
    out = decodeURIComponent(out);
  } catch {
    // A malformed escape means the reference was never going to match anyway.
  }
  out = out.trim();
  if (out.startsWith("<") && out.endsWith(">")) out = out.slice(1, -1);
  return out.trim();
}

export interface InlinePart {
  cid: string;
  blobId: string;
  type: string;
  name: string;
  size: number;
}

/**
 * Build the lookup an HTML body's `cid:` references resolve against.
 *
 * Only parts carrying BOTH a cid and a blobId are included — without a blobId
 * there is nothing to fetch, and emitting a URL for it would render a broken
 * image where the sanitizer could instead drop the tag and keep the alt text.
 *
 * SVG is excluded on purpose. It is a document that can carry script, and an
 * inline one would be served from our own origin; it becomes an attachment chip
 * instead, subject to the same refusal as any other active type.
 */
export function buildCidMap(
  parts: readonly JmapEmailBodyPart[],
): Map<string, InlinePart> {
  const map = new Map<string, InlinePart>();
  for (const part of parts) {
    if (!part.cid || !part.blobId) continue;
    const type = part.type.toLowerCase();
    if (type === "image/svg+xml") continue;
    const key = normalizeCid(part.cid);
    if (key.length === 0) continue;
    // First one wins: duplicate Content-IDs are malformed, and picking the
    // later part would let a second copy shadow the one the body meant.
    if (map.has(key)) continue;
    map.set(key, {
      cid: key,
      blobId: part.blobId,
      type: part.type,
      name: part.name ?? "image",
      size: part.size,
    });
  }
  return map;
}

/**
 * Resolve a `cid:` reference, tolerating case.
 *
 * RFC 2392 says a Content-ID is case-sensitive, and the exact match is tried
 * first for that reason — but real senders disagree with the RFC often enough
 * that falling back to a case-insensitive match rescues more messages than it
 * endangers. Nothing is granted by matching: the result is still one of this
 * message's own parts either way.
 */
export function lookupCid(
  map: Map<string, InlinePart>,
  reference: string,
): InlinePart | null {
  const key = normalizeCid(reference);
  const exact = map.get(key);
  if (exact) return exact;
  const lower = key.toLowerCase();
  for (const [candidate, part] of map) {
    if (candidate.toLowerCase() === lower) return part;
  }
  return null;
}
