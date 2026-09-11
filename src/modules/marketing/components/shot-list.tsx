"use client";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { uploadPresigned } from "@vercel/blob/client";
import { Camera, ImagePlus, Images } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { SHAPE_LABELS, shotLine, shotSummary, type Spot } from "@/lib/sites/shots";
import { registerSitePhotoAction, type SitePhotoView } from "../image-actions";
import { placePhotoAction } from "../page-actions";
import { SuggestDescription } from "./assistant-controls";
import { memberPhotoSrc, PHOTO_ACCEPT, PhotoLibraryDialog } from "./photo-picker";

/**
 * The shot list (slice 18): every place on the pages where a photo
 * belongs, what to take there, and the photo put straight in. Built for
 * a phone in the field as much as a desk: `Take a photo` opens the
 * camera where there is one, and a row is one tap from filled. The list
 * is the pages read now (`src/lib/sites/shots.ts`); placing a photo saves
 * the page the way the editor does, with a version behind it.
 *
 * Rows keep what they placed as an override over the server's props, so
 * a placement shows at once and the refresh that follows agrees with it.
 */
const PHOTO_MAX_BYTES = 12 * 1024 * 1024;
const EDITOR = "/dashboard/m/marketing/website/pages";

export interface ShotPageView {
  id: string;
  path: string;
  title: string;
  spots: Spot[];
}

/** Open spots first, the optional ones after the wanted ones, the filled ones last; page order within each. */
function rank(spot: Spot): number {
  if (spot.status === "photo") return 2;
  return spot.optional ? 1 : 0;
}

const noop = () => () => {};
const hasTouch = () => navigator.maxTouchPoints > 0;
const noTouch = () => false;

