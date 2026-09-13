import { describe, expect, it } from "vitest";
import {
  clampSpokenAt,
  SPOKEN_AT_FUTURE_SKEW_MS,
  SPOKEN_AT_MAX_AGE_MS,
  wasSaidEarlier,
  WORTH_MENTIONING_MS,
} from "../src/lib/tell-sources/spoken-at";

/**
 * HOW MUCH OF THE PHONE'S ANSWER TO BELIEVE ([ADR 0055](../docs/decisions/0055-a-queued-sentence-is-old-not-wrong.md)).
 *
 * The rule this replaced was symmetric — ±15 minutes — and it refused the exact
 * case it was written for: a sentence spoken at seven in a barn with no signal
 * and uploaded at ten. That is three hours out, so the clock-in was recorded at
 * ten. **Three hours of wages, silently, every time — not only when somebody was
 * cheating.**
 *
 * So the cases below are written around the two directions meaning different
 * things, because that is the whole decision.
 */

const now = new Date("2026-09-12T14:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const ahead = (ms: number) => new Date(now.getTime() + ms);

const MINUTE = 60 * 1_000;
const HOUR = 60 * MINUTE;

describe("a sentence from earlier is believed", () => {
  it("keeps the time it was SAID, hours later", () => {
    // The case ADR 0048 described and then refused.
    const spokenInTheBarn = ago(3 * HOUR);
    const answer = clampSpokenAt(spokenInTheBarn, now);
    expect(answer.effectiveAt).toEqual(spokenInTheBarn);
    expect(answer.clamped).toBe(false);
    expect(answer.delayedMs).toBe(3 * HOUR);
  });

  it("believes a phone that was out of signal overnight", () => {
    const lastNight = ago(14 * HOUR);
    expect(clampSpokenAt(lastNight, now).effectiveAt).toEqual(lastNight);
  });

  it("still bounds it, because a week late is a bug or a wrong clock", () => {
    const tooOld = ago(SPOKEN_AT_MAX_AGE_MS + MINUTE);
    const answer = clampSpokenAt(tooOld, now);
    expect(answer.effectiveAt).toEqual(now);
    expect(answer.clamped).toBe(true);
    // Nothing was believed, so nothing waited.
    expect(answer.delayedMs).toBe(0);
  });

  it("believes it right up to the bound", () => {
    const justInside = ago(SPOKEN_AT_MAX_AGE_MS - MINUTE);
    expect(clampSpokenAt(justInside, now).clamped).toBe(false);
  });
});

describe("a sentence from the future is not", () => {
  /**
   * **THIS IS THE DIRECTION FRAUD POINTS IN.** Back-dating a clock-in pays;
   * post-dating one does not. So the past is generous and this is not.
   */
  it("loses to the server past honest skew", () => {
    const answer = clampSpokenAt(ahead(SPOKEN_AT_FUTURE_SKEW_MS + MINUTE), now);
    expect(answer.effectiveAt).toEqual(now);
    expect(answer.clamped).toBe(true);
  });

  it("tolerates a few seconds of it, because clocks are not exact", () => {
    const barelyAhead = ahead(10 * 1_000);
    const answer = clampSpokenAt(barelyAhead, now);
    expect(answer.effectiveAt).toEqual(barelyAhead);
    expect(answer.clamped).toBe(false);
    // Ahead is not a negative wait. A delay is a fact about the world, not the
    // result of a subtraction.
    expect(answer.delayedMs).toBe(0);
  });

  it("is far stricter than the past, and that asymmetry is the decision", () => {
    const oneHourEachWay = HOUR;
    expect(clampSpokenAt(ago(oneHourEachWay), now).clamped).toBe(false);
    expect(clampSpokenAt(ahead(oneHourEachWay), now).clamped).toBe(true);
  });
});

describe("when nothing is claimed", () => {
  it("is not an error and not a lie — most sentences just happened", () => {
    expect(clampSpokenAt(null, now)).toEqual({
      effectiveAt: now,
      clamped: false,
      delayedMs: 0,
    });
  });

  it("treats nonsense the same way", () => {
    expect(clampSpokenAt(new Date("nope"), now)).toEqual({
      effectiveAt: now,
      clamped: false,
      delayedMs: 0,
    });
  });
});

describe("whether somebody should be told it was late", () => {
  /**
   * The bound refuses the absurd; this decides what to SAY. A three-hour-old
   * clock-in recorded silently is indistinguishable from a fresh one, and
   * "visible in a table nobody reads" is not a control — which is half of why
   * the generous past bound is defensible at all.
   */
  it("says so once the gap stops being a rounding difference", () => {
    expect(wasSaidEarlier(clampSpokenAt(ago(3 * HOUR), now))).toBe(true);
    expect(wasSaidEarlier(clampSpokenAt(ago(WORTH_MENTIONING_MS), now))).toBe(true);
  });

  it("stays quiet about a sentence that just happened", () => {
    expect(wasSaidEarlier(clampSpokenAt(ago(30 * 1_000), now))).toBe(false);
    expect(wasSaidEarlier(clampSpokenAt(null, now))).toBe(false);
  });

  it("stays quiet when the claim was thrown away", () => {
    // Clamped means the server's clock was used, so there is no delay to
    // report — announcing one would be reporting a number nobody believed.
    expect(wasSaidEarlier(clampSpokenAt(ago(SPOKEN_AT_MAX_AGE_MS + HOUR), now))).toBe(
      false,
    );
  });
});
