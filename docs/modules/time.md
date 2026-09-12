# Time

> What actually happened: who worked, for how long, on what, and what it cost.
> A clock and a timesheet for people who may not have a login, a workweek that
> knows the difference between overtime and a pay period, and an hour that
> reaches the P&L tagged with the thing it was spent on. Core owns the
> mechanism; an industry layer supplies the vocabulary and the odd pay rule.
> Status: partial — slices 0–7 built. Hours in, gross pay out, frozen at approval, posted to the ledger split by dimension, a file for the payroll provider, and **a shared keypad for people who never open the app**. What remains is the warning before overtime happens (8) and the farm layer (9) · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

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

### 2026-09-12 — Slice 7: on a phone, in a barn (`claude/time-7-on-a-phone-in-a-barn`)

A shared device by the door: tap a name, type a PIN, and it does whichever of in
or out is next. Migration `0316`.

- **TAP A NAME, THEN A PIN — NOT A PIN ALONE**, which is the decision the rest
  follows from. A PIN that identified on its own would have to be unique across
  the business (leaking "that one is taken" to whoever was choosing), and would
  cost a scrypt verification PER WORKER on every attempt. One extra tap buys
  both away, makes the lockout per-person and meaningful, and makes two people
  sharing `4821` a coincidence rather than a collision.
- **A PIN IS NOT A PASSWORD.** The tablet is already signed in and
  `requireTenant()` has already said this browser may write time; the PIN only
  decides which of several people is standing at it. That is why four digits is
  enough — and why `pin_hash` sits on the member-wide `time_workers` rather than
  behind an owners-only policy like `time_rates`. Ask what reading it would GAIN
  a signed-in member: nothing. Staff can already clock anybody in from the
  ordinary panel, because `started_by_clerk_user_id` exists precisely so a
  supervisor can. The PIN's threat is the passer-by with no session at all.
- **THE BUG THAT WOULD HAVE SHIPPED SILENTLY: a wrong PIN cannot THROW.**
  `withTenant` opens a transaction, so throwing out of it discards every write
  inside — including the increment of `pin_failed_count` that makes the lockout
  work. Five wrong PINs would have left the counter at zero forever, with a test
  that passed because the increment really did run. Credential failures are now
  RESULTS (`{ kind: "wrong" | "locked" }`) and the action turns them into
  messages. `tests/time-pin-ops.test.ts` asserts the counter through the real
  transaction, and the drive confirmed `pinFailedCount: 1` in the database.
- **The lockout EXPIRES BY ITSELF.** Documents' share links lock until an owner
  resets them, which is right for a stranger and wrong here: the person locked
  out is in a barn at six in the morning and the owner is in a field. Five wrong
  tries, fifteen minutes, derived from the counter and the timestamp rather than
  stored — so the chip and the reset button appear and vanish on their own.
- **Every failure does the same scrypt work.** `decoyPasscodeWork()` on the
  paths that have nothing to verify, so "that worker has no PIN" does not return
  measurably faster than "wrong PIN" and tell somebody which names to guess at.
  Straight from the document share's unlock action.
- **ONE BUTTON, BOTH DIRECTIONS.** The database already knows whether a clock is
  running, and somebody with cold hands should not have to supply a fact the
  system holds. It also removes the ordinary panel's worst failure — pressing
  the wrong one of two buttons and being told "a clock is already running",
  which is true, unhelpful and looks broken.
- **`client_ref` is the half of offline that cannot be retrofitted**, and it
  went in now for retail's reason word for word: the device mints it before it
  reaches the network, and the partial unique index makes a retry a no-op rather
  than a double punch — or, without it, a false "you are already clocked in" to
  the person who pressed the button one second ago. Clock-OUT needs no
  equivalent: `time_entries_punch_idx` already allows one entry per punch.
- **It is NOT offline, and that is stated rather than implied.** A failed
  request says `No connection` and keeps the PIN typed; it never pretends the
  punch landed. The rest — a service worker and a durable queue — is Layer 0
  platform work that `docs/modules/retail.md` already costed and gave its own
  ADR to write.
- **The locked-period refusal got its own wording.** `assertPeriodOpen`'s
  message tells the reader to "add a correction in the open period", which is
  right for the week screen and meaningless to somebody at a keypad who cannot
  do that. The kiosk says "These dates are closed for pay — your clock is still
  running, tell whoever runs your payroll." Found by driving, not by a test.
