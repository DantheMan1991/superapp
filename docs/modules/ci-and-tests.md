# CI and the test loop

> Platform-level (Layer 0) machinery: the GitHub Actions workflow, and how the
> vitest suite is partitioned. Not a sellable module — it is what stops every
> check from running on somebody's laptop and blocking them for twenty minutes.
> Status: live · Scope: `platform`

## Build log

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
- **`package.json` declares no `engines`**, so nothing enforces the Node version
  the lockfile was authored with — CI pins 24 to match development, but that is
  a convention held in one YAML file. Adding `engines` would make it explicit;
  check what Vercel builds with before doing so.
