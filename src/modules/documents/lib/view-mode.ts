/**
 * How the browser lists a folder. Lives in the URL like every other piece of
 * browse state, so a view is linkable and survives a reload.
 */

export const VIEW_MODES = ["list", "icons", "thumbs"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export const DEFAULT_VIEW_MODE: ViewMode = "list";

export function parseViewMode(raw: string | undefined | null): ViewMode {
  return (VIEW_MODES as readonly string[]).includes(raw ?? "")
    ? (raw as ViewMode)
    : DEFAULT_VIEW_MODE;
}

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  list: "List",
  icons: "Icons",
  thumbs: "Thumbnails",
};

/**
 * Which files can show a real preview.
 *
 * Images only, and that is a CSP consequence rather than an oversight. File
 * responses carry `frame-ancestors 'none'` AND a `sandbox` directive — the
 * former stops them being framed at all, the latter disables the browser's
 * built-in PDF viewer even where framing is allowed. Both exist to stop
 * user-uploaded content executing in our origin, and neither is worth trading
 * for a thumbnail. An `<img>` is unaffected by either, which is why images
 * work and PDFs get a typed tile instead. See the dossier for the real fix.
 */
const PREVIEWABLE = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export function canPreview(mimeType: string): boolean {
  return PREVIEWABLE.has(mimeType);
}

/** A short, human label for a file type — what the icon tiles show. */
export function fileKindLabel(mimeType: string, fileName: string): string {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return "Image";
  if (mimeType === "text/csv") return "CSV";
  if (mimeType === "text/plain") return "Text";
  if (mimeType === "text/markdown") return "Markdown";
  if (mimeType === "application/zip") return "ZIP";
  if (mimeType.includes("wordprocessingml") || mimeType === "application/msword")
    return "Word";
  if (mimeType.includes("spreadsheetml") || mimeType === "application/vnd.ms-excel")
    return "Excel";
  if (
    mimeType.includes("presentationml") ||
    mimeType === "application/vnd.ms-powerpoint"
  )
    return "PowerPoint";
  const ext = fileName.includes(".")
    ? fileName.slice(fileName.lastIndexOf(".") + 1).toUpperCase()
    : "";
  return ext.slice(0, 5) || "File";
}
