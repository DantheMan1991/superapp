# CI and the test loop

> Platform-level (Layer 0) machinery: the GitHub Actions workflows, how the
> vitest suite is partitioned, and the daily guard that runs it on the dates its
> tests write. Not a sellable module — it is what stops every check from running
> on somebody's laptop and blocking them for twenty minutes.
> Status: live · Scope: `platform`

## Running the database suite with no Neon branch

**You do not need a Neon branch to run the db suite, and an agent session that
concludes otherwise has cost the slice its certification.** Everything CI does in
its `tests` job works outside CI, because the only thing that made it
CI-specific was `NEON_LOCAL_PROXY`, and that is just an address.

1. Start Postgres. A container built from this repo's image already has a
   cluster provisioned and stopped — `pg_lsclusters` shows it, and
   `pg_ctlcluster 16 main start` brings it up. Set a password on `postgres` and
   `createdb superapp_test`.
2. Put a WebSocket proxy in front of it on `:5433`. CI runs
   `ghcr.io/neondatabase/wsproxy`; where there is no docker daemon, the thing it
   does is about forty lines — accept a WebSocket at `/v1`, pipe its binary
   frames to a TCP socket, buffer whatever arrives before the socket is up.
   **The driver must stay Neon's**, which is the whole reason for a proxy rather
   than swapping in `pg`; see the 2026-08-15 entry below.
3. Export exactly what the `tests` job exports — `NEON_LOCAL_PROXY`,
   `CI_POSTGRES_OWNER_URL`, `CI_APP_USER_PASSWORD`, `TEST_DATABASE_URL`,
   `TEST_DATABASE_URL_OWNER`, and the three fake keys. **Do not also set
   `DATABASE_URL_OWNER`**: `migrate.ts` refuses `--dev` when the test database is
   also the app's, which is the guard working correctly and reads like a bug.
4. `npm run db:migrate -- --dev`, `npx tsx scripts/ci-provision-db.ts`,
   `DATABASE_URL="$TEST_DATABASE_URL_OWNER" npm run db:seed`, then `npm test`.

**On Postgres 16 step 4 fails, and it is a version gap rather than a broken
chain.** `migrate()` runs the whole chain in ONE transaction, `0127` adds
`'depreciation'` to `journal_entry_source`, and `0154` backfills using it —
which PG16 refuses as *"new enum values must be committed before they can be
used"*. PG17 relaxed that, which is why CI pins **Postgres 18 to match Neon** and
never sees it. The workaround on an older local cluster is to apply
`drizzle/*.sql` in order with `psql -v ON_ERROR_STOP=1 -f`, which gives each file
its own transaction; the schema it builds is the same one, and it exercises the
migration chain from zero just as CI does.

The whole suite is ~140 seconds this way — a local round trip is sub-millisecond,
and the suite has always been latency-bound rather than CPU-bound.

**What this does NOT unlock is driving the app in a browser.** Chromium and
Playwright are installed, but the dashboard needs a signed-in Clerk session and
a container has no Clerk keys. That is a credentials problem, not an environment
one, and it is why slice dossiers keep carrying "not driven in a browser" as an
open item while every test passes.

## Build log

### 2026-10-07 — A daily guard runs each test on the dates it writes, with the database's clock moved too (branch `claude/elastic-fermi-eed357`)

**The Date bombs workflow** (`.github/workflows/date-bombs.yml`) is #705's
sweep made permanent. The founder's calls, asked before any of it was built
(2026-10-07): the written dates as well as a horizon, every day rather than
weekly, and a GitHub issue per bomb with the run itself staying green.

**A single "60 days ahead" run would not have caught the bomb that started
this.** That was the brief's shape. But `tests/paste-targets-db.test.ts`
wrote "2026-10-01" on 2026-09-09, 22 days before the date, and failed on that
one day only (#688): no run at "today + 60" ever lands on it. So the guard
runs every test file on every date it writes in the next 60 days, at noon UTC
that day: 43 dates in 45 files on 2026-10-07, 19 of them db files. Then the
whole suite 60 days ahead, for a test that breaks from some date on, bisected
to its first day. #705 had run the pure files on their written dates, but the
db files only at 2027-02-15; until this, no db file had run on its own dates.

**Both clocks move, by one string.** `tests/setup/time-shift.ts`, #705's
harness now committed and loaded on every run, does nothing unless `FAKE_NOW`
is set, and reads it the way libfaketime does: `+5184000` or `+60d`. The guard
hands the same string to Postgres through libfaketime
(`docker/postgres-faketime`), so both read real time plus the same offset, to
the second, and the 12 db tests that failed under #705's JS-only shift (a row
stamped by `now()` read against a moved JS clock) have nothing to fail on. A
date still works for a sweep by hand (`FAKE_NOW=2031-06-15T12:00:00Z`) and
moves only the tests' clock; `tests/time-shift-db.test.ts` then fails and says
so.

**Proven on a local copy first** (Docker Desktop, the same compose file):

| What | Result |
| --- | --- |
| `now()` with the offset file at `+60d`, `+3600`, `+0` | 2026-12-06, one hour on, the real time; each within 2 s, no restart |
| A scratch file with three bombs, `--only` it, 60 days | Found all three: **on 2026-11-06** (the JS clock's date beside a written one), **on 2026-11-13** (the database's `now()` beside one), **from 2026-11-20** ("still in the future"), the last bisected past the probes that landed on the other two |
| The same file, only the JS clock moved to 2026-11-13 | The database bomb passed unnoticed, and the db canary failed: "The database reads 2026-10-07 … and the tests read 2026-11-13" |
| `food-week` and `food-week-ops`, written dates for 5 days | 6 runs, clean, both canaries passed in each |
| The whole guard, from the laptop | 2026-10-08 to 10-13 clean, six dates, db files included; stopped at 10-14 (`jobs-ops` takes 168 s through Docker Desktop against 26 s in CI) |
| Three deliberate breaks: retries following the file, a `FAKE_NOW` of "1" read as a date, `+60d` read as seconds | Each failed exactly the unit test written for it |

**The container never started, at first, and logged nothing.** libfaketime
shares a semaphore from the first process to its children, named by its pid,
and exports `FAKETIME_SHARED` to say so. The postgres image's entrypoint runs
as root in pid 1, then `gosu` execs it again as `postgres` in the same pid 1,
which then waits on root's semaphore forever: a futex wait in `env`, before
bash starts. `FAKETIME_DISABLE_SHM=1` turns the sharing off; a relative offset
read from one file needs none of it. The Dockerfile says so where the line is.

### 2026-10-06 — The suite swept for date bombs (branch `claude/test-date-bombs`)

