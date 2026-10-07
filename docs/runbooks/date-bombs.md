# Runbook — a date bomb

> **Read before:** fixing an issue labelled `date-bomb`, running the Date bombs
> guard by hand, or changing it. §1 is what found it; §2 is the fix; §3 runs
> the guard on your machine; §4 is what to do when the guard itself breaks.
> **Update when:** a step turns out to be wrong.

## 1. What found it

A **date bomb** is a test that passes on every run until a particular day,
then fails on every branch at once. On 2026-10-01
`tests/paste-targets-db.test.ts` failed all day everywhere: it pasted a price
"from 2026-10-01" beside one "from today", and that day the two collided
(fixed in #688).

The **Date bombs** workflow (`.github/workflows/date-bombs.yml`) looks for the
next one every day at 05:23 UTC. It runs:

- **every test file on every date it writes** in the next 60 days, with the
  clock at noon UTC on that day: a `"2026-10-01"` string, or a
  `new Date(2026, 9, 1)` or `Date.UTC(2026, 9, 1)` written in literal numbers.
  A collision like 2026-10-01's fails on that day only, so this is the run
  that meets it.
- **the whole suite 60 days ahead**, for a test that breaks from some date on
  and stays broken. That one is then bisected to the first day it fails.

Both clocks move, by the same offset: the tests' (`tests/setup/time-shift.ts`,
read from `FAKE_NOW`) and Postgres's (libfaketime, `docker/postgres-faketime`).
A failure counts as a bomb only if it fails again with the clock moved, and
passes on the real clock. Each bomb gets one issue per test file, labelled
`date-bomb`, and the guard opens no second one while that issue is open. The
run itself stays green. The design and its reasons are in
[ci-and-tests.md](../modules/ci-and-tests.md).

## 2. Fixing one

1. **Read the issue.** It names the file, each failing test, the day it fails
   (*on* a day, or *from* a day on), and the first lines of the failure.
2. **See it fail.** A pure test needs only its own clock moved:

   ```bash
   FAKE_NOW=2031-06-15T12:00:00Z npx vitest run tests/the-file.test.ts
   ```

   (the issue gives the exact line). A db test needs the database's clock moved
   too, which is §3 with `--only tests/the-file.test.ts`. The same command
   against the Neon dev branch moves only the tests' clock:
   `tests/time-shift-db.test.ts` then fails and says so, and any other db
   failure in that run is a lead, not a verdict.
3. **Find the written date, and make it relative to the run.** The shapes seen
   so far:
   - **A "future" date that stops being future.** fitness-ops sent
     `localDay: "2099-01-01"` as a day ahead of any today; it became
     `shiftDay(fresh.localDay, 3)` (#705).
   - **A date beside today that collides on its day.** paste-targets' price
     "from 2026-10-01" became a date 30 days after the run:
     `new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)` (#688).
   - **Code that falls back to the clock when the test gives it no `today` or
     `now`.** Pass one in: the house rule, and nearly every test already does.
4. **Prove it both ways.** The old test fails with the clock where the issue
   says; the new one passes there AND on the real clock. Put the two runs in
   the PR body.
5. **Write it down.** A build-log line in the owning module's dossier, naming
   the issue. Put `Fixes #<issue>` in the PR body so the merge closes it. A
   bomb that is still there after the issue closes gets a new issue on the
   next run.

## 3. Running the guard on your machine

You need Docker (Docker Desktop on Windows) and the repo's `node_modules`.
Everything runs against a throwaway Postgres in a container; the guard refuses
any database that is not on this machine, and opens no issues unless told to.

```bash
mkdir -p /tmp/date-bomb-clock && echo +0 > /tmp/date-bomb-clock/offset
export DATE_BOMB_CLOCK_DIR=/tmp/date-bomb-clock
docker compose -f docker/postgres-faketime/compose.yml up -d --build --wait
```

On Windows, give `DATE_BOMB_CLOCK_DIR` as a path Docker Desktop can mount,
written the Windows way, such as `C:/Users/<you>/date-bomb-clock`, and create
it before `up`: docker makes a missing one itself, as root on Linux, and the
guard then cannot write the clock.

Then the environment CI uses, which is all throwaway values:

```bash
export NEON_LOCAL_PROXY=localhost:5433
export CI_POSTGRES_OWNER_URL=postgres://postgres:ci-owner-not-a-real-secret@localhost:5432/superapp_test
export CI_APP_USER_PASSWORD=ci-app-user-not-a-real-secret
export TEST_DATABASE_URL_OWNER=postgres://postgres:ci-owner-not-a-real-secret@localhost:5432/superapp_test
export TEST_DATABASE_URL=postgres://app_user:ci-app-user-not-a-real-secret@localhost:5432/superapp_test
export APP_ENCRYPTION_KEY=BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=
export SHARE_SECRET=ci-test-share-secret-deterministic-not-real-000
export INTERVIEW_IP_SALT=ci-test-interview-salt
```

Build the database once, with `--dev` so the scripts take the URLs above and
never `.env`'s:

```bash
npm run db:migrate -- --dev
npx tsx scripts/ci-provision-db.ts
npm run db:seed -- --dev
```

Then the guard:

```bash
npx tsx scripts/date-bombs.ts --plan
npx tsx scripts/date-bombs.ts --only tests/the-file.test.ts
npx tsx scripts/date-bombs.ts
```

`--plan` prints the runs and runs nothing. `--only` narrows every run to the
files named, which is the way to reproduce one issue. With no arguments it is
the whole guard, which takes about 35 minutes in CI and longer on a laptop.
Every report lands in a temporary directory it names at the end, with the
summary beside them. When you are done:

```bash
docker compose -f docker/postgres-faketime/compose.yml down -v
```

**If the guard says Postgres's clock is seconds or minutes off at `+0`,** the
Docker VM's clock drifted, which a laptop's sleep does to WSL. Restart Docker
Desktop, or run `wsl --shutdown` and start it again.

## 4. When the guard itself breaks

A red run means the guard did not finish honestly; bombs alone never turn it
red. The summary leads with the reason:

- **"Postgres's clock did not move to …"**: the database is not the
  `docker/postgres-faketime` image, or the clock directory is not mounted at
  `/etc/faketime`. If the container never became healthy at all and logged
  nothing, look for `FAKETIME_DISABLE_SHM=1` in its Dockerfile first; see
  the comment there.
- **A canary failed** (`tests/time-shift.test.ts` or
  `tests/time-shift-db.test.ts`): one of the two clocks did not move with the
  offset. The message says which reads what.
- **"vitest wrote no report" or "exited … with no test failed"**: vitest
  died, or something failed outside the tests. Open the run's log group for
  that run.
- **"N files failed on …"**: more than 15 files failing on one clock is not
  dates. Something broke under the moved clock, or main is broken; read the
  log, and the `Test suite` job on main's newest commit.
- **`gh … failed`**: the run could not list or open issues. The workflow needs
  `issues: write`, and a pull request from a fork never has it.

Fix it, then **Run workflow** on the Date bombs workflow from the Actions tab.
