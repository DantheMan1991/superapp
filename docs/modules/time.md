# Time

> What actually happened: who worked, for how long, on what, and what it cost.
> A clock and a timesheet for people who may not have a login, a workweek that
> knows the difference between overtime and a pay period, and an hour that
> reaches the P&L tagged with the thing it was spent on. Core owns the
> mechanism; an industry layer supplies the vocabulary and the odd pay rule.
> Status: planned — nothing built; slice order below · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

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

### 2026-09-11 — The plan (`claude/time-tracking-plan`)

Design session with the founder. Nothing built; this file is the agreed shape
and the slice order. The four decisions taken are recorded above with their
reasoning. Grounded in a read of `retainer.ts`, `professional-services.ts`,
`platform.ts`, `parties.ts`, `work.ts`, `ledger.ts`,
`src/lib/dimension-options.ts`, `src/lib/attention-sources/types.ts` and
`docs/extension-model.md`.

## Data model

Proposed, not built. Every table takes `tenant_id`, FORCE RLS, a `--custom`
policy migration and isolation coverage (`docs/security.md` §4).

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `time_workers` | A person who can log time | Detail row on `parties` (kind `person`), the `crm_party_details` pattern. Nullable `profile_id`, nullable PIN hash, `entity_id`, pay basis, exempt flag |
| `time_punches` | Raw clock evidence | `timestamptz` in/out, device, coordinates, client id **unique per tenant** for idempotent offline sync. Partial unique index on `(tenant_id, worker_id) WHERE ended_at IS NULL` — one open punch, enforced by Postgres |
| `time_entries` | The payable fact | Minutes, business day (`date`, string mode), pay type, target, optional `punch_id`, source, `entered_by`, version. CHECK minutes > 0 |
| `time_entry_dimensions` | What the hour was for | The `dimension_members` link, so the P&L splits labor with no report code. Composite FK on `(tenant_id, …)` like every other referencing table |
| `time_breaks` | Meal and rest periods | Child of a punch. Paid flag, kind. Needed for premium rules, queryable rather than jsonb |
| `time_settings` | One row per tenant | Workweek start day and hour, pay frequency, period anchor, rounding policy, overtime ruleset slug, auto-deduct policy |
| `time_periods` | Materialised pay periods | Status open / closed / paid, `locked_at`. Rows rather than computed, because approval state needs somewhere to live |
| `time_rates` | Effective-dated pay | Cost rate, bill rate, burden percent, effective from. A change is a new row |
| `time_sheets` | Worker × period | submitted / approved / locked, actors and timestamps, **totals snapshot** |

## Key files & seams

Planned.

- `src/modules/time/` — renderer, actions, core
- `src/modules/time/core/rules/` — the pure evaluator and the ruleset data files
  (`federal`, `california`, `8-80`, `none`)
- `src/lib/time/` — the verbs, so anything may log an hour without importing the
  module (§4b's arrangement)
- `src/lib/time-targets/` — the declared slot: types, registry, resolve
- `src/modules/time/attention/source.ts`, `setup/source.ts`, `paste/target.ts`,
  `tell/source.ts` — the four fillers
- `docs/help/time/overview.md` — the guide, from `docs/help/_TEMPLATE.md`, with
  `**Route:** /dashboard/m/time/**`, from slice 0

## Decisions & gotchas

Written before the build so they are not rediscovered.

- **A punch is an instant; a day is a calendar fact.** Store `timestamptz`,
  derive the business day in `tenants.timezone`, never subtract two dates. A
  span crossing midnight belongs to the day it **started**, configurable, and
  the choice is recorded rather than assumed.
- **DST breaks the 168-hour assumption twice a year.** A workweek anchored at
  Sunday 00:00 local is 167 or 169 hours on two weekends. Compute week
  boundaries in the tenant zone; do not add `7 * 24 * 60 * 60 * 1000`.
- **Never fabricate a clock-out.** An open punch past a threshold raises an
  attention item and is closed by a person. An auto-close that silently invents
  hours is a payroll error with a paper trail pointing at us.
- **Leave never counts toward 40.** The single most common bug in this domain;
  it is prevented by the pay type existing in slice 2, not by care.
- **The rounded number is never the only number.** Raw punch retained forever,
  the policy applied on the way to the entry, and both visible on screen.
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
  payment; Time stops at gross. Next free number is 0046.
- Whether `time` or `timekeeping` is the slug. `time` matches the one-word house
  style (Mail, Work, Documents, Scheduling); `timekeeping` is unambiguous in
  code. Recorded here so it is decided once.
- Accrual and carryover for paid leave is deferred past slice 9. Pay types make
  leave *expressible* from slice 2; a balance that earns itself is its own
  feature.
- Scheduled versus actual — comparing a `schedule_items` assignment against the
  hours worked — is real and not planned. It needs scheduling's pack seams
  (slices 6/7 there, deferred for want of an implementor).