- **`kiosk` joined the `time_entries.source` CHECK**, exactly as slice 0's
  comment promised: a value arrives with the door that writes it. `import`,
  `tell` and `paste` are still promises, and an isolation test proves `import`
  is still unstorable.
- **The location stamp was DROPPED**, not deferred quietly. On a shared device
  it is redundant — the tablet IS the location — and on a personal phone it is
  employee surveillance, which is a policy decision with legal weight in several
  states and belongs to the founder, not to this slice.
- Verified: 11 new pure tests in `time-pin`, 13 db-backed in `time-pin-ops`, 44
  isolation, lint, `tsc` and the build green. `0316` applied to dev AND prod,
  both at 187 tables with RLS clean.
- **Driven on Hilltop Farm at 375×812**, which is the point of the slice. Set a
  PIN (with `1234` refused first), named the device `Barn door`, punched in,
  punched out, and read back from the database: `source: 'kiosk'`,
  `deviceLabel: 'Barn door'`, `clientRef` set, `pinFailedCount` 1 after a wrong
  PIN and 0 after a right one.

### 2026-09-12 — Slice 6: it reaches the books (`claude/time-6-it-reaches-the-books`)

The labor accrual, split by dimension and reversible, and a CSV for whoever
runs the payroll. Migration `0315`.

- **A MODULE MAY NOT IMPORT ANOTHER MODULE, AND THAT DECIDED THE SHAPE.**
  `eslint.config.mjs`'s `MODULE_SLUGS` binds `src/modules/<slug>/` and
  deliberately leaves `src/packs/` and Layer 0 alone — which is why inventory
  calls `postEntry` from its own directory and Time cannot. So the write goes
  through `src/lib/labor-posting.ts`, the same answer slice 4 reached for the
  dimension READ with `src/lib/dimensions.ts`. The rule catches `import type`
  too, so the door re-exports `LedgerCtx`.
- **The door is NARROW on purpose.** It takes a period's labor and posts the one
  entry that means; it does not take accounts or lines. A general "post anything
  from Layer 0" helper would be a second way into the ledger with none of
  `postEntry`'s guards in front of it, which is exactly what ADR 0011 refused
  when it rejected `postMachineEntry`.
- **IT POSTS ON LOCK, NOT ON APPROVE**, against the plan. Three reasons, and the
  second is the one that settles it. One entry per period is the shape a
  bookkeeper wants — posting per sheet gives a twelve-person farm twelve entries
  a fortnight. **`returnSheet` refuses an approved sheet**, so approval has no
  undo and an accrual posted there could never be reversed; `unlockPeriod`
  already exists and is exactly the undo an accrual needs. And "locked" is the
  moment the business says these are the hours we are paying, which is when a
  liability is real.
- **ONLY APPROVED SHEETS.** Hours nobody has agreed to are not a liability.
  Unapproved sheets in a locked period are COUNTED and reported in the toast
  — "2 timesheets were never approved" — rather than quietly included or
  quietly dropped.
- **The approved snapshot is what posts**, not a figure worked out again at lock
  time. `time_sheets.gross_cents` froze at approval (slice 5) precisely so a
  rate added in between cannot restate it, and an accrual that disagreed with
  the timesheet it came from would be the worst kind of wrong — nobody would
  find it.
- **Minutes are the basis for the split, and the premium is spread.** The
  forty-first hour is only expensive because forty came before it; asking which
  job "caused" the overtime has no answer, and whichever was booked last is an
  artefact of data entry. So `core/allocate.ts` apportions the whole week's pay
  over the period's hours. **`allocateCents` is largest-remainder**, because
  three equal shares of $10.00 are $9.99 and an entry that does not sum to zero
  does not post at all.
- **The grouping key is the whole SET of dimension members, not one member.** An
  hour tagged with an enterprise AND a parcel is one journal line carrying both
  — `line_dimensions` allows one member per TYPE per line. Grouping by a single
  member would either double-count the hour or drop one of its tags.
- **Wages and on-costs are separate expense lines against one liability.** A P&L
  that folded the employer's tax into wages would tell an owner their people
  cost less than they do, and splitting it costs one line. `6450` and `6500`
  debit, `2300` credits, and `2300` is relieved when the provider's run arrives
  as a bill — the shape `2060` already has.
