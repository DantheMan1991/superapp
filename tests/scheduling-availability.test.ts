import { describe, expect, it } from "vitest";
import { minutesIntoDay } from "../src/lib/timezone";
import {
  conflictsWith,
  findFreeSlots,
  invertIntervals,
  mergeIntervals,
  type Interval,
} from "../src/lib/schedule/availability";

const NY = "America/New_York";

/** "09:00" on a date in New York, as an instant. EDT unless stated. */
const at = (date: string, hhmm: string, offset = 4) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(
    `${date}T${String(h + offset).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`,
  );
};
const iv = (date: string, from: string, to: string): Interval => ({
  startsAt: at(date, from),
  endsAt: at(date, to),
});
const show = (list: Interval[]) =>
  list.map(
    (i) =>
      `${String(Math.floor(minutesIntoDay(i.startsAt, NY) / 60)).padStart(2, "0")}:${String(minutesIntoDay(i.startsAt, NY) % 60).padStart(2, "0")}-${String(Math.floor(minutesIntoDay(i.endsAt, NY) / 60)).padStart(2, "0")}:${String(minutesIntoDay(i.endsAt, NY) % 60).padStart(2, "0")}`,
  );

const D = "2026-09-10"; // a Thursday

describe("mergeIntervals", () => {
  it("collapses overlaps", () => {
    expect(show(mergeIntervals([iv(D, "09:00", "10:30"), iv(D, "10:00", "11:00")])))
      .toEqual(["09:00-11:00"]);
  });

  it("MERGES ADJACENT BLOCKS, which is the one that matters", () => {
    // 9–10 and 10–11 back to back is one busy block. Leaving them separate
    // would let a slot finder offer the instant at 10:00 as free.
    expect(show(mergeIntervals([iv(D, "09:00", "10:00"), iv(D, "10:00", "11:00")])))
      .toEqual(["09:00-11:00"]);
  });

  it("leaves a genuine gap alone", () => {
    expect(show(mergeIntervals([iv(D, "09:00", "10:00"), iv(D, "11:00", "12:00")])))
      .toEqual(["09:00-10:00", "11:00-12:00"]);
  });

  it("swallows a fully nested block", () => {
    expect(show(mergeIntervals([iv(D, "09:00", "12:00"), iv(D, "10:00", "11:00")])))
      .toEqual(["09:00-12:00"]);
  });

  it("does not care what order it is given", () => {
    const a = mergeIntervals([iv(D, "14:00", "15:00"), iv(D, "09:00", "10:00")]);
    const b = mergeIntervals([iv(D, "09:00", "10:00"), iv(D, "14:00", "15:00")]);
    expect(show(a)).toEqual(show(b));
    expect(show(a)).toEqual(["09:00-10:00", "14:00-15:00"]);
  });

  it("handles nothing", () => {
    expect(mergeIntervals([])).toEqual([]);
  });
});

describe("invertIntervals", () => {
  const window = iv(D, "09:00", "17:00");

  it("returns the gaps between blocks", () => {
    expect(
      show(invertIntervals([iv(D, "10:00", "11:00"), iv(D, "14:00", "15:00")], window)),
    ).toEqual(["09:00-10:00", "11:00-14:00", "15:00-17:00"]);
  });

  it("a fully booked window has no gaps", () => {
    expect(invertIntervals([iv(D, "08:00", "18:00")], window)).toEqual([]);
  });

  it("an empty diary is one long gap", () => {
    expect(show(invertIntervals([], window))).toEqual(["09:00-17:00"]);
  });

  it("clips blocks that overhang either edge", () => {
    expect(
      show(invertIntervals([iv(D, "07:00", "10:00"), iv(D, "16:00", "20:00")], window)),
    ).toEqual(["10:00-16:00"]);
  });

  it("ignores blocks entirely outside the window", () => {
    expect(show(invertIntervals([iv(D, "05:00", "06:00")], window))).toEqual([
      "09:00-17:00",
    ]);
  });
});

