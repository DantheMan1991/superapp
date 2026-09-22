# 0109 — A line is measured from where it is priced, and what stands behind it follows it across sheets

- **Date:** 2026-09-22
- **Status:** Accepted
- **Affects:** Layer 2a — the `jobs` pack: the estimate editor, the sheet viewer, the takeoff (ADR 0074) and the walk's measuring dialog (ADR 0100)

## Context

The takeoff shipped the other way round from every product the trade uses.
Bluebeam, PlanSwift, STACK: you say what you are pricing, then you draw — on
as many sheets as it takes — and the figure lands on that item. Here you
drew first, on one sheet, and then *Takeoff* pushed that sheet's traces onto
a line. Two things followed, both found in the founder's improvement pass of
2026-09-22:

- **Nothing on the estimate could open a drawing.** The editor had *Paste a
  takeoff*, *Add an assembly* and *From the model*, and no ruler; an
  estimator sitting on the flooring line had to leave for the Drawings tab,
  find the sheet, trace, and push back. The walk had a *Measure it on a
  drawing* button since X7 because the founder asked for exactly this —
  *"I need the takeoff tool to get that a lot of the time"* — and the
  estimate, where the number actually goes, did not.
- **A line could not span sheets.** The dialog offered only the sheet's own
  traces, and a push is a statement of the whole set behind the line (ADR
  0074), so pushing the upstairs floor from A-102 silently REPLACED the
  downstairs figure from A-101. On a two-storey house that is every
  flooring, drywall and paint line.

Meanwhile the estimate never said where a quantity came from. The reverse
link — from a line back to the sheets that fed it — had been an open item
since 9c.

Underneath, the pieces were already there: `pushTakeoff` accepted markups
from several sheets, each measurement already carried `estimate_line_id`
and (since the fix the same day) its own share of what it pushed, and the
walk's dialog already put the real `SheetViewer` in a dialog and handed a
number back to whoever asked.

## Decision

**A line is measured from where it is priced.** Every estimate line a
drawing can measure — `lf`, `sf`, `ea`, their spellings, or no unit yet —
carries a ruler. It opens the job's sheets FOR that line: each sheet says
what already stands behind the line there, and inside a sheet every trace of
the line's kind carries a tick. A trace drawn in there stands behind the
line the moment it is saved. A lump sum (`ls`, `cy`, `sy`) gets no ruler:
no drawing yields those, and a ruler that guessed would be the wrong number
with a confident face.

**What stands behind a line is a set of traces on any of the job's sheets,
and the line's quantity is their total.** The dialog adds the set up across
sheets — *A-101 59 sf + A-102 412 sf = 471 sf* — and *Use* commits the set.
A push from the sheet page states the whole set too, as it always did, but
now the dialog LISTS the line's traces on other sheets, ticked, so the
statement keeps them unless somebody unticks a sheet.

**The claim writes the link and nothing else.** `standBehind` sets
`estimate_line_id` and each trace's own share and unlinks the line's others;
it does not touch the line's quantity or the estimate's version. The editor
holds the estimate (ADR 0082) and sets the quantity itself from what comes
back — exactly as it appends what *Add an assembly* and *From the model*
return — and a blank unit takes the measurement's. A second writer of a line
while the editor is open is the disagreement ADR 0082 exists to prevent.

**The reverse link is read, never stored.** `measurementsBehind` derives,
per line and per sheet, what stands behind it: the traces, what they pushed,
what they come to today, whether any has drifted, and whether the sheet is
the current issue. The line shows the sheets as a chip under its
description, the detail in its expansion, and *line differs* when the typed
quantity has moved away from what was measured. Nothing is stored twice, so
the estimate cannot disagree with the drawings.

**A save hands the editor the ids it minted.** Until now the editor posted a
new line with no id on every autosave, `saveLines` deleted the row it made
the time before and inserted another, and anything hanging off the old id —
a measurement standing behind it — was cut loose by its SET NULL each time
somebody typed. `updateEstimateReturning` returns the lines' ids in the
payload's order and a new item's key → id; the editor adopts them by position
and stops re-sending the row as new. This is a fix the link needed and the
estimate should always have had.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Let the dialog call `pushTakeoff`, which writes the line's quantity server-side, and tell the editor the new version | Two writers of one line while the editor is open. An autosave in flight lands on a moved version and is refused, or lands first and puts the old quantity back — the disagreement ADR 0082 was written to end. |
| Store the sheets behind a line on the line (a `basis` value and a `basis_detail` of sheet numbers) | A second copy of a fact the markups already hold, wrong the moment a trace is rubbed out or a sheet is superseded. Read it instead; the chip can never disagree with the drawings. |
| Make a push from one sheet replace only THAT sheet's share and keep the others | Changes ADR 0074's rule — a push states the whole set — into one with an exception nobody can see from the dialog. Listing the other sheets' traces ticked keeps the rule and shows the set. |
| A ruler on every line, disabled with a reason on a lump sum | A disabled control shows no tooltip on touch and reads as broken. A line no drawing can measure simply has no ruler; the guide says why. |
| A second viewer, cut down, inside the estimate | The mistake X7 refused for the same reason: `SheetViewer` is a thousand lines of pdf.js, scale and geometry, and a copy is a second thing to keep right. It took one new mode and one callback. |

## Consequences

- The estimate line gains a ruler beside its bin (the last track grew from
  34px to 64px to hold both), a chip naming the sheets behind it, and a
  *From the drawings* block in its expansion. `MeasureLineDialog` is the
  drawings opened for a line; the walk's dialog is unchanged in behaviour and
  gained the same `onChanged` re-read, which also fixed a trace drawn inside
  it never appearing in its own list.
- `SheetViewer` gained a `forLine` mode and an `onChanged` callback; the
  sheet page's *Takeoff* dialog lists a line's traces on other sheets, ticked.
- No migration: the link and the share were already columns; everything new
  is read from them.
- **Cost:** the sheets list in the dialog and the sheet page's Takeoff dialog
  each read `measurementsBehind`, one query over the estimate's linked traces
  plus the job's sheets; fine at the scale of a job, and the estimate page
  pays it once.
- **Not built, on purpose:** the walk opening a sheet FOR a phase's line
  (the walk's measure-up is a fact about the building, ADR 0100, not a line);
  a trace shared by two lines (a wall's length behind both the plate and the
  baseboard — today it stands behind one); openings, perimeters and volumes,
  which are the next slice.

## Notes

The lesson of the pass that led here is the one the pack keeps teaching:
the code treated one of its own artefacts — one sheet — as the whole truth,
and the tests, which set up one sheet, could not see it. The new ops
scenario sets up two.
