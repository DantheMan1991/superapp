# CI and the test loop

> Platform-level (Layer 0) machinery: the GitHub Actions workflow, and how the
> vitest suite is partitioned. Not a sellable module — it is what stops every
> check from running on somebody's laptop and blocking them for twenty minutes.
> Status: live · Scope: `platform`

## Build log

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
| `.github/workflows/ci.yml` | The two jobs and their concurrency rules |
| `vitest.config.ts` | The `pure` / `db` project split |
| `tests/db-backed-files.ts` | Which files are database-backed |
| `tests/db-backed-files.test.ts` | Recomputes that list and fails if it drifted |
| `tests/setup/database-guard.ts` | Aims DB suites at `TEST_DATABASE_URL`, or skips them |
| `scripts/migrate.ts` | `-- --dev` targets `TEST_DATABASE_URL_OWNER`; CI uses it on its own branch |

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

- **Parallelising the `db` project** is where the remaining time is, but it
  needs the tenant stamps to be unique per run rather than per pid, and a review
  of the suites that assert what is *not* visible across tenants — those can be
  broken by another file writing concurrently. Not attempted here.
- The parallel win may be **smaller on a GitHub runner** (2–4 cores) than on the
  founder's machine. Worth re-measuring from a real CI run before quoting 17%
  anywhere that matters.
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
