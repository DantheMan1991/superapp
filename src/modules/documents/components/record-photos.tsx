"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Star, X } from "lucide-react";
// uploadPresigned, NOT upload — the store is PRIVATE and rejects classic client
// tokens outright. Same trap document-controls.tsx records at its own import.
import { uploadPresigned } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";
import {
  IMAGE_ACCEPT_ATTR,
  MAX_FILE_BYTES,
  isAllowedUpload,
  isDisplayableImage,
} from "../allowlist";

/** One photo on a record, as a screen needs it. All serialisable. */
export interface RecordPhoto {
  documentId: string;
  fileName: string;
  title: string;
  mimeType: string;
  isPrimary: boolean;
}

type Result = { ok?: true } | { error: string };

/**
 * **THE PHOTOS OF A THING** — a gallery, a profile picture, and the button that
 * adds one. Shared by every pack, which is why it knows the name of none of
 * them.
 *
 * **THE ACTIONS ARE PROPS, and that is the architecture rather than a
 * convenience.** Each pack owns its own action, so the pack's module gate runs
 * before anything is written and the entity type is named by the code that owns
 * it rather than taken from the browser. A single generic action here would have
 * to decide whether to trust an `extensionSlug` the client sent, which is a
 * permission check written in the wrong place. Server actions are the one
 * function shape allowed across this boundary — see conventions §9.
 */
export function RecordPhotos({
  entityId,
  tenantId,
  photos,
  canEdit,
  subject,
  attachAction,
  setPrimaryAction,
  detachAction,
}: {
  entityId: string;
  /** The blob namespace to upload into. Re-checked server-side at both ends. */
  tenantId: string;
  photos: RecordPhoto[];
  canEdit: boolean;
  /** What this is a photo OF, in the tenant's own word: "animal", "asset". */
  subject: string;
  attachAction: (input: {
    entityId: string;
    pathname: string;
  }) => Promise<Result>;
  setPrimaryAction: (input: {
    entityId: string;
    documentId: string;
  }) => Promise<Result>;
  detachAction: (input: {
    entityId: string;
    documentId: string;
  }) => Promise<Result>;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    let ok = 0;
    try {
      for (const file of Array.from(files)) {
        // A courtesy check that saves a round trip. The server re-reads the
        // blob and re-hashes the bytes, so nothing here is trusted.
        if (!isDisplayableImage(file.type) || !isAllowedUpload(file.type, file.size)) {
          toast.error(
            `${file.name}: photos only, up to ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB`,
          );
          continue;
        }
        const blob = await uploadPresigned(
          `docs/${tenantId}/files/${file.name}`,
          file,
          { access: "private", handleUploadUrl: "/api/documents/blob/upload" },
        );
        const result = await attachAction({
          entityId,
          pathname: blob.pathname,
        });
        if ("error" in result) {
          toast.error(`${file.name}: ${result.error}`);
          continue;
        }
        ok += 1;
      }
      if (ok > 0) {
        toast.success(ok === 1 ? "Photo added" : `${ok} photos added`);
        router.refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function run(fn: () => Promise<Result>, done: string) {
    startTransition(async () => {
      const result = await fn();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(done);
      router.refresh();
    });
  }

  const working = busy || pending;

  return (
    <div className="space-y-3">
      {canEdit && (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={IMAGE_ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => void onFiles(e.target.files)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={working}
            onClick={() => inputRef.current?.click()}
          >
            <Camera className="size-4" />
            {busy ? "Uploading…" : "Add a photo"}
          </Button>
        </>
      )}

      {photos.length === 0 ? (
        <EmptyState
          icon={<Camera />}
          title="No photos yet"
          description={`The first one becomes the picture of this ${subject}. A series over time shows the gradual change that a day-to-day look never does.`}
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((photo) => (
            <li key={photo.documentId} className="group/photo relative">
              <a
                href={`/api/documents/${photo.documentId}/file`}
                className="block overflow-hidden rounded-lg border bg-muted"
              >
                {/* Same-origin and authenticated, exactly like opening the
                    file. `loading="lazy"` because these are the ORIGINALS —
                    there is no rasterizer, which is the honest cost the file
                    tiles already record. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/documents/${photo.documentId}/file`}
                  alt={photo.title || photo.fileName}
                  loading="lazy"
                  decoding="async"
                  className="aspect-square size-full object-cover"
                />
              </a>

              {photo.isPrimary && (
                <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium shadow-sm">
                  <Star className="size-3 fill-current" />
                  Picture
                </span>
              )}

              {canEdit && (
                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover/photo:opacity-100 focus-within:opacity-100">
                  {!photo.isPrimary && (
                    <Button
                      size="icon"
                      variant="secondary"
                      className="size-7"
                      title={`Make this the picture of this ${subject}`}
                      aria-label={`Make this the picture of this ${subject}`}
                      disabled={working}
                      onClick={() =>
                        run(
                          () =>
                            setPrimaryAction({
                              entityId,
                              documentId: photo.documentId,
                            }),
                          "Picture set",
                        )
                      }
                    >
                      <Star className="size-3.5" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="secondary"
                    className="size-7"
                    title="Remove from this record"
                    aria-label="Remove from this record"
                    disabled={working}
                    onClick={() =>
                      run(
                        () =>
                          detachAction({
                            entityId,
                            documentId: photo.documentId,
                          }),
                        "Photo removed — the file is still in Documents",
                      )
                    }
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The profile picture at list size, or a placeholder.
 *
 * **A record with photos but no chosen picture gets the placeholder**, not the
 * newest photo — picking one is exactly what the primary flag exists to stop the
 * app doing on somebody's behalf.
 */
export function RecordPhotoThumb({
  documentId,
  alt,
  className,
}: {
  documentId: string | null;
  alt: string;
  className?: string;
}) {
  const base =
    className ??
    "size-9 shrink-0 overflow-hidden rounded-md border bg-muted object-cover";
  if (!documentId) {
    return (
      <div
        className={`${base} flex items-center justify-center`}
        aria-hidden="true"
      >
        <Camera className="size-4 text-muted-foreground/60" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/documents/${documentId}/file`}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={base}
    />
  );
}
