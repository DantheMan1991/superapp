"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  Check,
  CloudOff,
  Loader2,
  Megaphone,
  MegaphoneOff,
  Mic,
  MicOff,
  Play,
  Plus,
  SkipForward,
  TrendingUp,
  TriangleAlert,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { HelpButton } from "@/components/app/help-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { prefetchLines, setClipSource } from "@/lib/speech/clips";
import { canSpeak, noVoiceOnTheServer, subscribeVoice } from "@/lib/speech/say";
import { silence } from "@/lib/speech/voice-queue";
import { isRecordedVoice, RECORDED_VOICES, type RecordedVoice } from "@/lib/speech/voices";
import { cn } from "@/lib/utils";
import { LISTENER_DOWNLOAD_WORDS } from "@/lib/voice-commands/assets";
import {
  canListen,
  listenerState,
  setHeardHandler,
  startListening,
  stopListening,
} from "@/lib/voice-commands/listener";
import { useListener } from "@/lib/voice-commands/use-listener";
import { breathLine, cueFor, EXERCISE_DONE, holdLine, sessionLines, setIntro } from "../../core/coach";
import {
  aimFor,
  aimWords,
  canHalve,
  dayOf,
  hourIn,
  partOfDay,
  toDayItem,
  type DayProgress,
  type DaySession,
  type SplitChoice,
} from "../../core/day";
import { commandWords, isWorkoutCommand, notYetLines, replyLines, REPLY } from "../../core/hands-free";
import { madeWords, markMade } from "../../core/levels";
import { countOf, prescription } from "../../core/program";
import { sideWords as oneSideWords } from "../../core/side";
import {
  beginSession,
  canAddSet,
  finishExercise,
  finishSession,
  lastActivity,
  loggedFor,
  nextStep,
  oneMoreSet,
  plannedFor,
  recordSet,
  sessionSummary,
  sideWords,
  skipExercise,
  type Hurt,
  type SessionDoc,
  type SessionPlan,
  type Step,
} from "../../core/session";
import { BreathPacer } from "./breath-pacer";
import { ConfirmCount } from "./confirm-count";
import { DemoLoop, type DemoHandle } from "./demo-loop";
import { FeelScale } from "./feel-scale";
import {
  isHandsFreeOn,
  sendWorkoutCommand,
  setHandsFreeOn,
  useHandsFreeOn,
  useWorkoutCommands,
  WORKOUT_KEYWORDS,
} from "./hands-free";
import { HandsFreeHint, type HandsFreeView } from "./hands-free-hint";
import { HoldTimer } from "./hold-timer";
import { newId, openSessionFor, putSession, readSessions, sendPending } from "./session-store";
import {
  coachSay,
  coachVoice,
  coachVoiceOnTheServer,
  isMuted,
  isVoiceOff,
  mutedOnTheServer,
  setCoachVoice,
  setMuted,
  setVoiceOff,
  subscribeMuted,
  tryCoachVoice,
  unlockSound,
  voiceOffOnTheServer,
} from "./sound";
import { useSessionSync, useStoredSessions, type SyncState } from "./use-session-sync";
import { useWakeLock } from "@/lib/use-wake-lock";

/**
 * WORKOUT MODE (docs/help/fitness/workout.md, docs/modules/fitness.md F2a).
 *
 * The screen for doing the session, not reading about it: full screen and
 * dark, one exercise at a time, big targets, from a phone on the floor a
 * metre away. The founder approved it from a mockup on 2026-09-27.
 *
 * Everything it shows is worked out from the session document kept on the
 * phone (core/session.ts, session-store.ts): no document is the feel check;
 * a document is its next step. So a reload, a dropped signal or the phone
 * locking mid-set lands back on exactly the set it was on.
 *
 * THE STAGE at the top is a slot: the exercise's demo, looping (F2b), and
 * where the founder's posture tool can put its camera view during a set.
 *
 * THE COACH'S VOICE (F2b, core/coach.ts) says what the screen would tell you
 * at the moments you cannot see it: each set as it appears, a cue and "Last
 * one." during it, "Exercise done." after. Everything it says goes through the
 * one voice (`coachSay`, ADR 0114), which a posture tool shares. Since F2d it
 * is a recorded natural voice (ADR 0115) when the platform has one: this
 * screen turns the recordings on, in the voice the phone chose, and fetches
 * the session's lines ahead of them being said.
 *
 * THE WIDTH (F2d): a set with a demo spreads out on a wide screen, the demo
 * on the left as big as the window's height allows and the set on the right,
 * so Done stays in view. Every other view keeps the phone's column.
 *
 * HANDS-FREE (F6): switched on before the workout and remembered, the phone
 * listens from the Start tap (on the phone itself, `@/lib/voice-commands`,
 * ADR 0124) for "start set", "set done", "pause workout", "resume", "one more
 * set", "next exercise" and "repeat". This screen hears a phrase and hands it
 * on (`sendWorkoutCommand`); the control on the screen does what its button
 * would and the coach says a word back. The listener never hears the coach:
 * it drops the sound while the one voice speaks.
 */
