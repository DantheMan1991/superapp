import { Paperclip } from "lucide-react";
import {
  formatBytes,
  isDisplayableImage,
  sanitizeFileName,
} from "@/lib/feedback/attachments";
import type { ThreadAttachment } from "@/lib/feedback/read";

/**
 * What came with a message, on both surfaces.
 *
 * A picture is SHOWN, not linked: the whole reason somebody attached a
 * screenshot is so that whoever reads the thread can see it without deciding
 * to. Anything else — a PDF — is a link with its size beside it, because a
 * download that starts on its own is a worse surprise than a click.
 *
 * Every `src` points at `/api/feedback/attachments/[id]`, which re-checks
 * authorization on the way through. The blob store is private and nothing here
 * holds a URL that would work without a session; an `<img>` on this page is an
 * authenticated request like any other.
 *
 * A plain `<img>` rather than `next/image`: these are arbitrary user uploads
 * behind an authenticated route, so the optimizer cannot fetch them and
 * `unoptimized` would leave the component paying for machinery it does not
 * use.
 */
export function AttachmentList({
  attachments,
}: {
  attachments: readonly ThreadAttachment[];
}) {
  if (attachments.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {attachments.map((file) => {
        const href = `/api/feedback/attachments/${file.id}`;
        const name = sanitizeFileName(file.fileName);
        if (isDisplayableImage(file.mimeType)) {
          return (
            <li key={file.id}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={`${name} · ${formatBytes(file.byteSize)}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={href}
                  alt={name}
                  loading="lazy"
                  className="h-28 w-auto max-w-full rounded-md border border-border object-cover"
                />
              </a>
            </li>
          );
        }
        return (
          <li key={file.id}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
            >
              <Paperclip className="size-3.5 text-muted-foreground" />
              <span className="max-w-[16rem] truncate">{name}</span>
              <span className="text-muted-foreground">
                {formatBytes(file.byteSize)}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
