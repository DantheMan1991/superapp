# Time

> What actually happened: who worked, for how long, on what, and what it cost.
> A clock and a timesheet for people who may not have a login, a workweek that
> knows the difference between overtime and a pay period, and an hour that
> reaches the P&L tagged with the thing it was spent on. Core owns the
> mechanism; an industry layer supplies the vocabulary and the odd pay rule.
> Status: partial — slices 0–4 built (people, hours, the clock, the workweek and overtime, and submit/approve/lock). The case for staying `coming_soon` is now weaker: a locked period is trustworthy. The remaining gap is money — no rates, no export · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

## The plan (agreed with the founder 2026-09-11)

### What exists already, and why none of it is this

| Where | What it is | Why it is not Time |
| --- | --- | --- |
| `retainer_time_entries` + `retainers.timer_started_at` | Minutes, a day, a note, one running timer. Yosher logging its own work against a client tenant | Platform-side. The tenant only ever sees the balance at `/dashboard/hours` |
| `ps_time_entries` | Minutes, a day, a note against a `ps_engagement`, burned down against a monthly allotment | Knows no person, no rate, no week, no overtime. Minutes against a contract |
| `scheduling` | Calendars, items, attendees, shares | **Planned** time |
| `work` | Items with one assignee and a due date | **Obligations**. What needs doing, not what got done |

Both time tables are the same four columns, and neither is a clock. Nothing in
the tree knows what a workweek is, what anyone is paid, or who a person is when
they have no Clerk login. That last gap is what decides the architecture.

**Work is what needs doing. Time is what got done.** Keep saying it that way and
the two modules never blur.

Note also that `/dashboard/hours` is taken — it is the retainer balance the
client reads. This module lives at `/dashboard/m/time`, and the word "hours" in
tenant-facing copy has to stay out of its nav label for that reason.

### The four decisions taken up front

1. **It goes as far as gross, and stops.** Hours, rates, overtime, premiums and
   gross pay per worker per period; the labor accrual posted to the ledger by
   dimension; a clean export for the payroll provider. **No withholding, no
   filings, no direct deposit** — that is a licensed, per-jurisdiction,
   tax-table-subscription business, and taking it on would own the roadmap for a
   year. Contractor hours go to AP as a bill rather than to payroll at all.
2. **A worker is a party, not a login.** Day one. Retrofitting identity after
   forty tables have stamped `actor_clerk_user_id` is the expensive version of
   this, and every crew-shaped client is locked out until it happens.
3. **Core is built standalone; absorption is a later named slice.**
   `ps_time_entries` and the retainer tracker keep working untouched. Migrating
   live engagement hours and Stripe-credited retainer purchases does not belong
   inside the first build of a module.
4. **The first industry layer is the homestead farm.** Hilltop Farm on the dev
   branch is the only fixture that can be driven by hand, labor is the last
   missing cost on profit-per-enterprise, and the `enterprise` dimension the
   farm already has is the target an hour wants most.

### The five nouns

Everything else is a consequence of these.

**1. A worker is a party.** `time_workers` hangs off `parties` (kind `person`)
the way `crm_party_details` does. A `profile_id` when they log in, null when
they do not; a PIN hash when they punch on a shared device; an `entity_id`
saying which set of books employs them (the platform has legal entities inside a
tenant, and two of them can employ different people); a pay basis and an
exempt/non-exempt flag the rules engine reads.

Putting the worker on the party spine buys a property that is not obvious: a
subcontractor who is also a vendor is **one party**, so their hours can become a
bill instead of a paycheck without anybody keying a second record.

**2. A punch is evidence; an entry is the fact.** Two tables, deliberately.

- `time_punches` — raw. `started_at` / `ended_at` as `timestamptz`, the device,
  coordinates if offered, and a client-generated id so a phone that retries a
  sync cannot double-punch (`retainer_purchases.stripe_session_id` is the same
  trick).
- `time_entries` — payable. Minutes, a business day, a pay type, a target.

**Store the raw forever and compute everything else.** Rounding then has its
work shown on screen ("you worked 7:53, we paid 8:00, here is the rule"), and
one punch split across three targets is one punch and three entries rather than
a rewritten clock record. A manual entry simply has no punch.

