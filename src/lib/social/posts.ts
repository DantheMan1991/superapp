import { SOCIAL_NETWORK_LABELS, type SocialNetwork } from "@/lib/sites/links";

/**
 * A POST — what goes to one account, once — decided in one pure,
 * dependency-free file (Marketing slice S1).
 *
 * **ONE POST IS ONE CHANNEL.** Not "a post with four networks ticked". The
 * calendar is then honest (one entry is one thing going to one place), an
 * edit for X's 280 characters cannot damage the Instagram wording, and when
 * S6 brings real connections a failure is one row's failure. Sending the same
 * idea to several accounts writes several rows, each editable — which is also
 * what stops the identical-text-everywhere pattern every network punishes.
 *
 * **NOTHING HERE POSTS.** S1 finishes a post and reminds the owner when it is
 * due; the owner copies the words, saves the picture and posts it themselves.
 * That is worth having with no app review from anybody, and it is the same
 * path S6 keeps — only the last step changes.
 */

export const POST_STATUSES = ["draft", "scheduled", "posted"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/**
 * `idea` IS NOT A STATUS, though the plan listed one.
 *
 * A draft with no time on it IS the idea, and a status nothing can produce is
 * dead weight in every switch that reads it — the shape that made five call
 * sites return a real-but-wrong value once already. When S4 starts proposing
 * posts from what the packs saw, those arrive as drafts too; what marks them
 * out is `origin`, below, which a reader can act on.
 */
export const POST_ORIGINS = ["hand", "assistant", "pack"] as const;
export type PostOrigin = (typeof POST_ORIGINS)[number];

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  posted: "Posted",
};

/** Our ceiling, not any network's. Room for the longest thing worth writing. */
export const POST_BODY_MAX = 5000;
export const POST_LINK_MAX = 500;

/**
 * What each network will actually take, capped at ours.
 *
 * The counter turns against the owner at the tighter of the two, so writing a
 * 900-character thought for X is refused by the FORM rather than by X. Real
 * network limits where they bite (X 280, Pinterest 500, Instagram and TikTok
 * 2,200, LinkedIn 3,000); Facebook's own limit is tens of thousands, so what
 * an owner sees there is our 5,000 and the screen says so in our own words
 * rather than quoting a number Facebook never gave.
 */
export const NETWORK_BODY_LIMITS: Record<SocialNetwork, number> = {
  facebook: POST_BODY_MAX,
  instagram: 2200,
  youtube: POST_BODY_MAX,
  tiktok: 2200,
  linkedin: 3000,
  x: 280,
  pinterest: 500,
  other: POST_BODY_MAX,
};

export function bodyLimitFor(network: SocialNetwork): number {
  return Math.min(NETWORK_BODY_LIMITS[network], POST_BODY_MAX);
}

/**
 * THE SHAPES A PICTURE IS CUT TO, and there are four because there are four
 * places a picture goes — not because four is a tidy number.
 *
 * The library is landscape: photos were taken for a website's hero. Social
 * wants a square, a tall feed picture, a full-screen story, or a link's wide
 * strip. So the post carries a shape and the platform cuts to it; the stored
 * photo is never touched, and a re-crop is an edit to this row (ADR 0023 —
 * one derivative, and a replaced photo is a new row, neither of which a crop
 * may break).
 */
export const POST_SHAPES = ["square", "portrait", "story", "wide"] as const;
export type PostShape = (typeof POST_SHAPES)[number];

/** A stored word, checked before it is used as a key. A row edited by hand is still a row. */
export function isPostShape(value: string): value is PostShape {
  return (POST_SHAPES as readonly string[]).includes(value);
}

export function isPostStatus(value: string): value is PostStatus {
  return (POST_STATUSES as readonly string[]).includes(value);
}

/** Width ÷ height. */
export const SHAPE_RATIO: Record<PostShape, number> = {
  square: 1,
  portrait: 4 / 5,
  story: 9 / 16,
  wide: 1.91,
};

export const SHAPE_LABELS: Record<PostShape, string> = {
  square: "Square",
  portrait: "Tall",
  story: "Full screen",
  wide: "Wide",
};

/** What each shape is FOR, in the places an owner recognises. */
export const SHAPE_HINTS: Record<PostShape, string> = {
  square: "Instagram, Facebook and LinkedIn all take a square.",
  portrait: "The tallest an Instagram or Facebook feed will show.",
  story: "A story or a reel, filling a phone's screen.",
  wide: "A wide strip, the way a shared link looks.",
};

/** The shape most at home on this network, for the default when a photo is chosen. */
export function defaultShapeFor(network: SocialNetwork): PostShape {
  if (network === "tiktok") return "story";
  if (network === "instagram") return "portrait";
  if (network === "x" || network === "linkedin") return "wide";
  return "square";
}

