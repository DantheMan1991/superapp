# 0071. A job's schedule is its phases as items on the business's calendar, and a move pushes what follows

- **Status:** Accepted
- **Date:** 2026-09-15
- **Deciders:** founder, with the `jobs` pack's schedule slice as the forcing case

## Context

The construction plan's fourteen rows never listed a schedule, and every
builder lives by one: site work, foundation, framing, roof, each with the
days it takes and the trade doing it, the inspections between, and the
question the whole office asks — *when is the tile setter coming, and
what moves if the slab slips a week?* Every product in the trade leads
with it.

The core Scheduling module exists and its dossier anticipated exactly
this: "a trade pack's Gantt-style view, dependency edges and progress
fields all land in `src/packs/`, and nothing in `src/modules/scheduling/`
changes to accommodate them." Its extension seam (slice 6: item kinds,
item fields, managed calendars) was deferred "with the first real pack in
hand". This is that pack.

Three questions were open: **where a phase's dates live**, **what a
dependency does**, and **what the pack owns**.

## Decision

**CORE OWNS THE DATES.** A phase is an all-day item on a business-owned
*Job schedule* calendar — made once per business through the same
managed-calendar seam Marketing's Bookings calendar uses, generalised for
its second layer (`ensureExtensionCalendar`), shared with everyone at
write — titled "24-109 · Framing" and linked to the project. Its first and
last day are the item's `starts_at` and `ends_at`, in the tenant's zone,
and nowhere else. That is what puts every job's phases on the company
calendar, the week and month views and the phone feed with no work of
their own, and it means the pack writes dates through the scheduling
module's own verbs, which check the calendar is writable the way they
check it for anybody.

**THE PACK OWNS WHAT A CALENDAR DOES NOT KNOW.** `job_phases` holds one row
per item: the name, phase or milestone, planned / underway / done, the
predecessor and its lag, the trade doing it (a party), the cost code, the
notes, the order. Its Gantt is the pack's page, drawn from the same items.

**FINISH-TO-START WITH A LAG, AND A MOVE PUSHES WHAT FOLLOWS.** A phase
may not start before the day after its predecessor's last day plus the
lag (negative for an overlap: the painter starts two days before the trim
is finished). Moving a phase later pushes its successors, each keeping its
length, until every one starts no earlier than it may; **nothing is ever
pulled earlier**, because a gap the business left is theirs to close. A
loop is refused, a phase may not follow itself, and a phase placed before
its predecessor allows is refused with the day it may start. One kind of
dependency and calendar days, not working days, for the first cut: the
trade's schedules are mostly finish-to-start, and a working-day calendar
is a real thing that wants its own decision.

**A project is now something the platform can point at.** The jobs pack
contributes an entity-link provider — the first layer beneath the core
modules to — so a calendar item, an email or a work item can be attached
to "24-109 · Miller barn conversion" and open it. The phase items use it.

**Kept by whoever runs the job.** Create, move, mark done and remove are
member-wide, like the daily log; the RLS matches. One exception the
scheduling module imposes: a business-owned calendar is made only by an
owner, so the *Job schedule* calendar is made by the first owner to open
a schedule or add a phase, and a staff member adding a phase before that
is told to ask an owner rather than shown a policy refusal
(`SCHEDULE_NOT_MADE`).

## Consequences

- One table, `job_phases`, with a composite key to `schedule_items`
  (cascade: a phase without its item is nothing), to the project
  (cascade), to itself (no action; the verb re-points successors before a
  phase is removed), to the party and the cost code (no action). CHECKs on
  kind, status, the lag (within a year) and self-reference. One phase per
  item.
- The arithmetic — inclusive days, the earliest start, the cycle check,
  the cascade, the sentence — is one pure module, `schedule-math.ts`,
  pinned in the pure suite.
- Removing a phase cancels its item rather than deleting it, the
  scheduling module's own convention; the pack's list reads only
  uncancelled items.
- `src/lib/schedule/managed-calendars.ts` gained `ExtensionCalendarSpec`,
  `findExtensionCalendarId` and `ensureExtensionCalendar`; Marketing's two
  functions delegate to them. Nothing in `src/modules/scheduling/`
  changed.
- **Not built, on purpose:** working-day calendars and holidays, a
  baseline to measure slip against, start-to-start and other dependency
  kinds, telling the trade (the phase's party has an email; the digest
  and Mail are the seams), weather days from the daily log, and a
  schedule template that seeds a new job. Each is a slice of its own once
  a real job has been run against this one.

## Alternatives considered

- **Dates on the pack's table, mirrored to the calendar.** Rejected: two
  copies of a date is how one drifts, and the calendar is the surface the
  field reads.
- **A phase as a Work item.** Rejected: a work item is a thing to tick,
  not a span with a trade and a predecessor, and the punch list already
  owns that meaning.
- **Pulling successors earlier when a phase moves earlier.** Rejected:
  slack a business left in the schedule is a decision, not an error.
