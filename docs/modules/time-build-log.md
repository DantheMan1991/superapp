# Time — build log archive

> The earlier build-log entries for the Time module, swept out of
> `docs/modules/time.md` on 2026-09-12 so the dossier stays readable — it is
> read at the START of every session that touches this area, and its length is a
> tax on every future change. `src/lib/build-docs.ts` walks the whole tree, so
> this renders at `/admin/docs` with no code change.
>
> **Slices 0–3 and the design-system sweep live here. Slice 4 onward is still in
> the dossier.** Nothing has been edited; the entries are exactly as they were
> written. Read the dossier's Decisions & gotchas first — everything from these
> entries that still binds a future change was lifted into it at the time.
> Status: `archive` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

### 2026-09-12 — Slice 3: submit, approve, lock (`claude/time-3-submit-approve-lock`)

`time_periods` (the lock), `time_sheets` (worker × period), the amendment, and
Time's first attention source. Migrations `0309`/`0310`.

- **A row in `time_periods` IS the lock.** Slice 2 argued a period was not worth
  storing until it could be locked; this is that. Created on the first lock and
  then kept, with `locked_at` nulled on unlock — the row stays as the record
  that these dates have been through a pay run. Who unlocked it is `audit_log`'s
  business, not a pair of columns nothing would read.
- **A row in `time_sheets` IS the submission**, and `approved_at is null` is
  "waiting for somebody" — exactly the question the attention source asks, with
  no status column needed. The arrangement `work_items.closed_at` already lives
  by.
- **The totals are a snapshot taken at approval**, computed by `totalsFor` — the
  same function the pay period screen renders from. A snapshot that disagreed
  with the figure the approver was looking at would be the worst kind of bug:
  silent, and only visible in a pay run. `ruleset_slug` rides with it, because
  the same hours under different rules are different money.
- **Submitting is `staff`, approving and locking are `owner`**
  (`roleMayApprove`). That split is the entire point of having two steps:
  somebody who can approve their own hours has an approval that certifies
  nothing.
- **A locked period is immutable, and `assertPeriodOpen` is the guard** — named
  after accounting's, which does the same job for the books. Every write path
  calls it: `logTime` (a backdated entry changes a pay run as surely as an edit),
  `updateEntry` (**both** days, so an entry can be moved neither into nor out of
  a locked period), `deleteEntry`, and `clockOut`.
- **Not an RLS rule, and `0310`'s header says why**: the rule depends on a date
  range in another table, which a row policy cannot express.
- **A correction is an amendment, never a rewrite.** `amends_entry_id` is a
  composite self-FK with `ON DELETE NO ACTION`, so the entry a correction
  corrects cannot be deleted out from under it. The original stays as the pay
  run saw it.
- **Time is the third attention source**, after Scheduling and Work. A submitted
  sheet is somebody waiting at the owner's desk: it clears the moment the
  decision is made, with nothing to mark read. `urgency: soon` and a null
  `dueOn`, because a queue is not a deadline and dressing one up as overdue
  would cry wolf beside an invoice that genuinely is. It carries a one-tap
  Approve, which is the module's own server action rather than a second copy of
  it.

**TWO BUGS THE DRIVE FOUND, both of which the tests would not have.**

1. **A person who only worked in the SECOND week of a fortnight could never
   submit.** The sheet control was pinned to `weeks[0]`, so a new starter had no
   button at all. It now renders on the first week that person appears in.
2. **Every correction was refused as being in the future.** `assertEntryFields`
   rejects a `work_date` after today — a typo guard — but a correction lands in
   the first OPEN period, which is genuinely tomorrow or later whenever the
   business locks the period it is standing in. `firstOpenDay` computes the
   date server-side and the amendment path passes `allowFuture`. The guard
   protects against a mistyped year, and a date the server chose cannot have
   one.

Both were interactions between guards that are each individually right, which is
the class of defect a unit test is worst at and ten minutes in the product is
best at.

- **AND THE MIGRATION WAS SILENTLY STRANDED ON PRODUCTION**, which is the most
  important thing in this entry. `npm run db:migrate` printed *Migrations
  complete* and applied nothing: drizzle decides what to run from one
  high-water row, and a parallel session had applied its own pair at 11:12 and
  11:13 while `0309`/`0310` were stamped 11:07. The two tables were simply
  absent from prod and the command said it was fine. Caught by running
  `scripts/inspect-migration-state.ts` rather than believing the output.
  Repaired by raising both stamps above the mark and moving dev's two ledger
  rows to match, so the DDL still went to prod through the supported command.
  **The standing rule is now in [conventions.md](../conventions.md): never
  trust "Migrations complete", run the reconciler.**
