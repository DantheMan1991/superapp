"use client";

import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes } from "../lib/format";
import { fileKindLabel } from "../lib/view-mode";
import { PdfCanvas } from "./pdf-canvas";

export interface ViewableFile {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/** Canvas width for the viewer. Drawn at devicePixelRatio on top of this. */
const VIEWER_WIDTH = 860;

function isImage(mimeType: string): boolean {
  return ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
    mimeType,
  );
}

/**
 * Look at a file without leaving Yosher.
 *
 * PDFs are drawn to a canvas by pdf.js and images are plain `<img>` tags —
 * neither is a frame, which is the only reason this can exist at all. The file
 * response's `frame-ancestors 'none'` and `sandbox` headers stay exactly as
 * they are; see pdf-canvas.tsx for why that matters.
 *
 * Office files cannot be rendered in a browser without a converter, so they get
 * an honest card and a download rather than a broken preview.
 */
export function FileViewer({
  file,
  open,
  onOpenChange,
}: {
  file: ViewableFile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);

  const url = `/api/documents/${file.id}/file`;
  const label = file.title || file.fileName;
  const pdf = file.mimeType === "application/pdf";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPage(1);
          setPageCount(0);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{label}</DialogTitle>
          <DialogDescription>
            {fileKindLabel(file.mimeType, file.fileName)} ·{" "}
            {formatBytes(file.sizeBytes)}
            {pdf && pageCount > 0 && ` · ${pageCount} page${pageCount === 1 ? "" : "s"}`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[64vh] items-center justify-center overflow-auto rounded-md border bg-secondary/30 p-3">
          {pdf ? (
            <PdfCanvas
              url={url}
              page={page}
              width={VIEWER_WIDTH}
              onPageCount={setPageCount}
            />
          ) : isImage(file.mimeType) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={label}
              className="max-h-[62vh] max-w-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <FileText className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {fileKindLabel(file.mimeType, file.fileName)} files open in the
                app on your computer — there is no way to show one accurately in
                a browser.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {pdf && pageCount > 1 && (
              <>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Previous page"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="px-2 text-sm text-muted-foreground">
                  {page} / {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Next page"
                  disabled={page >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`${url}?download=1`}>
                <Download className="size-4" />
                Download
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              {/* The escape hatch: full browser viewer, zoom, print. */}
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                Open full page
              </a>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Wraps a row or tile so clicking it opens the viewer instead of navigating.
 *
 * The underlying `<a href>` is left intact rather than replaced with a button:
 * middle-click, ctrl-click and "open in new tab" keep working, and the file is
 * still reachable if JavaScript has not loaded. Only a plain left-click is
 * intercepted.
 */
export function FileOpenTrigger({
  file,
  className,
  children,
}: {
  file: ViewableFile;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className={className}
        onClickCapture={(e) => {
          // Let the browser handle the gestures that mean "somewhere else".
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          if (e.button !== 0) return;
          const target = e.target as HTMLElement;
          // A click on the row's action menu is not a click on the file.
          if (target.closest("[data-no-viewer]")) return;
          if (!target.closest("a")) return;
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {children}
      </div>
      {open && (
        <FileViewer file={file} open onOpenChange={setOpen} />
      )}
    </>
  );
}
