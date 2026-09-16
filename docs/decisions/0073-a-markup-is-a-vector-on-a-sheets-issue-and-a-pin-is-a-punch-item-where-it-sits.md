# 0073. A markup is a vector on a sheet's issue, and a pin is a punch item where it sits

- **Status:** Accepted
- **Date:** 2026-09-15
- **Deciders:** founder, with the `jobs` pack's drawings slice 9b as the forcing case

## Context

The drawings slice ([ADR 0072](0072-a-drawing-set-is-an-issue-of-pages-in-documents-and-the-current-set-is-derived.md))
put every sheet of a job on a screen, and the Documents dossier's first line
had promised "construction drawings with mark-ups and measurements". The
reason a crew opens a plan app at all is to draw on the plan: cloud what
changed, point an arrow at it, write a note, and pin the thing that needs
fixing so it is on the punch list before anybody has walked back to the
truck. Every product in the trade has the four tools; what differs is what
they do to the file and where the pin goes.

Three questions were open: **what a markup is stored as**, **what a pin
is**, and **which issue a markup belongs to**.

## Decision

**A MARKUP IS A VECTOR IN FRACTIONS OF THE PAGE, AND THE PDF IS NEVER
TOUCHED.** `job_sheet_markups` holds a cloud (`{x, y, w, h}`), an arrow
(`{x1, y1, x2, y2}`), a note or a pin (`{x, y}`) as fractions of the page's
width and height — 0 at the left or top edge, 1 at the right or bottom —
with a colour from the five pens a site has and, for a note or a pin, its
words. The sheet's page is drawn by pdf.js onto a canvas as before and the
markups are an SVG laid over it in the page's own units, so a cloud drawn
on a phone at 3× lands on the same footing as one drawn on a desk at 1×,
strokes keep two screen pixels at any zoom, and the file in the cabinet is
the file the architect sent. Burning the markups into a new PDF is a
rendering the day somebody wants to send one, not the record.

**A PIN IS A PUNCH ITEM WHERE IT SITS.** Placing a pin with *Put it on the
punch list* ticked calls the same `addPunchItem` the job's panel calls, so
the item is an ordinary Work item linked to the job — assigned, dated,
chased in the digest, ticked on the job's punch list — and the pin remembers
it in `work_item_id`. The key to `work_items` **sets null** rather than
cascading, in the column-list form the mail links established (a bare SET
NULL cannot run on a composite key): a punch item cleared from Work leaves
the pin as a note, and a pin rubbed out leaves the punch item on the list,
because the site still owes it. Done on the list is done on the sheet, read
live from the item; the pin's own words are its own after the item is
raised, because the item is edited where it lives.

**A MARKUP BELONGS TO ONE ISSUE.** The row hangs off `job_sheets`, which is
one issue of a sheet, and cascades with it: a reissued sheet starts clean,
and the earlier issue's markups stay where they were drawn, listed on the
sheet's page beside the issue they are on. Carrying a markup forward onto
the new issue is a judgement — the cloud may have been about the very thing
the reissue fixed — and is not done for anybody.

**THE SHAPE IS CHECKED IN WORDS ON BOTH SIDES.** `parseGeometry` is pure
and shared: the viewer never sends what it would refuse, and the server
refuses in a sentence what a client might.

## Consequences

- The sheet page grows a toolbar — move about, cloud, arrow, note, pin, five
  colours — and a list of what is drawn with who drew it, when, and each
  pin's punch item as it stands, with the tick to close it. Two fingers
  pinch, one drags the sheet about, ctrl+wheel zooms; a cloud drawn at any
  zoom is stored the same.
- The canvas is drawn at device resolution up to a pixel cap, which 9a's
  viewer lacked: a 6× page at two device pixels per CSS pixel was seventy
  million pixels.
- Not built, on purpose: moving or resizing a markup after the fact (rub it
  out and draw again), a freehand pen, carrying markups onto a reissue, a
  markup on a photo, burning markups into a PDF to send, and telling the
  pinned trade — the digest and Mail are the seams.

## Alternatives considered

- **Store markups as an annotated PDF.** Every tool would then have to
  rewrite a hundred-megabyte file for a pin, the cabinet's version history
  would fill with annotation saves, and a pin could not be a Work item.
- **A pin as its own row with its own status.** A second punch list, on the
  drawing, that the job's punch list and the digest do not see. The pin is
  a place; the item is the work.
- **Cascade the pin with its punch item.** Clearing a mistaken item from
  Work would erase a note on the drawing that somebody may still need.
- **Coordinates in page points.** They would not survive the sheet being
  re-rendered at another size, and a rotated page's points are not its
  screen's. Fractions of the viewport-space page are the same on every
  screen.
