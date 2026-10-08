import { spawnSync } from "node:child_process";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "@neondatabase/serverless";
import { DB_BACKED_TESTS } from "../tests/db-backed-files";
import {
  addDays,
  annotation,
  CANARIES,
  canaryProblem,
  describeRun,
  dayOf,
  failedAgain,
  failedIn,
  issueBody,
  issueMarker,
  issueTitle,
  noonOf,
  offsetFor,
  offsetMs,
  planRuns,
  readReport,
  secondsOffset,
  summaryMarkdown,
  verdict,
  writtenDates,
  type Bomb,
  type FileResult,
  type Outcome,
  type Run,
  type SourceFile,
} from "./lib/date-bombs";
import { configureNeonForLocalProxy } from "./lib/neon-local";

/**
 * The Date bombs guard: the test suite run with the clock on every date the
 * tests write in the next 60 days, and once 60 days ahead. A test that fails
 * there and passes today will fail by itself on that date, on every branch at
 * once. .github/workflows/date-bombs.yml runs this every day;
 * docs/runbooks/date-bombs.md runs it by hand. The reasoning is in
 * scripts/lib/date-bombs.ts.
 *
 *   npx tsx scripts/date-bombs.ts                      the whole guard
 *   npx tsx scripts/date-bombs.ts --plan               print the runs, run nothing
 *   npx tsx scripts/date-bombs.ts --only <file>...     every run, those files only
 *   npx tsx scripts/date-bombs.ts --horizon-days 30    look 30 days ahead, not 60
 *
 * BOTH CLOCKS MOVE, by the same offset: the tests' through FAKE_NOW
 * (tests/setup/time-shift.ts) and Postgres's through libfaketime, which reads
 * $DATE_BOMB_CLOCK_DIR/offset (docker/postgres-faketime). A row the database
 * stamps and a JS reading then agree, as they do on any real day.
 *
 * EVERY RUN GETS A FRESH DATABASE, cloned from the migrated and seeded one.
 * Runs on different days must not see each other's rows: a rate cap counting
 * rows stamped two months on fails for a reason no real day has.
 *
 * A FAILURE IS TRIED TWICE MORE before it is called a bomb: on the same clock,
 * where it must fail again, and on the real clock, where it must pass. One
 * that fails from some date on is then bisected to the first day it fails.
 *
 * Exit 0 when the guard worked, bombs or none: they are reported as issues,
 * warnings and the run's summary. Exit 1 only when the guard itself broke.
 *
 * It creates and drops databases, so it refuses any that is not on this machine.
 */

const RUN_DATABASE = "date_bomb_run";
const DEFAULT_HORIZON_DAYS = 60;
/** More files than this failing on one clock is not dates; it is something broken. */
const MOST_FAILED_FILES = 15;

type Options = { planOnly: boolean; horizonDays: number; only: string[] | null };

function readOptions(argv: string[]): Options {
  const options: Options = {
    planOnly: false,
    horizonDays: Number(process.env.DATE_BOMB_HORIZON_DAYS || DEFAULT_HORIZON_DAYS),
    only: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--plan") options.planOnly = true;
    else if (arg === "--horizon-days") options.horizonDays = Number(argv[++i]);
    else if (arg === "--only") {
      options.only = [];
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) options.only.push(argv[++i].replace(/\\/g, "/"));
    } else throw new Error(`Unknown argument ${arg}. See the top of scripts/date-bombs.ts.`);
  }
  if (!Number.isInteger(options.horizonDays) || options.horizonDays < 1) {
    throw new Error(`The horizon must be a whole number of days, at least 1, not ${options.horizonDays}.`);
  }
  return options;
}

