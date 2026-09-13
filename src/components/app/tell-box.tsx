"use client";

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/app/panel";
import { DictateButton } from "@/components/app/dictate-button";
import {
  canSpeak,
  isHushed,
  noVoiceOnTheServer,
  sayIt,
  setHushed,
  spokenConfirmation,
  subscribeHush,
  subscribeNever,
} from "@/lib/speech/say";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  proposeTellAction,
  recordTellAction,
} from "@/lib/tell-sources/actions";
import {
  checkEntry,
  readyToRecordUnasked,
  TELL_MAX_CHARS,
  type TellCard,
} from "@/lib/tell-sources/shape";
import type {
  TellCandidate,
  TellField,
  TellValue,
} from "@/lib/tell-sources/types";
import { cn } from "@/lib/utils";

const NONE = "__none__";

interface ActionView {
  slug: string;
  title: string;
  label: string;
  fields: Array<TellField & { searched?: boolean }>;
  unattended: boolean;
}

/**
 * Say what happened, in one sentence (onboarding slice 6).
 *
 * THE CARDS ARE THE FEATURE, not a courtesy. Nothing is written until
 * somebody has read every one and pressed the button — the reading returns
 * cards and the record call takes only what is still here, as edited. A
 * sentence misread cannot reach the herd.
 *
 * BUILT FOR A PHONE IN A BARN: the box is three lines and always visible, the
 * cards stack, every field is full width, and the button says how many things
 * it is about to record. Nothing here knows what a pen or a paddock is — the
 * fields, the choices and the words all come from the pack that declared the
 * action.
 */
