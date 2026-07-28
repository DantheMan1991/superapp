import {
  sanitizeFileName,
  type Disposition,
} from "@/lib/file-headers";

/**
 * How a mail attachment is allowed to reach the browser.
 *
 * DELIBERATELY INVERTED relative to the Documents module. There, dangerous
 * types are refused at upload (`allowlist.ts` calls serving HTML from our own
 * origin "stored XSS against the whole dashboard session"), so the serving side
 * can afford an allowlist of inline-safe types.
 *
 * Mail has no upload gate. Anyone on the internet can attach anything, and we
 * cannot refuse to hold it — it is the user's own correspondence. What we can
 * refuse is to serve it AS ITS OWN TYPE from our origin.
 *
 * So the rule is: almost nothing renders inline, and anything active is served
 * as `application/octet-stream` with `attachment` and `nosniff`. That
 * combination means no browser renders it, in any version, under any
 * Content-Disposition parsing quirk — the mail-shaped version of the refusal
 * Documents makes at upload time.
 */

/**
 * The only types allowed to render inline, and only because the reading pane
 * shows them itself (an <img> for the first group, a canvas for nothing else).
 * Everything absent from this set downloads.
 */
const INLINE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
]);

/**
 * Types that execute, or that a browser can be talked into executing.
 *
 * `image/svg+xml` is in here despite looking like an image: it is a document
 * that can carry script, and it is the classic bypass for exactly this kind of
 * allowlist.
 */
const ACTIVE_TYPES: ReadonlySet<string> = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
  "text/javascript",
  "application/javascript",
  "application/ecmascript",
  "text/vbscript",
]);

/**
 * Extensions that are dangerous whatever the declared type says. A sender
 * controls both the bytes and the metadata, so the extension is checked
 * independently rather than trusted to agree.
 */
const DANGEROUS_EXTENSIONS: readonly string[] = [
  ".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".pif", ".cpl",
  ".js", ".jse", ".vbs", ".vbe", ".wsf", ".wsh", ".hta", ".lnk",
  ".jar", ".ps1", ".psm1", ".reg", ".iso", ".img", ".dll", ".sys",
  ".app", ".dmg", ".pkg", ".deb", ".rpm", ".sh",
];

export interface AttachmentPolicy {
  /** What Content-Type to actually serve. Not necessarily what was declared. */
  servedType: string;
  disposition: Disposition;
  /** Sanitized, extension preserved. Safe for a header. */
  fileName: string;
  /** True when the UI should mark this as risky before someone opens it. */
  warn: boolean;
}

function hasDangerousExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase().trim();
  return DANGEROUS_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * @param requestedInline caller wants this rendered in place — only honoured
 *   for real image types, and never for anything active.
 */
export function mailAttachmentPolicy(
  declaredType: string,
  rawFileName: string,
  requestedInline = false,
): AttachmentPolicy {
  const fileName = sanitizeFileName(rawFileName);
  const type = declaredType.split(";")[0]?.trim().toLowerCase() ?? "";
  const dangerousName = hasDangerousExtension(fileName);

  // Active content, or a dangerous extension whatever the type claims. Stripped
  // of its type entirely so nothing can decide to render it.
  if (ACTIVE_TYPES.has(type) || dangerousName) {
    return {
      servedType: "application/octet-stream",
      disposition: "attachment",
      fileName,
      warn: true,
    };
  }

  if (INLINE_IMAGE_TYPES.has(type)) {
    return {
      servedType: type,
      disposition: requestedInline ? "inline" : "attachment",
      fileName,
      warn: false,
    };
  }

  // PDF is safe-ish and still never inline: the reading pane paints it with the
  // existing PdfCanvas, which is how the DMS avoids framing a PDF at all. One
  // PDF rendering path in the product, not two.
  if (type === "application/pdf") {
    return {
      servedType: "application/pdf",
      disposition: "attachment",
      fileName,
      warn: false,
    };
  }

  // Everything else downloads under a type no browser will render. Not flagged
  // as risky — a .docx is not dangerous, it simply has no inline rendering.
  return {
    servedType: type.length > 0 ? type : "application/octet-stream",
    disposition: "attachment",
    fileName,
    warn: false,
  };
}
