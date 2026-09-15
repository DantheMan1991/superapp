"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, FileText, FolderOpen, ImagePlus, Loader2, Paperclip, Search, Star, X } from "lucide-react";
// uploadPresigned, NOT upload — the store is PRIVATE and rejects classic client
// tokens outright. Same trap document-controls.tsx records at its own import.
import { uploadPresigned } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/app/empty-state";
import {
  IMAGE_ACCEPT_ATTR,
  MAX_FILE_BYTES,
  UPLOAD_ACCEPT_ATTR,
  isAllowedUpload,
  isDisplayableImage,
} from "../allowlist";
import { fileKindLabel } from "../lib/view-mode";
import { formatBytes } from "../lib/format";
import { pickDocumentsAction, type PickableDocument } from "../picker-actions";

/** One photo on a record, as a screen needs it. All serialisable. */
export interface RecordPhoto {
  documentId: string;
  fileName: string;
  title: string;
  mimeType: string;
  isPrimary: boolean;
}

/** One file on a record that is not a photo — a PDF, a spreadsheet. All serialisable. */
export interface RecordFile {
  documentId: string;
  fileName: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
}

type Result = { ok?: true } | { error: string };

/**
 * **THE PHOTOS — AND THE FILES — OF A THING**: a gallery, a profile picture,
 * the buttons that add one, and since the lien waiver slice two more doors:
 * upload any allowed file, or pick one already in the cabinet. Shared by
 * every pack, which is why it knows the name of none of them.
 *
 * **THE ACTIONS ARE PROPS, and that is the architecture rather than a
 * convenience.** Each pack owns its own action, so the pack's module gate runs
 * before anything is written and the entity type is named by the code that owns
 * it rather than taken from the browser. A single generic action here would have
 * to decide whether to trust an `extensionSlug` the client sent, which is a
 * permission check written in the wrong place. Server actions are the one
 * function shape allowed across this boundary — see conventions §9.
 *
 * The two file doors are optional props: a pack that passes neither gets the
 * gallery exactly as it was. The SEARCH behind "From Documents" is this
 * module's own action, because reading the cabinet is the cabinet's business;
 * the attach that follows is the pack's.
 */