const VOICE_ENDPOINT = "/api/fitness/voice";

export function WorkoutScreen({
  plan,
  programHref,
  recent,
  today,
  timeZone,
  naturalVoice,
}: {
  plan: SessionPlan;
  programHref: string;
  /** The program's sessions of the days around today, from the server (core/day.ts). */
  recent: DaySession[];
  /** The personal space's today, `YYYY-MM-DD`: the day a split day is added up on. */
  today: string;
  /** The space's timezone, so "Morning" reads the same on the server's render and the phone's. */
  timeZone: string;
  /** The platform can record the coach's lines (ADR 0115); otherwise the device speaks. */
  naturalVoice: boolean;
}) {
  const router = useRouter();
  const sessions = useStoredSessions();
  const sync = useSessionSync(sessions);
  const open = openSessionFor(sessions, plan.programId);
  const doc = open && open.phaseId === plan.phaseId ? open : null;
  const elsewhere = open && open.phaseId !== plan.phaseId ? open : null;
  const [leaving, setLeaving] = useState(false);
  const voice = useSyncExternalStore(subscribeMuted, coachVoice, coachVoiceOnTheServer);
  const muted = useSyncExternalStore(subscribeMuted, isMuted, mutedOnTheServer);
  const voiceOff = useSyncExternalStore(subscribeMuted, isVoiceOff, voiceOffOnTheServer);
  const quiet = muted || voiceOff;
  const handsFreeOn = useHandsFreeOn();
  const listener = useListener();
  const listenable = useSyncExternalStore(subscribeToNothing, canListen, () => false);
  /** What hands-free last heard, shown for a few seconds. */
  const [heardNote, setHeardNote] = useState<{ id: number; text: string } | null>(null);
  useWakeLock(doc !== null && !leaving);
  // Leaving the screen, however it happens, leaves nothing talking.
  useEffect(() => () => silence(), []);

  /* -- hands-free (F6) -------------------------------------------------------- */

  /** From a tap: the one moment a phone lets a page start its microphone. */
  function listen() {
    if (listenable) startListening(WORKOUT_KEYWORDS);
  }

  const heard = useEffectEvent((label: string) => {
    if (!isWorkoutCommand(label)) return;
    setHeardNote((before) => ({ id: (before?.id ?? 0) + 1, text: `Heard “${commandWords(label)}”.` }));
    sendWorkoutCommand(label);
  });

  // Phrases come to this screen while it is open; leaving it lets go of the
  // microphone.
  useEffect(() => {
    setHeardHandler((label) => heard(label));
    return () => {
      setHeardHandler(null);
      stopListening();
    };
  }, []);

  // What it heard fades after a few seconds.
  useEffect(() => {
    if (!heardNote) return;
    const timer = window.setTimeout(() => setHeardNote((now) => (now?.id === heardNote.id ? null : now)), 6000);
    return () => window.clearTimeout(timer);
  }, [heardNote]);

  function turnHandsFree(next: boolean) {
    setHandsFreeOn(next);
    if (!next) {
      stopListening();
      setHeardNote(null);
    } else if (doc) listen();
  }

  const handsFreeView: HandsFreeView | null = listenable
    ? {
        on: handsFreeOn,
        state: listener,
        heard: heardNote?.text ?? null,
        // As things are at the tap, not at render: the screen's own tap
        // handler may have started it a moment before this click.
        onStart: () => {
          if (listenerState().status === "off") listen();
        },
        onRetry: () => {
          stopListening();
          listen();
        },
        onOff: () => turnHandsFree(false),
      }
    : null;

  // The recordings, on while this screen is, in the voice this phone chose.
  // A LAYOUT effect: a child's effects run before its parent's, so a plain
  // one here came after the start screen had already asked for its lines
  // (dropped, with no source yet) and after a reloaded set had said its line
  // (in the device's voice). Found on the drive.
  useLayoutEffect(() => {
    if (!naturalVoice) return;
    setClipSource({ endpoint: VOICE_ENDPOINT, voice });
    return () => setClipSource(null);
  }, [naturalVoice, voice]);

  // What is left of the session, fetched ahead of being said: again as it
  // moves on, which asks only for a line a change made new ("One more set").
  // With hands-free on, the coach's words back too (F6).
  const fetchAhead = useEffectEvent(() => {
    if (doc && naturalVoice && !quiet) {
      prefetchLines([...sessionLines(plan, doc), ...(handsFreeOn ? replyLines() : [])]);
    }
  });
  useEffect(() => {
    fetchAhead();
  }, [doc?.id, doc?.revision, voice, quiet, handsFreeOn]);

  // SPLIT DAYS (F2c): what the day's other sessions did, and so what this one
  // sets out to do. Pure over the server's sessions and the phone's own.
  const dayItems = plan.items.map(toDayItem);
  const phoneDocs = sessions.filter((s) => s.doc.programId === plan.programId).map((s) => s.doc);
  const earlier = dayOf(dayItems, today, recent, phoneDocs, doc?.id ?? null);

  /** The session as it is at the moment of a tap, never as it was at render. */
  function current(): SessionDoc | null {
    const latest = openSessionFor(readSessions(), plan.programId);
    return latest && latest.phaseId === plan.phaseId ? latest : null;
  }

  function change(next: (doc: SessionDoc) => SessionDoc) {
    const now = current();
    if (!now) return;
    const changed = next(now);
    if (changed !== now) putSession(changed);
  }

  function start(feelBefore: number | null, choice: SplitChoice) {
    unlockSound();
    // Hands-free starts listening at the Start tap (the founder's call: on
    // once, then every workout).
    if (isHandsFreeOn()) listen();
    // A Try still talking stops: the first exercise's line is next.
    silence();
    const other = openSessionFor(readSessions(), plan.programId);
    if (other && other.phaseId !== plan.phaseId) {
      // Starting here ends the other one where its last set was, keeping it all.
      putSession(finishSession(other, { feelAfter: other.feelAfter, now: new Date(lastActivity(other)) }));
    }
    if (current()) return;
    putSession(
      beginSession(plan, { id: newId(), now: new Date(), feelBefore, aim: aimFor(earlier, choice) }),
    );
  }

  async function finish(feelAfter: number | null) {
    const now = current();
    if (!now) return;
    setLeaving(true);
    stopListening();
    putSession(finishSession(now, { feelAfter, now: new Date() }));
    const result = await Promise.race([
      sendPending(),
      new Promise<"offline">((resolve) => window.setTimeout(() => resolve("offline"), 6_000)),
    ]);
    if (result === "sent") toast.success("Session saved");
    else toast.message("Session kept on this phone. It will be sent when there is signal.");
    router.push(programHref);
    router.refresh();
  }

  let body: ReactNode;
  let where = "Today's session";
  /** A set with a demo: the one view that spreads out on a wide screen. */
  let wide = false;
  /** A set or the check after one: where a phrase has something to do (F6). */
  let commandsHere = false;
  if (leaving) {
    body = (
      <p className="flex items-center justify-center gap-2 py-24 text-lg">
        <Loader2 className="size-5 animate-spin" aria-hidden /> Saving your session…
      </p>
    );
  } else if (!doc) {
    body = (
      <BeforeView
        plan={plan}
        day={earlier}
        hourOf={(iso) => hourIn(timeZone, iso)}
        elsewhere={elsewhere}
        voice={naturalVoice ? voice : null}
        quiet={quiet}
        handsFree={listenable ? { on: handsFreeOn, onChange: setHandsFreeOn } : null}
        onStart={start}
      />
    );
  } else {
    const step = nextStep(plan, doc);
    if (step.kind !== "finish") where = `Exercise ${step.itemIndex + 1} of ${plan.items.length}`;
    wide = step.kind === "set" && plan.items[step.itemIndex].video !== null;
    commandsHere = step.kind !== "finish";
    body =
      step.kind === "set" ? (
        // One per exercise, so the demo keeps playing from set to set.
        <SetView
          key={step.itemIndex}
          plan={plan}
          doc={doc}
          step={step}
          onFinishSet={(itemIndex, count) =>
            change((d) =>
              recordSet(plan, d, { itemIndex, count, setId: newId(), exerciseId: newId(), now: new Date() }),
            )
          }
          onSkip={(itemIndex) =>
            change((d) => skipExercise(plan, d, { itemIndex, exerciseId: newId(), now: new Date() }))
          }
          handsFree={handsFreeView}
        />
      ) : step.kind === "check" ? (
        <CheckView
          key={step.itemIndex}
          plan={plan}
          doc={doc}
          itemIndex={step.itemIndex}
          onOneMore={() => change((d) => oneMoreSet(plan, d, step.itemIndex))}
          onDone={(answers) =>
            change((d) => finishExercise(plan, d, { itemIndex: step.itemIndex, ...answers, now: new Date() }))
          }
          handsFree={handsFreeView}
        />
      ) : (
        // The session's own day, with it in: what the day comes to after it.
        <FinishView doc={doc} day={dayOf(dayItems, doc.localDay, recent, phoneDocs)} onFinish={finish} />
      );
  }

  return (
    // Any tap unlocks sound: a browser only lets audio start from one, and a
    // session resumed after a reload has had no Start tap to do it. For the
    // same reason it starts hands-free listening again (F6) on such a session.
    <div
      className="dark fixed inset-0 z-50 overflow-y-auto bg-background text-foreground"
      onPointerDown={() => {
        unlockSound();
        // Not at the finish: the tap there is for how you feel, and nothing is
        // left to say.
        if (commandsHere && handsFreeOn && listener.status === "off") listen();
      }}
    >
      <div
        className={cn(
          "mx-auto flex min-h-full w-full flex-col gap-5 px-4 pt-3 pb-10",
          wide ? "max-w-2xl lg:max-w-[120rem]" : "max-w-md",
        )}
      >
        <TopBar
          where={where}
          programHref={programHref}
          sync={sync}
          naturalVoice={naturalVoice}
          handsFree={listenable && doc && !leaving ? { on: handsFreeOn, onChange: turnHandsFree } : null}
        />
        {body}
      </div>
    </div>
  );
}

