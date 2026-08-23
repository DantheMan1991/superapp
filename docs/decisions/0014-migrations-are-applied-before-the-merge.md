# 0014 — Migrations are applied by hand, before the merge

- **Date:** 2026-08-23
- **Status:** Accepted
- **Affects:** the deploy pipeline, every migration in `drizzle/`, CI

## Context

`main` auto-deploys to Vercel and **nothing in that path runs a migration**.
`build` is `next build`, `prebuild` only copies the map worker, and
`vercel.json` carries crons and nothing else. Schema therefore reaches the app
database only when somebody runs `npm run db:migrate`, and the code that needs
that schema reaches production the moment a pull request merges. The two have
never been ordered by anything but habit.

On 2026-08-23 the habit failed. [#251](https://github.com/DantheMan1991/superapp/pull/251)
shipped the production pack's carcass stage together with migrations `0184` and
`0185`. The code merged and deployed; the migrations were run against neither
database. `ProductionModule` reads carcasses for **every** run to decide whether
to show the sheet column, so the failure was not confined to the new screen —
`/dashboard/m/production` erred on load for every tenant, for about five hours,
until [#252](https://github.com/DantheMan1991/superapp/pull/252) reverted it.

Nothing in CI was wrong and nothing in CI could have caught it. The suite builds
a database from zero and applies the whole chain, so `0184` and `0185` were
exercised and passed. **A migration that applies perfectly in CI tells you
nothing about whether it applied in production**, and that gap is invisible
precisely because everything is green.

The incident also produced a false diagnosis worth recording, because it cost
the slice a needless revert: the outage was attributed to `app_user` lacking
`SELECT` on the new table, on the theory that `ALTER DEFAULT PRIVILEGES` only
covers tables created by the role that set it. That is true in general and
irrelevant here — `db:create-role` and `db:migrate` both connect as
`DATABASE_URL_OWNER`, the same `neondb_owner`, which is exactly the case where
default privileges *do* apply. Checked against production directly: `pg_default_acl`
holds `app_user=arwd/neondb_owner`, and there is no table in `public` that
`app_user` cannot read. The table was simply never created.

## Decision

**Migrations are applied by a person, to both databases, BEFORE the pull request
that needs them is merged** — `npm run db:migrate -- --dev` first, then
`npm run db:migrate`, then verify in `pg_class` and `pg_policies` that the table
exists with RLS enabled *and* forced and its policies present.

CI does not apply migrations and does not verify that anyone did. Instead a
`migrations` job **refuses any pull request that adds a `drizzle/*.sql` file
unless it carries the `full-tests` label**, and prints the ordering rule in its
failure. The label is the acknowledgement, and it has a second effect that is
the real point: it makes the database suite block the merge rather than report
twelve minutes after it.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Run migrations in `build` | `build` runs on every preview deploy. A branch would migrate production from an unmerged PR, and two concurrent previews would race on the same chain. The blast radius is worse than the problem. |
| A GitHub Actions job that migrates on push to `main` | The right long-term answer, and still open. It needs `DATABASE_URL_OWNER` in Actions secrets and it races Vercel: the deploy starts on the same push, so the job must gate the deploy rather than run beside it. That is a release-pipeline change, not a CI tweak, and it was not worth holding a broken page for. |
| Have CI check production for the applied migration | Requires production credentials in a workflow that runs on pull requests from any branch. Handing the app database's connection string to PR-triggered CI to prevent a schema mistake is a straight trade of a small risk for a large one. |
| Trust the existing `full-tests` guidance | The workflow header has prescribed that label for "anything touching RLS, a migration, or a tenant table" since 2026-08-09. #251 touched all three and carried no label. Advice that is only in a comment is advice nobody is holding. |

## Consequences

**What it buys.** Forgetting the step is now loud. A migration PR cannot merge
green without somebody reading the ordering rule and deciding to label it, and
once labelled the database suite blocks rather than trails the merge — the
window where `main` is deployed and failing closes for the whole class.

**What it costs, honestly.**

- **The guard is a prompt, not a proof.** It verifies a label, not a database.
  Somebody can label a PR and still not run the migration, and CI will pass.
  This narrows the failure to a deliberate act instead of an oversight; it does
  not eliminate it.
- **A manual production step stays in the release path**, which is the thing
  this repo otherwise avoids. It is a stopgap and should be read as one.
- **`full-tests` now means two things** — "run the database suite" and "I have
  applied this migration". Overloading a label is not free, but a second label
  nobody remembers to add would be worse.
- **The label costs about twelve minutes** on every migration PR, deliberately.
  That is the trade [ci-and-tests.md](../modules/ci-and-tests.md) already
  describes, taken on purpose for the case where finding out after the deploy is
  worst.

## Notes

**Revisit when the release pipeline can gate its own deploy.** This ADR should be
superseded by one that moves migrations into a job which runs before Vercel
promotes a build. The decision here is explicitly a holding position.

The wider lesson is the one that made the revert necessary rather than merely
prudent: **a green suite certifies the code, not the deploy.** The suite that
passed on #251 built its database from zero with `app_user` granted afterwards —
an ordering that cannot see a schema-vs-code skew and could not have seen this
one. Reporting it as evidence the change was safe to ship was the actual error,
and it is worth more than the fix.

The re-land ([#253](https://github.com/DantheMan1991/superapp/pull/253)) was
certified the other way round: migrations applied to both databases first, the
table verified in `pg_class`/`pg_policies`, then the isolation suite run against
a dev branch where the table was created by migration **long after** `app_user`
existed — the ordering that would have exposed a missing grant if one had ever
been real.
