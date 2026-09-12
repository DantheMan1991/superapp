"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { CalendarClock, Check, Copy, Crosshair, Download, ImageOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/app/panel";
import { useConfirm } from "@/components/app/use-confirm";
import { channelTitle } from "@/lib/social/channels";
import {
  bodyLimitFor,
  cropOverlay,
  defaultShapeFor,
  isPostShape,
  POST_SHAPES,
  POST_STATUS_LABELS,
  sameFocus,
  SHAPE_HINTS,
  SHAPE_LABELS,
  type PostShape,
  type PostStatus,
} from "@/lib/social/posts";
import { SOCIAL_NETWORK_LABELS, type SocialNetwork } from "@/lib/sites/links";
import { cn } from "@/lib/utils";
import {
  deletePostAction,
  markPostedAction,
  savePostAction,
  schedulePostAction,
  unschedulePostAction,
  type PostView,
} from "../post-actions";
import { memberPhotoSrc } from "./photo-picker";

/**
 * Finishing one post (slice S1): the words, the picture, and when.
 *
 * **THE ACCOUNT CANNOT BE CHANGED HERE.** A post is written for one account's
 * readers, at that network's length, cut to the shape that network shows —
 * change the account and every one of those is wrong in a way nothing on the
 * screen would flag. Writing the same thing for a second account is a second
 * post, which is the design (`src/lib/social/posts.ts`).
 *
 * **NOTHING PUBLISHES.** `Copy the words` and `Save the picture` are the
 * handover; `I posted it` records a claim the person made afterwards.
 */
export interface PostEditorProps {
  post: PostView;
  /** The photos this brand may use, with their real pixels for the crop maths. */
  library: { id: string; width: number; height: number }[];
  /** Where photos are added, when this brand has a website. Null hides the offer. */
  photosHref: string | null;
  timezone: string;
  canWrite: boolean;
}

