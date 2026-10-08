import { describe, expect, it } from "vitest";
import { installTimeShift, parseFakeNow, shiftedDate } from "./setup/time-shift";

/**
 * The clock the Date bombs workflow moves (tests/setup/time-shift.ts).
 *
 * The last test is the workflow's canary: every run it makes includes this
 * file, and a run whose clock did not move is a broken run, not a clean one.
 * Every test here holds whether or not FAKE_NOW is set, because the workflow
 * runs them with the clock moved.
 */

const DAY = 86_400_000;

describe("FAKE_NOW: reading it", () => {
  it("reads an offset in seconds, or in libfaketime's units", () => {
    expect(parseFakeNow("+5184000")).toEqual({ kind: "offset", ms: 5_184_000_000 });
    expect(parseFakeNow("+60d")).toEqual({ kind: "offset", ms: 60 * DAY });
    expect(parseFakeNow("-15d")).toEqual({ kind: "offset", ms: -15 * DAY });
    expect(parseFakeNow("+2h")).toEqual({ kind: "offset", ms: 7_200_000 });
    expect(parseFakeNow("+30m")).toEqual({ kind: "offset", ms: 1_800_000 });
    expect(parseFakeNow("+1y")).toEqual({ kind: "offset", ms: 365 * DAY });
    expect(parseFakeNow("+0")).toEqual({ kind: "offset", ms: 0 });
    expect(parseFakeNow(" +60d\n")).toEqual({ kind: "offset", ms: 60 * DAY });
  });

  it("reads a date written as one", () => {
    expect(parseFakeNow("2031-06-15T12:00:00Z")).toEqual({
      kind: "instant",
      ms: Date.UTC(2031, 5, 15, 12),
    });
    expect(parseFakeNow("2031-06-15")).toEqual({ kind: "instant", ms: Date.UTC(2031, 5, 15) });
  });

  it("refuses anything else, rather than running on the real clock", () => {
    for (const spec of ["", "60d", "+60 days", "+1,5h", "+1.5h", "@2031-06-15 12:00:00", "1", "soon"]) {
      expect(() => parseFakeNow(spec), spec).toThrow(/Refusing to run on the real clock/);
    }
  });
});

describe("FAKE_NOW: the moved Date", () => {
  const Moved = shiftedDate(Date, DAY);

  it("moves new Date(), Date() and Date.now() by the offset", () => {
    const before = Date.now();
    const constructed = new Moved().getTime();
    const now = Moved.now();
    const called = Date.parse(Moved());
    const after = Date.now();
    for (const reading of [constructed, now]) {
      expect(reading).toBeGreaterThanOrEqual(before + DAY);
      expect(reading).toBeLessThanOrEqual(after + DAY);
    }
    // Date() is a string to the second.
    expect(called).toBeGreaterThanOrEqual(before + DAY - 1000);
    expect(called).toBeLessThanOrEqual(after + DAY);
  });

  it("leaves a Date given its time alone", () => {
    expect(new Moved(0).getTime()).toBe(0);
    expect(new Moved("2031-06-15T12:00:00Z").toISOString()).toBe("2031-06-15T12:00:00.000Z");
    expect(new Moved(2031, 5, 15).getFullYear()).toBe(2031);
    expect(Moved.UTC(2031, 5, 15)).toBe(Date.UTC(2031, 5, 15));
    expect(Moved.parse("2031-06-15T12:00:00Z")).toBe(Date.UTC(2031, 5, 15, 12));
  });

  it("is still Date to anything that asks", () => {
    expect(new Moved()).toBeInstanceOf(Date);
    expect(new Date(0)).toBeInstanceOf(Moved);
    class Stamp extends Moved {}
    const stamp = new Stamp();
    expect(stamp).toBeInstanceOf(Stamp);
    expect(stamp.getTime() - Date.now()).toBeGreaterThan(DAY - 5_000);
  });

  it("installs once, so a second call cannot add its offset twice, and never without a spec", () => {
    const original = globalThis.Date;
    const key = Symbol.for("superapp.time-shift");
    const scope = globalThis as unknown as Record<symbol, unknown>;
    const had = scope[key];
    try {
      delete scope[key];
      installTimeShift(undefined);
      installTimeShift("");
      expect(globalThis.Date).toBe(original);

      installTimeShift("+1d");
      const once = globalThis.Date;
      installTimeShift("+1d");
      expect(globalThis.Date).toBe(once);
      const before = original.now();
      const reading = Date.now();
      const after = original.now();
      expect(reading).toBeGreaterThanOrEqual(before + DAY);
      expect(reading).toBeLessThanOrEqual(after + DAY);
    } finally {
      globalThis.Date = original;
      if (had === undefined) delete scope[key];
      else scope[key] = had;
    }
  });
});

describe("FAKE_NOW: this run's clock", () => {
  // The workflow's canary. `performance` reads the real clock whatever Date
  // does: the moment this process started, plus the time since.
  it("reads FAKE_NOW, or the real time when it is not set", () => {
    const real = performance.timeOrigin + performance.now();
    const spec = process.env.FAKE_NOW;
    if (!spec) {
      expect(Math.abs(Date.now() - real)).toBeLessThan(5_000);
      return;
    }
    const fake = parseFakeNow(spec);
    if (fake.kind === "offset") {
      expect(Math.abs(Date.now() - real - fake.ms)).toBeLessThan(5_000);
    } else {
      // Set when the file started, and running on since.
      expect(Date.now() - fake.ms).toBeGreaterThanOrEqual(0);
      expect(Date.now() - fake.ms).toBeLessThan(10 * 60_000);
    }
  });
});
