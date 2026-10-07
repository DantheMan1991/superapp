import { describe, expect, it } from "vitest";
import {
  annotation,
  canaryProblem,
  datesIn,
  failedAgain,
  issueBody,
  issueMarker,
  issueTitle,
  offsetFor,
  offsetMs,
  planRuns,
  readReport,
  secondsOffset,
  summaryMarkdown,
  verdict,
  whenTestsFail,
  writtenDates,
  type Bomb,
  type FileResult,
  type Outcome,
} from "../scripts/lib/date-bombs";
import { parseFakeNow } from "./setup/time-shift";

/**
 * The Date bombs guard's reasoning (scripts/lib/date-bombs.ts). Its running,
 * with Postgres and the clocks, was proven by running it: see the 2026-10-07
 * entry in docs/modules/ci-and-tests.md.
 *
 * Every date here is long past or in 2031. A date in the next 60 days would
 * put this file into the guard's own plan for that day, for nothing.
 */

const passed = (file: string, n = 3): FileResult => ({ file, failed: [], error: null, passed: n, skipped: 0 });

describe("date bombs: the dates the tests write", () => {
  it("finds every real day written as YYYY-MM-DD, once each, timestamps included", () => {
    const text = `
      setPrice({ from: "2031-03-01" });            // a price
      const at = new Date("2031-03-05T08:00:00Z"); // a timestamp
      const again = "2031-03-01";                  // the same day twice
      const nope = "2031-02-30";                   // not a day
      const id = "x-12031-03-07";                  // digits on the left
      const longer = "2031-03-099";                // digits on the right
    `;
    expect(datesIn(text).sort()).toEqual(["2031-03-01", "2031-03-05"]);
  });

  it("keeps the days after today up to the horizon, each with the files that write it", () => {
    const { dates, unrun } = writtenDates(
      [
        { path: "tests/a.test.ts", text: `"2031-01-10" "2031-01-11" "2031-03-12"` },
        { path: "tests/b.test.ts", text: `"2031-01-11" "2031-02-09" "2031-02-10"` },
        { path: "tests/c.test.ts", text: `no dates` },
      ],
      "2031-01-10",
      30,
    );
    // Today itself is what every run already tests; 2031-02-09 is the last day in.
    expect(dates).toEqual([
      { date: "2031-01-11", files: ["tests/a.test.ts", "tests/b.test.ts"] },
      { date: "2031-02-09", files: ["tests/b.test.ts"] },
    ]);
    expect(unrun).toEqual([]);
  });

  it("runs a helper's dates through the tests that name it, and reports one nobody names", () => {
    const { dates, unrun } = writtenDates(
      [
        { path: "tests/fixtures/prices.json", text: `{ "from": "2031-01-20" }` },
        { path: "tests/prices.test.ts", text: `import prices from "./fixtures/prices.json";` },
        { path: "tests/other.test.ts", text: `import { x } from "./fixtures/prices-old";` },
        { path: "tests/fixtures/orphan.ts", text: `export const day = "2031-01-25";` },
      ],
      "2031-01-10",
      60,
    );
    expect(dates).toEqual([{ date: "2031-01-20", files: ["tests/prices.test.ts"] }]);
    expect(unrun).toEqual([{ date: "2031-01-25", file: "tests/fixtures/orphan.ts" }]);
  });
});

