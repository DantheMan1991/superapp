# 0101 — A room is a name, a floor and an area, and one answer is shared out across them

- **Date:** 2026-09-21
- **Status:** Accepted
- **Affects:** Layer 2a — the `jobs` pack, the estimate interview (X8). Extends [0100](0100-a-measurement-is-a-fact-about-the-building-not-an-answer-to-a-question.md); uses the takeoff of [0074](0074-a-measurement-is-a-markup-with-a-quantity-the-scale-is-the-sheets-and-a-takeoff-is-a-quantity-pushed-onto-an-estimate-line.md).

## Context

The founder, after the measure-up shipped:

> *"along with the takeoff measurements at the start, you should identify the
> rooms on every floor. probably do the area takeoff and label the room.
> Maybe AI can scan for room names and there is a drop down for each room
> area where you can select the room... Then the estimate questions can start
> asking questions like what type of flooring in Master bedroom or what type
> of shower in master bathroom."*

And, asked what a room actually has to carry:

> *"the only reason i said we should measure each room is we need to know
> flooring sq footage."*

Two things already in the pack said he was right. `job_selections.location`
is a free-text field whose own comment reads *"The room or area, as the
business says it: 'Master bath'"* — the pack has needed rooms since slice 9
and has been faking them with a string nobody can group by, filter on or
check for completeness. And X7's measurements are per-BUILDING, so the walk
could say *"2,400 square feet"* and never *"62 square feet in the master
bath"* — which is the number that actually prices tile.

## Decision

**A room is a name, a floor and a floor area.** Not a rich object. Every
attribute is a box somebody has to fill, and fifteen rooms times five
attributes is the same trap as fifteen questions moved to a different screen.
What was asked for was flooring square footage; that is what a room carries.

**Its area is a `job_measurements` row scoped to the room**, not a column on
`job_rooms`. That is the whole reason X7's measurements were built the way
they were: a room's area is then read by the parser that reads `24 x 40` and
`38'-6"`, traced with the same *Measure it on a drawing* dialog, and carries
the same sheet-and-markup provenance — instead of three hundred lines of the
same machinery written again. It also means **a room's WALL area, when
somebody eventually wants one for paint, is a row rather than a migration.**

**A room is unique per FLOOR, not per building.** A house has a `Bathroom`
upstairs and a `Bathroom` on the main floor, and a tool that refused the
second one would be wrong about houses.

**ONE ANSWER IS SHARED OUT ACROSS THE ROOMS.** This is the decision the
feature lives or dies on. Fifteen rooms times five finish categories is
seventy-five questions, and the target is a bid in forty-five minutes — the
obvious reading of "ask about each room" would have made the tool
dramatically worse. So the walk asks *"what flooring is going where?"* once,
says back which room gets what for correction, and **names the rooms the
answer did not cover** rather than leaving them silently unpriced. The
proposal has the matching rule one layer down: a finish that varies by room
is **one line per finish** with the rooms named and their areas added up in
`derivedFrom` — fifteen flooring lines is a bill of materials, not an
estimate.

**The list arrives whole.** A paste box, one room a line, an area after a
tab, a comma or a wide gap — but **not after a single space**, because
`Master bedroom` would otherwise become a room called `Master`. A line
ending in a colon is a floor and sticks until the next one, which is how
anybody writes a room list by hand. A line whose area cannot be read keeps
the room and leaves the number blank: the name is the valuable half, and
dropping the line would make somebody hunt for what went missing.

**The rooms are asked for at the end of the measure-up**, stamped with
`rooms_asked_at` when the question is PUT. "Asked and waiting" and "not asked
yet" are otherwise the same three nulls, and the walk would ask twice or
never.

## Consequences

- `askNextMeasure` no longer stamps `measured_at`. It used to, and **the
  rooms question was never asked on a building that had already been
  measured** — a second estimate on the same job went straight to its first
  phase. Deciding the measure-up is over belongs to the caller, which knows
  the rooms are still owed. Found by driving it, not by a test.
- `job_measurements` gained two PARTIAL unique indexes in place of one: keyed
  on the project `WHERE room_id IS NULL`, keyed on the room where it is not.
  A plain unique index over the nullable column would treat every
  building-level NULL as distinct and let them duplicate silently. `ON
  CONFLICT` then has to name which index it means, which is why
  `recordMeasurement` reads as two cases.
- `MeasureOnADrawing` takes what to do with the number as a prop instead of
  writing to the walk. Without that, a room's area would have needed a second
  copy of the sheet picker, the viewer and the dialog.
- **A room type was considered and rejected.** A `bathroom` flag would tell
  the walk to ask about a shower — but *Master bath* already does, the walk
  reads the names, and a taxonomy is a thing the tenant maintains that would
  have been wrong for commercial the day it shipped.
- Nothing yet reads rooms from a drawing's text. `getTextContent()` is
  already in the codebase and returns text WITH POSITIONS, so the room labels
  on a CAD-produced PDF are a parser rather than a model — the next slice,
  and deliberately not this one.

## Alternatives considered

**A room per question.** The literal reading of the ask, and the version that
would have made the walk unusable. The rooms are DATA the questions use, not
a multiplier on how many there are.

**Asking a model to read the room names off the sheet.** The founder's own
suggestion, and the wrong tool: a CAD-produced PDF already contains the text
and its coordinates. A model earns its place expanding `MSTR BR` and `W.I.C.`,
not reading what is machine-readable.

**An area column on `job_rooms`.** Simpler to look at and a duplicate of
everything X7 built — its own parser, its own provenance, its own dialog —
and a second column the first time a room needed a second number.