export function ShotList({
  siteId,
  tenantId,
  canWrite,
  assistantOn,
  library: initialLibrary,
  starters,
  pages,
}: {
  siteId: string;
  tenantId: string;
  canWrite: boolean;
  assistantOn: boolean;
  library: SitePhotoView[];
  /** The ids of the platform's drawn stand-ins, so one picked from the library is still marked as one. */
  starters: string[];
  pages: ShotPageView[];
}) {
  const [library, setLibrary] = useState(initialLibrary);
  // A camera is offered only where there is likely to be one; the server renders without.
  const touch = useSyncExternalStore(noop, hasTouch, noTouch);
  const summary = shotSummary(pages.flatMap((p) => p.spots));

  return (
    <div className="space-y-6">
      <Panel className="p-5">
        <p className="text-sm">{shotLine(summary)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {canWrite
            ? "Open this on your phone, walk round, and tap Take a photo on each row. A photo goes into the page's draft at once; publish from the Website page when it reads right."
            : "Only an owner can add photos."}
        </p>
      </Panel>
      {pages.map((page) => (
        <section key={page.id} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-heading text-lg font-semibold tracking-heading">
              {page.title} <span className="text-sm font-normal text-muted-foreground">{page.path}</span>
            </h2>
            {canWrite && (
              <Link href={`${EDITOR}/${page.id}`} className="text-sm text-muted-foreground hover:text-foreground">
                Edit the page
              </Link>
            )}
          </div>
          {page.spots.length === 0 ? (
            <Panel className="p-5 text-sm text-muted-foreground">No place for a photo on this page.</Panel>
          ) : (
            <Panel className="divide-y divide-divider">
              {[...page.spots]
                .sort((a, b) => rank(a) - rank(b))
                .map((spot) => (
                  <SpotRow
                    key={spot.key}
                    siteId={siteId}
                    pageId={page.id}
                    spot={spot}
                    tenantId={tenantId}
                    canWrite={canWrite}
                    touch={touch}
                    assistantOn={assistantOn}
                    library={library}
                    onLibraryChange={setLibrary}
                    starters={starters}
                  />
                ))}
            </Panel>
          )}
        </section>
      ))}
    </div>
  );
}

function SpotRow({
  siteId,
  pageId,
  spot: fresh,
  tenantId,
  canWrite,
  touch,
  assistantOn,
  library,
  onLibraryChange,
  starters,
}: {
  siteId: string;
  pageId: string;
  spot: Spot;
  tenantId: string;
  canWrite: boolean;
  touch: boolean;
  assistantOn: boolean;
  library: SitePhotoView[];
  onLibraryChange: (next: SitePhotoView[]) => void;
  starters: string[];
}) {
  const router = useRouter();
  const [override, setOverride] = useState<Spot | null>(null);
  const spot = override ?? fresh;
  const image = spot.image;
  const [alt, setAlt] = useState(fresh.image?.alt ?? "");
  const [busy, setBusy] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const filled = spot.status === "photo";
  // The dashed box already says the shape; under it only what the box cannot.
  const caption = spot.status === "starter" ? "A drawn stand-in" : filled ? SHAPE_LABELS[spot.shape] : spot.optional ? "Optional" : null;
  const box = spot.shape === "wide" ? "aspect-[16/7]" : spot.shape === "square" ? "aspect-square" : "aspect-[4/3]";

  async function place(imageId: string, words: string, said: string): Promise<void> {
    const result = await placePhotoAction({ pageId, spot: spot.key, imageId, alt: words });
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    setOverride({ ...spot, status: starters.includes(imageId) ? "starter" : "photo", image: { id: imageId, alt: words } });
    setAlt(words);
    toast.success(said);
    router.refresh();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > PHOTO_MAX_BYTES) {
      toast.error("That photo is over 12MB. Export it smaller and try again.");
      input.value = "";
      return;
    }
    setBusy(true);
    try {
      const blob = await uploadPresigned(`sites/${tenantId}/photos/${file.name}`, file, {
        access: "private",
        handleUploadUrl: "/api/marketing/sites/upload",
      });
      const result = await registerSitePhotoAction({ siteId, pathname: blob.pathname });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      if (result.data) {
        onLibraryChange([...library, result.data]);
        await place(result.data.id, "", "Photo placed.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The upload didn't finish. Try again.");
    } finally {
      setBusy(false);
      input.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-4 p-5 sm:flex-row">
      <div className="w-full shrink-0 sm:w-40">
        {image ? (
          // Member route, private by definition; the optimiser has no business here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={memberPhotoSrc(image.id)} alt="" className={cn("w-full rounded-lg object-cover", box)} />
        ) : (
          <div
            className={cn(
              "flex w-full items-center justify-center rounded-lg border-2 border-dashed border-border text-xs text-muted-foreground",
              box,
            )}
          >
            {SHAPE_LABELS[spot.shape]}
          </div>
        )}
        {caption && <p className="mt-1 text-xs text-muted-foreground">{caption}</p>}
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <p className="font-medium">{spot.label}</p>
          <p className="text-xs text-muted-foreground">
            {spot.sectionLabel}
            {spot.heading && spot.heading !== spot.label ? `: ${spot.heading}` : ""}
          </p>
        </div>
        <p className="text-sm">
          {spot.status === "starter" ? `Yosher drew this one to hold the place. ${spot.note}` : spot.note}
        </p>
        {canWrite && filled && image && (
          <div className="space-y-1">
            <Label htmlFor={`alt-${pageId}-${spot.key}`}>Describe the photo</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id={`alt-${pageId}-${spot.key}`}
                value={alt}
                maxLength={160}
                placeholder="What is in the picture, for people who can't see it"
                className="min-w-0 flex-1"
                onChange={(e) => setAlt(e.target.value)}
              />
              {assistantOn && <SuggestDescription imageId={image.id} onSuggested={setAlt} />}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending || alt === image.alt}
                onClick={() => startTransition(() => place(image.id, alt, "Description saved."))}
              >
                Save description
              </Button>
            </div>
          </div>
        )}
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            {touch && (
              <Button
                type="button"
                variant={filled ? "ghost" : "outline"}
                size="sm"
                disabled={busy || pending}
                onClick={() => cameraRef.current?.click()}
              >
                <Camera className="size-4" />
                {busy ? "Uploading…" : "Take a photo"}
              </Button>
            )}
            <Button
              type="button"
              variant={filled || touch ? "ghost" : "outline"}
              size="sm"
              disabled={busy || pending}
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus className="size-4" />
              {busy && !touch ? "Uploading…" : touch ? "Choose from your phone" : "Upload a photo"}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy || pending} onClick={() => setLibraryOpen(true)}>
              <Images className="size-4" />
              From the library
            </Button>
            <input ref={cameraRef} type="file" accept={PHOTO_ACCEPT} capture="environment" className="hidden" onChange={onFile} />
            <input ref={fileRef} type="file" accept={PHOTO_ACCEPT} className="hidden" onChange={onFile} />
          </div>
        )}
      </div>
      {canWrite && (
        <PhotoLibraryDialog
          siteId={siteId}
          open={libraryOpen}
          onOpenChange={setLibraryOpen}
          tenantId={tenantId}
          library={library}
          onLibraryChange={onLibraryChange}
          selectedId={image?.id ?? null}
          onPick={(id) => {
            setLibraryOpen(false);
            startTransition(() => place(id, id === image?.id ? alt : "", "Photo placed."));
          }}
          onRemoved={(id) => {
            if (image?.id === id) setOverride({ ...spot, status: "empty", image: null });
          }}
        />
      )}
    </div>
  );
}
