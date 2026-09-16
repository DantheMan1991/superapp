# 0074. A measurement is a markup with a quantity, the scale is the sheet's, and a takeoff is a quantity pushed onto an estimate line

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** founder, with the `jobs` pack's drawings slice 9c as the forcing case

## Context

The drawings slices put every sheet on a screen ([ADR 0072](0072-a-drawing-set-is-an-issue-of-pages-in-documents-and-the-current-set-is-derived.md))
and let a crew draw on it ([ADR 0073](0073-a-markup-is-a-vector-on-a-sheets-issue-and-a-pin-is-a-punch-item-where-it-sits.md)),
and the estimating slice's open items had said since its first day that "a
takeoff from the drawings" was a real thing the trade has. An estimator
starts from the plans: the square feet of a floor, the linear feet of a
wall, how many recessed cans — and then the unit prices do the rest. Every
takeoff product measures on the sheet against a scale; what differs is
where the scale comes from, what a measurement is stored as, and how a
quantity reaches the bid.

Three questions were open: **what a scale is and whose it is**, **what a
measurement is**, and **what a push does to the estimate**.

## Decision

**THE SCALE IS THE SHEET'S, AS PAGE POINTS PER UNIT OF THE WORLD, WITH THE
PAGE'S SIZE BESIDE IT.** `job_sheets` carries `scale_points_per_unit`, the
unit (feet or metres), and the page's width and height in points at the
time it was set. A measurement is stored as fractions of the page
([ADR 0073](0073-a-markup-is-a-vector-on-a-sheets-issue-and-a-pin-is-a-punch-item-where-it-sits.md)),
and fractions of a landscape page are not the same length across as down,
so the four numbers together let the server turn a measurement into feet
without opening the PDF, and the viewer measure the same way. Setting the
scale again corrects every length and area on the sheet at once, because
none of them stores a quantity.

**A KNOWN DIMENSION FIRST, THE TITLE BLOCK SECOND.** The guide leads with
two taps on a dimension the drawing states and the length typed, because
that is right on a half-size plot and on a sheet somebody printed to fit;
the standard scales (`1/4" = 1'-0"`, `1" = 20'`, `1:100`) are offered as
points per unit *when the PDF is the sheet's own size*, and the dialog
says so. The scale a sheet ends up with is shown as the standard it
matches when it matches one within a hair.

**A MEASUREMENT IS A MARKUP WITH POINTS.** Three more kinds on
`job_sheet_markups` — `length` (a polyline), `area` (a polygon by the
shoelace, either way round), `count` (taps) — with `{points: [...]}` as
fractions of the page. A count needs no scale; a length or an area without
one reads *needs the scale* rather than a number. The quantity is derived
every time it is read.

**A PUSH IS A STATEMENT, NOT AN INCREMENT.** Pushing measurements onto an
estimate line — one kind of thing at a time, two floors add up and a floor
and a wall do not — sets the line's quantity to the total, in thousandths,
in the unit the trade prices by (`lf`, `sf`, `ea`; `m`, `m2`), on an
existing line or a new one; an accepted estimate refuses, because its
quantities are the agreement. Each measurement remembers the line
(`estimate_line_id`, SET NULL in the column-list form) and the quantity it
pushed, so the page can say when the drawing has been measured since; a
measurement left out of a later push to the same line no longer stands
behind it. The line keeps its quantity whatever happens to the drawing:
the estimate is edited where it lives.

**A RE-READ KEEPS THE SHEET'S ROW.** 9a replaced a file's sheet rows on
re-reading, which was harmless while nothing hung off a sheet; 9b hung
markups off it and 9c a scale. `indexSheets` now updates the row of a
page read again, inserts a page new to the reading, and deletes only a
page left out.

## Consequences

- The sheet page grows three measuring tools, a *Set the scale* button
  that names the scale once set, live quantities on the sheet and in the
  list, a *Takeoff* on every measurement, and a chip on a pushed
  measurement naming the estimate, the line and the quantity, with
  *measured since* when the drawing has moved on.
- Two migrations: `0365_job_takeoff.sql` (the scale on the sheet, the
  kinds, the line key) and `0366_job_sheets_scale_whole.sql`, which
  re-states the whole-scale CHECK with `coalesce`: a CHECK that evaluates
  to NULL passes, so `null > 0` had let a scale with no page size through.
  The isolation suite found it.
- Not built, on purpose: a scale from the PDF's own metadata, a measurement
  edited point by point (rub it out and draw again), deducting an opening
  from an area, a volume, a running total across sheets, and the reverse
  link from an estimate line back to the sheets that fed it — each a slice
  once a real set has been measured.

## Alternatives considered

- **Store the quantity on the measurement.** Then a corrected scale leaves
  every quantity wrong until each is re-measured, and two numbers can
  disagree. Derived from four numbers it cannot.
- **A scale in fractions of the page.** A fraction across is not a fraction
  down; page points are the same in both directions.
- **Add to the line on each push.** A second push of the same floor would
  double the flooring; a push that states the total cannot.
- **A separate `job_measurements` table.** The viewer, the list, the
  colour, the words, the cascades and the author are the markup's already;
  three more kinds cost one CHECK.
