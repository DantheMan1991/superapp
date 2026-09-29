"use client";

import { loadPdfjs } from "@/lib/pdf/browser";
import {
  DRAFT_PAGE_LIMIT,
  DRAFT_PICTURE_LIMIT,
  pictureFits,
  pointsToPicture,
  type PagePicture,
  type ReadPage,
} from "../core/draft";

/**
 * READ A PROGRAM PDF WHERE IT IS: in the person's browser.
 *
 * Every page's words, and every link on it. The links matter as much as the
 * words: a program's videos are link annotations, not text — the founder's
 * PDF carries 29 videos that way and names none of them in its words. These
 * are what is sent on, to draft from, with the pictures below; the file
 * itself never leaves the device. That is what lets a 19 MB book through a
 * server action capped at 4 MB, and it keeps somebody's bought program off
 * our servers.
 *
 * AND A PICTURE OF A PAGE WHOSE TABLE IS A PICTURE (F4b, ADR 0117). His
 * self-assessment's tests are only in a table drawn as an image, so a page
 * whose words point to a table or chart and that draws an image is rendered,
 * as a JPEG, and sent with the words. At most four, and no more than the
 * request can carry (`pictureFits`); none for a program without such a page.
 */

export interface ReadProgram {
  pageCount: number;
  pages: ReadPage[];
  /** Distinct links across the whole file, for "Read 59 pages and 33 links". */
  linkCount: number;
  /** Pages sent as pictures too, for "and 1 page as a picture". */
  pictures: PagePicture[];
}

/** A picture wide enough to read a table's cells, and small enough to send four. */
const PICTURE_WIDTH = 1100;

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfjs>>["getDocument"]>["promise"]>["getPage"]>>;

/** Whether a page draws an image at all: a page of words and lines holds no table picture. */
async function drawsImage(page: PdfPage, lib: Awaited<ReturnType<typeof loadPdfjs>>): Promise<boolean> {
  const ops = await page.getOperatorList();
  return ops.fnArray.some((fn) => fn === lib.OPS.paintImageXObject || fn === lib.OPS.paintInlineImageXObject);
}

/** The page as a JPEG, base64 without its `data:` prefix; null when the browser cannot draw it. */
async function pictureOf(page: PdfPage): Promise<string | null> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: PICTURE_WIDTH / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) return null;
  // A white page under it: a transparent one turns black as a JPEG.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  // `print`, not the default `display`: pdf.js paces a display render on
  // animation frames, which a tab in the background never gets, so the read
  // stopped on the table's page until the tab came back to the front. A
  // picture to send is a printout in all but name.
  await page.render({ canvas, canvasContext: context, viewport, intent: "print" }).promise;
  const url = canvas.toDataURL("image/jpeg", 0.8);
  return url.startsWith("data:image/jpeg;base64,") ? url.slice("data:image/jpeg;base64,".length) : null;
}

/** Too many pages to be a program; said before a single page is read. */
export class TooManyPagesError extends Error {
  constructor(readonly pageCount: number) {
    super(`The PDF has ${pageCount} pages`);
    this.name = "TooManyPagesError";
  }
}

/** The most words kept from one page — the schema's limit, never reached by a real page. */
const PAGE_TEXT_LIMIT = 40_000;
const PAGE_LINK_LIMIT = 100;

export async function readProgramPdf(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<ReadProgram> {
  const lib = await loadPdfjs();
  // pdf.js transfers what it is given to its worker; `file` stays a file.
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    if (doc.numPages > DRAFT_PAGE_LIMIT) throw new TooManyPagesError(doc.numPages);
    const pages: ReadPage[] = [];
    const pictures: PagePicture[] = [];
    const allLinks = new Set<string>();
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str;
        text += item.hasEOL ? "\n" : " ";
      }
      const links: string[] = [];
      for (const annotation of await page.getAnnotations()) {
        const url: unknown = annotation.url;
        if (annotation.subtype === "Link" && typeof url === "string" && !links.includes(url)) {
          links.push(url);
          allLinks.add(url);
        }
      }
      if (pictures.length < DRAFT_PICTURE_LIMIT && pointsToPicture(text)) {
        try {
          if (await drawsImage(page, lib)) {
            const jpeg = await pictureOf(page);
            // One too large to carry stays here; the page's words still go.
            if (jpeg && pictureFits(pictures, jpeg)) pictures.push({ n, jpeg });
          }
        } catch {
          // A page the browser cannot draw is still read for its words.
        }
      }
      page.cleanup();
      pages.push({
        n,
        text: text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, PAGE_TEXT_LIMIT),
        links: links.slice(0, PAGE_LINK_LIMIT),
      });
      onProgress?.(n, doc.numPages);
    }
    return { pageCount: doc.numPages, pages, linkCount: allLinks.size, pictures };
  } finally {
    await task.destroy();
  }
}