**3. What the hour was for is a dimension.** Do not invent a taxonomy.
`dimension_members` is already an open set of types built from the data, and the
P&L's "Split by" is generated from the distinct types present
(`src/lib/dimension-options.ts` documents exactly this). Tag an hour with a
dimension member and **labor cost appears in the P&L by enterprise, parcel,
asset or anything a pack registers, with no report code written.** For targets
that are not cost dimensions — an engagement, a work item, a customer — a
`target_type` / `target_id` pair carrying no CHECK on its values (primitive P3,
the `mail_links` shape).

**4. A rate change is a new row.** `time_rates`, effective-dated, the shape
`retainer_allotments` and retail's `(channel, item)` pricing already use. Two
kinds, and they are different numbers: **cost** (what the hour costs the
business, plus an optional burden percentage for employer taxes and insurance)
and **bill** (what a customer is charged). Conflating them is how a job looks
profitable.

**5. A timesheet is a worker × period.** `time_sheets` carries submitted →
approved → locked and **snapshots its totals at approval**. The snapshot is what
the pay run used; without it a dispute three months later has nothing to read.

### Overtime is the hard part

This is where products are quietly wrong, so the engine is specified before it
is built.

**The workweek is the unit of overtime. The pay period is the unit of payment.
They are different and need not align.** A workweek is a fixed, recurring 168
hours starting on a day and hour the business chooses. A pay period is weekly,
biweekly, semi-monthly or monthly.

- **Biweekly is two independent workweeks.** 30 hours then 50 hours is ten hours
  of overtime, not none. Averaging across the fortnight is the most common
  payroll error there is. Compute per workweek, then sum into the period.
- **Semi-monthly does not align to weeks at all**, so a workweek straddles two
  pay periods. The convention here: overtime lands in the period where the
  workweek **ends**. One rule, one place.
- **Hours worked is not hours paid.** Paid leave and holiday count toward the
  paycheck and **not** toward the 40 that triggers overtime. If the pay type is
  not in the schema from the start, every leave week overpays. Only `worked`
  types reach the evaluator.
- **The regular rate is not the base rate.** It is straight-time pay ÷ hours
  worked that week, pulling in non-discretionary bonuses, shift differentials
  and on-call pay, excluding leave pay, reimbursements and discretionary
  bonuses. Two rates in one week means a weighted average. The premium is then
  0.5 × regular rate × overtime hours **on top of** straight time — which is why
  `hours × 1.5 × rate` breaks the moment anyone has a second rate.
- **Daily overtime exists.** California forces it: over 8 at 1.5×, over 12 at
  2×, and the seventh consecutive day of a workweek pays 1.5× for the first
  eight hours and 2× beyond. A handful of other states have their own variants.
- **No pyramiding.** An hour already counted as daily overtime does not count
  again toward the weekly 40.
- **8/80** for healthcare: by written agreement, overtime over 8 in a day or 80
  in a 14-day period.
- **Rounding must be neutral.** Quarter-hour rounding is fine; always rounding
  down is not. Keep raw, apply policy, show both.
- **Premiums are money, not hours.** A missed meal break in California is one
  hour's pay. It belongs on the timesheet and it is not time, so the evaluator
  returns **buckets of hours plus amounts**, never one number.
- **Exempt people still track time** — for cost allocation and for billing — and
  never generate overtime. A flag on the worker; the evaluator short-circuits.

**An overtime ruleset is data, not code** (candidate ADR 0046). `federal`, `california`, `8-80` and `none` as data files
in core, read by a **pure** evaluator that takes one worker's week of segments
and returns buckets. A jurisdiction is not an industry, so this stays in Layer 1
— but because the evaluator takes a ruleset *object*, a pack (union agreements,
prevailing wage) can supply one without core learning what a union is.

Being pure, it wants a large table-driven test file more than it wants anything
else. That file is the deliverable of slice 2, not an afterthought to it.

**The platform does not give legal advice.** A ruleset is configuration the
business (or its advisor) selects, the choice is recorded, and the screen says
so.