/** Nothing to subscribe to: whether this browser can listen does not change while the page is open. */
const subscribeToNothing = () => () => {};

/** The hands-free switch (F6): on or off, from the start screen or the top bar. */
interface HandsFreeSwitch {
  on: boolean;
  onChange: (on: boolean) => void;
}

function TopBar({
  where,
  programHref,
  sync,
  naturalVoice,
  handsFree,
}: {
  where: string;
  programHref: string;
  sync: SyncState;
  naturalVoice: boolean;
  /** During a session, on a phone that can listen: hands-free on or off from here. */
  handsFree: HandsFreeSwitch | null;
}) {
  const muted = useSyncExternalStore(subscribeMuted, isMuted, mutedOnTheServer);
  const voiceOff = useSyncExternalStore(subscribeMuted, isVoiceOff, voiceOffOnTheServer);
  // A phone that has shown it cannot speak loses the switch rather than keep
  // one that does nothing. With the recorded voice there is always one.
  const devicesVoice = useSyncExternalStore(subscribeVoice, canSpeak, noVoiceOnTheServer);
  const speakable = devicesVoice || naturalVoice;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Leave. The session stays open to come back to.">
          <Link href={programHref}>
            <X className="size-5" aria-hidden />
          </Link>
        </Button>
        {/* Where, and under it whether it is saved: beside three switches on a
            phone's width, the two side by side wrapped onto four lines. */}
        <div className="flex min-w-0 flex-col items-center text-center leading-tight">
          <span className="text-sm text-muted-foreground">{where}</span>
          <span className="flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground" aria-live="polite">
            {sync.status === "saved" ? (
              <>
                <Check className="size-3.5" aria-hidden /> Saved
              </>
            ) : sync.status === "saving" ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving
              </>
            ) : (
              <>
                <CloudOff className="size-3.5" aria-hidden /> Kept on this phone
              </>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {handsFree && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={handsFree.on ? "Turn hands-free off" : "Turn hands-free on"}
              aria-pressed={handsFree.on}
              onClick={() => handsFree.onChange(!handsFree.on)}
              className={handsFree.on ? "text-module-accent" : undefined}
            >
              {handsFree.on ? <Mic className="size-5" aria-hidden /> : <MicOff className="size-5" aria-hidden />}
            </Button>
          )}
          {speakable && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={voiceOff ? "Turn the coach's voice on" : "Turn the coach's voice off"}
              aria-pressed={!voiceOff}
              onClick={() => setVoiceOff(!voiceOff)}
            >
              {voiceOff ? (
                <MegaphoneOff className="size-5" aria-hidden />
              ) : (
                <Megaphone className="size-5" aria-hidden />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={muted ? "Turn sounds on" : "Turn sounds off"}
            aria-pressed={!muted}
            onClick={() => setMuted(!muted)}
          >
            {muted ? <VolumeX className="size-5" aria-hidden /> : <Volume2 className="size-5" aria-hidden />}
          </Button>
          <HelpButton />
        </div>
      </div>
      {sync.refused && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {sync.refused}
        </p>
      )}
    </div>
  );
}

/**
 * THE START: the feel check, and on a split day (F2c) what the day's other
 * sessions did and what this one sets out to do. "Half now" does the first
 * share of every exercise's sets; a session later that day lists only what
 * is left; a day already complete offers another session, which counts too.
 *
 * And the coach's voice (F2d): which of the recorded voices, with Try to hear
 * it say the first exercise's line. The session's lines are fetched here,
 * while the feel check is answered, so the first one is ready at Start.
 */
function BeforeView({
  plan,
  day,
  hourOf,
  elsewhere,
  voice,
  quiet,
  handsFree,
  onStart,
}: {
  plan: SessionPlan;
  /** The day so far, without this session (core/day.ts). */
  day: DayProgress;
  /** The hour a session started, on the space's clock. */
  hourOf: (iso: string) => number;
  elsewhere: SessionDoc | null;
  /** The recorded voice chosen on this phone; null when the platform has none. */
  voice: RecordedVoice | null;
  /** The sounds or the coach's voice are switched off. */
  quiet: boolean;
  /** Hands-free (F6), on a phone that can listen. */
  handsFree: HandsFreeSwitch | null;
  onStart: (feelBefore: number | null, choice: SplitChoice) => void;
}) {
  const [feel, setFeel] = useState<number | null>(null);
  const [half, setHalf] = useState(false);
  const otherPhase = elsewhere ? plan.phases.findIndex((phase) => phase.id === elsewhere.phaseId) : -1;
  const started = day.parts.length > 0;
  const halving = canHalve(day);
  const choice: SplitChoice = day.complete ? "again" : half && halving ? "half" : "all";
  const aims = aimFor(day, choice);

  /** The session as Start would begin it: what its lines will be. */
  function ahead(): SessionDoc {
    return beginSession(plan, { id: "ahead", now: new Date(), feelBefore: null, aim: aims });
  }
  const fetchAhead = useEffectEvent(() => {
    if (voice && !quiet) prefetchLines([...sessionLines(plan, ahead()), ...(handsFree?.on ? replyLines() : [])]);
  });
  useEffect(() => {
    fetchAhead();
  }, [choice, voice, quiet, handsFree?.on]);

  function tryVoice() {
    const doc = ahead();
    const step = nextStep(plan, doc);
    tryCoachVoice(step.kind === "set" ? setIntro(plan, doc, step).text : EXERCISE_DONE.text);
  }
  return (
    <div className="flex flex-1 flex-col gap-5">
      <div>
        <p className="text-sm text-muted-foreground">{plan.programName}</p>
        <h1 className="font-heading text-2xl font-medium">
          {day.complete ? "Today's sets are done" : started ? "The rest of today" : "Today's session"}
        </h1>
        <p className="text-muted-foreground">
          {plan.phaseName} · {countOf(plan.items.length, "exercise", "exercises")}
        </p>
      </div>
      {started && (
        <ul className="space-y-1 rounded-xl bg-card px-3 py-2">
          {day.parts.map((part) => (
            <li key={part.id} className="flex items-center gap-2">
              <Check className="size-4 shrink-0 text-module-accent" aria-hidden />
              {`${partOfDay(hourOf(part.startedAt))} · ${countOf(part.sets, "set", "sets")} · ${countOf(part.minutes, "minute", "minutes")}${part.finished ? "" : " · not finished"}`}
            </li>
          ))}
        </ul>
      )}
      {day.complete && (
        <p className="text-sm text-muted-foreground">
          Every exercise has had its sets today. Another session is extra, and it is logged too.
        </p>
      )}
      {elsewhere && (
        <div className="rounded-xl border border-border bg-card p-3 text-sm">
          A session for {elsewhere.phaseName || "another phase"} is still open.{" "}
          {otherPhase >= 0 && (
            <Link className="font-medium text-module-accent underline" href={`?phase=${otherPhase + 1}`}>
              Go back to it
            </Link>
          )}
          {otherPhase >= 0 ? ". " : ""}Starting this one ends it, keeping everything you did in it.
        </div>
      )}
      <FeelScale label="How does your body feel right now?" value={feel} onChange={setFeel} />
      {voice && (
        <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
          <Megaphone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <label htmlFor="coach-voice" className="text-sm">
            Coach&apos;s voice
          </label>
          <select
            id="coach-voice"
            value={voice}
            onChange={(e) => {
              if (isRecordedVoice(e.target.value)) setCoachVoice(e.target.value);
            }}
            className="ml-auto h-10 min-w-0 rounded-md border border-input bg-background px-2 text-sm [color-scheme:dark]"
          >
            {RECORDED_VOICES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" className="h-10" onClick={tryVoice}>
            <Play aria-hidden /> Try
          </Button>
        </div>
      )}
      {handsFree && (
        // F6: turned on once, and every workout after listens from its Start.
        <div className="flex items-start gap-3 rounded-xl border border-border px-3 py-2">
          <Switch
            id="hands-free"
            className="mt-0.5"
            checked={handsFree.on}
            onCheckedChange={(on) => handsFree.onChange(on)}
          />
          <label htmlFor="hands-free" className="space-y-0.5 text-sm">
            <span className="block font-medium">Hands-free</span>
            <span className="block text-muted-foreground">
              {`Say “start set”, “set done” and the rest while you are on the floor. It listens on this phone, and nothing you say leaves it. The first time, it downloads ${LISTENER_DOWNLOAD_WORDS}.`}
            </span>
          </label>
        </div>
      )}
      {halving && (
        <fieldset className="space-y-2">
          <legend className="text-base">How much now?</legend>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={half ? "outline" : "default"}
              aria-pressed={!half}
              className="h-auto min-h-11 py-2 whitespace-normal"
              onClick={() => setHalf(false)}
            >
              {started ? "All that's left" : "All of it"}
            </Button>
            <Button
              type="button"
              variant={half ? "default" : "outline"}
              aria-pressed={half}
              className="h-auto min-h-11 py-2 whitespace-normal"
              onClick={() => setHalf(true)}
            >
              Half now, the rest later today
            </Button>
          </div>
        </fieldset>
      )}
      <ol className="space-y-1 text-sm text-muted-foreground">
        {plan.items.map((item, i) => {
          const doneToday = aims[i].sets === 0;
          return (
            <li key={item.itemId} className="flex justify-between gap-3">
              <span className="flex items-start gap-1.5">
                {doneToday && <Check className="mt-0.5 size-3.5 shrink-0 text-module-accent" aria-hidden />}
                <span>
                  {`${i + 1}. ${item.name}`}
                  {item.optional ? " (optional)" : ""}
                  {item.onlySide && (
                    // One side only (F4b): which, before the session starts.
                    <span className="block text-xs text-module-accent">
                      {oneSideWords(item.sideMeans ?? "side", item.onlySide)}
                    </span>
                  )}
                  {item.level && (
                    // An exercise with levels (F4c): the person's.
                    <span className="block text-xs text-module-accent">
                      {`${item.level.name} of ${item.level.count}`}
                    </span>
                  )}
                </span>
              </span>
              <span className={cn("shrink-0", !doneToday && "text-foreground")}>
                {aimWords(item, day.items[i], aims[i], choice)}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="flex-1" />
      <Button size="lg" className="h-14 w-full text-lg" onClick={() => onStart(feel, choice)}>
        <Play aria-hidden /> {day.complete ? "Start another session" : started ? "Start the rest" : "Start"}
      </Button>
    </div>
  );
}

function SetView({
  plan,
  doc,
  step,
  onFinishSet,
  onSkip,
  handsFree,
}: {
  plan: SessionPlan;
  doc: SessionDoc;
  step: Extract<Step, { kind: "set" }>;
  onFinishSet: (itemIndex: number, count: number) => void;
  onSkip: (itemIndex: number) => void;
  handsFree: HandsFreeView | null;
}) {
  const item = plan.items[step.itemIndex];
  const logged = loggedFor(doc, item);
  const planned = logged?.plannedSets ?? plannedFor(doc, item).sets;
  const done = logged?.sets.length ?? 0;
  // One side only (F4b), as the exercise was started: one begun on both sides
  // before the side was saved finishes on both.
  const only = logged ? (logged.onlySide ?? null) : (item.onlySide ?? null);
  const side = only ? oneSideWords(item.sideMeans ?? "side", only) : sideWords(step.side);
  const cue = cueFor(item, done);
  const key = `${step.itemIndex}-${step.number}-${step.side ?? "both"}`;
  const max = item.targetMax ?? item.targetMin;
  const finishSet = (count: number) => onFinishSet(step.itemIndex, count);
  const demo = useRef<DemoHandle>(null);
  // A set beginning to run quiets a demo playing with sound.
  const quietDemo = () => demo.current?.quiet();

  // Each set says what it is as it appears, and only then: an effect event,
  // so a save's status changing never says it again.
  const announce = useEffectEvent(() => coachSay(setIntro(plan, doc, step)));
  useEffect(() => {
    announce();
  }, [key]);

  // Hands-free (F6): the set's own control takes start, done, pause and
  // resume; "repeat" says the set again, and the check's two wait for its end.
  useWorkoutCommands((command) => {
    if (command === "repeat") coachSay(setIntro(plan, doc, step));
    else if (command === "again" || command === "next") coachSay(REPLY.finishFirst);
    else return false;
    return true;
  });

  // Its "Not yet: 3 of 5 breaths." lines, fetched ahead: once per exercise.
  const timed = item.unit === "breaths" || item.unit === "seconds";
  const listening = !!handsFree?.on;
  useEffect(() => {
    if (timed && listening) prefetchLines(notYetLines(item.targetMin, item.unit));
  }, [timed, listening, item.targetMin, item.unit]);

  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-5",
        // A wide screen (F2d): the demo on the left, the set on the right.
        item.video && "lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-x-8",
      )}
    >
      {item.video && (
        // As wide as the window's height allows a 16:9 demo to be, with the
        // top bar and the demo's own buttons still on screen; never narrower
        // than the phone's column made it, which a phone on its side would be.
        <div className="mx-auto w-full max-w-[max(26rem,calc((100dvh_-_12rem)*16/9))]">
          <DemoLoop
            key={`${item.video.id}-${item.video.startS}-${item.video.endS}`}
            ref={demo}
            video={item.video}
            title={item.name}
          />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-5">
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-medium">
            {item.name}
            {item.optional && (
              <Badge variant="outline" className="ml-2 align-middle">
                Optional
              </Badge>
            )}
          </h1>
          {item.level && (
            // An exercise with levels (F4c): the level it is done at.
            <p className="text-sm font-medium text-module-accent">{`${item.level.name} of ${item.level.count}`}</p>
          )}
          <p className="text-muted-foreground">
            Set {step.number} of {planned}
            {side && (
              <>
                {" · "}
                <span className="font-medium text-module-accent">{side}</span>
              </>
            )}
            {" · "}
            {prescription({ ...item, perSide: logged?.perSide ?? item.perSide })}
          </p>
          {only && plan.lean && (
            <p className="text-sm text-muted-foreground">{`One side only: you lean ${plan.lean}.`}</p>
          )}
        </div>

        {item.unit === "breaths" ? (
          <BreathPacer
            key={key}
            outS={plan.breath.outS}
            inS={plan.breath.inS}
            min={item.targetMin}
            max={max}
            autoStart={done > 0}
            onFinish={finishSet}
            onBegin={quietDemo}
            onBreath={(n) => coachSay(breathLine(n, max, cue))}
          />
        ) : item.unit === "seconds" ? (
          <HoldTimer
            key={key}
            min={item.targetMin}
            max={max}
            autoStart={done > 0}
            onFinish={finishSet}
            onBegin={quietDemo}
            onSecond={(elapsed) => coachSay(holdLine(elapsed, max, cue))}
          />
        ) : (
          <ConfirmCount
            key={key}
            target={item.targetMin}
            // With levels (F4c), where the set before got to.
            start={item.level && logged && done > 0 ? logged.sets[done - 1].count : item.targetMin}
            unit={item.unit}
            onFinish={finishSet}
          />
        )}

        <HandsFreeHint
          place={item.unit === "breaths" || item.unit === "seconds" ? "timed-set" : "counted-set"}
          view={handsFree}
        />
        {cue && <p className="text-center text-lg leading-snug">{cue}</p>}
        {item.notes && <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm">{item.notes}</p>}
        <div className="flex-1" />
        <Button variant="ghost" className="self-center" onClick={() => onSkip(step.itemIndex)}>
          <SkipForward aria-hidden /> Skip this exercise
        </Button>
      </div>
    </div>
  );
}

const HURT_CHOICES: { value: Hurt; label: string }[] = [
  { value: "none", label: "No" },
  { value: "pinch", label: "A pinch" },
  { value: "yes", label: "Yes" },
];

function CheckView({
  plan,
  doc,
  itemIndex,
  onOneMore,
  onDone,
  handsFree,
}: {
  plan: SessionPlan;
  doc: SessionDoc;
  itemIndex: number;
  onOneMore: () => void;
  onDone: (answers: {
    effort: number | null;
    cuesFelt: string[];
    hurt: Hurt | null;
    hurtNote: string;
    levelUp: boolean;
  }) => void;
  handsFree: HandsFreeView | null;
}) {
  const item = plan.items[itemIndex];
  const [effort, setEffort] = useState<number | null>(null);
  const [felt, setFelt] = useState<string[]>([]);
  const [hurt, setHurt] = useState<Hurt | null>(null);
  const [hurtNote, setHurtNote] = useState("");
  const [choice, setChoice] = useState<"up" | "stay" | null>(null);
  const next = plan.items[itemIndex + 1];
  const zone = plan.effort;
  // An exercise with levels (F4c): the mark made at the level it was done at,
  // judged on these sets and these answers, and the choice to move up.
  const logged = loggedFor(doc, item);
  const level = item.level;
  const made =
    !!level?.next &&
    !!logged &&
    logged.level === level.index &&
    markMade(level.mark, { perSide: logged.perSide, sets: logged.sets, effort, hurt }, zone?.max ?? null);
  // A timed set can end with the person on the floor: this is the word to
  // pick up the phone.
  useEffect(() => {
    coachSay(EXERCISE_DONE);
  }, []);

  const moreAllowed = canAddSet(plan, doc, itemIndex);
  function moveOn() {
    onDone({ effort, cuesFelt: felt, hurt, hurtNote, levelUp: made && choice === "up" });
  }

  // Hands-free (F6): "one more set" and "next exercise" are the two buttons;
  // "next exercise" keeps the taps as they were left (the founder's call).
  // Anything else gets told what can be said here.
  useWorkoutCommands((command) => {
    if (command === "again" && moreAllowed) onOneMore();
    else if (command === "again") coachSay(REPLY.noMore);
    else if (command === "next") moveOn();
    else coachSay(moreAllowed ? REPLY.checkPrompt : REPLY.checkPromptFull);
    return true;
  });

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div>
        <p className="text-sm text-muted-foreground">Done</p>
        <h1 className="font-heading text-xl font-medium">{item.name}</h1>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-base">How hard was that?</legend>
        <div className="grid grid-cols-10 gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
            const inZone = zone && n >= zone.min && n <= zone.max;
            const over = zone && n > zone.max;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={effort === n}
                onClick={() => setEffort(effort === n ? null : n)}
                className={cn(
                  "h-11 rounded-md border text-sm tabular-nums",
                  effort === n
                    ? "border-module-accent bg-module-accent text-white"
                    : inZone
                      ? "border-module-accent/70 bg-card"
                      : over
                        ? "border-warning/60 bg-card"
                        : "border-border bg-card",
                )}
              >
                {n}
              </button>
            );
          })}
        </div>
        {zone && (
          <p className="text-sm text-muted-foreground">
            {/* One string: the compiled JSX dropped the space between an expression
                and the text after it here ("3–5is"), seen on the first drive. */}
            {`${zone.min === zone.max ? zone.min : `${zone.min}–${zone.max}`} is the program's zone.`}
            {effort !== null && effort > zone.max && (
              <span className="text-warning-foreground"> That is harder than it asks for.</span>
            )}
          </p>
        )}
      </fieldset>

      {item.cues.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-base">What did you feel?</legend>
          {item.cues.map((cue) => (
            <label key={cue} className="flex items-start gap-3 text-base">
              <input
                type="checkbox"
                className="mt-1 size-5 accent-[var(--module-accent)]"
                checked={felt.includes(cue)}
                onChange={(e) => setFelt(e.target.checked ? [...felt, cue] : felt.filter((c) => c !== cue))}
              />
              {cue}
            </label>
          ))}
        </fieldset>
      )}

      <fieldset className="space-y-2">
        <legend className="text-base">Anything hurt?</legend>
        <div className="grid grid-cols-3 gap-2">
          {HURT_CHOICES.map((choice) => (
            <Button
              key={choice.value}
              type="button"
              variant={hurt === choice.value ? "default" : "outline"}
              aria-pressed={hurt === choice.value}
              className="h-11"
              onClick={() => setHurt(hurt === choice.value ? null : choice.value)}
            >
              {choice.label}
            </Button>
          ))}
        </div>
        {hurt && hurt !== "none" && (
          <Input
            value={hurtNote}
            onChange={(e) => setHurtNote(e.target.value)}
            placeholder="Where, and what it felt like"
            aria-label="Where it hurt, and what it felt like"
            maxLength={500}
          />
        )}
      </fieldset>

      {made && level?.next && (
        <div className="space-y-2 rounded-xl bg-module-accent/10 p-3 text-sm">
          <p className="flex items-start gap-2">
            <TrendingUp className="mt-0.5 size-4 shrink-0 text-module-accent" aria-hidden />
            {`${madeWords(level.mark, level.name, effort)} That's the program's mark to move on.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={choice === "up" ? "default" : "outline"}
              aria-pressed={choice === "up"}
              onClick={() => setChoice(choice === "up" ? null : "up")}
            >
              {`Move up to ${level.next}`}
            </Button>
            <Button
              size="sm"
              variant={choice === "stay" ? "secondary" : "ghost"}
              aria-pressed={choice === "stay"}
              onClick={() => setChoice(choice === "stay" ? null : "stay")}
            >
              Not yet
            </Button>
          </div>
          {choice === "up" && <p className="text-muted-foreground">{`${level.next} from your next session.`}</p>}
          {choice === "stay" && (
            <p className="text-muted-foreground">{`Staying at ${level.name}. The program page keeps the suggestion.`}</p>
          )}
        </div>
      )}

      <div className="flex-1" />
      <HandsFreeHint place={moreAllowed ? "check" : "check-full"} view={handsFree} />
      {moreAllowed && (
        <Button variant="outline" size="lg" className="h-12 w-full" onClick={onOneMore}>
          <Plus aria-hidden /> One more set
        </Button>
      )}
      <Button size="lg" className="h-14 w-full text-lg" onClick={moveOn}>
        {next ? `Next: ${next.name}` : "On to the finish"}
      </Button>
    </div>
  );
}

function FinishView({
  doc,
  day,
  onFinish,
}: {
  doc: SessionDoc;
  /** The day with this session in it (F2c): whether it is complete, or what is left. */
  day: DayProgress;
  onFinish: (feelAfter: number | null) => void;
}) {
  const [feel, setFeel] = useState<number | null>(null);
  const summary = sessionSummary(doc);
  // Hands-free (F6): the finish wants a tap for how you feel; a phrase is told so.
  useWorkoutCommands(() => {
    coachSay(REPLY.finish);
    return true;
  });
  return (
    <div className="flex flex-1 flex-col gap-5">
      <h1 className="font-heading text-2xl font-medium">Session done</h1>
      {day.complete ? (
        <p className="flex items-center gap-2 rounded-xl bg-card px-3 py-2">
          <Check className="size-4 shrink-0 text-module-accent" aria-hidden /> That is every set today asks for.
        </p>
      ) : day.done > 0 && day.left > 0 ? (
        <p className="rounded-xl bg-card px-3 py-2">
          {`Still to do today: ${countOf(day.left, "set", "sets")}. Start again later today and it picks up here.`}
        </p>
      ) : null}
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { n: summary.exercises, label: summary.exercises === 1 ? "exercise" : "exercises" },
          { n: summary.sets, label: summary.sets === 1 ? "set" : "sets" },
          { n: summary.minutes, label: summary.minutes === 1 ? "minute" : "minutes" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl bg-card px-2 py-3">
            <div className="text-2xl font-medium tabular-nums">{stat.n}</div>
            <div className="text-xs text-muted-foreground">{stat.label}</div>
          </div>
        ))}
      </div>
      <FeelScale label="How does your body feel now?" value={feel} onChange={setFeel} />
      {doc.feelBefore !== null && feel !== null && (
        <p className="rounded-xl bg-card px-3 py-2">
          Before {doc.feelBefore}, after {feel}.
        </p>
      )}
      <div className="flex-1" />
      <Button size="lg" className="h-14 w-full text-lg" onClick={() => onFinish(feel)}>
        <Check aria-hidden /> Finish
      </Button>
    </div>
  );
}
