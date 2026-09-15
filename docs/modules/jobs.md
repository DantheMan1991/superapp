# Jobs (capability pack)

> Projects with a number and a cost code list, each one a **cost object** every
> bill and every hour can be charged to. The spine the whole construction family
> hangs off, the way `inventory`'s lot is the spine of the farm one — and, like
> every pack, industry-blind: the word "construction" appears nowhere in it.
> Status: `available` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

Listed by the `construction` profile ([construction.md](construction.md)), which
is the industry that forced it. Nothing here is construction-shaped: a project
has a number, a client, a company, a division and a kind of work, and a fit-out,
a software engagement and a house are the same row.

## Build log

### 2026-09-15 — The project page becomes a place with sections (`claude/jobs-project-page`)

One job was **eleven `<Panel>`s stacked flat with no in-page navigation**, so
reaching the job cost table meant scrolling past four other tables, and the five
pages already split off (Schedule, Selections, Field, Estimates, Drawings) each
redrew their own back link and their own `<PageHeader>` — five copies of the
same six lines, already drifting. Jobs redesign `2a`, from the same Claude
Design handoff as the list.

**THE JOB'S IDENTITY IS NOW A LAYOUT** (`[id]/layout.tsx`): the back link, a
`<PageHeader>` with the pack's `HardHat` and the job's coordinates (number ·
address · client · kind), the **vitals strip**, and the section strip. It is a
layout rather than a header each page draws so that the five figures do not
move, reload or flicker as somebody goes from Job cost to Schedule to Field —
they are the job's position, not one tab's content.

**THE VITALS STRIP MEASURES THE SAME WAY THE LIST DOES.** `vitals-ops.ts` calls
`measureProject`, the function the module home uses, so percent complete and
billed-versus-earned on a job's page are the same numbers the list showed a
click earlier. A page that re-derived them would eventually disagree, and the
reader would have no way to tell which was lying. Contract · Committed · Actual
cost · Complete · Billed vs earned, in one `rounded-xl` card whose `gap-px` over
`bg-divider` makes the gaps themselves the hairlines.

**FOUR PANELS BECAME ROUTES**, lifted unchanged: `/contracts`, `/changes`,
`/cost`, `/ordered`. Overview keeps the job's own Details and a summary of each
section that has a page of its own. Each new route reads only what its panel
renders — the contracts, commitments, change orders, cost report and compliance
reads moved out WITH their panels, so the Overview no longer pays for four
tables nobody can see.

**`contractSummary` (`contract-math.ts`) is why Contracts and Changes cannot
disagree.** `valued`, `approvedByContract`, `revisedOf`, `signedValue`,
`changesValue` and the three counts were inline in the old page, shared by being
in one file. Two pages copying that derivation is exactly how the revised value
on one screen starts differing from the other, so it is one pure function with
`tests/jobs-contract-math.test.ts` on it.

**Three traps, each of which cost a real failure here:**

