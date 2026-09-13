import { describe, expect, it } from "vitest";
import {
  looksLikeNoSignal,
  QUEUE_CAP,
  queueWith,
  queueWithout,
  splitByAge,
  tooOldToReplay,
  waitedMs,
  type QueuedSentence,
} from "../src/lib/tell-sources/queue";
import { SPOKEN_AT_MAX_AGE_MS } from "../src/lib/tell-sources/spoken-at";

/**
 * The pure half of keeping a sentence somebody said in a field with no bars
 * (tell.md, slice D2).
 */

const now = new Date("2026-09-13T14:00:00.000Z");
const MINUTE = 60 * 1_000;
const HOUR = 60 * MINUTE;

const said = (id: string, agoMs = 0, words = "clock me in"): QueuedSentence => ({
  id,
  said: words,
  spokenAt: new Date(now.getTime() - agoMs).toISOString(),
});

describe("holding on to it", () => {
  it("keeps the newest last", () => {
    const q = queueWith(queueWith([], said("a")), said("b"));
    expect(q.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("replaces rather than duplicates the same id", () => {
    const q = queueWith([said("a", 0, "first")], said("a", 0, "second"));
    expect(q).toHaveLength(1);
    expect(q[0].said).toBe("second");
  });

  it("drops the oldest past the cap, because nobody is waiting on those", () => {
    let q: QueuedSentence[] = [];
    for (let i = 0; i < QUEUE_CAP + 3; i++) q = queueWith(q, said(`s${i}`));
    expect(q).toHaveLength(QUEUE_CAP);
    expect(q[0].id).toBe("s3");
    expect(q.at(-1)!.id).toBe(`s${QUEUE_CAP + 2}`);
  });

  it("takes one out by id and leaves the rest alone", () => {
    const q = [said("a"), said("b"), said("c")];
    expect(queueWithout(q, "b").map((i) => i.id)).toEqual(["a", "c"]);
    expect(queueWithout(q, "nope")).toHaveLength(3);
  });
});

describe("how long it waited", () => {
  it("measures from when it was said", () => {
    expect(waitedMs(said("a", 3 * HOUR), now)).toBe(3 * HOUR);
  });

  it("never goes negative on a clock that ran backwards", () => {
    expect(waitedMs(said("a", -5 * MINUTE), now)).toBe(0);
  });

  it("treats an unreadable time as no wait rather than throwing", () => {
    expect(waitedMs({ id: "a", said: "x", spokenAt: "nonsense" }, now)).toBe(0);
  });
});

describe("too old to send", () => {
  /**
   * **THE POINT OF THIS RULE.** The server believes a claimed time up to
   * `SPOKEN_AT_MAX_AGE_MS` and quietly uses its own clock beyond it (ADR 0055),
   * so a sentence older than that would still RECORD — dated now. That is the
   * wrong answer said confidently, and it is worse than refusing.
   */
  it("stops at the point where sending it would be dated wrong", () => {
    expect(tooOldToReplay(said("a", SPOKEN_AT_MAX_AGE_MS - HOUR), now)).toBe(false);
    expect(tooOldToReplay(said("a", SPOKEN_AT_MAX_AGE_MS + HOUR), now)).toBe(true);
  });

  it("splits a queue into what can still be sent and what cannot", () => {
    const q = [said("fresh", HOUR), said("old", SPOKEN_AT_MAX_AGE_MS + HOUR), said("ok", 2 * HOUR)];
    const { ready, stale } = splitByAge(q, now);
    expect(ready.map((i) => i.id)).toEqual(["fresh", "ok"]);
    expect(stale.map((i) => i.id)).toEqual(["old"]);
  });
});

describe("was that the network, or an answer we did not like", () => {
  /**
   * **GETTING THIS WRONG IS SURVIVABLE IN ONE DIRECTION ONLY.** A false
   * positive replays once, gets the same real error and is dropped with it
   * shown. A false negative loses the sentence, which is the thing the whole
   * slice exists to prevent — so anything smelling of the network is kept.
   */
  it("is certain when the browser says there is no network", () => {
    expect(looksLikeNoSignal(new Error("anything at all"), false)).toBe(true);
    expect(looksLikeNoSignal(null, false)).toBe(true);
  });

  it("recognises what each browser calls a failed fetch", () => {
    expect(looksLikeNoSignal(new TypeError("Failed to fetch"), true)).toBe(true);
    expect(looksLikeNoSignal(new Error("Load failed"), true)).toBe(true);
    expect(looksLikeNoSignal(new Error("NetworkError when attempting to fetch"), true)).toBe(
      true,
    );
    expect(looksLikeNoSignal(new Error("Connection closed"), true)).toBe(true);
  });

  it("leaves a real answer alone, so it is not replayed forever", () => {
    // These arrive as `{ error }` from the server action rather than as a
    // throw, but the guard has to hold if one ever does throw.
    expect(looksLikeNoSignal(new Error("a clock is already running"), true)).toBe(false);
    expect(looksLikeNoSignal(new Error("that lot has no inventory record"), true)).toBe(false);
    expect(looksLikeNoSignal(new Error("Invalid input"), true)).toBe(false);
  });
});
