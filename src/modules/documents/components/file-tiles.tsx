import Link from "next/link";
import { FileText, FolderOpen, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatBytes } from "../lib/format";
import { canPreview, fileKindLabel } from "../lib/view-mode";

/**
 * Grid tiles for the Icons and Thumbnails views.
 *
 * Server components: a tile is a link, a name and — for images — an `<img>`.
 * None of that needs JavaScript, and a folder of two hundred files should not
 * ship two hundred client components. The drag wrappers around them are the
 * only client part.
 */

const BASE = "/dashboard/m/documents/browse";

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
    <Link
      draggable={false}
      href={`${BASE}/${id}`}
      className="flex h-full flex-col items-center gap-2 rounded-md border p-3 text-center transition-colors hover:bg-secondary/50"
    >
      <FolderOpen className="size-10 shrink-0 text-muted-foreground" />
      <span className="line-clamp-2 break-words text-sm font-medium">{name}</span>
      {restricted && (
        <Badge variant="secondary" className="gap-1">
          <Lock className="size-3" />
          Owners
        </Badge>
      )}
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

  return (
    <a
      draggable={false}
      href={`/api/documents/${id}/file`}
      className="flex h-full flex-col gap-2 rounded-md border p-3 transition-colors hover:bg-secondary/50"
    >
      <div
        className={cn(
          "flex items-center justify-center overflow-hidden rounded bg-secondary/40",
          preview ? "aspect-square" : "aspect-square",
        )}
      >
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
            className="size-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <FileText className="size-8" />
            <span className="text-[10px] font-medium uppercase tracking-wide">
              {fileKindLabel(mimeType, fileName)}
            </span>
          </div>
        )}
      </div>
      <span className="line-clamp-2 break-words text-sm font-medium">{label}</span>
      <span className="mt-auto text-xs text-muted-foreground">
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
