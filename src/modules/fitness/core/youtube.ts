/**
 * YOUTUBE, THE ONE PLACE A LINK BECOMES A VIDEO (docs/modules/fitness.md,
 * "Inline video").
 *
 * A program's videos are the author's, published on YouTube. They are played
 * through YouTube's own embedded player and never copied: what an exercise
 * keeps is the eleven-character id, and a clip start and end. Pure, so the
 * import, the editor and the program page all read a link the same way.
 */

/** YouTube's ids are eleven characters of this alphabet. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export interface YouTubeRef {
  id: string;
  /** `t=` or `start=` on the link, in seconds; null when it has none. */
  startS: number | null;
}

/**
 * Read a video out of a link, or null when it is not one video.
 *
 * Accepts the shapes a book or a person pastes: `youtu.be/ID`,
 * `youtube.com/watch?v=ID` (with `&t=` or `&feature=`), `/embed/ID`,
 * `/shorts/ID`, `/live/ID`, the `m.` and `music.` hosts, `youtube-nocookie.com`,
 * and a bare id. A PLAYLIST is not a video and is refused: the program links
 * one per phase, and the exercise's own video is what plays.
 */
export function parseYouTubeUrl(raw: string): YouTubeRef | null {
  const text = raw.trim();
  if (VIDEO_ID.test(text)) return { id: text, startS: null };
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") {
      id = url.searchParams.get("v");
    } else {
      const match = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)/);
      id = match ? match[1] : null;
    }
  }
  if (!id || !VIDEO_ID.test(id)) return null;
  return {
    id,
    startS: parseTimestamp(url.searchParams.get("t") ?? url.searchParams.get("start")),
  };
}

/**
 * A timestamp as YouTube writes one — `90`, `90s`, `1m30s`, `1h2m3s` — or as
 * a person types one, `1:30` or `1:02:03`. Seconds, or null.
 */
export function parseTimestamp(value: string | null | undefined): number | null {
  if (value == null) return null;
  const text = value.trim().toLowerCase();
  if (text === "") return null;
  if (/^\d+s?$/.test(text)) return parseInt(text, 10);
  const colon = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (colon) {
    return Number(colon[1] ?? 0) * 3600 + Number(colon[2]) * 60 + Number(colon[3]);
  }
  const units = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (units && (units[1] || units[2] || units[3])) {
    return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
  }
  return null;
}

/** Seconds as `m:ss` (or `h:mm:ss`), for a clip's start and end. */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

interface Clip {
  id: string;
  startS: number | null;
  endS: number | null;
}

/**
 * The embedded player: `youtube-nocookie.com`, which sets no cookie until the
 * person presses play; `playsinline` so an iPhone does not take the video
 * full screen; `rel=0` so what follows is the same channel, not a stranger's.
 * Autoplays because it is only ever loaded by a tap on the facade — nothing is
 * requested from YouTube until then.
 */
export function embedUrl(clip: Clip): string {
  const params = new URLSearchParams({ autoplay: "1", playsinline: "1", rel: "0" });
  if (clip.startS != null) params.set("start", String(clip.startS));
  if (clip.endS != null) params.set("end", String(clip.endS));
  return `https://www.youtube-nocookie.com/embed/${clip.id}?${params.toString()}`;
}

/** The speeds workout mode's demo loops at (F2b). */
export const DEMO_SPEEDS = [0.5, 0.75, 1] as const;
export type DemoSpeed = (typeof DEMO_SPEEDS)[number];

export function isDemoSpeed(value: unknown): value is DemoSpeed {
  return DEMO_SPEEDS.some((speed) => speed === value);
}

/** The privacy-enhanced host every player here comes from. */
export const PLAYER_HOST = "https://www.youtube-nocookie.com";

/**
 * Workout mode's looping demo (F2b): the player's parameters, for YouTube's
 * IFrame Player API, which adds `enablejsapi` and the page's `origin` itself.
 * No autoplay: the API starts it, muted, once it is on screen. No `end`: the
 * loop goes back to the start just before it, so YouTube's end screen never
 * shows. No controls: the page's own buttons sit below the player, never over
 * it (YouTube's terms forbid anything drawn over a player).
 */
export function demoPlayerVars(clip: Clip): Record<string, number> {
  const vars: Record<string, number> = { playsinline: 1, rel: 0, controls: 0 };
  if (clip.startS != null) vars.start = clip.startS;
  return vars;
}

/** Where the loop goes back to. */
export function loopStart(clip: Clip): number {
  return clip.startS ?? 0;
}

/**
 * Time to go back to the start: a quarter of a second before the clip's end,
 * so the player never reaches it and never stops. A clip with no end (or an
 * end before its start) loops the rest of the video, when YouTube says it
 * ended.
 */
export function loopDue(time: number, clip: Clip): boolean {
  return clip.endS != null && clip.endS > loopStart(clip) && time >= clip.endS - 0.25;
}

/** The same clip on YouTube itself, for a video that may not be embedded. */
export function watchUrl(clip: Clip): string {
  const t = clip.startS != null ? `&t=${clip.startS}s` : "";
  return `https://www.youtube.com/watch?v=${clip.id}${t}`;
}
