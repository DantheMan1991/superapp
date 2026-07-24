import { Readable } from "node:stream";
import archiver from "archiver";

/**
 * Streaming zip assembly for the full-books export. Memory rule: document
 * blobs are appended strictly one at a time — blob N+1 is opened only
 * after archiver finishes entry N — so at most one ~20MB blob is in
 * flight regardless of how many documents a tenant has.
 *
 * Mid-stream failure calls archive.abort(): the client receives a zip
 * with no central directory — unambiguously corrupt, never silently
 * partial (README documents the retry).
 */

export interface BooksZipInput {
  readme: string;
  manifestCsv: string;
  csvFiles: Array<{ zipPath: string; content: string }>;
  docs: Array<{ zipPath: string; blobPathname: string }>;
}

export function createBooksZipStream(
  input: BooksZipInput,
  fetchBlob: (pathname: string) => Promise<ReadableStream<Uint8Array> | null>,
): ReadableStream<Uint8Array> {
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("warning", (err) => console.warn("books export zip warning", err));
  archive.on("error", (err) => console.error("books export zip error", err));

  const entryFinished = (name: string): Promise<void> =>
    new Promise((resolve) => {
      const onEntry = (entry: { name: string }) => {
        if (entry.name === name) {
          archive.off("entry", onEntry);
          resolve();
        }
      };
      archive.on("entry", onEntry);
    });

  const pump = async (): Promise<void> => {
    archive.append(Buffer.from(input.readme, "utf8"), { name: "README.txt" });
    archive.append(Buffer.from(input.manifestCsv, "utf8"), {
      name: "manifest.csv",
    });
    for (const f of input.csvFiles) {
      archive.append(Buffer.from(f.content, "utf8"), { name: f.zipPath });
    }
    for (const d of input.docs) {
      let stream: ReadableStream<Uint8Array> | null = null;
      try {
        stream = await fetchBlob(d.blobPathname);
      } catch (err) {
        console.error(`books export: blob fetch failed for ${d.zipPath}`, err);
      }
      if (!stream) {
        // A missing blob must not sink the whole export — leave a marker.
        archive.append(
          Buffer.from(
            "This file could not be read at export time. Export again or download it from the app.\n",
            "utf8",
          ),
          { name: `${d.zipPath}.MISSING.txt` },
        );
        continue;
      }
      const done = entryFinished(d.zipPath);
      archive.append(Readable.fromWeb(stream as never), { name: d.zipPath });
      await done;
    }
    await archive.finalize();
  };

  pump().catch((err) => {
    console.error("books export failed mid-stream", err);
    archive.abort();
  });

  return Readable.toWeb(archive) as ReadableStream<Uint8Array>;
}