/** Every text file under tests/, repo-relative with forward slashes. */
async function readTests(root: string): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  async function walk(dir: string) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const bytes = await fs.readFile(full);
        // Fixtures can be images or PDFs; a NUL byte says this one is not text.
        if (bytes.length > 2_000_000 || bytes.subarray(0, 8_000).includes(0)) continue;
        out.push({ path: path.relative(root, full).split(path.sep).join("/"), text: bytes.toString("utf8") });
      }
    }
  }
  await walk(path.join(root, "tests"));
  return out;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. docs/runbooks/date-bombs.md lists what the guard needs.`);
  return value;
}

const isLocal = (url: URL) => url.hostname === "localhost" || url.hostname === "127.0.0.1";

/** The databases this run uses: the migrated template, and the clone each run gets. */
function databases() {
  const owner = new URL(required("TEST_DATABASE_URL_OWNER"));
  const app = new URL(required("TEST_DATABASE_URL"));
  if (!isLocal(owner) || !isLocal(app)) {
    throw new Error(
      "REFUSING: the guard creates and drops databases, and TEST_DATABASE_URL or " +
        `TEST_DATABASE_URL_OWNER is not on this machine (${owner.host}, ${app.host}).`,
    );
  }
  if (!configureNeonForLocalProxy()) {
    throw new Error("NEON_LOCAL_PROXY is not set: the driver has no way to reach the local Postgres.");
  }
  const template = decodeURIComponent(owner.pathname.slice(1));
  if (!/^[a-z_][a-z0-9_]*$/.test(template)) throw new Error(`Unexpected database name ${template}.`);
  const at = (url: URL, database: string) => {
    const copy = new URL(url);
    copy.pathname = `/${database}`;
    return copy.toString();
  };
  return {
    template,
    maintenance: at(owner, "postgres"),
    runOwner: at(owner, RUN_DATABASE),
    runApp: at(app, RUN_DATABASE),
  };
}

type Databases = ReturnType<typeof databases>;

/** One statement as the owner, on a connection opened and closed for it. */
async function asOwner<T>(db: Databases, text: string): Promise<T[]> {
  const pool = new Pool({ connectionString: db.maintenance });
  try {
    return (await pool.query(text)).rows as T[];
  } finally {
    await pool.end();
  }
}

async function freshDatabase(db: Databases) {
  await asOwner(db, `drop database if exists "${RUN_DATABASE}" with (force)`);
  // Postgres will not copy a database anyone is connected to, and nothing
  // should be: the seed has exited and every run uses the clone. A connection
  // the proxy has not finished closing is the one thing that could be there.
  await asOwner(db, `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${db.template}'`);
  await asOwner(db, `create database "${RUN_DATABASE}" template "${db.template}"`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Moves Postgres's clock, and proves it moved. libfaketime re-reads the file
 * within a second, and the file is replaced whole wherever the system allows.
 */
async function setDatabaseClock(db: Databases, clockDir: string, offset: string) {
  const file = path.join(clockDir, "offset");
  await fs.writeFile(`${file}.next`, `${offset}\n`);
  // Linux replaces a file another process has open without a murmur. Windows,
  // with Docker Desktop reading it every second, sometimes refuses (EPERM), so
  // try again, and in the end write it in place: a reader that catches it
  // half-written is put right a second later, and the check below waits for it.
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(`${file}.next`, file);
      break;
    } catch {
      if (attempt < 10) await sleep(100);
      else {
        await fs.writeFile(file, `${offset}\n`);
        await fs.rm(`${file}.next`, { force: true });
        break;
      }
    }
  }
  const want = offsetMs(offset);
  let apart = NaN;
  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(attempt === 0 ? 1_500 : 500);
    const [row] = await asOwner<{ ms: string }>(db, "select (extract(epoch from now()) * 1000)::float8 as ms");
    apart = Number(row.ms) - (Date.now() + want);
    if (Math.abs(apart) < 5_000) return;
  }
  throw new Error(
    `Postgres's clock did not move to ${offset}: it reads ${Math.round(apart / 1000)} s away from where it should. ` +
      "Is it the docker/postgres-faketime image, with $DATE_BOMB_CLOCK_DIR mounted at /etc/faketime?",
  );
}

type Context = { root: string; db: Databases; clockDir: string; reports: string; vitest: string; runs: number };