export function RecordPhotos({
  entityId,
  tenantId,
  photos,
  files = [],
  canEdit,
  subject,
  attachAction,
  setPrimaryAction,
  detachAction,
  attachFileAction,
  attachExistingAction,
}: {
  entityId: string;
  /** The blob namespace to upload into. Re-checked server-side at both ends. */
  tenantId: string;
  photos: RecordPhoto[];
  /** The record's other files, when the pack shows them. */
  files?: RecordFile[];
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
  /** Upload any allowed file — a PDF that came by email — and hang it on the record. Absent: photos only. */
  attachFileAction?: (input: {
    entityId: string;
    pathname: string;
  }) => Promise<Result>;
  /** Hang a file already in Documents on the record. Absent: no "From Documents" door. */
  attachExistingAction?: (input: {
    entityId: string;
    documentId: string;
  }) => Promise<Result>;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [picking, setPicking] = useState(false);

  async function onFiles(list: FileList | null, anyFile: boolean) {
    if (!list || list.length === 0) return;
    setBusy(true);
    let ok = 0;
    try {
      for (const file of Array.from(list)) {
        // A courtesy check that saves a round trip. The server re-reads the
        // blob and re-hashes the bytes, so nothing here is trusted.
        const allowed = anyFile
          ? isAllowedUpload(file.type, file.size)
          : isDisplayableImage(file.type) && isAllowedUpload(file.type, file.size);
        if (!allowed) {
          toast.error(
            `${file.name}: ${anyFile ? "that kind of file is not accepted" : "photos only"}, up to ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB`,
          );
          continue;
        }
        const blob = await uploadPresigned(
          `docs/${tenantId}/files/${file.name}`,
          file,
          { access: "private", handleUploadUrl: "/api/documents/blob/upload" },
        );
        const action = anyFile && attachFileAction ? attachFileAction : attachAction;
        const result = await action({ entityId, pathname: blob.pathname });
        if ("error" in result) {
          toast.error(`${file.name}: ${result.error}`);
          continue;
        }
        ok += 1;
      }
      if (ok > 0) {
        toast.success(
          anyFile ? (ok === 1 ? "File added" : `${ok} files added`) : ok === 1 ? "Photo added" : `${ok} photos added`,
        );
        router.refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
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
  const filesOn = attachFileAction !== undefined || attachExistingAction !== undefined;

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
            onChange={(e) => void onFiles(e.target.files, false)}
          />
          {/* A SECOND INPUT FOR THE CAMERA, the Inbox's pattern: `capture`
              asks the phone for the camera itself, but an input that carries
              it never offers the photo library, so the general one stays as
              it is and this one exists only below `md` — on a desk there is
              no camera worth asking for. Same `onFiles`, so a photo taken is
              registered exactly like one uploaded. */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void onFiles(e.target.files, false)}
          />
          {attachFileAction && (
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={UPLOAD_ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => void onFiles(e.target.files, true)}
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="md:hidden"
              disabled={working}
              onClick={() => cameraRef.current?.click()}
            >
              <Camera className="size-4" />
              Take photo
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={working}
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlus className="size-4" />
              {busy ? "Uploading…" : "Add a photo"}
            </Button>
            {attachFileAction && (
              <Button
                size="sm"
                variant="outline"
                disabled={working}
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip className="size-4" />
                Add a file
              </Button>
            )}
            {attachExistingAction && (
              <Button size="sm" variant="outline" disabled={working} onClick={() => setPicking(true)}>
                <FolderOpen className="size-4" />
                From Documents
              </Button>
            )}
          </div>
          {attachExistingAction && (
            <DocumentPicker
              open={picking}
              onOpenChange={setPicking}
              onPick={(documentId) =>
                run(() => attachExistingAction({ entityId, documentId }), "File attached")
              }
            />
          )}
        </>
      )}

      {photos.length === 0 && files.length === 0 ? (
        <EmptyState
          icon={filesOn ? <Paperclip /> : <Camera />}
          title={filesOn ? "Nothing attached yet" : "No photos yet"}
          description={
            filesOn
              ? `A photo of the page, a file from your computer, or one already in Documents — each hangs on this ${subject} and stays in the cabinet.`
              : `The first one becomes the picture of this ${subject}. A series over time shows the gradual change that a day-to-day look never does.`
          }
        />
      ) : (
        <>
          {photos.length > 0 && (
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

          {files.length > 0 && (
            <ul className="divide-y divide-border/50 rounded-lg border">
              {files.map((file) => (
                <li key={file.documentId} className="flex items-center gap-3 overflow-hidden px-3 py-2 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <a
                    href={`/api/documents/${file.documentId}/file`}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate underline-offset-2 hover:underline"
                  >
                    {file.title || file.fileName}
                  </a>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {fileKindLabel(file.mimeType, file.fileName)} · {formatBytes(file.sizeBytes)}
                  </span>
                  {canEdit && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0"
                      title="Remove from this record"
                      aria-label={`Remove ${file.title || file.fileName} from this record`}
                      disabled={working}
                      onClick={() =>
                        run(
                          () => detachAction({ entityId, documentId: file.documentId }),
                          "File removed — it is still in Documents",
                        )
                      }
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/**
 * "From Documents": the cabinet's own search, in a dialog, each hit with an
 * Attach button. Reads through this module's action; the pick is handed to
 * the pack's attach action by id, and nothing about the file is trusted from
 * here — the server reads the row again.
 */
function DocumentPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (documentId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PickableDocument[] | null>(null);

  // Debounced, so a search does not put a round trip behind each keystroke.
  // State moves only once the answer is back: the old hits stand until then,
  // and "Looking…" is the first load alone.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const result = await pickDocumentsAction({ q: query });
      if (cancelled) return;
      if ("error" in result) {
        toast.error(result.error);
        setHits([]);
      } else {
        setHits(result.hits);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Attach from Documents</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your files"
              aria-label="Search files"
              className="pl-8"
              autoFocus
            />
          </div>
          {hits === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Looking…
            </p>
          ) : hits.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {query.trim() ? "Nothing matches." : "Nothing in Documents yet."}
            </p>
          ) : (
            <ul className="max-h-80 divide-y divide-border/50 overflow-y-auto rounded-lg border">
              {hits.map((hit) => (
                <li key={hit.id} className="flex items-center gap-3 overflow-hidden px-3 py-2 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 overflow-hidden">
                    <span className="block truncate">{hit.title || hit.fileName}</span>
                    <span className="block text-xs text-muted-foreground">
                      {fileKindLabel(hit.mimeType, hit.fileName)} · {formatBytes(hit.sizeBytes)} ·{" "}
                      {hit.createdAt.slice(0, 10)}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => {
                      onPick(hit.id);
                      onOpenChange(false);
                    }}
                  >
                    Attach
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            The newest files first; type to search by name or by what is inside them. Attaching does not
            move the file.
          </p>
        </div>
      </DialogContent>
    </Dialog>
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