- **A lucide icon is a FUNCTION, and `CategoryStrip` is a client component.**
  Building the tab array in the server layout threw *"Functions cannot be passed
  directly to Client Components"* at render — and `tsc` accepted it (`icon?:
  LucideIcon` is satisfied) and `npm run build` compiled it. The page only fails
  when something renders it. Every other module's strip is a `"use client"` nav
  component that builds its own array (`accounting-nav`, `crm-nav`,
  `documents-nav`, `inventory-nav`, `livestock-nav`); `ProjectNav` now follows
  that convention rather than inventing one.
- **Overview must be `exact`.** `CategoryStrip` matches on a path prefix
  otherwise, so the index route lights up on every tab at once. Everything else
  WANTS the prefix match — a contract at `/contracts/<id>` keeps Contracts lit.
- **Five is an odd number.** The strip's gaps are the divider showing through,
  so at two and three columns the fifth cell left a hole that rendered as a grey
  block rather than as nothing. The last cell spans the remainder until the row
  fits it exactly.

The design's own tab list was drawn before slice 9a landed and had **no
Drawings**; implementing it verbatim would have hidden a shipped feature. Added.

Driven on Hilltop Farm: all ten tabs render with the right section lit, the four
new routes included, and a contract's own record page keeps Contracts lit
underneath the job's header.

### 2026-09-15 — The list carries the money (`claude/jobs-redesign-list`)

The module home used to be seven columns whose only figure was contract
value, so the question an owner actually opens the screen with — *which job
is in trouble* — could only be answered by opening each job in turn. Every
figure needed to answer it was already computed; it was just on the WIP
schedule, which is a month-end document rather than a daily one. Built from
a Claude Design handoff (option `1b` of *Jobs Redesign*), which was itself
drawn from this repo, so it is a refactor of the existing page and not a
new one.

The page is now a `<PageHeader>` with the pack's `HardHat` on its accent
chip, four `<StatCard>`s (Under contract, Earned to date, Under-billed,
Over-billed), `<FilterPills>` + `<ListSearch>` on one row, and a
`<DataTable>` of six columns: the job, the customer and kind, complete ·
cost to date with a bar, the revised contract, billed vs earned, and status.
Nothing is a new primitive and no new token was added.

**SIX STATEMENTS FOR THE WHOLE LIST, NOT SIX PER JOB** (`list-ops.ts`).
`projectListEntries` batches `listProjectRows`, `projectValues`,
`budgetByProject`, `actualByProject`, `billedByProject` and
`ledgerTermsByProject` — every one of them grouped in the database and keyed
by project id — so a list of sixty jobs costs the same number of round trips
as a list of one. It deliberately does NOT call `wipSchedule`: that is
scoped to one company and one period end and drops rows on purpose (a
cancelled job, a job with nothing on it, a finished job whose billings have
caught up), which are the right exclusions for a schedule a bank reads and
the wrong ones for a list of what the business is building. The scope is
`combined`, never `consolidated`: eliminating intercompany legs would
quietly change what a job has cost depending on who paid the bill.

**THE LIST NEVER PRINTS A ZERO IT CANNOT DEFEND** (`list-math.ts`,
`ProjectValuation`). Three kinds of not-knowing, each a different next
action, and each said rather than rounded to zero:

- `unsigned` — nothing signed, so there is no value to be a percentage of.
  The row reads **Nothing signed** and, where there is one, the proposed
  figure, which is a number somebody can chase. A spec house accumulating
  cost against no contract is a real state, not an error.
- no estimate — `percentCompletePpm` already returns null, and the cell says
  **Not started** or **No estimate** rather than 0%, which would read as "no
  progress" when the truth is "nothing to measure against".
- `by_hours` — a time-and-materials job earns its approved hours at their
  bill rates (ADR 0062), and those hours are a query per job. The list shows
  what it honestly has and sends the reader to the WIP schedule for earned.
  **An approximate figure in a money column is worse than none.**

Under-billed and over-billed are summed separately and never netted, as
`wipTotals` has always done. The headline reads the whole book rather than
the filtered rows, so it does not move when somebody clicks a pill, and a
cancelled job is in no figure at all.

**`projectValues` GAINED `proposedCents`, ON ITS OWN INVITATION.** Its
comment had said a proposal count was deliberately absent and to add it the
day a screen wanted one; this is that day. Summed over `proposed` alone and
never added to `valueCents` — a concept the client has not signed is still
not money. `ledgerTermsByProject` was made exported from `wip-ops.ts` for
the same reason: without it a cost-plus job would be measured against a
budget it was never sold against.

**Two traps worth naming.** `TableCell` bakes in `whitespace-nowrap`, so a
`max-w-*` on a cell caps the box while the text keeps running straight
across the next column — capping a cell means `whitespace-normal` with it,
or the money silently lands under the status badge. And `--accent-jobs`
still does not exist, so the pack's accent falls through
`var(--accent-jobs, var(--accent-brand))` to the same emerald
`--accent-accounting` uses; the design flags it as a real decision and it is
deliberately left alone here, because inventing a token is a change to every
screen in the module rather than to this one.

Driven on Hilltop Farm: four jobs covering all three valuations — a unit
price job billed ahead with nothing spent, a time-and-materials job reading
By hours, a cost-plus job at its guaranteed maximum, and a fixed-price job
under-billed by $1.59m.

### 2026-09-15 — Slice 9a: the drawings (`claude/drawings`, ADR 0072)

The last pack the construction plan's four-flavour matrix gives four solid
marks that had not been built: `job_drawing_sets` and `job_sheets`, a
**Drawings** page per job (`/dashboard/m/jobs/[id]/drawings`) with the
current set grouped by discipline, a sheet page
(`/dashboard/m/jobs/[id]/drawings/[sheetId]`) that draws the page large,
and a Drawings panel on the job's page.

**THE FILE IS DOCUMENTS'.** A set is an *issue* of drawings — the permit
set, ASI 3, addendum 2 — with a name, the date on the drawings and who
issued it (a party). Its PDF is a cabinet document registered through the
shared attach seam (`registerAttachedFile`, now taking a `docKind`, here
`drawing`) and hung on the set through `document_attachments`
(`DRAWING_SET_ENTITY = "job_drawing_set"`), the way a lien waiver's signed
copy hangs on the waiver; or a PDF already in the cabinet, picked through
the cabinet's own search. A sheet is one page of one of the set's files
with the number the trade calls it by — normalised on write (`a-101` is
`A-101`), once per set, a page once per set's file — a title and a
revision mark. Nothing in the cabinet changed shape: `docKind` had been
reserved for this since the DMS was built.

**THE CURRENT SET IS DERIVED, NEVER STORED** (`drawings-math.ts`,
`currentIssues`): for each number the job has ever had, the issue from the
newest set — by `issued_on`, then by which set was made later — is
current and the rest are superseded by it. Removing a bulletin makes the
previous issue current again by the same arithmetic. `listSheets` returns
every sheet in reading order — discipline by the US National CAD
Standard's designators read off the number's first letter
(`disciplineOf`, `DISCIPLINE_ORDER`: G, C, S, A, …, Other last), then the
number naturally (`compareSheetNumbers`: A-2 before A-10, A1.2 before
A1.10), then newest issue first — with `isCurrent`, `currentId` and how
many issues the number has had. `drawingsSummary` is the panel's sentence.

**THE BROWSER READS THE TITLE BLOCKS.** `components/pdf-reading.ts` reads a
PDF where its bytes already are — the file just picked, or one fetch of a
cabinet file — through the cabinet's own `loadPdfjs` (now exported from
`pdf-canvas.tsx`, so the second reader configures the one worker): every
page's text runs in viewport space, flipped so y grows upward, so a
rotated landscape sheet keeps its corner where the eye sees it; and a
JPEG thumbnail per page (up to 150). The pure rule `guessSheet` proposes
the sheet number as the number-shaped line nearest the bottom-right
corner — where every convention puts it, and where a cover sheet's index
of forty numbers is not; a corner score under 0.9 is "no number found" —
and the title as the largest other line in that corner that is not a
label, a date or a scale, in sentence case. `A4` is a paper size and is
never a sheet. The person corrects the table, ticks which pages are
sheets, and `indexSheets` stores what was confirmed: shape and uniqueness
checked in words (`SHEET_TAKEN`: *A-101 is on page 2 and page 7*; *A-101
is already in this set, on another file's page 2*), the file proven to be
the set's and a PDF, the file's earlier reading replaced whole.

**THE SCREENS.** The Drawings page: the sentence (*42 sheets in the
current set across 5 disciplines, from 3 issues; the newest is ASI 3,
dated 2026-08-15; 4 sheets superseded*), *Add a set* — one dialog in three
steps: the set, the file (*Add a file* uploads through the cabinet's
presigned route; *From Documents* is the cabinet's search, PDFs only),
the sheets (a row per page with the thumbnail, the tick, the number, the
title and the revision, the hint saying *read off the title block*, *no
number found* or *no text on the page*) — then **Current set** as cards
grouped by discipline, **Sets** newest first with each file's name, a
link to it and how many sheets it was read into (*not read yet*, *not a
PDF*), the pencil (the set's words; *Read again* / *Read the pages*, *Let
go* per file; *Add a file* for a set that came one file per sheet;
*Remove*), and **Superseded** with what replaced each. The sheet page:
`SheetViewer` draws the page on a canvas at the panel's width times a
zoom (1× to 6×) in a box that scrolls, fetching the file once and
re-rendering from the parsed document; the sheet before and after it in
the current set; *The file*; *Edit* (the number, title, revision; *Not a
sheet* takes the page back out); a plain amber note on a superseded issue
with a link to the current one; **Issues of A-102** newest first.

**WHO.** `member`, as the schedule is — the office indexes a set the day
it arrives — and the two file doors ask the cabinet's `roleMayWrite` as
well, so an accountant reads the set and does not upload into it.

Migrations `0361_job_drawings.sql` (hand-reordered: the set's own unique
index moved ahead of the sheet's key to it, as 0359 was) and
`0362_job_drawings_rls.sql`, applied to dev and prod before the merge;
`db:verify-rls` 222 tables on both, `db:verify-modules` 19/19 on both.
Tests: `tests/jobs-drawings.test.ts` (the CHECK and unique mirrors, the
hand-reorder, the cascades, normalising, the discipline and its order,
natural sort, the number pattern against dates, scales and paper sizes,
the current set and its tie-break, the summary, run-joining, the title
block on a landscape page and on a vertical strip, no text, no number, the
paper-size trap, sentence case), one more ops scenario in
`tests/jobs-ops.test.ts` (the set, the file hung on it, every refusal in
its words, the read, the reading order, an ASI superseding one sheet, a
same-day reissue winning by creation, the summary and the sets list, a
sheet renamed and normalised, a clash, a stale edit, a file read again
replacing its sheets, a page taken out, a file let go of with the
document kept, a set removed with the earlier issue current again, the
expert as a member), one more isolation certification.

**DRIVEN on the dev branch's Hilltop Farm, job 24-109, signed in as the
owner, with a synthetic six-page permit set (landscape letter, a title
block in the bottom-right corner, a cover sheet whose index lists every
number in the middle of the page, one sheet with a vertical title strip)
and a two-page ASI, both rendered by react-pdf.** In Node first, the
reader run over the real pdf.js text of all eight pages got every number
and title right — the cover's index ignored, the vertical strip read. In
the browser: *Add a set* on the Drawings page — Permit set, dated
2026-06-01, from a party, a note — *Next: the file*; *Add a file* took
the PDF (the file input fed through a DataTransfer, since the pane has no
file chooser), the presigned upload and the attach ran, *Reading page 6
of 6…*, and the table came up with six thumbnails and *G-001 Cover
sheet, A-101 First floor plan, A-102 Second floor plan, A-104 Roof plan,
S-201 Foundation plan, E-101 Lighting plan*, each *read off the title
block*. The cover unticked, *Save 5 sheets* → *5 sheets on the job*, and
the page read *5 sheets in the current set across 3 disciplines, from 1
issue* with the cards under STRUCTURAL, ARCHITECTURAL and ELECTRICAL in
that order. A-102's page drew page 3 of the file with *A-101* and *A-104*
either side; the zoom to 2× made the canvas 1674px wide inside an 839px
box that scrolled. From the job's panel, *Add a set* again — ASI 1, dated
2026-08-15 — the two-page file read as A-102 and A-104, revision *1*
typed on both, saved; the panel caught up on its refresh to *5 sheets in
the current set from 2 issues; newest ASI 1, dated 2026-08-15, 2
superseded*, the cards carried *2 issues* and *rev 1* on A-102 and
A-104, the Superseded panel listed the permit's two with *replaced by
ASI 1 · 2026-08-15*, and the permit A-102's page showed the amber note
with *Open the current A-102* and *Issues of A-102* (ASI 1 current, this
one) and no prev/next. At 375px both pages kept to their width. **Found
by driving, fixed, guarded by a test**: on *Read again*, the cover page
that had been left out on purpose came back TICKED with its guess, so a
careless save would have made it a sheet — a page absent from a re-read's
prior index now stays out, hinted *left out before*
(`tickedByDefault`); and a read still in flight when the dialog closed
reopened it into the table, so the result is dropped when the dialog is
no longer open. Not driven: *From Documents* on a set (the picker is the
cabinet's own search, exercised in #578), *Let go* and *Remove* (the ops
suite covers both), an expert's read-only view.

### 2026-09-15 — The schedule (`claude/job-schedule`, ADR 0071)

The row the construction plan never had and every builder lives by:
`job_phases`, a **Schedule** page per job (`/dashboard/m/jobs/[id]/schedule`)
with a timeline, a Schedule panel on the job's page, and every phase on the
company calendar and the phone feed — because a phase IS a calendar item.

**CORE OWNS THE DATES.** A phase is an all-day item on a business-owned
*Job schedule* calendar (`JOB_CALENDAR`: slug `jobs`, key `schedule`,
violet), made once per business through the managed-calendar seam
Marketing's Bookings calendar uses — generalised for its second layer:
`ensureExtensionCalendar` / `findExtensionCalendarId` in
`src/lib/schedule/managed-calendars.ts`, Marketing's two functions now
delegating — shared with everyone at write, titled *24-109 · Framing*, kind
`job_phase`, and linked to the project through `schedule_item_links`. The
first and last day are the item's `starts_at`/`ends_at` in the tenant's
zone and nowhere else; the pack writes them through `createItem` /
`updateItem` / `cancelItem` of the scheduling module and reads them back
with `dateInTimezone`. Nothing in `src/modules/scheduling/` changed, which
is what that module's dossier said would be true of the first trade pack.

**THE PACK OWNS WHAT A CALENDAR DOES NOT KNOW.** `job_phases` is one row per
item: name, phase or milestone, planned / underway / done, the predecessor
and its lag in days, the party doing it, the cost code, notes, order.
`schedule-ops.ts`: `ensureJobCalendar` (the calendar is made by an OWNER —
the scheduling module's write policy on a business-owned calendar — on the
first phase or the first owner opening the schedule page; a staff member
before that gets `SCHEDULE_NOT_MADE` and a sentence saying whom to ask),
`createPhase` (member; refuses a start before the
predecessor allows, with the day it may), `updatePhase` (refuses a loop
with `PHASE_CYCLE`, a self-predecessor, another job's phase; keeps the
length when only the start moves; then **pushes what follows**), `deletePhase`
(successors follow what it followed; the item is cancelled, the module's
convention), `listPhases` (soonest first, with the predecessor, the
earliest start, the party, the code, *overdue* and *late to start* as of
today), `scheduleSummary`. The arithmetic is pure in `schedule-math.ts`:
inclusive days, `earliestStart`, `wouldCycle`, `cascade` (finish-to-start,
successors pushed forward keeping their length, never pulled earlier, each
reported once at its final dates), `summarise`, `weeksCovering`.

**A PROJECT IS NOW SOMETHING THE PLATFORM CAN POINT AT.** `src/packs/jobs/links.ts`
is an `EntityLinkProvider` (slug `jobs`, type `project`) in
`src/lib/entity-links/registry.ts` — the first layer beneath the core
modules to contribute one — so the phase items resolve to "24-109 · Miller
barn conversion" with a link on the calendar, and an email or a work item
can be attached to a project from the same picker.

**THE PAGE.** A table with a timeline column: Sunday-first weeks across the
span (or today's week when the job has none), eight points to a day, a
bar per phase (planned muted, underway primary, done green, overdue
ringed red), a rotated square for a milestone, a red line for today; the
phase with its predecessor and lag and code under it, who, the dates,
the days, the status. `PhaseForm` adds and edits: name, kind, the dates
(a milestone has one), *Follows* with the lag and a live line saying the
day it may start or that it cannot, who, the cost code, the status,
notes, and Remove (armed by a second click). The toast counts the phases
that moved with a save. The job's page panel says *N phases from … to …:
done, underway, next, overdue*.

**DRIVEN on the dev branch's Hilltop Farm, job 24-109, signed in as the
owner.** *Add phase* on the job's panel — Site work, 2026-09-14 to 09-18 —
made the business's Job schedule calendar and the first item, and the
panel read *1 phase from 2026-09-14 to 2026-09-18: 0 done*. On the
schedule page: Slab after Site work, with the live line *May start from
2026-09-19, the day after Site work*; Framing after Slab with two days' lag
(*May start from 2026-09-28, the day after Slab plus 2 days*) and the feed
mill as its crew; Roof after Framing; Frame inspection as a milestone
after Roof, the Ends box gone the moment Milestone was picked. The
timeline drew five rows with Sunday-first weeks, the bars, the diamond and
today's red line, and *not started* under Site work. The slab slipped a
week through the pencil — *Phase saved — 3 later phases moved with it* —
and the page read Framing 10-05 to 10-23, Roof 10-24 to 10-28, the
inspection 10-29: the ops suite's arithmetic to the day. The company
calendar's week view carried *24-109 · Site work* across Monday to Friday
in the calendar's violet. At 375px the page kept to its width and the
table scrolled inside its panel. Three things found by driving, all
fixed: the add dialog is one instance reused for every add and kept the
last phase's crew for the next (Roof and the inspection inherited the
feed mill — every field now resets); the date cells wrapped (kept on one
line); and the page body scrolled sideways, because a pencil button's
screen-reader label is absolutely positioned and escaped the timeline's
scroll container — the Table component's wrapper is `relative` for
exactly this, and the timeline's now is too. Not driven: the phone feed
(the same query the week view reads) and a staff member's first phase
before the calendar exists (the ops suite covers the refusal).

Migrations `0359_job_phases.sql` (hand-reordered: a table that references
ITSELF needs its unique index before the constraint that points back at
it) and `0360_job_phases_rls.sql`, applied to dev and prod before the
merge; `db:verify-rls` **220 tables** on both, `db:verify-modules` 19/19.
Tests: `tests/jobs-schedule.test.ts` (the two CHECKs mirrored, the keys
and the reordering, the calendar's names; inclusive days, the earliest
start and the overlap, the weeks; a loop both ways, the push with every
length kept, nothing pulled earlier, a successor moved only as far as it
must, one pushed by two ancestors reported once; the sentence), one more
ops (the shape refused five ways; the chain laid out and a too-early
start refused with the day; the calendar made once and shared with
everyone, the item all-day and titled and linked; the list read back
through the zone with a milestone one day; a loop, a self-predecessor and
another job's phase refused; the slab slipping a week and the three
behind it moving; overdue and late-to-start as of a day; the item's
instant at New York midnight; a stale version; a rename reaching the
item's title; pulling back leaving successors; done clearing overdue;
removing re-pointing and cancelling; an accountant refused), one more
isolation (the table, its five keys, the one-item rule, the CHECKs, the
holds, the two cascades).

### 2026-09-15 — Slice 10b: the proposal (`claude/proposal`, ADR 0070)

An estimate as the document the client is sent: four columns on
`job_estimates` (migration `0358_proposal.sql`, columns and a CHECK on an
existing table, so no RLS migration), a **Proposal** block in the
estimate's editor, a *Print proposal* button there and a *Proposal* button
on every row of the estimates list, and a GET route
`/api/jobs/estimates/[id]/pdf` — three files that mirror the pay
application's printout exactly: `proposal-model.ts` (pure, every word and
figure, table-tested), `proposal-pdf.tsx` (layout only, `@react-pdf/renderer`,
the same NotoSans faces) and `proposal.ts` (rows to input, brand, bytes),
with `proposalData` in `estimating-ops.ts` reading the estimate, its
arithmetic, the job and the client in one go.

**THE PROPOSAL SHOWS PRICES, NEVER COST.** Every line prints at its price
with overhead and profit spread into it — `scheduleFromEstimate`, the same
spread the schedule of values takes — so the lines add to the total the
contract is signed at, and a line sold by the unit prints its raised unit
price. The unit cost, markup, overhead, profit and margin appear nowhere;
the pure test builds the model with the business's own words blanked and
scans it for the five words, all three ways. **Three ways to show the
price**, per estimate: line by line (quantity and per-unit columns appear
only when a line needs them), by cost code (the no-code lines as *Other*),
or one sum (no rows; *Price for the work described* on its own line). When
unit prices cannot add to the total to the cent, a *Rounding* row carries
the difference so the page adds up.

**THE WORDS LIVE ON THE ESTIMATE AND ARE FIXED WITH THE MONEY.** Scope,
exclusions and terms are three texts beside the lines, each typed line its
own paragraph on the page (so an exclusions list stays a list). They are
the agreement: an accepted estimate refuses them with its rates and lines
(`ESTIMATE_ACCEPTED`); the presentation is a printing choice and stays
free. A new estimate starts with the **terms of the newest estimate that
has any** (`lastTerms`, tenant-wide), terms given blank stay blank — the
habit of copying last time's terms, without a settings screen for one
paragraph. The client is the contract's counterparty once the estimate
names a contract, else the job's client party; Accounting's customer
address when there is one, the certificate's rule. A draft prints under
DRAFT with *Not yet sent*; declined and superseded under those words;
sent and accepted clean. Rendered on request, never stored.

**DRIVEN, in two halves.** The browser pane came up signed out, so the
first pass rendered by script — a throwaway file (never committed) that
stubs `server-only` through a tsconfig `paths` entry and calls the real
`loadProposal` → `renderProposal` path against the dev branch's Hilltop
Farm, EST-1 on 24-109 (accepted onto the cost-plus contract) with its scope,
three exclusions and three lines of terms written to the row, three
renders read back through Documents' own PDF text extractor, to the cent.
Then the founder signed in and the screens were clicked: the list's
*Proposal* button on the row; EST-1's Proposal block with the three texts
greyed and fixed and *Show the price* still live — switched to *By cost
code*, *Estimate saved*, and the row read it back; *New estimate* EST-2
landed on its editor with **EST-1's terms already in the Terms box** and
scope and exclusions blank; a scope, two exclusions, 15 / 10 / 10 and one
$18,500 line saved as *One sum*, the six figures returned from the row
(cost 18,500.00, price 21,275.00, overhead 2,127.50, profit 2,340.25,
total 25,742.75, margin 28.1%); then the route itself, fetched from the
page and shown through Chrome's viewer (the pane treats a PDF response as
a download): EST-2 under **DRAFT**, *Not yet sent*, *Valid until —*, *To —*
(the job has no client party), *Price for the work described 25,742.75*,
*Accepted for the client*; EST-1 by cost code — **03 30 00 · Cast-in-place
concrete 33,795.30 · 06 10 00 · Rough carpentry 53,240.00 · Other 2,087.25
· Total 89,122.55** — the farm's logo and green, *To Tractor Supply Co*
from the contract. One thing found by looking: EST-1's signature block
wrapped alone onto a second page by a few points, an acceptance sentence
on one page and the lines to sign on the next. The closing is now one
non-wrapping block, trimmed with the page's bottom padding, and both
proposals print on one page; a long one still carries its closing whole
onto the next.

Migration `0358_proposal.sql` applied to dev and prod before the merge;
`db:verify-rls` **219 tables** (none new) on both, `db:verify-modules`
19/19. Tests: `tests/jobs-proposal.test.ts` (the three presentations on
the estimating suites' four lines to the cent, the uncoded case, the
rounding row, the facts and their fallbacks, paragraphs, the acceptance
block and the signatures, the watermarks, the scan for the five words,
three renders to real PDF bytes), one more pure in `tests/jobs.test.ts`
(the presentation CHECK mirrored, the three text columns defaulted), one
more ops (terms copied from the last estimate and only the terms, blank
terms kept, a presentation off the list, `proposalData` naming the job's
party then the contract's counterparty, an accepted estimate refusing its
words and taking a presentation), and the isolation CHECK.

### 2026-09-15 — Slice 10: estimating (`claude/estimating`, ADR 0069)

`job_estimates` and `job_estimate_lines`, an **Estimates** page per job
(`/dashboard/m/jobs/[id]/estimates`) with a full-page editor per estimate
(`/estimates/[estimateId]`), an Estimates panel on the job's page, and
three owner verbs that make an estimate the money the pack already has —
the front end of the job, which until now was a spreadsheet typed into
the contract, the budget and the schedule of values three times over.

**COST AND PRICE ARE TWO NUMBERS ON EVERY LINE.** A line is a cost code, a
description, a quantity of a unit (blank is one — a lump sum), a **unit
cost**, an optional **markup of its own** and an optional **unit price**.
It sells at the markup on its cost — the line's or the estimate's default
— unless a unit price is typed, which wins: that is how a unit-price bid
is written. Below the lines the estimate carries **overhead** on the
subtotal and **profit** on the subtotal plus overhead (the trade's "ten
and ten"), each a rate up to 1,000% (`RATE_PPM_MAX`, CHECKed on every rate
column), each rounded once. Nothing extended is stored: `estimate-math.ts`
computes the line's cost and price, the six totals (cost, subtotal,
overhead, profit, total, margin with its ppm) and the by-code split
wherever they are shown, the change order's rule, and the markup is
applied to the *extended* cost so a line typed whole and a line typed by
the unit agree to the cent. A business that marks up its lines and stops,
one that sells at cost and takes it all below, and one that does both are
the same estimate. Several per job is ordinary — the number is unique per
(tenant, project), `job_estimates_project_number_idx`, and the action
names it — with draft / sent / accepted / declined / superseded.

**ACCEPTING NAMES THE CONTRACT AND FIXES THE ESTIMATE.** `acceptEstimate`
(owner) takes the contract on the job and the date: the estimate's total
becomes the contract's value through `updateContract` — so a *signed*
contract's value is refused with `VALUE_LOCKED` exactly as it is from the
form, unless the total already equals it to the cent, when nothing is
touched, or the signed contract has no value yet, when the total is entry
(slice 4's one exception; the dev job's cost-plus agreement, worth nothing
on paper, took its estimate that way) — the estimate keeps `contract_id`, and from then `updateEstimate`
refuses its rates, its lines and any status but accepted or superseded
(`ESTIMATE_ACCEPTED`); the title and the notes still move. A revision is a
new estimate and the old one superseded. The other two acts are separate
and deliberate, each an owner's: `applyEstimateToBudget` writes each
code's **cost** as that code's original through `setBudgetLines` (lines
with no code have nowhere to land and are returned as `uncodedCents` so
the page says so); `applyEstimateToSchedule` writes one schedule line per
estimate line at its **price** through `saveSovLines` — **with overhead and
profit spread across the lines in proportion** (`scheduleFromEstimate`,
largest-remainder rounding in `spreadCents`), so the schedule totals the
contract sum the accept set, which a G703 requires and every draw is
measured against; a line sold by the unit keeps its quantity with its unit
price raised by the same share, so a unit-price contract still bills by
the quantity, and the rounding lands on the last line priced as a sum. The
first cut wrote the lines at their bare price and the schedule came out
21% short of the contract on the test estimate — caught by reading the two
numbers side by side, before anything was driven.

**WRITING IS A MEMBER'S CHORE; MAKING IT MONEY IS AN OWNER'S.** The
estimator is rarely the owner: create, edit, send, decline and supersede
are member-wide, and the RLS is member-wide to match; accept, use as
budget and use as schedule are owner verbs, the selections split. The
editor is one client component (`estimate-editor.tsx`): the header and
its rates, a lines grid whose cost and price columns compute as you type,
the six figures, notes, Save — and, for an owner, the three dialogs, each
saying what it will replace. `NewEstimateDialog` takes a number and a
title and lands on the editor, because an estimate is too long for the
pack's one-dialog habit. The lines are written by id — updated, inserted,
removed when left out — the schedule of values' rule, so a line keeps its
identity across an edit; the editor keys the row on it.

**DRIVEN** on the dev branch's Hilltop Farm, job 24-109 (the cost-plus
barn conversion, signed, worth nothing on paper): *New estimate* from the
job's panel — EST-1, "Barn conversion, as drawn" — landed on the editor;
15 / 10 / 10 typed, four lines — 120 cy of slab at $185 on 03 30 00, framing
labour $40,000 at its own 10% on 06 10 00, 2 ton of rebar at $900 sold at
$1,200 a ton (its markup box greyed the moment the price was typed), a
$1,500 permit with no code — and the six figures computed as typed: cost
$65,500.00, price $73,655.00, overhead $7,365.50, profit $8,102.05, total
$89,122.55, margin $23,622.55 · 26.5%, the pure suite's numbers. Save, and
the by-code panel appeared ($24,000 / $27,930, $40,000 / $44,000, no code
$1,500 / $1,725). *Use as budget* — `Budget set on 2 codes — $1,500.00 on
lines with no code left out` — and the job's cost table read Budget
$64,000.00 by code. *Accept* onto the signed contract went through rather
than refusing, because the contract had no value recorded: slice 4's one
exception, entry not revision; the job's page then read *Worth $89,122.55*
and the estimate's header named the contract, its rates and lines greyed,
the Accept button gone. *Use as schedule of values* —
`Schedule written: 4 lines, $89,122.55` — the contract sum to the cent,
the cost-plus contract's page unmoved by it since that method bills cost.
The list page and the panel sentence (*1 estimate: EST-1 $89,122.55
(accepted).*) both read right. Two things found by driving: the dialogs'
"$65,500.00in all" — JSX drops the space after an expression when the text
continues on the next line, fixed with `{" "}` — and the signed-but-unvalued
contract above, which was a rule, not a bug, and is now in the guide.

Migrations `0356_estimates.sql` (hand-reordered like the eight before it:
two new tables, the estimates' unique index moved ahead of the lines' key
to it) and `0357_estimates_rls.sql`, applied to dev and prod before the
merge; `db:verify-rls` **219 tables** on both, `db:verify-modules` 19/19.
The pair was first generated as 0354/0355 on a branch cut before slice 11b
merged, collided with that slice's numbers, and was regenerated on the
rebased branch; the dev ledger's stamps were moved with
`scripts/restamp-migration.ts` rather than the tables dropped. Tests: ten
more pure (the status list mirrored, the four rate CHECKs at the code's
cap and the floors, the unique number and the action naming its index,
the four keys and the reordering; the arithmetic pinned — a rate half up,
cost and price by markup or by unit price, the extended-cost markup, the
six totals on the four lines the ops test uses and on nothing, by-code
grouping, the rate parser, the spread and the schedule that totals the
contract sum, with the all-unit case that cannot), one more ops (the shape
refused four ways; staff draw up four lines and the figures come back to
the cent; the duplicate number by name; an edit that keeps each line's id
and adds one, stale and foreign-line refusals; staff cannot accept, the
other job's contract, accept sets the value, the four things an accepted
estimate refuses and the two it allows; budget by code with the uncoded
cost said; the schedule with the spread and the unit line's raised price;
the signed contract refusing a different total and accepting the same;
supersede; the list newest first), one more isolation (the two tables,
the four keys, the CHECKs, the unique number, the cascades and the holds).

### 2026-09-15 — The signed copy as a file (`claude/record-files`)

The one thing three slices in a row recorded as open: a lien waiver, a
selection's spec sheet and a subcontractor's certificate could be a PHOTO of
the page and nothing else, because the shared gallery uploaded images only
and a file already in Documents had a verb and no button. Documents' gallery
now has two more doors — *Add a file* (any allowed type) and *From
Documents* (the cabinet's own search) — and this pack passes its own actions
for both on the daily log, lien waivers, selections and subcontractor
documents (`attach<Entity>FileAction` through `registerAttachedFile`,
`attach<Entity>DocumentAction` through `attachDocumentToRecord`, same gate as
a photo, never the picture). The pages split what is attached with
`splitAttachments` and the counts say *files*. Subcontractor documents got the
same two doors when this branch merged 11b (the Subcontractors page splits
its attachments the same way); the signed pay-application
certificate stays open, wanting its own control on the applications table.
Details in the Documents dossier, same date.

### 2026-09-15 — Slice 11b: subcontractor documents (`claude/party-documents`, ADR 0068)

`job_party_documents`, a **Subcontractors** page (`/dashboard/m/jobs/subcontractors`),
a standing line on every order's page, and the rest of construction plan
slice 11: the certificate of insurance and the day it runs out, the W-9, the
licence, whatever else the business asks a subcontractor for.

**PER PARTY, NOT PER JOB.** A framer's insurance covers every job he is on,
so the row names the party and the page lists every party with an issued or
closed order on a job that is not complete or cancelled — the insurance
audit's own view — with the jobs beside the name. A draft order names nobody
the business owes.

**THE KIND IS THE BUSINESS'S; THE EXPIRY IS THE ONLY BEHAVIOUR.** `kind` is an
open taxonomy with a format check, as a contract's is; the pack suggests
three (`insurance_certificate`, `w9`, `license`) and labels them, and
`partyDocumentKindLabel` spells anything else from its slug — the form's
*Other…* takes a name and stores its slug. Which kinds are REQUIRED is
`requiredPartyDocumentsFrom(config)`: the tenant's `requiredPartyDocuments`
or the default of a certificate and a W-9, a value never a branch. The one
thing the pack does with a kind is read `expires_on`.

**STANDING IS DERIVED.** `standingFor` is pure and pinned in the pure suite:
for each required kind, the received document that runs longest — no expiry
beats any date — and its state against today: missing, expired, expiring
within `EXPIRING_SOON_DAYS` (30), ok. Good standing is nothing required
missing or expired; expiring still stands; requested and void are not on
file. `subcontractorStanding` reads the parties on live orders and their
documents once; `partyStanding` answers for one party on the order's page.
Nothing blocks a payment or an order: the page says it in red, and the
order's page in a line, and the person decides.

**THE CHASE IS WORK ON THE PARTY** (`party` under this pack's slug, a
namespace the CRM's `company` does not share): *Certificate of insurance
from Pleasant Valley Feed Mill*, not on any job. Recording a document is a
member's chore; the scanned page is the shared gallery on the row.
`receiptDateFor` and its sentence now serve waivers and documents alike.

**WHAT THE PAGES SAY.** Subcontractors: the required list in words, a row
per party (name, the jobs, what is being chased), a column per required
kind (*On file, expires …* / *Expires …* in bold / *Expired …* and *Not on
file* in red, with the title, issuer and limit under it, the pencil and *Ask
for it*), the other documents on file, a *Good standing* / *Not in good
standing* badge and *Record document*. The dialog: from, kind (the required
and suggested kinds, or *Other…* with a name), title, issued by, number,
issued, expires (blank for one that does not run out), coverage limit,
status (received fills the date), requested, notes, the gallery once it
exists. The order's page: *Certificate of insurance expired 2026-09-01 · W-9
on file · Subcontractors*, red where something is. The jobs list gains the
*Subcontractors* button.

**DRIVEN ON THE DEV BRANCH.** The new *Subcontractors* button on the jobs
list opened the page on **2 with orders on live jobs · 2 not in good
standing** — *Pleasant Valley Feed Mill* (24-109) and *Tractor Supply Co*
(24-108), each *Not on file* in red under both required kinds with *Ask for
it* beside. *Record document* on the feed mill → *Certificate of insurance*
(the first required kind, already picked), *General liability*, *Erie
Insurance*, `GL-4471`, issued `2025-09-01`, expires `2026-09-01`, limit
`1000000`, *On file* with today filled in → *Document recorded* and the
cell **Expired 2026-09-01 · General liability · Erie Insurance ·
$1,000,000.00** in red with the pencil and *Ask for it* still there. *Ask
for it* → *Added to Work* and **Being chased in Work: Certificate of
insurance from Pleasant Valley Feed Mill** under the name. The renewal —
`GL-4472`, issued `2026-09-10`, expires `2026-10-10` — answered instead:
**Expires 2026-10-10** in bold, the button gone, still *Not in good
standing* for want of the W-9. *Record document* → kind *W-9*, no expiry →
**On file**, the badge **Good standing**, and the page's line **2 with
orders on live jobs · 1 not in good standing · 1 expiring within a month**.
The order's page, SC-24109-1: **Certificate of insurance expires 2026-10-10
· W-9 on file · Subcontractors** under the title. One thing driving showed:
with two required columns of state, sentence and buttons, the name column
squeezed to *…ley Feed Mill* on a laptop width — given a minimum width.
Not driven: *Other…* with a kind of the business's own, void, and the
photo (the pane cannot supply a file); the first two are in the ops test.

Migrations `0354_party_documents.sql` / `0355_party_documents_rls.sql`
applied to dev and prod before the merge; `db:verify-rls` **217 tables** on
both, `db:verify-modules` 19/19. As generated: one new table referencing
`parties` only. Tests: four more pure (the kind format and the status list
mirrored with the labels, the receipt-date CHECK, the floor and the held
party, the required list from config or default, and the standing rule date
by date — expired yesterday, the renewal answering, thirty days out
expiring and thirty-one ok, requested and void not on file), one more ops
(the page's rows for issued and closed orders on a live job and not a draft
or a finished job; an unknown kind and a received document without its date
refused; an expired certificate and a W-9; the chase on the party and not
the punch list; the renewal answering and expiring; void and the old one
answering again; a kind of the business's own beside the required ones and
counting when the caller requires it; the list with attachment counts; a
negative limit), one more isolation (read, write, another tenant's party,
the kind format, the date rule both ways, the floor, the held party).

### 2026-09-14 — Slice 8: selections and allowances (`claude/selections`, ADR 0067)

`job_selections` and `job_selection_choices`, a **Selections** page per job
(`/dashboard/m/jobs/[id]/selections`), a Selections panel on the job's
page, and the difference raised as a change order — the custom builder's
other daily number, and the production builder's option book, as one
mechanism.

**A SELECTION AND ITS CHOICES.** A selection is a decision the client owes:
a name, the room, the cost code, the **allowance** the contract set aside,
the date it is **needed by**, and pending / selected / approved /
cancelled. Its choices are what is on offer — description, supplier,
reference, a price by the unit (320 sf at $4.20, ADR 0064's thousandths
and rounding, computed on save) or as a sum — and the one the client
picked, **at most one per selection by a partial unique index**, the cost
code set's default rule. A production option is a selection whose
allowance is the standard's price and whose choices are the upgrades; a
custom allowance is a selection whose choices are the showroom samples.
Choices are written the schedule of values' way — updated by id, inserted,
removed when left out — so a chosen choice keeps its identity across an
edit, and the chosen flags are cleared before the rows are written so the
partial index cannot trip on write order.

**THE DIFFERENCE IS COMPUTED AND MOVES BY CHANGE ORDER.** Chosen price less
allowance, worked out in `listSelections` and summed by `summarise` (the
five numbers: allowances, chosen, over/under, to raise, raised), counted
once the client has chosen. Approved, it is raised by
`raiseSelectionChangeOrder` through `createChangeOrder` — the overage as
the change's price, an underage as a credit, one cost line on the
selection's code — and the selection keeps `change_order_id`, so
`SELECTION_RAISED` refuses a second raising and fixes the allowance and the
choices while the change order stands; a voided one frees them, and the
ops test re-prices to a credit that way. A selection on the allowance to
the cent has nothing to raise; one with no contract has nowhere to.

**THE REMINDER IS WORK ON THE SELECTION** (`job_selection`, not the punch
list's `project`), *Selection needed: Master bath tile by 2026-09-01
(24-108)*, due on the needed-by date; the page reads Work's open items
once and counts them per selection. Samples and spec sheets are the shared
gallery on the selection. Drawing up the list and recording the choice is
a member's chore; raising money is the change order's owner gate.

**WHAT THE PAGES SAY.** The Selections page: five tiles, the table
(selection with room, code and contract; needed by, red and *overdue* when
past; allowance; the chosen choice with its reference and unit pricing, or
how many are on offer; price; over/under signed and red when over; status
with the decided date, the change order's number and status, reminders
open and photos) and per row *Raise overage* / *Raise credit* (owner, when
approved with a difference and no standing change order), *Remind*
(pending) and the pencil. The dialog: selection, where, in the price of
(the contract), cost code, allowance, needed by, status (with decided on),
what it covers, the choices (radio, description, reference; supplier,
quantity, unit, unit price, price — the price box becomes the computed
figure when the unit pair is typed), notes, and the gallery once it exists;
the running *Over by / Under by / On the allowance* beside the choices;
once raised, the allowance and choices shown fixed with the change order's
number. The job's page: a Selections panel — *N selections, M pending (K
overdue) · allowances … · chosen …, over by … · … approved and not yet
raised as a change order* — with *All selections* and *Add selection*.

**DRIVEN ON THE DEV BRANCH, on 24-108** (three contracts, CO-1 on the
New Home agreement). The empty Selections page: five tiles at nothing and
the sentence saying what a selection is. *Add selection* → *Master bath
tile*, *Master bath*, in the price of *New home*, allowance `4000`, needed
by `2026-09-01`, two choices — *Daltile Rittenhouse 3x6, white* `0100-36`
at `320` sf × `4.20`, the price box turning into **1,344.00** as the pair
was typed, and *Marble herringbone* at `6500` — → *Selection added*: **1
selection, 1 pending, 1 overdue · Allowances $4,000.00**, the row *2026-09-01
overdue* in red, *2 on offer*, *Pending*. *Remind* → *Added to Work* and
*Reminder open in Work* under the status. The pencil: the marble's radio,
*Over by 2,500.00* live beside the choices, status *Selected* filling
*Decided on* with today → **Chosen $6,500.00 · Over $2,500.00**, the row
*Marble herringbone · $6,500.00 · $2,500.00* in red, *Selected · Decided
2026-09-14*. The pencil again, *Approved* → **To raise $2,500.00** and
*Raise overage* on the row → the dialog *Over the allowance by $2,500.00*,
number `CO-2`, the title filled in, status *Approved* → *Change order
raised*: **To raise $0.00 · Raised $2,500.00**, the row *CO-2 · Approved*,
the button gone. The job's page: the contracts panel **Worth $1,964,500.00
across 3 signed agreements, including $15,000.00 in approved changes**, the
New Home row **$1,857,000.00 / orig. $1,842,000.00**, the change orders
panel **CO-2 · Master bath tile: allowance overage · Approved 2026-09-14 ·
New home · $2,500.00 · — · Approved** beside CO-1, and the Selections
panel **1 selection, 0 pending · allowances $4,000.00 · chosen $6,500.00,
over by $2,500.00**. Not driven: a credit, a void and re-price, a cancelled
selection and the photos (the pane cannot supply a file); the first three
are in the ops test.

Migrations `0352_selections.sql` (hand-reordered like the seven before it:
two new tables, the selections' unique index moved ahead of the choices'
key to it) and `0353_selections_rls.sql`, applied to dev and prod before
the merge; `db:verify-rls` **216 tables** on both, `db:verify-modules`
19/19. Tests: five more pure (the status list mirrored and which statuses
count, the one-chosen index, the unit pair and the floors, the six keys
and the reordering, the entity slug), one more ops (a selected selection
needs a choice; another job's contract; staff draw it up with a unit-priced
choice whose typed price is ignored; overdue; the reminder on the selection
and not the punch list; two chosen refused and a choice keeping its id;
raising needs approval then an owner; the change order with its line, the
project's revised value and the summary; twice refused, the money fixed,
the words free; void → re-price → a credit; on the allowance to the cent;
no contract; cancelled out of the sums), one more isolation (read, write,
the four cross-tenant parents of a selection and the two of a choice, one
chosen, the unit pair, the floors, the held change order and code, cascade
both ways).

### 2026-09-14 — Slice 11a: lien waivers (`claude/lien-waivers`, ADR 0066)

`job_lien_waivers`, a **Lien waivers** panel on every order's page, a line
under the job's Ordered tiles, and the first of construction plan slice 11
(`compliance`): the document a subcontractor or supplier signs to give up
its lien right for the work paid — the next thing a GC's bookkeeper asks for
once retainage is tracked, and what the owner's bank wants to see before it
funds the next draw.

**A RECORD, NEVER A FORM.** The words on a waiver are the state's — a dozen
states mandate the text — or the lawyer's, and a Canadian business signs a
statutory declaration instead; a pack that carried one state's form would be
the narrowing the standing rule forbids. What every one has in common is
what the row keeps: WHO gives it (any party — usually the order's, sometimes
their supplier), on WHICH job and under which order, of which KIND
(conditional or unconditional × progress or final, the vocabulary every
American form uses, a CHECK because the gap rule reads it), THROUGH which
date, for HOW MUCH, and whether the signed copy has been RECEIVED — with the
date it arrived, required, as a change order's approval date is. The signed
copy is a Documents attachment on the row (`job_lien_waiver`), the daily
log's gallery with the pack's own actions.

**THE GAP IS DERIVED, NEVER STORED.** `waiverGaps` walks the subcontractor's
billed applications, asks Accounting's own `loadBill` whether money went out
(paid or partial), and checks the waivers received on the order: one covers
an application when it names it, when it is a final one, or when its
through date is on or after the application's period end. Paid and nothing
unconditional → the gap the bank cares about, in red; billed, unpaid and
nothing at all → the softer one. A waiver that arrives closes the gap by
existing, and a bill paid in Accounting opens one without Accounting
learning anything about the pack — the platform's rule for obligations
(derived, not stored events), applied to paperwork. `waiverCoverage` is the
same read summarised per order: unconditional through, conditional through,
a final on file.

**THE CHASE IS WORK, LINKED TO THE ORDER.** *Ask for it* beside a gap raises
a Work item — *Lien waiver from Pleasant Valley Feed Mill: unconditional
through 2026-10-31 (SC-24109-1)* — through `createWorkForEntity` on a new
`job_commitment` entity, not on the job's punch list (which is the site's),
and the panel says *Being chased in Work* until it is ticked off there.
Work raised where it lives, as the plan's row 11 said; no task engine of the
pack's own.

**A MEMBER'S CHORE.** Recording that a waiver was asked for or arrived is
`member`-level, as the daily log is: the decision it protects — paying — is
Accounting's and an owner's. The photo follows Documents' own rule
(`roleMayWrite`), the daily log's gate.

**WHAT THE PAGES SAY.** The order's page: the coverage sentence, a sentence
per gap with the button, the table (kind with their reference, from with
who signed, through, amount or a dash, covers, status with the date, signed
copy count) and the dialog (on, from, kind, through, amount, covers — billed
applications only —, status, requested, received, signed by, reference,
notes; the gallery once the record exists); every billed application in the
applications table says *Unconditional waiver on file*, *Conditional waiver
on file*, *No waiver yet* or, in red, *Paid · no unconditional waiver*. The
job's page: *Lien waivers: 1 paid application with no unconditional waiver
on file — SC-24109-1 (Pleasant Valley Feed Mill)* under the Ordered tiles,
and *paid, no waiver* / *waiver through <date>* / *final waiver on file*
under each order's Billed figure.

**DRIVEN ON THE DEV BRANCH, on 24-109's SC-24109-1** (two billed
applications after 4b, neither paid). The order's page opened on the new
panel reading **No unconditional waiver on file** with a sentence per
application — *Application 1 (2026-09-30) is billed and no waiver covers it
yet* — and *No waiver yet* under each application's status. In Accounting,
*Record payment* on application 1's bill ($13,500.00 from Farm Checking);
back on the order: the application read **Bill · Paid · Paid · no
unconditional waiver** in red and the panel **Application 1 (2026-09-30,
$13,500.00) has been paid and no unconditional waiver covers it**, also in
red. *Ask for it* → *Added to Work* and the panel read **Being chased in
Work: Lien waiver from Pleasant Valley Feed Mill: unconditional through
2026-09-30 (SC-24109-1)**. *Record waiver* → from *Pleasant Valley Feed
Mill* (filled in), *Unconditional, progress*, through `2026-09-30`,
`13500`, *Covers* `Application 1 — 2026-09-30 · $13,500.00`, *Received*
with today filled in, signed by *J. Miller*, their ref. `LW-1` → *Waiver
recorded*: the panel **Unconditional waiver on file through 2026-09-30**,
the gap gone, application 1 **Unconditional waiver on file**, the table
**Unconditional, progress · Their ref. LW-1 · Pleasant Valley Feed Mill ·
Signed by J. Miller · 2026-09-30 · $13,500.00 · Application 1 · Received
2026-09-14 · —**. The job's page: **Lien waivers: every paid application has
an unconditional waiver on file. 1 billed and unpaid with no waiver yet.**
under the Ordered tiles, and **waiver through 2026-09-30** under the order's
Billed figure. Not driven: the photo of the signed page (the pane cannot
supply a file — the gallery is the daily log's, unchanged), a void, and a
final waiver; the last two are in the ops test.

Migrations `0350_lien_waivers.sql` / `0351_lien_waivers_rls.sql` applied to
dev and prod before the merge; `db:verify-rls` **214 tables** on both,
`db:verify-modules` 19/19. As generated: one new table referencing existing
ones only. Tests: five more pure (the two CHECK lists mirrored with their
labels, the kinds that stand alone and the kinds that cover everything, the
receipt-date CHECK and the floor, the four keys, the two entity slugs), one
more ops (a draft cannot be named; the softer gap; a received waiver needs
its date; staff record one; requested is not on file; received closes the
gap; the bill paid opens the unconditional gap; the chase on the order and
not the punch list; a later unconditional covers without naming; the list
with counts; void stops counting; a final ends the asking; another job's
order, another order's application and an unknown kind refused), one more
isolation (read, write, the four cross-tenant parents, the date rule both
ways and the floor, the party and the application held, cascade from the
job).

### 2026-09-14 — Slice 4b: subcontract change orders (`claude/subcontract-change-orders`, ADR 0065)

`job_commitment_change_orders`, a `change_order_id` tag on
`job_commitment_lines`, a **Change orders** panel on every order's page, and
the door 5c said was missing: **a billed subcontract can be changed** — by a
change order on the order, which is what the trade does on paper.

**THE PAYABLE SIDE OF original + approved changes = revised.** A change to a
subcontract (or a purchase order — the verb does not care which) is its own
row against ONE commitment: a number unique per order, a title, the
client-side statuses and the client-side rule that approved has a date and
nothing else does, and — when it is the subcontractor's share of one — the
client's change order it **passes down**, RESTRICT and on the same job
(`WRONG_PROJECT` otherwise). It is not a second kind of `job_change_orders`:
that row has a price and a cost with a markup between them; a change to a
subcontract has one number.

**ITS MONEY IS THE ORDER'S LINES, TAGGED.** An order's original lines carry
no tag; a change's lines carry the change's id, in the same table. Nothing
is stored twice: what an order is worth now is original + approved changes,
summed wherever it is shown through one predicate, `countedCommitmentLine`
(the line is original, or its change is approved), which `listCommitments`,
`committedTotals`, the job cost report's `Ordered` column and the
subcontractor's schedule all read. So an approved change reaches the open
draft application on its next edit — after the original lines, with the
change's number in front (`SCO-1 · Blocking`) — and the bill's line names it:
*Application 1 — SCO-1 · Blocking through 2026-09-30*. A change taken back
takes its draft line with it, whatever was typed. The sync also keeps a
draft line's `scheduled_cents` equal to the order's amount now, which the
next paragraph needs.

**A DEDUCTION IS A NEGATIVE LINE THAT RUNS BACKWARDS.** Scope taken back is
`-2,000` on the change, the one way a commitment line goes below zero
(`amount_cents >= 0 or change_order_id is not null`). On the subcontractor's
application that line is completed to less than nothing and never more, and
nothing is stored against it; the two floors on `job_sub_application_lines`
flip on the sign of `scheduled_cents` (`case when … < 0 then … <= 0 else …
>= 0 end`), and `percentComplete` reads a deduction's percent like any
other's — `-2,000` of `-2,000` is 100%, and nothing done on it is `0`, not
`-0`. The ops test bills 10,000 of trim and −2,000 of dropped garage trim on
one application: three bill lines, retainage on the net.

**AN ISSUED ORDER'S LINES ARE LOCKED, AS A SIGNED VALUE IS.** Once an order
counts, its lines are the original half of the line every report reads, and
so are a billed draft's; `updateCommitment` compares the lines sent with the
lines it has and refuses `LINES_LOCKED` when they differ — the same lines
sent back are not an edit, so a status or a note still saves — and the form
shows the locked lines with *Issued. The lines change with a change order,
on the order's page.* and does not send them. A change a subcontractor has
billed against is fixed the same way: it stays approved and keeps its lines
(`CHANGE_BILLED`), while its title, words, dates and what it passes down
still change.

**WHAT THE PAGES SAY.** The order's value tile reads the revised sum with
*orig. $… · $… in approved changes* under it; its Lines table carries
*Added by SCO-1* under a change's line and prints a deduction with its sign;
the new Change orders panel lists number, change (with *Approved <date>* and
*Passes down CO-3 · …*), amount, status and *Billed against*, with the
dialog behind the pencil; the project's Ordered table prints the revised sum
with *orig.* beneath and counts the lines that count. `toResult`'s
`INVALID_VALUE` now hands on the verb's own sentence — *A deduction cannot
be completed to more than nothing.* — instead of *A contract value cannot be
negative.* for every refusal of that code, a wrong sentence four slices old.

**DRIVEN ON THE DEV BRANCH, on 24-109's SC-24109-1** (the framing
subcontract 5c billed at $13,500.00 with $1,500.00 held). The job's Ordered
table: the pencil on the issued order opens the dialog with its one line
shown, not editable — *06 10 00 · Rough carpentry 30000.00 · Issued. The
lines change with a change order, on the order's page.* The order's page:
*Add change order* → `SCO-1` *Extra blocking at the stair*, the scope in
words, *Passes down* left at *None — a change of our own*, one line `06 10
00 · Rough carpentry` *Blocking* `4000`, *Approved* (the date filled in
with today) → *Change order added*, and the page read **Subcontract value
$34,000.00 · orig. $30,000.00 · $4,000.00 in approved changes · 2 lines ·
Balance to finish $19,000.00**, the Lines table **Blocking · Added by SCO-1
· $4,000.00 · 0%**, the panel **1 approved, worth $4,000.00 on the
subcontract**. *New application* → period to 2026-10-31, 10%, their ref.
`FR-2042` → *Open*: the grid carried **SCO-1 · Blocking $4,000.00** under
the original line; `5000` and `4000` priced live to **Completed
$24,000.00 · Retainage −$2,400.00 · Less previous −$13,500.00 · Current
payment due $8,100.00 · Balance to finish $10,000.00**, 66.7% and 100%.
*Approve as bill* → **2 billed for $21,600.00**, the row *Billed · FR-2042 ·
Open*, the change's status now *Billed against*; in Accounting the bill
read **Application 2 — 06 10 00 · Rough carpentry through 2026-10-31 ·
5100 · 5,000.00 · Application 2 — SCO-1 · Blocking through 2026-10-31 ·
5100 · 4,000.00 · Retainage held (10%) · 2120 · (900.00) · total 8,100.00**.
Back on the job: the Ordered table **SC-24109-1 · 2 lines · $34,000.00 /
orig. $30,000.00 · $21,600.00 / $2,400.00 held**, *Committed $34,000.00*,
and the job cost row `06 10 00` *Ordered $34,000.00*. **One thing driving
showed**: the change read *Billed against* the moment the draft picked its
line up, because "billed" had counted any application line, a draft's
included — so a change with a draft on it could not have been taken back or
re-lined, though the sync would have dropped the draft line anyway. Billed
now means an application that is no longer a draft, and replacing a
change's lines first clears any draft's lines on them (`dropDraftLinesOn`);
the ops test's last act, a declined change leaving an open draft, is what
caught it in the suite. Not driven: a deductive change and a purchase
order's revision, both in the ops test.

Migrations `0348_commitment_change_orders.sql` / `0349_commitment_change_orders_rls.sql`
applied to dev and prod before the merge; `db:verify-rls` **213 tables** on
both, `db:verify-modules` 19/19. As generated, no hand-reordering: the new
table's unique index lands before the lines' key to it. Tests: six more pure
(the status list mirrored, the date rule and per-order numbering, the three
keys, the floor's one exception, the flipped floors, a deduction's percent),
one more ops (the lock and the same-lines pass, the wrong job and staff
refused, a proposed change counted by nothing, approval needing a date and
moving the order, the job and the report, the draft picking the line up, the
bill naming the change, billed-against fixed, the deduction billed
backwards with both refusals, per-order numbering by the index, a purchase
order's revision, a draft order's lines still free, a declined change
leaving the draft), one more isolation (read, write, the two cross-tenant
parents, a cross-tenant line, the date rule both ways, per-order numbering,
the negative floor, the flipped application floors, RESTRICT on a billed
deduction and on the client change it passes down, cascade); the 5c refusal
now asserted by code.


### 2026-09-14 — Slice 5f: unit price (`claude/unit-price`, ADR 0064)

The sixth and last billing method, the one still "recorded and billed by
nothing" — and it is the schedule of values with three more columns.
Migration `0347_unit_price.sql` adds `unit`, `quantity_thousandths` and
`unit_price_cents` to a schedule line (both or neither, a CHECK) and
`quantity_previous_thousandths` / `quantity_this_period_thousandths` to an
application line (their sum never below nothing, a CHECK); no new table,
so no RLS migration.

**A SCHEDULE LINE IS AN ITEM.** A unit, an estimated quantity kept in
THOUSANDTHS — 1,250.500 cy is 1250500, the grain estimating works to, an
integer so every sum is exact — and a price per unit; its scheduled value
is the estimate at the price, computed by `saveSovLines` and never typed
(`unitLineCents`, half up once per line). `unit_price` joins
`FIXED_VALUE_METHODS`, so the contract page, the tiles, the applications,
retainage, the void path and the printout are the fixed-price ones;
`UNBILLED_METHODS` is empty and the pure test says so. The contract's value
is the estimate the schedule adds up to, which unit price expects to be
passed: a line's percent may exceed 100 and its balance go negative.

**THE PERSON TYPES QUANTITIES.** An application line on a priced item
carries the quantity completed before (carried by `syncDraftLines`) and the
quantity this period; `updatePayApplication` prices the typed quantity at
the line's price and ignores any money that arrived beside it (the ops test
types `999` and gets `10,800.00`). A negative quantity corrects; below
nothing to date is refused. Stored materials stay money. The editor
(`pay-application-editor.tsx`, `unitPriced`) shows *Est. qty · Previous
qty · This period qty · This period* with the price and the estimate under
the item; the schedule editor (`sov-editor.tsx`, `unitPriced`) takes unit,
quantity and price per row and shows the value. `PayApplicationLineRow`
carries the line's unit, price and estimate from the join.

**THE INVOICE READS ITEM BY ITEM.** *Application 1 — Excavation, 600 cy at
18.00/cy through 2026-09-30*, one line per item with a quantity this
period, and one line for whatever the certificate carries beyond the items
(stored materials coming and going). The printout's continuation sheet
(`certificate-model.ts` `unitPriced`, eleven columns) carries the unit,
the price, the estimate and the three quantities beside the money.

**WIP measures a unit-price job as a fixed-value one** — cost-to-cost
against the estimate — and the output method (units installed over units
estimated) is the open item [ADR 0064](../decisions/0064-a-unit-price-application-bills-quantities-at-the-schedules-prices.md) records.

Migration `0347_unit_price.sql` applied to dev and prod before the merge;
`db:verify-rls` 212 tables on both. Tests: three more pure (the columns
and the four CHECKs, quantities in thousandths read and written and
printed, a quantity at a price rounded once with a correction credited)
and the method-group test now counting unit price among the schedule
methods; one ops (three items worth their estimates at their prices, the
typed money ignored, the four-line invoice, October's quantities carried
past the estimate, a correction below nothing refused, the certificate
read carrying the units); one isolation (both or neither, nothing below
nothing, at the database); one certificate (the unit columns and a render).

**DRIVEN ON THE DEV BRANCH, on 24-111 Lane drainage** (seeded by script: a
signed `site_work` contract billed *Unit price*, value $50,000.00, and a
schedule of three items — *Excavation 1,000 cy at $18.00*, *Drain pipe 2,000
lf at $12.50*, *Catch basins 4 ea at $1,750.00*). The contract's page:
**Contract value $50,000.00 · Scheduled $50,000.00**, a panel now titled
*Schedule of unit prices* — *3 items, estimated at $50,000.00* — with
**Unit · Est. qty · Unit price** columns before the cost code, and the
applications intro saying *how many of each item were installed* (both
wordings were fixed after the first render). *New application* → period
to 2026-09-30, retainage 10 → *Application started*, the row **$0.00 · 10%
held · Draft**. *Open* → *Application 1 — draft* with the unit-price grid:
**Item ($18.00/cy · $18,000.00 estimated) · Est. qty 1,000 cy · Previous
qty 0 · This period qty · This period · Stored · To date · %**. Typed
`600`, `800.5` and `1` → live **$10,800.00 (60%) · $10,006.25 (40%) ·
$1,750.00 (25%)**, the certificate **Completed and stored to date
$22,556.25 · Retainage (10%) −$2,255.63 · Total earned less retainage
$20,300.62 · Current payment due $20,300.62 · Balance to finish
$27,443.75**. *Issue as invoice* → *Application 1 issued as an invoice*,
tiles **Billed to date $20,300.62 · 1 issued · Retainage held $2,255.63 ·
Balance to finish $27,443.75**, the schedule's *Complete* column **60% ·
40% · 25%**, the row **Issued 2026-09-14 · $22,556.25 · $2,255.63 ·
$20,300.62 · INV-0009 · Open**. In Accounting, **INV-0009** to Tractor
Supply Co, due 2026-10-14, four lines to **4000 · Sales** and **1230**:
*Application 1 — Excavation, 600 cy at 18.00/cy through 2026-09-30*
10,800.00 · *Drain pipe, 800.5 lf at 12.50/lf* 10,006.25 · *Catch basins,
1 ea at 1750.00/ea* 1,750.00 · *Retainage withheld (10%)* (2,255.63), total
**20,300.62**. The printout, in Chrome's viewer embedded in the page: page two
**CONTINUATION SHEET · NO. · ITEM · UNIT · PRICE · EST. QTY · PREVIOUS ·
THIS PERIOD · TO DATE · AMOUNT · % · BALANCE**, *Excavation · cy · 18.00 ·
1,000 · 0 · 600 · 600 · 10,800.00 · 60% · 7,200.00*, the pipe and the basins
likewise, *Totals 22,556.25 · 45.1% · 27,443.75*. Page one found the
slice's one real bug: **lines 1, 3 and 9 printed a dash** — the rows-to-model
mapping took a maximum (null) for every method but fixed price, and unit
price starts from its estimate. Fixed in `certificate.ts` and pinned in the
ops test through `certificateInputFrom`. Not driven: a second application carrying
quantities past the estimate, a correction, the schedule editor's unit
boxes on screen — the first two are in the ops test, the third is the
same dialog the drive seeded through.

### 2026-09-14 — Slice 5e: the printout (`claude/pay-application-printout`, ADR 0063)

The last item on the billing slices' list: a pay application as the
document an owner, an architect or a lender asks for. No migration, no new
row — a *PDF* link on every application's row, a GET route, and three
files in the pack that mirror Accounting's invoice PDF exactly:
`certificate-model.ts` (pure: every word and figure on the two pages,
table-tested), `certificate-pdf.tsx` (layout only, `@react-pdf/renderer`,
the same NotoSans faces) and `certificate.ts` (from the pack's rows to the
model's input, the brand and the bytes), with `payApplicationCertificate`
in `ops.ts` reading the application, its contract and project, the row the
contract page shows, the last issued application and the approved change
orders in one go.

**RENDERED FROM THE FROZEN CERTIFICATE, NEVER STORED** ([ADR 0063](../decisions/0063-a-pay-applications-printout-is-rendered-from-the-frozen-certificate.md)). An issued
application prints the five totals and the line figures it wrote down at
issue; a draft prints its live figures under a DRAFT watermark and *Not yet
issued* as its date; a voided one prints under VOID. Nothing is saved — a
file could only drift from the row, and the row cannot change.

**THE SHAPE EVERYBODY KNOWS, IN OUR OWN WORDS.** Page one is portrait: the
parties, the job, the contract and its date, the application number, the
period and the date; the nine numbered lines — original contract sum, net
change by change orders, contract sum to date, total completed and stored to
date, retainage as a percent of line 4, total earned less retainage, less
previous certificates, **current payment due**, balance to finish including
retainage; a change-order summary with additions and deductions split at the
last certificate's period end; a certification sentence of ours; two
signature blocks, the owner's or architect's with an *Amount certified*
line. Page two is LANDSCAPE, because a continuation sheet has nine columns:
a row per schedule line — scheduled, previous, this period, stored, to date,
percent, balance — and totals. The form, its text and its name are the
AIA's and appear nowhere; the pure test scans the model for *AIA*, *G702*
and *G703*.

**COST PLUS AND T&M PRINT ON THE SAME TWO PAGES.** Line 1 is the guaranteed
maximum or the not-to-exceed, *None* when there is none, and lines 3 and 9
follow it; line 4 is *Cost plus fee to date* or *Labour, cost and markup to
date* (*…, at the maximum* when the cap held), with its parts beneath it;
the continuation sheet carries the books' cost by code and, on T&M, the
hours by person and rate — the draft editor's rows, printed. Negative
amounts — a deduction, a correction this period, a credit passed on — print
in parentheses, the convention on a statement (`formatCentsSigned`).

**THE PARTY'S ADDRESS IS ACCOUNTING'S.** The product keeps no postal address
on a party (`party_contact_points` are email, phone and website); the one
it keeps is the customer's, in Accounting, which is where the invoice reads
it. The pack asked for a read: `customerForParty` in
`invoicing/customers.ts`, the twin of `ensureCustomerForParty` that makes
one — a certificate must not create a customer by being printed. A party
never billed prints as a name alone.

Tests: `tests/jobs-certificate.test.ts` — the nine lines of a fixed-value
application, the change orders split at the last certificate and a net
deduction in parentheses, the facts and the draft's *Not yet issued*, the
signature blocks and the scan for the AIA's words, the continuation rows
with their percent and balance and the totals, a correction in
parentheses and an empty schedule's missing totals row, the cost-plus
lines with the maximum and the parts of line 4 and *None* without a
maximum, the T&M hours by person with a dash for no rate; and four renders
to real PDF bytes (fixed, cost-plus draft, T&M, empty and branded), the way
`invoice-pdf-render.test.ts` guards the fonts.

**DRIVEN ON THE DEV BRANCH, all three shapes.** The browser pane treats a
PDF response as a download and will not show it, so the three certificates
were read in Chrome's viewer embedded in the page, and rendered to files by
script as well. **24-108** (fixed price, one schedule line, one approved
change order): page one under the farm's logo and green — *APPLICATION AND
CERTIFICATE FOR PAYMENT · Application 1 against the schedule of values*,
*Project 24-108 · Oak Row residence — phase 2 · Contract for New home ·
Application no. 1 · Period to 2026-09-14 · Application date 2026-09-14*,
*To Tractor Supply Co · From Hilltop Farm*, then **1 Original contract sum
1,842,000.00 · 2 Net change by change orders 12,500.00 · 3 Contract sum to
date 1,854,500.00 · 4 Total completed and stored to date 370,900.00 · 5
Retainage (10% of line 4) 37,090.00 · 6 Total earned less retainage
333,810.00 · 7 Less previous certificates 0.00 · 8 Current payment due
333,810.00 · 9 Balance to finish, including retainage 1,520,690.00**, the
change-order summary with the 12,500.00 under *Approved this period*, the
certification sentence and the two signature blocks; page two, sideways,
**1 · Contract sum · 1,854,500.00 · 0.00 · 370,900.00 · 0.00 · 370,900.00 ·
20% · 1,483,600.00** with totals and the draft's note *Draw 1 — foundation
and framing complete*. **24-109** (cost plus): *Application 1 for cost plus
a fee*, **1 Guaranteed maximum 60,000.00 · 3 Guaranteed maximum to date
60,000.00 · 4 Cost plus fee to date 45,597.50** with *Cost to date
39,650.00* and *Fee to date (15% of cost) 5,947.50* beneath it, **5
Retainage 4,559.75 · 8 Current payment due 41,037.75 · 9 Balance to the
guaranteed maximum, including retainage 18,962.25**; page two *COST BY
CODE*: **06 10 00 · Rough carpentry 39,650.00 · 0.00 · 39,650.00 ·
39,650.00 / No cost code 850.00 · 0.00 · 0.00 · 0.00 / Totals 40,500.00 ·
0.00 · 39,650.00 · 39,650.00**. **24-110** (time and materials):
*Application 1 for hours at their rates and cost with a markup*, **1 Not to
exceed None · 3 None · 4 Labour, cost and markup to date 2,244.00** with
*Labour to date 880.00 · Cost to date, wages aside 1,240.00 · Markup to date
(10% on cost) 124.00*, **8 Current payment due 2,244.00 · 9 —**; page two
the cost line and *HOURS BY PERSON*: **danr.houser91 · 50.00/h · 2 h · 0 h ·
2 h · 100.00 · 100.00 / Marta Quinn · 65.00/h · 12 h · 0 h · 12 h · 780.00 ·
780.00**. One thing the render found: with line 4's three parts the T&M
certificate ran to THREE pages — the signature blocks fell off page one —
so page one's spacing was tightened until every shape counts two, which a
script now checks. The address block prints the name alone: the farm's
Tractor Supply Co customer row carries no address. The three PDFs were sent
to the founder as files.

### 2026-09-14 — Slice 5d: time and materials (`claude/time-and-materials`, ADR 0062)

The third way the market bills a job, and the one ADR 0060 closed with:
"cost-plus with billing rates in place of cost … with a rate card". One
nullable term on the contract (`labor_rate_cents`), one frozen figure on the
application (`labor_to_date_cents`), one new table
(`job_pay_application_labor`), a third WIP `method` and a fourth WIP
`reason` — and no new document, no new invoice path, no rate card of the
pack's own, because Time already had one.

**THE HOURS ARE TIME'S.** `laborOnJob` reads a WORKED entry tagged with the
job's `project` dimension member — the same tag a bill line carries, through
`time_entry_dimensions` — dated on or before the period end, on an APPROVED
sheet: the gate `laborAccrualFor` uses, so the bill and the books carry the
same hours. Paid leave tagged with the job is a cost and never a charge;
hours on a sheet nobody has approved are counted (`awaitingMinutes`), said
on the draft, and not billed. This is the first reader of Time's
`bill_rate_cents`: the rate in force on the hour's day (`listRates`, newest
first, the first row that had started by the day), or one flat rate on the
contract for everybody.

**LINES ARE KEYED BY PERSON AND RATE.** `syncLaborLines` is `syncCostLines`
with hours for money: one line per (worker, rate), minutes to date, what
earlier applications billed of them, this period defaulting to the
difference and kept once typed; a line with nothing to date and nothing
before it is dropped. The rate is part of the key because Time's rates are
dated by the hour's day and hours never move between rates — a person whose
rate rose mid-September has two exact lines, and October's application
carries both forward. That is also why a contract's flat rate is LOCKED once
an application has issued (`RATE_LOCKED`): it carries no date, and changing
it would re-rate hours a certificate already carries. A rate of nothing is a
line that cannot be billed — `NO_BILL_RATE`, by name — never an hour given
away; the editor greys the button and says who.

**THE COST SIDE LEAVES THE WAGES OUT.** `actualByCode` takes
`{ withoutLabor }`, which drops expense accounts of the subtype the labour
accrual posts to — `LABOR_EXPENSE_SUBTYPE`, exported from
`src/lib/labor-posting.ts`, `payroll_expense` on the general chart's `6450`
and `6500` — so an hour is billed once, by rate, and never again as
marked-up cost. The fee is the markup on cost only; the guaranteed maximum
is the not-to-exceed on the lot. `costPlusTotals` takes the labour sum as
one more argument, zero on a cost-plus contract, so nothing about cost plus
a fee moved.

**THE SAME ROW, INVOICE AND VOID PATH.** `billsTheLedger` (cost plus OR time
and materials) is what the four application verbs branch on; `tm` is what
adds the labour. The invoice carries a line per person — *Alice Carpenter,
10 h at 65.00/h through 2026-09-30*, readable against the timesheet — then
cost, *Markup (10% of cost)*, retainage; or one line *at the not-to-exceed*
when the cap holds. `ONE_COST_PLUS` now covers both methods, since cost
belongs to the job whichever way it is billed. The editor is
`cost-plus-editor.tsx` in `mode="time_and_materials"`: a labour table above
the cost table, hours typed in hours and stored in minutes
(`hoursStringToMinutes` / `minutesToHoursString`), each row priced live by
`laborLineCents` — minutes × rate ÷ 60, rounded half up per line, because
each line is an invoice line.

**WORK IN PROGRESS, THIRD METHOD.** A job whose only counted contract is
time and materials earns its approved hours at their rates plus the rest of
its cost marked up, capped; `wipFigures` takes `labor: { billableCents,
costCents }` and subtracts the wages from the cost it marks up
(`laborCostByProject`, the same accounts). An hour with no rate is
`no_rate`: shown, a blocker by job number, and `postWip` refuses with
`NO_BILL_RATE`. **A member reading the live schedule sees every
time-and-materials job with hours as `no_rate`**, because `time_rates` is
owners-only and RLS hands them no rates — nothing can tell that from "no
rate set". The posted schedule is frozen by an owner and the same for
everyone. Recorded as a decision, not hidden.

**THE CONTRACT PAGE AND FORM.** *Time and materials* is a fifth set of tiles
(Labour · Cost to date, wages aside · Billed · Retainage · Not to exceed) and
its own panel: the terms in a sentence, approved hours on the job with how
many await approval, whether Time is switched on (`timeEnabled`), and the
books' cost by code without the wages. The form shows four boxes when the
method asks for them — the labour rate for everybody, greyed with *Fixed once
an application has issued* when it is — and the project page passes the rate
and the lock through, so an edit cannot blank the one or defeat the other.

Migrations `0345_time_and_materials.sql` (as generated: the new table
references existing ones only, and the two widened CHECKs are dropped and
re-added by drizzle-kit itself) and `0346_time_and_materials_rls.sql`,
applied to dev and prod before the merge; `db:verify-rls` reports **212
tables** on both, `db:verify-modules` 19/19. Tests: seven more pure (the
columns, the keyed table and its RESTRICT to Time's worker, the widened
reasons, minutes at a rate rounded once, hours read and written back, the
certificate with labour and the markup on cost alone, WIP with the wages
not marked up, the accounts told apart by subtype) and the method-group test
now counting four groups; three more ops (the draft from three people's
hours — one untagged, one on leave, one after the period, one awaiting
approval, one with no rate — the refusal by name, the rate set and the hours typed against the stale
key following the person to the re-priced line, the five-line invoice, the
Spent column still carrying the wages; the flat rate
and its lock, the dated rate's two lines, the next application carrying hours
forward, hours typed short, one biller per job; WIP earning hours plus
marked-up cost with the wages once, and the `no_rate` blocker), one more
isolation. The ops run found one thing: `minutesToHoursString(30)` came out
as *0.* — a regex that lost its backslash on the way through the edit script
— and was rewritten without one, with `0.5` pinned in the pure test.

**DRIVEN ON THE DEV BRANCH, on 24-110 Kitchen remodel** (seeded by script
through the product's own verbs while the pane was signed out: a signed
`service_work` contract billed *Time and materials* at 10% markup, Marta
Quinn charged out at $65.00, 12 h of hers approved and tagged with the job,
2 h of the founder's own on a sheet not yet approved, $1,240.00 of cabinet
hardware on `6400` tagged with the job, a draft to 2026-09-30). The
contract's page: **Service work · Kitchen remodel · with Tractor Supply Co ·
Time and materials**, tiles **Labour: Per person, from Time · plus 10%
markup on cost / Cost to date $1,240.00 · in the books, wages aside / Billed
$0.00 / Retainage $0.00 / Not to exceed None** (the first render wrapped the
labour tile over three lines; its value was shortened), the *Time and
materials* panel with **Approved hours on the job 12 h · 2 h more await
approval in Time**, **In the books, wages aside $1,240.00**, one row *No
cost code $1,240.00*, and the applications table **$2,144.00 · $780.00
labour + $1,240.00 cost + $124.00 markup · 0% held · Draft**. *Open* →
*Application 1 — draft, time and materials*: **Marta Quinn · $65.00/h · 12 h
· 0 h · 12 · $780.00 · $780.00**, the line *2 h more on the job are on
timesheets not yet approved, and are not on this application*, the cost
row, and the certificate **Labour to date $780.00 · Cost to date, wages
aside $1,240.00 · Markup to date (10% on cost) $124.00 · Labour, cost and
markup to date $2,144.00 · Current payment due $2,144.00**. *This period (h)*
typed `10` → **2 h left unbilled · $650.00 · due $2,014.00** live; *Save
draft* → *Application saved* and the row **$2,014.00**.

**Two things driving found, both fixed here.** (1) *Open* again showed the
rows from BEFORE the save: the editor initialises its rows once, on mount,
and the component outlives `router.refresh()` — the same latent fault in
the cost-plus and fixed-price editors since slices 5 and 5b, never seen
because nobody re-opened a saved draft. All three editors are now keyed on
`${app.id}:${app.version}`; every save bumps the version, so what is opened
is what was saved. (2) In Time's *Pay period* (Sep 13–19: *Where the hours
went: 24-110 · Kitchen remodel 14h*), *Approve* on the founder's 2 h; back
on the draft, *Save draft* added the row **danr.houser91 · No bill rate · —
· 2 h · 2 · $0.00**, *Issue as invoice* greyed, and under the buttons the
sentence naming the person and the three ways out. Then *People → Set a
rate* — *Who* danr.houser91, *Hourly pay* 30, *Charged out at* 50 → *Rate
saved* — and *Save draft* was refused with **That project no longer
exists**: the sync had re-keyed the person's line at $50 and the hours typed
against the rate-of-nothing key matched nothing (`NOT_FOUND`, through the
generic sentence). The very flow the note recommends. Now the typed hours
follow the person to their one re-priced line, pinned in the ops test (Bob
typed against a stale key → *2.5 h at 40.00/h* on the invoice). Saved again:
**$2,114.00 · $750.00 labour**; *Open* → **danr.houser91 · $50.00/h · 2 h · 2
· $100.00**, Marta's `12` typed back → **Labour to date $880.00 · due
$2,244.00** → *Issue as invoice* → *Application 1 issued as an invoice*, the
row **Issued 2026-09-14 · $2,244.00 · $880.00 labour + $1,240.00 cost +
$124.00 markup · INV-0008**, tiles **Billed to date $2,244.00 · 1 issued**.
The red *no bill rate* note wrapped the header row and was shortened.

In Accounting, **INV-0008** to Tractor Supply Co, issued 2026-09-14, due
2026-10-14, memo *Pay application 1 · 24-110 · service_work · Kitchen
remodel*, four lines to **4000 · Sales** (the farm chart has no 4030):
*Application 1 — danr.houser91, 2 h at 50.00/h through 2026-09-30* 100.00,
*Application 1 — Marta Quinn, 12 h at 65.00/h through 2026-09-30* 780.00,
*Application 1 — cost incurred through 2026-09-30* 1,240.00, *Markup (10%
of cost)* 124.00, total **2,244.00**; no retainage line at 0%. The WIP
schedule as of 2026-10-31 (September's is posted and frozen, so a new job
is not on it) listed the farm's three jobs on three methods, 24-110 at
**Cost to date $1,240.00 · % done — · Earned $2,244.00 · Billed $2,244.00 ·
Under — · Over — · Profit to date $1,004.00**, *3 jobs measured*, no
blockers. The project page's contracts row read **Service work · Kitchen
remodel · Tractor Supply Co · Time and materials · — · $2,244.00 · Signed**,
and its *Edit* dialog showed the four boxes under *Billed by*, **Labour
rate, everybody** greyed with *Fixed once an application has issued*. Not
driven: retainage on a T&M application, the not-to-exceed binding, a second
application carrying hours forward, the void, and a flat contract rate —
all in the ops tests. Next's dev overlay reported one stale-chunk issue
after a hot edit, cleared by a reload; not the product.

### 2026-09-14 — The column that was deliberately absent (`claude/spent-per-code`)

**Actual cost per code, on this job only.** The job cost report's `Spent`
column, missing since slice 3 and named as an open item through slice 6
because `getBalances` grouped by one dimension type — a job's cost, or a
code's cost across every job, never both — and faking it would have put
another job's spend in this job's column. Accounting's `getBalances` now takes
`withinMemberId` (accounting.md, same day): the ledger sliced to the lines
tagged with THIS job's cost object, then grouped by cost code. Another job's
spend on the same code cannot reach the column by construction, which the ops
test proves with a 999,000 line on the other job.

**LEFT IS MEASURED AGAINST THE GREATER OF ORDERED AND SPENT.** Ordered but not
yet billed is still owed; billed beyond what was ordered has already
happened. Neither alone is the number to hold a budget against, and their
sum would count the same dollar twice — a subcontract's bill IS its
commitment arriving. `JobCostRow.projectedCents` is that maximum; `variance`
is budget minus it. Every existing variance is unchanged where nothing has
been spent, which is why the slice-3 test still passes untouched.

**THE UNCODED REMAINDER IS SAID, NOT HIDDEN.** A line tagged with the job
and no code is real cost that no row can carry; `jobCostReport` returns it
as `uncodedActualCents` and the page says how much, where it is (the job's
total), and where to fix it (the bill in Accounting). A code spent against
but never budgeted or ordered joins the report as a `Not budgeted` row, the
same treatment the ordered-but-unbudgeted row has had since slice 3.
`jobCostRows` stays as the rows alone.

Accrual figures. A job's cost is what was incurred; the cash lens is for
statements, not for holding a trade to its budget.

Tests: one more ops (three codes, one spent beyond its order, one spent
against with no budget, an uncoded line, and the other job's spend on the
same code; the whole-job figure agreeing), and the accounting suites above.
The guide's *What the report does not show yet* is gone.

**DRIVEN ON THE DEV BRANCH, on 24-108.** Before: *Budget $45,000.00 against
$62,000.00 ordered and $0.00 spent*, the one row reading **$62,000.00 ·
$0.00 · −$17,000.00**, and the note under the table: *$325,000.00 has been
spent on this job with no cost code on the line; it is in the job's total
below and in no row here* — the slice-6 drive's cost, which was tagged with
the job alone. Then a journal entry through Accounting: *Dr 5100
Subcontractor Expense $70,000.00* tagged **03 30 00 · Cast-in-place concrete,
24-108 · Oak Row residence — phase 2** (both tags on one line, from the same
popover) / *Cr 2000*, dated 2026-09-22 → the panel read *Budget $45,000.00
against $62,000.00 ordered and $70,000.00 spent*, the row **$62,000.00 ·
$70,000.00 · −$25,000.00** in red — Left now measured against the spend,
because it passed the order — the uncoded note unchanged at $325,000.00, and
the job's *Actual cost* tile **$395,000.00**, which is the row plus the
uncoded remainder. Not driven: a cash-basis tenant (the farm is accrual), and
a bill through the Purchases screen rather than the journal — the tags are
the same rows either way.

### 2026-09-14 — Slice 5c: retainage held from subcontractors (`claude/retainage-from-subs`, ADR 0061)

`job_sub_applications` and `job_sub_application_lines`, a page per
commitment (`/dashboard/m/jobs/[id]/commitments/[commitmentId]`), a
`Billed` column on the project's Ordered table, and the first posting to
`2120 Retainage Payable` — the account the construction profile seeded on
its first day and nothing had touched through six slices.

**THE OTHER SIDE OF THE TABLE, WITH THE SAME CERTIFICATE.** A subcontractor
bills the business the way the business bills its client: an application
against the subcontract saying how much of each line is complete to date,
less the retainage the business holds back, less what earlier applications
certified. So `sub-billing-ops.ts` is slice 5's billing section with the
parent swapped — `payApplicationTotals` unchanged, one draft per subcontract,
numbered after the last, frozen at approval, void only the latest — and
**the subcontract's lines are the schedule of values**: written when the
order was placed, no second setup. The pay-application editor took a `mode`
rather than a twin; the certificate, the rows and the totals are identical
and only the verbs and three words differ.

**AN APPROVED APPLICATION IS AN ORDINARY BILL** (ADR 0061):
`createBillDraft` → `approveBill`, a line per subcontract line for the work
this period to `5100 Subcontractor Expense` — tagged with the JOB AND THE
LINE'S COST CODE, which is what puts it in the job cost report's `Spent`
column and on the next cost-plus application — and a NEGATIVE line to `2120`
for what is held back. Dr expense (gross) · Cr Retainage Payable (held) · Cr
AP (net). The subcontractor's own reference becomes the bill number; the
vendor is made from the commitment's party through a new Accounting verb,
`ensureVendorForParty`, the twin of `ensureCustomerForParty`. Releasing is
the same line running the other way — the ops test walks a subcontract
through two applications and the final one at 0% carries *Retainage
released* 6,000 and pays it.

**SUBCONTRACTS ONLY.** A purchase order is billed with an ordinary bill;
retainage attaches to bought labour, not bought material — the reason
`job_commitments.kind` is a CHECK list of two, finally cashed in.
`NOT_SUBCONTRACT` refuses; the database cannot tell the kinds apart, so the
ops test proves the compensating control.

**A BILLED SUBCONTRACT LINE IS HELD BY RESTRICT.** `updateCommitment` replaces
lines on edit, and without the key, editing a subcontract that has been
billed against would have deleted the lines its certificates point at. Now
it refuses — which is right and unfriendly: changing a billed subcontract is
a change order's payable-side twin and an open item.

Migrations `0343_sub_billing.sql` (hand-reordered like the six before it) and
`0344_sub_billing_rls.sql`, applied to dev and prod before the merge;
`db:verify-rls` reports **211 tables** on both, `db:verify-modules` 19/19.
Tests: five more pure (statuses with `billed` where `issued` was, the
bill link both ways, retainage range and per-subcontract numbering, RESTRICT
and cascade, the two accounts), three more ops (the application from the
subcontract's lines and the three-line bill with its entry, dimensions and
the Spent column; the next application carrying the work and the release at
0%; the purchase order, second draft, nothing due and missing 2120
refusals, the held line, void latest-only with the bill), one more
isolation.

**DRIVEN ON THE DEV BRANCH, on 24-109.** *Order something* → kind
**Subcontract**, `SC-24109-1`, Pleasant Valley Feed Mill, one line `06 10 00
· Rough carpentry` $30,000.00, *Issued* → the Ordered table read **SC-24109-1
· Subcontract · $30,000.00 · Billed — · Issued** with the number a link, and
the job cost row *Ordered $30,000.00*. The subcontract's page: **Subcontract
value $30,000.00 · Billed to date $0.00 · Retainage held $0.00 · Balance to
finish $30,000.00**, the line at *0%*, *New application* enabled. *New
subcontractor application* → period to 2026-09-30, retainage 10 → the row
**$0.00 · 10% held · Draft**. *Open* → the same grid as a pay application
with *Bill dated* where *Issue on* was; *This period* `15000` → live: **50%
· Completed $15,000.00 · Retainage −$1,500.00 · Current payment due
$13,500.00 · Balance to finish $15,000.00**. *Approve as bill* — refused the
first time, in the words designed for it: *The chart of accounts is missing
something: the chart has no 2120 Retainage Payable account* (the farm
fixture has the general chart; `2120` was added through Accounting's *Add
account*, the way `1230`, `1240` and `2420` were on earlier slices). Second
time: **Billed · Bill · Open · Void**, tiles **Billed to date $13,500.00 · 1
application · Retainage held $1,500.00 · Balance to finish $15,000.00**, the
line at **50%**. In Accounting, the bill to Pleasant Valley Feed Mill, dated
2026-09-14, due 2026-10-14, *approved*: **Application 1 — subcontract line
through 2026-09-30 · 5100 · Subcontractor Expense · 15,000.00** and
**Retainage held (10%) · 2120 · Retainage Payable · (1,500.00)**, total
**13,500.00**. Back on the job: the *Spent* column on `06 10 00` went from
$39,650.00 to **$54,650.00**, *Actual cost* to **$55,500.00**, and the
Ordered table's new *Billed* column read **$13,500.00 · $1,500.00 held**.
Two things driving showed: a subcontract line with no description produced
a bill line called *subcontract line*, so the description now falls back to
the cost code's label; and the new-application dialog had no box for the
subcontractor's own invoice number, so `Their reference` was added to it in
commitment mode. Not driven: the release at 0% and the void — both in the
ops tests.

### 2026-09-14 — Slice 5b: cost plus a fee (`claude/cost-plus-a-fee`, ADR 0060)

The second way the market bills a job, parked by slice 5 as "a different
sum". Three nullable terms on the contract (`fee_ppm`, `fee_cents`,
`gmax_cents`), two frozen figures on the application (`cost_to_date_cents`,
`fee_to_date_cents`), one new table (`job_pay_application_costs`), a
`method` on a WIP line — and no new document, no new invoice path and no
schedule to set up.

**THE LEDGER IS THE SCHEDULE OF VALUES.** A cost-plus application's lines
are the books' cost tagged to the job as of the period end, by cost code —
`actualByCode` with an `asOf`, the same read the `Spent` column makes — with
what earlier issued applications billed on each code carried forward and
`this period` defaulting to the difference. Nothing to type but what to
leave out: less on a line leaves a disputed bill out, less than nothing
passes a credit on; the books' figure stays beside it. `syncCostLines` runs
on create, on every save and at issue, refreshing the books' figure and the
default while keeping anything typed (it compares the stored figure to the
old default to tell). The no-code line is a NULL `cost_code_id` and is billed
like any other; the pack does not decide a line is unbillable because nobody
coded it.

**TO DATE, NEVER BY WINDOW.** A bill dated inside September and posted after
September's application issued shows up as books-to-date greater than
previous, and October's application bills it. The ops test posts exactly
that bill and reads it on the next draft. Billing by window would have
dropped it between two closed periods, which every contractor has met.

**THE FEE, ROUNDED ONCE.** A share of cost to date (`feeCents`, the retainage
rule: on the total, half up), plus a fixed fee billed to date by hand
(`fee_to_date_cents` on the draft, refused above the fee itself), and the sum
capped at the guaranteed maximum. When the cap binds the invoice carries ONE
line saying so, because two lines that do not add up to the total is a
certificate a client questions. Otherwise the invoice reads cost, fee,
retainage — three lines a client can read without the application.

**THE SAME ROW, INVOICE AND VOID PATH.** `createPayApplication` skips the
schedule on a cost-plus contract; `updatePayApplication` takes `costLines`
and `feeToDateCents`; `issuePayApplication` computes either certificate and
posts the same invoice with the same retainage line; `listPayApplications`
returns `costs` and a `costPlus` figure set beside `lines` and `totals`, a
cost-plus draft reading the books as they are now the way a fixed-price draft
reads the schedule as it is now. `contractBilling`, `voidPayApplication` and
the WIP schedule's billings read are untouched.

**ONE COST-PLUS CONTRACT BILLS A JOB.** Cost belongs to the project, so a
second cost-plus contract on it would bill the same dollar twice;
`ONE_COST_PLUS` refuses the moment it starts an application. A fixed-price
contract beside a cost-plus one is fine — the pilot's design agreement before
a build.

**WORK IN PROGRESS, SECOND METHOD.** A job whose only counted contract is
cost-plus earns cost to date plus the fee on it, capped, with no estimate
asked for; `method` is frozen on the line with the rest so the schedule a
bank was shown says how. A job mixing methods falls through to cost-to-cost
and is left out with `no_value` — its cost cannot be split between the two.

**THE CONTRACT PAGE READS THE BILLING METHOD**, which closes the slice-5 open
item that said nothing did: a schedule of values for the four fixed-value
methods, a *Cost plus a fee* panel (the terms, and the books' cost on the job
by code) for cost-plus, and a plain note for unit price and time-and-
materials. The contract form shows the three term boxes only when the method
asks for them. The project page's edit dialog passes the terms through, so an
edit cannot blank them — the failure the form's shape would otherwise have
produced silently.

Migrations `0341_cost_plus.sql` (as generated: the new table references
existing tables only, so nothing to reorder) and `0342_cost_plus_rls.sql`,
applied to dev and prod before the merge; `db:verify-rls` reports **209
tables** on both, `db:verify-modules` 19/19. Tests: eleven more pure (the
terms and their floors, the two halves, the cost lines' table, the WIP
method, every billing method in exactly one group, the certificate line by
line including the once-rounded fee, the fixed fee beside a percentage, the
cap, the next application against the last, WIP on a cost-plus job), five
more ops (the draft from the books and the three-line invoice with its
entry; the late bill and a line kept short across two applications; the
fixed fee, the cap's one line and the second cost-plus contract refused;
the refusals and a fixed-price contract untouched; WIP cost plus fee capped
and the mixed job falling through), two more isolation.

**DRIVEN ON THE DEV BRANCH, on a new job, 24-109 Miller barn conversion**
(seeded by script with three tagged costs: $28,400 and $11,250 on `06 10
00 · Rough carpentry`, $850 on the job alone). *Add contract* → kind
`cost_plus_build`, with Tractor Supply Co, *Billed by* **Cost plus a fee**
— and the three boxes appeared under it — *Fee % of cost* `15`, *Guaranteed
maximum* `60000`, *Signed* → the project's contracts table read **Cost plus
build · Barn conversion · Cost plus a fee · — · Signed**, worth $0.00. The
contract's page: **Fee 15% of cost · Cost to date $40,500.00 · Billed
$0.00 · Retainage $0.00 · Guaranteed maximum $60,000.00, $60,000.00 left
to bill**, a *Cost plus a fee* panel with **06 10 00 · Rough carpentry
$39,650.00 / No cost code $850.00**, and *New application* enabled with no
schedule. *New application* → period to 2026-09-30, retainage 10 → the row
read **$46,575.00 · $40,500.00 cost + $6,075.00 fee · 10% held · $4,657.50 ·
$41,917.50 · Draft**. *Open* → two rows with *This period* pre-filled from
the books; the no-code line typed to `0` → *$850.00 left unbilled* under it,
the certificate live: **Cost to date $39,650.00 · Fee (15%) $5,947.50 ·
Cost plus fee $45,597.50 · Retainage −$4,559.75 · Current payment due
$41,037.75 · Balance to the guaranteed maximum $14,402.50**. *Issue as
invoice* → **Issued · INV-0007 · Open**, tiles **Billed to date $41,037.75
· Retainage held $4,559.75 · $14,402.50 left to bill**. In Accounting,
INV-0007 to Tractor Supply Co, memo *Pay application 1 · 24-109 ·
cost_plus_build · Barn conversion*, three lines: *Application 1 — cost
incurred through 2026-09-30* 39,650.00 and *Fee (15% of cost)* 5,947.50 to
**4000 · Sales** (the farm chart has no 4030), *Retainage withheld (10%)*
(4,559.75) to **1230 · Retainage Receivable**, total 41,037.75. The WIP
schedule as of 2026-10-31 then listed 24-109 as **Contract — · % — ·
Earned $46,575.00 · Billed $45,597.50 · Under-billed $977.50 · Profit to
date $6,075.00** — cost plus fee, the dumpster's $850 and its fee still to
bill, measured with no estimate and no blocker. Not driven: a fixed fee
typed to date, the cap binding, a second application after a late bill,
and the ONE_COST_PLUS refusal — all four are in the ops tests.

### 2026-09-14 — The first letter of every panel (`claude/jobs-panels-padding`)

**Found by the founder on production, on the Test tenant's first job.** Every
panel on every page of this pack — the project, its daily log, a contract,
the cost code lists — was a bare `<Panel>` with its content flush against the
edge, and `Panel` is `overflow-hidden rounded-2xl` with no padding of its own
(it is the surface a `DataTable` sits on edge to edge). So the first glyph of
any line inside the rounded corners was clipped: *etails*, *ontracts*, *ob
cost*, *unch list*, *othing ordered yet*. Seven slices were driven by reading
the page's TEXT, which does not know what a corner hid — the one thing a
screenshot would have shown on day one. Every jobs panel now carries `p-5`,
the convention the livestock and asset pages already had; the WIP page's
inner `p-4` wrappers moved onto the panel to match. No behaviour changed.

**The lesson, recorded so the next pack does not repeat it:** a pack's first
page should be looked at, not only read, and a `Panel` needs padding unless
what it holds is a full-bleed table.

### 2026-09-14 — Slice 6: what the work is worth, not what was billed for it (`claude/work-in-progress`, ADR 0059)

`job_wip_periods` and `job_wip_lines`, one page (`/dashboard/m/jobs/wip`),
and the pack's first journal entry of its own: **the work-in-progress
schedule** — percent complete, earned revenue, under- and over-billing per
job as of a period end — and **the adjustment that trues revenue up to the
work**, posted through Accounting's `postEntry` and reversed the next day.
Built after slice 7, because the founder chose the field first; numbered 6
because that is where the design put it.

**EVERY INPUT ALREADY EXISTED, WHICH IS WHY THE SLICE IS SMALL.** Contract
value is slice 1 plus slice 4's approved changes (`projectValues`); the
estimated cost is slice 3's revised budget summed per job (`budgetByProject`,
new); cost to date is `actualByProject`, which gained an `asOf`; billings are
`billedByProject`, new and the same query on income accounts, negated. All
four read as of the period end, through the project's cost object, and the
pack reads no Accounting table. The one thing a person types is the
**re-estimated total cost** per job per period — the input a monthly WIP
meeting exists to produce — and null means the budget stands, so a business
that never re-estimates types nothing.

**COST-TO-COST, CAPPED, AND A FINISHED JOB IS DONE.** `wip-math.ts` is pure
and `tests/jobs.test.ts` pins it: percent complete is cost over estimate in
parts per million, truncated, capped at 100%; earned is the contract at that
percent, rounded half up, through BigInt because a nine-figure contract times
a million passes 2^53; a job marked `complete` is 100% whatever its cost
says; under and over are two columns and never netted. A job with nothing to
divide by has a null percent and a badge, not a zero.

**WHICH JOBS ARE ON IT.** Every job of the company with a contract value, a
cost or a billing as of the date; never a cancelled one; a completed one
until its billings catch its value, then it drops off, because a schedule of
every job ever finished stops being readable within a year. A job with no
budget and no estimate BLOCKS the period by name (`ESTIMATE_REQUIRED`) — a
schedule missing a job is exactly what a bank would not accept, and posting
the rest quietly would be worse than refusing. A job with billings and no
fixed value blocks likewise (`BILLED_NO_VALUE`); one with no value and no
billings — a spec home accumulating cost — is shown and left out
(`reason = no_value`).

**THE ENTRY, AND WHY IT REVERSES ITSELF** (ADR 0059). One pair of lines per
job, tagged with the job: `Dr 1240 / Cr revenue` for a job billed behind its
work, `Dr revenue / Cr 2420` for one billed ahead, both accounts the
construction profile seeded for exactly this and both refused by name when a
chart lacks them. Dated the period end, source `wip_adjustment` (a new value
of `journal_entry_source`, drizzle/0339, in `MANAGED_SOURCES` so the journal
refuses to void it), and a second entry with the same source, negated,
`reverses_entry_id` set, dated the next day. Because every period's entry is
the whole figure and reverses, the books between period ends carry billings,
the month-end statements carry earned revenue, and — the reason that matters
to this pack — `billedByProject` read as of any later period end sees each
earlier adjustment and its reversal together and nets them to nothing, with
no filter on the source and no knowledge of its own earlier entries. The
idempotency key carries the period's version, so a period unposted and posted
again is a new pair rather than the voided one answering. Periods post
FORWARD ONLY (`NOT_FORWARD`) and only the latest unposts
(`NOT_LATEST_PERIOD`), the way a close is reopened latest-first.

**FROZEN AT POSTING, LIVE WHILE A DRAFT.** Six figures per line are written
down when the period posts — contract, estimate, cost, billed, percent,
earned — and the page reads those, not the ledger, for a posted period; a
bill dated inside the period that lands late changes the next period's
opening and never the schedule a bank was shown. Unposting voids both
entries through `voidEntry` (Accounting's refusals — a closed period, a
reconciled line — arrive in its own words), zeroes the frozen figures and
keeps the estimates. The same rule an issued pay application's totals follow.

**A WIP ADJUSTMENT IS NOT CASH.** `src/packs/jobs/basis-lens.ts` is the
pack's provider in `basis-lens/registry.ts`: under the cash basis every
`wip_adjustment` entry is dropped whole. The construction dossier's finding
that "percent complete is not a basis lens" stands — a lens may not INVENT the
adjustment, which is why the pack posts a real entry; it may say the entry
does not belong in a basis, which is what this does. One indexed read,
nothing on a tenant that never posted one.

**PER COMPANY, LIKE A CLOSE.** The period carries `entity_id` and is unique
per `(entity, period_end)`; a tenant with one company never sees the picker.
The ops tests give every test its own company for the same reason a
schedule is per company: every job the earlier tests made on the default one
would land on it, most with no budget, and block every post with a refusal
about somebody else's job.

Migrations `0339_job_wip.sql` (the enum value first, then the two tables,
hand-reordered like the five before it) and `0340_job_wip_rls.sql`, applied
to dev and prod before the merge; `db:verify-rls` reports **208 tables** on
both, `db:verify-modules` 19/19. Tests: eleven more pure (the indexes and
CHECKs mirrored, the enum value first in the file and used nowhere in it,
the two accounts seeded as an asset and a liability, and the arithmetic case
by case including the ten-figure contract), six more ops (the schedule with a
measured and an unmeasured job and an as-of date before the cost; posting
with both entries read back line by line and by dimension, the ledger's
revenue-by-job reading earned at the period end and billings the day after,
the frozen period against a live next one; the estimate replacing the budget
for one period and turning an under-billing into an over-billing; the five
refusals; unpost latest-only with the estimate kept and a re-post as a new
pair; the cash lens dropping the adjustment), four more isolation (read and
write across tenants, the company and project FKs, one period per company
per date and the posted↔entry CHECK, cascade from the period and from the
project). `ledger` and `discovery-prompt` re-run for the enum and the source
set.

**DRIVEN ON THE DEV BRANCH, on Hilltop Farm's 24-108.** The schedule as of
`2026-08-31` read the job at **$1,962,000.00** contract, **$45,000.00**
estimated cost, nothing spent and **nothing billed** — the September pay
application correctly outside an August period end — and *Billings equal
earned revenue on every measured job, so there is nothing to post*. As of
`2026-09-30`: billed **$370,900.00**, over-billed the same, and the red
line *The chart of accounts has no 2420 account. Add it in Accounting
first*, with the button disabled. `1240` and `2420` were added through
Accounting's own *Add account*. A cost was posted through Accounting's
journal — *Dr 5100 Subcontractor Expense $325,000.00* tagged `24-108 · Oak
Row residence — phase 2` / *Cr 2000 Accounts Payable*, dated 2026-09-20 —
and the schedule read **$325,000.00 · 100% · earned $1,962,000.00 ·
under-billed $1,591,100.00**: the whole job earned against a $45,000
budget, which is exactly what the re-estimate exists for. `1300000` typed in
the box → **budget $45,000.00** underneath, **25% · earned $490,500.00 ·
under-billed $119,600.00 · profit to date $165,500.00**, the period listed
as *Draft*. *Post the adjustment* → **Posted on 2026-09-14 · figures frozen
· the adjustment · its reversal on 2026-10-01**, the estimate box now a
plain *$1,300,000.00 re-estimated*. The adjustment in Accounting's journal:
*2026-09-30 · wip adjustment · Work in progress through 2026-09-30 —
Hilltop Farm · posted · Reversed by this entry*, two lines — **1240 Costs
in Excess of Billings 119,600.00** and **4000 Sales 119,600.00** (the farm
chart has no 4030, so the fallback posted), each tagged *24-108 · Oak Row
residence — phase 2* — and no *Void* button, because the source is managed.
*Unpost* → *Draft* again with the $1,300,000 estimate kept and the entry
panel back; *Post the adjustment* again → *Posted*, a new pair. Two things
driving showed: the estimate box saves on blur (Enter blurs it), and the
pane's `type` action never reached React's state, so the first attempt saved
nothing — `form_input` plus a click elsewhere did. Not driven: a
two-company tenant's picker (the farm has one company) and a closed period's
refusal.

### 2026-09-14 — Slice 7: the first slice somebody on a site touches (`claude/the-first-slice-on-a-site`)

`job_daily_logs` and `job_daily_log_crews`, a daily-log page per project
(`/dashboard/m/jobs/[id]/log`), two panels on the project page — **On site**
and **Punch list** — and the pack's first tell source. Everything the design
calls "field" and is not those two tables is a seam this pack already had:

- **A daily log is one row per project per day.** A superintendent keeps ONE
  report per job, and "poured the slab" said at nine and "framers started"
  said at two are two lines of the same day, not two days — so the unique
  index is `(project, date)` and `saveDailyLog` UPSERTS. `appendNotes` adds a
  line; `notes` replaces; `crews` replaces the lines the way a document's do;
  anything omitted is left alone. Removing a day takes its crews by cascade
  and DETACHES its photos, because the pictures may be the evidence.
- **Manpower is a headcount, not payroll.** A crew line is a trade or a
  subcontractor on file, how many, and hours each in tenths. It is who was on
  the site — the framer's crew as much as the company's own — and it is what
  an owner's representative reads and a delay claim is argued from. It is NOT
  a time entry: the `time` module records the company's own people to the
  minute for wages, and a subcontractor's crew never appears there. The two
  answer different questions and the guide says so.
- **Photos are Documents' rows**, hung on the DAY through
  `document_attachments` (`extension_slug = 'jobs'`, `entity_type =
  'job_daily_log'`) — the livestock pack's slice 4b pattern, exactly: the
  pack owns the actions (`attachLogPhotoAction` and its two siblings) and core
  owns the table; both gates (`jobs` and `documents`) and both write rules
  (`allowsWrite(member)` and the DMS's `roleMayWrite`), because the accountant
  clears the first and not the second; and `assertLog` is the compensating
  control for a polymorphic reference no foreign key polices. The gallery is
  the shared `RecordPhotos`.
- **The punch list is Work's rows**, linked to the PROJECT through
  `work_item_links` (`entity_type = 'project'`) via `createWorkForEntity` —
  never a second task engine (extension-model.md §4b). The panel adds and
  ticks; assigning, dating and chasing are the Work module's. `addPunchItem`
  and `setPunchDone` name the entity type, which is the one thing only the
  owning pack may do.
- **Everything here is a chore — `member`, not `owner`.** The person with the
  phone on the site is rarely the owner, and a daily log only an owner could
  write would be written by nobody. Same split livestock drew for a photo.

**THE TELL SOURCE.** `src/packs/jobs/tell/source.ts`, registered third in
`tell-sources/registry.ts` (a day on a site is said by everyone on it, every
day; a farm has `jobs` off and never sees it). Two actions, and they are not
the same kind of safe:

- `jobs.log` — *"poured the garage slab at Oak Row, four guys, six hours"* —
  appends a line to the day and, when the sentence carries a headcount or
  hours, a crew line (`"Crew"` when no trade is said: four guys with no other
  word is the company's own). READ BACK AND CONFIRMED (ADR 0050's default): a
  line on the wrong job is visible only to somebody who opens that other job,
  which fails the first of the three tests.
- `jobs.punch` — *"punch item at 24-108: garage door doesn't close"* — raises a
  work item linked to the project and RECORDS ITSELF, the way `work.add` does:
  on a list, one press to remove, moves nothing.

**Which job is SEARCHED, never listed** (ADR 0052): `tell/find.ts` is pure —
number first ("24-108" is the one thing a builder says exactly), then name,
then street, then a word in common, then everything open. Never edit distance:
"Lot 12" is one character from "Lot 13", and choosing on distance is how a day
gets logged on the wrong house. Only open projects are offered; a finished
job is not something anybody is standing on. Three sentences joined the
golden set, each with its `why`: a headcount that sounds like a timecard, a
punch item that sounds like `work.add`, and a delay that is a non-event.

Migrations `0337_job_field.sql` (hand-reordered like the four before it) and
`0338_job_field_rls.sql`, applied to dev and prod before the merge;
`db:verify-rls` reports **206 tables** on both. Tests: ten more pure (the
one-per-day index, the crew CHECKs, RESTRICT and cascade, the entity types,
hours to tenths, and the finder pinned case by case — Lot 12 is not Lot 13),
five more ops (upsert and append, crews replaced and added and refused, staff
allowed, delete, the punch item as a linked work item), five more isolation,
and a new db suite `tests/jobs-tell-source.test.ts` (nothing offered without
a job; the finished job not offered; two sentences land on one day with the
crew; the punch item in Work's own table). Every tell db suite re-run,
because adding a source changes what every tenant is offered.

**DRIVEN ON THE DEV BRANCH, on 24-108.** *Log today* → weather `Clear, 78°`,
two lines of report, one crew row *Concrete · 4 · 6.5* → *Log it*. The
**Daily log** page read **2026-09-14 · Clear, 78° · 4 on site · 26 man-hours**,
the two lines, the crew table *Concrete 4 6.5*, and the photo strip with
*Add a photo* and *No photos yet* — the shared gallery, on a day, with this
pack's gates. Back on the project page, *Touch up paint in the master bath* →
*Add* → **1 open** with the item and its checkbox; ticked → **Nothing open.**
The Work module's list no longer shows it, because it is done — the ops test
is what proves it was Work's row all along. The upload itself was not driven:
the browser pane cannot hand a page a file (open item).

**And the sentence.** The tell box on the project page, typed (the pane
blocks the microphone): *poured the garage slab at Oak Row, four guys, six
hours* → *Read it* → one card, **Logged on site · Jobs**, with *Which job* =
**Oak Row residence — phase 2 · 24-108 · Luxury custom · 118 Oak Row** (found
by the street), *What happened* = `Poured the garage slab.`, *How many* 4,
*Hours each* 6, *Which day* today — read back, not recorded. *Record 1 thing*
→ toast *Oak Row residence — phase 2: Poured the garage slab. — crew 4 × 6h*,
and the Daily log page read **Clear, 78° · 8 on site · 50 man-hours**, the
day's notes with the third line appended, and a second crew row *Crew 4 6*.
One sentence, the same day, no second report.

### 2026-09-14 — Slice 5: the schedule of values, and the draw against it (`claude/pay-applications`)

`job_sov_lines`, `job_pay_applications`, `job_pay_application_lines`, and the
first page in this pack that BILLS: one per contract
(`/dashboard/m/jobs/[id]/contracts/[contractId]`), with the schedule of
values above and the pay applications drawn against it below. The four
numbers the earlier slices built — worth, planned, ordered, spent — now have
the fifth that pays for them: **billed**.

**ONE MODEL FOR THE PILOT'S THREE BILLING METHODS.** Fixed price billed
monthly on progress, an AIA pay application, and a home's draw schedule are all
percent-or-milestone against a fixed sum: a schedule of values breaks the
contract into lines (one line for a monthly draw, a G703 for the AIA form,
milestones for the draw schedule) and each application says how much of each
line is complete to date. The G702 falls out — completed and stored to date,
less retainage, less previous certificates, is the **current payment due** —
in `billing-math.ts`, pure, so the form shows the same numbers the server
writes and `tests/jobs.test.ts` pins every one. Cost-plus, unit price and T&M
are different sums and are not here; the contract records them and nothing
bills them yet.

**AN ISSUED APPLICATION IS AN ORDINARY INVOICE
([ADR 0058](../decisions/0058-a-pay-application-is-an-ordinary-invoice.md)).**
`issuePayApplication` freezes the certificate and posts it through
Accounting's own verbs — `createInvoiceDraft` → `issueInvoice`, the path the
platform's own revenue takes — with two lines: the work earned this period to
contract revenue (`4030`, else `4000`), tagged with the project's cost object
so the job's revenue is on every report; and the retainage withheld this
period as a NEGATIVE line to `1230 Retainage Receivable`, the account the
construction profile seeded for exactly this. The entry is Dr AR (net) · Dr
Retainage Receivable (held) · Cr Revenue (gross). AR, aging, reminders,
payments and the cash lens see it with no second ledger, and the pack never
reads Accounting's tables to follow the link — `loadInvoice`, `voidInvoice`
and a new Accounting verb, `ensureCustomerForParty`, are the whole seam.

**RELEASING RETAINAGE IS NOT A SECOND FEATURE.** A later application at a
lower rate — the final one at 0% — computes less retainage to date than the
last certificate held, so the "withheld this period" is negative, the line to
`1230` is positive, and the invoice collects what was held. The ops test walks
a contract through three applications and the third releases the ten
thousand held by the first two with no code path of its own.

**WHAT IS FROZEN AND WHAT IS LIVE.** A draft's figures are computed from its
lines and the schedule as it is NOW, and a draft picks up schedule lines added
after it was started (an approved change order's). An issued application's
five totals and each line's scheduled value are written down at issue, so the
certificate a client signed reads the same whatever the schedule becomes —
the same rule an invoice's tax and a change order's price follow.

**THE RULES THAT REFUSE.** One draft per contract at a time (`ONE_DRAFT`) —
each carries the previous one's figures forward, and two open at once would
each claim to be next. Nothing due, nothing issued (`NOTHING_DUE`). Nobody on
the other side, nobody billed (`COUNTERPARTY_REQUIRED`). A chart with no
`1230` cannot withhold (`ACCOUNT_MISSING` names the code — a pack must not
create accounts in a business's chart). A schedule line an application has
billed against cannot be removed (`SOV_LINE_BILLED`; the RESTRICT is the
backstop) but its value can change, because every certificate froze the value
it saw. Only the LATEST issued application can be voided (`NOT_LAST`), and
Accounting refuses to void an invoice with payments on it — the pack hands
Accounting's refusals on in Accounting's own words, through `friendlyMessage`.

**`this period` MAY BE NEGATIVE.** An over-billing on an earlier application
is corrected on the next one, which is how the G703 has always worked; a line's
total to date may not go below zero, and that is a CHECK.

**THE PACK'S STATUS HAS NO `paid`.** Whether the client has paid is the
invoice's business, read from it when shown; a second copy would be the drift
every derived status in accounting exists to prevent.

Migrations `0335_job_billing.sql` (hand-reordered like 0329 and 0333) and
`0336_job_billing_rls.sql`, applied to dev and prod before the merge;
`db:verify-rls` reports **204 tables** on both. Tests: twelve more pure (the
CHECKs mirrored, the G702 arithmetic line by line, retainage rounded once, the
release, the negative period, percent boxes to ppm and back), nine more ops
(the schedule replaced whole and the billed line held, one draft at a time,
the invoice's lines, accounts, entry and dimensions, the carry-forward and the
release across three applications, the three refusals, void of the latest
only and the invoice with it, a draft picking up new lines, staff refused),
seven more isolation (read, write, cross-tenant contract, the issued-has-
invoice CHECK, RESTRICT on a billed line, per-contract numbering, cascade).

**DRIVEN ON THE DEV BRANCH, on 24-108's New Home contract.** *Set up the
schedule* → *One line for the whole contract* → the tiles read **Scheduled
$1,854,500.00** with the red *not on the schedule* note gone. *New
application* at 10% → *Open* → `370,900` this period → the G702 under the grid
read **$370,900.00 · −$37,090.00 · $333,810.00 · $0.00 · Current payment due
$333,810.00**, balance to finish $1,483,600.00. *Issue as invoice* was
refused twice, each time in the words designed for it: *Say who the contract
is with before billing it* (the contract had no counterparty — fixed from the
project page's edit dialog), then *The chart of accounts is missing something:
the chart has no 1230 Retainage Receivable account* — the farm fixture has
the general chart, not the construction profile's, so `1230` was added through
Accounting's own *Add account*. Third time: **Application 1 issued as an
invoice**; the row read *Issued · INV-0006 · Open* with a *Void* button, the
tiles **Billed to date $333,810.00 · Retainage held $37,090.00 · Balance to
finish $1,483,600.00**, the schedule line **20%**, and the project page's
contracts table *$333,810.00 / $37,090.00 held*. In Accounting, INV-0006 to
Tractor Supply Co, due in thirty days by the customer's terms, memo *Pay
application 1 · 24-108 · new_home*, two lines: *Application 1 — work
completed and stored through 2026-09-14* $370,900.00 to **4000 · Sales** (the
farm chart has no 4030, so the fallback was the one that posted) and
*Retainage withheld (10%)* (37,090.00) to **1230 · Retainage Receivable**,
total 333,810.00.

**One thing driving showed that the tests could not:** a refused issue leaves
the draft saved (the editor saves first, then issues), so the second attempt
starts from what was typed rather than from an empty grid. Worth keeping.

### 2026-09-14 — The profile arrives, and the pack takes its first seed (`claude/the-construction-profile`)

No screen changed. What changed is that every seam this pack left open now
has something on the other side of it: the `construction` profile
([construction.md](construction.md)) supplies `packConfig.jobs.deliveryMethods`
and `.contractKinds`, so the project and contract forms show a picker instead
of a free-text box for the first time outside a test; `customer` renders as
*Client*; and two starter cost code lists arrive with the profile.

**THE PACK OWNS ITS SEED.** `src/packs/jobs/seed-shape.ts` is the shape
(`CostCodeSetSeed`, parsed as tolerantly as `deliveryMethodsFrom` parses its
config) and `src/packs/jobs/seed.ts` the applier, registered in
`src/packs/seeds.ts` under this pack's slug
([ADR 0057](../decisions/0057-a-pack-registers-a-seed-applier-and-the-profile-carries-the-data.md)).
It writes through `createCostCodeSet` / `createCostCode`, so every seeded code
is a cost object; the first list a tenant ever gets becomes its default by the
pack's own rule; a list the tenant already has by that name is skipped WHOLE —
a business that pruned a starter list must not find the pruned codes back
after a re-install. Nothing about the profile is known here: the pack does not
import it, and a second industry's lists would arrive the same way.

### 2026-09-14 — Slice 4: original + approved changes = revised (`claude/original-plus-approved-changes`)

`job_change_orders` and `job_change_order_lines`, and the line every owner and
surety reads on every pay application — **original + approved changes =
revised** — computed on both halves of a job at once.

**A CHANGE ORDER BELONGS TO A CONTRACT, NOT A PROJECT.** It changes ONE
agreement: a custom home on its third of three contracts has a change order
against the New Home contract, not the concept-design agreement it grew out of,
and the pay application it appears on is that contract's. `project_id` is
reachable through the contract and deliberately not duplicated; `listChangeOrders`
joins through, and the join is the proof it does not need to be. Numbers are
unique per CONTRACT, so CO-1 on the drawings agreement and CO-1 on the build are
what they are on paper: two documents on two pay applications.

**PRICE ON THE HEADER, COST ON THE LINES, AND THEY ARE DIFFERENT NUMBERS.** A
change order has a price to the owner — `value_cents`, the revenue side — and
an estimated cost by cost code, the budget side. The price carries the markup;
a model that stored one and derived the other would be wrong on every job where
the markup is not flat, which is all of them. Zero lines is legitimate (a pure
price change); a zero price with lines is legitimate too (scope moved between
trades at no charge).

**REVISED IS COMPUTED, NEVER STORED.** `job_contracts.value_cents` stays the
original, `job_budget_lines.original_cents` was named for exactly this moment,
and revised is original plus the sum of APPROVED change orders, computed
wherever it is shown. A stored `revised_cents` would be a column that could
disagree with the rows it summarises, and nothing would be gained: the sum is
one indexed query. `projectValues` returns the revised value and the approved
changes beside it; `jobCostRows` returns `originalCents`, `changesCents` and
`budgetCents` (revised) per code. A code budgeted only by an approved change is
budgeted — it joins the report at the change, without the `Not budgeted` badge,
because that badge is for money ordered against a code nobody planned for and a
code the owner approved money onto has been planned for, late.

**WHEN A CHANGE COUNTS IS ONE PREDICATE, `countedChange`**: the change order is
approved AND the contract it changes is one whose value counts. An approved
change on a declined or cancelled contract is a change to nothing, and summing
it would grow a job the business never got. Both roll-ups in `ops.ts` and the
page's own in-memory sum read the same two exported constants, so three places
cannot hold three opinions about what "approved" means.

**THE FIRST MONEY IN THIS PACK THAT MAY BE NEGATIVE, ON PURPOSE.** Every other
amount carries a `>= 0` CHECK. A deductive change order — the owner drops the
pool — is `-18,500`, not a separate "credit" concept, and each cost line may go
either way. It has consequences one layer up: `formatMoney` drops the sign, so
every change-order figure and every revised total renders through
`formatMoneySign`, or a deduction prints as its own opposite.

**APPROVED NEEDS A DATE, BOTH WAYS, AND THE DATABASE SAYS SO.**
`job_change_orders_approved_has_date` is `(status = 'approved') = (approved_on
is not null)`. The date is the evidence; a status anybody can flip without one is
a status nobody has to justify. The action refuses an approved change with no
date (`APPROVAL_DATE_REQUIRED`) and CLEARS the date on anything else, because a
change taken back to proposed was not approved on that day after all and a form
should not have to know to blank the box. The form fills today into the box when
`Approved` is picked and the box is empty.

**A SIGNED CONTRACT'S VALUE IS LOCKED — AND THE BUDGET IS NOT.** Once an
agreement counts, its value is the ORIGINAL half of the line, and a value that
can still be edited in place makes the line meaningless; `updateContract` throws
`VALUE_LOCKED` and the form disables the box with `Signed. Change the value with
a change order.` A typo in a signed value is corrected by a change order, which
is what the business does on paper. The one exception is a signed contract whose
value was never recorded: filling it in once is entry, not revision. The budget
is NOT locked the same way, and the asymmetry is the point: a contract is an
agreement with another party, a budget is an internal plan, and the editor still
writes `original_cents` — it is handed the original, never the revised, or a
save would fold the approved changes into the original and count them twice.

### Four sentences that had never been said

`toResult` translated a duplicate job number, list name, code and order number
into a sentence by matching on `err.message`. **Not one of those translations
had ever fired.** Drizzle wraps the driver's error, so the message is `Failed
query: insert into …` — the SQL, never the constraint; the constraint is on
`err.cause`. A duplicate job number has said `Something went wrong. Try again.`
since slice 0. Found by the new suite asserting on the message and failing, which
is what the assertion is for; the time module had found the same thing on its own
tables and written `violatedUniqueIndex`, so that helper moved to
`src/lib/db-errors.ts` where a pack can reach it without importing another
module, and time re-exports it.

### Two holes found by driving it, both in the form

**An empty listbox.** The dev tenant's only cost code was retired (by slice 3's
own drive), so the line's `Cost code` dropdown opened on nothing and the form
said nothing about why — and a hidden blank row then failed the save with
`Every line on a change order needs a cost code.` An empty listbox is a form
lying about a choice it cannot offer. With no active codes the lines block is
now a sentence — *No active cost codes on this job's list, so the change cannot
be costed by code yet* — and the action is sent no lines at all, whatever a
hidden row might hold. The retired-code rule itself stands: a change order
offers active codes plus any it already names, the budget editor's rule one
table over.

**A sentinel with no item.** The first cut initialised a line's code to
`"__none__"` the way the commitment form does — but that form has a `No code`
item and this one deliberately does not, so Radix rendered neither the value
nor the placeholder and the trigger collapsed to a chevron. An empty string is
what shows a placeholder.

**Driven on the dev branch, on 24-108's New Home contract:** CO-1 *Add covered
porch*, price $12,500.00, approved today, no lines (no active code yet). The
contracts panel read **Worth $1,962,000.00 across 3 signed agreements,
including $12,500.00 in approved changes**, the New Home row **$1,854,500.00 /
orig. $1,842,000.00**, the job list **$1,962,000.00 / incl. $12,500.00 in
changes**. Then `03 30 00` un-retired on the cost-codes page and CO-1 edited to
carry one line, $5,000.00 against it: the job cost report read **Budget
$45,000.00 against $62,000.00 ordered, after $5,000.00 in approved changes**,
the row **$45,000.00 / orig. $40,000.00 · Left −$17,000.00**, and the change
order's Cost column $5,000.00. The edit dialog shows the contract as text with
*A change order stays on the agreement it was raised against*, and the New Home
contract's own edit dialog has its value box disabled with *Signed. Change the
value with a change order.*

### What was removed

`budgetTotals` shipped in slice 3 and nothing read it. Deleted, by the standard
this pack set for `PackDefinition.dimensionTypes` and `projectValues.openCount`:
a field nothing reads is worse than an honest absence. The job list still shows
worth only; planned, ordered and spent columns are a list-screen slice the day a
screen wants them.

Migration `0333_job_change_orders.sql` needed the same hand-reordering as 0325
and 0329 — two new tables referencing each other in one file — and
`0334_job_change_orders_rls.sql` is the pattern. Both applied to dev and prod
before the merge; `db:verify-rls` reports **201 tables** on both, and
`db:verify-modules` 19 of 19. Tests: nine more pure (the status CHECK mirrored,
the absent floor, the approval-date CHECK, no `project_id`, per-contract
numbering), thirteen more ops (approved-only counting, the deduction, a change
on a contract that does not count, the revised budget with its original kept,
the value lock and its exception, the date rule both ways, lines replaced and
an empty list as an instruction, per-contract numbering, staff refused, the
protected code), eight more isolation (read, write, cross-tenant contract and
code, the date CHECK, the negative, per-contract numbering, cascade).

### 2026-09-14 — Slice 3: what it was meant to cost (`claude/what-it-was-meant-to-cost`)

`job_budget_lines` — one amount per cost code per project — and the **job cost
report** that puts it beside what has been ordered. The fourth of the four
numbers, and the one that makes the other three mean something.

**THE SLICE ORDER WAS WRONG AND IS NOW CORRECTED.**
[construction.md](construction.md) had change orders as slice 3 and never
numbered the budget at all — it had been folded into slice 0, pulled out, then
deferred through slices 1 and 2 by this dossier's own build log. Change orders
lose that argument on the merits: **an approved change order revises both the
contract value AND the budget**, so building them first means building the
revenue half and retrofitting the cost half. Budget is 3; change orders are 4.

**PER CODE, NEVER PER JOB.** "The job is $40k over" is a fact; "the framing is
$40k over" is a decision, and only the second is worth a screen. The report is
one row per cost code: budget, ordered, left — with `left` negative and red when
a trade is over.

**EVERY CODE WITH EITHER A BUDGET OR AN ORDER APPEARS.** A code somebody ordered
against and never budgeted is the most interesting row on the page and the
easiest to leave out of the query; it shows with a `Not budgeted` badge.

**A BLANK BOX IS NOT ZERO**, and the form says so. Blank means "no plan for this
code yet"; zero means "carried at nil, so anything spent against it is a
variance". Writing one as the other would turn every untouched row into a fake
overrun, so blanks are dropped at the action rather than saved.

**A SAVE UPSERTS AND LEAVES OMITTED CODES ALONE** — the opposite of a
commitment's lines, which are replaced. The reason is the shape of the work: a
commitment's lines are one document somebody is editing in front of them, while a
budget is built up over weeks by different people. Replacing it would make "I
added the concrete number" quietly delete everything typed since the form was
opened. Removing a code is `removeBudgetLine`, said out loud.

**`original_cents` IS NAMED FOR SLICE 4.** A construction budget moves for one
legitimate reason, and the line every owner and surety knows is *original +
approved changes = revised*. Calling it `amount_cents` would have made the first
change order a migration plus an argument about which number the old column held.
There is no `revised_cents` yet because nothing would write it — the standard
this pack set by refusing `PackDefinition.dimensionTypes` and deleting
`projectValues.openCount` before it shipped.

### The column that is deliberately absent

**There is no per-code ACTUAL.** `getBalances` groups by ONE dimension type, so
it can answer *what has this project cost* or *what has this code cost across
every project* — not both. A per-code actual here would mean either reading
accounting's tables directly, which this pack must not do, or quietly reporting
another job's spend in this job's column. The project-level actual is on the page
as its own figure and the panel says why the code rows stop at "ordered".

Closing it needs `getBalances` to take a second group-by, which is accounting's
call and not this pack's to force.

**A hole found by driving it, the same shape as last slice's.** The budget editor
offered RETIRED cost codes. A retired code is one the business has stopped using
— `updateCostCode` already archives its cost object so it cannot be put on a
bill — and offering it for a new budget is the same mistake one layer up. It now
shows active codes plus any that already carry a budget, because retiring a code
must not strand a figure nobody can reach.

**Driven on the dev branch:** a $40,000 budget on `03 30 00`, then the existing
subcontract's first line coded to it. The report reads **Budget $40,000.00 ·
Ordered $62,000.00 · Left −$22,000.00** in red, while the job's Committed total
stays $100,500.00 — because the order's second line is still uncoded, which is
the honest difference between what a code has against it and what the job owes.

### 2026-09-14 — A module nobody could switch on (`claude/a-module-nobody-can-switch-on`)

**THE PACK WAS INVISIBLE ON PRODUCTION, AND HAD BEEN ALL WEEK.** The founder
asked why he could not see any of it. All six `job_*` tables were there, RLS
enabled and forced, `db:verify-rls` reporting 198 tables clean, four merged PRs —
and **no row in `modules`**, so the pack did not exist as far as the catalogue,
the superadmin registry or any tenant's nav was concerned.

**The cause is structural, not careless, which is why the fix is a check and not
a note.** [ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md)
makes applying a migration a conscious pre-merge ritual with its own verification
step. The SEED has neither. So a new pack's schema reaches production reliably
and its catalogue row does not — `db:seed -- --dev` had been run, because the dev
branch is where the feature was driven, and the production equivalent never was.

Three things now close it:

- **`npm run db:verify-modules`** — `verify-rls`'s sibling. Same invocation, same
  `--dev` flag, same exit code so it can gate a deploy. It reports what the code
  defines that the database lacks, and names the command that fixes it. **Proved
  to go red before it was trusted**: a fake module added to the catalogue and not
  to either database produced `✗ 1 module(s) MISSING from the database — nobody
  can switch these on` and exit 1.
- **`scripts/seed-catalogue.ts`** — the `MODULES` array extracted out of
  `scripts/seed.ts`, which calls `main()` at module load and so could never be
  imported by a test. `packs-and-profiles.md` had named this exact fix as the
  open item's remedy since Layer 2 shipped.
- **`tests/module-catalogue.test.ts`** — every registered pack and core module
  has a row; no pack is miscategorised (which would silently refuse an
  accountant's writes); no pack is `available` without a `Component`.

**The two halves are different failures and both were real.** The test proves the
code agrees with itself. The script proves a database agrees with the code. Only
the second would have caught this one.

AGENTS.md now carries the seed in the same before-the-merge list as the
migration, and "Adding a module" step 1 says **both** databases out loud.

**Still a human decision, deliberately:** which TENANT has a pack switched on.
The catalogue row makes it possible; `tenant_modules` makes it real, and that is
a sale, not a deploy step. `verify-modules` checks the first and says nothing
about the second, or it would nag forever about every pack nobody has sold.

### 2026-09-14 — Slice 2: committed cost, and a cost code becomes a cost object (`claude/committed-cost`)

`job_commitments` + `job_commitment_lines` — what the business has ordered — and
the change that makes a cost code worth having: **every code is now a
`dimension_members` row.**

**COMMITTED COST IS THE NUMBER A BUDGET IS USELESS WITHOUT.** A job that has
spent $400k of a $1.8m contract looks healthy right up until you notice it has
also issued $1.5m of subcontracts. Actual answers "what has been billed";
committed answers "what is already owed whether or not the invoice has arrived",
and only the second tells a builder whether the job is in trouble. It is the
thing a spreadsheet gets wrong most often, because the PO lives in one place and
the ledger in another.

**A COST CODE IS NOW A COST OBJECT, and accounting needed no change at all.** The
bill builder derives the dimension types it offers from whatever members exist
(`dimensionTypesFrom`), so codes simply appear on a bill line the moment they
sync. A project says WHICH JOB, a code says WHICH TRADE, and a line may carry one
of each because `loadDimensionMembers` refuses only two members of the *same*
type. That is the P5 seam paying for itself: one sync function in the pack, zero
lines in the module it reports through.

`0330` backfills the codes that already existed. A chart where some lines are
taggable and others silently are not is worse than one where none are, and the
difference would only surface as a bill somebody could not code. **It carries
`is_active` through**, so a code retired in the previous slice arrives archived
rather than quietly being offered again.

**ACTUAL COST COMES FROM A CORE EXPORT, NOT A QUERY OF ACCOUNTING'S TABLES.**
`actualByProject` asks `getBalances` for expense balances grouped by the
`project` dimension — which already applies the basis lens and the entity scope,
so a job cost figure that disagreed with the P&L is not reachable. The direction
stays core → lib → pack; accounting still knows nothing about this pack.

**Header and lines, not a flat table.** A framing subcontract covers labour and
materials under one agreement with one vendor and one number. Value and cost code
on the header would have been half the work today and a migration tomorrow. The
form offers one line and an "Add line" button, because one line is the common
case.

**Two asymmetries with `job_contracts`, both deliberate:**

- **`party_id` is NOT NULL here.** A contract may be proposed before the other
  side is a record in the books; a commitment with nobody to pay is not a
  commitment, it is a budget line.
- **`kind` is a CHECK list of two, not an open taxonomy.** A subcontract and a
  purchase order diverge in BEHAVIOUR later — retainage, lien waivers and
  certified payroll attach to bought labour and not to bought material — so the
  pack has to tell them apart. What each is *called* is a label; what each *is*,
  is this.

**Only `issued` and `closed` count as committed.** A draft is written but not
sent, so nobody is owed anything — the same shape of rule, and the same reason,
as a proposed contract not being revenue. One exported constant, read by the SQL
roll-up and by anything that sums.

**An edit REPLACES lines rather than merging them.** A line-by-line patch needs
stable ids round-tripping through a form and a rule for what a missing id means;
replacing is one delete and one insert inside the transaction the caller already
holds, and cannot leave a line nobody meant to keep. Omitting `lines` entirely
leaves them alone, so a status change does not disturb the money.

**A HOLE FOUND BY DRIVING IT.** The cost-code picker on a project was hidden
whenever the tenant had one list — the same "only at two" rule that stops a
single-company business being asked which company. But a project created *before*
the chart of cost existed has no list, and could therefore never be given one:
the control that would do it was hidden by the rule. The picker now also shows
when the row has no list and one exists. No test would have caught this; opening
the form did.

**The FK ordering bit again, exactly as predicted.** `job_commitment_lines`
references `job_commitments`, both new in `0329`, so drizzle-kit emitted the
constraint before the unique index it needs. Hand-reordered with the reason in
the file, as `0325` was — and `0327` needed nothing, which is the control case:
it only bites when two *new* tables reference each other.

**Driven on the dev branch:** a two-line subcontract (`SC-2041`, framing labour
$62,000 and materials $38,500) against Tractor Supply Co, issued. The project's
Ordered panel reads **Contract value $1,949,500.00 · Committed $100,500.00 ·
Actual cost $0.00** — actual is genuinely zero because no bill has been coded to
the job yet, which is the honest answer rather than a missing figure.

### 2026-09-14 — Everything you can create, you can change (`claude/everything-you-can-create-you-can-change`)

Edit surfaces for all three things the pack owns — a project, a contract, a cost
code and its list — plus **the ops test file the first two slices did not have**.
No new tables and no migration.

**ONE DIALOG THAT EDITS WHEN GIVEN A ROW**, rather than a parallel set of edit
components. `vendor-dialogs.tsx` set that pattern (`vendor?: VendorData` →
"Edit vendor" : "New vendor"), and following it means the create and edit paths
cannot drift apart in what they validate or which fields they offer.

**THE VERSION GOES WITH THE EDIT.** `updateProject` and `updateContract` have
taken an optional `version` and thrown `STALE_VERSION` since they were written;
until now nothing passed one, so the check existed and never ran. Two people on
one job is now a refusal with a sentence rather than the last save silently
winning. `tests/jobs-ops.test.ts` pins it for projects, contracts and cost code
lists.

**RETIRED, NEVER DELETED.** A cost code gets `is_active = false`, which takes it
off the list people pick from and leaves every cost already charged to it exactly
where it is. There is no delete verb on the row at all, and the dialog says why
rather than offering one. Same rule `archiveDimensionMember` applies to a cost
object, for the same reason: a code that vanished would take a year of job
history with it. A code may still be RENUMBERED in place, which is what a
business moving from its own scheme to CSI actually does.

**A COST CODE LIST CANNOT BE RE-POINTED**, only renamed. Which list a project is
budgeted against is resolved once at creation precisely so a later change cannot
silently re-chart a job already underway; letting a list be swapped wholesale
would do that to every project at once.

### The three behaviours that had never been tested, and now are

`tests/isolation/jobs.test.ts` builds its fixtures under `withSystem` and never
calls `ops.ts` — deliberately, because it certifies what the DATABASE enforces.
That left the pack's own rules uncovered, and the three that matter are all
**silent** when they break rather than throwing:

- **the cost object follows a rename** — otherwise the job list says one thing,
  every report says another, and nothing errors;
- **cancelling archives it and completing does not** — because bills arrive for
  months after a job finishes (retainage, the last subcontractor invoice) while a
  job that never happened should not be offered on a bill line at all;
- **a stale version is refused.**

All three passed first time, which means the code was right and the tests are now
the guard rather than the discovery.

**A trap the classifier caught.** `tests/jobs-ops.test.ts` first imported its
`d`/`RUN` gate from `./isolation/_shared`. That type-checks and runs — and
`tests/db-backed-files.test.ts` classifies a suite as database-backed by looking
for `process.env.DATABASE_URL` or a `d`/`RUN` import from a **sibling**
`_shared`, so the suite would have landed in the PARALLEL project and raced the
other database suites. That is the once-a-fortnight failure on a machine nobody
is watching, and the enumeration test exists exactly to stop it. The gate is now
declared inline, as `land-ops` and its neighbours do.

**Driven on the dev branch:** a proposed change order edited to signed, and the
project total moved from $1,854,500.00 to **$1,949,500.00 across 3 signed
agreements** with the "still proposed" clause gone; the project renamed to
"Oak Row residence — phase 2" and the cost object followed it in
`dimension_members`, confirmed in the database as well as on the page; a cost
code retired and shown greyed with a `Retired` badge.

### 2026-09-14 — Slice 1: a contract is a table (`claude/contracts-many-per-project`)

`job_contracts`, many per project, plus the value roll-up and the form that
writes them. **No pay applications, no retainage, no schedule of values** —
those are the billing slice, and a column nothing reads is worse than an honest
absence.

**A CORRECTION TO `construction.md`: there is no `direction` column.** The
dossier's data model listed one — *"`direction` says whether the pilot bills it
or is billed on it"* — while its prose two hundred lines earlier already said the
true thing: *"`commitments` stays what the company issues outward; `contracts` is
what it bills against."* Both cannot hold. Once commitments are their own table
on the cost side, every row here is billed BY the business and direction has
nothing left to distinguish.

What genuinely varies is **`role`**: `prime` (the business holds the contract
with the owner) or `subcontract` (it holds a subcontract under somebody else's
GC — the pilot's cabinet shop and excavation division on other people's jobs).
Both are billed by the business; what changes is who the counterparty is and,
later, whether retainage is held FROM it. `tests/jobs.test.ts` asserts the column
is absent, so a future slice that adds one has to argue with a test first.

**`sequence`, not dates, keeps the ladder in order.** Concept Design →
Construction Drawings → New Home is the order the agreements were made, and a
drawings contract signed late is still the second step. A new contract lands at
the end.

**ONLY SIGNED AND COMPLETE CONTRACTS COUNT toward what a job is worth**, and this
is the one rule in the slice with a money consequence. A concept the client has
not signed is not revenue; a total that quietly included it would report the
business as bigger than it is, which is the number an owner takes to a bank. The
rule is one exported constant, `VALUED_CONTRACT_STATUSES`, read by both the SQL
roll-up in `projectValues` and the project page's own sum — two places that must
never disagree about what a job is worth.

**`billing_method` is a CLOSED list, unlike `kind`.** A kind is a word, and a
pack shipping that list would know its industry; a billing method is a *sum*, so
the pack has to implement one before it can honestly offer it and adding one is a
migration. Seven are declared, the pilot uses three (`progress_draw`,
`schedule_of_values`, `draw_schedule`). **Slice 1 only records which applies.**

**A BUG FOUND BY DRIVING IT, with a money consequence.** Adding two contracts in
a row: the second silently inherited `Complete` from the first, because the
dialog is one component and `submit()` cleared the text fields but not the
selects. An unsigned proposal would have been recorded as money owed. Status,
role and billing method now reset — all three, because a form that remembers some
fields and forgets others is worse than one that forgets all of them. No test
would have caught this; two clicks did.

**Driven on the dev branch**: three agreements on `24-108 Oak Row residence` —
Concept Design $12,500 complete, New Home $1,842,000 complete, Change Order 1
$95,000 proposed. The panel reads *"Worth $1,854,500.00 across 2 signed
agreements, with 1 still proposed"*, and the job list's SQL roll-up agrees with
the page's own sum to the cent. `$1,842,000` and `12,500` both parsed from what a
person actually types.

### 2026-09-14 — Slice 0: the project spine (`claude/jobs-the-project-spine`)

Three tables, the dimension sync, and the two screens that make them usable.
**No contracts, no budget, no commitments** — those are slices 1 and 2 in
[construction.md](construction.md), and a project with actual cost against it is
already the thing a spreadsheet does worst.

**THE DIMENSION SYNC IS THE POINT, not the screen.** `createProject` writes
`dimension_members` in the SAME transaction, so from the first project every bill
line and every timecard can be charged to a job and every accounting report that
already exists groups by it — with no change to accounting, which must never
learn this pack exists. A project that existed without its cost object would be
an entity no report can group by, which is the failure
[packs-and-profiles.md](packs-and-profiles.md) names when it says a pack that
tracks activity without syncing a dimension member "has built a to-do list".

**The three coordinates are deliberately not the delivery method:** `entity_id`
(whose books — required, ADR 0010), the enterprise (which division — optional,
and a different question), and the cost code set (which chart it is budgeted
against). The pilot's Construction, Excavation and Cabinet Shop are three
enterprises inside ONE entity.

**`delivery_method` is nullable, and that is the feature.** A project may begin
before anyone knows what gets built — the pilot's first contract on a custom home
is a Concept Design agreement, and the client may look at the number and walk.
Most software in this market requires a build to exist before a job can, which is
exactly why pre-construction revenue ends up in a spreadsheet. ADR 0056.

**DRIVEN ON THE DEV BRANCH, by hand.** A project was created through the form,
its cost object confirmed in `dimension_members` (`24-108 · Oak Row residence`,
active), a cost code list added and the first-list-becomes-the-default rule
watched working, and a code (`03 30 00 Cast-in-place concrete`) added to it. The
conditional pickers behaved as designed: Hilltop Farm has one company and no
divisions, so neither picker appeared, and with no profile installed the kind of
work was a free-text box rather than an empty dropdown.

**Those rows are still on the dev branch, deliberately.** A farm tenant with a
custom home on it reads oddly; it is the only way to exercise this pack before
the `construction` profile exists, and slice 1 will want a project to hang a
contract off.

**A BUILD ERROR THAT `tsc` AND `eslint` BOTH MISSED**, found only by opening the
page: `export const PACK = "jobs"` in a `"use server"` file. Such a file may
export nothing but async functions, and neither the typechecker nor the linter
says so — `npm run build` had passed too, because the pages that import it did
not exist yet when it ran. `PACK` now lives in `vocabulary.ts`, which is where
the other packs keep theirs. **A green `tsc`, a green lint and a green build are
not a rendered page**, and this pack cost one browser load to learn it again.

**Three more things found while building it, worth more than the code:**

- **`PackDefinition` has no `dimensionTypes` field.** The "shapes" section of
  [packs-and-profiles.md](packs-and-profiles.md) shows one, and every pack that
  syncs a dimension does so without declaring it. Not added here: nothing reads
  it, and a field nothing reads is worse than an honest absence. Recorded in that
  file's open items instead.
- **The icon registry catches nobody.** `getIcon` falls back to a generic box
  rather than throwing, and its own header records that five packs once shipped
  showing that box because their key was never added. `hard-hat` was added in the
  same commit as the pack, which is what the header asks for — there is still no
  test.
- **A composite FK needs its unique index to exist FIRST**, and drizzle-kit emits
  every `ADD CONSTRAINT` before every `CREATE INDEX`. That is fine when the
  referenced table is older and fatal when both are new in one file, which is the
  case here: `0325_jobs.sql` is hand-reordered, with the reason written into the
  file, because regenerating it would silently undo the move.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `job_cost_code_sets` | A named list of cost codes. One or several per tenant. | FORCE RLS, member-wide. `job_cost_code_sets_one_default_idx` is a PARTIAL unique index, so **two defaults fail at the database** rather than depending on the action having cleared the first. |
| `job_cost_codes` | One line of the chart of cost. | Composite FK to `(tenant_id, set_id)`, **cascade** — deleting a list deletes its codes. `code` is free text, never a number: CSI writes `03 30 00`, NAHB writes `1000`, a builder writes `CONC-SLAB`. `sort_order` is what orders the list, so a code never has to be sortable to be right. |
| `job_contracts` | **Many per project.** Kind, value, billing method, counterparty, role, status, a `sequence` that keeps the ladder in agreed order — and, since slice 5b, the cost-plus terms `fee_ppm` / `fee_cents` / `gmax_cents`, nullable, read only when the method is cost plus a fee; since 5d, `labor_rate_cents` — one rate for every hour on a time-and-materials contract, null for each person's rate from Time, locked once an application has issued. | Composite FK to the project, **cascade** — a project's agreements are part of it, proved in the isolation suite rather than assumed, because a dangling contract would still be summed by `projectValues`. `kind` is an open taxonomy (format check only); `role`, `status` and `billing_method` are CHECK lists. **No `direction` column** — see the build log. |
| `job_budget_lines` | What each cost code was PLANNED to cost. | One line per code per project, enforced by a unique index rather than by the action remembering — two would make every variance ambiguous. `cost_code_id` is NOT NULL, unlike a commitment line's: a budget without a code is a single number for the whole job, which is what this table exists to stop being the answer. `original_cents` is the ORIGINAL; revised is original plus approved change-order lines, computed by `jobCostRows` and never stored. RESTRICT to the code, so a budgeted code is retired and never deleted. |
| `job_change_orders` | A change to ONE contract: its price to the client (`value_cents`), its status, and when it was approved. | Composite FK to the CONTRACT, **cascade** — never to the project, which is reachable through the contract and deliberately not duplicated. Number unique per `(tenant, contract)`. `value_cents` **may be negative** — the one money column in the pack without a floor; a deduction is a negative number, not a credit concept. `job_change_orders_approved_has_date` makes `(status = 'approved') = (approved_on is not null)` a database fact, both ways. |
| `job_change_order_lines` | What the change costs, one cost code at a time — the budget side. | Cascade from the change order; **RESTRICT to the cost code**, the same rule as a commitment line and a budget line. `amount_cents` may be negative. Zero lines is legitimate: a pure price change. |
| `job_sov_lines` | A contract's schedule of values: how the sum breaks down, by trade, phase or milestone — or, on a unit-price contract, the items: a `unit`, an estimated `quantity_thousandths` and a `unit_price_cents`, both or neither (CHECK), the value being the one times the other, computed on save (5f). | Cascade from the contract. Optional cost code (RESTRICT) and the approved change order that added the line (cascade). `scheduled_cents` ≥ 0; quantity and price ≥ 0 when present. Should sum to the revised contract value; the page says when it does not, a CHECK does not — a schedule is built before it is complete. |
| `job_pay_applications` | One draw against a contract: the G702 — or, on a cost-plus contract, the cost-plus certificate, with `cost_to_date_cents` and `fee_to_date_cents` frozen at issue beside the five totals (zero on a fixed-price application), and since 5d `labor_to_date_cents` (zero unless time and materials). | Numbered per contract, void ones included. `status` draft/issued/void — **no `paid`**, that is the invoice's word. `retainage_ppm` 0–1,000,000. Five totals FROZEN at issue. `invoice_id` RESTRICT to Accounting's `invoices`; CHECK `(status = 'draft') = (invoice_id is null)`, both ways. |
| `job_daily_logs` | One report per project per day: weather, what happened. | Unique `(tenant, project, log_date)` — the whole design; `saveDailyLog` upserts and `appendNotes` adds a line. Cascade from the project. Photos hang on it through Documents' `document_attachments` (`entity_type = 'job_daily_log'`), detached when the day goes. |
| `job_daily_log_crews` | Who was on site that day: a trade or a subcontractor, how many, hours each (tenths). | Cascade from the day; `party_id` RESTRICT to `parties`. CHECK `workers >= 0`, `hours_tenths >= 0`, and that a line names a trade OR a party. A HEADCOUNT, not a time entry — the two are not joined. |
| *(punch list)* | What still needs fixing: Work's `work_items`, linked to the project. | No table of this pack's. `work_item_links` with `extension_slug = 'jobs'`, `entity_type = 'project'`, through `createWorkForEntity` — never a second task engine. |
| `job_wip_periods` | One work-in-progress schedule per COMPANY per period end: its status, and the adjustment and reversal it posted. | Unique `(tenant, entity, period_end)`. RESTRICT to the company and to both entries. CHECK `(status = 'posted') = (entry_id is not null)`, both ways, and a reversal needs its adjustment. `status` draft/posted. |
| `job_wip_lines` | One job on a schedule: the re-estimate typed for the period (`estimate_cents`, null = the budget), six figures FROZEN at posting (zero while a draft), and the `method` that measured them: `cost_to_cost`, `cost_plus` or `time_and_materials`. | Cascade from the period and from the project. `percent_complete_ppm` 0–1,000,000; `reason` is `''`, `no_value`, `no_estimate` or `no_rate` — why the job was left out of the entry. Over/under is not stored: it is earned − billed. |
| `job_pay_application_costs` | One line of a COST-PLUS application per cost code (NULL = no code): the books' figure to date, what earlier applications billed, what this one bills. | Cascade from the application; **RESTRICT to the code**. Unique per `(application, code)`; the no-code line is kept single by the sync. `this_period_cents` may be less than the difference (a bill left out) or negative (a credit passed on). See ADR 0060. |
| `job_pay_application_labor` | One line of a TIME-AND-MATERIALS application per person and rate: Time's approved worked minutes on the job at that rate as of the period end, what earlier applications billed of them, what this one bills, and the cents. | Cascade from the application; **RESTRICT to Time's `time_workers`** — a person with billed hours is deactivated, never deleted. Unique per `(application, worker, rate_cents)`; `rate_cents` NOT NULL with 0 meaning no rate found, so the key is never null. `minutes_to_date` ≥ 0; `this_period_minutes` may be negative (hours credited back). See ADR 0062. |
| `job_pay_application_lines` | One line of the G703 per schedule line; on a unit-priced item, `quantity_previous_thousandths` (carried) and `quantity_this_period_thousandths` (typed, may be negative) beside the money, which is the quantity at the price (5f). | Cascade from the application; **RESTRICT to the schedule line** — billed lines are never removed. `previous` and `stored` ≥ 0; `this_period` may be NEGATIVE (a correction); CHECK that the three sum to ≥ 0, and that the two quantities do. `scheduled_cents` frozen at issue. |
| `job_commitments` | What the business has ORDERED: a purchase order or a subcontract. | `party_id` is NOT NULL — a commitment with nobody to pay is a budget line, not a commitment. `kind` is a CHECK list of two because the two diverge in behaviour later. Number unique per tenant: a vendor quotes it back on the invoice. Cascade from the project. |
| `job_commitment_change_orders` | A change to ONE commitment — a subcontract change order or a purchase-order revision: number, title, the client-side statuses, the approval date, and the client's change order it passes down, if any (4b, ADR 0065). Its MONEY is the commitment lines tagged with it. | Cascade from the commitment; **RESTRICT to `job_change_orders`** — the client's change a sub change passes down cannot go from under it, and must be on the same job (the verb checks). Number unique per `(tenant, commitment)`. CHECK `(status = 'approved') = (approved_on is not null)`, both ways, as the client-side row. |
| `job_sub_applications` | A subcontractor's application against a SUBCONTRACT: the G702 read from the other side of the table. | Numbered per commitment, void ones included. `status` draft/billed/void. `retainage_ppm` 0–1,000,000. Five totals FROZEN at approval. `bill_id` RESTRICT to Accounting's `bills`; CHECK `(status = 'draft') = (bill_id is null)`, both ways. Cascade from the commitment. See ADR 0061. |
| `job_sub_application_lines` | One line per subcontract line: previous, this period, stored. | Cascade from the application; **RESTRICT to the subcontract line** — a billed line cannot be replaced out from under its certificate. `this_period` may be negative; the total to date may not — on a DEDUCTIVE line (a change order's negative line) the floors flip: completed to less than nothing and never more, `scheduled_cents` kept equal to the line's amount by the sync while a draft (4b). |
| `job_selections` | A decision the client owes (8, ADR 0067): name, room, cost code, the allowance the contract set aside, the date it is needed by, pending / selected / approved / cancelled, the date decided, and the change order its difference was raised as. | Cascade from the project; **no action to the contract, the change order and the code** (retired, never deleted). `allowance_cents` ≥ 0. The difference — chosen price less allowance — is computed, never stored; while the raised change order stands, the allowance and the choices are fixed (the verb). |
| `job_selection_choices` | What is on offer for a selection, one row each: description, supplier, reference, a price by the unit (both or neither, ADR 0064's thousandths) or as a sum, `price_cents` the extended figure, and `is_selected` for the client's pick. | Cascade from the selection; no action to the party. **One chosen per selection**: a partial unique index on `(tenant, selection) where is_selected`. Price, quantity and unit price ≥ 0; the unit pair both or neither. Nothing points at a choice, so an edit replaces by id. |
| `job_estimates` | The job priced before anybody signs (10, ADR 0069): a number unique per job, title, draft / sent / accepted / declined / superseded, sent / decided / valid-until dates, the three rates in ppm — markup on cost (the lines' default), overhead on the subtotal, profit on the subtotal plus overhead — notes, and the contract an accepted one became. | Cascade from the project; **no action to the contract**. CHECK: status on the list, every rate 0..10,000,000 ppm (`RATE_PPM_MAX`), number present. Nothing stores a total: `estimate-math.ts` computes them. Accepted, the rates and lines are fixed by the verb, not the database. Since 10b (ADR 0070) also `presentation` (CHECK lines / codes / sum) and the proposal's `scope`, `exclusions` and `terms` — the words fixed with the money, the presentation free. |
| `job_estimate_lines` | One line of an estimate: cost code, description, unit, quantity in thousandths (1000 = one, a lump sum), unit cost, an optional markup of its own, an optional unit price that wins over any markup, notes, sort order. | Cascade from the estimate; **no action to the code**. CHECK: description present, quantity / unit cost / unit price ≥ 0, markup 0..10,000,000 ppm or null. Written by id (updated, inserted, removed when left out), so a line keeps its identity across an edit; nothing points at one. |
| `job_party_documents` | What a subcontractor or supplier has on file with the business (11b, ADR 0068): the party, an open-taxonomy `kind` (format-checked; three suggested), title, issuer, number, issued and expires dates, a coverage limit, requested / received / void with the receipt date, notes. The scanned copy is a Documents attachment (`job_party_document`). | **No action to the party** — one with documents on file cannot be merged away. CHECK: the kind is a slug; received has its date, requested has none, void keeps what it had; limit ≥ 0. Standing (missing / expired / expiring / ok) is derived against today and the tenant's required list, never stored. |
| `job_drawing_sets` | One issue of a job's drawings (ADR 0072): name, the date on the drawings (`issued_on`, which orders the issues), who issued it (a party), notes. Its PDFs are cabinet documents hung on it through `document_attachments` (`job_drawing_set`). | Cascade from the project; **no action to the party**. CHECK: name present. The current set is never stored — it is derived from the issues' dates. |
| `job_sheets` | One page of one of a set's files with the number the trade calls it by, normalised on write, a title and a revision mark. | Cascade from the project, the set AND the document (a page of a file that is gone is nothing to open). UNIQUE (set, number) and (set, document, page). CHECK: number present, page ≥ 1. The discipline is read off the number, never stored. |
| `job_phases` | A phase or milestone of a job's schedule (ADR 0071): the calendar item that holds its dates, name, kind, planned / underway / done, the predecessor and its lag, the party doing it, the cost code, notes, order. | Cascade from the project AND from its `schedule_items` row (a phase without its item is nothing); **no action to itself, the party and the code** (the verb re-points successors before a removal). One phase per item. CHECK: kind, status, lag within a year, not its own predecessor. The dates are NOT here — they are the item's. |
| `job_lien_waivers` | A lien waiver as a RECORD (11a, ADR 0066): the claimant (any party), the job, the order and the billed application it covers, its kind (conditional/unconditional × progress/final), the through date, the amount, and whether it was requested or received. The signed copy is a Documents attachment (`job_lien_waiver`). | Cascade from the project and the order; **no action to the party and to the application** — who signed is held, and a named application stays. CHECK: received has its date, requested has none, void keeps what it had; amount ≥ 0. Nothing here says "outstanding": the gap is derived from the applications' bills at read time. |
| `job_commitment_lines` | The money, one cost code at a time — the lines the order was placed with (`change_order_id` null) and each change order's, tagged with it (4b). | Cascade from the commitment and from the change; **RESTRICT to the cost code**, which is the backstop for "codes are retired, never deleted". Amount non-negative on an original line — a credit is a change order — and a change's line may be negative, the one exception in the CHECK. A line counts when it is original or its change is approved: `countedCommitmentLine`, one predicate for every roll-up. |
| `job_projects` | The spine. | FOUR composite FKs, each certified in `tests/isolation/jobs.test.ts`: company, division, client, cost code list. `delivery_method` is an open taxonomy (P1) with a **format check and no value check**, and is nullable. `metadata` is the P2 extension bag. |

Migrations `0325_jobs.sql` / `0326_jobs_rls.sql` (slice 0) and
`0327_job_contracts.sql` / `0328_job_contracts_rls.sql` (slice 1), each applied
to dev and prod before its merge, per
[ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md).
`0329_job_commitments.sql` / `0330_job_commitments_rls.sql` (slice 2) and
`0331_job_budget.sql` / `0332_job_budget_rls.sql` (slice 3) and
`0333_job_change_orders.sql` / `0334_job_change_orders_rls.sql` (slice 4,
hand-reordered like 0329) and `0335_job_billing.sql` / `0336_job_billing_rls.sql`
(slice 5, hand-reordered the same way) and `0337_job_field.sql` /
`0338_job_field_rls.sql` (slice 7, likewise) and `0339_job_wip.sql` /
`0340_job_wip_rls.sql` (slice 6, built after 7; likewise, and 0339 first adds
`wip_adjustment` to `journal_entry_source`, which nothing in the file uses)
and `0341_cost_plus.sql` / `0342_cost_plus_rls.sql` (slice 5b; as generated,
since the new table references existing ones only) and `0343_sub_billing.sql`
/ `0344_sub_billing_rls.sql` (slice 5c, hand-reordered) and `0345_time_and_materials.sql` / `0346_time_and_materials_rls.sql` (slice 5d; as generated) and `0347_unit_price.sql` (slice 5f; columns and CHECKs on two existing tables, so no RLS migration) and `0348_commitment_change_orders.sql` / `0349_commitment_change_orders_rls.sql` (slice 4b; as generated — the new table's unique index lands before the lines' key to it) and `0350_lien_waivers.sql` / `0351_lien_waivers_rls.sql` (slice 11a; as generated, one new table referencing existing ones) and `0352_selections.sql` / `0353_selections_rls.sql` (slice 8; hand-reordered — two new tables, the selections' unique index ahead of the choices' key) and `0354_party_documents.sql` / `0355_party_documents_rls.sql` (slice 11b; as generated) and `0356_estimates.sql` / `0357_estimates_rls.sql` (slice 10; hand-reordered — two new tables, the estimates' unique index ahead of the lines' key) and `0358_proposal.sql` (slice 10b; four columns and a CHECK on `job_estimates`, so no RLS migration) and `0359_job_phases.sql` / `0360_job_phases_rls.sql` (the schedule; hand-reordered — a self-referencing key needs the table's own unique index first) follow the same rule —
and from slice 3 the pair is `db:verify-rls` **and `db:verify-modules`**, after
the pack shipped invisible for want of a catalogue row. `db:verify-rls` reports **220 tables**, all enabled, forced and with
policies, on both.

**0327 needed no hand-reordering, which confirms the diagnosis in 0325.** Both
tables it references — `job_projects` and `parties` — are from earlier
migrations, so their unique indexes already existed when the FKs were added. The
ordering only bites when two new tables reference each other in one file.

## Key files & seams

- `src/packs/jobs/drawings-ops.ts` + `drawings-math.ts` — the sets and sheets
  (ADR 0072): the file is Documents' (`registerAttachedFile` with
  `docKind: "drawing"`, `attachDocumentToRecord`), the pack keeps which page
  is which sheet and which issue is newest; `currentIssues` derives the
  current set, `guessSheet` reads a title block from pdf.js text, and
  `components/pdf-reading.ts` runs pdf.js in the browser over the bytes it
  already has.
- `src/packs/jobs/ops.ts` — the write surface. Owner-only, and forced from below:
  `upsertDimensionMember` calls `requireOwnerRole`, so a staff-created project
  could not sync its cost object.
- `src/packs/jobs/actions.ts` — `requireTenant()` + `requireModuleEnabled()` +
  `withTenant(..., { role })`, the three things AGENTS.md asks of a pack.
- `src/packs/jobs/vocabulary.ts` — **ships no list of delivery methods and no
  list of cost codes**, on purpose. Both would make the pack know its industry.
  `deliveryMethodsFrom(config)` reads the profile's suggestions, total by
  construction like `speciesFrom` and `runKindsFrom`.
- `src/packs/jobs/JobsModule.tsx` — the job list. One statement with four left
  joins, not a lookup per row.
- `src/app/dashboard/m/jobs/[id]/page.tsx` — one project. **Says on the face of
  the page whether the cost object exists**, because nothing else in the product
  would, and the alternative is discovering it from a report quietly missing a
  column.
- `src/app/dashboard/m/jobs/cost-codes/page.tsx` — the chart of cost.
- `src/packs/jobs/seed-shape.ts` + `seed.ts` — what a profile may seed into
  this pack (starter cost code lists) and the applier that writes it through
  the pack's own ops, registered in `src/packs/seeds.ts` (ADR 0057).
- `src/packs/jobs/components/change-order-form.tsx` — price and cost typed
  separately, negative allowed, `Approved` fills the date box.
- `src/packs/jobs/field-ops.ts` — the daily log, its crews, and the punch list
  as Work items; the one place that names `job_daily_log` and `project` as
  the entity types Layer 0 rows hang on.
- `src/packs/jobs/tell/source.ts` + `tell/find.ts` — what a site can say in
  one sentence (`jobs.log`, `jobs.punch`), and the pure search for which job.
- `src/packs/jobs/components/daily-log-form.tsx` + `punch-list.tsx`, and
  `src/app/dashboard/m/jobs/[id]/log/page.tsx` — the day, the crews, the
  photos (Documents' `RecordPhotos`) and the list.
- `src/packs/jobs/wip-ops.ts` — the work-in-progress schedule (live or frozen),
  the estimate, and the two verbs that move the ledger: `postWip` (the
  adjustment and its reversal through `postEntry`) and `unpostWip` (both
  through `voidEntry`). Reads Accounting only through `getBalances`.
- `src/packs/jobs/wip-math.ts` — percent complete, earned, under and over,
  pure and BigInt-safe; the page and the posting compute the same figures.
- `src/packs/jobs/basis-lens.ts` — the pack's provider in
  `src/lib/basis-lens/registry.ts`: a WIP adjustment does not exist under the
  cash basis.
- `src/app/dashboard/m/jobs/wip/page.tsx` +
  `src/packs/jobs/components/wip-controls.tsx` — the schedule, the estimate
  box, and the post and unpost buttons.
- `src/packs/jobs/billing-math.ts` — the G702 arithmetic, pure: the form and
  the server compute the same certificate from it.
- `src/packs/jobs/components/sov-editor.tsx` + `pay-application-editor.tsx` —
  the schedule and the G703 grid, with the totals live.
- `src/packs/jobs/sub-billing-ops.ts` — a subcontractor's applications: the
  subcontract's lines as the schedule, the certificate, the bill through
  Accounting's `createBillDraft` + `approveBill`, retainage to `2120`,
  `commitmentBilling` for the project page. The receivable side's twin.
- `src/app/dashboard/m/jobs/[id]/commitments/[commitmentId]/page.tsx` — one
  commitment: its lines and, on a subcontract, its applications. The
  pay-application editor in `mode="commitment"`.
- `src/packs/jobs/components/cost-plus-editor.tsx` — a cost-plus draft: the
  books' cost by code, what to bill of it, the fee, the cap, the certificate
  live. `billing-math.ts`'s `costPlusTotals` is the arithmetic both it and
  the issue share. In `mode="time_and_materials"` a labour table sits above
  the cost table, hours typed and minutes stored.
- `src/packs/jobs/ops.ts` — the *time and materials* section: `laborOnJob`
  (Time's approved worked hours on a job, priced by the rate in force on the
  day or the contract's flat rate), `syncLaborLines`, `timeEnabled`,
  `laborCostByProject`; `actualByCode` with `{ withoutLabor }`. The pack's
  one read of the `time` module is `listRates`; the tables it joins are
  Time's, through `schema`.
- `src/lib/labor-posting.ts` — `LABOR_EXPENSE_SUBTYPE`, how a pack tells
  the wages accounts from the rest without knowing the accrual's codes.
- `src/app/dashboard/m/jobs/[id]/contracts/[contractId]/page.tsx` — one
  contract's billing: schedule above, applications below, five tiles on top.
- `src/packs/jobs/certificate-model.ts` + `certificate-pdf.tsx` +
  `certificate.ts`, and `src/app/api/jobs/applications/[id]/pdf/route.ts` —
  a pay application as a PDF: the pure model (every word and figure), the
  layout, the rows-to-model mapping with the brand, and the GET route. The
  invoice PDF's split, file for file (ADR 0063).
- `src/lib/db-errors.ts` — `violatedUniqueIndex`, the constraint name from
  `err.cause`. Every unique-index sentence in `actions.ts` goes through it,
  because matching on `err.message` never fired (slice 4 build log).

## Decisions & gotchas

- **[ADR 0072](../decisions/0072-a-drawing-set-is-an-issue-of-pages-in-documents-and-the-current-set-is-derived.md)** —
  a drawing set is an issue of pages in Documents, a sheet is a page with a
  number, and the current set is DERIVED as the newest issue of every number
  — never a flag. The browser reads the title blocks (the number-shaped line
  nearest the bottom-right corner); the server stores what was confirmed.
  A sheet points at the document, not a version: replacing the file's bytes
  in the cabinet changes what the sheet shows, and a reissue is a new set.
- **[ADR 0071](../decisions/0071-a-jobs-schedule-is-its-phases-as-items-on-the-business-calendar-and-a-move-pushes-what-follows.md)** —
  a phase is a calendar item on the business's Job schedule; core owns the
  dates and the pack owns the order, the dependency, the trade and the
  status. Finish-to-start with a lag; a move pushes what follows and never
  pulls anything earlier. A self-referencing table needs its unique index
  hand-moved ahead of its own key in the migration.
- **[ADR 0070](../decisions/0070-a-proposal-is-the-estimate-at-its-price-and-its-words-are-fixed-with-the-money.md)** —
  the proposal is the estimate printed at its PRICE: overhead and profit
  spread into the lines (the schedule's spread), cost and markup never on
  the page, three ways to show the price. Scope, exclusions and terms live
  on the estimate and are fixed with the money once accepted; a new
  estimate starts with the last one's terms. Rendered on request, never
  stored.
- **[ADR 0069](../decisions/0069-an-estimate-prices-the-job-before-anybody-signs-and-accepting-it-names-the-contract.md)** —
  an estimate line carries COST and PRICE as two numbers (a markup on cost,
  the line's or the estimate's, unless a unit price is typed, which wins);
  overhead sits on the subtotal and profit on the subtotal plus overhead;
  nothing extended is stored. Accepting names the contract and sets its
  value through the ordinary verb (so a signed one refuses), and fixes the
  estimate. Budget and schedule are two more deliberate acts, never
  automatic on accept — and **the schedule an estimate writes totals the
  contract sum**, overhead and profit spread across the lines, because a
  schedule short of the contract under-bills every draw. A line sold by the
  unit keeps its quantity with the unit price raised by the same share.
- **[ADR 0056](../decisions/0056-a-delivery-method-belongs-to-the-project-not-the-tenant.md)** —
  the flavour of construction is a property of the PROJECT. A pack must never
  branch on `delivery_method`; it is data a project TEMPLATE reads, and a pack
  that said `if (deliveryMethod === "commercial")` would have re-created the
  industry branch with a new spelling.
- **The first cost code set becomes the default**, whether or not anybody asked.
  A business with one list must never be asked which list a project uses, and a
  first set that was not the default would make every project carry an explicit
  choice forever.
- **A project's cost code set is resolved ONCE at creation**, not read through.
  A tenant that later changes its default must not silently re-chart a job
  already underway — the same reasoning as a profile seed being copied rather
  than resolved live (ADR 0009).
- **Cancelling a project archives its cost object; completing one does not.**
  Closing a job does not stop bills arriving against it — retainage and the last
  subcontractor invoice turn up months later — whereas a job that never happened
  should not be offered on a bill line at all. Archiving keeps every tag already
  made reporting.
- **The whole project is visible to every member**, including its client and its
  dates. On a construction job those are the numbers people are most often told
  not to discuss. A business wanting them hidden from its own field staff needs a
  per-project visibility model, which is a bigger question than this pack and one
  nobody has asked; Documents' owners-only folder is where a contract with a
  price in it belongs today. Said out loud in `0326_jobs_rls.sql` too.
- **A change order belongs to a CONTRACT, and revised is computed, never
  stored.** `value_cents` and `original_cents` stay the originals; revised is
  original plus approved changes, summed where it is shown. One predicate,
  `countedChange` — approved AND the contract counts — is what every roll-up and
  the page share. See the slice 4 build log.
- **A signed contract's value is locked; a budget is not.** An agreement with
  another party moves by change order; an internal plan is edited. `VALUE_LOCKED`
  in `updateContract`, the box disabled in the form, and one exception: a signed
  contract with no value yet may be filled in once.
- **A change order is the only money here that may be negative**, so every
  figure it touches renders through `formatMoneySign`. `formatMoney` drops the
  sign and would print a deduction as its own opposite.
- **The field is a chore, and its two other halves are not this pack's rows.**
  Daily logs and crews are `member`-level; photos are Documents' attachments
  hung on the day and punch items are Work's items linked to the project, each
  through the Layer 0 seam every pack uses. A daily log's manpower is a
  headcount, never a time entry — the `time` module is wages, this is who was
  on the site.
- **`jobs.log` is read back; `jobs.punch` records itself.** ADR 0050's three
  tests, applied inside one source: a line on the wrong job is not visible on
  a screen this person already looks at; a punch item on a list is.
- **Work in progress is a snapshot and a self-reversing entry** —
  [ADR 0059](../decisions/0059-work-in-progress-is-a-snapshot-and-a-self-reversing-entry.md).
  Cost-to-cost, capped; the re-estimated total cost is the one human input;
  the adjustment is dated the period end and reversed the next day, so the
  ledger's own billings-by-job read needs no filter on the pack's source.
  Periods post forward only and unpost latest-first. Under the cash basis the
  entries are dropped whole by the pack's lens.
- **Left is the budget less the GREATER of ordered and spent**, never the
  sum: a subcontract's bill is its commitment arriving, and adding the two
  would count one dollar twice. `projectedCents` on the row is that maximum.
- **Actual per code comes from the ledger sliced to the job, never from a
  second group-by over every job.** `withinMemberId` on `getBalances`; the
  pack still reads no Accounting table.
- **A job that cannot be measured stops the whole period.** No budget and no
  estimate, or billings with no fixed value, refuses by job number rather than
  posting the rest. A schedule missing a job is what a bank would not accept.
- **A subcontractor's application is an ordinary bill, and retainage held is
  a negative line to a payable** —
  [ADR 0061](../decisions/0061-a-subcontractors-application-is-an-ordinary-bill.md).
  The subcontract's lines are the schedule; the bill's lines carry the job
  and each line's code; `2120` is credited for what is held and debited when
  it is released; subcontracts only. One editor, two modes.
- **A cost-plus application bills the ledger's cost to date, not the bills** —
  [ADR 0060](../decisions/0060-a-cost-plus-application-bills-the-ledger-not-the-bills.md).
  The books' tagged cost by code is the schedule of values; to date, never by
  window, so a late bill is billed next time; the fee on the total, rounded
  once, capped at the GMAX; the same row, invoice and void path as a
  fixed-price application; one cost-plus contract per job.
- **A time-and-materials application bills approved hours at a rate, and
  the books' cost without them** — [ADR 0062](../decisions/0062-a-time-and-materials-application-bills-approved-hours-at-a-rate.md).
  The hours are Time's, approved and tagged with the job, at the rate in
  force on the day or one flat rate on the contract; lines keyed by person
  and rate; the wages accounts left out of marked-up cost by subtype; a rate
  of nothing refused by name; the flat rate locked once billed; the same
  row, invoice and void path; WIP's third method, with `no_rate` a reason.
- **The contract page reads the billing method, and only the method.** Four
  fixed-value methods get a schedule; cost plus a fee gets the books' cost;
  time and materials gets Time's hours and the books' cost without the
  wages; unit price gets a note. Never the kind.
- **A subcontractor's documents hang off the party, and the only behaviour
  a kind carries is its expiry** — [ADR 0068](../decisions/0068-a-subcontractors-documents-hang-off-the-party-and-the-only-behaviour-a-kind-carries-is-its-expiry.md).
  Per party; an open taxonomy of kinds with three suggested; the required
  list a tenant config value with a default; standing derived against today
  (missing, expired, expiring, ok); the chase Work on the party; nothing
  blocks a payment.
- **A selection is a decision with an allowance and priced choices, and its
  difference moves by change order** — [ADR 0067](../decisions/0067-a-selection-is-a-decision-with-an-allowance-and-priced-choices-and-its-difference-moves-by-change-order.md).
  One model for the option book and the allowance list; one chosen choice
  at the database; the difference computed and raised as an ordinary change
  order once approved, fixed while that stands; the reminder Work on the
  selection; a member's chore except the money.
- **A lien waiver is a record with a kind and a through date, and the gap
  is derived from the payment** — [ADR 0066](../decisions/0066-a-lien-waiver-is-a-record-with-a-kind-and-a-through-date-and-the-gap-is-derived.md).
  Never a form: who, which job and order, which kind, through when, how
  much, received or not, the signed copy attached; "paid with no
  unconditional waiver on file" computed from the applications' bills at
  read time; the chase a Work item on the order; a member's chore.
- **A subcontract change order adds lines to the order it changes, and an
  issued order's lines are locked** — [ADR 0065](../decisions/0065-a-subcontract-change-order-adds-lines-to-the-order-and-an-issued-orders-lines-are-locked.md).
  Its own row against one commitment, the client-side statuses and date
  rule, the client's change it passes down; its money is commitment lines
  tagged with it, counted while approved through one predicate, billed by
  the subcontractor's application as the same rows; a deduction is a
  negative line that runs backwards; billed against means fixed.
- **A unit-price application bills quantities at the schedule's prices, and
  the schedule's value is an estimate** — [ADR 0064](../decisions/0064-a-unit-price-application-bills-quantities-at-the-schedules-prices.md). The schedule with three
  more columns, both or neither; quantities in integer thousandths, typed by
  the person, priced on save; the invoice item by item; the estimate may be
  passed.
- **A pay application's printout is rendered from the frozen certificate,
  in the shape everybody knows and in our own words** — [ADR 0063](../decisions/0063-a-pay-applications-printout-is-rendered-from-the-frozen-certificate.md). Never stored;
  drafts watermarked; the AIA's form, text and name reproduced nowhere; cost
  plus and T&M on the same two pages with their own lines.
- **A pay application is an ordinary invoice, and retainage is a negative
  line to a receivable** —
  [ADR 0058](../decisions/0058-a-pay-application-is-an-ordinary-invoice.md).
  The pack calls Accounting's document verbs and never its tables; lowering the
  rate releases retainage through the same line. The pack's status has no
  `paid`.
- **Frozen at issue, live while a draft.** An issued application's totals and
  line values are written down; a draft computes from the schedule as it is
  now and picks up lines added since. Same rule as an invoice's tax.
- **A dialog's rows are initialised once, and the component outlives
  `router.refresh()`.** A draft editor that seeds its state from props on
  mount shows the pre-save rows when re-opened after a save, however fresh
  the page. Key it on the row's version, which every save bumps, so it
  remounts with what was saved. Found on the T&M editor in 5d; the cost-plus
  and fixed-price editors had it since 5 and 5b.
- **Read the constraint from `err.cause`, never `err.message`.** Under drizzle's
  wrapper the message is the SQL. `violatedUniqueIndex` in `src/lib/db-errors.ts`;
  four translations in this pack were dead for three slices before a test noticed.

## Open items

- **A sheet is a page to look at (9a, ADR 0072).** Markups — clouds, arrows,
  text and pins that raise a punch item where they sit — stored as vectors
  over a sheet and revision (9b), a scale set on a sheet with lengths and
  areas measured and pushed onto an estimate line as the takeoff (9c),
  comparing two issues of a sheet by overlay, reading the cover sheet's
  index to fill titles, and a per-job Drawings folder in the cabinet are
  each a slice of their own once a real set has been read. A scanned set's
  numbers are typed off the thumbnails. The "From Documents" door leaves a
  picked file's `doc_kind` as it was; only an upload through the set is
  filed as a `drawing`.
- **The schedule is calendar days with one kind of dependency (ADR 0071).**
  Working-day calendars and holidays, a baseline to measure slip against,
  start-to-start dependencies, telling the trade (the phase's party has an
  email; the digest and Mail are the seams), weather days from the daily
  log, and a template that seeds a new job's phases are each a slice of
  their own once a real job has run against this one. The Gantt is a table
  with bars; nothing drags.
- **The proposal prints; it is not sent, and the client cannot accept it on
  a screen of their own (10b, ADR 0070).** Mail's seam is there for the
  sending when somebody asks; a client portal is a decision of its own.
- **An estimate is lines, and nothing more yet (slice 10, ADR 0069).**
  Assemblies — a named bundle of lines dropped in as one ("interior door,
  prehung": slab, hardware, casing, labour) — a tenant-level unit cost book
  that fills a line's cost from the last time it was priced, and a takeoff
  from the drawings are each a real thing the trade has and each a slice
  of its own; the first two want a few real estimates typed before their
  shape is set. ~~The proposal as a printed document~~ shipped as 10b. An estimate is not
  attached to Documents (a scanned quote, a supplier's price sheet) — the
  gallery seam is there and nothing on the estimate calls it yet. An
  estimate on a schedule where every line is sold by the unit can miss the
  contract sum by the rounding; the ops result says what was written.
- ~~**No budget.**~~ — **closed 2026-09-14.** All four numbers exist: worth,
  planned, ordered, spent.
- ~~**Nothing revises a budget or a contract value.**~~ — **closed 2026-09-14.**
  An approved change order revises both, and a signed value can no longer be
  edited in place.
- ~~**ACTUAL COST IS PER PROJECT, NOT PER CODE.**~~ — **closed 2026-09-14.**
  `getBalances` took `withinMemberId` and the report has its `Spent` column;
  the uncoded remainder is said on the page. What is still open from it: a
  **bill line carrying a job and no code** is the common case on day one, and
  nothing yet nudges the person coding the bill toward the code — the setup
  source that says *"$3,000 on 24-108 has no cost code"* is the honest next
  step, and it is Accounting's screen it would speak from.
- ~~**Nothing bills.**~~ — **closed 2026-09-14** for fixed-price work: a
  schedule of values and pay applications, issued as invoices. ~~Cost-plus~~
  **closed 2026-09-14 (slice 5b, ADR 0060)**. ~~Still open from it: **unit
  price** is recorded on the contract and billed by nothing~~ **closed
  2026-09-14 (slice 5f, ADR 0064): every method bills**; ~~T&M~~
  **closed 2026-09-14 (slice 5d, ADR 0062)**, cost-plus with Time's rate
  card in place of labour cost;
  ~~**retainage held FROM subcontractors**~~ **closed 2026-09-14 (slice 5c,
  ADR 0061)**; ~~**the AIA-style printout** of a certificate~~ **closed
  2026-09-14 (slice 5e, ADR 0063)**.
- **The option book is per job.** A production builder's catalogue — the
  same selections with the same choices on every plan — is entered on each
  job until slice 8b seeds a new job's selections from a tenant-level book.
  A client portal for the client to choose from is not built; the office
  records what the client said. A selection sheet does not print. The
  Selections panel shows on every job: a project template that turns the
  workflow off for a delivery method without selections is the plan's
  `workflows` field, later.
- **The certificate has no architect of record and no certified amount.**
  The owner's or architect's block is signed with a pen and its *Amount
  certified* line is blank: the pack records what was applied for. The day a
  certified amount that differs must be kept, it is a column on the
  application and a line on the next certificate; the architect's name is a
  party on the contract. Nobody has asked.
- **A subcontractor's application does not print**, being the
  subcontractor's document. A business that prepares one on a
  subcontractor's behalf wants this renderer in the commitment's mode.
- **A signed certificate cannot be attached to its application.** The scan
  the owner returns belongs beside the row; Documents' attachments are the
  seam, as the daily log's photos are.
- ~~**A billed subcontract cannot be changed.**~~ — **closed 2026-09-14
  (slice 4b, ADR 0065)**: a change order on the order adds lines the next
  application bills, and an issued order's lines are locked the way a signed
  value is. Still open from it: **a back-charge** — money deducted from a
  subcontractor's payment for something the business paid on their behalf —
  is not a change to the scope and is not built; it is a negative line on
  the application with its own account, the day a GC asks. And **a change
  order does not print**, as the subcontractor's application does not.
- ~~**Lien waivers** are the document a subcontractor signs to get the retainage
  released, and the next thing a GC's bookkeeper asks for once retainage is
  tracked.~~ — **closed 2026-09-14 (slice 11a, ADR 0066)** as a record with
  the gap derived and the chase raised in Work on the order. Still open from
  it: ~~**a PDF waiver cannot be attached**~~ — **closed 2026-09-15**: the
  gallery's *Add a file* and *From Documents* doors, wired to waivers,
  selections and the daily log; **the waiver is not
  generated** — the tenant's own state form through Documents' templates,
  filled with the row's facts, is the door; **a purchase order's waivers have
  no gap rule**, because its bills are not tied to it; and ~~**certificates of insurance and W-9s**, the rest of plan slice 11, are a party-level record
  with an expiry and wait for their own slice~~ — **closed 2026-09-15 (slice 11b,
  ADR 0068)**. Still open from it: **nothing blocks** an order or a payment
  while a sub is out of standing — a setting, the day a business asks; a
  **per-coverage required list** (general liability, workers' comp, auto as
  three rows) is the same model with a longer list; and **the required list
  has no screen** — it is the pack config's `requiredPartyDocuments`, set by
  a profile or by hand until a settings panel wants it.
  ~~`billing_method` is still read by no code~~ — the contract page and the
  application verbs read it since 5b.
- **Time and materials has no rate card of its own.** Each person's rate is
  Time's, or one rate on the contract covers everybody. A rate per
  classification (carpenter, labourer, foreman) or a rate negotiated for one
  customer is a table of rates hanging off the contract, which the lines —
  keyed by person and rate already — could carry unchanged; nobody has asked.
- **Wages are told apart by account subtype, and only that.** A business
  that books payroll by hand to an account of another subtype (the
  construction chart's `5250 Job Labor` is `cogs`) would have its wages
  marked up on a time-and-materials application AND billed as hours. Time's
  own accrual posts to `6450`, so a business using it is right by
  construction; the fix for the other is a per-tenant list of wages
  accounts in the pack's config, and the day it is asked for. Behind it sits
  Time's own item: the accrual books every business's labour to overhead,
  not to a job-cost account.
- **A member reading the live WIP schedule sees a time-and-materials job's
  hours as unrated**, because Time's rates are owners-only. Honest, and
  documented in ADR 0062; the alternatives — a rate the pack can read, or an
  owners-only schedule — are both bigger questions than this pack.
- **A fee rate per cost code** (labor 20%, materials 10%, subcontractors 5%)
  is a real arrangement and not built: one rate on the total ships first.
  It would be a rate per line on the contract, not a different model.
- **The guaranteed maximum is not locked when the contract is signed**, unlike
  the value: nothing reports *original + changes = revised* for it yet. The
  day a change order can move a GMAX, lock it the way the value is locked.
- ~~**A contract cannot be edited from the screen.**~~ — **closed 2026-09-14.**
- **Nothing can be DELETED, and that is deliberate rather than missing.** A
  contract that should not exist is `cancelled` or `declined`; a cost code is
  retired; a project has no delete verb at all. The one real gap is a project
  created entirely by mistake, which today can only be `cancelled` — acceptable
  while a project is cheap to ignore, and worth revisiting if a business starts
  accumulating typos.
- **A contract's project cannot be changed, and neither can a change order's
  contract.** Moving an agreement between jobs, or a change between agreements,
  is a different and riskier act than editing it — the second would silently move
  money between two pay applications — and nobody has asked.
- ~~**Nothing edits a project yet.**~~ · ~~**A cost code cannot be renamed,
  reordered or retired from the UI.**~~ — **both closed 2026-09-14.** Every
  thing the pack creates can now be changed, and the version check that had
  existed unused since slice 0 is finally passed by the forms.
- **The founder has not clicked any of it.** Every slice from 2 on was driven
  in the browser on the dev branch by the builder, which is not the same thing.
  The construction profile does not exist yet either, so `deliveryMethodsFrom`
  has never returned a non-empty list outside a test.
- **The tell box's `jobs.log` is confirmed, not unattended — for now.** A line
  landing on the wrong job fails ADR 0050's first test today because nothing
  on a screen the person already looks at would show it. The day the
  project page (or the phone's home) shows "today on your jobs", the test
  passes and the four taps go.
- **Photos have been driven by no one.** The gallery is the shared component
  livestock and assets already use, wired with this pack's actions and gates;
  the upload itself needs a real file from a phone or a picker, which the
  browser pane cannot supply.
- **A suggested kind that is an acronym renders wrong.** `slugLabel("aia")` is
  *Aia*, and the construction profile's contract kinds carry `aia` because that
  is what every GC calls the form. The pack cannot know an acronym without
  knowing the industry; the fix is a per-kind label map in `packConfig`
  (`contractKindLabels`, read beside `contractKindsFrom`) the day a profile
  wants to spell one. Seen the first time a profile fed the picker, 2026-09-14.
- **`job_projects.number` is not generated.** Every business numbers its jobs its
  own way and the pilot's scheme is unknown, so the field is free text and the
  form suggests nothing. A generator is worth building only once a real scheme is
  in front of us.
- ~~**The work in progress schedule measures fixed-value jobs only.**~~ —
  cost plus (5b) and time and materials (5d) each brought their method. What
  remains: a **unit-price** job has no value to earn against, is shown with
  `No fixed contract value` and left out, and one with billings blocks the
  period. **Since 5f a unit-price job has a value — the estimate — and is
  measured cost-to-cost like a fixed-value one; the output method (units
  installed over units estimated) is the better measure and not built.**
- **Percent complete cannot be typed.** Cost-to-cost is the only method. A
  business that measures by units delivered or an engineer's estimate would
  need a second nullable column on the line (ADR 0059 leaves the door open);
  nobody has asked.
- **No schedule of completed contracts.** A finished job drops off once fully
  billed; the bank's other schedule — every contract completed in the year,
  with its final margin — is a different report and not built.
- **The reversal can be voided from the journal.** `wip_adjustment` is a
  managed source, so neither entry can be voided there; but a reversal posted
  with `reverses_entry_id` set is protected only by its own source, which is
  the same one, so it is covered — noted because the general guard
  (`assertEntryNotSourceManaged`) checks the entry's own source and not what it
  reverses, and a future source that reverses with `source = 'reversal'` would
  not be.
