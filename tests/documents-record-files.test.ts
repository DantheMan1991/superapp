import { describe, expect, it } from "vitest";
import { splitAttachments } from "../src/modules/documents/attachments";

/**
 * The split a record's gallery makes (documents build log 2026-09-15): what
 * is a photo and what is a file, each in the serialisable shape the gallery
 * takes. Pure, so it is pinned here — the wrong side of the split is a file
 * nobody can see.
 */
const row = (over: {
  id: string;
  mimeType: string;
  title?: string;
  fileName?: string;
  sizeBytes?: number;
  isPrimary?: boolean;
}) => ({
  document: {
    id: over.id,
    fileName: over.fileName ?? `${over.id}.bin`,
    title: over.title ?? "",
    mimeType: over.mimeType,
    sizeBytes: over.sizeBytes ?? 1,
  },
  isPrimary: over.isPrimary ?? false,
});

describe("a record's files", () => {
  it("puts displayable images among the photos and everything else among the files, keeping the picture flag and the size", () => {
    const { photos, files } = splitAttachments([
      row({ id: "p1", mimeType: "image/jpeg", title: "Front", isPrimary: true }),
      row({ id: "w1", mimeType: "application/pdf", fileName: "waiver.pdf", sizeBytes: 48_213 }),
      row({ id: "p2", mimeType: "image/png" }),
      row({ id: "s1", mimeType: "text/csv", fileName: "takeoff.csv", sizeBytes: 900 }),
    ]);
    expect(photos.map((p) => [p.documentId, p.isPrimary, p.title])).toEqual([
      ["p1", true, "Front"],
      ["p2", false, ""],
    ]);
    expect(files.map((f) => [f.documentId, f.fileName, f.sizeBytes])).toEqual([
      ["w1", "waiver.pdf", 48_213],
      ["s1", "takeoff.csv", 900],
    ]);
    // A photo carries no size and a file no picture flag: the two shapes are the gallery's.
    expect(Object.keys(photos[0]).sort()).toEqual(["documentId", "fileName", "isPrimary", "mimeType", "title"]);
    expect(Object.keys(files[0]).sort()).toEqual(["documentId", "fileName", "mimeType", "sizeBytes", "title"]);
  });

  it("is empty both ways with nothing attached, and an SVG is a file, not a photo", () => {
    expect(splitAttachments([])).toEqual({ photos: [], files: [] });
    // The inline-safe list decides; a type the browser would render but the
    // cabinet will not serve inline is a file.
    const { photos, files } = splitAttachments([row({ id: "v", mimeType: "image/svg+xml" })]);
    expect(photos).toEqual([]);
    expect(files.map((f) => f.documentId)).toEqual(["v"]);
  });
});