- **THE ACCOUNTS ALREADY EXISTED.** `2300 Payroll Liabilities`, `6450 Salaries &
  Wages` and `6500 Payroll Taxes` all ship in the general chart, so no tenant
  needs a re-provision and no template changed. `6450` and `6500` share subtype
  `payroll_expense`, so subtype cannot tell them apart — `pickOne` returns null
  on the pair and the CODE decides, which is the same reason inventory's
  resolver puts code before subtype.
- **THE BUG WORTH REMEMBERING: a reversal is not a `payroll_accrual` row.**
  `reverseEntry` writes `source = 'reversal'` and NO `source_id`, so a query
  filtering on source and period finds the accruals and never the reversals —
  `openLaborAccrual` said "still accrued" forever and the period could not be
  re-locked. The only link back is `reverses_entry_id`. Both the code and
  `tests/time-labor-posting.test.ts` now say so out loud.
- **Posting is OFF by default** (`time_settings.posts_labor`), because a
  business that keeps hours for scheduling and does its books elsewhere would
  rightly call journal entries it never asked for a bug. Turning it back off is
  refused **while an accrual is STANDING**, not once anything has ever posted:
  refusing on history would make it a one-way door for anybody who tried it and
  changed their mind.
- **CONTRACTOR HOURS TO A BILL ARE NOT BUILT**, and are recorded as 6b rather
  than pushed silently. A contractor is not an employee: their hours are a
  payable to a vendor, not a wage, and expressing that needs a kind on
  `time_workers`, a vendor link, and the bill machinery through a wider Layer 0
  door than this one. It is a slice, not a corner of this one.
- Verified: 20 new pure tests in `time-posting`, 11 db-backed in
  `time-labor-posting`, 39 isolation, lint, `tsc` and the build green. `0315`
  applied to dev AND prod, both at 187 tables with RLS clean.
- **Driven on Hilltop Farm, end to end.** Turned the switch on, locked
  Sep 6–12 and got `$99.12` — `6450` $60.00 Beef + $24.00 Unattributed, `6500`
  $10.80 + $4.32, `2300` credit $99.12, debits and credits equal. **The P&L
  split by enterprise then showed Beef carrying $60.00 of wages and $10.80 of
  on-costs**, which is the whole reason slices 4–6 exist. Unlocked it: a
  `reversal` entry posted for the same $99.12 and both accounts vanished from
  the P&L. Re-locked: a second accrual posted on a fresh idempotency key.

### 2026-09-12 — Slice 5: what it costs (`claude/time-5-what-it-costs`)

`time_rates`, the gross-pay arithmetic in `core/pay.ts`, and the first
owners-only table in this module. Migrations `0313`/`0314`.

- **THE REGULAR RATE IS NOT THE BASE RATE**, and `core/pay.ts` exists to get
  that right. Overtime is paid on straight-time pay ÷ hours worked — a WEIGHTED
  AVERAGE when somebody worked at two rates that week. Twenty hours at $20 and
  twenty at $30 is $1,000 over forty hours, so the overtime rate is **$25**,
  neither $20 nor $30. And the premium is HALF that on top of straight time
  already paid, not 1.5× the rate: every worked hour is paid once, overtime
  hours get an extra 0.5, double time an extra 1.0. `hours × 1.5 × rate` is
  wrong QUIETLY — it gives the right answer for everybody on a single rate,
  which is why it survives in so many systems. There is a test asserting the two
  agree in exactly that case, and diverge in the other.
- **Gross is the sum of four rounded parts**, not a rounded sum, so straight
  time + overtime premium + double-time premium + leave always equals the figure
  on the screen. A reader who adds the components up must not find a cent
  missing.
- **Paid leave never touches the regular rate.** It is not hours worked, so it
  neither raises nor dilutes the average; it is paid at its own rate and added
  at the end. Same family of error as counting it toward the 40 — and `pay.ts`
  gets it right for the same reason `overtime.ts` does: `countsAsWorked` is one
  predicate, asked in both places.
- **Burden is a COST, never pay.** `payForWeek` has no burden argument at all,
  which is the guarantee rather than a convention: an employer's tax cannot
  reach an employee's gross by mistake. `costWithBurden` is a separate function
  for the separate question, and it is slice 6's input.
