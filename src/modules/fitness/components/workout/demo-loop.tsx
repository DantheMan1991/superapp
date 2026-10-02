"use client";

import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
} from "react";
import { AudioLines, ExternalLink, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isVoiceBusy, silence, subscribeVoiceBusy } from "@/lib/speech/voice-queue";
import { cn } from "@/lib/utils";
import { holdListener } from "@/lib/voice-commands/listener";
import type { PlanVideo } from "../../core/session";
import {
  DEMO_SPEEDS,
  demoPlayerVars,
  isDemoSpeed,
  loopDue,
  loopStart,
  PLAYER_HOST,
  watchUrl,
  type DemoSpeed,
} from "../../core/youtube";
import { VideoPlayer } from "../video-player";
import { loadYouTubeApi, PLAYER_STATE, playerErrorWords, type YouTubePlayer } from "./youtube-api";

/* -- the speed, per device -------------------------------------------------- */

const SPEED_KEY = "yosher.fitness.demo-speed";
let speedNow: DemoSpeed | null = null;
const speedListeners = new Set<() => void>();

function demoSpeed(): DemoSpeed {
  if (speedNow === null) {
    let stored: number | null = null;
    try {
      stored = Number(window.localStorage.getItem(SPEED_KEY));
    } catch {
      // A private window: the default, for this page.
    }
    speedNow = isDemoSpeed(stored) ? stored : 1;
  }
  return speedNow;
}

function speedOnTheServer(): DemoSpeed {
  return 1;
}

function setDemoSpeed(speed: DemoSpeed): void {
  speedNow = speed;
  try {
    window.localStorage.setItem(SPEED_KEY, String(speed));
  } catch {
    // Kept in memory for this page.
  }
  for (const listener of speedListeners) listener();
}

function subscribeSpeed(onChange: () => void): () => void {
  speedListeners.add(onChange);
  return () => speedListeners.delete(onChange);
}

/* -- the demo --------------------------------------------------------------- */

export interface DemoHandle {
  /** A set has begun: back to the muted loop, if the clip was playing with sound. */
  quiet(): void;
}

type Status = "loading" | "playing" | "paused" | "blocked" | "fallback";

/** The longest the demo waits for the coach: a line that never reports its end must not keep it still. */
const COACH_WAIT_MAX_MS = 20_000;

/**
 * On a phone the demo runs the full width of the screen (F2d): the column's
 * own side margins come off it, and its corners with them. Wider than the
 * workout's column, the column has margins of its own and the demo keeps its
 * corners.
 */
const EDGE_TO_EDGE = "max-[44rem]:-mx-4 max-[44rem]:w-auto max-[44rem]:rounded-none";

/**
 * THE DEMO LOOPS ABOVE THE COUNT (docs/modules/fitness.md, F2b; the approved
 * mockup's "Demo loops here, muted"). The exercise's clip, muted, going round
 * and round at the speed chosen (0.5×, 0.75×, 1×), so a glance from the floor
 * shows the movement. `With sound` plays the clip once from its start at
 * normal speed with the author talking, then goes back to the loop; starting
 * a set does the same.
 *
 * YouTube's own player, driven by its IFrame Player API (`youtube-api.ts`),
 * and inside YouTube's terms for an API client: it only plays while at least
 * half of it is on screen (and the screen is on), it is the one autoplaying
 * player on the screen, it is never under 200 px either way, nothing is drawn
 * over it (the buttons are below), and every call it makes is in the API's
 * reference. The loop is the page going back to the clip's start just before
 * its end, not YouTube's `loop`, which ignores a clip's start.
 *
 * THE STAGE: this fills the slot at the top of the exercise screen, which the
 * founder's posture tool may fill with its camera view during a set instead.
 *
 * THE COACH FIRST (F2d; the founder: "the video should wait to start until
 * the talking is done"). A new exercise's demo holds still while the coach
 * says what the exercise is, and starts when the voice goes quiet: listen,
 * then watch. Tapping play starts it at once, and it never waits more than
 * `COACH_WAIT_MAX_MS`. Once going it does not stop for the coach again.
 */