- Verified: 28 isolation tests, the pure suites, lint, `tsc` and the build
  green. `0309`/`0310` applied to dev AND prod before the merge (ADR 0014),
  `db:verify-rls` clean on both. **Driven end to end**: submit, approve (the
  snapshot landed at 4,980 worked and 780 overtime minutes), lock, every day
  turning `Locked` with `Edit` becoming `Correct`, and a 45-minute correction
  landing on the first open day and linking back to its original.

### 2026-09-12 — Time wears the design system (`claude/time-wears-the-design-system`)

No behaviour change. Slices 0–2 were built without reading
[design-system.md](design-system.md), and it showed: eleven hand-rolled
`rounded-lg border` boxes where a `Panel` belongs, bare `divide-y` instead of
`--divider`, thirty-seven uses of the second text tier and none of the third,
`--destructive` used for a figure, and no `--accent-time` token at all — so the
module borrowed the brand default and had no colour of its own.

Nine `Panel`s, twelve `text-subtle-foreground`, a status chip for the
long-punch alarm, and `--accent-time` registered in all three blocks of
`globals.css`. The design-system dossier carries the full audit and the reason
the hue is 335.

**The lesson is the process one**: a module is not finished when it works. The
primitives table and the token rules are in one file and neither was consulted
for three slices.

### 2026-09-12 — Slice 2: the week and the period (`claude/time-2-the-week-and-the-period`)

The overtime evaluator, the pay-period arithmetic, and the screen that shows
the difference between them. Migration `0308` — three columns on
`time_settings`, and nothing else.

