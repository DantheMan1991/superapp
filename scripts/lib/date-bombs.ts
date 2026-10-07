/**
 * The Date bombs guard's reasoning, kept apart from its running
 * (scripts/date-bombs.ts) so tests/date-bombs.test.ts can check it.
 *
 * A DATE BOMB is a test that passes on every run until a particular day and
 * then fails on every branch at once. tests/paste-targets-db.test.ts was one:
 * it pasted a price "from 2026-10-01" beside one "from today", and on
 * 2026-10-01 the two collided (fixed in #688). That kind fails on ONE day, so
 * running the suite with the clock "60 days ahead" never meets it: its test
 * was written 22 days before its date. What meets it is running each test file
 * on the dates it writes. The other kind breaks from some date on and stays
 * broken (fitness-ops' 2099, #705), and one run far enough ahead meets that.
 * The guard does both.
 */

export const DAY_MS = 86_400_000;

/** A file under tests/, as the guard reads it. Paths are repo-relative. */
export type SourceFile = { path: string; text: string };

/** One run of vitest, with the clock moved. */
export type Run =
  /** The files that write `date`, with the clock at noon UTC that day. */
  | { kind: "written"; date: string; files: string[] }
  /** The whole suite (or `--only`'s files), with the clock `days` ahead. */
  | { kind: "horizon"; days: number; files: string[] | null };

/** How one test file came out of one run. */
export type FileResult = {
  file: string;
  /** Tests that failed, by full name, each with the start of its message. */
  failed: { test: string; message: string }[];
  /** A failure outside any test: an import, a hook, a suite that never ran. */
  error: string | null;
  passed: number;
  skipped: number;
};

/** What a file that failed turned out to be, once tried again. */
export type Verdict =
  /** Failed again on the same clock, passed on the real one. */
  | "bomb"
  /** Failed on the real clock too: broken, or flaky, but not about the date. */
  | "fails-now"
  /** Passed on the second try with the clock moved: flaky, not a date. */
  | "not-reproduced";

/** A bomb, found and confirmed in one file. */
export type Bomb = {
  file: string;
  /** The day the file fails: a written date, or the first day bisection found. */
  date: string;
  /** "on": that day's run failed. "from": it fails from that day on. */
  how: "on" | "from";
  failed: { test: string; message: string }[];
};

/** Files whose name says they are tests, by vitest's include pattern. */
export const isTestFile = (path: string) => path.endsWith(".test.ts");

const WRITTEN = /(?<!\d)(20\d{2}-[01]\d-[0-3]\d)(?!\d)/g;

/** Every real day written in `text` as YYYY-MM-DD, once each. */
export function datesIn(text: string): string[] {
  const days = new Set<string>();
  for (const [, day] of text.matchAll(WRITTEN)) {
    const ms = Date.parse(`${day}T00:00:00Z`);
    // 2026-02-31 matches the pattern and is not a day.
    if (Number.isFinite(ms) && new Date(ms).toISOString().startsWith(day)) days.add(day);
  }
  return [...days];
}

