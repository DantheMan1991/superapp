"use client";

import { useEffect, useId, useState } from "react";
import { ExternalLink, Play } from "lucide-react";
import { embedUrl, formatTimestamp, watchUrl } from "../core/youtube";

/** Said on `window` when a player starts, so every other one stops. */
const PLAYING = "yosher:fitness-video-playing";

/**
 * AN EXERCISE'S VIDEO, PLAYING RIGHT HERE (docs/modules/fitness.md, "Inline
 * video").
 *
 * A facade until the tap: a plain box with a play button, and NOTHING asked of
 * YouTube — no player, no thumbnail, no cookie — until the person wants the
 * video. A program page carries a dozen exercises, and a dozen players loading
 * at once would be slow on a phone and would tell YouTube about every page
 * view. The tap loads YouTube's own player from `youtube-nocookie.com`,
 * autoplaying, inline.
 *
 * **One video at a time.** Starting a player turns every other one on the
 * page back into its facade, which stops it. The first drive of F1 had two
 * demos talking over each other: on the floor mid-workout you tap the next
 * exercise's video with the last one still playing further up the page.
 * Stopping by unmounting needs nothing from YouTube's player API, which
 * workout mode (F2) brings; it costs the stopped video its place, and a demo
 * starts again from its clip.
 *
 * A video its uploader will not let be embedded (`embeddable === false`,
 * asked when the program was drafted or saved) shows a link to YouTube
 * instead of a player that would only show YouTube's error.
 */
export function VideoPlayer({
  videoId,
  startS,
  endS,
  embeddable,
  title,
}: {
  videoId: string;
  startS: number | null;
  endS: number | null;
  embeddable: boolean | null;
  /** The exercise's name, for the player's accessible title. */
  title: string;
}) {
  const self = useId();
  const [playing, setPlaying] = useState(false);
  const clip = { id: videoId, startS, endS };
  const span =
    startS != null || endS != null
      ? `${formatTimestamp(startS ?? 0)}${endS != null ? `–${formatTimestamp(endS)}` : ""}`
      : null;

  useEffect(() => {
    if (!playing) return;
    const stop = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== self) setPlaying(false);
    };
    window.addEventListener(PLAYING, stop);
    return () => window.removeEventListener(PLAYING, stop);
  }, [playing, self]);

  function play() {
    window.dispatchEvent(new CustomEvent(PLAYING, { detail: self }));
    setPlaying(true);
  }

  if (embeddable === false) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-muted px-4 text-center text-sm">
        <span className="text-muted-foreground">This video only plays on YouTube.</span>
        <a
          href={watchUrl(clip)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-module-accent hover:underline"
        >
          Open in YouTube <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
    );
  }

  if (!playing) {
    return (
      <button
        type="button"
        onClick={play}
        className="group flex aspect-video w-full flex-col items-center justify-center gap-2 bg-muted text-sm hover:bg-muted/70"
        aria-label={`Play the video for ${title}`}
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-background shadow-elevation-1 transition-transform group-hover:scale-105">
          <Play className="size-5 translate-x-px text-module-accent" aria-hidden />
        </span>
        <span className="text-muted-foreground">Tap to play here{span ? ` · ${span}` : ""}</span>
      </button>
    );
  }

  return (
    <iframe
      src={embedUrl(clip)}
      title={`Video: ${title}`}
      className="aspect-video w-full"
      // `fullscreen` here is what lets the player go full screen; the old
      // `allowFullScreen` attribute beside it only drew a console warning.
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}
