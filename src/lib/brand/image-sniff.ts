/**
 * What an uploaded logo actually is — from its bytes, never from what the
 * browser said it was.
 *
 * The presigned upload token restricts the declared content type, and a client
 * can declare anything. Registration therefore reads the file's own header:
 * a PNG starts with an eight-byte signature and puts its size in the IHDR
 * chunk that must come first; a JPEG starts with SOI and carries its size in
 * whichever SOF marker begins the frame. Anything else is refused.
 *
 * Deliberately not `sharp`. It is the right tool for resizing and it is also
 * an ELF dependency that has taken production down twice
 * (`next.config.ts`, `src/lib/vision-image.ts`); forty lines of header parsing
 * do this job without putting it on the path of a settings screen.
 *
 * Pure, so it is table-testable with hand-built byte arrays.
 */

export interface SniffedImage {
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function u16(bytes: Uint8Array, at: number): number {
  return (bytes[at] << 8) | bytes[at + 1];
}

function u32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] << 24) >>> 0) +
    (bytes[at + 1] << 16) +
    (bytes[at + 2] << 8) +
    bytes[at + 3]
  );
}

function sniffPng(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  // Bytes 8–11 are the first chunk's length, 12–15 its type: IHDR is required
  // to be first, and its width and height are the first two fields.
  const type = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (type !== "IHDR") return null;
  const width = u32(bytes, 16);
  const height = u32(bytes, 20);
  if (width <= 0 || height <= 0) return null;
  return { mimeType: "image/png", width, height };
}

/**
 * The SOF markers that carry a frame's dimensions: C0–C3, C5–C7, C9–CB and
 * CD–CF. C4 (DHT), C8 (JPG) and CC (DAC) sit in the same range and do not.
 */
function isStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function sniffJpeg(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    // Padding: any number of 0xFF bytes may precede a marker.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // Standalone markers carry no length.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    const length = u16(bytes, at + 2);
    if (length < 2) return null;
    if (isStartOfFrame(marker)) {
      // Segment: length(2) precision(1) height(2) width(2) …
      if (at + 9 > bytes.length) return null;
      const height = u16(bytes, at + 5);
      const width = u16(bytes, at + 7);
      if (width <= 0 || height <= 0) return null;
      return { mimeType: "image/jpeg", width, height };
    }
    // SOS begins entropy-coded data; a frame header always precedes it.
    if (marker === 0xda) return null;
    at += 2 + length;
  }
  return null;
}

/**
 * The image's real type and size, or null for anything that is not a PNG or
 * a JPEG whose header can be read. Only the first few KB need be passed in,
 * though the whole file is fine.
 */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  return sniffPng(bytes) ?? sniffJpeg(bytes);
}

/**
 * Is this an SVG document? An optional BOM, whitespace, XML declaration,
 * comments and a DOCTYPE, then `<svg`. Size is not read — a vector has none
 * worth trusting — and an SVG is never stored: it is rasterised on the way in
 * (`src/lib/brand/raster.ts`), which is what keeps the stored-XSS door the
 * Documents allowlist describes shut for the brand kit too.
 */
export function isSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, 2048))
    .replace(/^﻿/, "");
  return /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(
    head,
  );
}