/** One vitest run, on a fresh database, with both clocks at `offset`. */
async function vitestRun(ctx: Context, files: string[] | null, offset: string, label: string) {
  await freshDatabase(ctx.db);
  await setDatabaseClock(ctx.db, ctx.clockDir, offset);
  const report = path.join(ctx.reports, `run-${String(++ctx.runs).padStart(3, "0")}.json`);
  // A report left by an earlier guard in the same directory must not stand in
  // for one this run failed to write.
  await fs.rm(report, { force: true });
  const targets = files ? [...files, ...CANARIES.filter((c) => !files.includes(c))] : [];
  console.log(`\n▶ ${label}: FAKE_NOW=${offset}, ${files ? `${files.length} file(s)` : "the whole suite"}`);
  console.log(`::group::vitest, ${label}`);
  // The run's database is the clone. tests/setup/database-guard.ts points
  // DATABASE_URL at TEST_DATABASE_URL itself, and refuses the two being equal
  // (a pasted production URL looks exactly like that), so DATABASE_URL is left
  // for it to set rather than set here.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FAKE_NOW: offset,
    TZ: "UTC",
    TEST_DATABASE_URL: ctx.db.runApp,
    TEST_DATABASE_URL_OWNER: ctx.db.runOwner,
  };
  delete env.DATABASE_URL;
  delete env.DATABASE_URL_OWNER;
  const started = Date.now();
  const child = spawnSync(
    process.execPath,
    [ctx.vitest, "run", ...targets, "--reporter=default", "--reporter=json", `--outputFile.json=${report}`],
    { cwd: ctx.root, stdio: "inherit", env },
  );
  console.log("::endgroup::");
  const seconds = Math.round((Date.now() - started) / 1000);
  if (!existsSync(report)) throw new Error(`${label}: vitest wrote no report (exit ${child.status}). The log above says why.`);
  const results = readReport(JSON.parse(readFileSync(report, "utf8")), ctx.root);
  const problem = canaryProblem(results);
  if (problem) throw new Error(`${label}: ${problem}`);
  const failed = failedIn(results);
  if (child.status !== 0 && failed.length === 0) {
    throw new Error(`${label}: vitest exited ${child.status} with no test failed, so something broke outside the tests. The log above says what.`);
  }
  const tests = results.reduce((n, r) => n + r.passed + r.failed.length, 0);
  console.log(`  ${results.length} files, ${tests} tests, ${failed.length} failed file(s), ${seconds} s`);
  return { results, failed, seconds, tests };
}

/** Runs `file` alone and says whether `tests` in it failed again. */
async function tryAgain(ctx: Context, file: string, tests: string[], offset: string, label: string) {
  const r = await vitestRun(ctx, [file], offset, label);
  // A run without the file would read as "passed", and a pass on the real
  // clock is half of calling something a bomb.
  if (!r.results.some((x) => x.file === file)) throw new Error(`${label}: ${file} did not run.`);
  return failedAgain(r.results, file, tests);
}

/** A message made safe for a GitHub workflow command, newlines included. */
const escapeData = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

function gh(args: string[]): string {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`gh ${args[0]} ${args[1]} failed: ${result.stderr || result.error}`);
  return result.stdout.trim();
}

