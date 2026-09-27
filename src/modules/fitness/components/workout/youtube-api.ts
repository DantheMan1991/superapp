/**
 * YOUTUBE'S IFRAME PLAYER API, loaded once and only where it is used
 * (docs/modules/fitness.md, "Inline video"; F2b's looping demo).
 *
 * The API is YouTube's own script (`https://www.youtube.com/iframe_api`),
 * which makes the privacy-enhanced player (`PLAYER_HOST`) and talks to it.
 * Only workout mode loads it, only when an exercise has a video that may be
 * embedded, and a page that cannot load it falls back to the plain player
 * (`VideoPlayer`).
 *
 * The types are the handful of calls the demo makes, written here rather than
 * taken from a types package for one screen. Every one of them is in the API's
 * reference, which is the rule: YouTube's terms allow no change to the player
 * the documentation does not describe.
 */

/** `onStateChange`'s values. */
export const PLAYER_STATE = {
  unstarted: -1,
  ended: 0,
  playing: 1,
  paused: 2,
  buffering: 3,
  cued: 5,
} as const;

export interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  mute(): void;
  unMute(): void;
  setPlaybackRate(rate: number): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
}

interface PlayerEvent {
  target: YouTubePlayer;
  data: number;
}

export interface PlayerEvents {
  onReady?: (event: PlayerEvent) => void;
  onStateChange?: (event: PlayerEvent) => void;
  onError?: (event: PlayerEvent) => void;
  onAutoplayBlocked?: (event: PlayerEvent) => void;
}

export interface PlayerOptions {
  /**
   * Where the player comes from, and so where the API sends its commands. Not
   * in the reference, but the API only talks to `www.youtube.com` without it,
   * and a privacy-enhanced player would never hear a command.
   */
  host: string;
  videoId: string;
  width: string;
  height: string;
  playerVars: Record<string, number>;
  events: PlayerEvents;
}

interface YouTubeNamespace {
  /** Replaces `element` with the player's iframe. */
  Player: new (element: HTMLElement, options: PlayerOptions) => YouTubePlayer;
}

interface YouTubeWindow {
  YT?: Partial<YouTubeNamespace>;
  onYouTubeIframeAPIReady?: () => void;
}

const API_URL = "https://www.youtube.com/iframe_api";
const GIVE_UP_MS = 15_000;

let loading: Promise<YouTubeNamespace> | null = null;

/** `YT.Player` exists only once the whole API has arrived, not just its loader. */
function ready(w: YouTubeWindow): YouTubeNamespace | null {
  return typeof w.YT?.Player === "function" ? (w.YT as YouTubeNamespace) : null;
}

/** The API, once. A failure is forgotten, so the next exercise tries again. */
export function loadYouTubeApi(): Promise<YouTubeNamespace> {
  const w = window as unknown as YouTubeWindow;
  const now = ready(w);
  if (now) return Promise.resolve(now);
  if (loading) return loading;
  loading = new Promise<YouTubeNamespace>((resolve, reject) => {
    const fail = () => {
      loading = null;
      reject(new Error("The YouTube player did not load."));
    };
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      const api = ready(w);
      if (api) resolve(api);
      else fail();
    };
    const script = document.createElement("script");
    script.src = API_URL;
    script.async = true;
    script.onerror = fail;
    document.head.appendChild(script);
    window.setTimeout(() => {
      if (!ready(w)) fail();
    }, GIVE_UP_MS);
  });
  return loading;
}

/** A player error, in words, and whether YouTube itself can still play it. */
export function playerErrorWords(code: number): { words: string; onYouTube: boolean } {
  switch (code) {
    case 100:
      return { words: "This video is not on YouTube any more.", onYouTube: false };
    case 101:
    case 150:
      return { words: "This video only plays on YouTube.", onYouTube: true };
    default:
      return { words: "The demo could not play here.", onYouTube: true };
  }
}