/** `datetime-local` wants the wall clock in the tenant's zone, not the browser's. */
function toLocalInput(iso: string | null, timezone: string): string {
  const at = iso ? new Date(iso) : new Date(Date.now() + 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/**
 * The wall clock the owner typed, read in the TENANT'S zone rather than the
 * browser's.
 *
 * An owner on holiday in another country still schedules for the farm's
 * morning, which is what they mean. Done by measuring the zone's offset at
 * that instant and correcting — `Date.parse` on a naive string uses the
 * browser's zone, and that difference is silent and wrong by hours.
 */
function fromLocalInput(value: string, timezone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const asUtc = new Date(`${value}:00Z`);
  if (Number.isNaN(asUtc.getTime())) return null;
  const shown = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(asUtc);
  const get = (type: string) => Number(shown.find((p) => p.type === type)?.value ?? "0");
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(asUtc.getTime() * 2 - asIfUtc);
}

export function PostEditor({ post, library, photosHref, timezone, canWrite }: PostEditorProps) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [pending, startTransition] = useTransition();

  const network = post.network as SocialNetwork;
  const [body, setBody] = useState(post.body);
  const [link, setLink] = useState(post.link);
  const [imageId, setImageId] = useState<string | null>(post.imageId);
  const [shape, setShape] = useState<PostShape>(
    isPostShape(post.shape) ? post.shape : defaultShapeFor(network),
  );
  const [focus, setFocus] = useState({ x: post.focusX, y: post.focusY });
  const [when, setWhen] = useState(() => toLocalInput(post.scheduledAt, timezone));

  const limit = bodyLimitFor(network);
  const over = body.length > limit;
  const chosen = useMemo(() => library.find((p) => p.id === imageId) ?? null, [library, imageId]);
  const dirty =
    body !== post.body ||
    link !== post.link ||
    imageId !== post.imageId ||
    shape !== post.shape ||
    // NOT `!==`: the focus goes out as float64 and comes back as float4, so an
    // exact comparison is true forever after the first save. See `sameFocus`.
    !sameFocus(focus, { x: post.focusX, y: post.focusY });

  function run(work: () => Promise<{ ok: true } | { error: string }>, done: string) {
    startTransition(async () => {
      const result = await work();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(done);
      router.refresh();
    });
  }

  function save() {
    run(
      () =>
        savePostAction({
          id: post.id,
          body,
          link,
          imageId,
          shape,
          focusX: focus.x,
          focusY: focus.y,
        }),
      "Saved.",
    );
  }

  async function copyWords() {
    try {
      await navigator.clipboard.writeText(body);
      toast.success("Copied. Paste it where you post.");
    } catch {
      toast.error("Your browser wouldn't let Yosher copy. Select the words and copy them yourself.");
    }
  }

  const status = post.status as PostStatus;

  return (
    <div className="space-y-6">
      {confirmDialog}

      <Panel className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">
            {channelTitle({ network, handle: post.handle, label: post.label })}
          </span>
          <div className="flex items-center gap-2">
            {post.remindedAt && status === "scheduled" && (
              <Badge>Time to post</Badge>
            )}
            <Badge variant={status === "posted" ? "secondary" : "outline"}>
              {POST_STATUS_LABELS[status]}
            </Badge>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="post-body">What it says</Label>
          <Textarea
            id="post-body"
            value={body}
            rows={8}
            disabled={!canWrite}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write it the way you would say it."
          />
          <p className={cn("text-xs", over ? "text-destructive" : "text-muted-foreground")}>
            {body.length.toLocaleString()} of {limit.toLocaleString()} characters
            {over
              ? ` — ${SOCIAL_NETWORK_LABELS[network]} will not take this many.`
              : ""}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="post-link">A link to include (optional)</Label>
          <Input
            id="post-link"
            value={link}
            maxLength={500}
            disabled={!canWrite}
            placeholder="/shop"
            className="font-mono text-sm"
            onChange={(e) => setLink(e.target.value)}
          />
        </div>

        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={pending || over || !dirty} onClick={save}>
              Save
            </Button>
            <Button variant="outline" disabled={body.trim() === ""} onClick={copyWords}>
              <Copy className="size-4" /> Copy the words
            </Button>
          </div>
        )}
      </Panel>

      <Panel className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-base font-semibold tracking-heading">The picture</h2>
          {photosHref && (
            <Button asChild variant="ghost" size="sm">
              <Link href={photosHref}>Add photos</Link>
            </Button>
          )}
        </div>

        {library.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {photosHref
              ? "This brand's website has no photos yet. Add some, and they can go on a post."
              : "Photos live with a website. Build one for this brand, and its photos can go on a post."}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {library.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  disabled={!canWrite}
                  aria-pressed={imageId === photo.id}
                  onClick={() => {
                    setImageId(photo.id);
                    // A photo just chosen gets this network's usual shape and
                    // the middle of the picture, which is right often enough
                    // that most posts need no second decision.
                    setShape(defaultShapeFor(network));
                    setFocus({ x: 0.5, y: 0.5 });
                  }}
                  className={cn(
                    "size-16 overflow-hidden rounded-lg outline-none ring-offset-2 focus-visible:ring-3 focus-visible:ring-ring/50",
                    imageId === photo.id ? "ring-2 ring-module-accent" : "opacity-80 hover:opacity-100",
                  )}
                >
                  {/* Member route, private by definition; the optimiser has no business here. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={memberPhotoSrc(photo.id)} alt="" className="size-full object-cover" />
                </button>
              ))}
              {imageId && canWrite && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-16"
                  onClick={() => setImageId(null)}
                >
                  <ImageOff className="size-4" /> No picture
                </Button>
              )}
            </div>

            {chosen && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {POST_SHAPES.map((s) => (
                    <Button
                      key={s}
                      variant={shape === s ? "default" : "outline"}
                      size="sm"
                      disabled={!canWrite}
                      onClick={() => setShape(s)}
                    >
                      {SHAPE_LABELS[s]}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{SHAPE_HINTS[shape]}</p>

                {/*
                  TAP WHERE IT MATTERS. A focus point rather than a drag box:
                  one gesture on a phone, and it cannot describe a crop outside
                  the picture. The arrow keys nudge it, so this is not a
                  mouse-only control.
                */}
                <div className="space-y-2">
                  <Label htmlFor="post-focus">Tap the part that matters</Label>
                  <button
                    id="post-focus"
                    type="button"
                    disabled={!canWrite}
                    className="relative block w-full max-w-md overflow-hidden rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    onClick={(e) => {
                      const box = e.currentTarget.getBoundingClientRect();
                      setFocus({
                        x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
                        y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
                      });
                    }}
                    onKeyDown={(e) => {
                      const step = 0.05;
                      const moves: Record<string, [number, number]> = {
                        ArrowLeft: [-step, 0],
                        ArrowRight: [step, 0],
                        ArrowUp: [0, -step],
                        ArrowDown: [0, step],
                      };
                      const move = moves[e.key];
                      if (!move) return;
                      e.preventDefault();
                      setFocus((f) => ({
                        x: Math.min(1, Math.max(0, f.x + move[0])),
                        y: Math.min(1, Math.max(0, f.y + move[1])),
                      }));
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={memberPhotoSrc(chosen.id)} alt="" className="block w-full" />
                    {/*
                      ONE ELEMENT DIMS EVERYTHING OUTSIDE THE BOX: a spread
                      shadow large enough to cover any photo, clipped by the
                      parent's `overflow-hidden`. The alternative — a cut-out
                      drawn from a second copy of the image — needs the crop in
                      pixels on the client and gets it wrong the moment the
                      preview is scaled.
                    */}
                    <span
                      className="pointer-events-none absolute border-2 border-white"
                      style={{
                        ...cropOverlay(chosen, shape, focus),
                        boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                      }}
                      aria-hidden
                    />
                  </button>
                  {canWrite && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setFocus({ x: 0.5, y: 0.5 })}
                    >
                      <Crosshair className="size-4" /> Back to the middle
                    </Button>
                  )}
                </div>

                {post.imageId && !dirty && (
                  <Button asChild variant="outline">
                    <a href={`/api/marketing/social/posts/${post.id}/image?download=1`} download>
                      <Download className="size-4" /> Save the picture
                    </a>
                  </Button>
                )}
                {dirty && (
                  <p className="text-xs text-muted-foreground">
                    Save first, then the picture can be downloaded as it will look.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </Panel>

      {canWrite && (
        <Panel className="space-y-4 p-4">
          <h2 className="font-heading text-base font-semibold tracking-heading">When</h2>
          {status === "posted" ? (
            <p className="text-sm text-muted-foreground">
              Marked posted{" "}
              {post.postedAt
                ? new Intl.DateTimeFormat("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: timezone,
                  }).format(new Date(post.postedAt))
                : ""}
              .
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-2">
                <Label htmlFor="post-when">Put it on the calendar</Label>
                <Input
                  id="post-when"
                  type="datetime-local"
                  step={600}
                  value={when}
                  className="w-56"
                  onChange={(e) => setWhen(e.target.value)}
                />
              </div>
              <Button
                disabled={pending || body.trim() === ""}
                onClick={() => {
                  const at = fromLocalInput(when, timezone);
                  if (!at) {
                    toast.error("Pick a date and a time for it to go out.");
                    return;
                  }
                  run(
                    () => schedulePostAction({ id: post.id, at: at.toISOString() }),
                    "On the calendar. Yosher will remind you.",
                  );
                }}
              >
                <CalendarClock className="size-4" />
                {status === "scheduled" ? "Change the time" : "Schedule it"}
              </Button>
              {status === "scheduled" && (
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    run(() => unschedulePostAction({ id: post.id }), "Off the calendar.")
                  }
                >
                  Take it off
                </Button>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Times round to the nearest ten minutes, which is how often Yosher checks. It cannot
            post for you — it reminds you, in What needs you.
          </p>
          <div className="flex flex-wrap items-center gap-2 border-t border-divider pt-4">
            {status !== "posted" && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => run(() => markPostedAction({ id: post.id }), "Marked posted.")}
              >
                <Check className="size-4" /> I posted it
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={pending}
              onClick={async () => {
                const yes = await confirm({
                  title: "Delete this post?",
                  description:
                    "The words and the choice of picture go. The photo itself stays in your library.",
                  confirmLabel: "Delete",
                  destructive: true,
                });
                if (!yes) return;
                startTransition(async () => {
                  const result = await deletePostAction({ id: post.id });
                  if ("error" in result) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success("Deleted.");
                  router.push("/dashboard/m/marketing/social");
                });
              }}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
