import { describe, expect, it } from "vitest";
import {
  describeSendAt,
  MAX_SCHEDULE_DAYS,
  MIN_SCHEDULE_SECONDS,
  scheduleChoices,
  UNDO_SECONDS,
  validateSendAt,
} from "@/modules/email/schedule/times";

/**
 * Undo send and schedule send.
 *
 * BOTH EXIST IN THIS SHAPE BECAUSE OF ONE PROBE RESULT.
 * `npm run mail:probe-send` asked whether the mail server would hold a message
 * back, and it will not: `EmailSubmission/set` refuses `sendAt` with
 * `invalidProperties` naming the field, and no `maxDelayedSend` is advertised.
 * So neither feature could be a future-dated JMAP submission. Both are a draft
 * created on the mail server now plus a decision recorded separately — which is
 * also what makes an interrupted undo window harmless rather than lossy.
 *
 * The times are computed in the BROWSER, for the same reason snooze times are:
 * "tomorrow morning" is a statement about the user's calendar and the server's
 * clock is UTC. These tests pin the boundaries, because an off-by-one here sends
 * somebody's mail at the wrong hour and nothing about using the product would
 * reveal it.
 */

/** A fixed local Wednesday afternoon, so nothing depends on when tests run. */
const WEDNESDAY_2PM = new Date(2026, 7, 5, 14, 0, 0);

describe("scheduleChoices", () => {
  it("offers tomorrow morning at 8", () => {
    const tomorrow = scheduleChoices(WEDNESDAY_2PM).find((c) => c.id === "tomorrow");
    expect(tomorrow?.at.getDate()).toBe(6);
    expect(tomorrow?.at.getHours()).toBe(8);
    expect(tomorrow?.at.getMinutes()).toBe(0);
  });

  it("offers Monday morning, and never today when today IS Monday", () => {
    // "Monday morning" said on a Monday means the one coming, not the one
    // already happening — a schedule that resolved to eight hours ago would be
    // rejected as past, and the option would look broken.
    const monday = new Date(2026, 7, 3, 14, 0, 0);
    expect(monday.getDay()).toBe(1);
    const choice = scheduleChoices(monday).find((c) => c.id === "monday");
    expect(choice?.at.getDate()).toBe(10);
    expect(choice?.at.getHours()).toBe(8);
  });

  it("offers later today only while it is still a civil hour to arrive", () => {
    // 2pm + 3h = 5pm, fine.
    expect(scheduleChoices(WEDNESDAY_2PM).some((c) => c.id === "later")).toBe(true);
    // 9pm + 3h would be midnight, and nobody means that by "later today".
    const late = new Date(2026, 7, 5, 21, 0, 0);
    expect(scheduleChoices(late).some((c) => c.id === "later")).toBe(false);
  });

  it("never offers a time in the past", () => {
    for (const hour of [0, 6, 12, 17, 21, 23]) {
      const now = new Date(2026, 7, 5, hour, 30, 0);
      for (const choice of scheduleChoices(now)) {
        expect(choice.at.getTime(), `${choice.id} at ${hour}:30`).toBeGreaterThan(
          now.getTime(),
        );
        // And never something the server would then refuse as too soon.
        expect(validateSendAt(choice.at, now), `${choice.id} at ${hour}:30`).toBeNull();
      }
    }
  });
});

describe("validateSendAt", () => {
  const now = WEDNESDAY_2PM;

  it("accepts an ordinary future time", () => {
    expect(validateSendAt(new Date(now.getTime() + 3_600_000), now)).toBeNull();
  });

  it("REJECTS a past time rather than clamping it", () => {
    // Clamping to "now" would send immediately, which is the one thing somebody
    // choosing a schedule did not ask for.
    expect(validateSendAt(new Date(now.getTime() - 1000), now)).toBe("in the past");
  });

  it("rejects something too soon to be a schedule", () => {
    expect(validateSendAt(new Date(now.getTime() + 5_000), now)).toBe("too soon");
    // Exactly at the boundary is allowed.
    expect(
      validateSendAt(new Date(now.getTime() + MIN_SCHEDULE_SECONDS * 1000), now),
    ).toBeNull();
  });

  it("REJECTS something too far ahead rather than clamping it", () => {
    const tooFar = new Date(now.getTime() + (MAX_SCHEDULE_DAYS + 1) * 86_400_000);
    expect(validateSendAt(tooFar, now)).toBe("too far ahead");
    const justInside = new Date(now.getTime() + (MAX_SCHEDULE_DAYS - 1) * 86_400_000);
    expect(validateSendAt(justInside, now)).toBeNull();
  });

  it("rejects a date that is not one", () => {
    expect(validateSendAt(new Date("nonsense"), now)).toBe("not a time");
  });
});

describe("describeSendAt", () => {
  it("says today, tomorrow, or names the day", () => {
    const now = WEDNESDAY_2PM;
    expect(describeSendAt(new Date(2026, 7, 5, 17, 0), now)).toMatch(/^today at /);
    expect(describeSendAt(new Date(2026, 7, 6, 8, 0), now)).toMatch(/^tomorrow at /);
    expect(describeSendAt(new Date(2026, 7, 10, 8, 0), now)).toMatch(/Monday/);
  });
});

describe("the undo window", () => {
  it("is long enough to notice and short enough to forget", () => {
    // Not an arbitrary assertion: a window under about five seconds is not
    // reachable by a person who has just looked away, and one over about half a
    // minute leaves people wondering whether the message went.
    expect(UNDO_SECONDS).toBeGreaterThanOrEqual(5);
    expect(UNDO_SECONDS).toBeLessThanOrEqual(30);
  });

  it("is shorter than the minimum schedule, so the two cannot overlap", () => {
    // Below MIN_SCHEDULE_SECONDS the answer is Undo, not a schedule. If these
    // crossed there would be a band where both features claimed the same delay
    // and neither was obviously right.
    expect(UNDO_SECONDS).toBeLessThan(MIN_SCHEDULE_SECONDS);
  });
});
