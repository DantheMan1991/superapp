# 0110 — A trace yields the figures the trade derives from it, and each can stand behind a line of its own

- **Date:** 2026-09-22
- **Status:** Accepted
- **Affects:** Layer 2a — the `jobs` pack: the takeoff (ADR 0074), the line measured from where it is priced (ADR 0109), `job_sheet_markups` and a new `job_estimate_line_traces`

## Context

A trace on a sheet came to ONE number: a length its feet, an area its
square feet, a count its taps. The trade never stops there. A room traced
once is the flooring by its area, the baseboard by the run around it, the
ceiling by its area again and the paint by the run times the height; a
wall's length with a height is the drywall; a plan area at a pitch is the
roof; a slab area at a depth is the concrete by the yard; and every area
has openings the estimator takes back out. Step 3 of the founder's
improvement pass, agreed by mockup, asked for exactly these: an opening cut
out, the perimeter, wall area from length and height, pitch, volume.

Two things stood in the way. The arithmetic was one number per trace, with
nowhere to keep a height, a pitch or a depth. And the link from a trace to
an estimate line lived ON the trace (`estimate_line_id`, one per markup),
so one trace could stand behind one line: the room behind the flooring OR
the baseboard, never both. A trace that yields five figures and can lend
only one of them defeats the point — the estimator would trace the room
five times.

## Decision

**What the trade types onto a trace is kept on it, as typed, and every
figure is worked out when read.** `job_sheet_markups.figures` is one jsonb:
`{ height: { value, unit } }` on a length, `{ pitch: { rise } }`, `{ depth: {
value, unit } }` and `{ deducts: [[points]] }` on an area, in the unit typed
(`9 ft`, `4 in`, `100 mm`), parsed tolerantly on both sides by
`parseFigures` — a part it does not recognise is dropped, never guessed at.
Nothing derived is stored: `yieldsOf` works every figure out through the
sheet's scale on every read, so a scale set again corrects the wall, the
roof and the volume exactly as it corrects the area.

**A trace yields a list of figures, each with its working.** An area yields
its NET area (the openings taken out — "412 sq ft less 21 sq ft in 1
opening"), the run around it, and with a pitch or a depth the roof it
pitches to and the volume it fills; a length yields its length and, with a
height, the wall it stands; a count yields its count. Every figure belongs
to a FAMILY — a perimeter is a length, a wall and a roof are areas, a volume
is its own — and a line's unit calls for a family: `sf` an area, `lf` a
length, `ea` a count, `cy` or `m3` a volume. A `cy` line gets its ruler
back.

**Each figure of a trace can stand behind a line of its own.** The link
moves off the markup into `job_estimate_line_traces`: one row per (line,
trace, figure) with the share that figure came to when it was pushed, unique
per tenant on the three, cascading from the line and from the trace. The
room's area stands behind the flooring while its perimeter stands behind
the baseboard and its volume behind the slab; the reverse link
(`measurementsBehind`), the sheet's chips and the Measure dialog all read by
figure. A push or a claim names `(markupId, figure)` pairs; the old
id-only shape still means the trace's own figure. The two columns the link
lived in stay on `job_sheet_markups`, unwritten and unread, until a later
migration drops them (a drop goes out after its deploy); the migration that
made the table copied every existing link into it.

**A figure a trace does not yield is refused by name**, never guessed: *North
wall cannot stand as a volume: only an area fills a volume*; *Bedroom 2
cannot stand as a wall: only a length stands a wall*; *it has no depth
typed on it*. Same-family conversion between spellings of one unit still
holds (ADR 0074's fix); a `cy` line takes a volume figure and nothing else.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Store the derived quantities on the trace (wall area, roof area, volume as columns) | Then a corrected scale leaves every one wrong until each is re-typed, and two numbers can disagree — the exact reason ADR 0074 refused to store a measurement's quantity. Derived from the points, the scale and what was typed, they cannot. |
| Keep the link on the markup and let one trace be pushed several times by re-drawing it | Five traces of one room for five lines is the takeoff product nobody wants; and the copies drift apart the first time one is fixed. One trace, several figures, several links. |
| Height, pitch and depth as columns in thousandths of the sheet's unit | A 4-inch depth is 333.33 thousandths of a foot: the estimator's own number is gone the moment it is stored, and the working could no longer read "× 4 in". Kept as typed, in the unit typed, and converted when read. |
| Geometric clipping of an opening against its area | Correct in principle and costly in practice; an opening the estimator traces inside a room is inside it, and one traced outside is the estimator's to fix. The net is the plain difference, clamped at nothing. |
| Perimeter as a separate trace kind ("run") | It is a fact about the area the room already is, and a separate trace would have to be kept in step with it. A yield, not a kind. |

## Consequences

- One migration in two files: `0421` (the `figures` column, the table, its
  FKs and indexes, the CHECKs) and `0422` (RLS, and every existing link
  copied across). Applied to dev and prod before the merge; the isolation
  suite gained the table.
- A trace's row reads its figures beside its own: *around it 39 ft · as a
  roof 100.4 sq ft · as a volume 1.1 cy*, each with its working on hover; an
  area with openings draws them as holes and reads net. The Edit dialog
  carries the height, pitch and depth; *Cut an opening* is a tool on an
  area's row. The Takeoff dialog asks *What goes* when a trace yields more
  than one figure, lists every figure on the sheet of that family, and a
  line can carry several links per trace. The Measure dialog offers every
  figure of the line's family with a tick.
- **Cost:** `listMarkups` runs a second query for the links; the sheet page
  and the reverse link read `job_estimate_line_traces` where they read a
  column; every consumer of the trace's link had to learn a list where it
  held one.
- **Not built, on purpose:** clipping an opening to its area; a pitch in
  degrees; a wall's height per trace when a room's walls differ (type the
  common one, split the trace where they do not); openings on a length; and
  the DROP of `estimate_line_id` / `pushed_quantity_thousandths`, which
  follows in its own migration once this has deployed.

## Notes

The two defects of the same day (ADR 0074's fix, PR #663) came from a link
that held one figure per trace; this ADR is what that link was really for.
The figures are typed on the trace once and follow it everywhere — a
scale corrected, a line re-measured, a sheet reissued — because none of
them is a number until it is read.