describe("findFreeSlots", () => {
  const base = {
    from: at(D, "00:00"),
    to: at("2026-09-11", "00:00"),
    durationMinutes: 60,
    timeZone: NY,
    dayStart: "09:00",
    dayEnd: "17:00",
    weekdays: [1, 2, 3, 4, 5],
  };

  it("offers slots only inside working hours", () => {
    const slots = findFreeSlots({ ...base, busy: [] });
    expect(show(slots)[0]).toBe("09:00-10:00");
    expect(show(slots).at(-1)).toBe("16:00-17:00");
  });

  it("skips over busy time", () => {
    const slots = findFreeSlots({
      ...base,
      busy: [iv(D, "09:00", "12:00"), iv(D, "13:00", "16:30")],
    });
    // 12:00 and 12:30 fit before 13:00? 12:30-13:30 collides, so only 12:00.
    expect(show(slots)).toEqual(["12:00-13:00"]);
  });

  it("ALIGNS TO THE HALF HOUR, not to the end of the last meeting", () => {
    // An opening at 10:47 is technically true and nobody books it.
    const slots = findFreeSlots({
      ...base,
      busy: [iv(D, "09:00", "10:47")],
      durationMinutes: 30,
    });
    expect(show(slots)[0]).toBe("11:00-11:30");
  });

  it("never offers a day that is not a working day", () => {
    // 2026-09-12 is a Saturday.
    const slots = findFreeSlots({
      ...base,
      busy: [],
      from: at("2026-09-12", "00:00"),
      to: at("2026-09-14", "00:00"),
    });
    // Saturday and Sunday are both excluded, so nothing at all.
    expect(slots).toEqual([]);
  });

  it("respects the duration", () => {
    const slots = findFreeSlots({
      ...base,
      busy: [iv(D, "09:00", "16:00")],
      durationMinutes: 90,
    });
    // Only 16:00-17:30 would fit and it runs past the day's end.
    expect(slots).toEqual([]);
  });

  it("stops at the limit", () => {
    expect(findFreeSlots({ ...base, busy: [], limit: 3 })).toHaveLength(3);
  });

  it("WORKING HOURS ARE PER LOCAL DAY, so they survive a DST change", () => {
    // The window spans 2026-11-01, when the clocks go back. A single UTC band
    // would drift by an hour on one side of it.
    const slots = findFreeSlots({
      busy: [],
      from: new Date("2026-10-29T00:00:00Z"),
      to: new Date("2026-11-05T00:00:00Z"),
      durationMinutes: 60,
      timeZone: NY,
      dayStart: "09:00",
      dayEnd: "17:00",
      weekdays: [1, 2, 3, 4, 5],
      limit: 200,
    });
    // Every slot starts at or after 9am local and ends by 5pm local, whichever
    // side of the transition it falls.
    for (const slot of slots) {
      expect(minutesIntoDay(slot.startsAt, NY)).toBeGreaterThanOrEqual(9 * 60);
      expect(minutesIntoDay(slot.endsAt, NY)).toBeLessThanOrEqual(17 * 60);
    }
    // And it genuinely crossed the boundary.
    expect(slots.length).toBeGreaterThan(20);
  });
});

describe("conflictsWith", () => {
  const people = [
    { clerkUserId: "dave", visible: true, busy: [iv(D, "10:00", "11:00")] },
    { clerkUserId: "sam", visible: true, busy: [iv(D, "14:00", "15:00")] },
    { clerkUserId: "unknown", visible: false, busy: [] },
  ];

  it("names whoever is busy at that time", () => {
    expect(conflictsWith(people, iv(D, "10:30", "11:30"))).toEqual(["dave"]);
    expect(conflictsWith(people, iv(D, "12:00", "13:00"))).toEqual([]);
  });

  it("touching end-to-start is not a conflict", () => {
    expect(conflictsWith(people, iv(D, "11:00", "12:00"))).toEqual([]);
  });

  it("somebody whose calendar is not visible is never reported as free OR busy", () => {
    // They contribute no conflict, and the caller has to say "we cannot see"
    // from `visible` rather than inferring availability from silence.
    expect(conflictsWith(people, iv(D, "09:00", "18:00"))).toEqual(["dave", "sam"]);
    expect(people.find((p) => p.clerkUserId === "unknown")?.visible).toBe(false);
  });
});
