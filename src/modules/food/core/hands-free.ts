import type { FoodLine } from "@/db/schema/food";
import { RECORD_LINE_MAX } from "@/lib/speech/voices";
import type { PhraseKey } from "@/lib/voice-commands/phrases";
import { readLine, showLine } from "./amounts";
import type { CookTimer, RealStep } from "./cook";
import { findTimes, rangeWords, type StepTime } from "./times";
import { stepUses } from "./uses";

/**
 * HANDS-FREE COOK MODE (D1c, docs/modules/food.md; ADR 0124): what cook mode
 * listens for, and what it says. The steps are read aloud in the recorded
 * voice the phone chose for the workout coach, and short phrases move the
 * cook on: "next step", "go back", "repeat", "start timer", "stop timer",
 * "ingredients". Pure: the screen and the tests run the same rules.
 */

export type CookCommand = "next" | "back" | "repeat" | "start-timer" | "stop-timer" | "ingredients";

/** The phrases each command hears (`@/lib/voice-commands/phrases`). */
export const COOK_COMMANDS: Readonly<Record<CookCommand, readonly PhraseKey[]>> = {
  next: ["next step"],
  back: ["go back", "previous step"],
  repeat: ["repeat"],
  "start-timer": ["start timer"],
  "stop-timer": ["stop timer"],
  ingredients: ["ingredients", "show ingredients"],
};

/**
 * What cook mode listens for now. "Stop timer" only while one rings, and
 * "start timer" only while none does: the two sound alike, and the spike had
 * the listener mistake one for the other when it listened for both.
 */
export function cookListening(ringing: boolean): CookCommand[] {
  return ["next", "back", "repeat", ringing ? "stop-timer" : "start-timer", "ingredients"];
}

export function isCookCommand(label: string): label is CookCommand {
  return Object.hasOwn(COOK_COMMANDS, label);
}

/** The words shown for a command: the phrase to say. */
export function commandWords(command: CookCommand): string {
  return COOK_COMMANDS[command][0];
}

/* -- saying it the way a person would ----------------------------------------- */

const FRACTION_WORDS: Record<string, string> = {
  "1/2": "a half",
  "1/3": "a third",
  "2/3": "two thirds",
  "1/4": "a quarter",
  "3/4": "three quarters",
  "1/8": "an eighth",
  "3/8": "three eighths",
  "5/8": "five eighths",
  "7/8": "seven eighths",
};

const VULGAR: Record<string, string> = {
  "½": "1/2",
  "⅓": "1/3",
  "⅔": "2/3",
  "¼": "1/4",
  "¾": "3/4",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8",
};

const GLYPHS = Object.keys(VULGAR).join("");

const FRACTION_ALTERNATIVES = Object.values(FRACTION_WORDS).join("|");
/** An amount of one, or of less ("a half"), says its unit singular... */
const ONE_OR_LESS = new RegExp(String.raw`(?:^|[^\w.])(?:1|${FRACTION_ALTERNATIVES})\s*$`);
/** ...but "1 and a half" does not ("butter and a half teaspoon" still does). */
const MIXED = new RegExp(String.raw`\d and (?:${FRACTION_ALTERNATIVES})\s*$`);

/** A spoon's name, by the amount before it. An abbreviation's dot goes when the sentence goes on. */
function spoon(text: string, pattern: RegExp, singular: string, plural: string): string {
  return text.replace(pattern, (_match: string, offset: number, whole: string) => {
    const before = whole.slice(0, offset);
    return ONE_OR_LESS.test(before) && !MIXED.test(before) ? singular : plural;
  });
}

/**
 * A recipe's shorthand, written out for the recorded voice. Read back from
 * the voice itself on 2026-10-02 (D1c): it says "tbsp", "oz", "lbs", "g",
 * "ml", "min", "hr" and "400°F" well, and garbles "1/4 cup" ("one four cup"),
 * "1 1/2" ("one one two"), "1 ½" ("one half"), "½ tsp" ("one half T S P"),
 * "9x13-inch" ("nine x one three dash") and "400F". Those are rewritten here;
 * the rest is left as written.
 */