**Generated as `0306` and renumbered**, because `Social S0` (#511) took that
slot from a parallel session and merged first. That is the SECOND slot collision
in three slices; the repair is the one
[conventions.md](../conventions.md) prescribes, original `when`
(`1789187568900`) put back so the already-applied migration is skipped rather
than re-run. Unlike 0304's renumber it needed no hand-editing of the SQL:
#511's snapshots were produced after slice 1 merged, so the regenerated diff was
byte-identical.

- **The evaluator is one pure function over a ruleset**
  (`core/overtime.ts`). One worker, one workweek, one `OvertimeRuleset`, in;
  buckets of minutes out. It knows nothing about pay periods, because averaging
  hours across a fortnight is the error the whole design exists to prevent.
- **A ruleset is DATA, and California proves it** (`core/rulesets.ts`). It ships
  in this slice rather than slice 5 for one reason: a second jurisdiction that
  required no code is the only evidence the first one was designed right. It is
  a daily threshold, a double-time threshold and a seventh-day rule — three
  numbers — and the evaluator has no branch that names a state. Driven: the same
  53-hour week reads `40h regular + 13h overtime` under federal and
  `40h regular + 12h overtime + 1h double time` under California, with one
  picker changed.
- **NO PYRAMIDING**, which is the subtlest rule here. An hour already paid as
  daily overtime must not face the weekly test again, so each day contributes
  only its STRAIGHT minutes to the weekly sum. Without it a Californian working
  five ten-hour days is paid fifty hours of overtime on a fifty-hour week.
- **Pay periods are computed, not stored** (`core/periods.ts`), and `0306`'s
  header says why: nothing about a period is worth storing until it can be
  approved and locked, which is slice 3. Weekly, biweekly (anchored, and the
  anchor is pulled back to a week start so a period is always two whole weeks),
  semi-monthly and monthly.
- **The straddle rule, stated once**: a workweek is paid in the period where it
  ENDS. `workweeksPaidIn` is the only place that decides it. Splitting a week
  across two periods would mean deciding which hours were the overtime ones,
  which is a question with no true answer. A test walks a year of semi-monthly
  periods and asserts the weeks tile exactly — none paid twice, none skipped.
- **`/dashboard/m/time/pay` shows a period AS ITS WEEKS**, never as one number.
  That is the whole point of the screen: 30 hours then 50 is ten hours of
  overtime, and a business reading "80 hours this fortnight" cannot see it.
  Driven on the dev branch with exactly that fixture.
- **The week screen now shows the split**, plus `4h before overtime` once
  somebody is within eight hours of the threshold — a decision an owner can
  still make on a Wednesday rather than a number they read after payroll.
- **`0306` has no RLS migration and that is correct**, not an omission:
  `time_settings` is already ENABLE + FORCE with its policies, and a policy
  names ROWS, not columns.
- **Thresholds are NOT in the database.** `overtime_ruleset` is a slug naming a
  data file; two places holding the definition of "over 40" is two places to get
  it wrong, and a business does not want its rules frozen at signup. The column
  is CHECKed, and `rulesetFor` still falls back to the federal floor rather than
  failing a page if a deploy goes backwards.
- **An anchor can only exist on a biweekly payroll**, by CHECK. One left behind
  after a switch to monthly would mean nothing until somebody switched back and
  found their periods on a boundary they had forgotten choosing.
- Verified: 34 new pure tests in `time-overtime`, 49 in `time-core`, 14 in
  `timezone`, 21 isolation tests, lint, `tsc` and the build green. `0308`
  applied to dev AND prod before the merge (ADR 0014), `db:verify-rls` clean on
  both. **Driven** on the dev branch: both settings pickers, the biweekly anchor
  dialog, the pay-period screen and the ruleset switch.

### 2026-09-11 — Slice 1: the clock (`claude/time-1-the-clock`)

`time_punches`, the two columns that say where an entry came from, and the
rounding policy. Migrations `0304`/`0305`.

**Generated as `0302`/`0303` and renumbered**, because `claude/preview-links`
(#509) took those slots from a parallel session and merged first. The repair is
the one [conventions.md](../conventions.md) prescribes, including the part that
is easy to get wrong: **the original `when` goes back into the journal entry**
(`1789184104883` and `1789184144785`), because drizzle applies a migration only
when `lastApplied.created_at < when` and a fresh stamp would have re-run it
against tables that exist. `scripts/inspect-migration-state.ts` confirms both
databases against the renumbered journal.

**It also turned up a live defect on `main`, which the regenerated snapshot
repairs.** #509's snapshots were produced before that branch took slice 0's
merge, so `0302_snapshot.json` and `0303_snapshot.json` have no `time_workers`,
`time_entries` or `time_settings` in them — the newest snapshot on main had
silently lost three tables, and regenerating against it proposed `CREATE TABLE`
for all three. `0304_time_clock.sql` therefore carries slice 1's real delta
rather than what drizzle-kit emitted, while `0304_snapshot.json` is the fresh
complete one, so whoever generates next diffs against the truth.

- **A punch is evidence; an entry is the payable fact**, and slice 1 is where
  that stops being a sentence in a plan. `time_punches` keeps the two real
  instants forever; `clockOut` measures them, applies the policy, and writes the
  entry. Nothing overwrites the raw, so a screen can say "7h 53m worked, 8h
  logged after rounding" and the policy can be changed later without rewriting
  what happened.
- **One open punch per worker, by a partial unique index.** Two running clocks
  on one person double-count an afternoon, and between a look-before-you-leap
  SELECT and the INSERT another request can always win. `clockIn` catches the
  constraint by name and turns it into a sentence.
- **Rounding is always to the NEAREST increment, and there is no direction to
  pick.** Rounding a timesheet is lawful while it is neutral, so a policy that
  always rounds down is not offered — which is why `rounding_minutes` is one
  integer and not a pair with a mode beside it. `tests/time-core.test.ts` proves
  the neutrality directly: over the sixty minute-offsets in an hour, quarter-hour
  rounding gains exactly as much as it loses.
- **Rounding to zero writes no entry**, and that is the policy working rather
  than an edge case to paper over: five minutes on a quarter-hour setting is
  worth nothing by the same rule that pays a full quarter for eight. The punch
  survives as the record that somebody was there, and the toast says so.
- **A punch's business day is the day it STARTED**, in the tenant's zone — a
  shift from 22:00 Tuesday to 02:00 Wednesday is Tuesday's work. Not
  configurable: the alternative convention (split at midnight) only matters once
  overtime is computed per DAY rather than per week, and a setting nothing reads
  differently is wrong half the time without anybody finding out. It becomes a
  choice in slice 5, when a rule cares.
- **Nothing closes a clock automatically.** Past sixteen hours the row turns red
  and asks, and a person decides. Inventing a clock-out puts hours nobody worked
  on a timesheet with a paper trail pointing at us.
- **`0302` is hand-edited for `time_entries_punch_fk`.** drizzle-kit emits a
  bare `ON DELETE set null`, which on a composite key means "null every column
  in the key" — including `tenant_id`, which is NOT NULL, so the constraint
  could never fire. Postgres 15's column-list form `SET NULL ("punch_id")` nulls
  only what should be nulled, and drizzle-kit does not revert it because it
  diffs its own snapshot. The isolation suite now proves the behaviour rather
  than the spelling: delete a punch, the entry survives with a null link.
- **A duplication from slice 0 was deleted.** `core/week.ts` had its own
  `addDays`, `startOfWeek`, `daysBetween` and `isDateString`;
  `src/lib/timezone.ts` has done UTC calendar arithmetic since Scheduling needed
  it, and is deliberately not `server-only` so a client component may use it.
  Two implementations of "what day does this week start on" is exactly the drift
  that makes two screens disagree about which week an hour falls in. `startOfWeek`
  there was annotated `0 | 1` while Scheduling was its only caller and is now
  `number` (the arithmetic always handled all seven); `isDateString` moved there
  too. `core/week.ts` keeps only what is Time's own: the weekday names and the
  two labels. The coverage moved with the code, into `tests/timezone.test.ts`.
- **The running total ticks from the SERVER's figure.** `listOpenPunches`
  returns `elapsedMinutes` as of the read and the browser counts up from mount;
  it never subtracts the punch's start from its own clock, because a laptop that
  has not synced would show a number nobody else can reproduce. Found by lint
  (`react-hooks/set-state-in-effect`, then `react-hooks/purity`), and the first
  draft would also have painted `0m` for a clock that had been running three
  hours.
- Verified: 49 pure tests in `time-core`, 14 in `timezone`, 19 isolation tests,
  lint, `tsc` and the build green. `0302`/`0303` applied to dev AND prod before
  the merge (ADR 0014), `db:verify-rls` clean on both.
- **Not driven.** Still nobody — see Open items.

### 2026-09-11 — Slice 0: somebody worked some hours (`claude/time-0-somebody-worked-some-hours`)

The module exists. Three tables, two screens, three guides. Registered in
`src/modules/index.ts` and seeded **`coming_soon`** — hours that cannot become
overtime, a cost or a paycheck are a notebook with extra steps, so slice 2 is
the earliest this is sold.

- **`time_workers` hangs off the party spine** (migration `0300`), the
  `crm_party_details` shape. `clerk_user_id` is TEXT and nullable rather than a
  `profiles` FK — it matches every other actor column here, so "is this worker
  me?" is a string comparison rather than a join on every screen that asks. A
  **partial** unique index on `(tenant_id, clerk_user_id)` where not null gives
  one worker per sign-in while any number of people with no sign-in coexist,
  which is the ordinary case and the reason the column is nullable rather than
  the empty-string sentinel used elsewhere.
- **`pay_type` shipped in slice 0, not slice 2.** The plan had it arriving with
  the evaluator; it is a column the evaluator READS, so having it a slice early
  costs one picker and saves a backfill over live hours. It is the one CLOSED
  taxonomy in the module, and the schema comment carries the argument: a value
  the evaluator has never seen cannot be classified safely in either direction.
- **`time_settings` holds `week_starts_on` and nothing else.** The rest of what
  this file lists for that table — pay frequency, rounding, the ruleset — lands
  with the code that reads it. The week start is read today, by the screen that
  groups by it.
- **Week arithmetic runs in UTC**, which corrects what this file first said.
  `tenants.timezone` decides what TODAY is; once you hold the `yyyy-mm-dd`
  string it is a calendar fact, and UTC is the only zone where "add a day" is
  always 86,400,000 ms. `tests/time-core.test.ts` pins both 2026 daylight-saving
  crossings.
- **A duration box that reads what people type** — `1:30`, `1h30`, `1h 30m`,
  `1.5`, `90m`, `90` — and echoes back what it understood before anything
  saves. It guesses on a bare number (under 16 is hours, 16 and over is
  minutes), and a guess about money has to be visible while it can still be
  corrected.
- **A CHECK caps one entry at 1440 minutes.** Not a policy about overwork — two
  entries on one day may legitimately exceed a shift — but a typo guard: `800`
  meant as eight hours is otherwise thirteen days, and it reaches a pay run
  before anybody notices.
- **`0300` is hand-reordered.** drizzle-kit emitted `time_entries_worker_fk`
  before the unique index it references. Migrations `0276` and `0295` paid for
  this lesson first; the `when` in `_journal.json` is untouched because only
  statement order changed.
- **`ps_time_entries`' row type was renamed `PsTimeEntry`.** It was exported as
  `TimeEntry` and collided through the schema barrel with the name
  `time_entries` derives. A pack does not hold the unqualified word for a thing
  core also has; `RetainerTimeEntry` is the precedent.
- Verified: 49 pure tests, 11 isolation tests, lint, `tsc` and the build green.
  `0300`/`0301` applied to dev AND prod before the merge (ADR 0014),
  `db:verify-rls` clean on both at 179 tables. Dev branch re-seeded.
- **Not driven.** Nobody has opened either screen — see Open items.

### 2026-09-11 — The plan (`claude/time-tracking-plan`)

Design session with the founder. Nothing built; this file is the agreed shape
and the slice order. The four decisions taken are recorded above with their
reasoning. Grounded in a read of `retainer.ts`, `professional-services.ts`,
`platform.ts`, `parties.ts`, `work.ts`, `ledger.ts`,
`src/lib/dimension-options.ts`, `src/lib/attention-sources/types.ts` and
`docs/extension-model.md`.