- **A change of pay is a new row.** Effective-dated, like `retainer_allotments`
  and retail's pricing: overwriting would restate every week already worked.
  `rateOnDate` returns nothing before the history begins rather than projecting
  today's wage backwards over work done before it was agreed, and `payForWeek`
  reports that as `incomplete` instead of quietly paying zero.
- **`time_rates` IS OWNERS-ONLY IN RLS**, the first table here that is not
  member-wide. `app_current_tenant_role() = 'owner'` in the policy, the shape
  the Documents module's owners-only folders use. Two consequences: `withTenant`
  defaults to `staff`, so a caller that forgets `{ role }` sees an empty table
  rather than the wage bill — failing closed — and a superadmin in a live
  support view resolves as `staff`, so support sees the hours and never the
  wages, which falls out of back-office slice 4 rather than needing a rule here.
- **An empty rate read means EITHER "there are none" OR "not for you"**, and
  nothing downstream tries to tell them apart: both are "no figure to show", so
  the money column is simply absent for a reader who may not see it. Six
  isolation tests prove the policy, including that a staff context can neither
  read a rate nor write one.
- **The approval snapshot now freezes the money too.** Rates are effective-dated,
  so a rate added later with a backdated start would otherwise silently restate
  a period somebody has already been paid for. `gross_cents` is deliberately NOT
  inside the `time_sheets_snapshot_with_approval` CHECK: null is legitimate for
  a business that keeps no rates, and tying it to `approved_at` would refuse
  that business an approval. The drive shows both cases — Marta's sheet froze at
  `8400`, Sam's (approved in slice 3, before rates existed) is `null`.
- **Meal-break premiums are NOT built**, and `time_breaks` with them — deferred
  with no slice number rather than pushed to the next one. A missed meal break
  is an hour's pay under California's rules, and detecting one needs break
  records, which nothing captures. With no break data, "no meal break taken" is
  indistinguishable from "this business does not record breaks", so the rule
  would fire on every long shift ever logged and be wrong for everyone. It
  arrives with break capture or not at all.
- Verified: 22 new pure tests in `time-pay`, 39 isolation tests, the rest of the
  suites, lint, `tsc` and the build green. `0313`/`0314` applied to dev AND
  prod, both confirmed with `inspect-migration-state.ts` reporting no pending
  migration; 187 tables each side, RLS clean.
- **Driven on Hilltop Farm**: set Marta Quinn to $24.00/hr from 2026-09-01 with
  18% on-costs, and her 3h 30m read **$84.00** — not $99.12, because the
  on-costs are a cost and not pay. Approved it and confirmed `gross_cents = 8400`
  froze on the sheet.

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

Entries for slices 0–3 and the design-system sweep are in
[time-build-log.md](time-build-log.md) — moved there on 2026-09-12 to keep this
file readable. Everything from them that still binds a future change lives in
**Decisions & gotchas** below.

## Data model

**Built** rows are live (`0300`, `0301`, dev and prod). The rest are the plan's
shape and arrive with the slice that reads them. Every table takes `tenant_id`,
FORCE RLS, a `--custom` policy migration and isolation coverage
(`docs/security.md` §4).