export function spokenText(text: string): string {
  let out = text;
  // Glyphs to plain fractions first, so one rule reads both: "1½" and "1 ½" are "1 1/2".
  out = out.replace(new RegExp(String.raw`(\d)\s*([${GLYPHS}])`, "g"), (_m, whole: string, glyph: string) => `${whole} ${VULGAR[glyph]}`);
  out = out.replace(new RegExp(`[${GLYPHS}]`, "g"), (glyph) => VULGAR[glyph]);
  // "1 1/2" is "1 and a half"; a lone "3/4" is "three quarters".
  out = out.replace(/(?<![\d/.])(\d+)\s+([1-7]\/[2348])(?![\d/])/g, (m, whole: string, part: string) =>
    FRACTION_WORDS[part] ? `${whole} and ${FRACTION_WORDS[part]}` : m,
  );
  out = out.replace(/(?<![\d/.])([1-7]\/[2348])(?![\d/])/g, (m, part: string) => FRACTION_WORDS[part] ?? m);
  // A pan's size: "9x13-inch" is "9 by 13 inch".
  out = out.replace(/(\d)\s*[x×]\s*(\d)/g, "$1 by $2");
  out = out.replace(/(\d)-inch\b/g, "$1 inch");
  // An oven with no degree sign: "400F", "200 C".
  out = out.replace(/\b(\d{3})\s?F\b/g, "$1 degrees Fahrenheit");
  out = out.replace(/\b(\d{3})\s?C\b/g, "$1 degrees Celsius");
  // A range is "to": "2-3 tablespoons", "25–30 minutes".
  out = out.replace(/(\d)\s*[-–]\s*(\d)/g, "$1 to $2");
  // Spoons: the voice said "T S P" once, and "two tablespoon".
  out = spoon(out, /\b(?:[Tt][Ss][Pp][Ss]?|[Tt]easpoons?)\b(?:\.(?=\s+[a-z0-9(]))?/g, "teaspoon", "teaspoons");
  out = spoon(out, /\b(?:[Tt][Bb][Ss][Pp]?[Ss]?|[Tt]ablespoons?)\b(?:\.(?=\s+[a-z0-9(]))?/g, "tablespoon", "tablespoons");
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Words to say, in lines the voice route takes (`RECORD_LINE_MAX`). A line
 * that fits is one line, said in one breath; a longer one is cut at its
 * sentences, then at its commas, then between words.
 */
export function speechLines(text: string, max = RECORD_LINE_MAX): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean === "") return [];
  if (clean.length <= max) return [clean];
  // At a stop with a space after it: "1.5 cups" is not two sentences.
  const sentences = clean.split(/(?<=[.!?;]["')\]]*)\s+/).filter(Boolean);
  const pieces = sentences.flatMap((sentence) => (sentence.length <= max ? [sentence] : cut(sentence, max)));
  const lines: string[] = [];
  for (const piece of pieces) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + piece.length <= max) lines[lines.length - 1] = `${last} ${piece}`;
    else lines.push(piece);
  }
  return lines;
}

/** A sentence longer than a line: at its commas where it can, between words where it must. */
function cut(sentence: string, max: number): string[] {
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let at = window.lastIndexOf(", ");
    if (at < max / 3) at = window.lastIndexOf(" ");
    if (at <= 0) at = max - 1;
    out.push(rest.slice(0, at + 1).trim());
    rest = rest.slice(at + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** "For the sauce:" said as a heading: "For the sauce." */
function asSentence(heading: string): string {
  const words = heading.trim().replace(/[:\s]+$/, "");
  return /[.!?]$/.test(words) ? words : `${words}.`;
}

/** A line of the list at the servings being cooked, as words. */
function shownText(line: string, factor: number): string {
  return showLine(readLine(line), factor)
    .map((part) => part.text)
    .join("");
}

/** What the voice says for a step: its group's heading when the group starts, then the step. */
export function stepSpeech(steps: readonly RealStep[], at: number): string[] {
  const step = steps[at];
  if (!step) return [];
  const lines: string[] = [];
  const before = at > 0 ? steps[at - 1].heading : null;
  if (step.heading && step.heading !== before) lines.push(...speechLines(asSentence(step.heading)));
  lines.push(...speechLines(spokenText(step.text)));
  return lines;
}

/** The whole list, for "ingredients" before the first step: headings and lines, a pause between each. */
export function listSpeech(ingredients: readonly FoodLine[], factor: number): string[] {
  const sentences = ingredients
    .map((line) => (line.heading ? asSentence(line.text) : asSentence(spokenText(shownText(line.text, factor)))))
    .filter((s) => s !== ".");
  return sentences.length === 0 ? [SAY.noList] : speechLines(sentences.join(" "));
}

/** "Ingredients" on a step: what that step uses, at the servings being cooked. */
export function usesSpeech(step: string, ingredients: readonly FoodLine[], factor: number): string[] {
  const used = stepUses(step, ingredients).map((i) => spokenText(shownText(ingredients[i].text, factor)));
  if (used.length === 0) return [SAY.usesNothing];
  const list = used.length === 1 ? used[0] : `${used.slice(0, -1).join(", ")} and ${used[used.length - 1]}`;
  return speechLines(`This step uses ${list}.`);
}

/* -- timers by voice ----------------------------------------------------------- */

/** A timer's label, the same from a tap and from a voice: "Step 4 · 25–30 min". */
export function timerLabel(stepNumber: number, time: Pick<StepTime, "lo" | "hi">): string {
  return `Step ${stepNumber} · ${rangeWords(time.lo, time.hi)}`;
}

/**
 * The time "start timer" starts: the step's first one not already running.
 * Said twice on a step with two times, it starts both, in order. Null when
 * the step has no time; "running" when every one of them is.
 */
export function nextStepTime(step: string, stepNumber: number, timers: readonly CookTimer[]): StepTime | "running" | null {
  const times = findTimes(step);
  if (times.length === 0) return null;
  const seen = new Map<string, number>();
  for (const time of times) {
    const label = timerLabel(stepNumber, time);
    const earlier = seen.get(label) ?? 0;
    seen.set(label, earlier + 1);
    if (earlier >= timers.filter((t) => t.label === label).length) return time;
  }
  return "running";
}

/** The timer "stop timer" stops: the one that has been ringing longest. */
export function firstRinging(timers: readonly CookTimer[], now: number): CookTimer | null {
  return timers.filter((t) => t.endsAt <= now).sort((a, b) => a.endsAt - b.endsAt)[0] ?? null;
}

function spokenDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} ${s === 1 ? "second" : "seconds"}`;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const parts = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  return parts.join(" ");
}

/** "25 to 30 minutes", "1 hour 15 minutes", "45 seconds". */
export function spokenRange(lo: number, hi: number | null): string {
  if (hi === null) return spokenDuration(lo);
  if (lo % 60 === 0 && hi % 60 === 0 && hi < 3600) return `${lo / 60} to ${hi / 60} minutes`;
  return `${spokenDuration(lo)} to ${spokenDuration(hi)}`;
}

/** What cook mode says back. Fixed lines, so their recordings are fetched once, ahead. */
export const SAY = {
  gather: "Gather the ingredients, then say next step.",
  done: "Done. Enjoy it.",
  atStart: "This is the start.",
  atEnd: "That was the last step.",
  noTime: "There is no time in this step.",
  noTimeHere: "There is no timer on this screen.",
  running: "This step's timer is already running.",
  stopped: "Timer stopped.",
  noList: "No ingredients are written down.",
  usesNothing: "This step names nothing from the list.",
} as const;

export function startedSpeech(time: Pick<StepTime, "lo" | "hi">): string {
  return `Timer started: ${spokenRange(time.lo, time.hi)}.`;
}

/** The reply to "stop timer": a range was only the shorter end, so the longer is said too. */
export function stoppedSpeech(timer: Pick<CookTimer, "hi">, othersRinging: boolean): string {
  const range = timer.hi ? ` Check it now. It can take up to ${spokenDuration(timer.hi)}.` : "";
  return `${SAY.stopped}${range}${othersRinging ? " Another one is ringing." : ""}`;
}

/**
 * Every line cook mode might say for this recipe at these servings: fetched
 * ahead when hands-free is turned on, so a line is ready before it is needed.
 */
export function everyCookLine(steps: readonly RealStep[], ingredients: readonly FoodLine[], factor: number): string[] {
  const lines: string[] = [...Object.values(SAY)];
  steps.forEach((step, i) => {
    lines.push(...stepSpeech(steps, i), ...usesSpeech(step.text, ingredients, factor));
    for (const time of findTimes(step.text)) lines.push(startedSpeech(time), stoppedSpeech(time, false));
  });
  lines.push(...listSpeech(ingredients, factor));
  return [...new Set(lines)];
}
