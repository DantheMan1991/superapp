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
/**
 * **WIDE ENOUGH TO BE THE PICTURE ON THE CARD, not a stamp in the corner of
 * it.** This was 168px when the only place it showed was the index table at
 * 96px wide. Now it IS the sheet card on the drawings page — ~490px across
 * on a desktop in three columns, ~340 on a phone in one — and 168 stretched
 * to that is a blur. The founder: *"there is a fair amount of wasted space
 * with the thumbnails. it would be nice if they were bigger."*
 *
 * 480 is 1:1 on a desktop card and 1.4× on a phone's, at roughly 40–60KB a
 * page — a forty-page set is a couple of MB on the drawings page, which on
 * site is the trade-off worth making for pictures you can actually read.
 * Sets read before this were stored at 168 and show soft until read again.
 */
const THUMBNAIL_WIDTH = 480;

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
  /**
   * **pdf.js IS GIVEN A COPY, BECAUSE IT KEEPS WHAT IT IS GIVEN.** The array
   * is transferred to the worker, which leaves the CALLER's buffer detached —
   * every later read of it throws *"Cannot perform Construct on a detached or
   * out-of-bounds ArrayBuffer"*. That cost nothing while the bytes were
   * thrown away here, and everything the moment the index kept them to draw
   * a page from. One copy, and the file the person picked is still a file.
   */
  const task = lib.getDocument({ data: new Uint8Array(bytes) });
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
