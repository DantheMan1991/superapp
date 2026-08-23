# CI and the test loop

> Platform-level (Layer 0) machinery: the GitHub Actions workflow, and how the
> vitest suite is partitioned. Not a sellable module — it is what stops every
> check from running on somebody's laptop and blocking them for twenty minutes.
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
| `.github/workflows/ci.yml` | The three jobs and their concurrency rules. `checks` gates the merge, `migrations` refuses an unlabelled migration PR, `tests` is the database suite |
| `vitest.config.ts` | The `pure` / `db` project split |
| `tests/db-backed-files.ts` | Which files are database-backed |
| `tests/db-backed-files.test.ts` | Recomputes that list and fails if it drifted |
| `tests/setup/database-guard.ts` | Aims DB suites at `TEST_DATABASE_URL`, or skips them. Also refuses a local proxy pointed at a non-localhost host |
| `scripts/migrate.ts` | `-- --dev` targets `TEST_DATABASE_URL_OWNER`; CI uses it to build its own database from zero |
| `scripts/lib/neon-local.ts` | Points the Neon driver at a local Postgres through `wsproxy`. **No-op unless `NEON_LOCAL_PROXY` is set** |
| `scripts/lib/app-role.ts` | The `app_user` grants, shared by the interactive and CI paths so they cannot drift |
| `scripts/ci-provision-db.ts` | Creates `app_user` in the runner and refuses to continue if it can bypass RLS |

## Decisions & gotchas

- **The enumeration is checked, not trusted.** A hand-maintained list of which
  suites need serialising is exactly the thing that rots: somebody adds a
  `d(...)` block to a pure file, it lands in the parallel project, and it races
  the other DB suites. The symptom is a test that fails once a fortnight on a
  machine nobody is watching. `tests/db-backed-files.test.ts` recomputes the list
  from file contents, so drift fails loudly and immediately.
  - It also names the markers it searches for, so written the obvious way it
    matches its own rule. It assembles them from fragments instead.
- **`cancel-in-progress: false` on the tests job, deliberately.** These suites
  create tenants and delete them in `afterAll`. Cancelling a run midway leaves
  the rows behind.
- **The tests job is serialised repo-wide** (`group: db-tests`), because every
  run shares one Neon branch and the suites stamp tenants with `process.pid` —
  two runners can land on the same pid and collide on a slug. The `checks` job
  has no such constraint and cancels superseded runs freely.
- **NEITHER of `database-guard.ts`'s protections can fire in CI, and this is the
  most important thing on this page.**
  - It warns loudly when it disables the database — but only when `DATABASE_URL`
    was already set, which never happens in CI. So the warning is not a usable
    signal there, and the workflow asserts the secrets exist instead.
  - It refuses when `TEST_DATABASE_URL` equals `DATABASE_URL` — but `DATABASE_URL`
    is unset in CI, so a **production** connection string pasted into the secret
    would be accepted, and the suite would create and delete tenants in
    production. **The separate Neon `ci` branch is the only thing preventing
    that.** Do not point CI at `dev` or at production to save a step.
- **A missing secret must fail, not skip.** Without `TEST_DATABASE_URL` every DB
  suite skips and the job goes green over zero coverage — including the
  isolation certification. The workflow fails on absent secrets before running
  anything.
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
- **The suite is not re-run to prove isolation ran.** With the secret present the
  guard points `DATABASE_URL` at it, so the DB suites cannot skip; a second
  `test:isolation` pass would just repeat five minutes of work.
- **CI migrates its own database** (`npm run db:migrate -- --dev` against the
  `ci` branch) before the suite, so the branch cannot drift behind `main` and
  there is no third database for a human to remember.
- **`npm run build` needs no secrets, and that is load-bearing.** Verified by
  building with `.env` and `.env.local` moved aside: only `robots.txt`,
  `sitemap.xml` and `icon.png` are static, every real page is dynamic, so
  nothing reaches the database at build time. If this step ever starts needing a
  secret, something now runs at module scope that should not.

## Open items

- **Parallelising the `db` project is no longer worth doing**, and that is worth
  saying rather than leaving the item open forever. It was the plan while the
  suite took 25 minutes; at 2m52s the sequential `db` project costs about a
  minute in total, so the win is now smaller than the risk of two runs
  interleaving. The analysis is kept below because it is still true, not because
  it is still a priority.

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
- **`package.json` declares no `engines`**, so nothing enforces the Node version
  the lockfile was authored with — CI pins 24 to match development, but that is
  a convention held in one YAML file. Adding `engines` would make it explicit;
  check what Vercel builds with before doing so.