describe("date bombs: the runs", () => {
  const dates = [
    { date: "2031-01-11", files: ["tests/a.test.ts", "tests/b.test.ts"] },
    { date: "2031-01-20", files: ["tests/b.test.ts"] },
  ];

  it("moves the clock forward through the written dates, then the horizon", () => {
    expect(planRuns(dates, 60, null)).toEqual([
      { kind: "written", date: "2031-01-11", files: ["tests/a.test.ts", "tests/b.test.ts"] },
      { kind: "written", date: "2031-01-20", files: ["tests/b.test.ts"] },
      { kind: "horizon", days: 60, files: null },
    ]);
  });

  it("narrows every run to --only's files, and drops a day left with none", () => {
    expect(planRuns(dates, 60, ["tests/a.test.ts"])).toEqual([
      { kind: "written", date: "2031-01-11", files: ["tests/a.test.ts"] },
      { kind: "horizon", days: 60, files: ["tests/a.test.ts"] },
    ]);
  });

  it("puts a written date's clock at noon UTC, and the horizon a whole number of days on", () => {
    const now = Date.UTC(2031, 0, 10, 5, 0, 0);
    expect(offsetFor({ kind: "written", date: "2031-01-11", files: [] }, now)).toBe(`+${31 * 3600}`);
    expect(offsetFor({ kind: "horizon", days: 60, files: null }, now)).toBe("+60d");
    // A probe at noon earlier today is behind the clock, and says so.
    expect(secondsOffset(-90_600)).toBe("-91");
  });

  it("writes offsets the tests' clock and Postgres's read the same way", () => {
    // THE CONTRACT. The guard hands one string to FAKE_NOW and to libfaketime;
    // if tests/setup/time-shift.ts read it differently, the clocks would part.
    for (const offset of ["+0", "+94864", "-91", "+60d", "+1d"]) {
      expect(parseFakeNow(offset)).toEqual({ kind: "offset", ms: offsetMs(offset) });
    }
    expect(() => offsetMs("+1h")).toThrow();
  });
});

describe("date bombs: reading a run", () => {
  it("reads vitest's report into a result per file, paths repo-relative whatever the drive's case", () => {
    const report = {
      testResults: [
        {
          name: "c:/repo/tests/a.test.ts",
          status: "failed",
          message: "",
          assertionResults: [
            { fullName: "a works", status: "passed", failureMessages: [] },
            {
              fullName: "a collides",
              status: "failed",
              failureMessages: ["\u001b[31mAssertionError: expected '2031-01-11' not to be '2031-01-11'\u001b[39m\n    at tests/a.test.ts:4:5\n    at run"],
            },
            { fullName: "a later", status: "skipped", failureMessages: [] },
          ],
        },
        { name: "C:/repo/tests/b.test.ts", status: "failed", message: "Error: beforeAll timed out", assertionResults: [] },
      ],
    };
    expect(readReport(report, "C:\\repo")).toEqual([
      {
        file: "tests/a.test.ts",
        failed: [{ test: "a collides", message: "AssertionError: expected '2031-01-11' not to be '2031-01-11'" }],
        error: null,
        passed: 1,
        skipped: 1,
      },
      { file: "tests/b.test.ts", failed: [], error: "Error: beforeAll timed out", passed: 0, skipped: 0 },
    ]);
  });

  it("refuses a run whose canaries did not pass in full", () => {
    const both = [passed("tests/time-shift.test.ts"), passed("tests/time-shift-db.test.ts", 1)];
    expect(canaryProblem(both)).toBeNull();
    expect(canaryProblem([both[0]])).toMatch(/time-shift-db.test.ts did not run/);
    expect(canaryProblem([both[0], { ...both[1], passed: 0, skipped: 1 }])).toMatch(/skipped/);
    expect(
      canaryProblem([both[0], { ...both[1], failed: [{ test: "agrees", message: "The database reads" }] }]),
    ).toMatch(/time-shift-db.test.ts failed: agrees: The database reads/);
  });

  it("calls a failure a bomb only if it fails again and passes on the real clock", () => {
    expect(verdict(true, false)).toBe("bomb");
    expect(verdict(true, true)).toBe("fails-now");
    expect(verdict(false, true)).toBe("fails-now");
    expect(verdict(false, false)).toBe("not-reproduced");
  });

  it("follows the tests that failed, not the file", () => {
    const run: FileResult[] = [{ file: "tests/a.test.ts", failed: [{ test: "other", message: "" }], error: null, passed: 2, skipped: 0 }];
    // Another bomb in the same file failing on this day is not this one failing.
    expect(failedAgain(run, "tests/a.test.ts", ["from the 20th"])).toBe(false);
    expect(failedAgain(run, "tests/a.test.ts", ["other"])).toBe(true);
    // With no names (the file itself failed), any failure counts.
    expect(failedAgain(run, "tests/a.test.ts", [])).toBe(true);
    // A failure outside the tests hides them, so it counts.
    expect(failedAgain([{ ...run[0], failed: [], error: "boom" }], "tests/a.test.ts", ["from the 20th"])).toBe(true);
    expect(failedAgain([passed("tests/a.test.ts")], "tests/a.test.ts", ["other"])).toBe(false);
  });
});