export interface CropBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The rectangle to cut, from the source's size, the shape and one focus point.
 *
 * **A FOCUS POINT RATHER THAN A FREE BOX**, and that is the whole design. A
 * free box needs a drag handle at each corner, which is four gestures on a
 * phone and a validation problem on the server (a box outside the picture, a
 * box of the wrong ratio, a box of zero width). A focus point is ONE TAP on
 * the preview: the biggest rectangle of the wanted shape that fits, slid to
 * sit around the tap and clamped inside the edges. It cannot express a
 * nonsense crop, so there is nothing to refuse.
 *
 * The focus is stored in 0–1 of the source, so it survives the photo being
 * re-served at another size, and it is meaningless on its own — which is why
 * this function, not the column, is the definition.
 */
export function cropBox(
  source: { width: number; height: number },
  shape: PostShape,
  focus: { x: number; y: number },
): CropBox {
  const ratio = SHAPE_RATIO[shape];
  const sw = Math.max(1, Math.round(source.width));
  const sh = Math.max(1, Math.round(source.height));
  // The largest rectangle of this ratio that fits: limited by height when the
  // source is the wider of the two, by width otherwise.
  let width = Math.min(sw, Math.max(1, Math.round(sh * ratio)));
  let height = Math.min(sh, Math.max(1, Math.round(width / ratio)));
  // Rounding can push the derived edge one pixel past the source; take it back
  // from the other, so the box is always inside the picture.
  width = Math.min(width, sw);
  height = Math.min(height, sh);
  const fx = Number.isFinite(focus.x) ? Math.min(1, Math.max(0, focus.x)) : 0.5;
  const fy = Number.isFinite(focus.y) ? Math.min(1, Math.max(0, focus.y)) : 0.5;
  const left = Math.min(sw - width, Math.max(0, Math.round(fx * sw - width / 2)));
  const top = Math.min(sh - height, Math.max(0, Math.round(fy * sh - height / 2)));
  return { left, top, width, height };
}

/** The same box as percentages, for the preview's overlay — no second rule to keep in step. */
export function cropOverlay(
  source: { width: number; height: number },
  shape: PostShape,
  focus: { x: number; y: number },
): { left: string; top: string; width: string; height: string } {
  const box = cropBox(source, shape, focus);
  const pct = (n: number, of: number) => `${(100 * n) / Math.max(1, of)}%`;
  return {
    left: pct(box.left, source.width),
    top: pct(box.top, source.height),
    width: pct(box.width, source.width),
    height: pct(box.height, source.height),
  };
}

/** What a list row is called when there are no words yet. */
export function postTitle(post: { body: string; network: SocialNetwork }): string {
  const words = post.body.trim().replace(/\s+/g, " ");
  if (words === "") return `${SOCIAL_NETWORK_LABELS[post.network]} post, nothing written yet`;
  return words.length <= 80 ? words : `${words.slice(0, 79)}…`;
}

/**
 * A post's day, in the tenant's own timezone — the key the list groups on.
 *
 * A draft has no day and groups under "No date yet"; that is why this returns
 * null rather than today. `en-CA` because it formats as `YYYY-MM-DD`, which is
 * the shape every other date in this codebase is stored and compared in.
 */
export function postDay(at: Date | null, timezone: string): string | null {
  if (!at) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(at);
  }
}

export interface DayGroup<T> {
  /** `YYYY-MM-DD`, or null for the posts with no date yet. */
  day: string | null;
  items: T[];
}

/**
 * The calendar, which on a phone is a list — posts with no date first (they
 * are the ones waiting on a decision), then each day in turn.
 */
export function groupByDay<T>(
  posts: readonly T[],
  dayOf: (post: T) => string | null,
): DayGroup<T>[] {
  const undated: T[] = [];
  const byDay = new Map<string, T[]>();
  for (const post of posts) {
    const day = dayOf(post);
    if (day === null) {
      undated.push(post);
      continue;
    }
    const bucket = byDay.get(day);
    if (bucket) bucket.push(post);
    else byDay.set(day, [post]);
  }
  const groups: DayGroup<T>[] = [...byDay.keys()]
    .sort()
    .map((day) => ({ day, items: byDay.get(day) ?? [] }));
  return undated.length > 0 ? [{ day: null, items: undated }, ...groups] : groups;
}

/** `Today`, `Tomorrow`, `Yesterday`, else the date written out. */
export function dayHeading(day: string | null, today: string): string {
  if (day === null) return "No date yet";
  const asDate = (value: string) => Date.parse(`${value}T00:00:00Z`);
  const diff = Math.round((asDate(day) - asDate(today)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const parsed = new Date(asDate(day));
  if (Number.isNaN(parsed.getTime())) return day;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

/**
 * Scheduling rounds to ten minutes, because the sweep that raises the reminder
 * runs every ten. Promising 4:07 and reminding at 4:10 is a small lie the
 * screen does not need to tell; the picker offers the times it can keep.
 */
export const SCHEDULE_STEP_MINUTES = 10;

export function roundToStep(at: Date): Date {
  const ms = SCHEDULE_STEP_MINUTES * 60_000;
  return new Date(Math.round(at.getTime() / ms) * ms);
}

/** Is this post ready to be scheduled? The same answer on both sides of the wire. */
export function readyToSchedule(post: { body: string }): boolean {
  return post.body.trim().length > 0;
}
