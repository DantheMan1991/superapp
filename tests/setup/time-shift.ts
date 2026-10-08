/**
 * Moves the clock the tests read, when FAKE_NOW is set. A no-op otherwise.
 *
 * WHY. On 2026-10-01 tests/paste-targets-db.test.ts failed all day on every
 * branch: it wrote a "future" date, and that day the date was today. A test
 * like that passes on every run until the day it does not, so the only way to
 * find one early is to run it with the clock on that day. The Date bombs
 * workflow (.github/workflows/date-bombs.yml) does that every day, and this
 * file is how it moves the clock. It was first written for the sweep in #705,
 * which found one more (fitness-ops, 2099).
 *
 * TWO FORMS.
 *
 *   FAKE_NOW=2031-06-15T12:00:00Z   the clock reads that instant when each
 *                                   test file starts, and runs on from there.
 *   FAKE_NOW=+5184000, or +60d      the clock reads real time plus exactly
 *                                   that offset: seconds, or m, h, d or y
 *                                   (365 days), as libfaketime reads it.
 *
 * The offset form is libfaketime's own, and that is the point of it. Postgres
 * stamps rows with its own `now()`, so moving only this clock fails every test
 * that compares a stamped row with JS time, for no reason at all: 12 of them
 * in #705's sweep (rate caps, import windows, `last_7_days`, support-session
 * expiry). The workflow hands Postgres the same string, so the two clocks move
 * by the same offset, to the second. A date moves this clock only; against a
 * database whose clock did not move, a db failure is a lead, not a verdict,
 * and tests/time-shift-db.test.ts says so.
 *
 * WHAT MOVES: `new Date()` with no arguments, `Date()` and `Date.now()`. A Date
 * given its time keeps it. `performance.now()`, timers, and anything that reads
 * the clock beneath JavaScript (`Intl.DateTimeFormat().format()` with no date)
 * do not move.
 *
 * An unreadable FAKE_NOW throws rather than running on the real clock: a guard
 * that quietly failed to move the clock would pass every morning, forever.
 */

const UNIT_SECONDS = { "": 1, m: 60, h: 3_600, d: 86_400, y: 31_536_000 } as const;

export type FakeNow =
  /** Real time plus `ms`, however long the run takes. */
  | { kind: "offset"; ms: number }
  /** The clock reads `ms` when the file starts. */
  | { kind: "instant"; ms: number };

/** Reads FAKE_NOW, or throws on anything it cannot read. */
export function parseFakeNow(spec: string): FakeNow {
  const value = spec.trim();
  const offset = /^([+-])(\d+)([mhdy]?)$/.exec(value);
  if (offset) {
    const [, sign, amount, unit] = offset;
    const seconds = Number(amount) * UNIT_SECONDS[unit as keyof typeof UNIT_SECONDS];
    return { kind: "offset", ms: (sign === "-" ? -1 : 1) * seconds * 1000 };
  }
  // A date must be written as one. V8 reads `Date.parse("1")` as a day in 2001,
  // and a typo should not become a clock.
  const instant = Date.parse(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(instant)) {
    return { kind: "instant", ms: instant };
  }
  throw new Error(
    `FAKE_NOW=${JSON.stringify(spec)} is neither an offset (+60d, -15d, +5184000) ` +
      `nor a date (2031-06-15T12:00:00Z). Refusing to run on the real clock.`,
  );
}

/** A `Date` whose readings of "now" are `offsetMs` from the real clock. */
export function shiftedDate(RealDate: DateConstructor, offsetMs: number): DateConstructor {
  const now = () => RealDate.now() + offsetMs;
  return new Proxy(RealDate, {
    construct(target, args, newTarget) {
      return Reflect.construct(target, args.length === 0 ? [now()] : args, newTarget);
    },
    // `Date()` called without `new` ignores its arguments and returns a string.
    apply() {
      return new RealDate(now()).toString();
    },
    get(target, prop, receiver) {
      return prop === "now" ? now : Reflect.get(target, prop, receiver);
    },
  });
}

const INSTALLED = Symbol.for("superapp.time-shift");

/** Replaces `globalThis.Date`, once per process. Does nothing without a spec. */
export function installTimeShift(spec: string | undefined): void {
  if (!spec) return;
  const scope = globalThis as typeof globalThis & { [INSTALLED]?: string };
  // A second wrap would add the offset twice.
  if (scope[INSTALLED] !== undefined) return;
  const fake = parseFakeNow(spec);
  const RealDate = globalThis.Date;
  const offset = fake.kind === "offset" ? fake.ms : fake.ms - RealDate.now();
  globalThis.Date = shiftedDate(RealDate, offset);
  scope[INSTALLED] = spec;
}

installTimeShift(process.env.FAKE_NOW);
