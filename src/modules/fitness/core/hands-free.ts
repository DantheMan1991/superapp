import type { VoiceLine } from "@/lib/speech/queue-policy";
import type { PhraseKey } from "@/lib/voice-commands/phrases";
import { UNIT_WORDS, type FitnessUnitValue } from "./program";

/**
 * HANDS-FREE IN WORKOUT MODE (Workouts F6, docs/modules/fitness.md; the
 * listener is Food's, ADR 0124 and docs/modules/voice-commands.md).
 *
 * For a person on the floor: two-word phrases do what the screen's buttons
 * do, and the coach answers with a word, so it is clear the phone heard. The
 * founder's calls, from a mockup (2026-10-02): two-word phrases (the single
 * words "done", "next" and "start" fired on any sentence that had them in
 * it); "next exercise" moves on with the taps after an exercise as they were
 * left; the switch is turned on once; a word back.
 *
 * Pure: the screen and the tests run the same words.
 */

export type WorkoutCommand = "start" | "done" | "pause" | "resume" | "again" | "next" | "repeat";

/** The phrase each command hears (`@/lib/voice-commands/phrases`). */
export const WORKOUT_COMMANDS: Readonly<Record<WorkoutCommand, readonly PhraseKey[]>> = {
  start: ["start set"],
  done: ["set done"],
  pause: ["pause workout"],
  resume: ["resume"],
  again: ["one more set"],
  next: ["next exercise"],
  repeat: ["repeat"],
};

/**
 * Listened for together, the whole workout: the measure found no phrase
 * taken for another, so the vocabulary never changes mid-session (a change
 * rebuilds the engine's spotter).
 */
export const WORKOUT_LISTENING: readonly WorkoutCommand[] = ["start", "done", "pause", "resume", "again", "next", "repeat"];

export function isWorkoutCommand(label: string): label is WorkoutCommand {
  return Object.hasOwn(WORKOUT_COMMANDS, label);
}

/** The words shown for a command: the phrase to say. */
export function commandWords(command: WorkoutCommand): string {
  return WORKOUT_COMMANDS[command][0];
}

/** What can be said where, for the line under the controls. */
export type HandsFreePlace = "timed-set" | "counted-set" | "check" | "check-full";

export function sayHere(place: HandsFreePlace): WorkoutCommand[] {
  switch (place) {
    case "timed-set":
      return ["start", "done", "pause", "resume", "repeat"];
    case "counted-set":
      return ["done", "repeat"];
    case "check":
      return ["again", "next", "repeat"];
    case "check-full":
      return ["next", "repeat"];
  }
}

/** “start set”, “set done” or “repeat”: a list, as the screen says it. */
export function sayList(commands: readonly WorkoutCommand[]): string {
  const words = commands.map((command) => `“${commandWords(command)}”`);
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

/** A word back, keyed so a newer reply replaces an unsaid older one. */
function reply(text: string): VoiceLine {
  return { text, priority: "normal", key: "reply" };
}

/**
 * The coach's word back. Fixed lines, so their recordings are fetched with
 * the session's (`replyLines`) and are ready when they are said.
 */
export const REPLY = {
  /** "start set" before a timed set: its countdown begins, as Start's does. */
  starting: reply("Starting in five."),
  /** "start set" once it is going. */
  started: reply("It has started."),
  /** "set done", "pause workout" or "resume" before a timed set has begun. */
  notStarted: reply("Say start set first."),
  paused: reply("Paused."),
  alreadyPaused: reply("It is paused. Say resume."),
  /** "pause workout" during the countdown: back to waiting for Start. */
  waiting: reply("Waiting. Say start set when you are ready."),
  resumed: reply("Resumed."),
  notPaused: reply("It is not paused."),
  /** A set counted in reps or rolls has no timer. */
  counted: reply("Go ahead. Say set done when you finish."),
  noTimer: reply("This set has no timer."),
  /** "one more set" or "next exercise" during a set. */
  finishFirst: reply("Finish this set first. Say set done."),
  /** "one more set" when the exercise takes no more. */
  noMore: reply("That is all the sets it takes. Say next exercise."),
  /** After an exercise: what to say. */
  checkPrompt: reply("Say one more set, or next exercise."),
  checkPromptFull: reply("Say next exercise."),
  /** At the finish, which wants a tap for how you feel. */
  finish: reply("Tap how you feel, then Finish."),
} as const satisfies Record<string, VoiceLine>;

/** "Not yet: 3 of 5 breaths." when "set done" comes before the set's least. */
export function notYet(done: number, least: number, unit: FitnessUnitValue): VoiceLine {
  return reply(`Not yet: ${done} of ${least} ${UNIT_WORDS[unit][least === 1 ? "one" : "many"]}.`);
}

/** Every fixed reply, for the recordings fetched ahead. */
export function replyLines(): string[] {
  return Object.values(REPLY).map((line) => line.text);
}

/** The most "not yet" lines a set fetches ahead: a long hold's later ones are said in the phone's voice. */
const NOT_YET_AHEAD = 30;

/**
 * A timed set's "not yet" lines, fetched ahead as the set appears: one for
 * each count short of its least. Asked for only when said, one took 2.06 s on
 * the drive, past the voice's 2-second wait, and came in the phone's voice.
 */
export function notYetLines(least: number, unit: FitnessUnitValue): string[] {
  return Array.from({ length: Math.min(least, NOT_YET_AHEAD) }, (_, done) => notYet(done, least, unit).text);
}