export function TellBox({
  placeholder,
  speechConfigured = false,
  autoListen = false,
  onRecorded,
  labelHidden = false,
  said,
  phoneListening = false,
}: {
  placeholder?: string;
  /** Start listening as soon as this mounts — the launcher's press was the tap. */
  autoListen?: boolean;
  /**
   * A sentence somebody has ALREADY said, captured elsewhere — by the phone's
   * own recogniser before this page existed (`MainActivity`). It arrives in
   * the box and is read straight away, exactly as if it had been dictated
   * here: the same cards, the same confirmations, the same rule about what
   * records itself.
   */
  said?: string;
  /**
   * The PHONE's microphone is open right now, captured by the shell before
   * this page existed. Shown as a state rather than a control: there is
   * nothing to press, because the recording is not this page's to stop.
   */
  phoneListening?: boolean;
  /** Told after anything is recorded, so a sheet can close itself. */
  onRecorded?: () => void;
  /**
   * Keep the label for a screen reader and take it off the screen. For the
   * launcher's sheet, which already says this in its own heading — the words
   * twice, six lines apart, read as two different boxes.
   */
  labelHidden?: boolean;
  /**
   * A speech vendor is set up on the server. Answered by the PAGE, because it
   * is a fact about the deployment and a client component cannot read an
   * environment variable. False means the mic falls back to the phone's own
   * engine, or to nothing.
   */
  speechConfigured?: boolean;
}) {
  const router = useRouter();
  const [sentence, setSentence] = useState("");
  const [cards, setCards] = useState<TellCard[] | null>(null);
  const [actions, setActions] = useState<ActionView[]>([]);
  const [reading, startReading] = useTransition();
  const [saving, startSaving] = useTransition();

  /*
   * ── SAYING IT BACK (tell.md, slice D1) ───────────────────────────────────
   *
   * **IT ONLY SPEAKS WHEN IT WAS SPOKEN TO.** A ref rather than state because
   * nothing renders from it and a re-render on every keystroke to track how
   * the words arrived would be paying for a fact only two callbacks read.
   *
   * Set where words arrive by voice, cleared the moment somebody types —
   * because somebody typing is somebody looking, and talking at them is the
   * noise that gets a feature switched off.
   */
  const spoken = useRef(false);
  const speak = (text: string) => {
    if (spoken.current) sayIt(text);
  };

  // Both are browser facts with no server answer, so they are read as a
  // store rather than pulled into state by an effect — see `say.ts`. The
  // server snapshot is "no voice", which is also what a browser without one
  // reports, so the first paint is the same either way.
  const canHear = useSyncExternalStore(subscribeNever, canSpeak, noVoiceOnTheServer);
  const hushed = useSyncExternalStore(subscribeHush, isHushed, noVoiceOnTheServer);

  /*
   * WORDS THAT ARRIVED FROM OUTSIDE are read once, during render, for the
   * reason the url is: an effect would paint an empty box and then fill it.
   * The box is remounted per sentence by its `key`, so this runs once per
   * thing said rather than once per component.
   */
  const [took, setTook] = useState(false);
  if (said && !took) {
    setTook(true);
    setSentence(said);
    // Everything that reaches this prop came through a microphone — the
    // shell's launcher, the app's `yosher://tell`, the home-screen shortcut.
    // Somebody who spoke into their pocket is the person who most needs to be
    // answered out loud.
    spoken.current = true;
    read(said);
  }

  const actionOf = (slug: string) => actions.find((a) => a.slug === slug);
  const problems = (cards ?? []).map((c) => {
    const action = actionOf(c.actionSlug);
    return action ? checkEntry(c.values, action as never) : "That is not something you can record here.";
  });
  const ready = (cards?.length ?? 0) > 0 && problems.every((p) => p === null);

  function reset() {
    setSentence("");
    setCards(null);
    setActions([]);
  }

  function read(said = sentence) {
    if (said.trim() === "") return;
    startReading(async () => {
      const result = await proposeTellAction({ sentence: said });
      if ("error" in result) {
        toast.error(result.error);
        // A refusal is the one thing somebody walking away must not miss.
        speak(result.error);
        return;
      }
      const view = result.data.actions as ActionView[];
      setActions(view);
      setCards(result.data.cards);
      if (result.data.cards.length === 0) {
        // An explicit message, not an empty panel: "nothing found" and "it
        // broke" must not look the same.
        toast.info("Nothing to record from that.");
        speak("Nothing to record from that.");
        return;
      }
      // ADR 0050 — straight through when every card is a complete one of an
      // action that declared itself safe to record unasked. Four taps to start
      // a clock is worse than the screen it replaces.
      if (readyToRecordUnasked(result.data.cards, view)) {
        save(result.data.cards);
      }
    });
  }

  function save(what: TellCard[] | null = cards) {
    if (!what || what.length === 0) return;
    startSaving(async () => {
      const result = await recordTellAction({
        entries: what.map((c) => ({ actionSlug: c.actionSlug, values: c.values })),
      });
      if ("error" in result) {
        toast.error(result.error);
        speak(result.error);
        return;
      }
      const n = result.data.summaries.length;
      toast.success(
        n === 1 ? result.data.summaries[0] : `Recorded ${n} things`,
      );
      // NOT the toast's own words. The toast counts past one because a stack
      // of them is unreadable; a voice has no such problem, and hearing all
      // three answers to "pen one fine, pen two fine, pen three the water was
      // frozen" is the whole reason somebody said it in one breath.
      speak(spokenConfirmation(result.data.summaries));
      reset();
      router.refresh();
      onRecorded?.();
    });
  }

  function setValue(i: number, key: string, value: TellValue) {
    if (!cards) return;
    setCards(
      cards.map((c, j) => {
        if (j !== i) return c;
        const hints = { ...c.hints };
        delete hints[key];
        const options = { ...(c.options ?? {}) };
        delete options[key];
        return { ...c, values: { ...c.values, [key]: value }, hints, options };
      }),
    );
  }

  return (
    <Panel className="p-4">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label
            htmlFor="tell-sentence"
            className={cn("text-sm font-medium", labelHidden && "sr-only")}
          >
            Tell it what happened
          </Label>
          <Textarea
            id="tell-sentence"
            value={sentence}
            onChange={(e) => {
              setSentence(e.target.value);
              // Typing is looking. From here on the screen is the answer.
              spoken.current = false;
            }}
            rows={2}
            maxLength={TELL_MAX_CHARS}
            placeholder={placeholder ?? "Three chicks dead in pen two"}
          />
        </div>

        {phoneListening ? (
          // No buttons at all. The recording belongs to the shell, and a Stop
          // this page cannot honour would be a lie.
          <p className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            <span className="relative flex size-2.5 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
            </span>
            Listening&hellip; stop talking when you are done.
          </p>
        ) : cards === null ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* Dictation only ever produces TEXT, which lands in the box above
                exactly as if it had been typed. The reading step, the cards and
                the button are unchanged — saying it out loud is not a second
                way to write to the herd (ADR 0039). */}
            {/* ONLY ONCE IT HAS AN ENGINE TO SILENCE. A control that does
                nothing is worse than an absent one, and a browser with no
                speech synthesis would render exactly that. */}
            {canHear && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={hushed}
                title={
                  hushed
                    ? "Answers are shown, not read out"
                    : "Answers are read out when you speak"
                }
                onClick={() => setHushed(!hushed)}
              >
                {hushed ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                <span className="sr-only">
                  {hushed ? "Read answers out loud" : "Stop reading answers out loud"}
                </span>
              </Button>
            )}
            <DictateButton
              serverConfigured={speechConfigured}
              startOnMount={autoListen}
              disabled={reading}
              onText={(said) => {
                // Spoken, so it will be answered out loud.
                spoken.current = true;
                // STRAIGHT INTO THE READING. Somebody who has just spoken a
                // sentence has already committed to it; making them press a
                // second button to have it read is a tap that asks nothing.
                const combined =
                  sentence.trim() === "" ? said : `${sentence.trim()} ${said}`;
                setSentence(combined);
                read(combined);
              }}
            />
            <Button onClick={() => read()} disabled={reading || sentence.trim() === ""} size="sm">
              {reading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" /> Reading…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 size-4" /> Read it
                </>
              )}
            </Button>
          </div>
        ) : (
          <>
            {cards.length === 0 ? (
              <div className="space-y-2 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                <p>Nothing to record from that.</p>
                {/* WHAT IT CAN DO, not just what it could not. The first
                    version said only the second, and somebody whose sentence
                    matched nothing had no way to find out whether they had
                    said it wrong or asked for something this workspace does
                    not offer them — which is exactly what happened with
                    "clock me in" on a person no worker record was linked to. */}
                {actions.length > 0 ? (
                  <p>
                    Right now you can tell it about:{" "}
                    <span className="text-foreground">
                      {actions.map((a) => a.title.toLowerCase()).join(", ")}
                    </span>
                    .
                  </p>
                ) : (
                  <p>
                    Nothing in this workspace is set up to be told things yet.
                  </p>
                )}
              </div>
            ) : (
              <ul className="space-y-3">
                {cards.map((card, i) => {
                  const action = actionOf(card.actionSlug);
                  if (!action) return null;
                  return (
                    <li key={i} className="space-y-3 rounded-md border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{action.title}</p>
                          <p className="text-xs text-muted-foreground">{action.label}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0"
                          onClick={() => setCards(cards.filter((_, j) => j !== i))}
                        >
                          <X className="size-4" />
                          <span className="sr-only">Drop this</span>
                        </Button>
                      </div>

                      <div className="grid gap-2">
                        {action.fields.map((f) => (
                          <div key={f.key} className="space-y-1">
                            <Label htmlFor={`tell-${i}-${f.key}`} className="text-xs">
                              {f.label}
                              {f.required && <span aria-hidden> *</span>}
                            </Label>
                            {f.searched ? (
                              /*
                               * SEARCHED FIELDS DRAW WHAT WAS FOUND, never a
                               * dropdown. A `choice` input with no list renders
                               * EMPTY - which is what the founder was shown,
                               * with no way out of it - and a field that HAD
                               * been worked out correctly looked exactly the
                               * same, because its id matched no entry either.
                               *
                               * So the candidates are always drawn, with the
                               * chosen one filled in. It shows its working, and
                               * changing its mind is one tap rather than saying
                               * the whole sentence again.
                               */
                              <ShortlistInput
                                said={card.hints[f.key]}
                                value={
                                  typeof card.values[f.key] === "string"
                                    ? (card.values[f.key] as string)
                                    : null
                                }
                                options={card.options?.[f.key] ?? []}
                                onChange={(v) => setValue(i, f.key, v)}
                              />
                            ) : (
                              <Cell
                                id={`tell-${i}-${f.key}`}
                                field={f}
                                value={card.values[f.key] ?? null}
                                onChange={(v) => setValue(i, f.key, v)}
                              />
                            )}
                            {card.hints[f.key] && !card.options?.[f.key]?.length && (
                              <p className="text-xs text-amber-600">
                                {f.searched
                                  ? `Could not find “${card.hints[f.key]}”. Say it again with the name as it is in Yosher.`
                                  : `It heard “${card.hints[f.key]}” — pick or type the right one.`}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>

                      {problems[i] && (
                        <p className="text-xs text-amber-600">{problems[i]}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={reset} disabled={saving}>
                Start over
              </Button>
              {cards.length > 0 && (
                <Button onClick={() => save()} disabled={saving || !ready} size="sm">
                  {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                  {saving
                    ? "Recording…"
                    : `Record ${cards.length} ${cards.length === 1 ? "thing" : "things"}`}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

/** One field, drawn from its kind. Full width: this is used on a phone. */
/**
 * What the search found, with the chosen one filled in.
 *
 * Each option says what it IS - "Cattle * 12 head" - because two NAMES are not
 * a choice and two THINGS are. When there is only one it reads as a statement
 * of what was understood, which is the readback doing its job.
 */
function ShortlistInput({
  said,
  value,
  options,
  onChange,
}: {
  said?: string;
  value: string | null;
  options: TellCandidate[];
  onChange: (value: TellValue) => void;
}) {
  if (options.length === 0) return null;
  const chosen = options.some((o) => o.value === value);
  return (
    <div className="space-y-1.5">
      {!chosen && said && (
        <p className="text-xs text-muted-foreground">
          You said &ldquo;{said}&rdquo;. Which one?
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant={option.value === value ? "default" : "outline"}
            size="sm"
            className="h-auto flex-col items-start gap-0 py-1.5"
            onClick={() => onChange(option.value === value ? null : option.value)}
          >
            <span className="text-xs font-medium">{option.label}</span>
            {option.detail && (
              <span className="text-[11px] font-normal opacity-70">
                {option.detail}
              </span>
            )}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Cell({
  id,
  field,
  value,
  onChange,
}: {
  id: string;
  field: TellField;
  value: TellValue;
  onChange: (value: TellValue) => void;
}) {
  switch (field.kind) {
    case "choice":
      return (
        <Select
          value={typeof value === "string" && value !== "" ? value : NONE}
          onValueChange={(v) => onChange(v === NONE ? null : v)}
        >
          <SelectTrigger id={id} className={cn("h-9 w-full")} title={field.hint}>
            <SelectValue placeholder="Pick one" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not set</SelectItem>
            {(field.choices ?? []).map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "number":
      return (
        <Input
          id={id}
          type="number"
          step="any"
          inputMode="decimal"
          className="h-9"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          title={field.hint}
        />
      );
    case "date":
      return (
        <Input
          id={id}
          type="date"
          className="h-9"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
          title={field.hint}
        />
      );
    default:
      return (
        <Input
          id={id}
          className="h-9"
          value={value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          title={field.hint}
        />
      );
  }
}
