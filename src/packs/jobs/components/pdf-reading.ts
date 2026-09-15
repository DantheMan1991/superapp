"use client";

import { loadPdfjs } from "@/modules/documents/components/pdf-canvas";
import type { PageText } from "../drawings-math";

/** What the browser read off one page of a set, for the index table. */
export interface ReadPage {
  pageNumber: number;
  width: number;
  height: number;
  items: PageText[];
  /** A small JPEG of the page, so the person can read a scanned set's numbers off it. */
  thumbnail: string | null;
}

export interface ReadPdf {
  pageCount: number;
  pages: ReadPage[];
}

/** Past this many pages the thumbnails stop; the text is still read. */
export const THUMBNAIL_LIMIT = 150;
const THUMBNAIL_WIDTH = 168;

/**
 * Read a PDF in the browser: every page's text runs in viewport space,
 * flipped so y grows upward the way the title-block rule expects — through
 * `convertToViewportPoint`, so a landscape sheet stored rotated still puts
 * its corner where the eye sees it — and a thumbnail of each page. Runs
 * where the bytes already are (the file the person just picked, or one
 * fetch of a file from the cabinet) so the server never opens the PDF.
 */
export async function readPdf(bytes: Uint8Array, onProgress?: (done: number, total: number) => void): Promise<ReadPdf> {
  const lib = await loadPdfjs();
  const task = lib.getDocument({ data: bytes });
  const doc = await task.promise;
  const pages: ReadPage[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: PageText[] = [];
      for (const item of content.items) {
        if (!("str" in item) || item.str.trim() === "") continue;
        const [vx, vy] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        const [ex] = viewport.convertToViewportPoint(item.transform[4] + item.width, item.transform[5]);
        items.push({
          str: item.str,
          x: Math.min(vx, ex),
          y: viewport.height - vy,
          width: Math.abs(ex - vx),
          height: item.height,
        });
      }
      let thumbnail: string | null = null;
      if (n <= THUMBNAIL_LIMIT) {
        const scale = THUMBNAIL_WIDTH / viewport.width;
        const small = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(small.width);
        canvas.height = Math.ceil(small.height);
        const context = canvas.getContext("2d");
        if (context) {
          await page.render({ canvas, canvasContext: context, viewport: small }).promise;
          thumbnail = canvas.toDataURL("image/jpeg", 0.65);
        }
      }
      page.cleanup();
      pages.push({ pageNumber: n, width: viewport.width, height: viewport.height, items, thumbnail });
      onProgress?.(n, doc.numPages);
    }
    return { pageCount: doc.numPages, pages };
  } finally {
    await task.destroy();
  }
}