### Words that do not belong in core

"Job" fails the §3 neutrality test and `docs/extension-model.md` §8 already
litigates it. "Crew" and "shift" fail it too — a bookkeeping firm has neither.
Core says **worker, punch, entry, timesheet, period, target**. Packs say the
rest.

### The layers

| Layer | What it adds on top of the spine |
| --- | --- |
| `homestead-farm` (first) | Hours per enterprise on the enterprise P&L, paddock / pen / run as targets, piece rate, seasonal workers with no login, and what the farm actually pays the person running it per hour |
| `job-costing` / trades | Cost codes and phases as targets, per-target bill rates, group punch |
| `certified-payroll` | Prevailing wage determinations, fringes, WH-347. Already named in `extension-model.md`'s pack table |
| `professional-services` (exists) | Engagement as target, billable flag, utilization, burn-down, hours to invoice |
| `retail` / hospitality | Tips, shift differentials, split-shift premium |
| `field-service` | Drive time, travel pay, on-call and callback |
| healthcare | 8/80, differentials |

### Extension points

**Declares one.** `src/lib/time-targets/` — what an hour can be booked to. Types
only, a `registry.ts` naming the fillers, `resolve.ts` for the picker. The
eighth use of primitive P5 and the same shape as `paste-targets` and
`tell-sources`: a filler answers with fields as data and its own label
resolution, and core never learns what a paddock is.

**Fills four.** `attention-sources` (sheets awaiting approval, punches still
open, overtime about to be crossed), `setup-sources` ("nobody can log time
yet"), `paste-targets` (paste your staff list), `tell-sources` ("Jake worked six
hours in the north field yesterday" — the most natural sentence anybody has ever
wanted to say to this product).

**And carries a verb seam.** `src/lib/time/` holds the write path and the
verbs — the same arrangement `src/lib/work/` grew in §4b, for the same reason:
anything may log an hour, and a module may not import another module.

### Slice order

Ten slices, then two named absorptions. Each is a PR.

| # | Slice | What lands |
| --- | --- | --- |
| 0 | **Somebody worked some hours** | `time_workers` on the party spine, `time_entries`, `time_settings`. Manual entry only: who, how long, what day, a note. Module registered + seed row, RLS policies, isolation coverage, dossier, guide |
| 1 | **The clock** | `time_punches`, start/stop, one open punch per worker enforced by a partial unique index, the open-punch alarm, the rounding policy raw → entry, and the rule for a day that crosses midnight |
| 2 | **The week and the period** | `time_periods` materialised from settings, the workweek computation, the pure evaluator with the `federal` ruleset, pay types, and the table-driven test file that is the point of the slice |
| 3 | **Submit, approve, lock** | `time_sheets` per worker × period, totals snapshotted at approval, the approval attention source, `logAudit` on approve/unlock, and an amendment after lock landing in the open period |
| 4 | **What it was for** | Dimension tagging on an entry, splitting one day across targets, the `time-targets` slot declared and first filled. Hilltop's enterprises become bookable the day this ships |
| 5 | **What it costs** | `time_rates` effective-dated (cost, bill, burden), gross per worker per period, premiums, and the `california` ruleset added — a second ruleset is what proves the first claim |
| 6 | **It reaches the books** | The labor accrual posted on approval, split by dimension, reversible; contractor hours to a bill instead; the payroll-provider export |
| 7 | **On a phone, in a barn** | Shared-device punch with a PIN, offline sync keyed on a client id, the location stamp, the `tell-sources` filler and the `paste-targets` filler |
| 8 | **Overtime before it happens** | The predicted crossing ("Jake hits 40 on Thursday"), open punches and unsubmitted sheets, all through `attention-sources` so they self-clear |
| 9 | **The homestead farm layer** | Piece rate with its own rest-break treatment, paddock/pen/run targets through the slot, and the return-per-hour view on the enterprise P&L |
| A1 | *Absorb professional services* | `ps_time_entries` migrates onto the spine; the engagement becomes a `time-targets` filler and keeps its allotment burn-down |
| A2 | *Absorb the retainer tracker* | Yosher's own hours against its clients become Time in the operator tenant. Touches Stripe-credited purchased hours, so it goes last |