/** One issue per file, unless one is already open for it. */
async function openIssues(bombs: Bomb[], ctx: Context): Promise<Outcome["issues"]> {
  const server = process.env.GITHUB_SERVER_URL;
  const runUrl = server ? `${server}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  gh(["label", "create", "date-bomb", "--color", "B60205", "--force", "--description", "A test that will fail on a date. Found by the Date bombs workflow."]);
  const open = JSON.parse(
    gh(["issue", "list", "--label", "date-bomb", "--state", "open", "--limit", "200", "--json", "url,body"]),
  ) as { url: string; body: string }[];
  const issues: Outcome["issues"] = [];
  for (const file of new Set(bombs.map((b) => b.file))) {
    const existing = open.find((i) => i.body.includes(issueMarker(file)));
    if (existing) {
      issues.push({ file, url: existing.url, existing: true });
      continue;
    }
    const mine = bombs.filter((b) => b.file === file);
    const body = path.join(ctx.reports, `issue-${issues.length}.md`);
    await fs.writeFile(body, issueBody(mine, { runUrl, sha: process.env.GITHUB_SHA ?? null, isDb: DB_BACKED_TESTS.includes(file) }));
    const url = gh(["issue", "create", "--title", issueTitle(mine), "--body-file", body, "--label", "date-bomb"]);
    issues.push({ file, url, existing: false });
  }
  return issues;
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  if (process.env.FAKE_NOW) {
    throw new Error("Unset FAKE_NOW: the guard sets it for each run, and its own clock must be the real one.");
  }
  const root = process.cwd();
  const today = new Date().toISOString().slice(0, 10);
  const { dates, unrun } = writtenDates(await readTests(root), today, options.horizonDays);
  const plan = planRuns(dates, options.horizonDays, options.only);

  console.log(`Date bombs, ${today}: ${plan.length} runs, looking ${options.horizonDays} days ahead.`);
  for (const run of plan) {
    console.log(`  ${describeRun(run, today)}${run.files ? `: ${run.files.join(", ")}` : ""}`);
  }
  for (const u of unrun) console.log(`  ${u.date} is written in ${u.file}, which no test file names: not run.`);
  if (options.planOnly) return;

  const outcome: Outcome = {
    today,
    horizonDays: options.horizonDays,
    only: options.only !== null,
    runs: [],
    bombs: [],
    others: [],
    unrun,
    issues: [],
    opensIssues: process.env.DATE_BOMB_OPEN_ISSUES === "1",
    broken: null,
  };
  const reports = process.env.DATE_BOMB_REPORT_DIR || (await fs.mkdtemp(path.join(os.tmpdir(), "date-bombs-")));
  await fs.mkdir(reports, { recursive: true });
  const ctx: Context = {
    root,
    db: databases(),
    clockDir: required("DATE_BOMB_CLOCK_DIR"),
    reports,
    vitest: path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs"),
    runs: 0,
  };

  try {
    // Every failure, by the run it came from, to be tried again below.
    const suspects: { run: Run; result: FileResult }[] = [];
    for (const run of plan) {
      const offset = offsetFor(run, Date.now());
      const label = describeRun(run, today);
      const r = await vitestRun(ctx, run.files, offset, label);
      const failed = r.failed.filter((f) => !CANARIES.includes(f.file));
      outcome.runs.push({ label, offset, files: r.results.length, tests: r.tests, failedFiles: failed.map((f) => f.file), seconds: r.seconds });
      if (failed.length > MOST_FAILED_FILES) {
        throw new Error(`${failed.length} files failed on ${label}. That many is not a date: the log above says what broke.`);
      }
      for (const result of failed) suspects.push({ run, result });
    }

    for (const { run, result } of suspects) {
      const day = dayOf(run, today);
      const { file } = result;
      // The tests to follow. A file that failed outside its tests has none.
      const tests = result.error ? [] : result.failed.map((t) => t.test);
      const again = await tryAgain(ctx, file, tests, offsetFor(run, Date.now()), `${file} again on ${day}`);
      const onRealClock = await tryAgain(ctx, file, tests, "+0", `${file} on the real clock`);
      const v = verdict(again, onRealClock);
      if (v !== "bomb") {
        outcome.others.push({ file, day, verdict: v });
        continue;
      }
      const failures = result.error ? [{ test: "(the file itself)", message: result.error }] : result.failed;
      if (run.kind === "written") {
        outcome.bombs.push({ file, date: run.date, how: "on", failed: failures });
        continue;
      }
      // It passes today and fails `days` ahead: find the first day it fails.
      let passes = 0;
      let fails = run.days;
      while (fails - passes > 1) {
        const mid = Math.floor((passes + fails) / 2);
        const probe = addDays(today, mid);
        const failed = await tryAgain(ctx, file, tests, secondsOffset(noonOf(probe) - Date.now()), `${file} on ${probe}`);
        if (failed) fails = mid;
        else passes = mid;
      }
      outcome.bombs.push({ file, date: addDays(today, fails), how: "from", failed: failures });
    }

    for (const bomb of outcome.bombs) console.log(annotation(bomb));
    if (outcome.bombs.length > 0 && outcome.opensIssues) outcome.issues = await openIssues(outcome.bombs, ctx);
  } catch (err) {
    outcome.broken = (err as Error).message;
    console.log(`::error title=Date bombs guard broke::${escapeData(outcome.broken)}`);
  } finally {
    // Put the database's clock back, for whoever uses this Postgres next.
    await setDatabaseClock(ctx.db, ctx.clockDir, "+0").catch((err) =>
      console.log(`Could not put the database's clock back to +0: ${(err as Error).message}`),
    );
  }

  const summary = summaryMarkdown(outcome);
  await fs.writeFile(path.join(reports, "summary.md"), summary);
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(`\n${summary}\nReports: ${reports}`);
  process.exit(outcome.broken ? 1 : 0);
}

main().catch((err) => {
  console.error(`::error title=Date bombs guard broke::${escapeData((err as Error).message)}`);
  process.exit(1);
});
