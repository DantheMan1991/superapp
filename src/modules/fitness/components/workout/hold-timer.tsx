"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sounds } from "./sound";

const COUNTDOWN_S = 5;

type Status = "ready" | "countdown" | "running" | "paused" | "done";

/**
 * A HOLD, counted in seconds: a countdown from the top of the range, a tick
 * in the last three, and the chime at zero. From the bottom of the range the
 * person may stop it themselves, and the seconds held are what is logged.
 *
 * `onBegin` and `onSecond` are for the coach's voice and the demo (F2b), as
 * the pacer's are.
 */
export function HoldTimer({
  min,
  max,
  autoStart,
  onFinish,
  onBegin,
  onSecond,
}: {
  min: number;
  max: number;
  autoStart: boolean;
  onFinish: (seconds: number) => void;
  onBegin?: () => void;
  /** Each second held, before the last. */
  onSecond?: (elapsed: number) => void;
}) {
  const [status, setStatus] = useState<Status>(autoStart ? "countdown" : "ready");
  const [countdown, setCountdown] = useState(COUNTDOWN_S);
  const [held, setHeld] = useState(0);

  function finishSet(seconds: number) {
    setStatus("done");
    sounds.setDone();
    onFinish(seconds);
  }
  const finishFromTimer = useEffectEvent((seconds: number) => finishSet(seconds));

  function begin() {
    setStatus("running");
    onBegin?.();
  }
  const beginFromTimer = useEffectEvent(() => begin());

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

  const second = useEffectEvent(() => {
    const next = held + 1;
    setHeld(next);
    if (next >= max) {
      finishFromTimer(next);
      return;
    }
    if (max - next <= 3) sounds.tick();
    onSecond?.(next);
  });

  useEffect(() => {
    if (status !== "running") return;
    const timer = window.setInterval(() => second(), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  const left = Math.max(0, max - held);
  const running = status === "running";

  return (
    <div className="flex flex-col items-center gap-5">
      <div
        className="flex size-64 flex-col items-center justify-center rounded-full border-8 border-module-accent/80 text-center"
        aria-live="polite"
      >
        <div className="text-6xl font-medium tabular-nums leading-none">
          {status === "countdown" ? countdown : left}
        </div>
        <div className="mt-2 text-base opacity-80">
          {status === "ready"
            ? "Start when you are in position"
            : status === "countdown"
              ? "Starting in"
              : status === "paused"
                ? "Paused"
                : status === "done"
                  ? "Set done"
                  : "seconds to hold"}
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
          <Button
            size="lg"
            variant="outline"
            className="h-14"
            onClick={() => {
              setStatus("ready");
              setCountdown(COUNTDOWN_S);
            }}
          >
            Wait
          </Button>
        </div>
      )}
      {(status === "running" || status === "paused") && (
        <div className="grid w-full grid-cols-2 gap-3">
          <Button
            size="lg"
            variant="outline"
            className="h-14"
            onClick={() => setStatus(running ? "paused" : "running")}
          >
            {running ? <Pause aria-hidden /> : <Play aria-hidden />} {running ? "Pause" : "Resume"}
          </Button>
          <Button
            size="lg"
            variant={held >= min ? "default" : "outline"}
            className="h-14"
            disabled={held < min}
            onClick={() => finishSet(held)}
          >
            Finish set
          </Button>
        </div>
      )}
    </div>
  );
}