Most of the farm's value arrives in slices 4–6, not slice 9: enterprise tagging
is core because a dimension is core, so profit-per-enterprise gains its labor
cost as soon as hours can be tagged and posted. Slice 9 is the genuinely
farm-shaped remainder.

## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### 2026-09-12 — Slice 4: what the hour was for (`claude/time-4-what-it-was-for`)

One link table, `time_entry_dimensions`. Migrations `0311`/`0312`.

- **NO NEW TAXONOMY, AND THE `time-targets` SLOT IS NOT BUILT.** The plan named
  a declared extension point here. It turned out to be a second answer to a
  question the platform had already answered: `dimension_members` IS the
  mechanism, and five packs already fill it — `land` syncs parcels and zones,
  `assets` its assets, `inventory` and `livestock` their lots, `enterprises`
  lines of business. Tagging an hour with a member makes it bookable to a
  paddock, a herd or a tractor with **no new seam**, and a parallel slot would
  have had no filler while asking every pack to populate two registries. The
  slot comes back if something worth booking to is ever NOT a dimension member
  — a professional-services engagement is the likely first, in absorption slice
  A1.
- **The shape is `line_dimensions`'**, denormalized `dimension_type` included.
  That column is what lets both rules be the database's: one member per type per
  entry (unique index), and the member really is of the type claimed (the
  three-column FK). The isolation suite proves the second by trying to call an
  enterprise a parcel.
- **Splitting a day is splitting an entry**, which falls out of
  one-member-per-type and is the honest model: the hours really were divided,
  and one row carrying two tags could never say how much went where. `splitEntry`
  leaves the remainder on the original so **the day's total never moves** — the
  property that makes it safe to offer beside a figure somebody already
  believes.
- **`src/lib/dimensions.ts` is new, and the reason is the module isolation
  rule.** Accounting has its own `listDimensionMembers`; a second core module
  reaching for it would be one module importing another. The shared read goes in
  Layer 0, exactly as `src/lib/parties/`, `src/lib/enterprises/` and
  `src/lib/work/` already do.
- **`time` was added to `MODULE_SLUGS` in `eslint.config.mjs`, four slices
  late.** The comment beside `work` records the same miss happening three slices
  late, and now says so twice. Time was clean when it was noticed — it imported
  nothing — but only by luck, and slice 4 was about to want accounting's reader.
- **"Where the hours went"** on the pay period screen is the visible payoff:
  worked minutes grouped by what they were booked to, with an explicit `Not
  booked to anything` line. An hour booked to two KINDS counts under each, and
  the panel says so rather than pretending the figures sum — the same rule the
  P&L's "Split by" follows.
- Verified: 33 isolation tests, the pure suites, lint, `tsc` and the build
  green. `0311`/`0312` applied to dev AND prod, **confirmed with
  `inspect-migration-state.ts` rather than the migrate command's own output**,
  per the rule slice 3 earned. Both databases at 186 tables.
- **Driven on HILLTOP FARM**, which is the point: five pickers — Asset,
  Enterprise, Lot, Parcel, Zone — appeared in the log dialog with no code in
  this module naming any of them. Logged 3h 30m against `Beef`, split an hour
  off it, and the pay period read `Beef 2h 30m · Not booked to anything 1h`.

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

## Data model

**Built** rows are live (`0300`, `0301`, dev and prod). The rest are the plan's
shape and arrive with the slice that reads them. Every table takes `tenant_id`,
FORCE RLS, a `--custom` policy migration and isolation coverage
(`docs/security.md` §4).