describe("date bombs: what it says", () => {
  const bombs: Bomb[] = [
    { file: "tests/a.test.ts", date: "2031-01-20", how: "on", failed: [{ test: "collides", message: "AssertionError: one" }] },
    { file: "tests/a.test.ts", date: "2031-02-01", how: "on", failed: [{ test: "future", message: "AssertionError: two" }] },
    { file: "tests/a.test.ts", date: "2031-01-25", how: "from", failed: [{ test: "future", message: "AssertionError: two" }] },
  ];

  it("gives each test one line: the single days, then the day it breaks for good", () => {
    expect(whenTestsFail(bombs)).toEqual([
      { test: "collides", when: "on 2031-01-20", message: "AssertionError: one" },
      // 2031-02-01 is after it breaks for good, so it says nothing new.
      { test: "future", when: "from 2031-01-25", message: "AssertionError: two" },
    ]);
  });

  it("opens an issue a session can act on, marked so it is never opened twice", () => {
    expect(issueTitle(bombs)).toBe("Date bomb: tests/a.test.ts fails on 2031-01-20");
    const body = issueBody(bombs, { runUrl: "https://github.com/o/r/actions/runs/1", sha: "0123456789abcdef", isDb: true });
    expect(body.startsWith(issueMarker("tests/a.test.ts"))).toBe(true);
    expect(body).toContain("| future | from 2031-01-25 | AssertionError: two |");
    expect(body).toContain("FAKE_NOW=2031-01-20T12:00:00Z npx vitest run tests/a.test.ts");
    expect(body).toContain("docs/runbooks/date-bombs.md");
    expect(body).toContain("This is a db test");
    expect(body).toContain("([run](https://github.com/o/r/actions/runs/1)) on `01234567`");
  });

  it("warns on the file in GitHub's own syntax, escaped", () => {
    expect(annotation({ file: "tests/a.test.ts", date: "2031-01-20", how: "on", failed: [{ test: "a, b: c", message: "" }] })).toBe(
      "::warning file=tests/a.test.ts,title=Date bomb on 2031-01-20::Fails with the clock on 2031-01-20, passes on the real clock: a, b: c",
    );
  });

  it("leads the summary with the verdict: clean, bombs, or a guard that broke", () => {
    const base: Outcome = {
      today: "2031-01-10",
      horizonDays: 60,
      only: false,
      runs: [
        { label: "2031-01-20 (written)", offset: "+900000", files: 3, tests: 20, failedFiles: [], seconds: 9 },
        { label: "2031-03-11 (60 days ahead, whole suite)", offset: "+60d", files: 440, tests: 8000, failedFiles: [], seconds: 480 },
      ],
      bombs: [],
      others: [],
      unrun: [],
      issues: [],
      opensIssues: true,
      broken: null,
    };
    expect(summaryMarkdown(base)).toContain(
      "**No date bombs.** Both clocks moved for 2 runs: 1 written date in the next 60 days, then the whole suite 60 days ahead.",
    );
    const found = summaryMarkdown({
      ...base,
      bombs,
      issues: [{ file: "tests/a.test.ts", url: "https://github.com/o/r/issues/9", existing: true }],
    });
    expect(found).toContain("**1 test file will fail on a date.**");
    expect(found).toContain("| `tests/a.test.ts` | collides | on 2031-01-20 | https://github.com/o/r/issues/9 (already open) |");
    expect(summaryMarkdown({ ...base, broken: "Postgres's clock did not move to +60d" })).toContain(
      "**The guard broke, so this is not a clean run:** Postgres's clock did not move to +60d",
    );
  });
});