| Table | Slice | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- | --- |
| `time_workers` | **Built** | A person the business keeps hours for | Detail row on `parties` (kind `person`), the `crm_party_details` pattern. Unique on `(tenant_id, party_id)`; **partial** unique on `(tenant_id, clerk_user_id)` where not null. `pin_hash` (scrypt, deliberately NOT unique — a PIN does not identify on its own), `pin_failed_count` and `pin_failed_at` arrived in slice 7; the lockout is derived from the last two and never stored. No `entity_id`: wages post to the default company. No exempt flag — exemption is a test about duties, not a rate |
| `time_entries` | **Built** | The payable fact | Minutes, never decimal hours. Business day (`date`, string mode), `pay_type`, note, `entered_by_clerk_user_id`, `punch_id`, `source`, `amends_entry_id` (composite self-FK, NO ACTION), version. Composite FKs to `time_workers` (cascade) and `time_punches` (**SET NULL, column-list form**). Partial unique on `(tenant_id, punch_id)` — one entry per punch. CHECKs: minutes > 0, minutes ≤ 1440, `pay_type` and `source` each in their closed set. The target arrives in slice 4 |
| `time_settings` | **Built** | One row per tenant, created lazily | `week_starts_on` (0–6), `rounding_minutes` (0, 5, 6, 10, 15, 30), `pay_frequency`, `period_anchor` and `overtime_ruleset`, all CHECKed, plus a CHECK that an anchor can exist only on a biweekly payroll. The ruleset is a SLUG naming a data file, never a set of thresholds. `posts_labor` (slice 6) decides whether locking a period writes a journal entry — FALSE by default, and refused going back to false while an accrual is standing. A missing row means the defaults, decided in the read rather than by a backfill |
| `time_punches` | **Built** | Raw clock evidence | `timestamptz` in/out, who pressed each button, note, version. Composite FK to `time_workers`. Partial unique on `(tenant_id, worker_id) WHERE ended_at IS NULL` — one open punch, enforced by Postgres. CHECK `ended_at > started_at`. Slice 7 added `client_ref` (minted by the DEVICE before the network, partial unique per tenant — what makes a retry a no-op) and `device_label` (free text, a label and never an identity). **No coordinates**: dropped, not deferred — see the slice 7 entry |
| `time_periods` | **Built** | The LOCK on a pay period, and what a labor accrual points at (`journal_entries.source_id`) | `starts_on`/`ends_on` stored (they must survive a change of pay frequency), `locked_at` + `locked_by`, CHECKed to arrive and leave together. A row exists once the period has been locked at least once; `locked_at is null` is open. No status column — there are two states and a timestamp says which, plus when |
| `time_sheets` | **Built** | One worker's period, submitted then approved | A row exists once submitted; `approved_at is null` means waiting. The five totals plus `ruleset_slug` are the SNAPSHOT and are null until approval, CHECKed to arrive with it. Unique on `(tenant, worker, period_starts_on)`. Period dates stored, not referenced |
| `time_entry_dimensions` | **Built** | What the hour was for | `entry_id` + denormalized `dimension_type` + `member_id`. Unique on `(tenant, entry, dimension_type)` so one member per kind; three-column FK to `dimension_members (tenant_id, dimension_type, id)` so the stated kind is the member's real one. Cascades from the entry; NO ACTION on the member, which is retired rather than deleted |
| `time_rates` | **Built** | Effective-dated pay | `pay_rate_cents` (the wage, and the only input to gross), `bill_rate_cents` (nullable), `burden_percent` (0–200, a COST and never pay), `effective_on`. Unique on `(tenant, worker, effective_on)`. **The only owners-only table in the module**: its policy carries `app_current_tenant_role() = 'owner'` |
| `time_breaks` | — | Meal and rest periods | Child of a punch. Paid flag, kind. **Deferred with no slice number**: a meal premium needs break records, and with none captured "no break taken" is indistinguishable from "we do not record breaks", so the rule would fire on every long shift. Arrives with break capture |

## Key files & seams

Built in slice 0:

- `src/db/schema/time.ts` — the module's tables, re-exported by the barrel
- `src/modules/time/TimeModule.tsx` — the week, at `/dashboard/m/time`
- `src/app/dashboard/m/time/people/page.tsx` — who the business keeps hours for
- `src/app/dashboard/m/time/pay/page.tsx` — one pay period, shown as its weeks
- `src/modules/time/components/clock.tsx` — the running-clock panel
- `src/modules/time/core/` — the pure half, so it bundles to the browser:
  `duration.ts` (parse, format, decimal), `pay-types.ts` (the closed set and
  `countsAsWorked`), `rounding.ts` (nearest-only rounding and the long-punch
  threshold), `overtime.ts` (**the evaluator**), `rulesets.ts` (federal,
  California, none, as data), `periods.ts` (pay-period arithmetic and the
  straddle rule), `pay.ts` (**the regular rate, the premiums and gross**),
  `allocate.ts` (largest-remainder apportionment — what splits a week's pay
  across the things it was spent on without losing a cent), `pin.ts` (what a PIN
  is, what a weak one is, and when a lockout expires), `errors.ts` (`TimeError`, `roleMayWrite`,
  `roleMayManageWorkers`), `week.ts` (the weekday names and the strip's labels
  — the ARITHMETIC is `@/lib/timezone`'s)
- `src/modules/time/read.ts`, `worker-ops.ts`, `entry-ops.ts`, `punch-ops.ts`,
  `settings-ops.ts`, `sheet-ops.ts`, `rate-ops.ts` — one writer per table, each taking the
  caller's `tx`. `sheet-ops.ts` also holds `assertPeriodOpen`, the guard every
  write path calls, and `firstOpenDay`, which decides where a correction lands
- `src/lib/dimensions.ts` — the SHARED dimension read, in Layer 0 because a
  second core module may not import accounting's
- **`src/lib/labor-posting.ts`** — the matching WRITE, and the only place this
  module reaches the ledger. Resolves the three payroll accounts and the default
  entity, posts, reverses, and answers "is an accrual still standing"
- `src/modules/time/posting-ops.ts` — a locked period turned into posting lines:
  approved sheets only, the approved gross, split by dimension set
- `src/modules/time/export-ops.ts` — the payroll CSV. The one place in Time
  where minutes become decimal hours
- `src/modules/time/pin-ops.ts` — setting a PIN and punching with one. Kept
  apart from `punch-ops.ts` so the ordinary panel can never acquire a PIN check
  and the keypad can never skip one: two doors, two functions, not one with a
  flag
- `src/modules/time/attention/source.ts` — timesheets waiting to be approved,
  registered third in `src/lib/attention-sources/registry.ts`
- `src/modules/time/components/sheet-controls.tsx` — submit, approve, lock
- `src/modules/time/components/rate-controls.tsx` — set a rate, remove a rate,
  and the one place dollars in a box become cents in the database
- `src/modules/time/components/export-controls.tsx` — the payroll download
- `src/modules/time/components/kiosk.tsx` — THE SHARED DEVICE, at
  `/dashboard/m/time/clock`. Names, a keypad, one button both ways
- `src/modules/time/components/pin-controls.tsx` — give, change and remove a
  PIN, and let somebody back in early
- `src/modules/time/actions.ts` — gate → Zod → `withTenant` → revalidate. Two
  gates: `gate()` for writing time, `ownerGate()` for changing who the workers
  are
- `tests/time-pin-ops.test.ts` (13, DB-backed — **the lockout, because counting
  a failure is a write that has to survive the failure**),
- `tests/time-pin.test.ts` (11 — what a PIN is and when the lock opens),
- `tests/time-labor-posting.test.ts` (11, DB-backed — the accrual, the balance,
  the reversal and the CSV; listed in `tests/db-backed-files.ts`),
- `tests/time-posting.test.ts` (20 — the apportionment, and that nothing is
  lost),
- `tests/time-overtime.test.ts` (34 — the evaluator and the periods),
  `tests/time-pay.test.ts` (22 — the regular rate, the weighted average and the
  ways of getting overtime pay wrong), `tests/time-core.test.ts` (49),
  `tests/isolation/time.test.ts` (39, six of them on the rates policy), and the
  calendar arithmetic this module leans on in `tests/timezone.test.ts`
- `docs/help/time/` — `overview.md`, `week.md`, `pay-period.md`, `people.md`,
  `shared-clock.md`

Planned, with the slice that brings them:

- `src/lib/time/` — the verbs, so anything may log an hour without importing the
  module (§4b's arrangement) — **unscheduled**: slice 4 passed without a second
  caller appearing, and one caller does not need a seam
- `src/lib/time-targets/` — the declared slot: types, registry, resolve —
  **unscheduled**, and slice 4 says why: `dimension_members` answered the
  question the slot was invented for
- `src/modules/time/setup/source.ts`, `paste/target.ts`, `tell/source.ts` —
  the remaining fillers. **Unscheduled**: slice 7 was named for the phone and
  built the phone; three extension-point fillers riding along would have made it
  unreviewable, and none of them is about a barn

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
- **A rate is not a secret, but it is close**, and since slice 5 the database
  says so: `time_rates` carries `app_current_tenant_role() = 'owner'`, the shape
  the Documents module's owners-only folders use. Read it with
  `withTenant(..., { role: ctx.role })` and never with a role that did not come
  from `requireTenant()`.
- **A CREDENTIAL FAILURE MUST NOT THROW.** Counting it is a WRITE, and
  `withTenant`'s transaction discards every write when the callback throws — so
  a thrown "wrong PIN" silently rolls back the counter that makes the lockout
  work, and the test still passes. Return a result; let the action turn it into
  a message. This cost a round in slice 7 and would have shipped as "the lockout
  does nothing".
- **A REVERSAL IS NOT A `payroll_accrual` ROW.** `reverseEntry` writes
  `source = 'reversal'` with no `source_id` at all, so any "has this period been
  reversed" question answered by filtering on source and period is answered
  WRONG, silently, forever. The only link back is `reverses_entry_id`. This cost
  a debugging round in slice 6 and has a test of its own.
- **Time may not import accounting.** `MODULE_SLUGS` binds this directory, and
  it binds `import type` as well. The ledger write goes through
  `src/lib/labor-posting.ts` and the dimension read through
  `src/lib/dimensions.ts`; if a third thing is needed, it goes to Layer 0 too —
  never by widening the eslint rule.
- **Only approved hours are a liability.** Nothing else in this module may post,
  and an unapproved sheet in a locked period is REPORTED rather than included or
  dropped.
- **`hours × 1.5 × rate` is the wrong formula and it looks right.** It agrees
  with the correct one for everybody on a single rate, which is exactly why it
  survives everywhere. Overtime is 0.5 × the REGULAR RATE — a weighted average
  over the workweek — on top of straight time already paid.
  `tests/time-pay.test.ts` pins both the agreement and the divergence.
- **Burden must never reach gross.** `payForWeek` takes no burden argument at
  all; that is the guarantee, not a convention. Cost is `costWithBurden`'s
  question and it is asked somewhere else.
- **Ask what reading a secret would GAIN somebody before hiding it.**
  `pin_hash` is on a member-wide table and `time_rates` is owners-only, and both
  are right: a signed-in member can already clock anybody in, so the PIN hides
  nothing from them, while a wage genuinely is theirs not to see.
- **`withTenant` defaults to `staff`, and on `time_rates` that is load-bearing.**
  A read that forgets `{ role: ctx.role }` returns nothing, which is the right
  failure. Never "fix" such a read by widening the default.

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
  everybody; a per-person exempt flag belongs on `time_workers`. Slice 5 was
  supposed to bring it and did not: exemption is a test about duties and salary
  basis, not a rate, and guessing it from a wage would be worse than leaving the
  business to say so. Unscheduled, and waiting for somebody who needs it.
- **Rates are whole cents per hour**, so $15.375 is not expressible. Right for a
  wage, wrong for a blended or piece rate — revisit when slice 9's piece rate
  arrives.
- **The shared clock is not OFFLINE.** `client_ref` is in, so writing is
  idempotent and a retry is safe; what is missing is a service worker to cache
  the shell and a durable queue to flush on reconnect. `docs/modules/retail.md`
  has already costed all three and says a service worker changes caching for
  every page, so it is Layer 0 work with its own ADR — not something a module
  slice may add.
- **Nothing stops a PIN being lent out.** No photo, no fingerprint, no location.
  That is the honest limit of a keypad and the guide says so.
- **A location stamp on a punch was dropped, not deferred.** Redundant on a
  shared device and employee surveillance on a personal phone; it is a founder's
  decision, not a slice's.
- **Contractor hours still become wages — slice 6b.** A subcontractor paid by
  the hour is a payable to a vendor, not a payroll accrual. It needs a kind on
  `time_workers`, a vendor link on it, and a wider Layer 0 door (bills, not just
  entries). Named and unbuilt, deliberately.
- **Wages post to the DEFAULT entity only.** One company employs everybody, as
  far as Time is concerned. A tenant whose second company has its own payroll
  needs a per-worker entity, which is a real change and nobody has asked.
- **Nothing relieves `2300` from inside Time.** The payroll provider's run is
  entered as a bill or a bank transaction the ordinary way, which works but is
  unguided — there is no "match this run to these accruals" screen the way
  `2060` has one in production/inventory. The next thing to want.
- **Burden uses the rate in force on the period's LAST DAY.** A business that
  changed its on-cost percentage mid-period gets the later one. Defensible — it
  is the current policy, and burden is an estimate — but it is a choice.
- **No salary, bonus, shift differential or on-call pay.** Non-discretionary
  bonuses and differentials belong IN the regular rate, which is why
  `payForWeek` takes earnings rather than one rate: they can be added without
  reshaping it.
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
- **Nothing warns before a backdated rate re-prices an open period.** Saving one
  silently changes every unapproved week after its date. Approved periods are
  safe — that is what `gross_cents` on the sheet is for — but the screen should
  say how many weeks moved, and it does not.
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