export function DemoLoop({ video, title, ref }: { video: PlanVideo; title: string; ref?: Ref<DemoHandle> }) {
  const box = useRef<HTMLDivElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  /** At least half of the player on screen. */
  const onScreen = useRef(false);
  /** The person paused it: nothing starts it again but them. */
  const held = useRef(false);
  /** Ready, and holding its start until the coach has finished. */
  const waitingForCoach = useRef(false);
  const [status, setStatus] = useState<Status>("loading");
  const [ready, setReady] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [withSound, setWithSound] = useState(false);
  const [failure, setFailure] = useState<{ words: string; onYouTube: boolean } | null>(null);
  const speed = useSyncExternalStore(subscribeSpeed, demoSpeed, speedOnTheServer);
  const { id, startS, endS } = video;
  const clip = { id, startS, endS };

  function shown(): boolean {
    return onScreen.current && document.visibilityState === "visible";
  }

  /** Muted, at the chosen speed, from the clip's start. */
  function backToLoop(p: YouTubePlayer) {
    setWithSound(false);
    p.mute();
    p.setPlaybackRate(speed);
    p.seekTo(loopStart(clip), true);
    if (!held.current && !waitingForCoach.current && shown()) p.playVideo();
  }

  /** Stop holding for the coach: they finished, the person tapped, or it waited long enough. */
  function stopWaiting() {
    waitingForCoach.current = false;
    setWaiting(false);
  }

  useImperativeHandle(ref, () => ({
    quiet() {
      const p = player.current;
      if (p && withSound) backToLoop(p);
    },
  }));

  // Hands-free (F6): while the author talks, the listener holds, as it does
  // for the coach, so "repeat on the other side" is never taken for a phrase.
  useEffect(() => {
    holdListener("demo", withSound);
    return () => holdListener("demo", false);
  }, [withSound]);

  const whenReady = useEffectEvent((p: YouTubePlayer) => {
    player.current = p;
    setReady(true);
    p.mute();
    p.setPlaybackRate(speed);
    // The exercise's line was asked for as its screen appeared, before the
    // player could be ready, so a coach still talking is talking about this.
    if (isVoiceBusy()) {
      waitingForCoach.current = true;
      setWaiting(true);
      return;
    }
    if (shown()) p.playVideo();
  });

  const startAfterCoach = useEffectEvent(() => {
    if (!waitingForCoach.current) return;
    stopWaiting();
    const p = player.current;
    if (p && !held.current && shown()) p.playVideo();
  });
  useEffect(
    () =>
      subscribeVoiceBusy(() => {
        if (!isVoiceBusy()) startAfterCoach();
      }),
    [],
  );
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => startAfterCoach(), COACH_WAIT_MAX_MS);
    return () => window.clearTimeout(timer);
  }, [waiting]);

  const whenStateChanges = useEffectEvent((state: number) => {
    const p = player.current;
    if (state === PLAYER_STATE.playing) setStatus("playing");
    else if (state === PLAYER_STATE.paused) setStatus("paused");
    else if (state === PLAYER_STATE.ended && p) {
      // A clip with no end, or the last check came late: round again.
      if (withSound) backToLoop(p);
      else {
        p.seekTo(loopStart(clip), true);
        p.playVideo();
      }
    }
  });

  const whenItFails = useEffectEvent((code: number) => {
    try {
      player.current?.destroy();
    } catch {
      // Already gone.
    }
    player.current = null;
    setFailure(playerErrorWords(code));
  });

  // YouTube's player, made in a node React does not own: the API replaces it
  // with the iframe, which React must never try to remove itself.
  useEffect(() => {
    const host = box.current;
    if (!host) return;
    let cancelled = false;
    let made: YouTubePlayer | null = null;
    const target = document.createElement("div");
    host.appendChild(target);
    loadYouTubeApi().then(
      (api) => {
        if (cancelled) return;
        made = new api.Player(target, {
          host: PLAYER_HOST,
          videoId: id,
          width: "100%",
          height: "100%",
          playerVars: demoPlayerVars({ id, startS, endS }),
          events: {
            onReady: (event) => whenReady(event.target),
            onStateChange: (event) => whenStateChanges(event.data),
            onError: (event) => whenItFails(event.data),
            onAutoplayBlocked: () => setStatus("blocked"),
          },
        });
      },
      () => {
        if (!cancelled) setStatus("fallback");
      },
    );
    return () => {
      cancelled = true;
      player.current = null;
      try {
        made?.destroy();
      } catch {
        // Already gone.
      }
      host.replaceChildren();
    };
  }, [id, startS, endS]);

  // Plays only while at least half of it is on screen and the screen is on:
  // YouTube's terms for a player that starts by itself, and a phone's battery.
  const follow = useEffectEvent(() => {
    const p = player.current;
    if (!p) return;
    if (!shown()) p.pauseVideo();
    else if (!held.current && !waitingForCoach.current) p.playVideo();
  });
  useEffect(() => {
    const host = box.current;
    if (!host) return;
    const observer = new IntersectionObserver(
      (entries) => {
        onScreen.current = (entries[0]?.intersectionRatio ?? 0) >= 0.5;
        follow();
      },
      { threshold: [0, 0.5, 1] },
    );
    observer.observe(host);
    const onVisibility = () => follow();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // The loop: back to the start just before the clip's end.
  const check = useEffectEvent(() => {
    const p = player.current;
    if (!p) return;
    let time: number;
    try {
      time = p.getCurrentTime();
    } catch {
      return;
    }
    if (!loopDue(time, clip)) return;
    if (withSound) backToLoop(p);
    else p.seekTo(loopStart(clip), true);
  });
  useEffect(() => {
    if (status !== "playing") return;
    const timer = window.setInterval(() => check(), 250);
    return () => window.clearInterval(timer);
  }, [status]);

  function togglePlay() {
    const p = player.current;
    if (!p) return;
    if (status === "playing") {
      held.current = true;
      p.pauseVideo();
    } else {
      held.current = false;
      stopWaiting();
      p.playVideo();
    }
  }

  function toggleSound() {
    const p = player.current;
    if (!p) return;
    if (withSound) {
      backToLoop(p);
      return;
    }
    // The author's voice, alone: the coach stops rather than talk over them.
    silence();
    stopWaiting();
    setWithSound(true);
    held.current = false;
    p.unMute();
    p.setPlaybackRate(1);
    p.seekTo(loopStart(clip), true);
    p.playVideo();
  }

  function chooseSpeed(next: DemoSpeed) {
    setDemoSpeed(next);
    if (!withSound) player.current?.setPlaybackRate(next);
  }

  if (video.embeddable === false || status === "fallback") {
    // Not ours to loop: YouTube's link, or the plain player when the API
    // would not load.
    return (
      <div className={cn("overflow-hidden rounded-xl", EDGE_TO_EDGE)}>
        <VideoPlayer videoId={id} startS={startS} endS={endS} embeddable={video.embeddable} title={title} />
      </div>
    );
  }

  if (failure) {
    return (
      <div className="flex aspect-video min-h-[200px] w-full flex-col items-center justify-center gap-2 rounded-xl bg-muted px-4 text-center text-sm">
        <span className="text-muted-foreground">{failure.words}</span>
        {failure.onYouTube && (
          <a
            href={watchUrl(clip)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-module-accent hover:underline"
          >
            Open in YouTube <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </div>
    );
  }

  const playing = status === "playing";
  return (
    <div className="space-y-2">
      <div
        ref={box}
        className={cn(
          "relative aspect-video min-h-[200px] w-full overflow-hidden rounded-xl bg-black [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:size-full",
          EDGE_TO_EDGE,
        )}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={status === "blocked" ? "default" : "outline"}
          size="icon"
          className="size-10"
          disabled={!ready}
          aria-label={playing ? "Pause the demo" : "Play the demo"}
          onClick={togglePlay}
        >
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </Button>
        <div className="flex gap-1" role="group" aria-label="Demo speed">
          {DEMO_SPEEDS.map((option) => (
            <Button
              key={option}
              // The primary look, not a class over the outline one: the
              // outline's dark-mode fill won over it on the dark screen.
              variant={speed === option ? "default" : "outline"}
              className="h-10 px-2.5 tabular-nums"
              aria-pressed={speed === option}
              disabled={!ready || withSound}
              onClick={() => chooseSpeed(option)}
            >
              {`${option}×`}
            </Button>
          ))}
        </div>
        <Button variant="outline" className="ml-auto h-10" disabled={!ready} onClick={toggleSound}>
          {withSound ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
          {withSound ? "Back to the loop" : "With sound"}
        </Button>
      </div>
      {waiting && (
        <p className="flex items-start gap-1.5 text-sm text-module-accent" aria-live="polite">
          <AudioLines className="mt-0.5 size-4 shrink-0" aria-hidden />
          The demo starts when the coach has finished. Tap play to start it now.
        </p>
      )}
      {status === "blocked" && (
        <p className="text-sm text-muted-foreground">This phone waits for a tap before it plays a video. Tap play.</p>
      )}
    </div>
  );
}
