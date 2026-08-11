import Link from "next/link";
import { FileText, FolderOpen, Lock } from "lucide-react";
import { formatBytes } from "../lib/format";
import { canPreview, fileKindLabel } from "../lib/view-mode";
import { PdfThumbnail } from "./pdf-canvas";

/**
 * Grid tiles for the Icons and Thumbnails views.
 *
 * Server components: a tile is a link, a name and — for images — an `<img>`.
 * None of that needs JavaScript, and a folder of two hundred files should not
 * ship two hundred client components. The drag wrappers around them are the
 * only client part.
 *
 * The card language here is the Airbnb half of the design system (see
 * docs/modules/design-system.md): a media block, then a tight title, then one
 * quiet line of metadata, with elevation instead of a border and a lift on
 * hover. Two details are worth keeping:
 *
 * - **A chip floats over the media block rather than sitting under it.**
 *   Translucent surface plus `--elevation-1`, which is the trick that makes it
 *   read as being *above* the thumbnail instead of printed on it. It carries the
 *   file type on a tile that has no preview to speak for itself, and the
 *   owners-only lock on a folder.
 * - **`overflow-hidden` on the media block** is what keeps the image's hover
 *   scale inside the rounded corner.
 */

const BASE = "/dashboard/m/documents/browse";

/** Shared so a folder tile and a file tile are always the same shape. */
const TILE =
  "group/tile flex h-full flex-col gap-2 rounded-2xl bg-card p-3 shadow-elevation-1 transition-shadow hover:shadow-elevation-3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * The media block. Grid rows size to their tallest member, so a folder next to
 * a file used to stretch to the file's height and every row ended up a
 * different size. Matching the two shapes is what makes the grid uniform.
 */
const MEDIA =
  "relative flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-module-accent/8";

const CHIP =
  "absolute top-1.5 left-1.5 rounded-[10px] bg-card/85 px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase shadow-elevation-1 backdrop-blur-sm";

export function FolderTile({
  id,
  name,
  restricted,
}: {
  id: string;
  name: string;
  restricted: boolean;
}) {
  return (
    <Link draggable={false} href={`${BASE}/${id}`} className={TILE}>
      <div className={MEDIA}>
        <FolderOpen className="size-10 text-module-accent" />
        {restricted && (
          <span className={CHIP}>
            <Lock className="mr-0.5 inline size-2.5 align-[-1px]" />
            Owners
          </span>
        )}
      </div>
      <span className="line-clamp-2 text-sm font-medium break-words">
        {name}
      </span>
      {/* Keeps the baseline aligned with a file tile's size line. */}
      <span className="mt-auto text-xs text-subtle-foreground">Folder</span>
    </Link>
  );
}

export function FileTile({
  id,
  title,
  fileName,
  mimeType,
  sizeBytes,
  showPreview,
}: {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Thumbnails view. Icons view passes false and never fetches bytes. */
  showPreview: boolean;
}) {
  const label = title || fileName;
  const preview = showPreview && canPreview(mimeType);
  const isPdf = showPreview && mimeType === "application/pdf";
  const kind = fileKindLabel(mimeType, fileName);

  return (
    <a
      draggable={false}
      href={`/api/documents/${id}/file`}
      className={TILE}
    >
      <div className={MEDIA}>
        {preview ? (
          // Same-origin and authenticated, exactly like opening the file.
          // loading="lazy" so a folder of photos does not fetch every full
          // image at once — these are the originals, not resized thumbnails,
          // which is the honest cost of not having a rasterizer. See dossier.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/documents/${id}/file`}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-200 group-hover/tile:scale-[1.03]"
          />
        ) : isPdf ? (
          // Drawn by pdf.js to a canvas, not framed — see pdf-canvas.tsx.
          <PdfThumbnail url={`/api/documents/${id}/file`} />
        ) : (
          <FileText className="size-9 text-module-accent/70" />
        )}
        {/* On a real preview the image says what it is, so the chip would be
            noise. On a typed tile it is the only thing that does. */}
        {!preview && <span className={CHIP}>{kind}</span>}
      </div>
      <span className="line-clamp-2 text-sm font-medium break-words">
        {label}
      </span>
      <span className="mt-auto text-xs text-subtle-foreground tabular-nums">
        {formatBytes(sizeBytes)}
      </span>
    </a>
  );
}

/** The grid both tile views share. */
export function TileGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {children}
    </div>
  );
}