| Table | Slice | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- | --- |
| `time_workers` | **Built** | A person the business keeps hours for | Detail row on `parties` (kind `person`), the `crm_party_details` pattern. Unique on `(tenant_id, party_id)`; **partial** unique on `(tenant_id, clerk_user_id)` where not null. The PIN hash (slice 7), `entity_id` (slice 6), pay basis and exempt flag (slices 2 and 5) arrive with their readers |
| `time_entries` | **Built** | The payable fact | Minutes, never decimal hours. Business day (`date`, string mode), `pay_type`, note, `entered_by_clerk_user_id`, `punch_id`, `source`, `amends_entry_id` (composite self-FK, NO ACTION), version. Composite FKs to `time_workers` (cascade) and `time_punches` (**SET NULL, column-list form**). Partial unique on `(tenant_id, punch_id)` — one entry per punch. CHECKs: minutes > 0, minutes ≤ 1440, `pay_type` and `source` each in their closed set. The target arrives in slice 4 |
| `time_settings` | **Built** | One row per tenant, created lazily | `week_starts_on` (0–6), `rounding_minutes` (0, 5, 6, 10, 15, 30), `pay_frequency`, `period_anchor` and `overtime_ruleset`, all CHECKed, plus a CHECK that an anchor can exist only on a biweekly payroll. The ruleset is a SLUG naming a data file, never a set of thresholds. A missing row means the defaults, decided in the read rather than by a backfill |
| `time_punches` | **Built** | Raw clock evidence | `timestamptz` in/out, who pressed each button, note, version. Composite FK to `time_workers`. Partial unique on `(tenant_id, worker_id) WHERE ended_at IS NULL` — one open punch, enforced by Postgres. CHECK `ended_at > started_at`. The device, the coordinates and the client-generated id for idempotent offline sync arrive in slice 7 with the screen that sends them |
| `time_periods` | **Built** | The LOCK on a pay period | `starts_on`/`ends_on` stored (they must survive a change of pay frequency), `locked_at` + `locked_by`, CHECKed to arrive and leave together. A row exists once the period has been locked at least once; `locked_at is null` is open. No status column — there are two states and a timestamp says which, plus when |
| `time_sheets` | **Built** | One worker's period, submitted then approved | A row exists once submitted; `approved_at is null` means waiting. The five totals plus `ruleset_slug` are the SNAPSHOT and are null until approval, CHECKed to arrive with it. Unique on `(tenant, worker, period_starts_on)`. Period dates stored, not referenced |
| `time_entry_dimensions` | **Built** | What the hour was for | `entry_id` + denormalized `dimension_type` + `member_id`. Unique on `(tenant, entry, dimension_type)` so one member per kind; three-column FK to `dimension_members (tenant_id, dimension_type, id)` so the stated kind is the member's real one. Cascades from the entry; NO ACTION on the member, which is retired rather than deleted |
| `time_rates` | 5 | Effective-dated pay | Cost rate, bill rate, burden percent, effective from. A change is a new row. Expected to carry an owners-only policy |
| `time_breaks` | 5 | Meal and rest periods | Child of a punch. Paid flag, kind. Needed for premium rules, queryable rather than jsonb |

## Key files & seams

Built in slice 0:

- `src/db/schema/time.ts` — the three tables, re-exported by the barrel
- `src/modules/time/TimeModule.tsx` — the week, at `/dashboard/m/time`
- `src/app/dashboard/m/time/people/page.tsx` — who the business keeps hours for
- `src/app/dashboard/m/time/pay/page.tsx` — one pay period, shown as its weeks
- `src/modules/time/components/clock.tsx` — the running-clock panel
- `src/modules/time/core/` — the pure half, so it bundles to the browser:
  `duration.ts` (parse, format, decimal), `pay-types.ts` (the closed set and
  `countsAsWorked`), `rounding.ts` (nearest-only rounding and the long-punch
  threshold), `overtime.ts` (**the evaluator**), `rulesets.ts` (federal,
  California, none, as data), `periods.ts` (pay-period arithmetic and the
  straddle rule), `errors.ts` (`TimeError`, `roleMayWrite`,
  `roleMayManageWorkers`), `week.ts` (the weekday names and the strip's labels
  — the ARITHMETIC is `@/lib/timezone`'s)
- `src/modules/time/read.ts`, `worker-ops.ts`, `entry-ops.ts`, `punch-ops.ts`,
  `settings-ops.ts`, `sheet-ops.ts` — one writer per table, each taking the
  caller's `tx`. `sheet-ops.ts` also holds `assertPeriodOpen`, the guard every
  write path calls, and `firstOpenDay`, which decides where a correction lands
- `src/lib/dimensions.ts` — the SHARED dimension read, in Layer 0 because a
  second core module may not import accounting's
- `src/modules/time/attention/source.ts` — timesheets waiting to be approved,
  registered third in `src/lib/attention-sources/registry.ts`
- `src/modules/time/components/sheet-controls.tsx` — submit, approve, lock
- `src/modules/time/actions.ts` — gate → Zod → `withTenant` → revalidate. Two
  gates: `gate()` for writing time, `ownerGate()` for changing who the workers
  are
- `tests/time-overtime.test.ts` (34 — the evaluator and the periods),
  `tests/time-core.test.ts` (49), `tests/isolation/time.test.ts` (21), and the
  calendar arithmetic this module leans on in `tests/timezone.test.ts`
- `docs/help/time/` — `overview.md`, `week.md`, `people.md`

Planned, with the slice that brings them:

- `src/lib/time/` — the verbs, so anything may log an hour without importing the
  module (§4b's arrangement) — slice 4, when a second caller exists
- `src/lib/time-targets/` — the declared slot: types, registry, resolve — slice 4
- `src/modules/time/attention/source.ts`, `setup/source.ts`, `paste/target.ts`,
  `tell/source.ts` — the four fillers, slices 8, 0–8, 7 and 7

## Decisions & gotchas

Written before the build so they are not rediscovered.

- **A punch is an instant; a day is a calendar fact.** Store `timestamptz`,
  derive the business day in `tenants.timezone`, never subtract two dates. A
  span crossing midnight belongs to the day it **started** — slice 1 built that
  and deliberately did NOT make it configurable, because the alternative (split
  at midnight) only matters once overtime is per-day, and a setting nothing
  reads differently is wrong half the time silently.
- **Never compute an elapsed time from the browser's clock.** A duration is
  measurable locally; the difference between a local clock and a stored instant
  is not, because the two clocks disagree. The running total counts up from the
  figure the server sent. Both lint rules that fired on the first draft were
  pointing at real defects, not style.
- **DST breaks the 168-hour assumption twice a year**, and slice 0 corrected
  what this file said to do about it. A workweek anchored at Sunday 00:00 local
  is 167 or 169 hours on two weekends. The fix is NOT to compute week boundaries
  in the tenant's zone, which is what was first written here:
  `tenants.timezone` decides what TODAY is, and once you hold the `yyyy-mm-dd`
  string it is a calendar fact, so every sum on it runs in UTC — the only zone
  where "add a day" is always 86,400,000 ms. `core/week.ts` does exactly that,
  and `tests/time-core.test.ts` pins both 2026 crossings.
- **Never fabricate a clock-out.** An open punch past a threshold raises an
  attention item and is closed by a person. An auto-close that silently invents
  hours is a payroll error with a paper trail pointing at us.
- **Do not invent a taxonomy that `dimension_members` already is.** Five packs
  sync into it and the P&L builds its report options from whatever types are
  present, so a module that tags a row with a member gets every pack's things
  for free and stays industry-blind. Slice 4 dropped a planned parallel slot for
  this reason.
- **Counting per kind is not double counting.** An hour booked to a field AND a
  line of business belongs to each when you ask about that kind; the totals are
  per kind and must never be summed across kinds. Any screen showing them says
  so.
- **Two guards that are each right can be wrong together.** Slice 3's drive
  found both of this module's real bugs, and neither was a unit-test miss: a
  sheet control pinned to the first week of a period hid itself from anybody who
  started mid-fortnight, and the future-date typo guard refused every correction,
  because a correction legitimately lands in the NEXT period. Walk the product
  after wiring guards together.
- **A correction's date is the server's to choose.** `firstOpenDay`, not
  "today" — a business that locks the period it is standing in would otherwise
  have nowhere to put one.
- **No pyramiding, and it is the easiest thing here to break.** An hour already
  priced by a DAILY rule must not face the weekly test again. `evaluateWeek`
  does that by summing each day's STRAIGHT minutes for the weekly comparison,
  never its worked minutes. The test that catches a regression is "five
  ten-hour days are 40 regular and 10 overtime".
- **`evaluateWeek` wants all seven days, blank ones included.** A caller that
  filtered out the empty days would silently switch the seventh-consecutive-day
  rule off, because six worked days handed over as six entries look exactly like
  a full week. There is a test named after that mistake.
- **Leave never counts toward 40.** The single most common bug in this domain.
  Prevented by `pay_type` existing from **slice 0** — a slice earlier than
  planned, because it is a column the evaluator reads rather than one it writes,
  so shipping it early costs a picker and saves a backfill over live hours.
  `countsAsWorked` is the one predicate that answers it, and both sides call it.
- **The rounded number is never the only number.** Raw punch retained forever,
  the policy applied on the way to the entry, and both visible on screen. Two
  consequences that look like bugs and are not: rounding can take a short punch
  to zero and write no entry at all, and rounding is never offered in a
  direction — always-down is unlawful at any increment, so the product has no
  setting for it.
- **The arithmetic already existed.** `src/lib/timezone.ts` is the calendar
  module and is deliberately not `server-only`. Before adding a date helper to
  this module, look there; slice 0 wrote four that were already in it.
- **Approval snapshots; lock forbids restatement.** After a period is locked, an
  edit becomes an adjustment in the open period referencing the original. Paid
  history is not rewritten.
- **One worker is the untested case.** A one-person business tracking its own
  hours has to work end to end — approvals included, where the approver and the
  worker are the same person. (The lesson from
  `one-of-everything-is-the-untested-case`.)
- **A rate is not a secret, but it is close.** What someone is paid should not be
  visible to every member. Expect a visibility rule on `time_rates` in the shape
  the Documents module's owners-only folders use — `withTenant(..., { role })`
  with the role that came from `requireTenant()`.

## Open items

- The candidate ADRs: an overtime ruleset is data; a worker is a party and not a
  login; the workweek is the unit of overtime and the pay period the unit of
  payment; Time stops at gross. All four are now BUILT and unwritten, which is
  the wrong way round — 0046 was taken by the preview-links work, so the next
  free number moves.
- **The 8/80 rule is not expressible** by `OvertimeRuleset` as it stands: it
  needs a 14-day window rather than a workweek, so it changes the evaluator's
  shape rather than adding a data file. Left until a healthcare client asks.
- **Exempt is a whole-business setting today.** `none` turns overtime off for
  everybody; a per-person exempt flag belongs on `time_workers` and arrives with
  rates in slice 5.
- Driven through slice 3 on the dev branch (Test tenant). Residue there: two
  workers, one punch, a fortnight of seeded hours on a biweekly payroll anchored
  to 2026-08-30, one approved sheet, one locked period and one correction.
- **Changing the pay frequency after a sheet is approved is unguarded.** The
  sheet keeps the period dates it was approved for, so nothing is lost or
  restated — but it will no longer line up with any period the screen computes,
  so it simply stops being visible. A warning on the frequency picker is the
  cheap fix; refusing the change outright is probably too strict.
- The `time-targets` extension slot is designed and unbuilt, deliberately. It
  arrives with the first thing worth booking to that is not a dimension member.
- **A period is locked for everybody or nobody.** Locking one person's hours
  while another's stay open is not expressible, and nobody has asked for it. The Browser pane's `preview_start`
  launches from the session's working directory rather than an out-of-repo
  worktree, so the session that built slice 0 could not drive its own code, and
  the main checkout was held by a parallel session's dev server. To look: switch
  Time on for a tenant from `/admin`, add somebody on People, log an hour.
- The `time` vs `timekeeping` slug question is **settled**: `time`, matching the
  one-word house style (Mail, Work, Documents, Scheduling).
- Accrual and carryover for paid leave is deferred past slice 9. Pay types make
  leave *expressible* from slice 2; a balance that earns itself is its own
  feature.
- Scheduled versus actual — comparing a `schedule_items` assignment against the
  hours worked — is real and not planned. It needs scheduling's pack seams
  (slices 6/7 there, deferred for want of an implementor).