/** `day` plus `n` days, as YYYY-MM-DD. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The test files that import or read a helper file, judged by its name. */
function usersOf(helper: string, files: SourceFile[]): string[] {
  const base = helper.split("/").pop()!.replace(/\.[^.]+$/, "");
  const named = new RegExp(`/${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`.]`);
  return files.filter((f) => isTestFile(f.path) && named.test(f.text)).map((f) => f.path);
}

/**
 * The days after `today`, up to `horizonDays` on, that the tests write, each
 * with the test files to run on it. A date in a file that is not a test (a
 * fixture, a helper) runs the test files that name that file; one nothing
 * names is returned in `unrun`, to be reported rather than dropped.
 */
export function writtenDates(
  files: SourceFile[],
  today: string,
  horizonDays: number,
): { dates: { date: string; files: string[] }[]; unrun: { date: string; file: string }[] } {
  const last = addDays(today, horizonDays);
  const byDate = new Map<string, Set<string>>();
  const unrun: { date: string; file: string }[] = [];
  for (const file of files) {
    const days = datesIn(file.text).filter((d) => d > today && d <= last);
    if (days.length === 0) continue;
    const runs = isTestFile(file.path) ? [file.path] : usersOf(file.path, files);
    for (const date of days) {
      if (runs.length === 0) unrun.push({ date, file: file.path });
      for (const run of runs) {
        if (!byDate.has(date)) byDate.set(date, new Set());
        byDate.get(date)!.add(run);
      }
    }
  }
  const dates = [...byDate]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, set]) => ({ date, files: [...set].sort() }));
  return { dates, unrun: unrun.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) };
}

/**
 * The runs, in the order the clock should move: each written date in turn,
 * then the horizon. `only`, when given, keeps just those files.
 */
export function planRuns(
  dates: { date: string; files: string[] }[],
  horizonDays: number,
  only: string[] | null,
): Run[] {
  const keep = (files: string[]) => (only ? files.filter((f) => only.includes(f)) : files);
  const runs: Run[] = dates
    .map(({ date, files }) => ({ kind: "written" as const, date, files: keep(files) }))
    .filter((run) => run.files.length > 0);
  runs.push({ kind: "horizon", days: horizonDays, files: only });
  return runs;
}

/** Noon UTC on `day`: midday in every zone from UTC-11 to UTC+11. */
export const noonOf = (day: string) => Date.parse(`${day}T12:00:00Z`);

/**
 * The offset that puts the clock where `run` wants it, from `nowMs`, written as
 * both FAKE_NOW and libfaketime read it: whole seconds, or whole days.
 */
export function offsetFor(run: Run, nowMs: number): string {
  if (run.kind === "horizon") return `+${run.days}d`;
  return secondsOffset(noonOf(run.date) - nowMs);
}

/** An offset of `ms`, to the second, signed as libfaketime wants it. */
export function secondsOffset(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 0 ? `${seconds}` : `+${seconds}`;
}

/** The milliseconds in an offset this guard wrote (`±N` seconds or `+Nd`). */
export function offsetMs(offset: string): number {
  const m = /^([+-])(\d+)(d?)$/.exec(offset);
  if (!m) throw new Error(`Not an offset this guard writes: ${offset}`);
  return (m[1] === "-" ? -1 : 1) * Number(m[2]) * (m[3] ? DAY_MS : 1000);
}

/** The day a run puts the clock on, as the summary says it. */
export function dayOf(run: Run, today: string): string {
  return run.kind === "written" ? run.date : addDays(today, run.days);
}

/** A run, named for the summary. */
export function describeRun(run: Run, today: string): string {
  if (run.kind === "written") return `${run.date} (written)`;
  return `${addDays(today, run.days)} (${run.days} days ahead${run.files ? ", --only" : ", whole suite"})`;
}

type ReportAssertion = { fullName?: string; status?: string; failureMessages?: string[] };
type ReportFile = { name?: string; status?: string; message?: string; assertionResults?: ReportAssertion[] };

/** The first lines of a failure, without colour codes or a stack. */
export function firstLines(message: string, max = 600): string {
  const plain = message.replace(/\u001b\[[0-9;]*m/g, "");
  const lines = plain.split("\n");
  const stack = lines.findIndex((l) => /^\s+at /.test(l));
  const head = (stack === -1 ? lines : lines.slice(0, stack)).join("\n").trim();
  return head.length > max ? `${head.slice(0, max)}…` : head;
}

/** Reads vitest's JSON report into one result per file, paths repo-relative. */
export function readReport(report: unknown, root: string): FileResult[] {
  const files = ((report as { testResults?: ReportFile[] })?.testResults ?? []) as ReportFile[];
  const prefix = root.replace(/\\/g, "/").replace(/\/?$/, "/");
  return files.map((f) => {
    const name = (f.name ?? "").replace(/\\/g, "/");
    // Case-blind: Windows can spell the same drive C: and c:.
    const file = name.toLowerCase().startsWith(prefix.toLowerCase()) ? name.slice(prefix.length) : name;
    const tests = f.assertionResults ?? [];
    const failed = tests
      .filter((t) => t.status === "failed")
      .map((t) => ({ test: t.fullName ?? "(unnamed)", message: firstLines((t.failureMessages ?? []).join("\n")) }));
    const error =
      f.status === "failed" && failed.length === 0
        ? firstLines(f.message || "The file failed outside any test, and vitest gave no message.")
        : null;
    return {
      file,
      failed,
      error,
      passed: tests.filter((t) => t.status === "passed").length,
      skipped: tests.filter((t) => t.status !== "passed" && t.status !== "failed").length,
    };
  });
}

export const failedIn = (results: FileResult[]) =>
  results.filter((r) => r.failed.length > 0 || r.error !== null);

/**
 * Whether any of `tests` failed again in `file`, or the file failed outside
 * them (which hides whether they would have). With no names, as when the file
 * itself failed the first time, any failure in it counts.
 *
 * Following the tests rather than the file matters when a file holds two
 * bombs: bisecting one that fails from the 20th must not stop at another that
 * fails only on the 6th.
 */
export function failedAgain(results: FileResult[], file: string, tests: string[]): boolean {
  const r = results.find((x) => x.file === file);
  if (!r) return false;
  if (r.error !== null) return true;
  return tests.length === 0 ? r.failed.length > 0 : r.failed.some((t) => tests.includes(t.test));
}

/** The two files every run must include, and pass in full. */
export const CANARIES = ["tests/time-shift.test.ts", "tests/time-shift-db.test.ts"];

/**
 * Why a run cannot be trusted, or null. A canary that failed, was skipped or
 * never ran means the clocks did not move the way the run says they did.
 */
export function canaryProblem(results: FileResult[]): string | null {
  for (const canary of CANARIES) {
    const r = results.find((x) => x.file === canary);
    if (!r) return `${canary} did not run.`;
    if (r.error) return `${canary} failed: ${r.error}`;
    if (r.failed.length > 0) return `${canary} failed: ${r.failed[0].test}: ${r.failed[0].message}`;
    if (r.passed === 0 || r.skipped > 0) return `${canary} was skipped, so nothing proved the clocks moved.`;
  }
  return null;
}

/** What a failed file is, from its second try on the moved clock and its try on the real one. */
export function verdict(failedAgain: boolean, failedOnRealClock: boolean): Verdict {
  if (failedOnRealClock) return "fails-now";
  return failedAgain ? "bomb" : "not-reproduced";
}

/** The comment that marks an issue as this file's, so it is never opened twice. */
export const issueMarker = (file: string) => `<!-- date-bomb: ${file} -->`;

/** The earliest day among a file's bombs. */
const earliest = (bombs: Bomb[]) => [...bombs].sort((a, b) => (a.date < b.date ? -1 : 1))[0];

/**
 * When each failing test fails, one line per test: "from" the first day of
 * one that stays broken, and "on" each single day of one that does not (only
 * the days before its "from", which would say them again).
 */
export function whenTestsFail(bombs: Bomb[]): { test: string; when: string; message: string }[] {
  const tests = new Map<string, { on: Set<string>; from: string | null; message: string }>();
  for (const b of bombs) {
    for (const t of b.failed) {
      const entry = tests.get(t.test) ?? { on: new Set<string>(), from: null, message: t.message };
      if (b.how === "from") entry.from = entry.from && entry.from < b.date ? entry.from : b.date;
      else entry.on.add(b.date);
      tests.set(t.test, entry);
    }
  }
  return [...tests].map(([test, e]) => {
    const on = [...e.on].filter((d) => !e.from || d < e.from).sort();
    const when = [...(on.length ? [`on ${on.join(", ")}`] : []), ...(e.from ? [`from ${e.from}`] : [])].join(", then ");
    return { test, when, message: e.message };
  });
}

export function issueTitle(bombs: Bomb[]): string {
  const first = earliest(bombs);
  return `Date bomb: ${first.file} fails ${first.how} ${first.date}`;
}

/** The command that runs the file with the clock where it failed. */
export function reproduce(bomb: Bomb): string {
  return `FAKE_NOW=${bomb.date}T12:00:00Z npx vitest run ${bomb.file}`;
}

/**
 * An issue for one file's bombs. Self-contained, because it is what a session
 * will be handed to fix it: what fails, on which day, how to see it, and where
 * the fix is written down.
 */
export function issueBody(bombs: Bomb[], context: { runUrl: string | null; sha: string | null; isDb: boolean }): string {
  const first = earliest(bombs);
  const rows = whenTestsFail(bombs).map((t) => `| ${cell(t.test)} | ${t.when} | ${cell(t.message.split("\n")[0])} |`);
  const message = bombs.flatMap((b) => b.failed).map((t) => t.message).find(Boolean) ?? "";
  return [
    issueMarker(first.file),
    "",
    `**\`${first.file}\` fails with the clock moved ahead, and passes on the real clock.** ` +
      `Left alone it will start failing by itself ${first.how} ${first.date}, on every branch at once, ` +
      `the way \`tests/paste-targets-db.test.ts\` did on 2026-10-01.`,
    "",
    "| Test | Fails | First line of the failure |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "The first failure in full:",
    "",
    "```",
    message,
    "```",
    "",
    "**See it fail:**",
    "",
    "```bash",
    reproduce(first),
    "```",
    "",
    context.isDb
      ? "This is a db test, and `FAKE_NOW` moves only the tests' clock. Against a database whose clock did not move " +
        "(the Neon dev branch) it may fail for that reason alone, and `tests/time-shift-db.test.ts` will say so. " +
        "`docs/runbooks/date-bombs.md` runs it with both clocks moved, as the guard did."
      : "A pure test: the command above is all it takes.",
    "",
    "**Fix:** make the written date relative to the run, and prove it both ways. `docs/runbooks/date-bombs.md` has the steps. " +
      "The guard leaves this issue alone while it is open, so close it when the fix is merged.",
    "",
    `Found by the Date bombs workflow${context.runUrl ? ` ([run](${context.runUrl}))` : ""}` +
      `${context.sha ? ` on \`${context.sha.slice(0, 8)}\`` : ""}.`,
  ].join("\n");
}

/** Text safe inside a markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** A GitHub warning on the file, shown on the run and on a pull request's checks. */
export function annotation(bomb: Bomb): string {
  const data = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const property = (s: string) => data(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
  const tests = bomb.failed.map((t) => t.test).join("; ");
  return (
    `::warning file=${property(bomb.file)},title=${property(`Date bomb ${bomb.how} ${bomb.date}`)}::` +
    data(`Fails with the clock ${bomb.how} ${bomb.date}, passes on the real clock: ${tests}`)
  );
}

/** Everything one guard run learned, for its summary. */
export type Outcome = {
  today: string;
  horizonDays: number;
  /** Whether `--only` narrowed every run to a few files. */
  only: boolean;
  runs: { label: string; offset: string; files: number; tests: number; failedFiles: string[]; seconds: number }[];
  bombs: Bomb[];
  /** Failed with the clock moved, but are not bombs: what each turned out to be. */
  others: { file: string; day: string; verdict: Exclude<Verdict, "bomb"> }[];
  unrun: { date: string; file: string }[];
  /** Issues per file: opened by this run, or already open. */
  issues: { file: string; url: string; existing: boolean }[];
  /** Whether this run opens issues (a pull request from a fork cannot). */
  opensIssues: boolean;
  /** Why the guard could not finish honestly, or null. */
  broken: string | null;
};

/** The run's summary, in markdown, for $GITHUB_STEP_SUMMARY. */
export function summaryMarkdown(o: Outcome): string {
  const files = new Set(o.bombs.map((b) => b.file));
  const written = o.runs.length - 1;
  const span =
    o.runs.length > 0
      ? `${written} written date${written === 1 ? "" : "s"} in the next ${o.horizonDays} days, then ` +
        `${o.only ? "the same files" : "the whole suite"} ${o.horizonDays} days ahead`
      : "nothing";
  const lead = o.broken
    ? `**The guard broke, so this is not a clean run:** ${o.broken}`
    : files.size === 0
      ? `**No date bombs.** Both clocks moved for ${o.runs.length} run${o.runs.length === 1 ? "" : "s"}: ${span}.`
      : `**${files.size} test file${files.size === 1 ? "" : "s"} will fail on a date.** Both clocks moved for ${o.runs.length} runs: ${span}.`;
  const out = [`## Date bombs`, "", lead, ""];

  if (o.bombs.length > 0) {
    out.push("### Bombs", "", "| File | Test | Fails | Issue |", "| --- | --- | --- | --- |");
    for (const file of files) {
      const issue = o.issues.find((i) => i.file === file);
      const where = issue ? `${issue.url}${issue.existing ? " (already open)" : ""}` : o.opensIssues ? "not opened" : "none from this run";
      for (const t of whenTestsFail(o.bombs.filter((b) => b.file === file))) {
        out.push(`| \`${file}\` | ${cell(t.test)} | ${t.when} | ${where} |`);
      }
    }
    out.push("");
  }

  if (o.others.length > 0) {
    out.push("### Failed with the clock moved, but not a date bomb", "", "| File | Clock | What it was |", "| --- | --- | --- |");
    for (const x of o.others) {
      const what = x.verdict === "fails-now" ? "fails on the real clock too" : "passed on a second try with the clock moved";
      out.push(`| \`${x.file}\` | ${x.day} | ${what} |`);
    }
    out.push("");
  }

  if (o.unrun.length > 0) {
    out.push(
      "### Dates written where no test runs them",
      "",
      "Written in a file that is not a test, and no test file names it, so nothing ran on these days.",
      "",
      ...o.unrun.map((u) => `- ${u.date} in \`${u.file}\``),
      "",
    );
  }

  out.push("### Runs", "", "| Clock | Offset | Files | Tests | Failed files | Seconds |", "| --- | --- | ---: | ---: | --- | ---: |");
  for (const r of o.runs) {
    const failed = r.failedFiles.length ? r.failedFiles.map((f) => `\`${f}\``).join("<br>") : "";
    out.push(`| ${r.label} | \`${r.offset}\` | ${r.files} | ${r.tests} | ${failed} | ${r.seconds} |`);
  }
  return out.join("\n") + "\n";
}
