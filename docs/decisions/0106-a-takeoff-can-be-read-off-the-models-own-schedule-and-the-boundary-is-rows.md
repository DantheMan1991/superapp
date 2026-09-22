# 0106 — A takeoff can be read off the model's own schedule, and the boundary is rows

- **Date:** 2026-09-21
- **Status:** Accepted
- **Affects:** Layer 2a — the `jobs` pack, the estimate interview (X14). Feeds [0100](0100-a-measurement-is-a-fact-about-the-building-not-an-answer-to-a-question.md)'s measurements and [0101](0101-a-room-is-a-name-a-floor-and-an-area-and-one-answer-is-shared-out-across-them.md)'s rooms; sits beside [0074](0074-a-measurement-is-a-markup-with-a-quantity-the-scale-is-the-sheets-and-a-takeoff-is-a-quantity-pushed-onto-an-estimate-line.md)'s takeoff from a drawing.

## Context

The founder's first answer, on the first day of the estimate interview, to
*how do quantities reach a bid at your shop*:

> **They draw in Revit.**

Every number the measure-up asks for — the perimeter, the roof area, the
rooms and what each one measures — is in the model before anybody opens a
PDF. The dossier had said since X1 that this *"turns the takeoff from a
measurement into a join"*, and nothing had been built. Meanwhile the pilot's
own data on the dev branch, after a complete walked bid, read: three
building measurements typed, eleven rooms pasted with eleven areas typed, and
the takeoff dialog opened once. Typing numbers that a model already holds is
where a good part of the forty-five minutes goes.

Three shapes were possible: read the `.rvt` (proprietary; impossible without
Autodesk's own libraries), read an IFC export (a STEP file of tens of
megabytes whose quantities are optional and whose reader is a project of its
own), or read the **schedule export** every Revit user already knows —
*File → Export → Reports → Schedule*, a delimited text file with the
schedule's title on its first line and a unit symbol on every figure. Every
other modelling tool exports the same kind of table.

## Decision

**A schedule exported from the model is read as a table, and the boundary
is rows.** `bim-schedule.ts` turns the text into a `Schedule` — title,
headers, rows with the group heading each sat under, footers counted and
set aside — and everything after that point knows nothing about Revit: the
columns' kinds, the room list, the suggestions and the figures are read off
the table. An IFC reader, or one for a spreadsheet somebody typed, produces
the same table and inherits everything downstream. **The pack must never
carry one vendor's file format past its first function**, for the same
reason it carries no business's price list.

**It lands on what X7 and X8 built, not beside it.** A room list becomes
rooms through `addRoomList`; a column's figure becomes a measurement through
`recordMeasurement`. Both are marked `source = 'schedule'` — a fourth value
on the CHECK, migration 0417 — with a note naming the schedule, the column
and the rows, because *a figure you cannot trace is a figure nobody will
defend*, and the screen shows a table icon where a traced figure shows a
ruler.

**A column can honestly offer three things, and nothing else.** Its total;
the figure every row shares, when every row shares one (a wall height, a
ceiling); and the count of rows, for a measurement that is a count. A room
number parses as a figure and its total means nothing, so columns headed
*Number*, *Mark*, *Level* and the like are never offered. A column with no
unit in the file is offered and says so, exactly as typing the number would.

**The words are a suggestion, never a decision.** A measurement is proposed
for a column when every significant word of its name appears in the
schedule's title or the column's header — *Roof area* under *Area* in a
*Roof Schedule*, *Wall height* under *Unconnected Height* in a *Wall
Schedule* — and never across dimensions. *Wall perimeter* is NOT proposed
for *Length*, because the pack does not know those are the same thing and
will not pretend to. The person picks; the suggestion saves the click when
the words already agree.

**A unit the file states is converted only within its dimension.** Metres
into feet, square metres into square feet, cubic feet into cubic yards. A
length handed to an area is refused by name — *Roof area wants an area and
Length holds a length* — because a wrong measurement multiplies through
every line that reads it ([0100](0100-a-measurement-is-a-fact-about-the-building-not-an-answer-to-a-question.md)).
An outline unit the pack does not know (*squares*, *boxes*) cannot be
converted to, so it refuses a stated unit and passes a bare number.

**The model is not in this path.** Deterministic parsing that fails loudly,
the rule the cost code import set and the measurements kept.

**The walk carries on from wherever it stood, through the continuations a
typed answer uses.** Mid measure-up, `afterMeasuring` asks for the next
figure the file did not hold, then the rooms, then the usual, then opens the
first phase. On the rooms question with rooms just added, the question is
answered. Anywhere else, the numbers are on the building and the screen
reads them. There is no second state machine.

**Nothing refused is refused quietly.** A choice that cannot be written is
returned by name with the reason, because a measurement somebody thought
they had imported is the walk asking for it again ten minutes later with no
idea why.

## Consequences

- The measure-up gains a *From the model* button beside *Measure it on a
  drawing* and beside the room list, and a small one in the side panel once
  the measure-up is over — a second estimate on a re-drawn house is one file
  away from right.
- The file is decoded in the browser only to become text: Revit writes
  UTF-16, and read as UTF-8 that is a NUL between every letter and a parser
  that finds nothing, which looks exactly like *this tool does not work*.
  The server reads the text for the preview and again for the write, and
  honours only choices; nothing the browser holds describes a row.
- Two rooms with one name on one floor are one room to
  [0101](0101-a-room-is-a-name-a-floor-and-an-area-and-one-answer-is-shared-out-across-them.md),
  so the second is told apart by its number rather than lost. A room marked
  *Not Placed* or *Redundant* in the model is left out and named; *Not
  Enclosed* is a room with no area.
- Revit's *Grand total* line and the footer under each group are found and
  set aside before anything is added up — including the footer that carries
  only figures under blank word cells, which needs the columns known first
  and is why `readColumns` classifies twice.
- The migration widens a CHECK. It is backward compatible and was applied to
  both databases before the merge, and `tests/jobs-bim-schedule-ops.test.ts`
  is the one place that proves a `schedule` row is accepted — CI applies
  every migration from zero and cannot tell.

## Alternatives considered

**Read the IFC.** The industry's exchange format, and the right second
reader; the wrong first one. Its quantities are an optional export, its
files are large, and a reader is weeks of work before the first number lands
— when the schedule export is one click in a tool the founder opens every
day. The boundary at rows is what makes it a later reader and not a rewrite.

**A model reading the file.** It would read `Kitchen | 310 SF` correctly and
it would also read `1,234` as `1.234` one time in a hundred, into a number
that multiplies through the bid. The founder's own bar is that a plausible
wrong number is worse than a refusal.

**Join type names to assemblies, as the dossier first described it.** The
end state, and premature: the pilot's library holds one assembly, so there
is nothing to join against, and the key — Revit's type name, its Uniformat
assembly code, a keynote — is a decision that wants a library to test it on.
Rows are the boundary so that join is a consumer of the same table.

**Remember which column answered which measurement, per tenant.** The second
import of the same schedule would then be zero clicks. Worth doing once a
real second import has happened; a table and a migration for a mapping
nobody has made yet is the fluff the founder asked this layer never to
carry.

**Write the figure under the column's own name when the outline has no
measurement for it.** It would put *Wall Schedule: Length* into every
prompt of every walk on the job. What to measure is the outline's list
([0100](0100-a-measurement-is-a-fact-about-the-building-not-an-answer-to-a-question.md)),
and the outline page is where the list grows.
