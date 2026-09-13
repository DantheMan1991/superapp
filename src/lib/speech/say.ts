/**
 * SAYING IT BACK — the other direction (tell.md, slice D1).
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 *
 * The whole justification for this feature is somebody outdoors with their
 * hands full. [ADR 0050](../../../docs/decisions/0050-a-safe-verb-records-itself.md)
 * got the count down to one tap for a clock-in — and then put the ANSWER on a
 * screen they still have to take out and look at. A confirmation you have to
 * look at is a second interaction wearing a toast's clothes.
 *
 * So: say it back. Press, speak, hear `Clocked in at 7:42`, put the phone away.
 *
 * ── THE RULE THAT KEEPS IT FROM BEING ANNOYING ───────────────────────────────
 *
 * **IT ONLY SPEAKS WHEN IT WAS SPOKEN TO.** Somebody who TYPED a sentence is
 * looking at the screen; talking at them is noise, and noise is what gets a
 * feature switched off. The box tracks how the words arrived and says nothing
 * when they were typed. The mute below is for the other case — dictating at a
 * desk with people in the room.
 *
 * ── AND IT SPEAKS THE FAILURES ───────────────────────────────────────────────
 *
 * The temptation is to speak only the happy answer. That is exactly backwards:
 * a person not looking at the screen can see a success they did not need and
 * MISS a refusal they did. A silent failure to somebody walking away is the one
 * outcome this must never produce.
 *
 * ── DELIBERATELY NOT `server-only` ───────────────────────────────────────────
 *
 * The same split `speech/types.ts` keeps: the shaping is pure and tested, the
 * two functions that touch `window` are guarded and do nothing where there is
 * no speech engine. Degrading to silence is right; refusing to record because a
 * WebView cannot talk would not be.
 */

/* -- the pure half --------------------------------------------------------- */

/**
 * A line written for the EYE, punctuated for the EAR.
 *
 * Every summary in this product is built for a toast, where an em dash is a
 * clean separator: `3 head — died — from Pen 2`. A speech engine reads that as
 * one breathless run-on, or pauses in the wrong place, or says the character
 * out loud. A comma is what a voice does with a pause.
 *
 * Kept deliberately small. This is punctuation, not rewriting — the words a
 * pack chose are the words a person hears, because a second voice paraphrasing
 * the first is how a confirmation stops being a confirmation.
 */
export function forSpeech(text: string): string {
  return text
    // A spaced dash of any flavour, and the middle dot the packs use between
    // facts, are all "pause here".
    .replace(/\s+[—–·-]\s+/g, ", ")
    // A summary that already ended in punctuation must not gain a comma.
    .replace(/,\s*([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How many of the summaries to actually say.
 *
 * One thing said, one thing heard. Two or three is still a sentence somebody
 * can hold in their head while walking, and hearing all of them is the POINT —
 * the round in one breath is the box's best trick and a count would throw the
 * answer away.
 *
 * Past three it becomes a monologue at somebody holding a bucket, and a count
 * is the kinder answer. The number is a judgement, not a measurement; it is
 * here rather than inline so it can be argued with in one place.
 */
export const SPEAK_EACH_UP_TO = 3;

/** What to say once something has been recorded. Empty means say nothing. */
export function spokenConfirmation(summaries: readonly string[]): string {
  const said = summaries.map((s) => s.trim()).filter((s) => s !== "");
  if (said.length === 0) return "";
  if (said.length <= SPEAK_EACH_UP_TO) return said.map(forSpeech).join(". ");
  return `Recorded ${said.length} things`;
}

/* -- the half that touches the browser ------------------------------------- */

/** Per device, per browser. A convenience, never state anything depends on. */
const HUSH_KEY = "yosher.tell.hush";

/** Every engine is behind `window`, and a server render has none. */
export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Whether this device has asked it to stay quiet.
 *
 * Reads can throw outright — a private window, site data blocked, a thumbnail
 * capture — so every access is wrapped and the failure means "not hushed",
 * which is the behaviour somebody who never touched the toggle expects.
 */
export function isHushed(): boolean {
  try {
    return window.localStorage.getItem(HUSH_KEY) === "1";
  } catch {
    return false;
  }
}

export function setHushed(hushed: boolean): void {
  try {
    if (hushed) window.localStorage.setItem(HUSH_KEY, "1");
    else window.localStorage.removeItem(HUSH_KEY);
  } catch {
    // A device that cannot remember the preference still honours it for the
    // rest of this page's life, because the listeners below are told either
    // way and `isHushed` is read again from wherever it can be read.
  }
  if (hushed) hush();
  for (const listener of listeners) listener();
}

/* -- read it the way React wants a browser fact read ----------------------- */

/**
 * **`useSyncExternalStore`, NOT AN EFFECT.** Both facts below live in the
 * browser and neither exists during a server render, so the obvious
 * `useEffect(() => setX(read()))` is two paints and a lint error
 * (`react-hooks/set-state-in-effect`). This is the shape React added for
 * exactly this: a snapshot, a server snapshot, and a way to be told it changed.
 */
const listeners = new Set<() => void>();

export function subscribeHush(onChange: () => void): () => void {
  listeners.add(onChange);
  // Two tabs open on a phone is not unusual, and a preference that disagrees
  // between them is a preference somebody stops trusting.
  const fromAnotherTab = (e: StorageEvent) => {
    if (e.key === null || e.key === HUSH_KEY) onChange();
  };
  window.addEventListener("storage", fromAnotherTab);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", fromAnotherTab);
  };
}

/** Whether there is an engine at all never changes within a page's life. */
export function subscribeNever(): () => void {
  return () => {};
}

/** On the server there is no voice, so nothing is hushed and nothing speaks. */
export function noVoiceOnTheServer(): boolean {
  return false;
}

/**
 * **THE GESTURE TRICK, AND IT IS NOT OPTIONAL ON iOS.**
 *
 * Mobile Safari will only start speech inside a user gesture. Everything this
 * says comes AFTER an await — the model call, the server action — by which
 * point the gesture is long gone and `speak()` is silently ignored. Nothing
 * throws; the phone simply never talks, on the one platform where it matters
 * most.
 *
 * Speaking a silent utterance on the press that starts listening unlocks the
 * engine for the rest of the page's life. Called from the dictate button, which
 * is the one place a real tap is guaranteed.
 */
export function warmUpSpeech(): void {
  if (!canSpeak()) return;
  try {
    const warm = new SpeechSynthesisUtterance(" ");
    warm.volume = 0;
    window.speechSynthesis.speak(warm);
  } catch {
    // An engine that refuses to warm up may still speak later; if it does not,
    // the screen still says everything the voice would have.
  }
}

/** Stop talking, now. */
export function hush(): void {
  if (!canSpeak()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* nothing to cancel */
  }
}

/**
 * Say it, unless this device asked for quiet.
 *
 * **CANCELS FIRST, ALWAYS.** Two sentences said quickly must not queue up
 * behind each other — the second answer is the one that is true, and hearing
 * the first one finish is how somebody walks away believing the wrong thing.
 */
export function sayIt(text: string): void {
  const words = text.trim();
  if (words === "" || !canSpeak() || isHushed()) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(words);
    // Slightly under the default. A confirmation is heard once, outdoors,
    // possibly over an engine, and a rushed one has to be read on the screen
    // anyway — which is the interaction this exists to remove.
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Silence is an acceptable outcome. Everything spoken is also on screen.
  }
}