On 2026-10-01 `tests/paste-targets-db.test.ts` failed all day on every
branch: a price pasted "from 2026-10-01" sat beside one from today, and on
that day the two collided (fixed in #688). This sweep looked for the rest,
meaning a test that reads the clock, or calls code that does, beside a date
written into it.

- **By reading.** Every test file with both a clock read and a written date,
  and every call from `tests/` into code that falls back to the clock
  (`now: Date = new Date()`, `todayInTimezone(tz)` with no `now`, the paste
  targets' `today()`, `reverseEntry`'s default date). The house rule, that
  `today` or `now` is passed in, holds nearly everywhere: the fallbacks are
  reached only to stamp a timestamp, or with the date given. Nothing in
  `drizzle/` reads the clock except column defaults.
- **By running.** A setup file that wraps `globalThis.Date` in a Proxy and
  shifts `new Date()`, `Date()` and `Date.now()` by `FAKE_NOW` minus now (the
  clock keeps running), loaded through a copy of `vitest.config.ts`. `pure`
  passed on 12 dates from 2026-10-15 to 2031-06-15, and on each date its files
  write from 2026-10-05 to 2026-11-02 (27 of them), because a same-day
  collision fails only on its day. `db` ran on 2027-02-15 in 26 chunks, since
  one run of all 158 files outlasts the 30 minutes a background command gets
  from a laptop. Of its 2,927 tests, 12 failed, and every one was the shift
  itself rather than a date: a row the database stamps with its own `now()`,
  read against the moved JS clock (rate caps, import windows, `last_7_days`,
  support-session expiry). The database's clock does not move, so a `db`
  failure under this shift is a lead to read, not a verdict.

Found: one, in `tests/fitness-ops.test.ts` ([fitness.md](fitness.md)). The
suspect named in the brief, `tests/engagement-onboarding.test.ts` and its
2026-12-01 start, is not one: `startOnboarding` compares the start with the
`today` the test passes, never with the clock, and the file passes with the
clock at 2026-12-01, 2026-12-04 and 2027-06-01.

### 2026-10-03 — The `db` project is 88–89% of the suite, and `checks` takes ~5 minutes (branch `claude/ci-durations-measured`)

**The two durations the entry below left are now measured.** The Open item on
parallelising the `db` project still reasoned from 2m52s, when the sequential
`db` project cost about a minute, and the `ci.yml` header still gave `checks`
~3 minutes. Both were measured on the seven merges to `main` from #696 to #702:
job and step times from `gh run view <id> --json jobs`, and each vitest project
from the `Test suite` log, `gh run view --job <id> --log`. vitest prints a line
as each file finishes and GitHub stamps every line, so `pure`'s time is the
stamp on its last file, counted from vitest's `RUN` line, and `db`'s is the
rest of vitest's own Duration.

| PR | Run | `checks` | `Test suite` | vitest wall clock | `pure` | `db` | `db` share |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| #696 | 37125468217 | 6m06s | 8m28s | 439s | 53s | 386s | 88% |
| #697 | 37138006916 | 5m41s | 8m37s | 455s | 56s | 399s | 88% |
| #698 | 37163813064 | 3m48s | 7m16s | 373s | 43s | 330s | 89% |
| #699 | 37169784827 | 6m26s | 7m19s | 368s | 42s | 326s | 89% |
| #700 | 37171693792 | 4m08s | 6m23s | 334s | 36s | 298s | 89% |
| #701 | 37172493980 | 3m36s | 8m33s | 451s | 54s | 397s | 88% |
| #702 | 37173229601 | 6m12s | 8m47s | 460s | 55s | 405s | 88% |

**`pure` and `db` never overlap, so all of `db` is on the clock.** vitest
4.1.10's `groupSpecs` puts a project with `fileParallelism: false`, and the
default `isolate` and `sequence.groupOrder`, in a group of its own after the
others, and runs the groups one at a time. The logs agree: in all seven, no
`db` file finished before the last `pure` one. On 2026-08-15 the whole suite
took 117s. Now the `db` project alone takes 298–405s for its 152–156 files.
Their own reported times add up to 215–273s; the other 83–131s is per-file
start-up outside the tests.

**`pure` runs in both jobs.** The suite step's first 36–56s are the files
`checks` runs on the same commit, with the same five skipped: 284 in both jobs
on #700.

**So the Open item is open again.** `Test suite` finished after `checks` in all
seven runs, by 53s to 4m57s (median 2m35s). On a pull request labelled
`full-tests` that gap is time spent waiting on the `db` project alone. That is
no longer the minute the item weighed against the risk of interleaving, so it
now reasons from these numbers, names `--shard` as a way to parallelise with
nothing shared, and keeps the 2026-08-15 analysis paragraph unchanged.

**`checks` is ~5 minutes, and its spread is the runner, not the work.** It took
3m36s to 6m26s, a mean of 5m08s, so the header now says ~5 minutes. #699 to
#702 changed nothing either job runs except comments, yet `checks` took 6m26s,
4m08s, 3m36s and 6m12s, every step slower together (lint 48s on #701 against
83s on #699, the build 79s against 141s), and the same 440 test files took 334s
to 460s.

**Left alone.** The header's ~7 minutes for `tests`, which #702 wrote from the
first five of these runs; with all seven the median is 8m28s. The header's
dated sections and the entries below were true on their dates. One comment in
`ci.yml` changed and no step, trigger or condition, so this runs CI, as any
`ci.yml` change does, and nothing in it behaves differently.

### 2026-10-03 — The two comments the docs fix left alone (branch `claude/ci-comments-postgres-in-runner`)

**The `ci.yml` header and `vitest.config.ts` now say what the job does.** The
entry below changed docs only, so it named both and left them. The header's job
list had `tests` sharing *"ONE Neon branch with every other run"*, serialised
repo-wide and never to be cancelled midway, at ~12 minutes, while the comment
inside the same job said the opposite. The header now agrees with that comment:
Postgres 18 built inside the job's own runner, nothing shared with another run,
so not serialised and safe to cancel, run after a merge or on a PR labelled
`full-tests`. `vitest.config.ts` gave the `db` project's reason for running one
file at a time as *"share one Neon branch"*. It now reads *one database*, as
`docs/conventions.md` §7 and `tests/db-backed-files.ts` already do. Comments
only: no step, trigger or condition changed.

**~7 minutes, not the 2m52s the 2026-08-15 entry measured.** The last five
`Test suite` jobs on `main`, up to #700's, took 6m23s to 8m37s. In #700's run
the suite step alone was 335s of the 6m23s, against 117s of vitest on
2026-08-15, so it is the suite that grew, not the setup. The Open item on
parallelising the `db` project still reasons from 2m52s and was not re-examined
here. Nor was the header's ~3 minutes for `checks`, whose same five runs took
3m48s to 6m26s.

**What still says "one Neon branch" or "serialised repo-wide" says it as
history.** Re-grepped after the edit, wrapped lines included. In `ci.yml`: the
dated 2026-08-09 rationale, with its ~12 minutes, and the comment inside the
job, which says the suite *used to* share one and be serialised. In this
dossier: the 2026-08-08 and 2026-08-15 entries, the entry below and this one,
which quote the old wording, and the Decisions bullet on why the `db-tests`
group once existed. The #78 note in `ci.yml` keeps its repo-wide `db-tests`
slot for the same reason.

### 2026-10-03 — The docs catch up with the database in the runner (branch `claude/ci-docs-postgres-in-runner`)

**Six bullets under Decisions & gotchas still described CI as it ran before
2026-08-15**, seven weeks after that date's entry moved the database into the
runner. They said the `tests` job ran one at a time in `group: db-tests` with
`cancel-in-progress: false`; that the separate Neon `ci` branch was the only
thing stopping a production URL pasted into a secret; that the workflow failed
on absent secrets; that the suite was not re-run *"with the secret present"*;
and that CI migrated the `ci` branch. Each was checked against `ci.yml` and its
`git log` before it was touched: `d1294fba` deleted the group, the "require the
secrets" step and every `secrets.` reference, and wrote both URLs into the
workflow as `localhost` values. The bullets now describe what is there: no
group, and why there once was one; URLs that are not secrets, plus the guard's
`localhost` check; a skip that cannot pass for a run in CI; and a database
built, provisioned and seeded from zero on every run.

**The one new claim was driven before it was written**: that with
`NEON_LOCAL_PROXY` set, a missing `TEST_DATABASE_URL` fails the run instead of
skipping it. `tests/adr-index.test.ts`, which reads only the filesystem, was run
four ways:

| Environment | Result |
| --- | --- |
| Proxy set, `TEST_DATABASE_URL` unset | Guard throws *"points at (none)"*: 1 file failed, no tests, exit 1 |
| Proxy set, URL on `db.example.invalid` | Guard throws, naming the host: exit 1 |
| Proxy set, URL on `localhost` | 6 passed, exit 0 |
| Nothing set | 6 passed, exit 0, and no skip warning, because `DATABASE_URL` is unset |

**The same claims lived in three more files.** `AGENTS.md` said CI ran *"the
whole suite on every push and PR … against a dedicated Neon `ci` branch"*, and
`docs/conventions.md` §7 said *"CI runs all of this on every push and PR"*.
Both lines date from 2026-08-08: a PR has needed `full-tests` to get the
database suite since 2026-08-09, and the suite has run in the runner since
2026-08-15. Both now say what runs where and when. `AGENTS.md` also loses
*"waiting on CI to learn that is the slow way round"*, which assumed CI ran the
suite on every PR. On an unlabelled one it runs only after the merge, when the
code is already live, and that is now the reason given for the label. The `db`
project's reason for running sequentially, *"share one Neon branch"* in §7 and
at the top of `tests/db-backed-files.ts`, now reads *one database*, which is
true locally and in CI alike.

**Left as they are, on purpose.** The header of `ci.yml` still lists the
`tests` job as *"Shares ONE Neon branch with every other run, so it is
serialised repo-wide"*, at ~12 minutes (lines 15–17), which the comment inside
the job contradicts. This change is docs only, so the workflow is not edited.
`vitest.config.ts` carries the same *"one Neon branch"* reason and is code. The
build-log entries below keep wording that was true on their dates. The open
item on the two `TEST_DATABASE_URL*` repository secrets stands:
`gh secret list` still shows both, and no workflow reads a secret.

The 2026-09-17 lesson again: the 2026-08-15 entry recorded the change, and the
bullets further down this page went on describing the system it replaced.

### 2026-10-03 — Lint was not failing; the label was cancelling it (branch `claude/ci-checks-skip-labeled`)

**The founder kept seeing "the ci/lint test failed" on PRs whose lint had
passed.** `gh pr create --label full-tests` fires `opened` and `labeled`
together, and `labeled` has been a trigger since 2026-08-09, added after
labelling #101 re-ran nothing. So two CI runs start on one commit. Both ran
`checks`, whose job-level group (`checks-<workflow>-<ref>`,
`cancel-in-progress: true`) let whichever copy queued second cancel the other.
On #699 the loser, in run 37167938556, was cancelled in the second it was
created. The head commit then carried a CANCELLED "Lint, types, build" beside a
SUCCESS one, its rollup read FAILURE, and `mergeStateStatus` read UNSTABLE.

**It was not three PRs.** 344 of the 450 PRs ever labelled `full-tests` end
with that pair on their head commit, from #109 to #698. #699 reads green now only
because its cancelled run was re-run.

**The fix is one line on `checks`: `if: github.event.action != 'labeled'`.** A
label changes no code, so lint, types, the build and the pure tests have nothing
new to say about it. `migrations` and `tests` still run on `labeled`: the label
is what they read, and the reason `labeled` is a trigger at all. A push has no
`action`, which GitHub coerces to `0` against the string's `NaN`, so the
comparison is unequal and `main` still runs `checks`. Nothing has
`needs: checks`, so skipping it skips nothing else.

**It works only if two things are true, and GitHub's docs state only one of
them.**

- **A skipped job counts as passing.** Stated outright: a job skipped by a
  conditional "will report its status as 'Success'" and does not block a merge
  even as a required check, and the required-checks troubleshooting page lists
  `success`, `skipped` and `neutral` as the successful statuses. This repo
  already showed it: #680, #682 and #683 each carry a SKIPPED "Test suite" under
  a rollup of SUCCESS.
- **A skipped job never joins its concurrency group**, or the skipped copy would
  still cancel the running one. **The docs do not say this.** They describe a
  group acting on a job that is queued or starts, and `if:` as what stops a job
  running, which implies it without stating it. The proof is this repo's own
  history. From 2026-08-09 to 08-15 `tests` carried both an `if:` (a push, or
  the `full-tests` label) and the repo-wide `db-tests` group with
  `cancel-in-progress: false`. Twelve skipped copies were created while another
  run held `db-tests`, and all twelve finished in 0s instead of queueing behind
  it. And on 2026-08-12 a skipped copy (job 93998576586) was created while job
  93995756948 sat pending in that group, and left it there, where a job that
  joined would have replaced it (a group holds one pending job). It was replaced
  22 seconds later, when the same PR's `labeled` run queued a real copy
  (93998631169). That PR is #131, opened at 03:14:13 without the label and
  labelled at 03:14:36: the same opened-then-labelled pair this entry is about.
  Gitea changed its own Actions implementation to evaluate a job's `if:` before
  its concurrency group for the same reason (go-gitea/gitea#39437, merged
  2026-09-26).

**A skipped copy cannot hide a failed one in the rollup.** The rollup counts
every run's check, not the newest of each name, which is exactly why one
CANCELLED copy turned it red. So a lint FAILURE in the `opened` run still shows
beside the `labeled` run's SKIPPED. GitHub's docs do not say whether branch
protection resolves two same-named checks the same way, and it was not tested;
see Open items.

**Left alone, deliberately:** a PR opened with the label still runs the database
suite twice. That job has no group, so neither copy cancels the other. It costs
runner minutes, not a red tick.

**Not yet watched happening.** The first PR opened with the label after this
merges should show one SUCCESS and one SKIPPED "Lint, types, build", a rollup of
SUCCESS, and nothing CANCELLED.

### 2026-09-20 — The ADR index is checked against the ADRs (branch `claude/competent-chebyshev-c7907d`)

`docs/decisions/README.md` had been stale since 2026-09-14: 99 ADRs in the
folder, 58 rows in its index table. PR #636 backfilled the missing forty-one by
hand and left the hole open, because nothing in the repo could have noticed —
`tests/build-docs.test.ts` asserts the viewer renders a `decisions` section, and
a section renders identically whether the index inside it lists 58 decisions or
99.

**`tests/adr-index.test.ts`** recomputes the table from the files. Six checks:
every ADR has a `# NNNN` heading plus the `- **Date:**` / `- **Status:**` lines
the table is built from; every ADR has exactly one row; no row names a number
with no ADR behind it and no number has two rows (`README.md` is `merge=union`,
so two sessions adding the same row both get theirs); every row's link goes to
the file it numbers, with a non-empty Decision cell; every row's date and
standing match the ADR's own header; and the rows stay in ascending order.

Three things it deliberately does not do. **It never asserts a decision's
wording** — the same rule `guides.test.ts` and `build-docs.test.ts` already
keep, because a test that fails when prose is improved teaches people not to
improve prose. **It does not care how a heading is punctuated**: 42 ADRs write
`# 0042. Title` and 57 write `# 0042 — Title`, so only the number is read and
neither convention has to be swept. And it **normalises both columns rather
than demanding the strings be equal** — the date is the first ISO date on the
line, because 0013 carries `2026-08-21, **revised 2026-08-22**`, and the status
is its first word, because 22 ADRs qualify theirs (`Accepted (built 2026-09-05,
Marketing slice 10)`, `Accepted, amended by [0050](…)`) where the column holds
the bare standing.

**It found a drift on its first run.** `0010` had said `Accepted (slice 1 built
2026-08-16)` in the file and `Proposed` in the index since the slice shipped.
The index row is corrected here; the ADR is the record and the table is a
listing of it.

The rule it enforces was nowhere written down — `docs/conventions.md` §11 told
you how to pick the number and why the file is `merge=union`, and stopped. It
now says the index row goes in the same commit as the ADR, as do
`docs/decisions/README.md`'s own Format section and the `docs/decisions/` row of
`AGENTS.md`'s doc table.

Filesystem only, so it lands in the `pure` project with no change to
`tests/db-backed-files.ts` — and it stays there, because it neither reads the
database URL nor imports a `_shared` gate, which is what
`tests/db-backed-files.test.ts` recomputes that list from.

### 2026-09-17 — The scan says "superseded", because that is what it found (branch `claude/youthful-mestorf-bbe0aa`)

The entry below replaced the file scan with a `pg_constraint` guard and wrote
down why. **It left the file scan itself still asserting the thing that was
disproved.** `tests/migrations.test.ts` kept a list called
`APPLIED_AND_WRONG`, headed *"ALREADY APPLIED AND ALREADY WRONG"*, stating that
its three entries installed a constraint whose *"delete they describe fails at
run time"* and that the repair was still owed. A reader of that file — human or
agent — had no way to reach the correct conclusion, and the pointer to the real
guard was in the other file.

**Nothing was broken and nothing needed repairing.** Re-checked here against
`pg_constraint` on the dev branch before editing anything: **17 composite FKs
with `ON DELETE SET NULL`, 0 of them bare**, and `schedule_items_parent_fk`,
`work_items_parent_fk` and `production_order_lines_price_item_fk` each carrying
the column-list form, e.g.

```
FOREIGN KEY (tenant_id, parent_id) REFERENCES work_items(tenant_id, id)
  ON DELETE SET NULL (parent_id)
```

So the list is renamed **`APPLIED_THEN_REPAIRED`** and each entry is a record,
not a defect: `{ offender, constraint, repairedBy }`, naming `drizzle/0192` for
the two nesting FKs and `drizzle/0200` for the production one. The comment says
plainly that the delete works and that the entries can never leave the list by
being fixed, because they already were.

**Why the scan stays.** It reads the migrations as WRITTEN, which is the only
version that exists *before* one is applied — so it is what stops a bare form
from ever reaching a database, while the file can still be edited. That is not
theoretical: it is how `job_estimate_lines_group_fk` was caught in `0375`, three
hours after `0373` installed it correctly, and the fix was deleting two
statements from an unapplied file. The two tests answer different questions, and
each now points at the other: **the scan guards what is about to be applied,
`tests/isolation/constraints.test.ts` certifies what is installed.**

**A grandfathered entry now has to prove it.** The list is a hole in a guard, so
it is no longer taken on trust: a new test requires each entry's `repairedBy` to
exist in `drizzle/`, to come *after* the offender, to re-add that very named
constraint, and to do it in the column-list form. Adding a genuinely broken
migration to the list to silence the scan therefore fails — on that test and on
the closed-at-three assertion both. The assertion message on the scan itself now
says the same thing in the place somebody will read it: *fix the migration now,
while it is still unapplied; do not add it to `APPLIED_THEN_REPAIRED`.*

All five guards were driven backwards before being believed — a repair that does
not exist, a repair dated earlier than its offender, a repair that does not
mention the constraint, a fresh bare composite SET NULL dropped into
`drizzle/0376`, and that same offender appended to the list as camouflage. Each
one fails with the message that names the fix. **No migration, and no schema
change.** `docs/modules/jobs.md` carried the same false claim in #599's build
log and is corrected in place.

**The lesson is about where a claim lives.** The disproof was written down
correctly in one file and in this dossier, and was still false in a third place
that a reader would hit first. A correction is not finished when the reasoning is
recorded; it is finished when every copy of the claim is gone.

### 2026-09-16 — Ask the catalogue, not the migrations (branch `claude/composite-set-null-proof`)

**A SCAN OVER MIGRATION FILES CANNOT SEE A REPAIR, so it reports bugs that were
fixed years of migrations ago.** A file scan flagged three composite foreign
keys carrying a bare `ON DELETE SET NULL` — `schedule_items_parent_fk` (`0096`),
`work_items_parent_fk` (`0104`) and `production_order_lines_price_item_fk`
(`0197`) — as applied and still wrong, and a repair migration was nearly written
for them. **All three had already been repaired**, by `drizzle/0192` and
`drizzle/0200`, whose whole purpose was that fix. Checked against
`pg_constraint` on both databases before anything was written: **17 composite
FKs with `ON DELETE SET NULL`, and 0 of them bare**, dev and prod alike.

The false positive is structural, not a slip. **An applied migration is never
edited** — the repair is a NEW migration that drops and re-adds the constraint —
so the file that first installed it keeps its original wording for good. A text
scan therefore cannot be made quiet by doing the correct thing, and its offender
list can only grow.

**So the guard asks the database what is installed.**
`tests/isolation/constraints.test.ts` reads `pg_constraint.confdelsetcols` for
every composite FK in `public` whose delete action is SET NULL, and fails naming
any that is bare. It lives in the isolation suite because
`npm run test:isolation` must pass before any deploy, so the class is re-proved
every time, and because the defect is the same shape as the ones that suite
already certifies: a constraint that does not do what the schema says.

It also covers **15 constraints that had no definition guard at all**.
`tests/nesting-parent-fk.test.ts` already drove the two nesting FKs and asserted
their definitions; nothing watched the other fifteen, including the `0200` one.

**Why the class needs a standing guard rather than a review habit:** the bare
form comes back on its own. `.onDelete()` takes an action, not a column list, so
the TS declaration and the drizzle-kit snapshot both record a plain `set null`
and any later migration touching one of these tables can re-emit the bare form.
That happened to `job_estimate_lines_group_fk` three hours after `0373`
installed it correctly, and was caught by hand.

**AND IT IS STILL LOADED ON `main` AS THIS IS WRITTEN — `npm run db:generate` on
a clean checkout emits it unprompted**, with no schema change of any kind:

```
ALTER TABLE "job_estimate_lines" DROP CONSTRAINT "job_estimate_lines_group_fk";
ALTER TABLE "job_estimate_lines" ADD CONSTRAINT "job_estimate_lines_group_fk" ... ON DELETE set null ...
```

The cause is snapshot drift, not the column list: `drizzle/meta/0374_snapshot.json`
records this FK as `"onDelete": "no action"` while `jobs-estimates.ts` declares
`.onDelete("set null")`, so drizzle-kit sees a real diff and re-creates the
constraint — in the bare form, the only one it can express. **The next person to
run `db:generate` for an unrelated change gets this bundled into their
migration**, and applying it would break the constraint on production, where it
is currently correct. It is not fixed here: PR #599's `0375` already carries the
snapshot that records `set null`, and a second migration numbered `0375` would
collide with it. Until that merges, read what `db:generate` emits before
committing it.

**No migration in this PR**, because there is nothing to repair. Verified twice
over on the dev branch inside a rolled-back transaction: with the constraint as
installed, deleting a parent work item unparents the child and leaves
`tenant_id` intact; with the constraint swapped to the bare form, the same
delete fails with *"null value in column tenant_id … violates not-null
constraint"*. The hazard is real; it is just not present.

**And the same 30s trap the entry below fixed, two files along.** Adding a file
to the isolation suite lengthened the run and tipped two scenarios in
`tests/isolation/jobs.test.ts` — WARRANTY CLAIMS and BONDS — over the default
timeout, while the file passed **69/69 alone in 175s**. They are the two newest
and largest scenarios there (#594 and #596, both this date), and **that file
declared no explicit timeout on any of its 69 scenarios**, where its sibling
`tests/jobs-ops.test.ts` already declares `120_000` on twenty-six. They now do
too. No assertion moved. The general rule from the entry below holds and is
worth restating, because it has now been learned in two files: **a db-backed
scenario that builds a whole job does not fit in a timeout chosen for pure
tests**, and whether it passes otherwise depends on what else the machine is
doing.

### 2026-09-16 — Four scenarios that were timing the machine, not the code (branch `claude/agitated-sinoussi-5cc252`)

**A test at the default timeout is measuring the machine's spare capacity.**
Four `tests/jobs-ops.test.ts` scenarios — the WIP schedule, its posting, an
estimate typed for the period, and the next application releasing retainage —
failed with *"Test timed out in 30000ms"* on two full-suite runs and passed
every time they were run alone. The schedule read 29.0s by itself. Nothing was
wrong with them: `testTimeout: 30_000` is a global, and a scenario that builds a
company, a job, a contract, a schedule and a posted period spends all of it on
round trips to Neon, so whether it passes depends on what else holds the
machine at that moment.

**The fix is the one twenty scenarios in the same file already use**: an
explicit `}, 120_000)` on the `it`. That is the file's only timeout value, and
four times the solo cost of the slowest of these. No assertion moved.

The general point for anything added here: **the 30s default is not a budget
these suites fit inside.** It was chosen for pure tests. A db-backed scenario
that sets up a whole job is tens of seconds of latency on a good day, and the
honest thing is to declare what it costs rather than let a green run depend on
an idle laptop.

### 2026-08-23 — A third job, for the thing CI cannot check (branch `claude/the-migration-that-never-ran`)

**THE PIPELINE WAS GREEN AND THE PAGE WAS DOWN, and both were correct.** #251
merged the production pack's carcass stage with migrations `0184`/`0185`.
Everything here passed — lint, types, build, the whole database suite from zero,
which applied those two migrations and exercised them. Then `main` auto-deployed
the code, nothing applied the migrations to the app database, and
`/dashboard/m/production` erred on every load for five hours.

**Nothing this workflow runs can see that.** The suite builds its own database
and applies the whole chain, so a migration is always applied by the time the
tests read it. *A migration passing in CI says nothing about whether it reached
production* — and the gap is invisible precisely because the ticks are green.

The new `migrations` job does the only thing a pull-request workflow honestly
can: it fails a PR that **adds** a `drizzle/*.sql` unless the PR carries
`full-tests`, and prints the ordering rule (`db:migrate -- --dev`, then
`db:migrate`, then verify `pg_class`/`pg_policies`) in the failure. The label is
the acknowledgement, and it has the effect that matters — the database suite
blocks the merge instead of reporting twelve minutes after it.

Three details that are deliberate:

- **`--diff-filter=A` only.** Editing an already-applied migration is a
  different and worse problem; this job is about a NEW file that has to reach two
  databases by hand.
- **`fetch-depth: 0`**, because the base branch has to be present to diff
  against, and the default shallow checkout has no `origin/main` to compare with.
- **`if: github.event_name == 'pull_request'`.** On a push to `main` the merge
  has already happened and the deploy is already going out. Failing there paints
  `main` red and prevents nothing.

**The guard checks a label, not a database.** Somebody can label a PR and still
skip the migration. It converts an oversight into a deliberate act, which is a
real narrowing and not a fix — the fix is a release job that applies migrations
before Vercel promotes a build, and that is still open. The reasoning, including
why migrating inside `build` is worse than the problem, is
[ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md).

The `full-tests` label now carries two meanings — "run the database suite" and
"I have applied this migration". That overloading is on purpose; a second label
nobody remembers to add would be worse.

### 2026-08-15 — The database moves into the runner (branch `claude/ci-postgres-in-runner`)

The real fix, after the round-trip trim bought 30% off a number that can double
overnight. The suite no longer talks to Neon at all: every run builds its own
**Postgres 18 inside its own runner**, so a round trip is sub-millisecond and
the runtime is a property of the code again rather than of the network.

**Measured on a real runner:**

| | Neon branch | Postgres in the runner |
| --- | ---: | ---: |
| Whole job | **25m 53s** | **2m 52s** |
| vitest wall clock | 1519.4s | **117.0s** |
| Time inside tests | 1465.9s | **64.5s** |
| Files | 135 passed, 5 skipped | 135 passed, 5 skipped |

**22.7× on test time**, and the file counts are identical — checked
deliberately, because a fast green is the exact shape of a suite that skipped.

The single most telling number is not in that table: **building the whole schema
from zero took 3 seconds** here against 117 seconds when the same 136 migrations
were applied to Neon. Same work, same SQL, ~39× apart. It was all network.

**Three problems, one change.**

1. **Latency.** 1465 of 1519 seconds were spent waiting. Gone.
2. **The repo-wide queue.** `concurrency: db-tests` existed because every run
   shared one Neon branch, so three PRs queued for thirty-six minutes. **It is
   deleted.** Two runs cannot see each other when each builds its own database,
   and a cancelled run leaves nothing behind to clean up.
3. **Drift.** The `ci` branch was migrated forward run after run and could
   diverge from what a fresh database produces. Building from empty every time
   means **the migration chain itself is exercised on every run** — the thing
   that would otherwise be discovered during a production migration.

**The driver stays the one production uses.** The app talks to Neon over a
WebSocket, so swapping in `pg` would certify a driver that ships nowhere, and
transaction handling and pooling are exactly what the isolation suite leans on.
`ghcr.io/neondatabase/wsproxy` speaks that protocol and forwards to plain
Postgres, so no application code changes. `scripts/lib/neon-local.ts` points the
driver at it and is **a no-op unless `NEON_LOCAL_PROXY` is set** — no ordinary
run enters that path.

**Postgres 18, because Neon reports 18.4.** A suite whose whole job is to
certify what the DATABASE enforces has no business running on a different major
version.

**The part that is load-bearing rather than ceremonial:** `app_user` is created
in SQL and the run refuses to continue if it can bypass RLS or is a superuser.
The container's superuser bypasses RLS, and so would any role a provider's API
minted — Neon's carry `neon_superuser`, the trap recorded in this repo since the
per-run-branch research. An isolation suite running as a bypassing role is a
green tick over nothing, which is worse than no suite. The grants live in
`scripts/lib/app-role.ts` and are shared with `create-app-role.ts` so the two
paths cannot drift.

**Verified before writing any of it:** the full 136-migration chain applies to
an empty database cleanly — 110 tables, 239 policies, 8 `app_*` functions.

Secrets removed rather than replaced: `TEST_DATABASE_URL` and
`TEST_DATABASE_URL_OWNER` are no longer used by CI, and the step that existed to
check they were present is gone with them. The database is now built by the job,
so it cannot be missing — a misconfiguration fails at `db:migrate`, loudly,
before a single test runs.

### 2026-08-15 — The suite was never CPU-bound; it was waiting (branch `claude/withtenant-one-roundtrip`)

The founder again: *"every CI test is taking like 20 minutes… they never seem to
find anything anyways."* Both halves were worth measuring rather than answering.

**The suite is not slow. It is waiting.** 663 of 717 seconds is the `db` project,
64 files strictly one at a time, and almost none of that is computation — it is
round trips to Neon. The proof is a comparison nobody had run: the SAME suite
took **717s on one run and 1519s on the next**, hours apart, with every single
file scaling by roughly the same 2.2×. Nothing merged in between explains that.
When per-round-trip latency doubles, a latency-bound suite doubles.

**So the fix is to make fewer round trips, and the hottest one was free.**
`withTenant` set its four RLS context variables with four separate
`set_config` statements — four round trips before the caller's own query, six
with `BEGIN` and `COMMIT`. They are now one statement.

Measured properly, because latency drift is exactly the confounder: an
interleaved A/B/A/B over a fixed four-file subset.

| | Run 1 | Run 2 | Run 3 |
| --- | ---: | ---: | ---: |
| Four statements | 145.3s | 144.5s | 146.1s |
| **One statement** | **102.8s** | **101.8s** | **101.8s** |

**30% off, under 1% variance, 107/107 passing every time.** The same saving
applies to every production request that touches a tenant table, which is the
part that matters more than CI.

`tests/isolation/core.test.ts` gained two tests: that all four settings actually
land, and that the two opt-in ones still default DOWNWARD. A silent failure
there would hide every owners-only folder and every mailbox without looking like
an error.

**On "they never find anything".** Mostly fair, and worth stating plainly rather
than defending. The isolation half is insurance against a rare and catastrophic
failure, and it should not be judged on its bug count. The ops half has earned
its place once — `tests/assets-ops.test.ts` caught `descendantIds` binding a JS
array into a raw `sql` fragment, in shipped code, where the containment cycle
guard had never once run. Meanwhile both bugs found on 2026-08-15 came from
driving the app, not from the suite.

**Still open, and bigger than this:** the suite is latency-bound by design, so it
remains hostage to whatever Neon's round trip costs that day. Sequential
execution and a Postgres service container inside the runner are both recorded
under Open items.

### 2026-08-09 — The database suite runs AFTER the merge, not before (branch `claude/ci-fast-gate`)

The founder was waiting about fifteen minutes per merge, on every slice of a
ten-slice module, and called it: *"these CI tests really bog down the process…
I feel like this should be done less frequently."* He is right, and the numbers
back him.

- **`checks` now also runs the PURE project** — 43 files, 1016 tests, **20
  seconds**. Added with `--project pure` rather than letting
  `database-guard.ts` skip the DB files: a suite that skips reports zero
  failures, which is the exact shape of a green tick over no coverage.
- **`tests` is gated on `if: github.event_name == 'push' || <label>`.** It runs
  on the push to `main` after a merge, and on any PR labelled `full-tests`.
- **`if:` rather than a trigger-level filter, deliberately.** A job skipped by
  `if:` still reports a status; a `paths-ignore` skip reports nothing and would
  wedge a required check forever. The workflow's own note already prescribed
  this shape if the expensive job ever needed gating.

**What this costs, stated plainly: `main` auto-deploys, so a failure is now
found within ~12 minutes of merging rather than before it, and the bad commit
is live for that window.** Revert-and-fix rather than catch-before-merge. Use
the `full-tests` label for RLS, migrations, and anything touching a tenant
table — the cases where finding out after the deploy is worst.

**Three things made it the right trade:**

1. The 12 minutes is almost entirely the sequential `db` project. The pure files
   were never the cost.
2. **CI was duplicating the local gate.** AGENTS.md already requires
   `npm run test:isolation` locally whenever RLS or a tenant table is touched —
   6.5 minutes — and CI then re-ran the same files. Every green CI run during
   the scheduling slices was green because it had already passed locally.
3. **Blocking bought less than it looked.** Every failure that actually reached
   production during those slices did so through a fully green pipeline. The
   `use server` export that broke module toggling passed lint, `tsc`, the whole
   suite AND the build, because it only fails when a request evaluates the
   action graph.

Not a reason, but worth recording: the alternative considered and deferred was
a per-run Neon branch, which would let the DB suite run in parallel instead of
queueing repo-wide. That removes the queue without giving up
catch-before-merge, and there is a trap in it — Neon-managed roles carry
`BYPASSRLS`, so wiring `TEST_DATABASE_URL` to one would make the isolation
suite certify nothing.

### 2026-08-08 — Documentation-only changes skip CI (branch `claude/ci-skip-docs`)

PR #78 was two markdown files, and it spent twenty minutes running the database
suite while holding the repo-wide `db-tests` slot — so the next real push would
have queued behind a docs edit. Since AGENTS.md requires a dossier update on
nearly every PR, that was about to become the normal case rather than a one-off.

- `paths-ignore` on both triggers, covering `docs/**` and the four top-level
  docs (`AGENTS.md`, `CLAUDE.md`, `README.md`, `SETUP.md`)
- **Checked before trusting it: no test reads the docs tree.** The one suite
  that walks the filesystem — `documents-dms/upload.test.ts`, hunting for a
  forbidden `@vercel/blob/client` import — inspects `.ts`/`.tsx` only, and
  `build-docs.ts` reads `docs/` at request time, not at build or test time
- **`.github/workflows/**` is deliberately NOT ignored.** A change to CI must
  run CI
- **A blanket `**.md` was deliberately not used.** `public/marketing/README.md`
  and a font `NOTICE.md` under `src/` still trigger a run. For a filter whose
  failure mode is "the tests you needed did not run", erring toward running is
  the right bias
- `paths-ignore` skips only when EVERY changed file matches, so the common case
  — code plus its dossier — is unaffected
- The two lists are duplicated rather than shared via a YAML anchor: GitHub's
  workflow parser has never reliably supported anchors, and the failure mode is
  CI silently not running

### 2026-08-08 — CI exists, and the suite stops queueing behind itself (branch `claude/test-speed`)

Two changes, from one observation: the full suite took **24 minutes**, ran only
on the founder's machine, and blocked whoever started it.

- **`.github/workflows/ci.yml`.** There was no CI at all before this — nothing
  ran tests on push, so every verification was a human waiting. Two jobs:
  `checks` (lint, `tsc`, `npm run build`) and `tests` (the vitest suite)
- **`vitest.config.ts` is now two projects.** `fileParallelism: false` was set
  globally for a real reason — DB suites share one Neon branch — but only 43 of
  89 files touch the database. The other 46 were queueing for a rule that never
  applied to them. `pure` now runs in parallel, `db` keeps the old behaviour
- **Measured on the same branch and machine: 1440s → 1197s, about 17%.** Less
  than hoped, and the reason is worth writing down: the 43 sequential DB files
  dominate, and they are slow because every `withTenant` is a network round trip
  to Neon. Parallelising the 46 pure files removes their serial time and no more
- **The real win is CI, not the 17%.** 20 minutes off the critical path beats 4
  minutes off the clock
- **The first CI run failed on `npm ci`, and it was right to.** Node 22's npm
  refused the lockfile — *"Missing: esbuild@0.28.2 from lock file"* — while the
  same `npm ci` had passed locally every time. The lock is NOT stale: running
  `npm install` locally leaves it byte-identical. The two npm versions simply
  resolve it differently (`tsx` wants `esbuild ~0.28.0`, vitest's `vite` wants
  `^0.27.0 || ^0.28.0`, and the lock pins 0.28.1). Fixed by pinning CI to Node
  24, the version the lockfile was authored with. Worth knowing that "works
  locally" and "works on a clean install" were never the same claim here

## Data model

None. No tables, no migrations.

## Key files & seams

| File | What it does |
| --- | --- |
| `.github/workflows/ci.yml` | The three jobs and their concurrency rules. `checks` gates the merge and sits out a `labeled` run, `migrations` refuses an unlabelled migration PR, `tests` is the database suite |
| `vitest.config.ts` | The `pure` / `db` project split |
| `tests/db-backed-files.ts` | Which files are database-backed |
| `tests/db-backed-files.test.ts` | Recomputes that list and fails if it drifted |
| `tests/setup/database-guard.ts` | Aims DB suites at `TEST_DATABASE_URL`, or skips them. Also refuses a local proxy pointed at a non-localhost host |
| `tests/migrations.test.ts` | Rules scanned from the migration FILES, so they can stop a bad constraint **before** it is applied. Holds `APPLIED_THEN_REPAIRED` — files whose original text is bare and which a later migration repaired — and proves each named repair really exists |
| `tests/isolation/constraints.test.ts` | The same class asked of `pg_constraint`: what is actually INSTALLED. Authoritative, because a text scan cannot see a repair |
| `scripts/migrate.ts` | `-- --dev` targets `TEST_DATABASE_URL_OWNER`; CI uses it to build its own database from zero |
| `scripts/lib/neon-local.ts` | Points the Neon driver at a local Postgres through `wsproxy`. **No-op unless `NEON_LOCAL_PROXY` is set** |
| `scripts/lib/app-role.ts` | The `app_user` grants, shared by the interactive and CI paths so they cannot drift |
| `scripts/ci-provision-db.ts` | Creates `app_user` in the runner and refuses to continue if it can bypass RLS |
| `.github/workflows/date-bombs.yml` | The Date bombs guard: daily at 05:23 UTC, on a pull request that changes the guard, and by hand. Starts the libfaketime Postgres, builds and seeds it, runs `scripts/date-bombs.ts` |
| `scripts/date-bombs.ts` | Runs the guard: per run a fresh clone of the seeded database and both clocks moved, then the retries, the bisection, the issues and the summary. `--plan` and `--only` for running it by hand |
| `scripts/lib/date-bombs.ts` | The guard's reasoning, tested in `tests/date-bombs.test.ts`: the written dates, the runs, a vitest report read, what counts as a bomb, the issue and the summary |
| `docker/postgres-faketime/` | Postgres 18 with libfaketime reading its offset from a mounted file, and the compose file that starts it beside Neon's proxy, in CI and on a laptop |
| `tests/setup/time-shift.ts` | Moves the tests' clock when `FAKE_NOW` is set, and does nothing otherwise |
| `tests/time-shift.test.ts`, `tests/time-shift-db.test.ts` | The moved `Date`, and the two canaries every guard run must pass in full: this run's clock reads `FAKE_NOW`, and the database's clock agrees with it |
| `docs/runbooks/date-bombs.md` | Fixing a `date-bomb` issue, and running the guard on a laptop |

## Decisions & gotchas

- **The enumeration is checked, not trusted.** A hand-maintained list of which
  suites need serialising is exactly the thing that rots: somebody adds a
  `d(...)` block to a pure file, it lands in the parallel project, and it races
  the other DB suites. The symptom is a test that fails once a fortnight on a
  machine nobody is watching. `tests/db-backed-files.test.ts` recomputes the list
  from file contents, so drift fails loudly and immediately.
  - It also names the markers it searches for, so written the obvious way it
    matches its own rule. It assembles them from fragments instead.
- **The tests job has no concurrency group, on purpose.** Every run builds its
  own Postgres inside its own runner, so two runs cannot see each other and a
  cancelled run takes its database with it. The repo-wide `db-tests` group and
  its `cancel-in-progress: false` existed only because every run shared one
  Neon branch: two runners could land on the same `process.pid` and collide on
  a tenant slug, and a run killed midway left its tenants behind. Both went on
  2026-08-15. The `checks` job cancels superseded runs freely.
- **What keeps CI off production is that its database URLs are not secrets.**
  `TEST_DATABASE_URL` and `TEST_DATABASE_URL_OWNER` are fixed `localhost` URLs
  written into the workflow, aimed at the Postgres the job builds in its own
  runner. There is no secret for a production connection string to be pasted
  into, and changing them means editing `ci.yml`.
  - `database-guard.ts` adds one check that can fire there: while
    `NEON_LOCAL_PROXY` is set, as it is for the whole `tests` job, it throws on
    a `TEST_DATABASE_URL` whose host does not start with `localhost` or
    `127.0.0.1`. It reads that URL only. The owner URL is used by
    `db:migrate -- --dev`, an earlier step that never loads the guard.
  - Its two older protections still cannot fire in CI. The skip warning and the
    refusal when `TEST_DATABASE_URL` equals `DATABASE_URL` both need
    `DATABASE_URL` set, and the suite step never sets it. Do not read their
    silence as a check, and do not point CI at `dev` or at production to save a
    step.
- **A skipped suite must never pass for a run, and in CI it now cannot.**
  Without `TEST_DATABASE_URL` every DB suite skips and reports zero failures,
  the isolation certification included. CI used to stop that with a step that
  failed on absent secrets, and the step went with the secrets on 2026-08-15.
  Now the job builds its own database first, so a broken owner URL fails at
  `db:migrate` before a test runs. And while `NEON_LOCAL_PROXY` is set the guard
  throws on a missing `TEST_DATABASE_URL` rather than skipping, because an
  absent URL has no `localhost` host. Driven on 2026-10-03 with the URL unset:
  one failed file, no tests run, exit 1.
- **The suite needs three non-database values, and they are NOT repo secrets:**
  `APP_ENCRYPTION_KEY` (32 bytes of base64), `SHARE_SECRET` (32+ chars) and
  `INTERVIEW_IP_SALT` (any non-empty string). Every suite using them creates a
  value and verifies it within the same run, so any input of the right shape
  works. They are written into the workflow as fixed test values — putting the
  production keys in CI would add risk and something to rotate, for nothing.
  Found the honest way: the second CI run failed on `SHARE_SECRET`, and rather
  than guess at the next one, the whole suite was re-run locally with `.env`
  moved aside and only a CI-shaped environment. Those three were the complete
  set.
- **The suite is not re-run to prove isolation ran.** `TEST_DATABASE_URL` is
  written into the workflow, so the guard always points `DATABASE_URL` at it and
  the DB suites cannot skip; a second `test:isolation` pass would only repeat
  files `npm test` has already run.
- **CI builds its own database from zero before the suite:**
  `npm run db:migrate -- --dev` against the Postgres in the runner (`--dev`
  targets `TEST_DATABASE_URL_OWNER`), then `scripts/ci-provision-db.ts` for
  `app_user`, then `npm run db:seed`. Every run applies the whole migration
  chain to an empty database, so nothing can drift, and there is no third
  database for a human to remember.
- **`npm run build` needs no secrets, and that is load-bearing.** Verified by
  building with `.env` and `.env.local` moved aside: only `robots.txt`,
  `sitemap.xml` and `icon.png` are static, every real page is dynamic, so
  nothing reaches the database at build time. If this step ever starts needing a
  secret, something now runs at module scope that should not.
- **Date bombs are hunted on the dates the tests write, and at a horizon.** A
  test that collides with today on one written day fails on that day only, so
  only a run on that day meets it; paste-targets' was written 22 days ahead,
  and no run "60 days ahead" would ever have seen it. A test that breaks from
  some date on is met by any run past it, so one whole-suite run at +60 days
  covers that kind, and bisection finds its first day. The clock sits at noon
  UTC on a written day: the same date from UTC-11 to UTC+11.
- **Both clocks move, by one RELATIVE offset string.** `FAKE_NOW=+5184000` for
  the tests and the same `+5184000` in libfaketime's offset file for Postgres:
  real time plus the same seconds, so the two agree to the second however long
  a run takes. Two absolute dates would not: each would be set at a different
  moment, minutes apart by the end of a run, and the livestock advisor's cap
  counts questions in the last minute. Moving only the JS clock is what failed
  12 db tests in #705's sweep.
- **`FAKETIME_DISABLE_SHM=1` is load-bearing.** Without it the Postgres
  container never starts and logs nothing: libfaketime's shared semaphore is
  named by pid, and the entrypoint's `gosu` re-exec as `postgres` in pid 1
  waits on the one root made there. The Dockerfile's comment has the details.
- **Every guard run gets a fresh database**, `create database date_bomb_run
  template superapp_test`, cloned from the migrated and seeded one. Runs on
  different days must not read each other's rows, and the retries below must
  start from what the first try started from. A clone keeps everything inside
  the database; it loses only `ALTER DATABASE … SET`, and nothing in the
  migration chain or the scripts uses one (checked 2026-10-07).
- **A failure is a bomb only if it fails again on the same clock and passes on
  the real clock**, each try on its own fresh clone. Anything else is listed in
  the summary as what it was: failing on the real clock too, or flaky. The
  retries and the bisection follow the tests that failed, not the file, so a
  file holding two bombs does not have one stop the search for the other.
- **Bombs are reported, never red.** One issue per test file, labelled
  `date-bomb`, marked with an HTML comment naming the file so a second is never
  opened while the first is open; a warning on the file; a table in the run's
  summary. The run goes red only when the guard itself broke (a clock did not
  move, a canary failed, vitest died, `gh` failed), because a scheduled run's
  checks land on main's newest commit, and red there reads as "main is broken"
  when main is fine today. The founder's call, 2026-10-07.
- **Two canaries, in every run, passed in full.** `tests/time-shift.test.ts`
  proves this run's JS clock reads `FAKE_NOW`, against `performance`'s
  untouched clock, and `tests/time-shift-db.test.ts` proves the database's
  agrees with it. A canary skipped or missing is a broken run, not a clean one.
  The db canary also runs in the ordinary suite, where it asserts the two
  clocks agree to within 30 seconds, which every rate-cap test already assumes.
- **Daily at 05:23 UTC**, the founder's call: tests here often write dates
  only days ahead, and a weekly run can miss a fuse under a week. Also on a pull
  request that changes the guard's own files, and by hand.
- **On Windows the offset file sometimes cannot be replaced while Docker
  Desktop reads it** (EPERM on rename). The guard retries, then writes in place;
  Linux never refuses.

## Open items

- **Parallelising the `db` project is open again** (2026-10-03). It was closed
  on the reasoning that at 2m52s the sequential `db` project cost about a minute
  in total, a win smaller than the risk of two runs interleaving. On the seven
  merges to `main` from #696 to #702 it took 298–405s, 88–89% of the suite,
  against 36–56s for `pure`, and the two never overlap: vitest runs `pure` to
  the end before the first `db` file starts. So it is most of how long a broken
  `main` goes unnoticed after a merge. And `Test suite` finished after `checks`
  in all seven, by 53s to 4m57s (median 2m35s): on a pull request labelled
  `full-tests` that is time spent waiting on the `db` project alone, and the
  most a faster one could save there, since `checks` is the floor. That is no
  longer small. The risk side has moved too: every `tests` job builds its own
  Postgres, so splitting the `db` files across several jobs with vitest's
  `--shard` would leave nothing to interleave, for 45–67s of setup per extra
  job. No attempt is recorded. Judge one over several runs, because the same
  440 files took 334s to 460s across #699 to #702. The numbers are in the
  2026-10-03 build-log entry, and the analysis below, about running files in
  parallel against one database, still holds.

  The 2026-08-15 review found the stated blockers weaker than recorded: every
  `withSystem` call in the suite is a scoped INSERT of the file's own fixtures —
  there is not one unscoped read anywhere — 60 of 64 files stamp their tenants
  per pid, each with its own prefix, and vitest's default `forks` pool gives
  concurrently-running files distinct pids. But an attempt at
  `--fileParallelism --maxWorkers=4` was **abandoned without a result**: it ran
  longer than a sequential pass before being killed. Contention on the shared
  Neon branch was the likeliest explanation and is now moot. If anyone revisits
  this, get a completed run first — the reasoning alone was never enough.
- ~~The suite is latency-bound by design~~ — **done 2026-08-15.** Postgres 18
  and `wsproxy` now run inside the runner; see the build log. The `db-tests`
  concurrency group went with it.
- **Nothing runs against a real Neon branch any more**, and that is a genuine
  trade rather than a pure win. A managed Postgres and a container are not
  bit-identical — connection limits, autovacuum settings and extension
  availability all differ — so a failure mode that only appears on Neon would no
  longer be caught here. The major version is pinned to match, which covers the
  part that matters for RLS. If something Neon-specific ever bites in
  production, this is the first place to look.
- **`TEST_DATABASE_URL` / `TEST_DATABASE_URL_OWNER` are still repository
  secrets** and are no longer read by CI. They remain the local mechanism (and
  `database-guard.ts` still requires them), but the CI copies can be deleted
  whenever somebody is in the settings page.
- **`paths-ignore` and branch protection do not mix.** A run skipped by
  `paths-ignore` reports no status at all, so a REQUIRED check stays permanently
  "expected" and a docs-only PR could never merge. There is no branch protection
  on this repo today, which is the only reason the current filter is safe. If
  required checks are ever added, replace it with a filter job that computes the
  changed paths and gates the expensive job with `if:`, so a status is always
  reported. The warning is repeated at the top of the workflow.
  **Check a second thing before requiring "Lint, types, build".** A PR opened
  with a label carries two checks of that name on one commit, and the `labeled`
  run's is SKIPPED (2026-10-03). The rollup counts both, so a failure still
  shows. Nobody has checked whether a required check does the same, or whether
  a SKIPPED copy could satisfy it over a FAILED one.
- **`package.json` declares no `engines`**, so nothing enforces the Node version
  the lockfile was authored with — CI pins 24 to match development, but that is
  a convention held in one YAML file. Adding `engines` would make it explicit;
  check what Vercel builds with before doing so.
- **What the Date bombs guard cannot see** (2026-10-07):
  - **Dates written in `src/`.** Only `tests/` is read for dates, so a rule
    with a date in it (a tax year, an offer's end) meets only the horizon run,
    and one that misbehaves on a single day would pass it.
  - **Other hours.** A written day runs at noon UTC only. A test whose answer
    depends on a far zone's local date could pass at noon UTC and fail near
    midnight.
  - **A fuse shorter than a day.** A test merged after 05:23 UTC that collides
    with tomorrow goes off before the next run. Catching that needs the guard
    on the pull request that adds the date: the changed test files only, on
    the dates they write. Not built; it would put a job on more pull requests.
  - **Clock readings below JavaScript**: `Intl.DateTimeFormat().format()` with
    no date and `Temporal.Now` keep the real time, as do `performance` and
    timers. The seed also runs on the real clock, before the first offset.
- **Not yet watched happening:** a scheduled run (the first is 05:23 UTC on
  2026-10-08), and an issue for a real bomb.
