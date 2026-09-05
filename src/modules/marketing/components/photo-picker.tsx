"use client";
import { useRef, useState, useTransition } from "react";
import { uploadPresigned } from "@vercel/blob/client";
import { ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ImageRef } from "@/lib/sites/schema";
import { deleteSitePhotoAction, registerSitePhotoAction, type SitePhotoView } from "../image-actions";

/**
 * Choosing a photo for a section: the one the section has, its alt text,
 * and a dialog over the site's library where photos are picked, uploaded
 * and removed. The library is the editor's state, handed down so every
 * section's picker shows the same list without a round trip.
 *
 * Limits are the server's (`src/lib/sites/photo.ts`); the numbers repeated
 * here are the words the person reads before the upload starts.
 */
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";
const PHOTO_MAX_BYTES = 12 * 1024 * 1024;

/** The member route: a photo for people signed in to its tenant. */
export function memberPhotoSrc(id: string): string {
  return `/api/marketing/sites/images/${id}`;
}

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function PhotoField({
  idPrefix,
  label,
  hint,
  tenantId,
  value,
  onChange,
  library,
  onLibraryChange,
}: {
  idPrefix: string;
  label: string;
  hint?: string;
  tenantId: string;
  value: ImageRef | null;
  onChange: (next: ImageRef | null) => void;
  library: SitePhotoView[];
  onLibraryChange: (next: SitePhotoView[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = value ? library.find((p) => p.id === value.id) : undefined;
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {value ? (
        <div className="flex flex-wrap items-start gap-4 rounded-xl bg-muted/50 p-3">
          {/* Member route, private by definition; the optimiser has no business here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={memberPhotoSrc(value.id)}
            alt=""
            className="h-24 w-32 rounded-lg object-cover"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-xs text-muted-foreground">
              {current ? `${current.width} × ${current.height}` : "This photo is no longer in the library."}
            </p>
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-alt`}>Describe the photo</Label>
              <Input
                id={`${idPrefix}-alt`}
                value={value.alt}
                maxLength={160}
                placeholder="What is in the picture, for people who can't see it"
                onChange={(e) => onChange({ ...value, alt: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
                <ImagePlus className="size-4" />
                Change photo
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
                <Trash2 className="size-4" />
                Remove
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            <ImagePlus className="size-4" />
            Add a photo
          </Button>
        </div>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <PhotoLibraryDialog
        open={open}
        onOpenChange={setOpen}
        tenantId={tenantId}
        library={library}
        onLibraryChange={onLibraryChange}
        selectedId={value?.id ?? null}
        onPick={(id) => {
          onChange({ id, alt: value?.alt ?? "" });
          setOpen(false);
        }}
        onRemoved={(id) => {
          if (value?.id === id) onChange(null);
        }}
      />
    </div>
  );
}

function PhotoLibraryDialog({
  open,
  onOpenChange,
  tenantId,
  library,
  onLibraryChange,
  selectedId,
  onPick,
  onRemoved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  library: SitePhotoView[];
  onLibraryChange: (next: SitePhotoView[]) => void;
  selectedId: string | null;
  onPick: (id: string) => void;
  onRemoved: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > PHOTO_MAX_BYTES) {
      toast.error("That photo is over 12MB. Export it smaller and try again.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setBusy(true);
    try {
      const blob = await uploadPresigned(`sites/${tenantId}/photos/${file.name}`, file, {
        access: "private",
        handleUploadUrl: "/api/marketing/sites/upload",
      });
      const result = await registerSitePhotoAction({ pathname: blob.pathname });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      if (result.data) {
        onLibraryChange([...library, result.data]);
        toast.success("Photo added.");
        onPick(result.data.id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The upload didn't finish. Try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function remove(photo: SitePhotoView) {
    if (
      !window.confirm(
        "Remove this photo from the site? It disappears from every page that shows it once you publish.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteSitePhotoAction({ id: photo.id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      onLibraryChange(library.filter((p) => p.id !== photo.id));
      onRemoved(photo.id);
      toast.success("Photo removed.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Your site&apos;s photos</DialogTitle>
          <DialogDescription>
            Click a photo to use it. JPEG, PNG or WebP, up to 12MB; Yosher resizes it for the web and
            strips the camera&apos;s data. Up to 60 photos.
          </DialogDescription>
        </DialogHeader>
        {library.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No photos yet. Upload one to start.
          </p>
        ) : (
          <ul className="grid max-h-[50vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {library.map((photo) => (
              <li key={photo.id} className="relative">
                <button
                  type="button"
                  className={`block w-full overflow-hidden rounded-xl ring-2 ${
                    photo.id === selectedId ? "ring-primary" : "ring-transparent hover:ring-border"
                  }`}
                  onClick={() => onPick(photo.id)}
                  aria-label={`Use this photo, ${photo.width} by ${photo.height}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={memberPhotoSrc(photo.id)} alt="" className="aspect-[4/3] w-full object-cover" />
                </button>
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {photo.width} × {photo.height} · {sizeLabel(photo.bytes)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    aria-label="Remove this photo from the site"
                    onClick={() => remove(photo)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter className="sm:justify-between">
          <input ref={inputRef} type="file" accept={PHOTO_ACCEPT} className="hidden" onChange={onFile} />
          <Button
            type="button"
            variant="outline"
            disabled={busy || library.length >= 60}
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus className="size-4" />
            {busy ? "Uploading…" : "Upload a photo"}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
