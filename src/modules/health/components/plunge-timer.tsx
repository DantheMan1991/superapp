"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { ArrowLeft, Play, Snowflake } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { audioContext, unlockAudio } from "@/lib/audio-context";
import { useWakeLock } from "@/lib/use-wake-lock";
import { logPlungeAction } from "../actions";
import {
  plungeWords,
  timedSeconds,
  timerFace,
  typedSeconds,
  typedWater,
  WATER_F_MAX,
  WATER_F_MIN,
  waterWords,
  wholeMinutes,
} from "../core/plunge";
import { clearPlunge, finishPlunge, startPlunge, typedPlungeIdentity, useClock, useRunningPlunge } from "./plunge-store";
import { ScoreScale } from "./score-scale";

const HOME = "/personal/m/health";

/**
 * THE COLD PLUNGE (H1, docs/help/health/plunge.md; the founder's calls): the
 * water's temperature, then Start as you get in; the timer counts up in big
 * numbers, with a soft tone and a buzz as each minute turns so you can keep
 * your eyes shut, and the screen stays on. Done stops it; then how you feel,
 * 0 to 10, and Save. Or "Type one in" for a plunge timed some other way.
 *
 * The timer is kept on the phone (`plunge-store.ts`): leave the page, lock the
 * phone or reload, and it is still counting from when it started.
 */
