"use client";

import { loadPdfjs } from "@/lib/pdf/browser";
import { DRAFT_PAGE_LIMIT, type ReadPage } from "../core/draft";

/**
 * READ A PROGRAM PDF WHERE IT IS: in the person's browser.
 *
 * Every page's words, and every link on it. The links matter as much as the
 * words: a program's videos are link annotations, not text — the founder's
 * PDF carries 29 videos that way and names none of them in its words. Only
 * these two things are sent on, to draft from; the file itself never leaves
 * the device. That is what lets a 19 MB book through a server action capped at
 * 4 MB, and it keeps somebody's bought program off our servers.
 */

export interface ReadProgram {
  pageCount: number;
  pages: ReadPage[];
  /** Distinct links across the whole file, for "Read 59 pages and 33 links". */
  linkCount: number;
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
      page.cleanup();
      pages.push({
        n,
        text: text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, PAGE_TEXT_LIMIT),
        links: links.slice(0, PAGE_LINK_LIMIT),
      });
      onProgress?.(n, doc.numPages);
    }
    return { pageCount: doc.numPages, pages, linkCount: allLinks.size };
  } finally {
    await task.destroy();
  }
}
