"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Minus, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sounds } from "./sound";

/** Seconds between "Start" (or the end of the last set) and the first breath. */
const COUNTDOWN_S = 5;

type Status = "ready" | "countdown" | "running" | "paused" | "done";

/**
 * THE BREATH PACER (docs/modules/fitness.md, F2): most of the founder's
 * program is counted in breaths, and counting your own while trying to
 * breathe slowly is the thing everybody gets wrong.
 *
 * A circle that shrinks on the breath out and grows on the breath in, at the
 * program's own pace (`breathPace`), a tone at each turn, and the count in the
 * middle. The set finishes itself at the top of the range, with a chime and a
 * buzz; from the bottom of it the person may finish it themselves
 * ("5–8 breaths": 5 is a set, 8 is the most). "One didn't count" takes a
 * breath back.
 *
 * A breath is one out and one in, counted at the end of the in.
 *
 * `onBegin` and `onBreath` are for the coach's voice and the demo (F2b): the
 * set starting to run, and each breath as it begins (1-based), so the screen
 * can say "Last one." without the pacer knowing any words.
 */
export function BreathPacer({
  outS,
  inS,
  min,
  max,
  autoStart,
  onFinish,
  onBegin,
  onBreath,
}: {
  outS: number;
  inS: number;
  min: number;
  max: number;
  /** Start counting down at once: every set after an exercise's first. */
  autoStart: boolean;
  onFinish: (count: number) => void;
  onBegin?: () => void;
  onBreath?: (n: number) => void;
}) {
  const [status, setStatus] = useState<Status>(autoStart ? "countdown" : "ready");
  const [countdown, setCountdown] = useState(COUNTDOWN_S);
  const [count, setCount] = useState(0);
  const [phase, setPhase] = useState<"out" | "in">("out");

  // The set is done: by the count reaching the top (from the timer), or by
  // Finish set (a tap). Two names for one thing, because an effect event may
  // only be called from an effect.
  function finishSet(breaths: number) {
    setStatus("done");
    sounds.setDone();
    onFinish(breaths);
  }
  const finishFromTimer = useEffectEvent((breaths: number) => finishSet(breaths));

  // The first breath: from the countdown's end, or Start now. The same two
  // names for one thing as above.
  function begin() {
    setStatus("running");
    setPhase("out");
    sounds.breatheOut();
    onBegin?.();
    onBreath?.(count + 1);
  }
  const beginFromTimer = useEffectEvent(() => begin());

  // The countdown into the set.
  useEffect(() => {
    if (status !== "countdown") return;
    const timer = window.setTimeout(() => {
      if (countdown <= 1) {
        beginFromTimer();
        return;
      }
      if (countdown <= 4) sounds.tick();
      setCountdown(countdown - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [status, countdown]);

  // The end of each half-breath. An effect event, so it reads the count as it
  // is now without the timer restarting when the count is corrected.
  const endOfPhase = useEffectEvent(() => {
    if (phase === "out") {
      setPhase("in");
      sounds.breatheIn();
      return;
    }
    const next = count + 1;
    setCount(next);
    if (next >= max) {
      finishFromTimer(next);
      return;
    }
    setPhase("out");
    sounds.breatheOut();
    onBreath?.(next + 1);
  });

  useEffect(() => {
    if (status !== "running") return;
    const timer = window.setTimeout(() => endOfPhase(), (phase === "out" ? outS : inS) * 1000);
    return () => window.clearTimeout(timer);
  }, [status, phase, outS, inS]);

  const running = status === "running";
  const scale = running ? (phase === "out" ? 0.55 : 1) : 1;
  const seconds = phase === "out" ? outS : inS;
  const words =
    status === "ready"
      ? "Start when you are in position"
      : status === "countdown"
        ? `Starting in ${countdown}`
        : status === "paused"
          ? "Paused"
          : status === "done"
            ? "Set done"
            : phase === "out"
              ? "Breathe out"
              : "Breathe in";

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative flex size-64 items-center justify-center" aria-live="polite">
        <div
          aria-hidden
          className="absolute inset-0 rounded-full bg-module-accent/80"
          style={{
            transform: `scale(${scale})`,
            transition: running ? `transform ${seconds}s ease-in-out` : "transform 400ms ease-out",
          }}
        />
        <div className="relative text-center text-white">
          <div className="text-6xl font-medium tabular-nums leading-none">{count}</div>
          <div className="mt-1 text-sm opacity-80">
            of {min === max ? max : `${min}–${max}`}
          </div>
          <div className="mt-2 text-base">{words}</div>
        </div>
      </div>

      {status === "ready" && (
        <Button size="lg" className="h-14 w-full text-lg" onClick={() => setStatus("countdown")}>
          <Play aria-hidden /> Start
        </Button>
      )}
      {status === "countdown" && (
        <div className="grid w-full grid-cols-2 gap-3">
          <Button size="lg" className="h-14" onClick={begin}>
            Start now
          </Button>
          <Button size="lg" variant="outline" className="h-14" onClick={() => {
            setStatus("ready");
            setCountdown(COUNTDOWN_S);
          }}>
            Wait
          </Button>
        </div>
      )}
      {(status === "running" || status === "paused") && (
        <div className="grid w-full grid-cols-3 gap-2">
          <Button
            size="lg"
            variant="outline"
            className="h-14"
            onClick={() => {
              if (running) {
                setStatus("paused");
                return;
              }
              setStatus("running");
              if (phase === "out") sounds.breatheOut();
              else sounds.breatheIn();
            }}
          >
            {running ? <Pause aria-hidden /> : <Play aria-hidden />} {running ? "Pause" : "Resume"}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-14 whitespace-normal leading-tight"
            onClick={() => setCount((c) => Math.max(0, c - 1))}
            disabled={count === 0}
          >
            <Minus aria-hidden /> One didn&apos;t count
          </Button>
          <Button
            size="lg"
            variant={count >= min ? "default" : "outline"}
            className="h-14 whitespace-normal leading-tight"
            disabled={count < min}
            onClick={() => finishSet(count)}
          >
            Finish set
          </Button>
        </div>
      )}
    </div>
  );
}