export function PlungeTimer({ lastWaterF, typed: startTyped }: { lastWaterF: number | null; typed: boolean }) {
  const router = useRouter();
  const running = useRunningPlunge();
  const now = useClock();
  const [typed, setTyped] = useState(startTyped && !running);
  const [water, setWater] = useState(lastWaterF === null ? "" : String(lastWaterF));
  const [minutes, setMinutes] = useState("");
  const [seconds, setSeconds] = useState("");
  const [feel, setFeel] = useState<number | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [pending, startTransition] = useTransition();
  const lastTone = useRef<number | null>(null);
  // A typed plunge's id, made at its first Save and kept for a retry, so a
  // Save whose answer was lost and is sent again keeps one plunge, not two.
  const typedIdentity = useRef<{ id: string; startedAt: string } | null>(null);

  const inWater = running !== null && running.doneAt === null;
  useWakeLock(inWater);

  const waterValue = typedWater(water);
  const waterOk = waterValue !== null;
  const elapsed = running ? (running.doneAt ?? (now || running.startedAt)) - running.startedAt : 0;

  // A soft tone and a buzz as each minute turns, while in the water.
  const minuteTone = useEffectEvent((minute: number) => {
    if (lastTone.current === null) {
      // The minute it opened on (a reload mid-plunge): no tone for minutes already past.
      lastTone.current = minute;
      return;
    }
    if (minute <= lastTone.current) return;
    lastTone.current = minute;
    softTone();
  });
  const minute = inWater ? wholeMinutes(elapsed) : -1;
  useEffect(() => {
    if (minute >= 0) minuteTone(minute);
  }, [minute]);

  function start() {
    unlockAudio();
    lastTone.current = 0;
    startPlunge(waterValue === "" || waterValue === null ? null : waterValue);
  }

  function save(input: { id: string; startedAt: string; seconds: number; waterF: number | null }) {
    startTransition(async () => {
      const outcome = await logPlungeAction({ ...input, feelAfter: feel });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      if (!typed) clearPlunge();
      toast.success(`Plunge kept: ${plungeWords(input.seconds)}${input.waterF === null ? "" : ` in ${waterWords(input.waterF)}`}.`);
      router.push(HOME);
    });
  }

  /** Not kept: back to Ready, with nothing of this plunge carried into the next. */
  function discard() {
    setDiscarding(false);
    setFeel(null);
    clearPlunge();
  }

  function saveTimed() {
    if (!running || running.doneAt === null) return;
    save({
      id: running.id,
      startedAt: new Date(running.startedAt).toISOString(),
      seconds: timedSeconds(running.startedAt, running.doneAt),
      waterF: running.waterF,
    });
  }

  function saveTyped() {
    const total = typedSeconds(minutes, seconds);
    if (total === null || !waterOk) return;
    typedIdentity.current ??= typedPlungeIdentity();
    save({ ...typedIdentity.current, seconds: total, waterF: waterValue === "" ? null : waterValue });
  }

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href={HOME}>
        <ArrowLeft aria-hidden /> Health
      </Link>
    </Button>
  );

  const waterField = (
    <div className="space-y-1">
      <Label htmlFor="water">Water temperature, °F</Label>
      <Input
        id="water"
        inputMode="decimal"
        value={water}
        onChange={(e) => setWater(e.target.value)}
        placeholder="Optional"
        className="w-32"
      />
      {!waterOk && <p className="text-sm text-destructive">{`Between ${WATER_F_MIN} and ${WATER_F_MAX} °F, or leave it empty.`}</p>}
    </div>
  );

  // Out of the water: the time is set; how do you feel, and Save.
  if (running && running.doneAt !== null) {
    const total = timedSeconds(running.startedAt, running.doneAt);
    return (
      <div className="mx-auto w-full max-w-md space-y-5">
        {back}
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-medium tracking-heading">Out of the water</h1>
          <p className="text-lg">
            {plungeWords(total)}
            {running.waterF !== null && <span className="text-muted-foreground">{` in ${waterWords(running.waterF)}`}</span>}
          </p>
        </div>
        <ScoreScale label="How do you feel?" value={feel} onChange={setFeel} low="awful" high="wonderful" />
        {discarding ? (
          // Asked twice: the time in the water is not kept anywhere else.
          <div className="space-y-2">
            <p>Discard this plunge? Its time is not kept.</p>
            <div className="flex gap-2">
              <Button variant="destructive" className="h-12 flex-1 text-base" onClick={discard}>
                Discard
              </Button>
              <Button variant="outline" className="h-12 flex-1 text-base" onClick={() => setDiscarding(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button className="h-12 flex-1 text-base" onClick={saveTimed} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button variant="outline" className="h-12" onClick={() => setDiscarding(true)} disabled={pending}>
              Discard
            </Button>
          </div>
        )}
      </div>
    );
  }

  // In the water: the time, big, and Done. A reload mid-plunge leaves the page
  // unable to sound until it is tapped again, so any tap here brings the tones back.
  if (running) {
    return (
      <div
        className="mx-auto flex min-h-[calc(100dvh-8rem)] w-full max-w-md flex-col items-center gap-6 text-center"
        onPointerDown={unlockAudio}
      >
        <p className="text-sm text-muted-foreground">
          {running.waterF === null ? "Cold plunge" : `Cold plunge · water ${waterWords(running.waterF)}`}
        </p>
        <div
          className="flex size-64 flex-col items-center justify-center rounded-full border-8 border-module-accent/80"
          aria-live="off"
        >
          <span className="text-7xl font-medium tabular-nums">{timerFace(elapsed)}</span>
          <span className="text-sm text-muted-foreground">in the water</span>
        </div>
        <p className="text-sm text-muted-foreground">A soft tone each minute, so you can keep your eyes shut. The screen stays on.</p>
        <div className="flex-1" />
        <Button className="h-16 w-full text-lg" onClick={finishPlunge}>
          Done
        </Button>
      </div>
    );
  }

  // Typed in: a plunge timed some other way.
  if (typed) {
    const total = typedSeconds(minutes, seconds);
    return (
      <div className="mx-auto w-full max-w-md space-y-5">
        {back}
        <h1 className="font-heading text-2xl font-medium tracking-heading">Type in a plunge</h1>
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="minutes">Minutes</Label>
            <Input id="minutes" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} className="w-24" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="seconds">Seconds</Label>
            <Input id="seconds" inputMode="numeric" value={seconds} onChange={(e) => setSeconds(e.target.value)} className="w-24" />
          </div>
        </div>
        {minutes.trim() !== "" || seconds.trim() !== "" ? (
          total === null && <p className="text-sm text-destructive">Up to 60 minutes, and seconds 0 to 59.</p>
        ) : null}
        {waterField}
        <ScoreScale label="How did you feel after?" value={feel} onChange={setFeel} low="awful" high="wonderful" />
        <div className="flex gap-2">
          <Button className="h-12 flex-1 text-base" onClick={saveTyped} disabled={pending || total === null || !waterOk}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button variant="outline" className="h-12" onClick={() => setTyped(false)} disabled={pending}>
            Use the timer
          </Button>
        </div>
      </div>
    );
  }

  // Ready: the water, then Start.
  return (
    <div className="mx-auto w-full max-w-md space-y-5">
      {back}
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 font-heading text-2xl font-medium tracking-heading">
          <Snowflake className="size-6 text-module-accent" aria-hidden /> Cold plunge
        </h1>
        <p className="text-muted-foreground">Set the water&apos;s temperature, then tap Start as you get in.</p>
      </div>
      {waterField}
      <Button className="h-16 w-full text-lg" onClick={start} disabled={!waterOk}>
        <Play aria-hidden /> Start the timer
      </Button>
      <Button variant="link" className="px-0" onClick={() => setTyped(true)}>
        Type one in instead
      </Button>
    </div>
  );
}

/** A soft tone and a short buzz: a minute has turned. */
function softTone(): void {
  try {
    navigator.vibrate?.(150);
  } catch {
    // No buzz here.
  }
  const context = audioContext();
  if (!context || context.state !== "running") return;
  try {
    const at = context.currentTime;
    const tone = context.createOscillator();
    const gain = context.createGain();
    tone.type = "sine";
    tone.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.12, at + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
    tone.connect(gain).connect(context.destination);
    tone.start(at);
    tone.stop(at + 0.65);
  } catch {
    // A context that has gone away: silence, never an error in the water.
  }
}
