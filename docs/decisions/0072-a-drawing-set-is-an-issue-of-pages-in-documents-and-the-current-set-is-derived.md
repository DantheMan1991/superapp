# 0072. A drawing set is an issue of pages in Documents, a sheet is a page with a number, and the current set is derived

- **Status:** Accepted
- **Date:** 2026-09-15
- **Deciders:** founder, with the `jobs` pack's drawings slice (construction plan row 9) as the forcing case

## Context

Every kind of builder the construction profile serves wants the drawings —
the plan's four-flavour matrix gives `drawings` four solid marks, the last
pack with four marks not yet built — and every one of them lives the same
day: a PDF arrives from the architect (forty pages in one file, or forty
files), sheets are numbered A-101, S-201, E-101 in the title block, a
bulletin or an ASI later reissues three of them, and the question on the
site is *which A-102 is the current one?*

The Documents module already holds most of what that needs: a file with
versions, a PDF drawn page by page onto a canvas by pdf.js without ever
being framed (`pdf-canvas.tsx`), an open `doc_kind` taxonomy the dossier
reserved for exactly `drawing`, share links that follow the current bytes,
and the attachment seam every pack hangs a file on a record with. Its
dossier deferred "real drawing comparison" and markups to "an industry
pack" and said a drawing's superseded revisions are internal.

Three questions were open: **what a sheet is**, **where the current set
lives**, and **who reads the title blocks**.

## Decision

**THE FILE IS DOCUMENTS'; THE PACK KEEPS WHAT THE CABINET DOES NOT KNOW.**
A set (`job_drawing_sets`) is an *issue* of drawings for a job — the permit
set, the construction set, ASI 3, addendum 2 — with a name, the date on
the drawings and, when the business keeps them as a party, who issued it.
Its PDFs are ordinary cabinet documents, registered through the shared
attach seam with `doc_kind = 'drawing'`, hung on the set through
`document_attachments` the way a lien waiver's signed copy hangs on the
waiver. A sheet (`job_sheets`) is one page of one of those files with the
number the trade calls it by, normalised on write (`a-101` is `A-101`), a
title and a revision mark, once per set. A full reissue and a two-sheet
bulletin are the same row with different page counts.

**THE CURRENT SET IS DERIVED, NEVER STORED.** For each sheet number the
job has ever had, the issue from the newest set — by `issued_on`, then by
which set was made later — is current and every other issue of that
number is superseded by it (`currentIssues` in `drawings-math.ts`). No
flag has to be moved from the old A-102 to the new one when a bulletin
arrives, because there is no flag; removing the bulletin makes the
previous issue current again by the same arithmetic. Superseded sheets
are kept, listed, and open with a plain note and a link to the current
one — the record is the point of keeping drawings.

**THE BROWSER READS THE TITLE BLOCKS; THE SERVER STORES WHAT WAS
CONFIRMED.** The bytes are already in the browser — the file the person
just picked, or one fetch of a cabinet file — so pdf.js reads every page's
text there, in viewport space so a rotated landscape sheet still has its
corner where the eye sees it, and a pure rule (`guessSheet`) proposes the
sheet number as the number-shaped line nearest the bottom-right corner —
where every convention puts it, and where a cover sheet's index of forty
numbers is not — and the title as the largest other line in that corner
that is not a label, a date or a scale. The person corrects the table and
ticks which pages are sheets; the server validates shape and uniqueness
and stores the rows. A scanned set has no text: the thumbnails are there
to read the numbers off, and nothing pretends otherwise.

**GROUPED BY THE CONVENTION, NEVER REFUSED BY IT.** The discipline a sheet
groups under is read from its number's first letter by the US National CAD
Standard's designators (G, C, S, A, M, E, …) and never stored; a number
the convention does not know groups under *Other*. Sheet numbers are free
text, because a builder who numbers sheets 1 to 12 is not wrong.

**KEPT BY WHOEVER RUNS THE JOB.** Sets and sheets are `member` writes, as
the schedule is; the two file doors ask the cabinet's own write rule as
well, exactly as a day's photos do, so an accountant may read the set and
may not upload into it.

## Consequences

- Every job has a Drawings page: the current set grouped by discipline
  with a card per sheet, the sets newest first with their files and
  counts, the superseded issues; and a sheet page that draws the page
  large with zoom, walks the current set sheet by sheet, and lists every
  issue of the number.
- A set that came as one file per sheet is added one file at a time from
  the set's row; each file is read into its pages.
- Deleting a file in Documents deletes its sheets (a page of a file that is
  gone is nothing to open); deleting a set lets go of its files, which stay
  in the cabinet. Replacing a file's bytes in Documents changes what the
  sheet shows, since the sheet points at the document and not at a version;
  a set is an issue and a replaced file is a new issue's job, which the page
  says.
- `registerAttachedFile` takes an optional `docKind`, so a pack that knows
  what a file IS can say so at registration; `loadPdfjs` is exported from
  the cabinet's canvas so the second reader of a PDF configures the one
  worker.
- Not built, on purpose, each a slice of its own once a real set has been
  read: markups (clouds, arrows, pins raising a punch item) stored as
  vectors over a sheet (9b); a scale set on a sheet and lengths and areas
  measured, pushed onto an estimate line as the takeoff (9c); comparing two
  issues of a sheet by overlay; reading the cover sheet's index to fill
  titles; a per-job Drawings folder in the cabinet.

## Alternatives considered

- **A sheet as its own document, split from the set's PDF on the server.**
  Splitting a forty-page, hundred-megabyte set server-side and keeping
  forty blobs makes the cabinet's version history mean "a sheet's
  revisions" — attractive — but it doubles storage, puts a PDF parser on
  the request path, and breaks the one thing the office does every time,
  which is open the set as the architect sent it. A sheet as (file, page)
  keeps the file whole and costs one small table.
- **A stored `is_current` flag on the sheet.** Set by whichever code ran
  last; wrong the first time a bulletin is deleted or a set's date is
  corrected. Derived from the dates it cannot be wrong.
- **Server-side title block reading through the cabinet's text extractor.**
  The extractor already opens PDFs for search, but it flattens pages to
  text with no positions, and the person has to confirm the table anyway;
  the browser has the bytes, the positions and the thumbnails.
- **A discipline column typed by the office.** Nobody types "Architectural"
  forty times; the letter says it, and the one case it cannot (`12`) is
  filed under Other rather than asked about.
