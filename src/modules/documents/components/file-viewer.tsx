"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Table2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes } from "../lib/format";
import { fileKindLabel } from "../lib/view-mode";
import {
  describeTextExtraction,
  isContentSearchable,
  type TextExtractionState,
} from "../text/state";
import { PdfCanvas } from "./pdf-canvas";
import { previewSpreadsheetAction } from "../document-actions";
// From ./preview/types, never ./preview/spreadsheet — that module is
// server-only and pulls exceljs with it.
import type { SpreadsheetPreview } from "../preview/types";

export interface ViewableFile {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /**
   * Why this file's contents are, or are not, in the search index.
   *
   * Imported from `../text/state`, which carries no `server-only` marker for
   * exactly this reason — `../text/extract` owns pdfjs and exceljs, and a type
   * import from THERE would drag both parsers into the browser bundle.
   */
  textExtraction: TextExtractionState;
}

/** Canvas width for the viewer. Drawn at devicePixelRatio on top of this. */
const VIEWER_WIDTH = 860;

function isImage(mimeType: string): boolean {
  return ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
    mimeType,
  );
}

/**
 * A spreadsheet rendered as a table.
 *
 * The parse happens on the server (see preview/spreadsheet.ts) and this only
 * draws the grid, which is why there is no spreadsheet library in the browser
 * bundle. Row one is treated as a header because in practice it always is —
 * and if it is not, the worst outcome is one bold row.
 */
function SheetPreviewPane({ documentId }: { documentId: string }) {
  const [data, setData] = useState<SpreadsheetPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    void (async () => {
      const result = await previewSpreadsheetAction({ documentId });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const preview = result.data ?? null;
      setData(preview);
      // Open on the first sheet that has something in it. Exports routinely
      // lead with a cover sheet — a QuickBooks customer list starts with
      // "QuickBooks Desktop Export Tips", which is genuinely empty to a parser
      // — and landing on it makes a 955-row file look like it failed.
      const firstWithRows =
        preview?.sheets.findIndex((s) => s.rows.length > 0) ?? -1;
      setActive(firstWithRows > 0 ? firstWithRows : 0);
    })();
  }, [documentId]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
        <Table2 className="size-10 text-muted-foreground" />
        <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Two different problems, worth two different messages: a workbook we could
  // not get any sheets out of is a bug worth reporting, whereas a blank sheet
  // is just a blank sheet.
  if (data.sheets.length === 0) {
    return (
      <p className="px-4 py-12 text-center text-sm text-muted-foreground">
        We couldn&apos;t read any sheets from this workbook. Download it to open
        it — and it&apos;s worth telling us, because this shouldn&apos;t happen.
      </p>
    );
  }

  const sheet = data.sheets[active];
  const [header, ...body] = sheet?.rows ?? [];

  return (
    <div className="w-full space-y-2">
      {/* Rendered BEFORE any empty check. The previous version returned early
          on an empty sheet, so a workbook whose first sheet is a cover page
          showed "This sheet is empty" with no way to reach the data. */}
      {data.sheets.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {data.sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                "rounded border px-2 py-1 text-xs",
                i === active
                  ? "border-brand bg-secondary font-medium"
                  : "text-muted-foreground hover:text-foreground",
                s.rows.length === 0 && i !== active && "opacity-50",
              )}
            >
              {s.name}
              {s.rows.length === 0 && " (empty)"}
            </button>
          ))}
        </div>
      )}

      {!sheet || sheet.rows.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-muted-foreground">
          This sheet is empty.
          {data.sheets.length > 1 && " Pick another sheet above."}
        </p>
      ) : (
        <div className="overflow-auto rounded border bg-background">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-secondary">
              <tr>
                {header.map((cell, i) => (
                  <th
                    key={i}
                    className="border-b border-r px-2 py-1 text-left font-medium"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r} className="even:bg-secondary/30">
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className="whitespace-nowrap border-b border-r px-2 py-1"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sheet && sheet.rows.length > 0 && (sheet.truncated || data.omittedSheets > 0) && (
        // Said out loud: a preview that silently shows the first 200 rows of a
        // 5,000-row takeoff is a preview someone will make a decision on.
        <p className="text-xs text-muted-foreground">
          Showing the first {body.length + 1} of {sheet.totalRows} rows
          {sheet.truncated && " (and the first 40 columns)"}
          {data.omittedSheets > 0 &&
            ` · ${data.omittedSheets} more sheet${data.omittedSheets === 1 ? "" : "s"} not shown`}
          . Download the file for everything.
        </p>
      )}
    </div>
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
  // Legacy .xls is included so the pane can EXPLAIN why there is no table,
  // rather than falling through to the generic "open it on your computer".
  const sheet =
    file.mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.mimeType === "text/csv" ||
    file.mimeType === "application/vnd.ms-excel";

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

        {/*
          Shown ONLY when the contents are not searchable. Confirming that a
          file IS searchable on every other file would be a line nobody reads,
          which is how the one file where it matters stops being noticed.

          `role="note"` rather than `alert`: this explains a limitation the
          person may not have hit yet. An alert interrupts, and nothing here is
          urgent or wrong.
        */}
        {!isContentSearchable(file.textExtraction) && (
          <p
            role="note"
            className="rounded-md bg-secondary/50 px-3 py-2 text-xs text-muted-foreground"
          >
            <span className="font-medium text-foreground">
              Not searchable by content.
            </span>{" "}
            {describeTextExtraction(file.textExtraction)}
          </p>
        )}

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
          ) : sheet ? (
            <SheetPreviewPane documentId={file.id} />
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
