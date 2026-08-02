"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ImageUp, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { InlineImage } from "../compose/inline";
import { INLINE_IMAGE_TYPES, MAX_INLINE_IMAGE_BYTES } from "../compose/inline";
import {
  insertImageFromSourceAction,
  searchInsertableImagesAction,
  type ImageSearchGroup,
} from "../image-actions";

/**
 * Where a picture comes from.
 *
 * TWO SOURCES, and the second is the one that matters. Uploading from the laptop
 * is what every composer does; inserting from the business's own files is the
 * thing this product can do that a webmail cannot, because the photograph
 * somebody wants in a quote is usually already in Documents and making them
 * download it first to attach it back is exactly the round trip a platform
 * exists to remove.
 *
 * Gmail offers a third — "Web Address (URL)" — and it is deliberately absent. A
 * remote `<img>` in an OUTBOUND message is a tracking pixel aimed at the person
 * you are writing to, it leaks whenever they open the mail, and it breaks the
 * day the URL stops resolving. `compose/html.ts` has no code path that copies a
 * `src`, so there would be nothing for this to hand it anyway.
 *
 * The Documents list is NOT filtered by this component. It comes back from the
 * extension seam under the caller's own transaction, so RLS has already removed
 * the owners-only folders somebody cannot see — there is no visibility predicate
 * here and there must not be one.
 */

const ACCEPT = INLINE_IMAGE_TYPES.join(",");

export function ImagePicker({
  accountId,
  mailboxId,
  onInsert,
  onClose,
}: {
  accountId: string;
  mailboxId: string;
  onInsert: (image: InlineImage) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"upload" | "library">("upload");
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<ImageSearchGroup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * Debounced, and the library is only ever loaded once the tab is opened —
   * a search on every keystroke would put a database round trip behind each
   * letter, and loading it up front would cost every composer a query for a
   * feature most messages never use.
   */
  useEffect(() => {
    if (tab !== "library") return;
    let cancelled = false;
    const timer = setTimeout(() => {
      startTransition(async () => {
        const result = await searchInsertableImagesAction(query);
        if (cancelled) return;
        if ("error" in result) {
          toast.error(result.error);
          setGroups([]);
          return;
        }
        setGroups(result.data);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, query]);

  const upload = useCallback(
    async (files: FileList) => {
      setBusy(true);
      try {
        for (const file of Array.from(files)) {
          if (!INLINE_IMAGE_TYPES.includes(file.type)) {
            // Named rather than silently skipped: somebody who picked a PDF
            // expecting it to appear in the body deserves to know why it did not.
            toast.error(`${file.name} is not an image we can put in a message.`);
            continue;
          }
          if (file.size > MAX_INLINE_IMAGE_BYTES) {
            toast.error(`${file.name} is too large to put in a message.`);
            continue;
          }
          // The same route attachments use, with one extra header. Straight to a
          // route handler rather than a server action, because Next caps an
          // action's body at 4 MB and that would silently become the limit.
          const response = await fetch(`/api/mail/${accountId}/upload`, {
            method: "POST",
            headers: {
              "Content-Type": file.type,
              "x-file-type": file.type,
              "x-file-name": file.name,
              "x-inline": "1",
            },
            body: file,
          });
          if (!response.ok) {
            const detail = await response.json().catch(() => null);
            toast.error(detail?.error ?? `Couldn't add ${file.name}.`);
            continue;
          }
          const blob = await response.json();
          if (!blob.inline) {
            toast.error(`${file.name} can't be shown in the message body.`);
            continue;
          }
          onInsert(blob as InlineImage);
        }
      } finally {
        setBusy(false);
        if (fileInput.current) fileInput.current.value = "";
        onClose();
      }
    },
    [accountId, onInsert, onClose],
  );

  const insertFromSource = useCallback(
    (extensionSlug: string, imageId: string) => {
      setBusy(true);
      startTransition(async () => {
        try {
          const result = await insertImageFromSourceAction({
            mailboxId,
            extensionSlug,
            imageId,
          });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          onInsert(result.data);
          onClose();
        } finally {
          setBusy(false);
        }
      });
    },
    [mailboxId, onInsert, onClose],
  );

  const working = busy || pending;

  return (
    <div className="w-[22rem] max-w-[80vw]">
      <div className="mb-2 flex gap-1">
        {(["upload", "library"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setTab(key)}
            className={cn(
              "rounded-sm px-2 py-1 text-xs",
              tab === key
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:bg-secondary/60",
            )}
          >
            {key === "upload" ? "Upload" : "From Documents"}
          </button>
        ))}
      </div>

      {tab === "upload" ? (
        <div className="rounded-md border border-dashed p-4 text-center">
          <ImageUp className="mx-auto size-5 text-muted-foreground" />
          <button
            type="button"
            disabled={working}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => fileInput.current?.click()}
            className="mt-2 rounded-sm border px-2.5 py-1 text-xs font-medium hover:bg-secondary disabled:opacity-50"
          >
            {working ? "Adding…" : "Choose a picture"}
          </button>
          <p className="mt-2 text-[0.7rem] text-muted-foreground">
            PNG, JPEG, GIF or WebP, up to{" "}
            {Math.round(MAX_INLINE_IMAGE_BYTES / (1024 * 1024))} MB.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) void upload(e.target.files);
            }}
          />
        </div>
      ) : (
        <div>
          <div className="relative mb-2">
            <Search className="absolute top-1.5 left-2 size-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your files"
              aria-label="Search files"
              className="h-7 w-full rounded-sm border bg-background pr-2 pl-7 text-xs outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {groups === null || (pending && groups.length === 0) ? (
              <p className="flex items-center gap-2 px-1 py-3 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Looking…
              </p>
            ) : groups.length === 0 ? (
              <p className="px-1 py-3 text-xs text-muted-foreground">
                {query.trim()
                  ? `No pictures match “${query.trim()}”.`
                  : "No pictures in your files yet."}
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.extensionSlug} className="mb-2">
                  <p className="px-1 pb-1 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
                    {group.label}
                  </p>
                  <ul>
                    {group.images.map((image) => (
                      <li key={image.id}>
                        <button
                          type="button"
                          disabled={working}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() =>
                            insertFromSource(group.extensionSlug, image.id)
                          }
                          className="flex w-full min-w-0 items-baseline gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-secondary disabled:opacity-50"
                        >
                          {/* min-w-0 on the flex child, or `truncate` has
                              nothing to truncate against and a long file name
                              pushes a scrollbar across the panel. */}
                          <span className="min-w-0 flex-1 truncate text-xs">
                            {image.label}
                          </span>
                          {image.sublabel && (
                            <span className="shrink-0 text-[0.65rem] text-muted-foreground">
                              {image.sublabel}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
