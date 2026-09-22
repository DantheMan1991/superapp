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

## The estimate program (open, started 2026-09-16)

The founder reviewed the estimate tool ([ADR 0069](../decisions/0069-an-estimate-prices-the-job-before-anybody-signs-and-accepting-it-names-the-contract.md))
and the proposal ([ADR 0070](../decisions/0070-a-proposal-is-the-estimate-at-its-price-and-its-words-are-fixed-with-the-money.md))
against how a builder actually sells, and asked for four things: an **item**
the client sees at one price with the build-up behind it; a way to **keep the
internals from the client** ("clients don't care about cost codes"); the
estimate to be **fast to type**; and the proposal to look like a **brochure**
for a custom home and a simple page for a production one. Spare no expense on
it — "it's very important, i want to make it top notch."

**The diagnosis.** Estimating has three axes and the model had two, so the
third was being borrowed from the second:

| Axis | Unit | Who reads it | Before |
| --- | --- | --- | --- |
| Cost | a line — quantity of a unit at a unit cost | the estimator | `job_estimate_lines` |
| Accounting | a cost code | the office, the books | `cost_code_id` |
| **The sale** | **an item at a price** | **the client** | **borrowed from the cost code** |

That is why the proposal read like a ledger: its only summary was *by cost
code*, and `09 30 00 · Tiling` is not a thing anybody buys.

**The four decisions the founder took** (2026-09-16, in the thread):

1. **A fixed item price is what prints.** Shown the arithmetic — at ten and
   ten, an item typed at $8,400 inside the overhead-and-profit spread prints
   $10,164 — he chose to keep the typed number outside the spread. The model
   already has a place for a lump you want *costed* and marked up: a line of
   quantity one. [ADR 0079](../decisions/0079-an-estimate-groups-its-lines-into-the-items-the-client-sees-and-a-group-priced-fixed-is-the-price-not-a-cost-to-mark-up.md).
2. **The schedule of values follows the items**, and by item is the default
   once an estimate has any.
3. **Magazine-grade for luxury, not for production** — so two documents, not
   one, and the luxury one needs a layout `@react-pdf/renderer` cannot reach.
4. **The client gets a link and can accept on it**, and the PDF export stays a
   requirement either way ("i do want the proposal to be exported to pdf
   still").

**3 and 4 turn out to be one build.** A web proposal is HTML; a magazine-grade
PDF is that same HTML with print CSS through Chromium. So the luxury brochure
and the client link are one slice, and `proposal-model.ts` stays the single
pure source of every word and figure with three consumers instead of one: the
`@react-pdf/renderer` letter (production, already built, no cold start), the
HTML page (the link, and the luxury print), and Chromium's render of that page.
Two layouts, one truth — the split ADR 0070 already set. **The cost turned out
to be nothing** (E5b, ADR 0084): `puppeteer-core` is 7.8MB and
`@sparticuz/chromium-min` is 67KB against the 250 MB a function is allowed,
because the ~50MB Chromium is in neither package — it is fetched from
`CHROMIUM_PACK_URL` into `/tmp` on a cold start and found there while the
function stays warm. What it shares that budget with — sharp's libvips and the
Noto TTFs that `next.config.ts` already traces by hand — never came near it.

| # | Slice | What it is |
| --- | --- | --- |
| **E1** | ~~**Items**~~ **SHIPPED 2026-09-16** ([ADR 0079](../decisions/0079-an-estimate-groups-its-lines-into-the-items-the-client-sees-and-a-group-priced-fixed-is-the-price-not-a-cost-to-mark-up.md)) | `job_estimate_groups`, one level deep, rolling up or priced by hand; a fourth presentation `groups`; the schedule of values by item. The keystone: everything below hangs off this table. |
| **E2** | ~~**What the client sees**~~ **SHIPPED 2026-09-16** ([ADR 0080](../decisions/0080-an-estimate-line-carries-the-clients-words-beside-the-estimators-and-a-line-kept-off-the-proposal-collapses-the-item-that-holds-it.md)) | `client_description` on a line (the estimator types `Tile — mud set, Schluter, mtl only, per AJ quote 8/14`, the client reads `Porcelain tile flooring`) and `client_visible`, **offered only inside an item** — hidden money must have somewhere to hide or the printed rows stop adding up, and **the item that hides a line collapses** on the same predicate as one priced by hand. The cost code's number off by default. One switch in the editor, not two columns. |
| **E3a** | ~~**Typing fast**~~ **SHIPPED 2026-09-16** ([ADR 0081](../decisions/0081-an-estimate-line-can-be-typed-as-one-sentence-and-the-grammar-that-reads-it-is-pure-and-refuses-what-it-cannot-read.md)) | The entry bar, the paste box, `Ctrl+D`, and the units the parser learns from the business's own estimates. One pure grammar, three doors — the third is voice. No migration. |
| **E3b** | ~~**Saving fast**~~ **SHIPPED 2026-09-17** ([ADR 0082](../decisions/0082-an-estimate-saves-itself-unsaved-is-derived-from-the-form-and-a-save-that-changes-nothing-writes-nothing.md)) | The form saves itself 1.2s after typing stops. "Unsaved" DERIVED from the payload, not flagged by setters; the version held in the client and handed to every guarded verb; **a save that changes nothing writes nothing and does not move the version**, which is what makes a timer cheap. Not per-row actions — one call, made safe to repeat. No migration. |
| **E3c** | ~~**Keyboard grid**~~ **SHIPPED 2026-09-18** | Up and Down move within a COLUMN (a takeoff is typed down one, and Tab already walks across); arriving selects the cell, the spreadsheet idiom. Enter moves down and, past the last row, makes another in the same item and lands in the same column. **Left, Right and Tab are deliberately untouched.** Movement resolves in DOM order, so grouping under items is handled for free. |
| ~~E3~~ | ~~**Speed**~~ — split into E3a and E3b above | The **entry bar**: one field that parses `320 sf tile @ 4.20`, `plumbing rough 12000` (a lump), `@tile 320` (drop an assembly), Enter commits and the cursor stays. A **paste target** — `src/lib/paste-targets` is a finished framework and eight packs use it; jobs has no `paste/` directory at all. **Per-row saving** (today the whole estimate is one `useState` and one Save button, which a two-hundred-line takeoff cannot be). `Ctrl+D` to duplicate the row above, because most lines are near-copies. The parser is pure and table-tested, and it is also the voice feature: one function, two doors. |
| **E4a** | ~~**Price memory**~~ **SHIPPED 2026-09-17** | Every `job_estimate_line` across the tenant IS a price history, and nothing read it. The entry bar shows `Last priced 3.50/sf · 24-108 · 3 weeks ago` as you type and **Tab** takes it; a pasted takeoff with no prices is filled from memory and the preview counts what it filled. **Exact match on a normalised key, on purpose** — a wrong price offered confidently is worse than none. It only ever fills a blank. |
| E4b | **The actual check** — the half nobody else can do | *"you estimated 4.20 — you actually paid 4.65 on the last three jobs"*. Split out of E4 because actuals live per COST CODE in the ledger (`actualByCode`), not per line, so it is a different read, a different comparison and a different screen from the typing aid above. |
| **E5a** | ~~**The proposal as sections, and the brochure**~~ **SHIPPED 2026-09-17** ([ADR 0083](../decisions/0083-a-proposal-is-an-ordered-list-of-sections-a-brochure-is-a-page-order-over-facts-the-pack-already-holds-and-the-document-is-html.md)) | `format` (letter / brochure) split from `presentation`; the proposal as `ProposalSection[]`; the brochure's pages read from the items, the selections and the phases; the document served as HTML from a GET route — the same URL E5b prints and E5c shares. The letter's PDF path untouched. |
| **E5b** | ~~**The brochure's PDF**~~ **SHIPPED 2026-09-17** ([ADR 0084](../decisions/0084-the-brochures-pdf-is-a-headless-print-of-the-document-itself-and-the-format-picks-the-engine.md)) | The format picks the engine at one URL: a letter is react-pdf, a brochure is a headless Chromium print of **the very string the document route serves**. `pressFor` decides where the browser comes from, and `-min` keeps the ~50MB Chromium out of the function. Killed the live defect that printed the letter whatever the format said, and found the running footer printing through the text. `npm run print:probe` is what measures it. |
| **E5c** | ~~**The client link, with Accept**~~ **SHIPPED 2026-09-17** ([ADR 0085](../decisions/0085-a-client-link-is-a-tokenised-copy-of-the-proposal-and-accepting-on-it-records-a-signature-rather-than-accepting-the-estimate.md)) | `/proposal/<token>`: the same document with no session, `document_shares`' credentials verbatim, `withSystem` doing the token → tenant hop and nothing else, and every failure the same unbranded sentence. **Accepting records a SIGNATURE, it does not accept the estimate** — `acceptEstimate` needs an owner and the contract, and a client has neither. The version shown is checked not trusted; a link is signed once; the standing is derived, and `superseded` kills a link whose estimate moved after it was signed. |
| ~~E5~~ | ~~**The proposal as sections, the HTML document, and the client link**~~ — split into E5a/b/c above | Presentation (how the money is grouped) and format (what the paper is) are two choices tangled in one field today. Split them, then build the document as a **section list** over pack data — and the point is that every page a custom-home proposal wants is already data here: the cover's elevation is the current drawing set (9a), the narrative is the items' names and notes, the allowances are selections (ADR 0067), the milestones are phases (ADR 0071), the warranty is a period on the job (13a), the insurance and bonding are rows (0068/0078). A brochure is a page order over things that exist. `letter` and `brochure` are two presets over that list. Stage 1 is the HTML plus print CSS, shipped as the tokenised client link with **Accept**; stage 2 adds the Chromium render behind the same route so the product can attach and email the file. Stage 1 is the first half of stage 2, so nothing is wasted. |
| **E6** | ~~**Assemblies**~~ **SHIPPED 2026-09-18** ([ADR 0086](../decisions/0086-an-assembly-is-an-item-saved-at-the-size-it-was-priced-and-only-the-quantity-scales.md)) | **An assembly is a saved item**, built backwards: *save this item as an assembly* first, and the picker does not appear until the library has something in it. It records the size it was saved at and keeps every quantity as it was priced; dropping scales **only the quantities** — a cost, a unit price and a markup are rates already. The cost code travels as TEXT and is resolved against the target job own set. |
| E7 | **The rest** | Bid alternates and options ("upgrade to quartz: +$4,200") as items outside the total until chosen; copy an estimate / a plan template, which is a production builder's whole workflow and nearly free because the rows exist; the tenant-level unit cost book, once E4 has shown what it should hold. |

Not in the program, and deliberately: a takeoff from the drawings (shipped as
9c), and anything that would make an estimate post to the books.

### IF YOU ARE CHANGING THE ESTIMATE SCREEN, READ THIS FIRST

`components/estimate-editor.tsx` is one file carrying eight slices of
behaviour, and **most of it is invisible in a screenshot**. A change that
rebuilds the grid or the toolbar will silently drop these unless it means not
to. Nothing in the pure test suite catches any of the first three — they are
DOM contracts, and the only proof is a click.

The 2a redesign (E8, below) kept every row of this table. Three of them moved,
and the table now says where to.

| Must survive | Where it comes from | How it breaks silently |
| --- | --- | --- |
| **`data-cell="<column>"` on all seven editable inputs, and `data-group` on the line row** | E3c | The keyboard grid finds "the row below" by querying the DOM in document order. A rebuilt grid without these attributes leaves ↓/↑/Enter doing nothing, and every test still passes. The lookup is `[data-row][data-group]` since E8 — it was `tr[data-group]` while the grid was a `<table>`. **Three of the seven cells (`markup`, `unitPrice`, `clientDescription`) are in the row's EXPANSION now**, so ↓ in those columns walks the open rows; `cellsIn` also skips a cell the layout has hidden at this width, or ↓ would focus something nobody can see. |
| **↓/↑ move within a COLUMN; Enter moves down and MAKES A ROW past the last; Tab, ← and → are untouched** | E3c | A grid that claims Tab traps keyboard users; one that claims ←/→ makes a typo mid-price unfixable. |
| **The entry bar is ONE field: Enter commits and the cursor stays; a sentence it cannot read is refused, never guessed** | ADR 0081 | A line that quietly landed at $0.00 on a bid you sent is the expensive kind of mistake. |
| **Tab takes the remembered price, and ONLY while a hint is showing** | E4a | Otherwise Tab stops moving focus. |
| **"Unsaved" is DERIVED by comparing the payload with the last one sent, and the version is NOT in that comparison** | ADR 0082 | A `setDirty` per setter says "Saved" over work that is not; the version inside the payload makes every save dirty again. |
| **`Show it` appears only on a line INSIDE an item** | ADR 0080 | Hidden money needs somewhere to hide, or the printed rows stop adding up. |
| **Removing an item leaves its lines loose; it never deletes what was priced** | ADR 0079 | Silent data loss. |
| **A fixed item price is the number that prints** | ADR 0079, the founder's decision 1 | At ten and ten, $8,400 inside the spread prints $10,164. |
| **`Add an assembly` is hidden until the library has one** | ADR 0086 | An empty drop-down teaches people the feature is not for them. |
| **Ctrl+D duplicates the focused row** | ADR 0081 | Most takeoff lines are near-copies of the one above. |
| **The row buttons' `sr-only` labels need a positioned ancestor** | E3a's bug | `sr-only` is `position: absolute`; with no positioned wrapper its containing block is the PAGE and it drags the whole page sideways. The `relative` on the Lines card is load-bearing, and the symptom looks like a wide table. |
| **The Lines card is NOT `overflow-hidden`, and neither is the panel below `md`** | E8 | A clipping ancestor becomes the containing block for `position: sticky` and silently disables every pinned row inside it. The card rounds its header's and its entry bar's corners instead of clipping; the panel takes `md:overflow-hidden` so that on a phone, where it scrolls with the page, the page is still what the rows stick to. |
| **Every direct child of the work column is `flex-none`** | E8 | Otherwise the flex items shrink to the constrained height, the column never overflows, and the grid is clipped with no way to scroll to it. |
| **A row's number is its ADDRESS, and the order it hands back is always visual order** | E8, ADR 0087 | `sort_order` is the payload's order. A reorder that returned "the same array, two elements swapped" would put the screen and the database out of step the first time a line crossed into another item — and it would only show up in the client's proposal. |
| **The Measure dialog writes the LINK only and the editor sets the quantity; the sheets chip is READ off the markups; and the autosave ADOPTS the ids a save minted** | ADR 0109 | A second writer of a line while the editor is open is the disagreement ADR 0082 forbids. A stored list of sheets would go stale the moment a trace was rubbed out. And without the adoption a new line's id churned on every autosave, and the SET NULL cut anything hanging off it — a screen that "just" rebuilt the save path would reopen that silently. |

The screen also hosts two blocks to keep whole rather than re-plumb: the
**proposal block** (format, presentation, the four texts) and **the client's
link** (E5c). The **six figures** row is gone — the rail's *How the total is
built* replaced it, and added the `Markup` step it never showed. And
`npm run print:probe` guards the proposal document, not this screen — there is
no equivalent for the editor, so a change here has to be clicked.

## Build log

> **Older entries live in [jobs-build-log.md](jobs-build-log.md)** — 2026-09-14
> to 2026-09-18, the week the pack was built: slice 0 through 13a, the estimate
> program's E1–E8, and the jobs redesign. This section keeps the estimate
> interview run (X1 on). Add new entries at the top here; when it grows past a
> few screens, sweep the oldest across.

### 2026-09-22 — The takeoff finishes what it starts (`claude/the-takeoff-finishes-what-it-starts`)

Step 4 of the drawings-takeoff pass: the rough edges the review left once
the arithmetic was in — each small, each a thing the estimator had to fix
by hand after every push.

**A line the takeoff makes is priced from memory (E4a, on a drawing).** A
new line came in with its quantity and a blank price, and the estimator
went to the estimate to type what they had typed the last nine times.
`pushTakeoff`'s new-line path now fills the blank from the price book
(`priceBookRows` → `fillFromMemory`), the pasted takeoff's rule kept: the
line's `basis` reads `memory`, its `basis_detail` *your last price, on
24-108*, the result carries `priced` and the toast says *Priced from memory
— $4.20/sf · 24-108 · 3 weeks ago. Check it: a price can be a year old.*
An existing line's price is its own; a push onto one says nothing.

**A remembered price is per its unit** — `fitsUnit` in `price-memory.ts`,
and the one rule this PR adds to the memory everywhere it fills a blank.
*Flooring* at 4.20/sf is not a price for 500 sy of flooring, and a lump
remembered with no unit is not a rate at all; either, put on a line in
another unit, is a wrong number nothing downstream can see — the class of
defect the memory was built to avoid ("a wrong price offered confidently is
worse than no price"). Until now the entry bar, the paste preview and the
walk all applied a memory whatever the line's unit. Now a line that knows
its unit takes a memory only in that unit, however either is spelled
(`normaliseUnit`: `sq. ft.` is `sf`); a line with no unit yet adopts the
memory's, as before. The entry bar's hint hides for a memory that does not
fit, so Tab cannot take it. `fillFromMemory` grew an optional `unit`; the
walk's `walk-lines-math` checks `fitsUnit` before it prices from memory.

**The Takeoff dialog aims at the estimate this sheet already feeds**
(`estimateFedBy`, pure): the estimate of the last link drawn on the sheet,
else the only open one, else the first. It had defaulted to `estimates[0]`
— the wrong one whenever the job had two — and every push from the second
sheet onwards began by changing the select.

**The tool line is always there.** It appeared when a tool was picked and
pushed the sheet down under the finger about to draw; now it is rendered
whenever the sheet can be drawn on, `min-h-7`, reading *Pick a tool to draw
or measure; drag to move about, pinch or ctrl+wheel to zoom* until one is.

**The quantity fits its cell.** `175.826` is seven characters and the
quantity input was 54px in a 92px track shared with the unit: thousandths
were clipped on every measured line. The input is 66px, the unit 40px, the
track 112px (116px at `@5xl`); the description track gives the 20px up.

**A pitch in degrees** as well as rise per 12 — the step-3 open item that
cost least: `Pitch = { rise } | { degrees }` kept as typed, `pitchFactorOf`
(1/cos θ; 45° is √2, as 12:12 is), `formatPitch` in the working (*of plan
at 30°*), `PITCH_DEGREES_MAX` 85 because a roof steeper than that is a
wall, and a select beside the box on the pencil. No migration: `figures` is
jsonb read tolerantly, and a `{ degrees }` written by this version reads as
no pitch to an older one rather than a wrong one.

Tests: `fitsUnit`/`fillFromMemory` with a unit (pure); the pitch in degrees,
its factor, its working and `estimateFedBy` (pure); and an ops scenario that
prices a new line from a memory per the same unit however spelled (`tile` →
*Tile* at 4.20 per `sq. ft.`), leaves a per-`sy` memory and a lump blank
and says so, and leaves an existing line's price alone.

**Driven** on the dev branch's Hilltop Farm 24-109, on this worktree's own
server (port 3001). A-101 with no tool picked read *Pick a tool to draw or
measure; drag to move about, pinch or ctrl+wheel to zoom* on a 28px line and
the sheet's box sat at 762px from the top; *Area* picked, the line read *Tap
around the room, corner by corner, then Finish. Esc goes back to moving
about.* and the box stayed at 762; Esc, 762 again. The pencil on the kitchen
area offered *: 12 | degrees*; *degrees* and *30* saved as `{ pitch: {
degrees: 30 } }` and the row read *as a roof 68.2 sq ft · 59 sq ft of plan
at 30°* (59.026 / cos 30°). *Takeoff* on that row opened on **EST-2** with
FIVE open estimates in the select (EST-6 first by number) — the one the sheet
already feeds, where `estimates[0]` would have said EST-6. With *4.20* typed
as the unit cost of *Flooring, kitchen* on EST-2, a new line typed as
*flooring, kitchen* came in at **4.20/sf** and the toast read *59.026 sf onto
EST-2 — Priced from memory — $4.20/sf · 24-109 · 6 days ago. Check it: a
price can be a year old.* (six days: a memory's date is the line's
`created_at`, not the day the price was typed); the trace then carried two
chips and the estimate showed line 12.3 at 59.026 sf × 4.20. The quantity
input for *59.026* measured 70px client, 70px scroll — nothing clipped —
where it had read *5*. The worked example was put back: line 12.3 removed,
the 4.20 cleared, the pitch cleared.

**Trap on the way:** after the dev server was restarted the pane's first
load of the sheet ran a STALE client bundle (its HMR socket does not connect
in the pane), so a saved `{ degrees: 30 }` read back in the pencil but the
row showed no roof — the server-rendered HTML had it, the client's `yieldsOf`
did not. A second full navigation fixed it. Fetch the page's HTML and grep it
before believing a row; see [[dev-server-misses-a-route]] for the other
fresh-server trap.

### 2026-09-22 — A trace yields the figures the trade derives from it (`claude/the-figures-a-trace-yields`, [ADR 0110](../decisions/0110-a-trace-yields-the-figures-the-trade-derives-from-it-and-each-can-stand-behind-a-line-of-its-own.md))

Step 3 of the drawings-takeoff pass — the arithmetic the trade does every
day, agreed by mockup: an opening cut out of an area, the run around it, a
wall's area from its length and a height, a roof's area from a plan and a
pitch, a volume from an area and a depth. Two things stood in the way: a
trace came to ONE number, and the link to an estimate line lived ON the
trace (`estimate_line_id`), so one trace could stand behind one line — the
room behind the flooring OR the baseboard, never both. A trace that yields
five figures and can lend only one defeats the point.

**The figures a trace carries** — `job_sheet_markups.figures` (jsonb,
migration 0421): `{ height: { value, unit } }` on a length, `{ pitch: { rise }
}`, `{ depth: { value, unit } }` and `{ deducts: [[points]] }` on an area,
**kept as typed, in the unit typed** (`9 ft`, `4 in`, `100 mm`), because the
estimator's own number is what the working should read back; `parseFigures`
reads them tolerantly on both sides and drops what it does not recognise.
**Nothing derived is stored**: `yieldsOf` works every figure out when read,
through the scale — an area's NET area (*93.5 sq ft less 3.7 sq ft in 1
opening*), the run around it, the roof at 6:12 (× 1.118), the volume (89.8 sq
ft × 4 in = 1.1 cy; metric in m³), a length's wall (11 ft × 9 ft) — so a scale
set again corrects all of them at once, exactly as it corrects the area
(ADR 0074's rule, kept). Every figure has a FAMILY (`FIGURE_FAMILY`: a
perimeter is a length, a wall and a roof are areas, a volume its own), and a
line's unit calls for one: `cy`/`m3` now call for a volume, so **a cy line
gets its ruler back**.

**Each figure stands behind a line of its own** — `job_estimate_line_traces`
(migrations 0421 + 0422 with RLS and the backfill of every existing link):
one row per (line, trace, figure) with that figure's own share, unique on the
three, cascading from the line and from the trace. `measuredSet` takes
`picks` of `{ markupId, figure }` (the old id-only shape still means the
trace's own figure), checks every one is a figure the trace actually yields —
*North wall cannot stand as a volume: only an area fills a volume*, *it has
no depth typed on it* — and one family between them; `linkMeasurements`
upserts the set and deletes the line's others; `measurementsBehind` reads by
figure; `listMarkups` hands each trace its LIST of links (`takeoffs`), with a
second query. The two columns the link lived in stay on the markup,
unwritten and unread — a drop goes out after its deploy.

**On the screen.** A trace's row reads its other figures on a second line —
*around it 39 ft · as a roof 100.4 sq ft · as a volume 1.1 cy*, the working
on hover — and an area with openings draws them as holes (evenodd) with a
dashed edge and reads net. **Cut an opening** on an area's row is a fourth
measuring tool: tap around the opening, Finish, and it goes onto that
trace's `deducts` through `updateMarkup`. The **Edit** dialog carries
*Height* (ft | m) on a length, *Pitch* (: 12) and *Depth* (in | mm) on an area,
and *Keep the N openings*. The **Takeoff** dialog asks *What goes* when a
trace yields more than one figure, lists every figure on the sheet of that
family as a tick (*Bedroom 2 · around it 39 ft* beside *North wall 11 ft*),
keeps the other sheets' picks by figure, and a trace's chips are one per
link, each with its figure named when it is not the trace's own and its own
drift. The **Measure** dialog (ADR 0109) offers every figure of the line's
family — *behind the line* for a trace's own figure, *as a wall 99 sq ft* for
a derived one — and its blank-unit picker gained *Volume · cy*; a trace
drawn while a baseboard line is measuring ticks its RUN, not its area.

**Tests.** Pure: every figure in the database's list with a family;
`parseFigures` tolerance; the one-room yields (93.5 → 89.76 net, 39 ft around,
roof × 1.118, 1.108 cy, a height in metres converted); a metric slab in m³;
`cy`/`m3` in every spelling. Ops: one room behind four lines by four figures
and a wall behind the drywall by its wall (89,760 sf · 39,000 lf · 99,000 sf ·
1,108 cy · 100,355 sf), refusals by name, families never mixing, the id-only
shape, the reverse link by figure, one link let go, the opening taken back
out drifting every figure on the room, and the trace rubbed out taking its
links; the two older scenarios pass on the new table unchanged in meaning.
Isolation: the table (cross-tenant, FKs, both CHECKs, the unique index,
both cascades) and the `figures` CHECK.

**Migrations 0421 and 0422** — applied to dev and verified at 245 tables,
then, on the founder's say-so later the same day (the auto-mode classifier
had refused the production run unasked), applied to PRODUCTION with
`npm run db:migrate` and verified with `npm run db:verify-rls`: 245 tables,
RLS enabled and forced everywhere. Read back from production: the table with
both policies, the `figures` column defaulting to `{}`, and the backfill
carrying every existing link (2 of 2). The backfill is `ON CONFLICT DO
NOTHING`, so a second run after the deploy is safe and catches a push made
in the window between.

**Driven** on the dev branch's Hilltop Farm 24-109, on this worktree's own
server. On A-101 the kitchen area read *59 sq ft · around it 32.5 ft* before
anything was typed; the pencil with *Pitch 6* and *Depth 4 in* gave *around
it 32.5 ft · as a roof 66 sq ft · as a volume 0.7 cy*, each working on hover.
*Cut an opening* → four taps inside the room → *4 points · 1.5 sq ft* →
Finish: the row read *57.6 sq ft · 59 sq ft less 1.5 sq ft in 1 opening · as
a roof 64.4 sq ft*, the hole drew dashed, and the flooring chip said
*measured since*. *Takeoff* on it opened with *What goes: Area · 57.6 sq ft —
59 sq ft less 1.5 sq ft in 1 opening*, the roof figure listed beneath as a
second tick, and *Set the quantity* put *57.569 sf* on the flooring line,
the drift gone. On EST-2 the `cy` line *Footing concrete* carried a ruler;
its dialog opened A-101 with *as a volume 0.7 cy* on the kitchen area, ticked
it, read *So far A-101 0.711 cy*, and **Use 0.711 cy on the line** landed
with the chip *A-101* and *Saved*. Not driven: a height on a length (the
pure and ops tests carry it), a metric sheet, and *Keep the openings*
unticked; the worked example was put back afterwards.

### 2026-09-22 — A line is measured from where it is priced (`claude/measure-from-the-line`, [ADR 0109](../decisions/0109-a-line-is-measured-from-where-it-is-priced-and-what-stands-behind-it-follows-it-across-sheets.md))

Step 2 of the drawings-takeoff pass, agreed by mockup: the founder's *"I need
the takeoff tool to get that a lot of the time"* finally reaches the
ESTIMATE, where the number goes. Two structural findings drove it — nothing
on the estimate could open a drawing, and a line could not span sheets,
because the *Takeoff* dialog offered one sheet's traces and a push states the
whole set (ADR 0074), so pushing the upstairs floor from A-102 silently
replaced the downstairs figure from A-101.

**The ruler on the line** (`estimate-editor.tsx`): beside the bin, on any line
a drawing can measure — `measureKindForUnit`: `sf`/`m2` an area, `lf`/`m` a
length, `ea` a count, blank asks, `ls`/`cy`/`sy` no ruler at all (a disabled
control shows no reason on touch; the guide says why). The last grid track
grew from 34px to 64px to hold two icons — a first attempt put the ruler in
the quantity cell and clipped `59.026` to `5`; found by the screenshot, not
the type-check. Under the description, **the sheets chip** — *A-101, A-102* —
with *measured since* when a sheet's scale moved and *line differs* when the
typed quantity has left what was measured; in the expansion, **From the
drawings**, a row per sheet with its traces, set and any superseded or
drifted note, the measured total against the line's, and *Open the drawings*.

**The dialog** (`components/measure-line-dialog.tsx`): the sheets opened FOR
the line — each saying *59.026 sf · 1 trace behind this line* — and inside
one, the real `SheetViewer` in a new `forLine` mode: every trace of the
line's kind carries a **behind the line** tick, a trace drawn in there is
ticked the moment it is saved, and the footer adds the set up across sheets:
*So far A-101 98.264 sf + A-102 77.562 sf = 175.826 sf*. A blank unit asks
how a drawing measures the line first. **Use writes the LINK only**
(`standBehind`: the markups' `estimate_line_id` and each trace's own share,
the line's others unlinked; nothing empty lets them all go) and the editor
sets the quantity itself — the second-writer rule of ADR 0082, the same shape
as *Add an assembly* and *From the model*. The viewer gained `onChanged`,
which the dialog answers by re-reading its sheet snapshot; **the walk's
dialog got the same, which fixed a trace drawn inside it never appearing in
its own list** — X7's drive had only ever used a trace that was already
there.

**The reverse link** (`measurementsBehind`): derived per line and per sheet
from the markups — traces, share, what they come to now, drifted, current
issue — never stored, so the estimate cannot disagree with the drawings. The
estimate page loads it once; the sheet page loads it per open estimate so the
**Takeoff dialog lists the line's traces on other sheets, ticked** (*Already
behind this line, on other sheets — A-102 · 77.562 sf · 1 trace*), and this
sheet's traces already behind the chosen line start ticked too, so a push
keeps the set unless a sheet is unticked. The sentence reads *59 sq ft here,
with 77.562 sf on A-102, goes on the line as 136.588 sf*.

**A save hands the editor the ids it minted.** Found on the way: the editor
posted a new line with no id on EVERY autosave, `saveLines` deleted the row
it had made and inserted another, and anything hanging off the old id — a
measurement standing behind the line, by its SET NULL — was cut loose each
time somebody typed. `updateEstimateReturning` returns the lines' ids in the
payload's order (which is the sort order) and a new item's key → id; the
action passes them on and the editor adopts them by position — and rewrites
its "last saved" payload with them, or adopting would read as an edit and
fire a second save. `updateEstimate` is unchanged for its twenty callers.

**No migration.** Tests: `measureKindForUnit` and `sheetsBehind` (pure); an
ops scenario with TWO sheets — the claim across them writes no quantity and
moves no version, each trace holds its own share, the reverse link reads by
sheet and says which sheet drifted when A-102's scale is set again, a length
with the areas and an area onto an `lf` line refuse, claiming one sheet lets
the other go, claiming nothing lets all go, and a save returns the minted ids
which a second save with them keeps. The takeoff scenario's one-sheet setup
was exactly why the replace-across-sheets defect was invisible to it.

**Driven** on the dev branch's Hilltop Farm 24-109, EST-2, on this worktree's
own server. The ruler on *Flooring, kitchen* (59.026 sf, behind it 9c's area
on A-101) opened the dialog: A-101 read *59.026 sf · 1 trace behind this
line*, the other sheets *no scale set yet*. Inside A-101 the area's row carried
*behind the line* ticked; a second area drawn there (39.2 sq ft) appeared in
the dialog's own list ticked, and the footer read *So far A-101 98.264 sf*.
Back to the sheets — *A-101 · 98.264 sf · 2 traces behind this line* — then
A-102: *Set the scale* from the title block (1/4" = 1'-0"), the view re-read
itself, an area drawn (77.6 sq ft), and the footer read *So far A-101 98.264
sf + A-102 77.562 sf = 175.826 sf*. **Use 175.826 sf on the line**: the row
read *175.826 sf*, the chip *A-101, A-102*, and the estimate said *Saved* with
no other click. On A-101's sheet page both areas' chips read *→ EST-2 ·
Flooring, kitchen · 175.826 sf*, and *Takeoff* on the first showed *Already
behind this line, on other sheets — A-102 · 77.562 sf · 1 trace* ticked, the
sentence *59 sq ft here, with 77.562 sf on A-102, goes on the line as 136.588
sf*. Not driven: a blank-unit line's kind picker, *Let the drawings go*, and
the autosave adopting a brand-new line's id (the ops scenario covers the
server half).

### 2026-09-22 — What a measurement pushed is its own share (`claude/takeoff-measured-since`)

Two defects in the takeoff (9c, [ADR 0074](../decisions/0074-a-measurement-is-a-markup-with-a-quantity-the-scale-is-the-sheets-and-a-takeoff-is-a-quantity-pushed-onto-an-estimate-line.md)),
both found by clicking the tool during the founder's improvement pass of the
drawings takeoff, both invisible to the suite — whose 9c drive had noted *"not
driven: two measurements added up"*.

**"Measured since" lied on every push of more than one measurement.**
`pushTakeoff` stamped the line's TOTAL into `pushed_quantity_thousandths` on
every markup in the push, and the row's chip compared each markup's OWN
quantity against it — so two areas pushed together (59 + 52.2 sf) both read
*→ EST-2 · Flooring, kitchen · 111.198 sf · measured since* the moment after,
with nothing re-measured. The column now holds the quantity THIS measurement
contributed — its own share — and the comparison is `driftedSince` in
`takeoff-math.ts`, pure and tested with the bug's own numbers; the ops
scenario asserts both shares after a two-area push. The line's total is what
it was; only what each measurement remembers has changed.

**A push onto an existing line ignored the line's unit.** The line kept its
own unit whatever the measurement was, so an area in square feet could set
the quantity on a line priced per linear foot, per square yard or per lump
sum with no conversion and no refusal — a plausible wrong number that prints
on the proposal. `unitAccepts` (pure): a blank unit adopts the measurement's,
the same word however spelled keeps it (`sf`, `sq ft`, `sq. ft.`, `square
feet`), anything else is REFUSED by name — *Baseboard is priced per lf and
this measures 93.5 sq ft; pick a line priced per sf, or a new line* — a new
`JobsError` code, `UNIT_MISMATCH`. The same family is refused too, on
purpose: `sq` is a roofing square to one business and a square yard to the
next, so a conversion that guessed would be the same wrong number;
converting the unambiguous ones (sf → sy, m → lf) is an open item. The
dialog lists such lines greyed out with the reason, and a new line asked for
in another unit refuses as well.

**And one small one on the way past:** the dialog preselected the line a
measurement stood behind by matching its DESCRIPTION, so two lines with the
same words picked the wrong one. The view carries the line's id now
(`takeoff.lineId`) and preselects by it, falling back to *A new line* when
that line can no longer take the unit.

**No migration.** The column's meaning changed, not its shape, and every row
a single-measurement push ever wrote already holds its own share (for one
measurement the share IS the total). A row a multi-measurement push wrote
before this holds the total and reads as drifted until it is pushed again,
which is the one thing a re-push corrects.

**Driven** on the dev branch's Hilltop Farm 24-109, sheet A-101, on this
worktree's own server. A second area (52.2 sq ft) drawn beside 9c's (59 sq ft),
*Takeoff* on it with both ticked onto EST-2's *Flooring, kitchen*: both rows
read `→ EST-2 · Flooring, kitchen · 111.198 sf` with **no** *measured since*,
where the code before this read *measured since* on both the moment after. The
*Line* list showed *Footing concrete · 1 cy · priced per cy, cannot take sf* and
the three `ls` lines greyed out, the blank-unit lines and *Slab on grade · 1 sf*
open to pick. *Takeoff* on the 59 sq ft row then opened with *Flooring, kitchen
· 111.198 sf* already picked — by id now — and pushing it alone put the line
back to 59.026 sf; the second area was rubbed out, so the worked example is as
it was.

### 2026-09-21 — The picture is the card (`claude/bigger-thumbnails`)

The founder, with pictures on his set at last: *"there is a fair amount of
wasted space with the thumbnails. it would be nice if they were bigger."*
He was right twice over, and only one of the two was visible.

**THE BOX WAS A STRIP, AND THE PICTURE A STAMP IN IT.** The card's image was
a fixed 112px-high band with the drawing centred — on a ~490px desktop card
that is a picture a third of the width with white either side. It is now
**the card's full width in a 3:2 box**, which is ARCH-D's own shape (36×24),
so a plan fills it; a portrait detail sheet letterboxes, the honest way to
show a tall page in a grid every card of which is the same height.

**AND THE STORED PICTURE WAS 168px WIDE**, because when it was chosen the
only place it showed was the index table at 96px. Stretched to a card it
would have been a blur, so `THUMBNAIL_WIDTH` is **480** — 1:1 on a desktop
card, 1.4× on a phone's, at roughly 40–60KB a page. A forty-page set is a
couple of MB on the drawings page, which on site is the trade worth making
for pictures you can read. **Sets read before this show soft until read
again**, the same `Read again` → `Save` as before.

### The production scare that was not one, recorded so it is not repeated

Between the two PRs the founder re-read his set on production and reported
**no pictures**. I diagnosed from the screenshot — thirty-seven uploads fired
at once against an authenticating serverless route, every failure swallowed
by an `allSettled` — and rewrote the upload before confirming any of it. Then:
*"they are working now."* The original code had worked; the pictures were
there on a later look. The likeliest cause is the page refreshing before the
freshly written blobs were readable, each `<img>` 404ing and hiding itself
for that one page load — unconfirmed, and left alone until it is seen again.

The rewrite is kept **as hygiene, with a comment that says so**: `THUMB_LANES`
uploads at a time rather than a stampede, one retry, and what could not be
kept counted and put in front of the person with the way to fix it. A
best-effort step that reports nothing is indistinguishable from one that never
ran — that part was true whether or not it had failed. See
[[a-repro-is-a-claim-check-the-row]]: the report named a cause, the fix was
built to the cause, and the row said otherwise.

### Driven, on dev

The permit set read again and saved: its three sheets came back at
**480px wide** (`naturalWidth`, measured) in a 3:2 box the card's full width
— 272×181 on the pane — while ASI 1's two sheets, never re-read, stayed
compact with no picture. No migration, no seed.

### 2026-09-22 — The lumber list (`claude/the-lumber-list`, X16)

The framing half of *"lumber takeoff … from the model"*. A framing schedule
names a member by its type AND its cut length — forty-six 2x10s at 14' and
twelve at 12' — and X15 grouped by the naming column alone, which folded
every 2x10 into one row with a total length. A lumber list is pieces by size
and length, so a thing may now be named by two columns.

- `alsoColumnDefault` (pure): a schedule with a *Count* column beside a
  *Cut Length* column is named by type and length unless the person says
  otherwise; anything else by one column. `takeoffRows` takes the second
  index and keys on `${type} · ${length}`; the slug reduces the pair.
- The preview says which columns named things (`namedBy`, `alsoBy`) and
  offers the alternatives (`nameChoices`, `alsoChoices`); the dialog shows
  two *Named by* selects above the rows and re-reads the schedule when either
  changes; *— nothing* (`alsoBy: -1`, said out loud) is not the same as left
  unsaid. The import groups by the same choice the preview showed.
- `2x10 · 14' - 0"` as a line by its count is the lumber list, priced per
  piece from the book; as an assembly per `ea` it comes in priced.

Tests: the pure default and the split (`jobs-bim-takeoff`), and the preview
and import told *nothing* (`jobs-bim-takeoff-ops`).

### 2026-09-22 — A phase the estimate already has (`claude/a-phase-the-estimate-already-has`, X17, [ADR 0108](../decisions/0108-a-phase-the-estimate-already-has-is-stated-at-the-gate-and-ends-in-the-money-it-has.md))

The walk's side of the takeoff. X15 puts drywall, framing and roofing on the
estimate before the walk starts, and the walk could not see any of it: it
opened the drywall phase, asked who was doing it, proposed drywall lines,
and the estimate carried the drywall twice. The same for an item typed by
hand and for a previous walk's lines on the same estimate.

**What is a phase's** — `walk-coverage.ts`, pure, 9 tests: a line on the
phase's cost code (`normalizedCode`, so `09 25 00` and `092500` agree) or in
the item named after the assembly the phase is pinned to (X11). Never the
words. `coverageOf` / `coveredPhases` / `coverageLines` (*Drywall — $6,952.50
in 2 lines, off the model*) / `coverageReason` / `questionsToSettle` (every
outstanding question but a must-ask). `walk-coverage-ops.ts` reads the lines
this walk did not write — the proposed rows that remember the walk's own
(X9) are the exclusion — with the code number on this job's set and the
item's name, plus the library's names by id.

**Where it lands** — `LoadedWalk` carries `onEstimate` and `assemblyNames`
(two more reads in the same `Promise.all`). The gate (X13) gained a second
section: *"And these phases are already on the estimate, so I will move
past them"*, and is shown when there are standards OR covered phases; the
same two buttons stamp `usual_accepted` for both. `oneTurn`'s gather settles
a covered phase's questions right after the standards (`settleCovered`, off
the answers as they stand after the standards, so nothing is answered
twice), with the reason on each. `openPhase` asks `alreadyPriced` before
`priceTheStep`, whether the gate agreed or not — a refusal means *ask me*,
never *price the drywall twice* — and moves on through the same
`applyAndMoveOn`. `StepFacts` gained the on-estimate figures (optional) and
`reckonStep` reads a covered phase as priced at what the estimate carries —
*2 lines already on the estimate, off the model* — or as a hole when every
one of those lines is unpriced. `reckoningFor` reads the same facts.

**No migration.** `usual_accepted` means what it always did.

Tests: the pure rules (`jobs-walk-coverage`), and against the database
(`jobs-walk-ops`): an item named after the pinned assembly with a line off
the model is seen, is not settled until the gate agreed, settles the one
question that is not a must-ask with *already on the estimate — $5,562.00 in
1 line, off the model*, settles nothing a second time, and reckons as priced
at $5,562.00.

**Two more doors X13a missed, found by driving this.** `goToStepAction` (the
rail's *Work on this*) and `askAgainAction` opened a phase with a bare
`oneTurn`, not `openPhase`. A phase the standards cover is finished the
moment it opens, so jumping to one from the rail left the walk standing at
the next phase with *It has not asked anything yet* and nothing priced —
X13a's bug on two doors nobody had used on such a phase, because until the
takeoff there was no reason to jump to a covered phase. Both now call
`openPhase`, so a jump or an *Ask again* on a covered phase prices it (or
moves past it when the estimate already has it) and asks the next question,
exactly as every other door does.

### Driven

On the dev branch, a fresh estimate (24-111 EST-2) with the drywall takeoff
brought in off the model first, the Drywall step pinned to the *Drywall, hang
and finish* assembly, then the walk:

| | |
| --- | --- |
| The measure-up | skipped — the building measured and 7 rooms on the job already; one tap on *Carry on* |
| The gate | the usual's nine standards, then **"And these phases are already on the estimate, so I will move past them: - Drywall — $6,952.50 in 2 lines, off the model"**; the rail already read *1 priced · $6,952.50 of cost on the estimate* with Drywall out of the unfinished list |
| That's right | Rough carpentry asked its always-ask question; the Drywall card on the rail read *priced · 2 lines already on the estimate, off the model · $6,952.50 of cost* |
| Work on this (Drywall) | the standard settled its one question, the phase finished, nothing was proposed — **and the walk stood at the next phase with nothing asked**: the bare-turn door above |
| Ask again, after the fix | Drywall re-opened, its standard re-settled, the estimate already had it, and the walk moved on to Painting and priced THAT: *Paint walls and ceilings — Kitchen, Great room, … — what are you getting for that?*; Drywall untouched, still one priced phase at $6,952.50 |

Nothing was priced twice at any point, with the gate agreed or the phase
re-opened.

### 2026-09-21 — The takeoff off the model (`claude/the-schedule-off-the-model`, X15, [ADR 0107](../decisions/0107-a-takeoff-off-the-model-is-a-join-through-the-assembly-keyed-by-what-the-model-calls-it.md))

The founder, an hour after X14 shipped: *"I'm really looking for way more
than just room schedules here. Lumber takeoff, drywall etc from the model."*
Right — the measure-up's numbers are what the walk asks for; the takeoff is
what the estimate IS. So the same reader now feeds the ESTIMATE, through the
assemblies, which were already parametric (ADR 0086) and only lacked the
join.

**The join** — `job_assembly_keys`: what the model calls each assembly, one
row per name, unique per tenant on the reduced name so a name means one
assembly and a re-mapping is a correction. Migrations 0418 + 0419 (RLS),
applied dev + prod, 244 tables verified; the isolation suite has its case.
Shown and edited on the assembly page under *What the model calls it*
(`assembly-editor.tsx`), saved with the assembly (`setAssemblyKeys` replaces
the list and moves a name typed on a second assembly; `rememberKey` upserts
on the slug).

**The reader** — `bim-takeoff.ts`, pure, 15 tests: `keyColumnOf` (*Family
and Type*, *Material: Name*, *Type*, else the first word column that is not
a number or a mark), `takeoffRows` (grouped by the reduced name, every
quantity column added up, the count from a *Count* column or the rows,
nameless rows counted and left out), `matchAssembly` (remembered by slug,
else suggested when every significant word of the assembly's name is in the
model's — *Wood stud* in *Basic Wall: Exterior - 2x6 Wood Stud*, never
*Interior door, hung* in *Single-Flush: 36" x 80"*), `driverFor` (the row's
figure in the assembly's dimension, *Length* before *Unconnected Height*,
converted into its unit; the count for `ea` or per-nothing; null with
`whyNoDriver` otherwise), `lineFromRow` and `offTheModel`.

**The drop** — `bim-takeoff-ops.ts`: `previewTakeoff` (things with figures,
each with the assemblies it could drive and the size it would be dropped
at) and `takeoffItems` (each confirmed assembly through the SAME
`linesForDrop` that *Add an assembly* uses, so the quantities scale and the
codes resolve exactly as a drop does; plain lines by the figure chosen;
refusals by name and reason; the memory written on confirmation). Nothing
here writes an estimate line — the editor appends what comes back (ADR
0082). `tests/jobs-bim-takeoff-ops.test.ts`: 10 sheets per 320 sf at 3,708
sf is 115.875 sheets with the rate untouched, the name is remembered and
the second preview maps itself, a per-lf assembly on a material takeoff is
refused by name, and a name typed on a second assembly moves to it.

**The editor** — a *From the model* button beside *Paste a takeoff* and
*Add an assembly*, `bim-takeoff-dialog.tsx`, and `insertTakeoff` in the
editor. `LineDraft` grew an optional `basis`/`basisDetail`, posted only when
set, so a model-made line says *Drywall, hang and finish at 3,708 sf · off
the model: Wall Schedule · Basic Wall: Interior - 2x4 Wood Stud · Area 3,708
sf* and a typed line's basis is untouched; `estimateLineSchema` accepts the
pair and `updateEstimate` already wrote them only when given. Both dialogs
now share `schedule-input.tsx` — one UTF-16 decoder to keep right.

**Not built, on purpose:** an assembly driven by two figures at once (per lf
of 9' wall is how the founder already prices it); the takeoff opening the
walk's phases; waste as a separate factor. And the honest limit, written in
the guide: a schedule exported grouped WITHOUT totals shows one element's
figure beside a count of many, and no software can tell that from a total —
so the count sits beside every figure on the preview.

### Driven

On the dev branch, on the same test estimate (24-111 EST-1), with a
*Drywall, hang and finish* assembly made on the library page — 10 sheets and
320 sf of labour per 320 sf, $600 the lot — and the wall schedule pasted:

| | |
| --- | --- |
| The preview | *2 things across 2 rows, named by Family and Type, 1 total row left out*; *Basic Wall: Interior - 2x4 Wood Stud · 22 in the schedule · Length 412 lf · Area 3,708 sf*; both rows on *— leave it out*, since nothing was remembered and no words matched |
| The picks | Interior → *Drywall, hang and finish — at 3,708 sf* with *320 sf of it is $600.00* beside it and `remember` ticked; Exterior → *as a line, 248 lf*; the button read **Bring in 1 item and 1 line** |
| The editor | the item with *Drywall, 1/2 in sheets 115.875 @ 12.00* and *Hang, tape and finish 3,708 @ 1.50*, the loose line *Basic Wall: Exterior - 2x6 Wood Stud 248 lf*, cost $6,952.50, autosaved; the toast *Added 1 item, 1 line, 1 name remembered off the model* |
| The database | both assembly lines `basis = assembly` with the whole story in `basis_detail`, the loose line `basis = none` with its clause, and `job_assembly_keys` holding *Basic Wall: Interior - 2x4 Wood Stud → Drywall, hang and finish* |
| The second paste | the Interior row came up already on *Drywall, hang and finish — at 3,708 sf* with the *remembered* chip, and the button read **Bring in 1 item** |

**And the drive found a defect X10 had shipped.** The first item came in
with the client paying **$0.00**: every line carried an explicit unit price
of $0.00 and a markup of 0%. Not the takeoff's doing — the library screen's
save mapped an UNSET markup and price to zero (`?? 0`), and the action's
schema would not take a null, so every assembly edited on that page dropped
its lines at a price of nothing, through *Add an assembly* too. **Every
assembly line on both databases was affected — 5 of 5 on dev, 1 of 1 in
production.** The schema and the screen now keep null, and migration 0420
put the rows back to unset (an explicit $0.00 price on a line that costs
something is not a thing anybody meant); the second drop priced at
$6,952.50. Estimate lines dropped from a zeroed assembly BEFORE this carry
the $0.00 price on the estimate itself and want a look — a no-charge line
is a real thing on a bid, so those are not repaired blind.

### 2026-09-21 — A schedule off the model (`claude/the-schedule-off-the-model`, X14, [ADR 0106](../decisions/0106-a-takeoff-can-be-read-off-the-models-own-schedule-and-the-boundary-is-rows.md))

**The founder's first answer on the first day of this layer — *they draw in
Revit* — finally has code behind it.** Every number the measure-up asks for is
in the model before anybody opens a PDF, and every modelling tool exports a
schedule as delimited text (*File → Export → Reports → Schedule* in Revit).
So the measure-up takes one: drop the file or paste it, the preview says what
it found, a person confirms which column answers which measurement, and the
walk carries on from wherever it stood.

**What it reads** — `bim-schedule.ts`, pure, 29 tests on fixtures shaped the
way Revit actually writes them:

- `parseSchedule` — the title on its own line, every cell quoted, the inch
  mark Revit leaves before a closing quote (`"63' - 4""`) AND the properly
  doubled form, group headers (a line with only its first cell), group
  footers (`Level 1: 7`), the *Grand total* line, a grouped-headers line
  above the real one, tab / semicolon / comma, CRLF. `decodeScheduleBytes`
  reads the file's bytes first: **Revit writes UTF-16**, and read as UTF-8
  that is a NUL between every letter and a parser that finds nothing.
- `readQuantity` — `1,234 SF`, `245.32 ft²`, `63' - 4 1/2"`, `2743 mm`,
  `1 234,50 m²`, `12 CY`; nothing for `<varies>`, `Not Placed`, `$1,200.00`,
  `12%`. Thousandths, canonical units, feet-inches into feet.
- `readColumns` — a quantity column is one whose rows agree on a unit;
  **a room number parses as a figure and its total means nothing**, so
  *Number*, *Mark*, *Level* and the like are excluded by header. A footer
  that carries only figures under blank word cells is found here, because it
  needs the columns known first — which is why this classifies twice.
- `readRooms` — a name column plus a level column, an area column or a
  title that says rooms; the level from its column or the group heading the
  row sat under; the second *Bathroom* on a floor told apart by its number
  rather than lost (ADR 0101's rule); *Not Placed* and *Redundant* left out
  and named; *Not Enclosed* a room with no area; an *Area* column of bare
  numbers still the area.
- `suggestMeasures` — every significant word of the measurement's name in
  the title or the header, same dimension: *Roof area* under *Area* in a
  *Roof Schedule*, *Wall height* under *Unconnected Height* in a *Wall
  Schedule*; NOT *Wall perimeter* under *Length*, because the pack does not
  know those are the same thing and will not pretend to.
- `figureFor` / `convertThousandths` — a total, the figure every row shares,
  or the row count; converted only within a dimension; refused by name
  across one. An outline unit the pack does not know refuses a stated unit
  and passes a bare number.

**Where it lands** — `bim-schedule-ops.ts`: `previewSchedule` (columns with
totals, the rooms with *already there* flags, the outline's list with what
the building already has, the suggestions) and `importSchedule` (rooms
through `addRoomList`, figures through `recordMeasurement`, both
`source = 'schedule'` with a note naming the schedule, the column and the
rows). `addRoomList` grew an `areas` argument for the unit, source and note
of a whole list. **Migration 0417 widens the source CHECK**; applied dev +
prod, RLS verified at 243 tables, the CHECK proven in `pg_constraint` on
both. `tests/jobs-bim-schedule-ops.test.ts` is the one place that proves a
`schedule` row is accepted — CI applies every migration from zero and cannot
tell.

**How the walk takes it** — two actions in `walk-actions.ts`,
`previewBimScheduleAction` and `importBimScheduleAction`. The import carries
the walk on through the SAME continuations a typed answer uses: mid
measure-up `afterMeasuring` (the next figure the file did not hold, then the
rooms, then the usual, then the first phase); on the rooms question with
rooms just added, `answerRooms`; anywhere else the numbers are on the
building and the screen reads them. No second state machine. Three doors on
the screen — beside *Measure it on a drawing*, beside the room list, and a
small one in the side panel once the measure-up is over — all
`BimScheduleDialog`, one `afterImport`. A figure off the model shows a table
icon where a traced one shows a ruler.

**Not built, on purpose** (each a reader or a consumer of the same table,
never a rewrite, because the boundary is rows): an IFC reader; remembering
which column answered which measurement per tenant; the join from type
names to assemblies the dossier has described since X1 — the pilot's library
holds ONE assembly, so there is nothing yet to join against; writing a
figure under the column's own name when the outline has no measurement for
it.

**Trap this slice paid for:** `schedule-ops.ts` already existed — it is the
CONSTRUCTION schedule, slice 12 — and a new file written under that name
overwrote it. `tsc` said so within the minute (the job page lost
`listPhases`), `git checkout --` put it back, and everything here is named
`bim-schedule` so the two can never meet again. The Write tool says
*updated* rather than *created* when a file is already there, and that one
word is the whole warning.

### Driven

On the dev branch, on a job that had never been measured (24-111, *Lane
drainage*), with the pilot's own `New build` outline — three declared
measurements, standards on nine phases — and three schedules pasted in the
shape Revit writes them:

| | |
| --- | --- |
| Wall schedule (4 rows + grand total) | preview read *Length 128 lf across 4 rows · Area 1,152 sf · Unconnected Height 36 lf across 4 rows · 9 lf on every row* and *1 total row left out*; *Wall perimeter* picked by hand, *Wall height* found by its words; **the walk moved itself to *Roof area — how many sf?*, 1 to go** |
| Roof schedule (2 rows + grand total, `6" / 12"` slopes) | *Area 1,824 sf* suggested against *Roof area* by its words, the slope column correctly not a figure; **the walk moved itself to the rooms question** |
| Room schedule (8 rows, two group headings, two group footers, grand total) | *Add the rooms — 7 on 2 floors, 6 with an area*, *Read from Name, Level and Area*, *Line 13: Storage is not placed in the model*, the second *Bathroom* as *Bathroom 203*, *Mud room · no area*; **the walk answered the rooms question and stood at the usual gate** — nine standards across nine phases, one tap |
| The side-panel door, past the measure-up | the wall schedule read again, *Wall height* replaced 36 lf with 9 lf, and the walk did not move |

Three pastes, four figures, seven rooms, no typing. The measure-up that took
fifteen typed answers on EST-4 took three.

**And the drive found a defect the tests had not.** The words matched *Wall
height* to *Unconnected Height*, the default took the column's TOTAL, and
**36 lf went onto the building** for a wall that is 9' tall on every one of
four rows. The pack cannot know whether a uniform column wants its total
(four equal roof planes) or its figure (four equal wall heights), so
`suggestedUse` now suggests the MEASUREMENT and not the figure for such a
column, the row reads *looks like Wall height — the total, or the figure on
every row?*, and the person chooses. A plausible wrong number is worse than a
refusal; this one was on the screen within a minute of driving and invisible
to every test until one was written for it.

### 2026-09-21 — Sheets you can see, in the order you read them (`claude/sheets-you-can-see`)

The founder, with the Wright house set read in and on the screen: *"The
drawings should show thumbnail. Also, I should be able to organize the
categories. architectural, then structural etc. right now structural shows
first but I would not want that."*

**THE PICTURE WAS ALREADY BEING DRAWN AND THROWN AWAY.** Indexing renders a
168px JPEG of every page for the index table, and it died with the dialog.
It is now uploaded and the cards show it.

**KEYED BY THE PAGE, NOT BY THE SHEET, AND SO NO MIGRATION.**
`sheetThumbPath(tenant, document, page)` is derived, so there is no column to
add and nothing has to round-trip a sheet id before it can store a picture: a
thumbnail is a picture of page 12 of a file, and which sheet number that page
is called is the office's decision, correctable on a re-read, while the
picture does not change. Re-reading overwrites rather than orphans
(`addRandomSuffix: false`, `allowOverwrite: true`).

**THE SHEET ROW IS THE PERMISSION.** A derived pathname means nothing stops a
caller asking for any document and page, so `/api/jobs/sheet-thumbs/[doc]/[page]`
reads a `job_sheets` row for that pair through RLS, carrying the caller's
role, before it streams. No sheet, no picture, same 404 either way. The upload
door is **a deliberate sibling** of Documents' rather than a parameterised
version of it — that route's own note says why: one door answering to two
module gates has cross-module escalation as its failure mode.

**A SET READ BEFORE THIS HAS NO PICTURES, AND NOTHING RE-READS ITSELF.**
`Read again` then `Save` is the whole fix and it changes nothing else.
Re-reading a forty-page set is the browser's work and doing it unasked on
every page load would be rude. The card falls back to exactly what it showed
before, which is why the empty state needed no design.

### The order is the business's, and the standard is what it was

`DISCIPLINE_ORDER` is the **US National CAD Standard's**, and the standard
genuinely puts **S before A**. He is not wrong and neither is it — a builder
of custom homes reads architectural first; a bridge engineer does not. So it
is config (`config.disciplineOrder`, owner-only, `setDisciplineOrderAction`
mirroring `setJobTabsAction` down to the `withSystem` justification), and a
pack that shipped one builder's reading order would be the pack knowing its
client.

**WHAT IS SAVED IS THE WHOLE VISIBLE ORDER**, not the heading that moved: a
list of one would leave everything else to the standard, and the next job
carrying a discipline this one has not got would read in an order nobody
chose. **Anything never named keeps its place in the standard's own order,
after everything named**, so putting architectural first does not shuffle the
rest. It sorts the SHEETS too, not just the headings — `listSheets` takes the
order — or the grid and the superseded list would disagree.

### Two things found by driving it

- **The grip was hover-only, which is invisible on a phone.** It copied the
  estimate grid's fade-in, and on the screen a builder actually stands in
  front of there is no hover — the only way to reorder anything could not be
  seen. It is always visible now.
- **A card with no picture and a card with one have to be the same height.**
  They are (`h-full` on the link, the grid stretching the row), which is why
  a part-re-read set reads as a grid rather than a ragged wall. Measured, not
  assumed: all four cards in the mixed row came back 194px.

### Driven end to end, on dev

24-109's seeded set: cards with no pictures fell back cleanly, `Read again` +
`Save` on the permit set put pictures on its three sheets while the ASI 1
sheets stayed pictureless, and dragging ARCHITECTURAL above STRUCTURAL
reordered the page, saved, and survived a reload —
`Architectural · 3 / Structural · 1 / Electrical · 1`. The same at 375px, one
column, no horizontal overflow. **No migration, no seed.**

### 2026-09-21 — A phase the standards covered is still a phase (`claude/a-phase-the-standards-covered`, X13a)

**Found by walking a whole bid**, which nobody had done since X1. X13 shipped
green and inert-in-the-worst-place: the walk went **1 → 3 → 5** and the
estimate had two items on it.

X6's rule is that a phase ends in money, and until X13 every phase ended
because somebody answered its last question — so *"price the phase that just
finished"* lived in `runTurn`, where the answering happens, and that was
enough. **Standards broke the assumption.** A phase whose every question the
outline answers for itself is finished the moment it opens, with no answer and
no turn at all.

And **four paths open a phase without going through `runTurn`**: the end of
measuring, the rooms, agreeing the usual, and the last price of a phase. Every
one of them called `oneTurn` directly.

The fix is one function, `openPhase`, that every path now calls: it opens the
phase, and prices any phase that comes back already finished before moving on.
Pricing that needs to ASK returns straight away, so the loop only ever runs on
phases the pack could price by itself. `oneTurn` stops and reports
`stepFinished` the moment settling covers a step, which costs no model call —
the point of a phase that needed no conversation.

**The worst possible shape, and worth remembering:** the standards cover the
80%, so the 80% was exactly what stopped producing money.

### What the whole bid looked like

Ten phases, twelve questions, on a building already measured from an earlier
estimate. **About fifteen answers** produced a complete priced bid:

| | |
| --- | --- |
| Measure-up | skipped entirely — the building was measured on EST-2 |
| Rooms | one tap (*"11 rooms on this one already"*) |
| The usual | **one tap for 9 questions across 9 phases** |
| Conversation | 3 questions — the ones that actually vary |
| Money | one question per unpriced line, each carrying its measurement |

Seven items, `$112,089.77` of cost. Questions arrived as *"Roofing, in-house,
59.026 sf — what are you getting per sf?"* and *"Rough-in plumbing — Kitchen,
Powder room, Master bath, Hall bath — what are you getting for that?"* — the
measurement and the rooms in the question, which is the answer to the
founder's original *"who is doing this one — it doesn't give any context."*

### What it also showed, and did NOT fix

**Three phases came out `answered, nothing priced`** — Cast-in-place concrete
(skipped before the fix went in), Drywall and Painting. The last two proposed
no lines at all: their only input was *"in-house"* and the model declined to
invent scope from it, which is the doctrine working. Roofing and Gutters, with
the same single input, DID propose — off the roof area and the perimeter.

So a phase with a standard and no measurement to hang anything on can still
come out empty. **The reckoning names all three**, which is ADR 0099 doing its
job, and the estimator picks them up. Whether such a phase should instead be
made to ask something is a design question, not a defect, and it is the
founder's to answer.

**A separate wrinkle seen once:** after a phase was priced, a dead price
question stayed on screen while the header had already moved to the next
phase. Not reproduced on the clean run, and not chased.

### 2026-09-21 — A page you can actually read (`claude/reading-the-sheet-titles`)

The founder, having uploaded a real set: *"It did a really bad job of reading
sheet names and numbers. It only read maybe 10% of them. Also, the thumbnails
should be able to be clicked on and expanded so I can manually read the
drawing name or number."*

**TWO HALVES, AND ONLY ONE OF THEM CAN BE BUILT WITHOUT HIS FILE.** This
entry is the second half. The reading itself is deliberately untouched — see
*What is NOT fixed here* below.

**A THUMBNAIL CANNOT BE ENLARGED INTO AN ANSWER.** The index's picture is a
168px JPEG; scaling it up gives a blur, not a sheet number. `PageLoupe` draws
the page again from the PDF at up to 8×, with a **`Title block`** button that
goes straight to the bottom-right corner at 4× — where every convention puts
the number, so on a set the reader missed it is two clicks from the row to the
answer.

**AND IT IS A PLACE TO TYPE.** Reading the number is half the job. The
`Sheet`, `Title` and `Rev` boxes and the is-it-a-sheet tick are in the loupe,
Enter saves and moves to the next page, and the arrows walk the set — so
forty numbers is one pass rather than forty open-close-type rounds. That is
the difference between a viewer and the thing the complaint asked for.

**THE BYTES GO WITH THE READ** rather than the file being fetched again: the
browser had them a second ago, and a 50MB set downloaded per look is the slow
way round. `readPdf` hands its own COPY to pdf.js for the reason below.

### Three things found by clicking it, none of which any test would have

- **pdf.js DETACHES the array it is given.** `getDocument({ data })`
  transfers the buffer to its worker, so the caller's `Uint8Array` comes back
  detached and every later read throws *"Cannot perform Construct on a
  detached or out-of-bounds ArrayBuffer"*. That cost nothing while `readPdf`
  threw the bytes away, and everything the moment the index kept them.
  `readPdf` now passes a copy. **This is a defect in the read path, not in
  the loupe** — anything that wanted those bytes would have hit it.
- **`position: fixed` inside a dialog is not fixed to the viewport.** The
  panel is placed with the CSS `translate` property, which makes it the
  containing block for anything fixed inside it: the loupe laid itself out
  inside the dialog's box and was clipped by its scroll — in the DOM,
  measurable at 768×660, and invisible. It is portalled to `document.body`.
  Same family as [[breakpoints-cannot-see-the-layout]]'s traps.
- **Escape closed the whole index.** Radix closes a dialog on Escape from its
  own document listener, so one press shut the loupe AND threw away every
  number typed into the table. The handler is in the CAPTURE phase and stops
  the key.

And one that looked right and was not: **`Title block` set the zoom and
scrolled on the next frame**, before React had re-rendered, so it scrolled to
the far edge of a 1× page and the canvas then grew underneath it. Nothing
errored; the button simply did nothing. The scroll is consumed by the render
effect once the canvas has its size.

### And then the file arrived, and it read 37 of 37

**It was 19%, not 10%, and the 19% was worse than the 81%.** Of the seven
pages the old reader "read", five were detail callouts picked off the middle
of the paper — `FW3`, `W9`, `FN14`, `W3` — and the titles were the PROJECT
name, `Wright - new`. A number it invents is worse than one it admits it
cannot find.

**Three faults, all visible the moment the real title block was printed out.**
Every run in that set reports **width 0** — pdf.js gives no advance width for
this producer's text — which is the root of the first:

1. **The number cell is joined to the cell beside it.** With no widths,
   `linesFrom` merges runs within `1.5 × height`, and at 37.5pt type that is
   56pt of tolerance — so the index cell and the number cell arrive as one
   line, **`"2 A1.1"`**, and an anchored pattern rejects it. `sheetNumberIn`
   now looks for a number-shaped WORD, and refuses a line holding two.
2. **Nearest-the-corner handed the answer to a callout.** A title block's
   number cell is inset from the paper edge; a callout bubble can sit lower
   and further right. The number is set in 37.5pt where nothing else in that
   corner is over 25 — **size is the signal and the corner is the filter**,
   so the sort is by height first.
3. **A sheet name is set on two or three lines.** `FOUNDATION` over `PLAN`,
   and the old rule took the single biggest line: half a title. `stackedTitle`
   joins same-size lines running up from it and **stops where the leading
   opens out** — 28pt within the name, 43pt to the project name under it,
   which is the name of the job and the title of nothing.

Measured on the founder's own 37-page set, before and after: **7 of 37 (19%)
→ 37 of 37 (100%)**, numbers `A1.1`–`A1.7`, `A2.0`–`A2.4`, `A3.0`–`A3.4`,
`A4.0`–`A4.2`, `S1.0`, `S2.0`–`S2.5`, `S3.0`–`S3.3`, `E1.0`–`E1.5`, every one
unique, with titles like `Main floor wall framing plan - east`.

**The tests are the real geometry now.** `tests/jobs-drawings.test.ts` gained
a block built from that title block's measured coordinates — 2592×1728, the
number at y=111 in 37.5pt, the sheet name at 265/293 in 24.9pt and the
project name at 336/364/392 in the same 24.9pt. Four of them fail against the
old reader. The nineteen synthetic ones still pass, which is exactly the
problem with them: they passed all along.

### What was NOT fixed before the file arrived, and why

**The reading, until the founder sent the PDF.** `guessSheet` is a heuristic
over a real title block and **every test it had was synthetic**. A stand-in
set built for this slice (landscape ARCH-D, right-edge title block, a cover
with an index) read **7 of 7** while his read one in five — so the tests
passed, a clean file passed, and what failed was whatever real sets do that
neither did. Guessing at the regex against another made-up file would have
been the same mistake a print fix already paid for here. **The right move was
to ask for the file and build the instrument**, and the diagnosis took two
minutes once it was in hand.

**Nothing of his upload survived to look at.** Neither database has a drawing
set beyond the seeded two, and the largest PDF in the dev cabinet is 0.1MB —
the index was abandoned before saving, which is what a set needing 90% typed
would produce. (The first check said zero sets on both and was WRONG: it ran
as `app_user` with no tenant context, so RLS returned nothing. Re-run as the
owner it says two, seeded. A count of zero from the app role is not evidence
of anything.)

**There is an instrument waiting for the file.** A script mirroring
`pdf-reading.ts`'s coordinate mapping exactly and calling the real
`guessSheet` prints, per page, what was proposed, why it failed, and the
dozen lines nearest the bottom-right corner with their scores. One command
over his PDF names the cause.

### Driven end to end, on dev

On 24-109, a set added, the file read into 7 pages, the page 4 picture
clicked: the page drawn full screen, {button:Title block} landing on
`SHEET TITLE / EXTERIOR ELEVATIONS` and `SHEET NO. / A-201` large enough to
read, `A-102B` typed into the loupe and present in the table row after Esc,
Enter walking from page 4 to page 5. The same at 375px, where the toolbar
wraps to two rows and the corner still lands. The trial set was removed
afterwards.

### 2026-09-21 — Don't ask what never varies (`claude/dont-ask-what-never-varies`, X13, [ADR 0105](../decisions/0105-a-question-can-carry-the-answer-this-business-always-gives-and-the-walk-states-them-all-before-it-takes-any.md))

> *"i'd say 80/20 standard vs custom."*

and, with a screenshot of the walk asking it for the ninth time:

> *"I'm getting questions like this one: who is doing this one. it doesn't
> give any context."*

Thirty-three phases asking who is doing each one is thirty-three questions
with a single answer, against a target of a bid in forty-five minutes.

**Migration `0416`:** `standard_answer` on
`job_estimate_outline_questions`, `from_standard` on
`job_estimate_interview_answers`, and `usual_asked_at` + `usual_accepted` on
`job_estimate_interviews`.

### Per QUESTION, which is the whole safety of it

The same prompt on the roofing step stays blank, so the walk still asks the
phases that really are decided job by job. **The difference between skipping
what never varies and assuming what does is exactly which boxes a business
chose to fill**, which is why this is not a business-wide default.

`always_ask` refuses a standard at both ends — `writeSteps` will not store one
and `standardsIn` will not read one — because *"is there asbestos?"* is the
reason that flag exists and a default answer is the quiet judgement it was
written to refuse.

### Stated before anything is taken

Before the first phase: *"here is what I will take as read — 3 questions
across 3 phases"*, with **That's right** and **Ask me everything**. Grouped by
what they SAY (`- Who is doing this one? In-house — every phase`), because
thirty-three identical lines is a rubber stamp and a rubber stamp is worse
than no confirmation at all.

Each standard is then settled **as its phase opens**, and only while still
outstanding — so a phase somebody has been through is not re-answered
underneath them, and `Ask again` gets the standard back, which is where the
walk was before. Everything settled that way carries `from_standard` and reads
*your usual* on the screen and in the reckoning.

### Three states, two columns

`usual_asked_at` (null = not stated) and `usual_accepted` (null = on screen,
true = agreed, false = ask me everything). **A `false` has to be as durable as
a `true`**, or a walk that asked to be asked everything meets the same offer
on its next turn.

### THE BUG DRIVING FOUND: three ways out of measuring, one gate

`startMeasuring` when there is nothing to measure, `afterMeasuring` when the
last number lands, and **the rooms answer — which is the way every walk with a
measuring outline actually leaves.** The first two had the gate; `answerRooms`
has its own `finishMeasuring` and went straight to the opening turn.

It read `usual_asked: false` on a walk that had finished measuring, so
**nothing would ever have been taken as read on any real walk** — the feature
would have shipped inert, with every test passing. The same shape as X7's
measurements reaching one prompt and not the other.

Two smaller things the same drive found: the walk's own line breaks were being
collapsed (nothing had ever put a LIST on that screen, so every `say` was one
line), and `WalkAnswer` had to carry `from_standard` as well as the view, or
the reckoning — the place somebody checks what is going out — would have shown
an assumed answer as if somebody had typed it.

### The walk that was already running

A walk past measuring when this shipped never sees the gate and takes no
standards. Deliberate: the alternative is a walk in progress suddenly
answering its own questions.

### 2026-09-21 — The allowance (`claude/the-allowance`, X12, [ADR 0104](../decisions/0104-an-item-can-be-an-allowance-and-accepting-the-estimate-makes-it-a-selection-at-the-price-the-client-signed-for.md))

> *"one more thing, we ususaly have some items listed as an allowance. things
> like plumbing fixtures etc."*

**The machinery was already here and had no way of starting.** `job_selections`
has held allowances since slice 8 ([ADR 0067](../decisions/0067-a-selection-is-a-decision-with-an-allowance-and-priced-choices-and-its-difference-moves-by-change-order.md))
— what the contract set aside, what the client chose, the difference raised as
a change order. An estimate simply could not SAY an item was one, so every
allowance had to be read off a signed proposal and typed into Selections
again, and any that was not typed in was never reconciled.

**Migration `0415`:**

| Column | On | Means |
| --- | --- | --- |
| `is_allowance` | `job_estimate_groups` | This item is a figure the client chooses against later. |
| `is_allowance` | `job_assemblies` | Every item this assembly makes is one. |
| `is_allowance` | `job_estimate_proposed_lines` | The phase this line is in lands in an allowance item. |
| `estimate_group_id` | `job_selections` | The item on the accepted estimate that made this. |

### The one question that decided the design

> *"the allowance is a cost we mark up like everything else."*

So the figure written onto the selection is the item's **scheduled price** —
its lines marked up, carrying their share of overhead and profit, the same
number printed on the proposal the client signed. $10,000 of cost at ten and
ten and ten is **$13,310**, and the db test asserts that figure by hand rather
than by running the code it is about.

Taking the COST would have given away the margin on every allowance in the job
and left the later change order comparing a price against a cost — which is
the one comparison that means nothing on a signed contract.

### It is an ITEM, not a line

An item is what the client buys (ADR 0079); an allowance is a promise about a
price; a promise needs a name and one number, and a line has neither on its
own.

### What driving it found, and what only the test could

Driven on dev: the chip on the item (`Firm price` / `Allowance`), the checkbox
on the assembly, and the proposal — EST-6 printed `Gutters (allowance)` over
its lines with every other item untouched. The dev estimate was put back
afterwards.

The acceptance path is proved by `tests/jobs-allowance.test.ts` rather than by
driving, because accepting a real estimate rewrites a contract's value: it
asserts the $13,310, the link by id, the client paragraph carried across, and
that an estimate with no allowance on it makes nothing at all.

### The trap it walked into, again

`isAllowance` had to be added to `applyProposal`'s whole-form group map. That
map's own comment already says a column left out of it is a column RESET on
every apply — `section` and `show_lines` were nearly lost that way the day they
were added, `isAllowance` is the third, and an item somebody marked by hand
would have silently gone back to a firm price the next time its phase was
priced.

### 2026-09-21 — A step names its assembly (`claude/a-step-names-its-assembly`, X11, [ADR 0103](../decisions/0103-a-step-names-the-item-it-always-makes-and-the-item-says-whether-it-is-one-line-or-a-line-per-room.md))

The other half of X10. X10 gave the library a screen, so thirty assemblies
became ownable; this is what makes the walk USE them without deciding to.

The founder's question, in full, is the one this answers:

> *"right now i'm struggling to see that we are going to get the consisten
> items being put on the estimate in the way i want with the verbiage i want.
> how do we cross this bridge?"*

Two judgements were still the model's, freshly made on every bid: **whether to
reach for an assembly at all**, and **whether four rooms are one line or
four**. Both are facts about the business.

**What was added.** Migration `0414`:

| Column | On | Means |
| --- | --- | --- |
| `assembly_id` | `job_estimate_outline_steps` | The item this phase always makes. Nullable, and null is the normal case. |
| `line_shape` | `job_assemblies` | `one_line` or `per_room`, default `one_line` — which is what the walk always did. |

Plus a new pure module, [`line-shaping.ts`](../../src/packs/jobs/line-shaping.ts),
and a `rooms` field on the propose tool.

### The rooms moved out of the sentence and into a field

X8b asked the model to name the rooms in the words of the line, and it did.
A FIELD is what makes them usable: **you cannot split `Tiled shower — master
bath, hall bath` into two lines without knowing where the name ends and the
list begins.** So `rooms` is its own array, the software composes the
description from it in the building's own spelling — which is also how one
room comes out spelled one way across every bid — and `baseDescription` is the
belt to that braces, cutting a trailing room list the model wrote anyway while
leaving `Tile — mud set, Schluter, mtl only` alone, because none of those is a
room.

### What `per_room` promises, and what it refuses

One line per room, **sized by that room's floor area only when the item is
priced in the unit the rooms are measured in**, and one of it otherwise. A
shower priced `ea` comes out one per room; carpet priced `sf` comes out at each
room's measured area, with the room named in `derivedFrom`.

Dividing a line's total between its rooms was considered and refused: it gives
every room a number nobody stated. And **nothing computes a `one_line`
quantity** — floor area is right for flooring and wrong for paint, the model
already derives it with the working shown, and a second invisible route to the
same figure is two answers to one question.

Rolling up ADDS the quantities and **only when both are known**. An unknown is
not a zero; a roll-up that quietly dropped half would read as a measured number
for a floor it covers part of.

### Driven, and what driving corrected

The pilot tenant's one assembly (*Tile flooring*, per 320 sf) pinned to a step
on a real walk of EST-6, Miller barn conversion, 11 rooms:

- **`per_room`** — 4 shapes in, 12 out. The pinned line split into 9 room lines
  at 310 / 420 / 280 / 24 / 224 / 62 / 132 / 48 / 576 sf, each note reading
  *"<room> floor area"*, and the assembly's own line descriptions carried the
  room: `Tile, material — Hall bath`.
- **`one_line`** — 4 shapes in, 4 out, rooms named, 6 rows on the bid.

**Both runs came back with `assembly: null` on every shape** — the model,
handed a pin it thought made no sense for that phase, ignored it. `applyPin`
made it true anyway, which is the entire point of the slice and the reason the
enforcement is not a prompt.

**And driving corrected `applyPin` itself.** It took the FIRST shape. If the
walk has already decided a line is a *different* assembly of theirs, taking it
throws away a decision the estimator's own library supports in order to honour
a default. It now lands on the first line that has not claimed one, and steps
aside when every line has.

### The instrumentation lesson

`console.error` from a server action did not reach `preview_logs` at all, and
half an hour went into theorising about a roll-up that was never broken — the
33-line run had simply been a `per_room` run. **Writing the inputs and outputs
to a file was what ended it in one click**, and the answer was that the code
was right and the assumption about which state the row had been in was wrong.
When a drive disagrees with the code, log the INPUT before re-reading the code.

### Kept comfortable

The picker is not rendered at all on an outline whose business has no
assemblies — an empty drop-down on every step of a thirty-step outline is
thirty pieces of furniture in the way. `assemblyId` absent leaves a pin alone
and `null` clears it, so the editor can unpin and a seed cannot silently
un-pin. And the composite FK is `ON DELETE SET NULL ("assembly_id")`, hand-
edited to the PG 15 column-list form, proved in `pg_constraint` on dev AND
production and again by deleting a real assembly in the db test — the trap this
repo has now paid for three times.

### 2026-09-21 — The phase the money belongs to (`claude/the-phase-the-money-belongs-to`)

Driving walk EST-6 on Hilltop Farm's 24-109, the header read

```
04. STRUCTURAL
Rough carpentry            step 1 of 10
```

over the question *"Wall board, 1/2", hang & finish, 1,216 sf — what are you
getting per sf?"*, which is a DRYWALL line. **Every price in a phase was
asked under the name of a different phase**, and the whole right-hand panel
went with it: *Nothing on this step yet* beside the answers you had just
given, and Rough carpentry's outstanding question under *Still to come*.

**X6 WROTE THE CAUSE DOWN AND DID NOT FOLLOW IT OUT OF ITS OWN FUNCTION.**
Its note says *"`currentStep` has already left the finished phase"* — that is
how the code knows the phase is finished, and it is why `proposeForStep` and
`moveToStep` both take the step EXPLICITLY. The screen still read it off the
derived one. Nobody reported it; it is confusing rather than wrong, and a
price answered against the wrong mental phase is the mistake this whole layer
exists to avoid.

**A PENDING PRICE KNOWS ITS OWN PHASE, SO NOTHING IS DERIVED.** The proposed
line carries `step_id`, and `step_title` and `step_section` AS THEY WERE —
columns X2b wrote for exactly this reason. `readPendingPrice` reads that one
row, **and costs no query at all when no price is pending**, which is every
ordinary turn. `LoadedWalk` carries it, so every caller of `walkView` has it
for free and the turn path passes its own.

**ONE PHASE, AND THE WHOLE SCREEN IS ABOUT IT.** The fix is not a second
override in the header — it is `phaseOnScreen`, one pure function in
`walk-price-math.ts` that `viewOf` calls once. `stepId`, `stepTitle`,
`stepSection`, `stepGuidance` and `stepNumber` are all that one phase, so the
header, the rail's ring, the answers panel, the outstanding list and the
proposal panel's *"What X comes to"* cannot each pick their own answer. The
screen's own change is four lines: a `what it costs` marker beside the name.
`WalkView.pricing` is non-null for exactly that marker.

**Two things it decides rather than ducks.** The outline is read live
(ADR 0098), so a phase RENAMED mid-walk reads by its new name and the line's
remembered words are the fallback — which is what lets a phase DELETED
mid-walk still say what it was called. And a phase the outline has lost
reports number 0, so nothing prints *"step 0 of 10"*.

### Driven, and the bug reproduced first

On dev, on the walk the founder left part way through. Gutters' last question
answered → the phase closed and asked for its money, under

```
Gutters   what it costs · step 5 of 10
```

with *"Who is doing this one? / In-house"* still in the panel beside it and
the ring on square 5. `6.50` per lf, then `840` for the downspouts, and the
item went on the estimate — the bid went from 2 priced / $12,467.70 to
3 priced / $14,139.70 — and the header moved to `Plumbing · step 6 of 10`
with the marker gone. Then the same again on Plumbing at 375px, where the
line still fits.

**And the old behaviour was confirmed on the same screen**, by turning the
new branch off for one reload: `04. STRUCTURAL / Rough carpentry · step 1
of 10` over the Gutters price question, `Nothing on this step yet`, and Rough
carpentry's always-ask question under *Still to come*. The report was exact.
`tests/jobs-walk-price.test.ts` holds the five cases, and four of them fail
against the old behaviour.

### 2026-09-21 — Owning your assemblies (`claude/owning-your-assemblies`, X10)

The founder, having seen the walk put *"Plan revisions, $150"* on a bid he
would never itemise:

> *"how do I influence or teach it what to write on the estimate... how do we
> control what sub members get put on an item. When to include equipment
> hours, when to include labor materials etc... I'm struggling to see that we
> are going to get the consistent items being put on the estimate in the way
> I want with the verbiage I want."*

**The answer already existed and was unreachable.** An assembly IS "how this
business writes this item" — its lines, its wording, its split between labour,
material and equipment — and the walk's own rule 3 has told the model to use
one since X2b. But:

- **There was no screen.** `find src/app -ipath "*assembl*"` returned nothing.
  You could not see what you had.
- **There was no UPDATE.** `saveItemAsAssembly`, `deleteAssembly` and
  `linesForDrop` were the entire library. Fixing a typo in one line meant
  deleting the assembly and building an estimate item to re-save from.
- **You could only make one from an estimate item**, never from nothing.

So: making one was a click; OWNING thirty was impossible. `updateAssembly`,
a library at `/dashboard/m/jobs/assemblies`, and an editor per assembly.

### The link that was missing, which was a different complaint

> *"One more thing. I don't see how to edit and manage the questions."*

They were at `/dashboard/m/jobs/estimate-outlines` the whole time. The only
two links to it in the app were on the panel shown to a tenant with NO
outline, and in module settings. **The place you teach it was unreachable
from the place you notice it needs teaching.** The projects page's owner row
now carries Estimate outlines and Assemblies beside Cost codes.

### Replace the lines, never merge them

`updateAssembly` deletes and re-inserts, the call `writeSteps` already makes
for an outline: the editor hands back the whole list as it stands, and
reconciling row by row needs an identity the screen does not carry. Nothing
points AT an assembly line — an assembly that made an estimate item copied
itself into that item, and the copy is the job's — so replacing loses
nothing. **Saving the library never reaches back into a bid you sent.**

### The bug that `tsc` and `build` were both blind to

`toEditable` — the conversion between stored cents/thousandths and what a
text box holds — was exported from the `"use client"` editor, and the server
page called it. **A server component may not call a function out of a client
module, only render one.** `tsc` was clean, `next build` compiled, and the
page threw on open:

```
Attempted to call toEditable() from the server but toEditable is on the
client.
```

It lives in `assembly-math.ts` now, which both sides may import. This is the
client half of the lesson the repo already had for `server-only`, and the
reason is the same: **a boundary violation is not a type error.**

### Driven

On dev, the library listed Hilltop Farm's one assembly (*Tile flooring*, per
320 sf, 3 lines, $3,584.00) — which carried two lines both called `tile
labour`, exactly the inconsistency the founder is worried about, preserved
from whenever it was saved and until now unfixable. Renamed one line and
saved; the row came back `v2` with **three lines, not six**, re-spaced by
tens.

**Not built yet, and it is the half that makes this a guarantee rather than a
hope:** a step naming its assembly, and an assembly carrying whether it is
one line or a line per room and whether it is an allowance. The founder has
settled the allowance question — *"the allowance is a cost we mark up like
everything else"* — so the client-facing allowance figure is the marked-up
price and a change order compares price with price.

### 2026-09-21 — Roll up what is identical, and name the rooms nobody priced (`claude/rooms-on-the-bid`, X8b)

The founder, asked how the walk beats a template estimate sheet with his
assemblies preloaded:

> *"with LVP flooring I typically just have one item for LVP that lists all of
> the rooms that includes. But for Showers I typically list each one
> separately. not always though. how do we handle things like that?"*

**His question showed X8's rule was half right.** It said *"a finish that
varies by room is one line per finish, not one per room"* — which is the LVP
half. It would have rolled three different showers into one line and he would
have split them by hand on every bid.

Look at his own examples and the rule writes itself: **LVP is the same product
in four rooms; three showers are different from each other.** So:

> **ROLL UP WHAT IS IDENTICAL; SPLIT WHAT DIFFERS.**

That is not a new idea — it is why *"not always though"* is in his question.
It is not inconsistency, it is the rule firing differently.

A second rule went in beside it: **name the rooms either way.** That is not
decoration; the next section reads those names.

### A room nothing on the bid mentions

The other half of his question was really *why is this better than a template*,
and this is one of the answers a template structurally cannot give.

**A template fails by silence.** A 291-row sheet's unfilled row looks exactly
like the row that does not apply, and the forgotten one is the error that eats
the margin. With a room list (X8) and lines that name their rooms, *"the powder
room has nothing on this bid"* is a fact this code can work out.

- Read off EVERY line on the estimate, not just the walk's own — a room covered
  by a line somebody typed by hand is covered.
- Matched on stemmed words, with **digits kept**: `2` is the entire difference
  between `Bedroom 2` and `Bedroom 3`, and the pack's own `significantWords`
  drops anything under three characters, which is why `room-math.ts` has its
  own.
- **Every word of the name must appear**, which errs toward warning. Wrong by
  warning costs a glance; wrong by staying quiet costs the omission.
- **Amber, and not counted in `ready`.** A garage with no finishes against it
  is usually correct. Blocking on it would teach somebody to ignore the panel
  that matters.

### The thing that made this worth the whole session

`tsc --noEmit` was **silently not type-checking the repo**. A corrupt
`.next/dev/types/validator.ts` — written by the running dev server, and inside
tsconfig's `**/*.ts` — had three syntax errors, and syntax errors abort the
program before semantic checking. It exited 0. Three call sites of
`reckoningFor` were missing a newly-required argument and nothing said so;
filtering `.next/` out of the output hid it completely.

`.next/dev` and `.next/cache` are excluded now. **`.next/types` stays included
— Next needs it.** Worth remembering next to the older lesson that `npm run
build` catches what `tsc` does not: it turns out `tsc` can also catch nothing
at all and say so with a zero.

### 2026-09-21 — The way back into a finished walk, and the phase that ended it early (`claude/back-into-a-finished-walk`, X9, [ADR 0102](../decisions/0102-a-person-picks-a-finished-walk-back-up-and-a-phase-lands-in-the-item-it-already-made.md))

The report was *"a phase you go back and answer on a finished walk is never
worked out into lines and never asked for a price"*, and it named `runTurn`'s
guard. **That guard is real and it was the third lock on a door with three.**
The button was not offered, the server refused the click, and only then was the
money skipped — so nothing about the reported flow was reachable, and the dev
branch bears that out: walk EST-6's transcript has no Drywall answer in it at
all, because there was no way to record one.

### What the dev branch actually showed

EST-6 on 24-109, read straight out of the database: `finished` at 02:06:08 with
**eight of its ten phases never asked**, including the foundation. It had been
taken to Painting (ninth) from the rail, answered there and at Landscaping
(tenth), and Landscaping is last on the list — so `applyAndMoveOn`'s
`nextStep`, which only ever looks FORWARD, found nothing after it and closed
the walk. The screen then said *"That is every question in New build"* over a
bid missing its concrete.

**`nextStep` was right until X4 made it possible to jump about.** `onwardStep`
is the rule ADR 0099 already stated: the next phase with work in it, after this
one if there is one and **back up the list if there is not**, and null — which
closes the walk — only when nothing anywhere is outstanding.

### A person may pick a finished walk back up; the walk may not

`goToStep` and `reopenQuestion` are the two doors a CLICK reaches, and they now
resume a `finished` interview. Everything else — `claimTurn`, `recordAnswers`,
`moveToStep` — still refuses a closed walk, which is what stops a stale tab
writing into a bid somebody has finished. An `abandoned` walk is never resumed:
somebody stopped that one on purpose, and its screen redirects to the estimate
anyway.

**No revisiting mode**, which ADR 0099 turned down and this would have been:
the walk is running because somebody is walking it, and it closes itself again
by the same rule that closed it the first time. The status is the fact.

### Which button, and why only one of them is offered

**Ask again is the only door into a covered phase.** Every phase of a finished
walk is covered, and `currentStep` honours a bookmark only while its step has
work — so *Work on this* on a covered phase would send the walk somewhere else
and the button would be a lie. It now appears only where `outstanding > 0`.
Superseding an answer is what makes a step outstanding again, which is exactly
what X4 built *Ask again* to do.

### The money bug underneath, which only driving it found

Applying a phase **always appended a new item**. Re-walk Landscaping and the
estimate grows a second `Landscaping` beside the first, both in the total —
proved on dev before the fix, at $2,100.00 next to $4.00. `applyProposal` now
finds the item this step already made **through the `estimate_line_id` the
proposed row kept and never through the name** (two items may share one, and a
person may rename the walk's — the founder's own sheet has `DRYWALL, INCL.
LABOR` over a step called `Drywall`), replaces the lines it put there, and
leaves anything else in that item alone.

That name-matching had a second face: with two items called `Landscaping`, the
linking pass at the end of an apply found the WRONG one, so the new rows were
never linked — the reckoning could not see the money, and the next apply would
have made a third item.

### And what the report named

`runTurn` guarded its pricing block on `first.finished`, which is only *"the
interview's status is not running"*. The two things it stood in for are said
directly now — a turn with no view has nothing to price, a resync recorded
nothing — so a phase that finished gets priced whatever happened to the walk
underneath it, and `applyAndMoveOn` puts the money on and then **leaves a
closed walk closed** rather than moving its bookmark or closing it twice.

Two more on the same seam: the last price of a walk used to come back as
*"This walk is finished. Start a new one to go again."* — because the phase
landed, the walk closed, and the opening turn for the next phase was taken
anyway — and `proposeForStep`'s bare `catch {}` is now a `catch` that logs the
step, because *"why did Drywall come out empty"* has to start somewhere.

### Driven, on dev, as the report asked

EST-6, in the browser. The finished walk's rail offers a way in for the first
time; **Work on this** on Drywall (never asked) picks the walk back up and asks
*"Who's handling drywall on this one?"*; the answer *"In-house. Half inch
everywhere, moisture board in both baths, ceilings hung and finished level 4."*
settles the phase, and the lines come out measured from the building:

```
Wall board, 1/2", hang & finish, 1,216 sf — what are you getting per sf?   2.25
Ceiling board, 1/2", hang & finish, 2,076 sf — …                           2.45
Moisture-resistant board, both baths — what are you getting for that?       480
Level 4 finish, all areas — …                                     Skip this one
→ ITEM "Drywall", 4 lines, and the reckoning went from $4.00 to $8,306.20
→ and the walk moved BACK UP to Rough carpentry rather than closing
```

Then **Ask again** on that same phase, answered and re-priced: still **one**
`Drywall` item, now holding the four new lines at $11,429.60, the old ones
gone, and the moisture board coming back at `basis: memory` from the price
said twenty minutes earlier. The duplicate `Landscaping` the old code made on
the way past was deleted by hand afterwards, so the dev bid is as it was plus
a phase that is now priced.

No migration.
### 2026-09-21 — The rooms in the building (`claude/the-rooms`, X8, [ADR 0101](../decisions/0101-a-room-is-a-name-a-floor-and-an-area-and-one-answer-is-shared-out-across-them.md))

The founder, right after X7 merged:

> *"along with the takeoff measurements at the start, you should identify the
> rooms on every floor... Then the estimate questions can start asking
> questions like what type of flooring in Master bedroom or what type of
> shower in master bathroom."*

And, asked what a room has to carry: *"the only reason i said we should
measure each room is we need to know flooring sq footage."*

**The pack already needed this and was faking it.** `job_selections.location`
is free text whose own comment says *"The room or area, as the business says
it: 'Master bath'"* — a string nobody can group by, filter on, or check for
completeness. Rooms give a concept that has existed since slice 9 a spine.

### A room is a name, a floor and an area

Nothing else. No room type: *Master bath* already tells the walk there is a
shower in it, the walk reads the names, and a taxonomy is a thing the tenant
maintains that would be wrong for commercial on day one.

**The area is a `job_measurements` row scoped to the room, not a column.**
That is X7 paying for itself: a room's area is read by the parser that reads
`24 x 40` and `38'-6"`, traced with the same *Measure it on a drawing*
dialog, and carries the same sheet-and-markup provenance. A room's WALL area,
when paint eventually wants one, is a ROW rather than a migration.

### The decision the feature lives or dies on

Fifteen rooms times five finish categories is seventy-five questions, against
a target of a bid in forty-five minutes. **The rooms are data the questions
USE, not a multiplier on how many there are.** Rule 2b in the walk's prompt:
ask *"what flooring is going where?"* once, say back which room gets what,
and NAME the rooms the answer did not cover. Rule 2b in the proposal's: one
line per finish with the rooms' areas added up in `derivedFrom` — fifteen
flooring lines is a bill of materials.

### Three things found by driving it

- **The rooms question never ran on a building that was already measured.**
  `askNextMeasure` stamped `measured_at` when the declared list came back
  empty, so a second estimate on the same job went straight to its first
  phase. Deciding the measure-up is OVER belongs to the caller, which knows
  the rooms are still owed.
- **A room was keyed per building.** A house has a `Bathroom` upstairs and a
  `Bathroom` on the main floor; 0410 would have refused the second. Corrected
  by 0412 before the branch left.
- **`proposeForStep` swallowed every failure in silence**, so a phase that
  proposed nothing was indistinguishable from a bug in that function — which
  is exactly where an hour went. It logs now.

### And one that was not mine

Going back into a FINISHED walk and answering a phase records the answers and
never prices them: `runTurn` returns early on `first.finished`, before the
money. That is X4/X6 behaviour and the whole point of the reckoning is going
back into a closed walk, so it is a real gap — spun out rather than widened
into this branch.

### Driven end to end, on dev

A fresh walk on a job whose building was already measured. It asked for the
rooms — which is the bug above, fixed — and this went in:

```
Main floor:            Upstairs:              ---
Kitchen     310        Master bedroom  14 x 16    Garage  24 x 24
Great room, 420        Master bath     62
Dining      280        Bedroom 2       11 x 12
Powder room  24        Bedroom 3
Mud room               Hall bath       48
```

→ **11 rooms, 9 with an area, 2,076 sf in all.** `14 x 16` read as 224, the
comma and the wide gap both split, `Master bedroom` did NOT split on its
single space, and *"Could not read 1 line"* named the `---`. Mud room and
Bedroom 3 came through with no area and an input beside them.

Migrations 0410–0413. Not built: reading the room names off a sheet's text.
`getTextContent()` is already in the codebase and returns positions, so that
is a parser, not a model — next slice.

### 2026-09-20 — The dossier got too big to read (`claude/jobs-dossier-sweep`)

Nothing about the pack changed. This records why the file you are reading is
shorter. It had reached **6,543 lines**, 86% of it build log, and AGENTS.md has
every session that touches the construction family read it FIRST — so its length
was a fixed tax on every future change to the biggest pack in the repo.

**A move, not a rewrite.** 4,511 lines and 54 of the 71 dated entries were cut
by line range into [jobs-build-log.md](jobs-build-log.md), oldest first, and the
result was proved against the original line for line: `121 + 1,147 + 4,511 + 764
= 6,543`, with `###` headings conserved at `110 = 51 + 59` — the 52nd in this
file is the heading you are reading. Not one entry was reworded, summarised or
tidied on the way past; the seventeen below this one are byte for byte what they
were, and rebuilding the original from the two files returns the same MD5.

**What stayed.** Everything above this log — the estimate program's plan and the
*IF YOU ARE CHANGING THE ESTIMATE SCREEN* table — plus the estimate interview
run (X1 through X7, 2026-09-19 and 2026-09-20) and the whole of Data model, Key
files & seams, Decisions & gotchas and Open items. Those four are never swept:
they describe the pack as it is, not how it got here, and they are the reason a
session can read a short dossier and still be told what binds it.

**One cost, accepted.** Seven archived entries link to
`#the-estimate-program-open-started-2026-09-16`, whose heading stayed here, so
those anchors no longer jump. Rewriting them would have made this a rewrite, and
the repo has already paid for that once; the archive's own header says where the
section went instead. `livestock-build-log.md` carries two of the same.

### 2026-09-20 — The walk measures the house before it prices it (`claude/measure-the-house`, X7, [ADR 0100](../decisions/0100-a-measurement-is-a-fact-about-the-building-not-an-answer-to-a-question.md))

Two asks from the founder, one message apart, and a defect nobody had
reported.

> *"I don't see where it allows you to open the takeoff inline... there are
> numerous times it asks for a square footage. I need the takeoff tool to get
> that a lot of the time."*

> *"What if before the questions it prompts you to grab measurements. Full
> exterior elevation square footage, wall square footage, wall perimeter etc.
> Then the questions can use this information as it goes."*

And the defect: **the walk forgets the house.** `EARLIER_CONTEXT = 30`, and a
new build outline read off a real chart of cost is 73 steps and well over a
hundred questions — so 2,400 square feet given at framing is gone by drywall.

His idea answers all three, which the obvious fix does not. A *Measure it*
button on every quantity question is fifteen interruptions instead of one
pass, and it does nothing about the forgetting, because **a measured number
recorded as an ANSWER falls out of the prompt exactly as a typed one does.**

### A measurement is a fact about the BUILDING

`job_measurements` hangs off the PROJECT, keyed by the reduced name, unique
per project. So re-measuring corrects one row; a second estimate on the same
job starts already measured; and there are only a handful of them, which is
what lets them go into **every turn's prompt** from the first phase to the
last. That is the entire return: the walk stops asking for numbers it was
given, and does arithmetic out loud from them.

**Rule 2 needed a companion.** *Gather, never price* forbids inventing a
quantity, and a model reading it strictly would hold the measurements and do
nothing with them. Rule 2a now says so: *"Arithmetic on a number you were
GIVEN is not pricing; inventing the number would be."*

### What to measure is the tenant's

`job_estimate_outline_measures` sits beside the steps and the questions,
seeded from the profile, edited from a panel on the outline page. The
starters say a remodel is measured differently from a new build — rooms
worked in and existing wall height, not a perimeter — and nothing in the pack
names a measurement.

**The test for the list is whether MORE THAN ONE phase reads the number.** A
perimeter is footing, foundation wall, backfill and siding. One that only one
phase needs is a question on that phase.

### The drawings, over the walk

*Measure it on a drawing* picks a sheet and puts the real `SheetViewer` in a
dialog behind ONE new optional prop. Not a cut-down copy: it is a thousand
lines of pdf.js, scale and geometry, and a second one is a second thing to
keep right — the mistake this pack already made with four hand-rolled copies
of one answer shape. Only traces of the kind being asked for are offered, and
several of them offer their total.

### The parser, and the three things it refuses

`2,400 sf`, `38'-6"`, `24 x 40`, `40 + 24 + 40 + 24`, `40x9 + 24x9`. Refusing
those would be correct and useless.

- **Two figures with no operator is not an answer** — `240 to 260` is asked
  again, X6's rule unchanged.
- **A minus sign is never arithmetic**, because `38-6` is feet and inches to
  the person typing it and would silently become 32.
- **One figure among unknown words is still that figure** — *"2,400 sf gross"*
  is 2,400. Two numbers among words is still unclear.

### The one that nearly got away, and only driving it found

The first cut put the measurements into the WALK's prompt and stopped there.
Driving it showed what that is worth: the conversation knew the numbers, and
the phase still came out

```
Framing labor — what are you getting for that?
```

a lump, over a building whose wall area was sitting right there. **The
proposal is where a quantity is set, and it had never been told.**
`proposeSystemPrompt` now carries the same lines, with a rule 2a beside the
existing *a quantity is quoted or explained*: the measurements COUNT as
numbers they gave, and the working goes in `derivedFrom`. Both call sites —
the automatic one and the *What does this come to?* button — were changed,
because changing one of two is a mistake this repo has made before.

The same phase, after:

```
Wall framing lumber, 1,216 sf — what are you getting per sf?
```

### Three traps paid for again

- **The composite `SET NULL` came out bare.** `db:generate` emitted
  `ON DELETE set null` on `(tenant_id, sheet_id)`, which can never fire — it
  would null `tenant_id` too. Rewritten to PG 15's column-list form and
  **proved in the isolation test by actually deleting a sheet**, not by
  reading the file.
- **A hand-written migration left a hole in the snapshot chain.** 0408 was
  written by hand, so drizzle-kit never wrote `0408_snapshot.json` — the only
  index in 409 without one. Written, and 0409's `prevId` repointed, then
  `db:generate` run to prove it produces no spurious diff.
- **A pass matched on a substring.** `PASS_WORDS` contains `na`, and
  `"internal 40"` contains `na`, so a measurement somebody was giving would
  have been recorded as *not on this job*. Both sides are reduced to words
  before comparing.

### Two things the type checker caught that reading would not have

- **`view: null` on every error branch collapsed the narrowing.** The screen
  does `if ("error" in result) { if (result.view) ... }`, and because each
  error branch typed `view` as literally `null`, TypeScript narrowed the
  whole result to `never`. The fix is the behaviour the wrong-answer bug
  already bought: **an error goes back with the real view**, read fresh.
- **A second return shape that merely LACKED `put`** collapsed `result.put`
  to `{}`. One `TurnOutcome` interface now, shared by the pricing door and the
  measuring door.

### Driven end to end, on dev

Three measurements added by hand to the New build outline, then a fresh walk
on EST-3:

```
Measuring the building · 3 to go
  Wall perimeter — how many lf? (Outside face, all the way round…)
    "40 + 24 + 40 + 24"   → 128 lf
  Wall height — how many lf? (Floor to plate on the main level.)
    "9 or 10"             → asked again: "— one figure, please."
    "9'-6\""               → 9.5 lf
  Roof area — how many sf?
    [Measure it on a drawing] → A-101 → Use this on the 59 sq ft area
                          → 59.026 sf, with the ruler mark
→ measuring closed itself and the walk opened Rough carpentry, step 1 of 10
```

The viewer offered *Use this* on the area and NOT on the length or the count
beside it, which is the kind guard doing its job.

Then a SECOND walk on the same job, to prove a measurement outlives the walk
that took it: it went **straight to the questions** — nothing left to measure —
and its first phase proposed, from the database:

```
Wall framing lumber | 1,216 sf @ $3.10 | said/derived
    perimeter 128 lf x wall height 9.5 = 1,216 sf
Roof framing lumber | 59.026 sf        | none/derived
    roof area per A-101 = 59.026 sf
Framing labor       | 1 ls             | none/none
```

The third line is a lump and is meant to be: no measurement gives it a
quantity, and the model saying so is the honest answer. The measurement it
did use keeps where it came from — *area on this sheet · A-101 · First floor
plan*.

Migrations 0407–0409, applied to dev and production; `db:verify-rls` green on
both at 242 tables.

### Not built, and worth knowing

- **An outline that already exists does not gain the starter list** (ADR
  0098's rule: a re-install never puts back what somebody deleted). Every
  tenant walking today adds their own on the outline page — which is what was
  done to drive this.
- **A walk already running never measures.** `startMeasuring` is called when
  a walk begins and nowhere else.
- **No formula engine.** Wall area as perimeter × height is arithmetic the
  walk can already do out loud from the prompt. `source` allows `derived` so
  it can start writing one without a migration.

### 2026-09-20 — The money is part of the conversation (`claude/the-money-in-the-conversation`, X6)

The founder, having walked a real bid: *"I'm still not seeing how the estimate
is built with pricing etc. Seems like I am just answering questions."*

He was right, and it was **three faults deep**:

1. **The walk was forbidden to touch money.** Its own rule 2 —
   `GATHER, NEVER PRICE` — written to stop it INVENTING a figure, and it also
   stopped it ASKING for one. Asking is the opposite of inventing.
2. **Pricing had nothing to read.** It resolves from a saved assembly, an
   awarded bid, what the business charged last time, or a figure somebody
   said. His tenant had **0 assemblies and 1 priced line in the whole
   system**, so every line came back `needs a price` at nothing.
3. **And it sat behind two buttons** he had to remember, twice a phase,
   thirty-three times. He had pressed them three times and applied none.

**A PHASE NOW ENDS IN MONEY.** Its questions settle, the lines are worked
out with no button, every price the pack cannot find is asked for one at a
time, and the item goes on the estimate before the walk moves on — and it
says what the phase came to, because money that lands silently may as well
not have.

**THE MODEL IS STILL NOWHERE NEAR A FIGURE.** It works out WHAT to price,
which is reading a transcript. The question is written from the line, the
answer is read by a parser, and it is written to the row whose id was on the
screen. `ai/propose.ts` still has no price field.

**ONE NUMBER, ONE MEANING.** The question names what it wants — *per lf* with
a quantity, the amount outright on a lump — because `$3,400` read as a rate
against 240 lf is **$816,000**. Two figures in one answer is not an answer
and gets asked again; averaging *"twelve, maybe fourteen"* would be the pack
inventing a price. A pass is a real answer and sticks (`price_passed_at`), so
the line shows unpriced in the reckoning rather than being asked forever.

### Two bugs driving it found, both about WHICH step

- **`currentStep` has already left the finished phase.** `proposeForStep`
  read the step off the walk, so a phase was priced against the questions of
  the phase AFTER it — proposed nothing, and the walk sailed straight past
  the money. The step is passed explicitly now.
- **`moveToStep`'s must-ask guard checked the derived step too**, so leaving
  a finished phase was refused because a LATER phase had an always-ask
  outstanding. `guardStepId` names the phase being left.

### And one about trusting the model

The first cut hung the pricing on `turn.stepDone`. Driving it showed **the
model simply does not say so reliably** — it answers and carries on. Coverage
is a fact this code can check, so it does: a phase is finished when
`currentStep` has moved off it, whatever the model claimed.

### Driven

On dev, end to end. `Who's doing the roofing?` → *In-house* → the phase
closes, the lines are worked out, and it asks:

```
Roofing labor — what are you getting for that?        7250
Roofing material — what are you getting for that?    11400
```

and the estimate gains an item:

```
ITEM "Roofing" — 2 lines
   Roofing labor      1 ls @ $7,250.00  = $7,250.00   [said]
   Roofing material   1 ls @ $11,400.00 = $11,400.00  [said]
                                  total  $18,650.00
→ walk moved on to: Plumbing
```

Migration 0406. **Not built yet: the takeoff from a question**, which he
asked for in the same breath — *"there are numerous times it asks for a sq
footage. I need the takeoff tool to get that a lot of the time."* Next slice.

### 2026-09-20 — A turn cannot fail into a wrong answer (`claude/a-turn-cannot-fail-wrong`)

The founder, with a screenshot: *"I keep having issues with it showing an
error. When it errors, it stays on the questions so you can answer it again,
but when you answer it, it actually answers the next question that you don't
see yet. There should be no errors period. If errors start happening people
get frustrated and stop using the tool."*

**Two faults, and the second is the dangerous one.**

### The error: the model was a single point of failure

`takeWalkTurn` called the API with no try/catch and no retry. Any transient
failure — overloaded, a dropped socket, a tool call that would not validate —
propagated. It now **never throws**: two attempts, then null.

And null is not an error either. **The outline carries the walk.** That was
always the design — *the outline is a floor, not a ceiling* (ADR 0098) — and
a walk that stopped dead because a model call timed out had quietly made the
model the floor instead. `outlineTurn` banks what was just said against the
question that was asked and asks the next one on the list, in the business's
own words. Deterministic, instant, no error.

What it loses, written down rather than glossed: the model's judgement. One
question, one answer, no gap-spotting, no reading three answers out of one
sentence. **A worse walk and a working one.**

### The wrong answer: a committed turn that then threw

`runTurn` takes a second turn when a step ends. Both that call and the
`getWalk` before it could throw — and a throw there escaped to the action's
catch, which answered `{ error }` with no view **after the first turn had
already committed**. The screen kept the old question; the walk was past it;
the next answer was attributed to a question nobody had seen.

Three changes, each of which alone would have prevented it:

- **The screen says what it is answering.** `answering` carries the question
  as the person read it. If it does not match the pending one, **nothing is
  recorded** and the current view goes back. Refusing costs one re-read;
  guessing costs a wrong answer in a bid.
- **An error never goes back without the current view**, so a stale screen
  cannot survive a failure.
- **Nothing after the first turn may undo it** — the continuation is wrapped,
  and a failure there returns the first turn's view.

### The bug the tests caught on the way

`outlineTurn` marked the pending question settled because it was PENDING, so
an empty answer would have **skipped a question out of the bid entirely** —
the same class of fault the whole slice exists to remove. Only what was
actually recorded counts now.

### Driven

An invalid API key: `takeWalkTurn` returns null in 847ms across two attempts
without throwing, and the outline banks `Who is producing the drawings? → We
are` and asks the next question.

Then the founder's own bug, reproduced: with `Who's handling the plumbing?`
on screen, the server's pending question was moved behind its back and the
button pressed. **Four answers on record before, four after** — nothing
written — the screen resynced to the real question, and the toast read *"That
had already moved on — here is where it is."* Before this, that click became
the answer to a question nobody had read.

No migration.

### 2026-09-20 — The price sheet (`claude/the-price-sheet`)

The document the founder actually hands clients, which he sent as a 195-row
PDF and which everything since has been groundwork for: **one running list,
numbered straight through, with the parts of the bid as rows of their own.**
A third format beside the letter and the brochure.

**IT ARRANGES; IT NEVER COMPUTES.** Every amount comes from `price.rows`,
which is the model's — the rule `proposal-sections.ts` has held since E5a,
because two things that both work out a total is how they come to disagree.
`ProposalRow` gained `groupId` so a format can group rows by item without
re-deriving a penny, and a test asserts the sheet's amounts are the model's
own list.

**A ROW AT `$0.00` IS PRINTED.** Roughly sixty of his 195 rows are zero on
purpose — *"By Owner"*, *"(N/A)"*, *"Supplied by Turkel"*, *"Included in
Plumbing Quote"* — and they are the document's exclusions, said where the
client reads them. Dropping an item because it costs nothing would throw away
the most careful part of the sheet. (The same realisation that corrected X4's
zero-line rule a few hours earlier.)

**THE NUMBER RUNS THROUGH THE HEADINGS TOO**, because the numbers exist so
somebody can say *"look at 102"* on the phone, and a scheme that skipped the
headings would not survive one section being added.

### The bug driving it found, which no test would have

An item with **no** section, on a sheet where others have one, printed
directly under the previous heading — `Loft framing` sat under `FINISHES`
having never been put there. **A client document saying something nobody
meant.** The file's own comment claimed unsectioned items came first; it
described an intention nobody had implemented. They are now headed `Other`,
the word the `codes` presentation already uses for money with no code, and
only when the sheet uses sections at all — an estimate with none is still the
plain numbered list it always was.

### Printing

`price_sheet` prints through its own HTML like the brochure, not through
react-pdf. **Every format with a layout of its own prints through its own
HTML**; writing each a second layout is how two documents that should be
identical stop being so. The price is the Chromium pack — a price sheet's
PDF answers 503 in production until `CHROMIUM_PACK_URL` is set, exactly as
the brochure's does, and the on-screen document works either way.

Migration 0405 widens the format CHECK. Driven on dev against a ten-item
estimate across three sections with four rows at zero: headings numbered in
line, qualifiers beside the names, `OTHER` over the two unsectioned items,
and the total matching the model.

### 2026-09-20 — An estimate item has a section, and says what the client sees of it (`claude/price-sheet-shape`)

The shape of the founder's own price sheet, which he sent as a 195-row PDF:
**sections over client items over the material and labour behind them.** Two
of the three levels already existed — an item IS the client-facing row and its
lines ARE what is behind it. This adds the third and makes the second sayable.

**A SECTION ON THE ITEM, AND IT IS NOT THE COST CODE'S CATEGORY.** Arrives
from the outline step that produced the item, editable afterwards, because his
own sheet is the disproof: `Siding Labor` is accounted under `04. Structural`
and printed under *Labour*, since Turkel supplied the material and labour is
what he sold. The code says where the money goes; the section says where the
row is read.

**ONE PRICE, OR WHAT IS IN IT — HIS WORDS, AND BOTH ALREADY WORKED.** *"There
are times I want something like a group from framing and then the material,
labor etc are in it. Then there are times where I want to show the client the
labor and material separate."* His sheet does both: `DRYWALL, INCL. LABOR` is
one row; `SIDING (Material only)` and `LABOR ON METAL SIDING` are two. The
tool could do both — **by hiding a line, which collapsed the item as a side
effect.** Nobody would ever have found that. `show_lines` is the same decision
said out loud.

**IT IS A REASON TO COLLAPSE, NEVER A REASON TO EXPAND.** A typed price and a
hidden line still close an item whatever the switch says, because those are
the two cases where the build-up would print rows that do not add up to the
price above them (ADR 0080, unchanged). Default TRUE, so nothing already
printed moves. The chip greys out and says which of the two is holding it.

### Three places a column like this gets lost, and all three bit

- **`applyProposal` rebuilds every existing item** to post the whole form. A
  column missing from that map is a column reset to its default on every walk
  apply. Caught by reading, not by a test.
- **Zod strips what it does not declare.** The editor posted `section` and
  `show_lines` correctly and `estimateGroupSchema` dropped them both on the
  floor. Found by saving in the browser and reading the row back: the toast
  said *Estimate saved* and the columns were still at their defaults.
- **`proposal.ts` builds its own group figures**, so without the switch there
  the chip would have set on the estimate and done nothing on the document the
  client actually reads.

A proposed line also now records `step_section` beside `step_title`, for the
reason `step_title` exists: re-sectioning an outline next month must not
silently re-section a bid that already went out.

Migrations 0403 (the item) and 0404 (the proposed line). Driven on dev: set a
section, flipped the chip, saved, read the row back — `section="04.
Structural"`, `show_lines=false`.

**Not built: the printed sheet itself** — headings, running numbers, and the
`$0.00` rows with their reasons. That is the next slice and this is what it
reads.

### 2026-09-20 — Bringing one outline's questions onto another's steps (`claude/bring-questions-across`)

Reading an outline off a chart gives the right steps, codes and sections and
**one question on each**. The questions are the whole value of a walk, and the
pilot now has both halves in different places: 33 hand-edited steps carrying
111 questions, and a 73-step outline carrying 73. He picked copying them
across over re-coding by hand.

**THE MATCHER WAS TUNED AGAINST HIS OWN PAIR, NOT INVENTED.** First cut scored
any shared word and produced confident nonsense — *Utilities and septic* →
*Windows and Doors (Including Hardware)*, because `and` is three letters and a
long title shares a word with everything. Three fixes, each measured:

- **stop words dropped**, so a long title stops being a magnet;
- **a shared-word match must cover most of the shorter title**;
- **among containments, the closest in length wins** — the difference between
  `Electrical` → `Electric` and `Electrical` → `Electrical Fixtures Material`,
  which is a phase versus a line item inside one.

Plus crude stemming, which is what reaches `Landscaping` → `Landscape` and
`Gutters` → `Downspout/Footer/Gutter`. **25 of his 33 matched** and the
remaining 8 propose nothing rather than something wrong (`Heating and cooling`
and `HVAC` share nothing a computer can see).

**IT PROPOSES; A PERSON DECIDES.** Several of the 25 were NEARLY right —
`Decks and porches` landed on `Porch` when `Deck` was also there — so the
screen is one row per step with the match pre-chosen, a dropdown of every
target step under its section, and a leave-alone. Nothing copies itself.

**NOTHING IS REPLACED, AND THE SOURCE IS NOT TOUCHED.** Questions are appended
after what a step already asks; a prompt it already carries is skipped, so a
second run is a no-op. Everything comes across — kind, choices, unit, notes,
`always_ask`.

### The bug the database test caught, which the comment denied

`copyQuestionsBetweenOutlines` rebuilt its list of already-asked prompts
**inside** the pair loop, so two source steps pointing at one destination —
his `Framing labour` and `Framing materials` both land on `Framing` — each
imported what the other had just added. The comment above it claimed the
opposite in as many words. Held across the whole run now, and there is a test
named for the case. Nothing in `tsc`, lint or the pure suite could have seen
it: it needed two pairs and one destination against a real database.

No migration. Driven on dev end to end: the review screen with its reasons,
a run that copied nothing because every prompt was already there (`3 already
there`), then a real one — `2 questions onto 1 step, 3 already there`, with
`Is rock expected?` arriving on `Excavation` with its always-ask intact,
after the step's own question, and the source outline unchanged.

### 2026-09-20 — An outline is read off the chart as WORK, not as codes (`claude/outline-from-chart`)

Loading the pilot's real chart made its default list 291 codes, and that
**orphaned both of its outlines in one move**: 0 of 50 coded steps matched the
new default, so a walk would have produced uncoded lines. The fix is not
re-typing codes. It is that **his codes are finer than an outline step** —
`Site work and excavation` is one step, `Excavation` is eight codes — which is
the same three-level shape the price sheet has, showing up in a third place.

**ONE STEP PER CODE WAS RIGHT UNTIL A REAL CHART TURNED UP.** It gave a fine
outline off a 38-code starter list. 291 codes gives a 291-step interview,
which is not an interview. `outlineFromCostCodes` now folds a chart into WORK
ITEMS: his comes out at **73 steps**, which is a job somebody can walk.

**GROUPED BY WHAT THE NAMES SHARE, NOT BY WORDS THE CODE KNOWS.** Nothing in
`workItemsFrom` knows what *Labor* or *Material* mean and it must not — those
are one business's suffixes, and the next splits by crew or by phase of
install. Adjacent codes group while their names keep sharing a leading prefix,
never across a category, and the prefix is the step's title.

**A GROUP'S PREFIX IS SET BY ITS FIRST TWO MEMBERS AND MAY NOT SHRINK.**
Without that rule `Interior Trim Labor` and `Interior Paint Labor` collapse
into one step called `Interior`, which is not a thing anybody builds. The rule
costs the odd over-split — `Masonry crew` and `Masonry scaffolding` stay two —
and that is the deliberate direction to err in: **splitting one work item
costs a click; merging two costs an estimator a phase of questions nobody
asked.** There is a test named for it.

**A SECTION IS NOT THE CODE'S CATEGORY.** New column on the step, arriving
from the chart's grouping and editable afterwards, because the two genuinely
differ: the pilot's `Siding Labor` is accounted under `04. Structural` and
printed under *Labour* on the sheet he hands a client. The code says where the
money goes; the section says where the row is read. This is also the column
the price sheet's headings will come from.

The step takes the FIRST of its work item's codes, as a starting point rather
than an answer — a step spanning eight has no single one, and the lines a walk
produces carry their own.

### Driven

His chart on production: 291 codes → **73 steps** across his seven sections
(Design 4, Preconstruction 1, Infrastructure 13, Structural 14, Mechanical 13,
Finishes 22, General Conditions 6), written as a third outline called *From
your cost codes*. **Not made the default** — the two already there are
hand-edited and this one arrives raw, one question per step. Which to walk is
his call.

### 2026-09-20 — A chart of cost comes in from a spreadsheet (`claude/cost-code-import`)

The founder sent the pilot's real chart: **291 codes, seven parents, 75 work
items** — `03. Infrastructure` over `03.20 Excavation Labor`, with Labor,
Material, Mileage and Subcontractor under 48 of the 75. Cost codes were
created one at a time and the table was flat, so there was no way to get it
in and nowhere for the grouping to live. **Nothing else about the price sheet
is real until that is fixed**, so this is first.

**A CATEGORY IS A LABEL, NOT A ROW, AND THAT IS THE FOUNDER'S RULE MADE
STRUCTURAL.** His words: *"the sub cost codes need cost tracked to them, not
just the parent."* A `category` text column means there is simply no
`03. Infrastructure` in the database to budget against, commit against or
code an invoice to — the constraint cannot be forgotten because there is
nothing to forget. Compare `accounts.parent_id`, which IS a row, because a
chart of accounts really does roll up through real accounts. A chart of cost
does not.

**DETERMINISTIC, NOT A MODEL.** The platform has an AI paste extractor for
the messy case; a chart of cost is the wrong place for it. A model that
misreads `03.100` as `03.10` produces a chart that looks right and posts
money to the wrong phase for a year. Parsing can fail loudly; a model fails
plausibly.

**THE FIRST MATCH IS THE WRONG CODE**, and the tests caught it before the
founder did. His parent column reads `03. Infrastructure`, which is ITSELF
code-shaped, so a left-to-right scan took `03` off every row and called all
291 duplicates of each other. **The leaf wins, and a leaf's code is longer
than its parent's** — true of his numbering and of CSI, because a child
extends its parent.

**251 OF HIS 291 CODES SORT WRONG AS TEXT.** `03.100` is less than `03.20` to
a computer. `listCostCodes` orders by `sort_order` first, so carrying the
paste's row order across is the only thing holding his chart in the shape he
wrote it in. There is a test on exactly that sequence.

**ONE STATEMENT, NOT 291.** Each code is two writes — the code, and the cost
object Accounting charges against it. A row at a time is ~600 round trips
inside one transaction, which on Neon is a timeout rather than a wait. Both
halves are a single upsert; `upsertDimensionMembers` is the new bulk twin of
the singular, added beside it in `accounting/core/dimensions.ts`.

**NOTHING IS DELETED AND NOTHING IS SWITCHED OFF.** A code the paste does not
mention may have a year of costs posted against it. `is_active` and `notes`
are untouched by a re-import, so a retired code stays retired and a note
survives. The preview says how many rows that is.

### Driven

The founder's actual workbook, all 291 rows, through the real write path on
dev: **679ms**, order identical to the paste including the `03.95 → 03.100`
rollover, 7 categories, 291 cost objects, `Service` dropped as a uniform
column. Re-importing the same list read `0 added, 0 changed, 291 unchanged`.
A one-row partial paste added one, touched nothing and did not re-order.
Then in the browser: the preview named both bad lines by number (`no code and
name on this line`, `the same code as line 10`), the import toast read
`9 added, 0 changed, 2 skipped`, and the page drew the codes under their
category headings in the pasted order.
### 2026-09-20 — A zero with a reason is a decision (`claude/zero-with-a-reason`, [ADR 0099](../decisions/0099-a-walk-is-finished-when-nothing-is-outstanding-not-when-the-questions-run-out.md))

X4 shipped a rule that a line at zero is not a price. **The founder's own
price sheet is the counter-example**, and he sent it the day after: a 195-row
new-home worksheet in which roughly SIXTY rows are `$0.00` on purpose —
*"Supplied by Turkel"*, *"By Owner"*, *"(N/A)"*, *"Not Included"*, *"Included
in Plumbing Quote"*. Those rows are the document's exclusions, stated in place
where the client reads them, and they are some of the most useful lines on it.
X4 would have flagged every one as a hole.

`basis` is the distinction and X2b had already written it down: **`none` means
a walk produced the line and could not price it; BLANK means nobody recorded a
basis**, which is every line a person has ever typed. So `zeroLines` now counts
only a walk's own unpriceable line. Price something at nothing yourself and
that is your call, which it always was.

**The lesson is the one this layer keeps teaching**: a rule derived from one
walk's data met a real document and was too broad. The rule was right — an
unexplained zero really is a hole — and its REACH was wrong.

### 2026-09-20 — X4: the whole bid, and the way back into it (`claude/walk-reckoning`, [ADR 0099](../decisions/0099-a-walk-is-finished-when-nothing-is-outstanding-not-when-the-questions-run-out.md))

Four slices in and the pieces did not touch each other. The founder's verdict
after using it: *"We are heading in the right direction, but we have a ways to
go to actually make this right and useful."* Five things were wrong and they
had one root — **the forty-five minutes does not live inside any one piece, it
lives in the joins.** This is the first two of them.

**THE WALK COULD NOT TELL YOU WHETHER IT WAS FINISHED.** It said *"That is the
whole walk"* and pushed straight back to the estimate, over a bid with phases
answered and never priced, subcontractors who had not replied and allowances
nobody filled in. The one moment somebody most needs to see what is missing
was the moment the screen went away. Now there is a **reckoning**: every step
in one of six standings — priced, out for bid, by others, open, unpriced,
asks nothing — derived from the answers, the lines that reached the estimate
and the bids that went out. Holes first, then what is merely waiting, because
which of the two a phase is in decides whose move it is.

**MONEY OUT FOR BID IS NOT IN THE TOTAL.** Not the lowest, not the average,
not a placeholder. It is the plausible wrong number this program exists to
refuse, at the worst possible place to put one.

**A LINE AT ZERO IS NOT A PRICE**, and this rule nearly did not get written.
X2b puts a line on at nothing when it worked out WHAT to price and could not
work out the cost. The first draft counted those phases as priced; driving it
against the dev tenant's own first walk showed `Cast-in-place concrete` green
with three `basis: none` zero lines under it. **Green on the rail, nothing in
the total, and a bid short by whatever the concrete cost.** A phase is priced
only while its lines carry money.

**THE RECKONING FOLLOWS THE ESTIMATE, NOT THE PROPOSAL.** It reads through
`estimate_line_id` to the real line, so a price typed over a generated one is
the one that counts — which is what the founder asked for at X1 — and deleting
the lines re-opens the hole by itself.

**YOU COULD NOT GO BACK**, and the starter outline's own masonry step says to:
*"a no here is worth going back to the foundation step for."* `moveToStep` was
only ever called with the step after this one. The rail now shows every step
at once, coloured by standing, and clicking one opens it: what was asked, what
was said, **Work on this**, and **Ask again** on any answer.

**ASKING AGAIN SUPERSEDES; IT DOES NOT DELETE.** One nullable `superseded_at`.
A superseded row stops counting, which re-opens its step, which is what
`currentStep` already follows — so there is no "a person is revisiting" mode
anywhere in the code, and the transcript still says what was asked and what
was answered at the time. The must-ask guard gained a `byPerson` flag on the
same principle `recordAnswers` already states: *a person is not the thing
being guarded against*.

**A MISREADING CAN ONLY MAKE IT MORE CAUTIOUS.** Two standings are read from
the words of an answer — the starter outlines' own `Bidding it out` and `By
others`. Reword those choices and the classification is lost; what comes back
is `unpriced`, which blocks. Never the other way round, and it was built that
way round on purpose.

### Speed, which was a founder complaint once already

A reckoning is five indexed reads and **it is not part of a turn**. The screen
fires it after the view has landed and never waits for it; the panel catches
up a beat later. `goToStep` and `askAgain` waive the cooldown because one
click is not a conversation.

### Driven

Against the dev branch's own walk on EST-2: the reckoning read `1 priced, 1
unpriced` and the priced one was the three-zero-line phase — which is how the
rule above got written. After the fix: `Cast-in-place concrete — 3 lines on
the estimate, no prices`. Then **Ask again** on *"Who is doing this one?"*
flipped `Rough carpentry` from `unpriced` to `open — 1 still to ask, 1 of them
always`, moved the walk onto it, cleared the pending question, and left both
rows in the transcript with exactly one standing. Rolled back.

### 2026-09-20 — X3: asking subcontractors for a number (`claude/bid-requests`, ADR 0098)

The thing the walk kept pointing at. Answer *"bidding it out"* on a phase and
something has to actually go out, and **nothing in the pack did** — a
`job_commitment` is the subcontract AFTER you have bought the work, and there
was no row for the asking.

**IT IS A LINK, NOT AN EMAIL, AND THAT IS A DECISION ABOUT HONESTY.** The
obvious build emails a bid request, and this platform cannot do that yet: SES
production access is still denied, so outbound reaches only verified
addresses. A send button would have looked like it worked and reached nobody.
So an invitation is a **tokenised link** — the shape the proposal's client
link already proved (E5c, ADR 0085) — and the builder sends it however they
already talk to that sub. Email becomes one more way to hand over the same
link whenever the relay is free, and nothing has to be rebuilt for it.

**A TOKEN EACH, NOT ONE PER PACKAGE.** One shared link would make *"who has
looked at this"* unanswerable and *"stop that one"* impossible, and a
forwarded link would be indistinguishable from the sub you sent it to.

**A REPLY OUTLIVES THE DOOR.** `bidStanding` puts what somebody SAID ahead of
what happened to their link: a number given and then a link revoked is still
a number they gave, and a page reading "revoked" over a real bid would lose
the only fact that matters. Revoking takes back access, not testimony. The
door also stays open after a reply so a sub can check what they sent —
`invitationAcceptsReply` is the separate question of whether they may send
another, and they may not.

**THE SPREAD IS THE POINT, NOT THE AVERAGE.** Three prices within a few per
cent means the scope is understood and any of them is safe; one at half the
others means somebody has read it differently, and that is worth knowing
before it is the cheapest bid on an estimate. `summarizePackage` gives both
ends and never a mean.

**AND AN AWARDED BID BEATS EVERY OTHER BASIS** in a walk (X2b). It is this
job, this scope, and a number a subcontractor put their name to. Matched on
the phase's cost code; **no award means no number, never the lowest bid**,
because which one a business is going with is their decision and not an
arithmetic. A phase with an award proposes ONE lump line for the
subcontract — a breakdown of somebody else's work would be this business
guessing at it.

### Two things the database refuses

**You cannot award a number nobody gave.** `job_bid_invitations_award_has_a_number`
— awarding a silence or a no-bid would put a price on an estimate with
nothing behind it, which is the one thing this whole program exists to
refuse. **And a reply is a whole fact or none of one**: a number with no date
cannot be placed, and a date with neither a number nor a decline says only
that something happened.

`recordBidReply` writes only where nothing has been said yet, so a double
submit, a back button or a change of mind cannot quietly replace a number the
builder may already have awarded. They ring up instead, which is what they
would do anyway.

### The second-most-dangerous function in the pack

`bid-share.ts`, in its own file so it can be read in one sitting, and a
deliberate copy of `proposal-share.ts`: **`withSystem` does the token → tenant
hop and nothing else**, every read after it runs `withTenant` at role staff,
and every failure — unknown, revoked, expired, closed, pack off, tenant gone
— answers identically. A subcontractor sees the scope, the due date and where
the job is. **Never the estimate, never the other bidders, never what anybody
else said**: a bid request that leaked the competition would be worse than no
bid request.

Behind the interview's gate for now. Bid requests are independently useful
and will probably be un-gated once the pilot has earned it, but shipping them
open would put a new public surface in front of every tenant on the strength
of one business's feedback.

### Driven end to end

A package for *Electrical* with a real scope, one subcontractor invited, the
link opened as a stranger with no session, `$18,400.00` typed in and sent,
the page then refusing a second and showing what was sent, and the builder's
screen going from `1 asked · 0 priced · 1 silent` to `1 priced` and then
`Going with this`. **Not driven: a walk picking the award up** — it needs a
step whose cost code matches, and the dev tenant's outline has different
codes.

### 2026-09-20 — X2b: answers become lines, and every one says where its number came from (`claude/walk-lines`, ADR 0098)

The half that touches money. A step's answers become an ITEM on the estimate
with its lines inside (ADR 0079), and the whole slice is built around one
sentence the pack already had, in its assembly tests: **a plausible wrong
number in an estimate is worse than a refusal, because it goes out in a
proposal.**

**THE MODEL NEVER EMITS MONEY, AND THE TOOL CANNOT SAY IT.** Look at
`PROPOSE_TOOL`: there is no field for a price. Not `unitCost`, not `total`.
The nearest thing is `saidUnitCostCents`, which means *"they told me this
figure"* — and is checked against the transcript before it is believed. The
safety argument is a schema rather than a paragraph in a prompt, because a
prompt is a request and a schema is not.

The money goes on afterwards, in `walk-lines-ops.ts` and nowhere else, from
one of four places a builder can point at:

| Basis | Where the number came from |
| --- | --- |
| `assembly` | one of their saved items, exploded at the size asked for |
| `memory` | what they charged for that line last time, with how long ago (E4a) |
| `said` | a figure the estimator gave, found in the transcript |
| `none` | nothing yet, and the line says so on its face |

**A QUANTITY IS QUOTED OR EXPLAINED**, and that is the founder's call. The
first version refused any figure that was not verbatim in what somebody
said, which also refused arithmetic anybody would want: *"two baths, three
fixtures each"* would not put 6 on a line. His instruction was *"let it
derive quantities and show the arithmetic"*, and he is right about why —
**what makes a derived number safe is not that a model did not do the sum,
it is that the sum is on the screen.** So a derived figure carries its
working, the working is shown on the line, and the table refuses a row that
claims `derived` with nothing to show. A figure with neither a quotation nor
working still falls back to a lump of one.

**APPLYING GOES THROUGH `updateEstimate`**, the same whole-form save the
editor posts (ADR 0082) — not a private insert. So a walk cannot produce an
estimate the editor cannot show or the proposal cannot print, and turning the
layer off leaves ordinary rows behind. Each proposal remembers the line it
became, the shape a takeoff already uses for a measurement it pushed
(ADR 0074).

`basis` on `job_estimate_lines` defaults to BLANK, which is not `none`.
Blank means nobody recorded where a number came from and is what every line
ever typed carries; `none` means a walk produced the line and could not price
it, which is worth seeing. `EstimateLineInput.basis` is optional in two
senses — **omitting it leaves what is there** — because the editor's autosave
posts every line on every keystroke and knows nothing about a basis, and a
save that blanked an absent field would strip the provenance off a walked
estimate the first time somebody fixed a typo.

### What it actually did, driven

On a barn conversion whose tenant has no assemblies and no price history for
concrete, and where the estimator gave no figures, it proposed *Footing
concrete*, *Slab on grade* and *Concrete labor, place & finish* — three lines
an estimator would recognise — each marked **needs a price** at zero, and put
them on the estimate as one item. That is the feature working, not failing:
it knew the shape of the phase and refused to invent the money. The same walk
against a business with a filled-in assembly library and a year of priced
lines is where the numbers come from.

One trap re-trodden on the way: a backtick inside a template literal, in the
proposal prompt this time, which ends the literal mid-file exactly as it did
in `proposal-html.ts`'s stylesheet.

### 2026-09-19 — Four things the founder hit in the first hour of walking a real bid (`claude/walk-faster`)

He used it, and every one of these came back within the hour. Three were
defects and one was content.

**1. "THERE KEEPS BEING AN ERROR IN LOADING."** The turn asked for ADAPTIVE
thinking inside a 4,000-token budget, and `src/lib/claude.ts` warns in so many
words what that does: **`max_tokens` caps thinking AND the response together,
so a tight budget truncates mid-tool-call.** A truncated call carries no
complete `tool_use` block, the turn comes back null, and the screen says *"It
could not answer just then."* The warning was already in the file when this
was written; the fix is thinking off and a budget sized for the tool.

**2. "OVERALL IT SEEMS SLOW."** Measured at **6.8 seconds** a turn, and it was
four things, not one:

- Adaptive thinking on the considered model. `CLAUDE_FAST_MODEL` is new for
  exactly this: what a conversational turn decides — what to ask, what an
  answer settled, what it made moot — is shallow, and the deep reasoning in
  this feature is the sweep over a finished bid, which nobody waits on.
- `revalidatePath(..., "layout")` on every exchange, which re-rendered the
  **estimate page** — the heaviest loader in the pack, the price book at up to
  six hundred rows, the assembly library, the client links. X2a writes no
  lines, so nothing there had changed.
- `router.refresh()` alongside it, buying nothing, because the turn returns
  the whole view.
- Three full `getWalk` calls per turn — the outline, its questions and every
  answer, five queries each — plus a whole extra transaction to re-read one
  config flag the turn already fetches.

Down to **about 2.5 seconds a model call**. The rest is the model, and the
honest way past that is streaming the reply, which is its own slice.

**AND THE ANSWER NOW LANDS BEFORE THE MODEL DOES.** A turn costs a couple of
seconds whatever is trimmed, and the whole panel used to grey out with nothing
moving. What you just said is echoed into *What you have said* at once, and
only the next question waits.

**3. "ONE QUESTION HAS ALL OF THE ANSWERS GREYED OUT THAT I CAN'T PUSH."** An
action that REJECTS rather than returning `{ error }` left the transition
unsettled, so `pending` stayed true and every control on the screen stayed
disabled with no way out but a reload. Every call is wrapped now, and a failed
turn draws **Try that again** rather than a toast somebody has to catch —
`Nothing you have said is lost`, because it is not.

While driving the fix, the same screenshot showed a second bug: it had asked
*"Block or poured wall?"* — the outline's own words, verbatim — without
tagging `askingQuestionId`. So the buttons were three inventions instead of
the question's four options, `Come back to this` vanished, and the answer
would have been filed as volunteered with the real question still outstanding
for it to ask again. The words are now matched back to the question when the
id is missing, on an exact normalised hit only: **a near miss is left alone,
because mislabelling an answer is worse than a missing chip.**

**4. "WE WOULD NEVER BID OUT PERMITS."** Content, not code — the starter
opened every phase with *In-house / Bidding it out / By others*, including
permits and drawings. A button that is never a real answer teaches somebody
the buttons are decoration. Permits now asks who PULLS it and drawings who is
PRODUCING them, and a test fails if either is ever offered *Bidding it out*
again.

### 2026-09-19 — Granted, and nothing to walk (`claude/walk-no-outline`)

**The founder turned the walk on for his own tenant on production, opened an
estimate, and saw nothing at all.** Everything was working: the grant was set,
the code was deployed, the outlines screen was there. He had no OUTLINE, and
`WalkStart` returned `null` when the list was empty.

That is not an edge case, it is the FIRST state every business is in — a
tenant gets the grant before it has ever written an outline, and a profile's
starters only land on an install or when the module is switched on, so a
tenant that had `jobs` already has none. The panel now says so and links to
the screen that fixes it.

Worth writing down because the bug was a *decision to be silent*: the
component had all three facts it needed (granted, no outlines, here is where
they live) and chose to render nothing. Every `return null` in a gated feature
is a place somebody can be left looking at a blank space with no idea why.

### 2026-09-19 — The walk, X2a: an estimate priced by answering questions (`claude/estimate-walk`, ADR 0098)

The founder's ask, in his words: instead of typing the lines you walk the
house with the software and answer questions, and the estimate fills in behind
the conversation. **This slice is the conversation.** No lines come out of it
yet — X2b turns answers into groups and lines — and doing it in that order was
deliberate: the conversation is where the design can be wrong, and this way it
was wrong before anything touched money.

**Two tables.** `job_estimate_interviews` (one running per estimate, by a
partial unique index) and `job_estimate_interview_answers` (one row per thing
asked, with what came back). The walk hangs off an ESTIMATE, not a job: you
make one the way you always did and then walk it, so the estimate is ordinary
before, during and after, and a walk abandoned halfway leaves a perfectly good
draft behind.

**THE OUTLINE IS READ LIVE, and this reverses what the X1 write-up promised.**
That said the walk would snapshot the outline so editing a template could not
change a bid in flight. The founder's own case is why it is wrong: realise
mid-bid that the outline never asked about the sump, and you want the question
in the walk you are in. So it reads the outline as it stands, and the
truthfulness a snapshot would have bought is bought better — **an answer stores
the words it was asked in**, so rewording or deleting a question later cannot
rewrite the transcript.

`step_id` and `question_id` carry no foreign key, which is a deliberate
exception to this pack's habit. A transcript is a RECORD — the shape of a lien
waiver, a back-charge and an acceptance — and an answer that vanished because
somebody tidied the outline would be a record that lies.

**THE HOUSE PATTERN, in three acts.** Gather and claim the cooldown in one
transaction, call the model with NO transaction open, persist in another. A
walk is forty-five minutes of model calls and holding a transaction across one
is how a pool dies.

**MUST-ASK IS GUARDED TWICE**, and neither guard is the prompt. `validateWalkTurn`
drops a skip of a question marked always-ask, and `recordAnswers` refuses to
write one. A rule that lives only in a prompt is a rule a model can be talked
out of. A PERSON may still skip one: the mark guards against judgement, not
against a decision made with eyes open.

### Three things found by driving it, all the same mistake

The outline is a FLOOR. Three separate places treated it as a ceiling, and
every one of them was only visible by walking a real estimate.

**1. It marked a step done and asked about the step it had just left.** Told to
move on, the model set `stepDone` AND asked a follow-up in the same breath;
both were honoured, so the screen read *"Cast-in-place concrete, step 2 of 2"*
over a question about the framing. **A step you are still asking about is not
done** — resolved in favour of the QUESTION, because on a barn conversion
*"how much of the existing frame are you keeping?"* was the best thing it did
and no outline could have held it. A question mark is the tell, and
`askingQuestionId` is the other.

**2. Coverage closed the walk mid-sentence.** `currentStep` goes null the
moment every outline question is settled, and the first draft closed the walk
right there — header reading `Finished` with *"what's the cast-in-place work
on this one, slab, footings, piers or all of it?"* still on the screen. A walk
now ends when it says it is done and is not asking, not when the checklist
runs out; while running it rides out its last step.

**3. The fallback lived in two places and they disagreed.** The turn used the
last step and `walkView` did not, so the header said `Finished` over a live
question. One fallback, in `loadWalk`, so the screen, the turn and the
progress cannot drift.

Also corrected while driving: the screen fired its opening turn from an effect,
which is both an eslint error here (cascading renders) and a blank panel for as
long as the model takes. **The server takes the opening turn** when the walk
starts, so it arrives already asking.

### What it does that the outline could not

Driven on a barn conversion whose outline had ONE question per step, it asked
*"how much of the existing frame are you keeping — posts and beams staying, or
is this new framing throughout?"* and then *"are the footings new perimeter
footings, or pads under posts inside the barn?"* Neither is in any outline and
both are the right question. The screen counts them separately — `it thought
of` — because that count is what will tell a builder which questions to add.

### What is NOT built

The lines. X2b takes these answers and proposes groups and lines, each with a
basis you can see, applied per phase through the same `updateEstimate` the
editor uses. Then bid requests, quantities from a Revit schedule, and a takeoff
opened inline from a question.

### 2026-09-19 — Two things the founder pushed back on: a question the walk may never skip, and a cost code the editor checks (`claude/outline-always-ask`)

Both came straight out of reading X1 back to him, and both are worth the
entry for the reasoning as much as the code.

**"THERE IS NO WAY I AM EVER GOING TO HAVE ALL OF THE QUESTIONS 100% PERFECT."**
He was right, and the X1 write-up was misleading: *nothing branches* is a
statement about the SCHEMA — no condition column, no rule language a builder
has to maintain — and it was written as though it forbade the interview from
asking anything the outline does not contain. It does not, and it never did.
Three separate things had been flattened into one sentence:

| | Who decides | Allowed |
| --- | --- | --- |
| **Skip** an outline question the answers made moot | the model | yes, with the reason recorded |
| **Add** a question the outline never had | the model | **yes — this is the point of a model being there** |
| Encode if/then rules **in the outline data** | the builder, forever | no |

**The outline is a FLOOR, not a ceiling.** It guarantees coverage; the walk
goes past it whenever an answer opens a door.

**WHAT HIS QUESTION ACTUALLY EARNED: `always_ask`.** If the model may skip,
some questions must survive its judgement — *"is there any asbestos?"* on a
pre-war remodel must not be quietly judged moot. One boolean on a question, not
a rule language, and it is the counterweight that makes free skipping safe. It
means always ASKED, never always ANSWERED: a hard block would trap somebody who
does not know yet, so an unanswered one is named before the bid goes out
instead, which is where it is useful. Off by default, because most questions
SHOULD be skippable — a walk that asks about rebar after you said block is one
people learn to click through. The starters mark twelve of about 150, and
`tests/jobs-outline.test.ts` fails if that ratio ever passes a quarter, because
a mark on everything is a mark on nothing.

**"I'M NOT SURE I 100% UNDERSTAND COST CODES BEING TEXT."** The answer is that
the real code IS used — the estimate line gets a real `cost_code_id` on a real
row — and text is what makes that possible: a code's id belongs to ONE list, a
job picks which list it is on, so an outline storing ids would be welded to one
list and come out uncoded on every job using the other.

**The gap his question exposed** is that the editor took a code into a free-text
box and said nothing back. Now it checks against every list the business keeps,
as you type: the code's name when all of them have it, `not in CSI divisions`
when only some do (the useful sentence — that job would come out uncoded and
nothing else would say so), and a warning plus a count at the top of the outline
when no list has it. A typo used to be invisible until a bid came out with a
hole in its budget.

**IT HAD TO AGREE WITH THE WALK.** `codeStanding` imports `normalizedCode` from
`assembly-math` rather than writing a second normalizer, and a test drives both
through the same spellings — two normalizers would mean a code the editor calls
good and the interview cannot find, which is the exact failure the check exists
to prevent.

**One trap re-trodden, and it is documented in `globals.css` as having been
trodden before.** The warning text was written `text-warning`, which is the
FILL token: at oklch(0.75) it measures **2.18:1** on the page and fails even
the 3:1 bar for an icon. `text-warning-foreground` is the readable one, and the
comment beside the token says several icons were "modernised" onto the fill and
got worse before anybody measured. Both new strings are on the foreground.

Migration `0391_even_vargas.sql`, one column with a default, so every question
that exists keeps the behaviour it has. No new ADR: neither change reverses
[ADR 0098](../decisions/0098-an-estimate-outline-is-the-tenants-and-a-question-is-a-row-so-an-answer-can-point-at-one.md)
— `always_ask` is the opposite of a condition, it removes the model's
discretion rather than encoding an if/then, and the cost-code check is that
ADR's own rule made visible.

### 2026-09-19 — The estimate interview, X1: the outline is the tenant's, and a question is a row (`claude/estimate-outlines`, ADR 0098)

**What the founder asked for**, in his words: a layer over estimating where
instead of typing lines you walk the house with the software and answer
questions — *"Let's start with the foundation. Are you doing this in-house or
bidding? Block or poured? Looks like the footer is 24 inches, is that right?
Any rebar?"* — and the estimate fills in behind the conversation. Target: **a
bid in forty-five minutes**. Constraints, also his: it is a layer that can be
turned off, it starts with one client, and it must be able to reach everybody.

**This slice is the one with no model in it.** The conversation reads a script;
this is the script, and it is data a person edits. Nothing here calls Claude.

**WHAT ALREADY EXISTED, which is most of the machinery.** The takeoff pushes a
measured quantity onto a line (ADR 0074), assemblies drop a saved item at
another size (ADR 0086), price memory fills a cost from what this business
charged last time (E4a), and `updateEstimate` writes a whole estimate in one
call (ADR 0082). The interview will need no new write path: it produces
`EstimateGroupInput[]` and `EstimateLineInput[]`, the same types the editor
saves, which is what makes it a layer rather than a second estimating tool.

**Three tables.** `job_estimate_outlines` (several per tenant, one default by
a partial unique index, the cost code set's shape because it is the same kind
of thing), `job_estimate_outline_steps` (a phase, in order, with a cost code as
TEXT and prose guidance), `job_estimate_outline_questions` (the prompt, its
kind, a choice's options in jsonb, a number's unit, notes for the interviewer).

**Four decisions, all in [ADR 0098](../decisions/0098-an-estimate-outline-is-the-tenants-and-a-question-is-a-row-so-an-answer-can-point-at-one.md):**

- **The outline is the tenant's data, never a script in the pack.** A remodel
  is not a new build, so one business needs several; and the pack must carry no
  business's sizes or prices. The construction profile seeds a **New build**
  (33 steps) and a **Remodel** (23 steps) whose questions ask and never answer.
  `tests/jobs-outline.test.ts` scans the starters' words for a digit and fails
  on one — *"How wide is the footing?"* ships, *"24 inches"* does not.
- **A cost code is TEXT, not an id** — `resolveCostCode`'s call for assemblies,
  because a code's id belongs to one set and an outline is walked on every job.
- **A question is a ROW, not a string in a jsonb array.** An answer recorded
  against a question ID is what lets an interview resume exactly and lets a
  finish gate say *"you answered this and no line came of it"*. The editor's
  save therefore keeps a row's id, ADR 0082's rule, or a typo fix would orphan
  a transcript with nothing failing.
- **Nothing branches.** No condition column, ever. **Coverage is the outline's
  job and judgement is the interview's** — *"any rebar?"* is skipped when the
  answer was block, and the skip is recorded with its reason. A question's
  notes carry *"only when they are pouring"* as prose.

**THE GATE IS TWO FLAGS, and that is not one too many.**
`estimateInterviewGranted` is ours (superadmin, on the console's tenant page);
`estimateInterviewOff` is theirs (owner, on the pack's setup screen). *"We are
piloting this with one client"* and *"any client may switch on a feature we
have not priced"* are different statements and one flag can only make one. The
tenant's key stores the REFUSAL, `tabsOff`'s rule, so a granted tenant has it
on without clicking anything.

**A new outline can be read off a cost code list.** A business's chart of cost
is already its phases in the order it builds them — the residential starter is
in build order for exactly that reason — so the shortest road to a usable
outline is to take the list it already keeps and ask one question at every
stop: *who is doing this one?* In-house, bidding it out, by others, not on
this job. That answer decides the shape of everything downstream, and it is
the only question that needs no knowledge of the trade.

### Two things found by running it

**A LOOP THAT WRITES A TREE IS A ROUND TRIP PER ROW, and the seed test found
it by timing out at thirty seconds.** `writeSteps` inserted a step, selected
its questions, inserted each one; the two starters are 56 steps and 150
questions, so a profile install was making over four hundred trips to Neon.
The fix is to **mint the ids in the application** — `randomUUID()` rather than
the column default — so the whole tree is known before a single write and each
table takes one multi-row insert. `RETURNING` from a multi-row insert gives no
order worth relying on, which is why minting beats reading them back. This was
not a test being slow: it was a profile install nobody would have sat through.

**THE EXISTING SEED TESTS WERE ASSERTING A SENTENCE THAT HAD CHANGED.**
`seedSummary(construction).packs` and the applier's description both grew the
outlines, so three tests in `tests/profile-seed.test.ts` failed on strings that
were correct the day before. They are now computed from the manifest's own
constants rather than typed, and the file gained the outline half of the three
seeding rules: both starters land whole, new build becomes the default, and an
outline the tenant has **pruned** is left exactly as it is on a re-install.

### What is NOT built, and is next

The interview itself — the conversation that reads an outline, asks its
questions and proposes groups and lines. Then **bid requests** to
subcontractors, which the *Bidding it out* answer implies and which is a
feature of its own (nothing in the pack solicits a bid today; a commitment is
the subcontract after you have bought it, and **SES production access is still
denied**, so emailing a sub reaches only a verified address). Then quantities
imported from a **Revit** schedule — the founder draws in Revit, which turns
the takeoff from a measurement into a join if the type names carry the
assembly keys. Then a takeoff opened inline from a question.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `job_cost_code_sets` | A named list of cost codes. One or several per tenant. | FORCE RLS, member-wide. `job_cost_code_sets_one_default_idx` is a PARTIAL unique index, so **two defaults fail at the database** rather than depending on the action having cleared the first. |
| `job_cost_codes` | One line of the chart of cost. | Composite FK to `(tenant_id, set_id)`, **cascade** — deleting a list deletes its codes. `code` is free text, never a number: CSI writes `03 30 00`, NAHB writes `1000`, a builder writes `CONC-SLAB`. `sort_order` is what orders the list, so a code never has to be sortable to be right. |
| `job_cost_codes.category` | **The list's own grouping** — the pilot's `03. Infrastructure`, a CSI division. A LABEL, never a row: there is nothing to post to, which is how *"the sub cost codes need cost tracked to them, not just the parent"* is kept without a rule anybody has to remember. Blank on most starter lists. |
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
| `job_estimates` | The job priced before anybody signs (10, ADR 0069): a number unique per job, title, draft / sent / accepted / declined / superseded, sent / decided / valid-until dates, the three rates in ppm — markup on cost (the lines' default), overhead on the subtotal, profit on the subtotal plus overhead — notes, and the contract an accepted one became. | Cascade from the project; **no action to the contract**. CHECK: status on the list, every rate 0..10,000,000 ppm (`RATE_PPM_MAX`), number present. Nothing stores a total: `estimate-math.ts` computes them. Accepted, the rates and lines are fixed by the verb, not the database. Since 10b (ADR 0070) also `presentation` — CHECK lines / codes / **groups** (E1, ADR 0079) / sum, the live definition being in `0373`, which drops and re-adds it — and the proposal's `scope`, `exclusions` and `terms`: the words fixed with the money, the presentation free. An accepted estimate's ITEMS are fixed with its lines and its rates. Since E2 also `show_code_numbers` (ADR 0080), off by default and free on an accepted estimate, being a printing choice. |
| `job_estimate_groups` | **The item the client buys** (E1, ADR 0079): a name in the client's words, an optional `client_note` paragraph, `price_mode` — `rollup` (its lines sum) or `fixed` (the price is typed, and sits OUTSIDE the overhead-and-profit spread) — `fixed_price_cents`, sort order. One level deep, by the shape rather than by a rule. | Cascade from the estimate. CHECK: name present and ≤ 200, note ≤ 4,000, mode on the list, price ≥ 0, and **`(price_mode = 'fixed') = (fixed_price_cents is not null)`** so the mode and the number cannot disagree. Nothing stores a total; the item's cost, price and margin come from `estimate-math.ts`. |
| `job_estimate_groups.section` / `.show_lines` | **Which heading an item prints under, and whether the client sees what is in it.** The section arrives from the outline step and is editable, because it is NOT the cost code's category — `Siding Labor` is accounted under `04. Structural` and printed under *Labour*. `show_lines` defaults true and is an extra reason to collapse, never a reason to expand: a typed price or a hidden line still closes an item (ADR 0080). |
| `job_estimate_lines` | One line of an estimate: cost code, description, unit, quantity in thousandths (1000 = one, a lump sum), unit cost, an optional markup of its own, an optional unit price that wins over any markup, notes, sort order; since E1 the **item** it sits in (`group_id`, null = loose); and since E2 (ADR 0080) `client_description` — what the client reads instead, blank meaning the description — and `client_visible`. | Cascade from the estimate; **no action to the code**; **SET NULL (column-list form) from `job_estimate_groups`** — an item removed leaves its lines loose, which is what ungrouping means, and never destroys what was priced. CHECK: description present, client description ≤ 300, quantity / unit cost / unit price ≥ 0, markup 0..10,000,000 ppm or null, and **`client_visible or group_id is not null`** — hidden money must have somewhere to hide (ADR 0080). Written by id (updated, inserted, removed when left out), so a line keeps its identity across an edit; nothing points at one but a measurement.  Since X2b also `basis` / `basis_detail` (ADR 0098): where the number came from, BLANK on every line anybody typed — blank is not `none`, which means a walk produced it and could not price it. The input treats an absent basis as *leave what is there*, so the editor's autosave cannot strip it. **The sheets behind a line are never stored on it** (ADR 0109): `measurementsBehind` reads them off the markups' `estimate_line_id`, so the chip cannot disagree with the drawings. |
| `job_estimate_outlines` | **A way this business walks an estimate** (X1, ADR 0098): "New build", "Remodel". Name, notes, `is_default`, `is_active`. Several per tenant, seeded from a profile and the tenant's from that moment. | FORCE RLS, member-wide — owner-only to WRITE is `requireWrite` in the ops, because RLS is row-level and not verb-level. `job_estimate_outlines_one_default_idx` is a PARTIAL unique index, the cost code set's rule: **two defaults fail at the database**. Name unique per tenant, so two businesses may both say "New build". **No company-scope restrictive policy** (ADR 0094) — an outline belongs to the tenant and to no company, as a cost code list and an assembly do. |
| `job_estimate_outline_steps` | One stop on the walk: a phase in the order it is priced, with the cost code its lines are charged to and `guidance` — what must be established here, in prose, which the interview reads. | Composite FK to the outline, **cascade**. `cost_code` is **TEXT, not an id** — a code's id belongs to one cost code set and an outline is walked on every job (ADR 0086's call, ADR 0098's reason). CHECK: title present. Written by id, so a step keeps its identity across an edit. |
| `job_estimate_outline_steps.section` | **The part of the bid a step belongs to** — a heading, not a code. Arrives from the cost code's `category` when an outline is read off a chart, and editable afterwards because the two differ: `Siding Labor` is accounted under `04. Structural` and printed under *Labour*. Where the price sheet's headings will come from. Blank on every outline written before it existed. |
| `job_estimate_outline_questions` | One question at a stop: the prompt, its `kind` (choice / yes_no / number / money / text, which is what becomes the quick-reply buttons), a choice's `choices` in jsonb, a number's `unit`, and `notes` for the interviewer. | Composite FK to the step, **cascade**. CHECK: prompt present, kind on the list, and **options belong to a choice and to nothing else** — `jsonb_typeof` first, because a CHECK evaluating to NULL passes; a choice needs ≥ 2 and every other kind needs 0. **A ROW rather than a string in an array**, so an answer can point at one (ADR 0098) — which is also why the save keeps its id. Since 2026-09-19 also `always_ask`: a question the walk may never decide is irrelevant, the counterweight to letting it skip. Always ASKED, not always answered. |
| `job_estimate_interviews` | **A walk** (X2a, ADR 0098): the estimate being priced by conversation, the outline it is walking, running / finished / abandoned, a bookmark on the current step, and the question on the screen right now (`pending_say`, `pending_question_id`, `pending_quick_replies`) so a refresh loses nothing. `exchanges` and `last_turn_at` are the cap and the cooldown. | FORCE RLS, member-wide — walking an estimate IS the estimating, so unlike the outline it is not owner work. Cascade from the estimate; **NO ACTION to the outline**, so an outline somebody is mid-way through cannot be deleted. `job_estimate_interviews_one_running_idx` is a PARTIAL unique index: one running walk per estimate, because two would each bank answers the other cannot see. CHECK: status on the list, `(status = 'running') = (finished_at is null)` both ways, replies a jsonb array. **A finished walk goes back to running when a PERSON clicks into a phase** (X8, ADR 0102) — both columns move together, which is what that CHECK is for — and the partial unique index is what refuses it while a newer walk is running on the same estimate. |
| `job_estimate_interview_answers` | One thing asked and what came back: the step and question it belongs to, **the words it was asked in**, the answer, or a skip with its reason. | Cascade from the walk. **`step_id` and `question_id` carry NO foreign key** — a transcript is a record of what happened (the lien waiver's rule), and an answer that vanished because somebody tidied the outline would be a record that lies. `question_id` is also null whenever the walk asked something the outline never had, which it is meant to do. CHECK: prompt present, and **a skip is whole or absent** — skipped with a reason and no answer, or neither. |
| `job_estimate_proposed_lines` | **What a walk works out for a step, before anybody accepts it** (X2b, ADR 0098): the line's words, unit, quantity and unit cost, plus `basis` / `basis_detail` for where the MONEY came from and `quantity_basis` / `quantity_note` for where the QUANTITY did — two different questions. `estimate_line_id` once it is on the estimate. | Cascade from the walk. A table rather than a value in the page because everything else about a walk survives a reload and this would have been the one thing that did not. CHECK: description present, both bases on their lists, nothing negative, **`(quantity_basis = 'derived') = (there is working to show)`** — a derived figure with nothing to show would be the unexplained number the slice refuses — and applied is both halves or neither. |
| `job_rooms` | **A room in the building** (X8, ADR 0101): name, `slug`, the `level` it is on, sort order, notes. | Hangs off the PROJECT, cascade. **Unique on `(tenant, project, level, slug)` — per FLOOR, not per building**, because a house has a `Bathroom` upstairs and a `Bathroom` downstairs. No room TYPE column on purpose: *Master bath* already tells the walk there is a shower in it, and a taxonomy is a thing the tenant maintains that would be wrong for commercial on day one. Its floor AREA is not here — it is a `job_measurements` row scoped to it, so it is read by the same parser, traced with the same dialog and carries the same provenance, and a room's wall area later is a row rather than a migration. |
| `job_measurements.room_id` | **The room a measurement is about**, null for the building itself. The unique rule became TWO PARTIAL indexes: keyed on the project `WHERE room_id IS NULL`, keyed on the room where it is not — a plain unique over the nullable column would treat every building-level NULL as distinct and let them duplicate silently. `ON CONFLICT` therefore has to name which index it means, which is why `recordMeasurement` reads as two cases. Cascade from the room: the area belonged to it. |
| `job_estimate_interviews.rooms_asked_at` | **When the measure-up asked what rooms are in the building** (X8). Stamped when the question is PUT rather than answered — "asked and waiting" and "not asked yet" are otherwise the same three nulls, and the walk would ask twice or never. |
| `job_estimate_outline_measures` | **What to measure before the questions start** (X7, ADR 0100): the name, the `unit` the answer lands in, the `kind` of takeoff tool it wants (length / area / count), `guidance` in the business's own words, and `required`. | Composite FK to the outline, **cascade** — it is the outline's list, beside the steps and the questions, and **owner work** to edit for the same reason the steps are. CHECK: name present, kind on the list. Unique per `(outline, name)`. The test for belonging on it is whether MORE THAN ONE phase reads the number. |
| `job_assembly_keys` | **What the model calls an assembly** (X15, ADR 0107): the name a schedule off the model uses for a thing — `Basic Wall: Interior - 2x4 Wood Stud`, `Gypsum Wall Board` — and the assembly it means. `key` as written, `key_slug` reduced. | Composite FK to the assembly, **cascade** — the names go with it. **Unique per `(tenant, key_slug)`**: a name means ONE assembly per business, so confirming a different one later is a correction written on the slug, never a second row; the same name is free for the next business. CHECK: key and slug present. Written by the takeoff dialog on confirmation (`rememberKey`) and by the assembly page (`setAssemblyKeys`, which replaces the list and moves a name typed on a second assembly). |
| `job_measurements` | **A number about the BUILDING** (X7, ADR 0100): name, `slug`, unit, `value_thousandths`, `source` (measured / said / derived / **schedule** — read off a schedule exported from the model, X14, ADR 0106), a note, and `passed_at` for *not on this job*. `sheet_id` / `markup_id` when it was traced. | Hangs off the **PROJECT**, not the estimate and not the walk — a perimeter does not change between revisions, so two walks and three revisions read one row. **Unique on `(tenant, project, slug)`**, which is what makes the name the identity and makes re-measuring a correction. CHECK: name and slug present, source on the list, and **a value OR a pass, never neither**. The two composite FKs are `ON DELETE SET NULL ("sheet_id")` / `("markup_id")` in **PG 15's column-list form** — the bare one drizzle-kit emits can never fire, because it would null `tenant_id`; the trace can go and the number stays, since it was true when it was taken. |
| `job_estimate_interviews.pending_measure_id` / `.measured_at` | The measurement being asked for right now (so the answer lands on the row whose id was on screen, never on one the model inferred), and **when the walk stopped measuring and started asking**. `measured_at` is STAMPED, not derived: deriving it from "is the list answered" would drop every walk in progress back into measuring the moment somebody added a measurement to the outline. |
| `job_bid_packages` | **One scope being priced** (X3, ADR 0098): what it is, the cost code by its DIGITS, the scope a subcontractor reads, when numbers are wanted by, open or closed. | Cascade from the project. Hung on the JOB, not an estimate, because a business asks for a number once and may price two revisions with it. CHECK: title present, status on the list. Behind the interview's grant in application code, not in a policy. |
| `job_bid_invitations` | **One subcontractor asked, and what they said**: their own token, its expiry, views, and the reply — a number or a decline, with the name they typed and an IP hash. `is_awarded` for the one the business is going with. | Cascade from the package; **RESTRICT to the party** — a sub who has been asked for a number is kept. `token_hash` GLOBALLY unique with no tenant prefix (the public lookup has no tenant to scope by), token under AES-GCM so the link can be copied again. Unique per `(package, party)`: asking twice is one ask. **At most one award**, by a partial index. CHECK: **a reply is whole or absent** (ADR 0085's shape), and **`not is_awarded or amount_cents is not null`** — you cannot award a number nobody gave. |
| `job_estimate_interview_answers.superseded_at` | **When somebody asked that one again** (X4, ADR 0099). Not a table: one nullable column, and the whole mechanism behind going back into a walk. A superseded row stops counting in `settledIds`, `walkProgress` and the reckoning, so its step is no longer covered and `currentStep` takes the walk back to it with no special case for revisiting. The old row stays, because a transcript is a record of what happened. |
| `job_party_documents` | What a subcontractor or supplier has on file with the business (11b, ADR 0068): the party, an open-taxonomy `kind` (format-checked; three suggested), title, issuer, number, issued and expires dates, a coverage limit, requested / received / void with the receipt date, notes. The scanned copy is a Documents attachment (`job_party_document`). | **No action to the party** — one with documents on file cannot be merged away. CHECK: the kind is a slug; received has its date, requested has none, void keeps what it had; limit ≥ 0. Standing (missing / expired / expiring / ok) is derived against today and the tenant's required list, never stored. |
| `job_drawing_sets` | One issue of a job's drawings (ADR 0072): name, the date on the drawings (`issued_on`, which orders the issues), who issued it (a party), notes. Its PDFs are cabinet documents hung on it through `document_attachments` (`job_drawing_set`). | Cascade from the project; **no action to the party**. CHECK: name present. The current set is never stored — it is derived from the issues' dates. |
| `job_sheets` | One page of one of a set's files with the number the trade calls it by, normalised on write, a title and a revision mark; **and its scale** (ADR 0074): page points per foot or metre with the page's size in points beside it, so a measurement's fractions become feet without the PDF. | Cascade from the project, the set AND the document (a page of a file that is gone is nothing to open). UNIQUE (set, number) and (set, document, page). CHECK: number present, page ≥ 1. The discipline is read off the number, never stored. |
| `job_sheet_markups` | A cloud, an arrow, a note or a pin on ONE issue of a sheet (ADR 0073): the shape as fractions of the page (`geometry` jsonb), a colour from the five, words for a note or a pin, and the punch item a pin raised while it exists (`work_item_id`); **and a length, an area or a count** (ADR 0074): `{points}`, its quantity derived through the sheet's scale, and, since ADR 0110, `figures` (jsonb, an object by CHECK): what the trade typed onto the trace — a height on a length, a pitch, a depth and the openings cut out of an area — kept as typed and read tolerantly by `parseFigures`; every derived figure is worked out when read. `estimate_line_id` / `pushed_quantity_thousandths` were the takeoff's first link (ADR 0074): **superseded by `job_estimate_line_traces`, unwritten and unread since ADR 0110**, to be dropped by a later migration. |
| `job_estimate_line_traces` | **What stands behind an estimate line** (ADR 0110): one row per (line, trace, figure) — the room's area behind the flooring, its perimeter behind the baseboard, its volume behind the slab — with `share_thousandths`, what THAT figure of THAT trace came to when it was pushed. Read by `measurementsBehind` (the reverse link) and `listMarkups` (the chips). | Composite FKs, both **cascade**: a line taken off the estimate takes its links, a trace rubbed out takes its links; the line keeps its quantity either way. **Unique per `(tenant, line, trace, figure)`**: one figure of one trace stands behind one line once, and the same figure may stand behind another line. CHECK: figure in the seven, share ≥ 0. FORCE RLS, member-wide. | Cascade from the project and from the sheet; **SET NULL (column-list form) from `work_items` and from `job_estimate_lines`** — a punch item cleared leaves the pin as a note, a line taken off leaves the measurement. CHECK: kind (seven), colour, words present for a note or a pin, words ≤ 2,000, geometry an object. |
| `job_warranty_claims` | The call after the job is done (ADR 0076): a number per job, what and where, reported when and by whom, the trade responsible (a party), the cost code the fix is charged under, the decision — pending / covered / not_covered — with its day and reason, and the Work item raised for it while it exists (`work_item_id`). | Cascade from the project; **SET NULL (column-list form) from `work_items` and from `job_cost_codes`**; no `onDelete` to the party (the CRM merge rule). UNIQUE (project, number). CHECK: number > 0, title present and ≤ 300, decision in the three, `(decision = 'pending') = (decided_on is null)`, every text bounded. The project's months: `coalesce(months, 1) between 1 and 1200`. Standing is never stored. |
| `job_back_charges` | Money the business spent that was the subcontractor's (ADR 0077), kept back from their next application: a number per order, what was paid for, the amount (always > 0), the day it went out, the cost code it landed on, the warranty claim it came from, and the application it rides while it rides one. | Cascade from the commitment; **SET NULL (column-list form) from `job_cost_codes`, `job_warranty_claims` AND `job_sub_applications`**. UNIQUE (commitment, number). CHECK: number > 0, amount > 0, description present and ≤ 300, status in (`open`, `void`), and `void` implies no application — the one impossible state. Where it stands is never stored. |
| `job_bonds` | A surety bond (ADR 0078): the kind (OPEN taxonomy, format-checked), the surety (a party), the penal sum, the premium and the code it belongs on, the contract it names when there is one, effective / expiry / released dates, and `requested` \| `issued` \| `released` \| `void`. | Cascade from the project; **SET NULL (column-list form) from `job_contracts` and `job_cost_codes`**; no `onDelete` to the party. CHECK: kind format, penal sum > 0, `coalesce(premium, 0) >= 0`, a bond in force carries its effective date, `(status = 'released') = (released_on is not null)`, expiry not before effective. Where it stands is never stored. |
| `job_bonding_lines` | What one company's surety will back: the single-job and aggregate limits off the letter, and the surety. **One row per company** — a surety underwrites a legal entity. | Composite FK to `entities` (no `onDelete`) and to `parties`. UNIQUE (tenant, entity). CHECK: each limit positive when set (`coalesce` guarded), and a single-job limit never above the aggregate. |
| `job_phases` | A phase or milestone of a job's schedule (ADR 0071): the calendar item that holds its dates, name, kind, planned / underway / done, the predecessor and its lag, the party doing it, the cost code, notes, order. | Cascade from the project AND from its `schedule_items` row (a phase without its item is nothing); **no action to itself, the party and the code** (the verb re-points successors before a removal). One phase per item. CHECK: kind, status, lag within a year, not its own predecessor. The dates are NOT here — they are the item's. |
| `job_lien_waivers` | A lien waiver as a RECORD (11a, ADR 0066): the claimant (any party), the job, the order and the billed application it covers, its kind (conditional/unconditional × progress/final), the through date, the amount, and whether it was requested or received. The signed copy is a Documents attachment (`job_lien_waiver`). | Cascade from the project and the order; **no action to the party and to the application** — who signed is held, and a named application stays. CHECK: received has its date, requested has none, void keeps what it had; amount ≥ 0. Nothing here says "outstanding": the gap is derived from the applications' bills at read time. |
| `job_commitment_lines` | The money, one cost code at a time — the lines the order was placed with (`change_order_id` null) and each change order's, tagged with it (4b). | Cascade from the commitment and from the change; **RESTRICT to the cost code**, which is the backstop for "codes are retired, never deleted". Amount non-negative on an original line — a credit is a change order — and a change's line may be negative, the one exception in the CHECK. A line counts when it is original or its change is approved: `countedCommitmentLine`, one predicate for every roll-up. |
| `job_projects` | The spine; since ADR 0076 also the WARRANTY PERIOD — `warranty_months` and `substantial_completion_on`, both nullable, the expiry derived and never stored. | FOUR composite FKs, each certified in `tests/isolation/jobs.test.ts`: company, division, client, cost code list. `delivery_method` is an open taxonomy (P1) with a **format check and no value check**, and is nullable. `metadata` is the P2 extension bag. |

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
/ `0344_sub_billing_rls.sql` (slice 5c, hand-reordered) and `0345_time_and_materials.sql` / `0346_time_and_materials_rls.sql` (slice 5d; as generated) and `0347_unit_price.sql` (slice 5f; columns and CHECKs on two existing tables, so no RLS migration) and `0348_commitment_change_orders.sql` / `0349_commitment_change_orders_rls.sql` (slice 4b; as generated — the new table's unique index lands before the lines' key to it) and `0350_lien_waivers.sql` / `0351_lien_waivers_rls.sql` (slice 11a; as generated, one new table referencing existing ones) and `0352_selections.sql` / `0353_selections_rls.sql` (slice 8; hand-reordered — two new tables, the selections' unique index ahead of the choices' key) and `0354_party_documents.sql` / `0355_party_documents_rls.sql` (slice 11b; as generated) and `0356_estimates.sql` / `0357_estimates_rls.sql` (slice 10; hand-reordered — two new tables, the estimates' unique index ahead of the lines' key) and `0358_proposal.sql` (slice 10b; four columns and a CHECK on `job_estimates`, so no RLS migration) and `0359_job_phases.sql` / `0360_job_phases_rls.sql` (the schedule; hand-reordered — a self-referencing key needs the table's own unique index first) and `0373_job_estimate_groups.sql` / `0374_job_estimate_groups_rls.sql` (E1, ADR 0079; as generated but for the line's key to the item, **hand-edited to the column-list `ON DELETE SET NULL ("group_id")`** as every composite SET NULL in this repo is) and `0375_estimate_client_wording.sql` (E2, ADR 0080; three columns and two CHECKs on existing tables, so no RLS migration — **and hand-edited to REMOVE a DROP and re-ADD of that same key, which drizzle regenerated in the bare form that can never run**; `tests/migrations.test.ts` now guards the class) and `0376_estimate_format_and_letter.sql` (E5a, ADR 0083; two columns and a CHECK on `job_estimates`, so no RLS migration — **generated clean, with no stray foreign key to repair**, because 0375's snapshot recorded the item key's intent) and `0377_job_estimate_shares.sql` / `0378_job_estimate_shares_rls.sql` (E5c, ADR 0085; one new table referencing an existing one, as generated and renamed off drizzle's own tag — **its `token_hash` index is UNIQUE GLOBALLY with no tenant prefix**, because the public lookup has no tenant context to scope by) and `0379_job_assemblies.sql` / `0380_job_assemblies_rls.sql` (E6, ADR 0086; two new tables, **hand-reordered so the parent assembly's unique index lands ahead of the lines' composite key** — and shipped with a repair to `0378`'s snapshot, which was a byte copy of `0377`'s and made `db:generate` refuse to run at all) follow the same rule —
and from slice 3 the pair is `db:verify-rls` **and `db:verify-modules`**, after
the pack shipped invisible for want of a catalogue row. `db:verify-rls` reports **220 tables**, all enabled, forced and with
policies, on both.

**0327 needed no hand-reordering, which confirms the diagnosis in 0325.** Both
tables it references — `job_projects` and `parties` — are from earlier
migrations, so their unique indexes already existed when the FKs were added. The
ordering only bites when two new tables reference each other in one file.

## Key files & seams

- `src/packs/jobs/walk-price-math.ts` + `walk-price-ops.ts` — **asking for
  the money** (X6). The pure half writes the question from the line, reads
  one figure out of the answer and refuses two; the ops half parks the ask
  on the interview and banks what was said. **The model is in none of it.**
  `phaseOnScreen` is also here, and it is the one place that decides WHICH
  phase the walk screen is about: while a price is pending that is the phase
  being PRICED, because `currentStep` has already left it — pass it the
  steps, where the walk is standing, and the pending price, and everything
  from the header to the rail's ring reads one answer.
- `src/packs/jobs/room-math.ts` + `room-ops.ts` + `room-actions.ts` +
  `components/rooms-dialog.tsx` — **the rooms in the building** (X8, ADR
  0101). A room is a name, a floor and a floor area, and the area is a
  measurement scoped to it rather than a column — which is why this is a
  short file and not a second copy of the one below. `parseRoomList` is
  where the care is: split on a tab, a comma or a wide gap but **never a
  single space** (`Master bedroom` would become `Master`), a trailing colon
  is a floor, and a line whose area will not read keeps the ROOM and drops
  the number. The two prompt rules that stop fifteen rooms becoming
  seventy-five questions live in `ai/walk.ts` (2b) and `ai/propose.ts` (2b).
- `src/packs/jobs/measure-math.ts` + `measure-ops.ts` + `walk-measure-ops.ts`
  + `measure-actions.ts` + `components/measure-on-a-drawing.tsx` +
  `components/outline-measures.tsx` — **measuring the building before pricing
  it** (X7, ADR 0100). The split is X6's, deliberately identical: the pure
  half reads what an estimator types (`38'-6"`, `24 x 40`,
  `40 + 24 + 40 + 24`) and refuses everything it would have to guess at, the
  ops half writes it, and `walk-measure-ops.ts` is the walk's end — ask, park
  on the interview, bank, stamp `measured_at`. **The model is in none of it.**
  `LoadedWalk` carries the project, the declared list and the measurements so
  there is ONE place they are read, and `measureLines` puts them into every
  turn's prompt, which is the whole point of the slice. The drawings open over
  the walk through `SheetViewer`'s one optional `measuringFor` prop — not a
  second viewer.
- `src/packs/jobs/bim-schedule.ts` + `bim-schedule-ops.ts` +
  `components/bim-schedule-dialog.tsx` + the two `*BimScheduleAction`s in
  `walk-actions.ts` — **a schedule off the model** (X14, ADR 0106). The pure
  half turns a Revit-shaped export into a table and reads columns, rooms and
  suggestions off the TABLE, so nothing past `parseSchedule` knows a vendor;
  the ops half lands rooms through `addRoomList` and figures through
  `recordMeasurement` as `source = 'schedule'`; the actions carry the walk on
  through `afterMeasuring` / `answerRooms`. **Not `schedule-ops.ts`** — that
  is the construction schedule, and a file by that name was overwritten once.
- `src/packs/jobs/bim-takeoff.ts` + `bim-takeoff-ops.ts` + `bim-takeoff-actions.ts`
  + `components/bim-takeoff-dialog.tsx` + `components/schedule-input.tsx` +
  `insertTakeoff` in `estimate-editor.tsx` — **the takeoff off the model**
  (X15, ADR 0107). The reader groups a schedule by the column that names
  things and adds every figure up per name; the join is `job_assembly_keys`
  (`listAssemblyKeys` / `keysOf` / `rememberKey` / `setAssemblyKeys`, in
  `assembly-ops.ts`); the drop goes through the same `linesForDrop` as *Add
  an assembly*, and the editor appends the items. `driverFor` is where the
  care is: the row's figure in the ASSEMBLY's dimension, *Length* before
  *Unconnected Height*, converted into its unit, or a refusal in words.

- `src/packs/jobs/bonding-ops.ts` + `bonding-math.ts` +
  `components/bond-form.tsx` — surety bonds and the line behind them
  (ADR 0078): the bond on the JOB naming a contract when there is one,
  the standing derived against today, and `bondingView` folding a job's
  bonds into ONE entry before `bondingCapacity` — because performance and
  payment come as a pair and counting both doubles the exposure. The
  capacity screen is `app/dashboard/m/jobs/bonding`.
- `src/packs/jobs/back-charges-ops.ts` + `back-charges-math.ts` +
  `components/back-charge-form.tsx` — back-charges (ADR 0077): a record on
  the ORDER, never a deductive change order; the standing derived from the
  application it rides (`backChargeStanding`), the deduction added to that
  application's bill by `approveSubApplication` as one negative line each,
  and the certificate above it deliberately gross so the next application
  does not hand the money back.
- `src/packs/jobs/warranty-ops.ts` + `warranty-math.ts` + `components/warranty-forms.tsx`
  — the warranty (ADR 0076): the period's arithmetic pure (`addMonths`,
  `warrantyExpiresOn`, `warrantyStanding`, `withinWarranty`,
  `claimStanding`), the claim's Work item through `createWorkForEntity`
  linked to the CLAIM (`WARRANTY_CLAIM_ENTITY`, registered in `links.ts`),
  the tab at `[id]/warranty` and the page across jobs at `jobs/warranty`.
- `src/packs/jobs/paper.ts` + `paper-model.ts` + `paper-pdf.tsx` — the client's
  change order and the issued order as PDFs (ADR 0075): two pure model
  builders, one layout in the proposal's styles, two loaders that read the
  rows in one transaction; the routes under `src/app/api/jobs/change-orders`
  and `src/app/api/jobs/commitments`.
- `src/packs/jobs/proposal-sections.ts` + `proposal-html.ts` — **the proposal as
  a page order, and the document** (E5a, ADR 0083). The sections decide which
  pages a format has and every word on them, WRAPPING `proposal-model.ts` so the
  money keeps one source; the HTML file is layout only and computes nothing. Its
  route, `/api/jobs/estimates/[id]/document`, is the URL E5c will share with the
  client — and since E5b the PDF beside it is a **print of the very string that
  route returns**, not a second rendering of it. `proposal-html.ts` is also the
  one file in the pack where **a backtick is a syntax error**, comment or not:
  the stylesheet is a template literal.
- `src/lib/pdf/print-press.ts` + `print-html.ts` — **the platform's one way to
  print a page** (E5b, ADR 0084), in `src/lib` and not in the pack because the
  next document written as HTML should not have to ask the jobs pack. The press
  module is pure (`pressFor`: a local browser, a hosted pack, or nothing with a
  message naming what to set — a local browser WINS over a pack); `print-html.ts`
  is `server-only` and lazily imports `puppeteer-core`, so no route that does not
  print pays for it. `npm run print:probe` measures what only paper shows.
- `src/packs/jobs/proposal-share.ts` — **the token → tenant hop, and the most
  dangerous function in the pack** (E5c, ADR 0085), in a file of its own so it
  can be read in one sitting. `withSystem` resolves one globally unique
  `token_hash` and does NOTHING else; everything after runs under `withTenant`
  at role staff. Every failure returns `{ ok: false }` — the caller cannot tell
  the reasons apart, and neither can a visitor.
- `src/packs/jobs/estimate-share-status.ts` + `estimate-shares.ts` — the pure
  standing (`shareStanding`: open / signed / revoked / expired / **superseded**,
  the last being the only one that is a fact about two rows) and the builder's
  ops. `signEstimateShare` is the one write a stranger may make and it is a
  RECORD, not a state change: `acceptEstimate` still wants an owner and the
  contract. The link's expiry comes from the estimate's own `valid_until`.
- `src/lib/public-limits.ts` — the per-IP caps for every anonymous surface,
  moved out of the documents module when the client link became the second one.
  A pack may not reach into a module for a security control.
- `src/packs/jobs/estimate-parse.ts` — **one typed sentence into one estimate
  line** (E3a, ADR 0081), pure and table-tested: `parseEstimateLine`,
  `parseEstimateLines`, `COMMON_UNITS`, `unitsFor`. The entry bar, the paste
  box and (later) a phone are three doors onto it. A sentence it cannot read
  is `null`, never a line with a zero in it.
- `src/packs/jobs/estimate-math.ts` — **the whole arithmetic of an estimate,
  pure and pinned** (ADR 0069, 0079). The items arrive as a trailing argument
  that defaults to none, so an ungrouped estimate computes what it always did.
  `estimateTotals` (with `spreadableCents` — the overhead-and-profit base — and
  `fixedCents` beside the six it always had), `groupCostCents` /
  `groupPriceCents`, and **one internal `scheduleLines`** that every shape
  reads, so an item's row is exactly its lines' rows added up: `scheduleRows`
  in `group` (the schedule of values), `line` and `detail` (the proposal's
  takeoff, where a FIXED item prints as one row because its build-up was never
  the client's), plus `scheduleFromEstimate` for the per-line view and
  `estimateByCode` for the budget — whose COST is untouched by items.
- `src/packs/jobs/estimating-ops.ts` + `components/estimate-editor.tsx` — the
  estimate's verbs and its one screen. **The screen saves itself** (E3b, ADR
  0082): "unsaved" is the payload compared with the last one sent, the version
  is held in the editor and handed to every guarded verb, and `rowHolds` skips
  a row that already holds what is being written — its comparison derived from
  the keys of the write, so it cannot drift. `saveGroups` returns the map from what a
  line called an item to the id the server minted, and runs before `saveLines`
  and before the deletions, so no line is orphaned mid-write; a `groupRef` that
  resolves to nothing is refused. `applyEstimateToSchedule` takes a shape, `group`
  by default once there are items. The editor holds items as header rows inside
  the ONE table, so the columns stay aligned, and hides the item column entirely
  until there is an item.
- `src/packs/jobs/takeoff-ops.ts` + `takeoff-math.ts` — the scale and the takeoff
  (ADR 0074): `setSheetScale` from a known dimension or a standard,
  `measure` through the scale (pure, shared with the viewer), `pushTakeoff`
  onto an estimate line as a statement of the total. **And the line's side
  (ADR 0109)**: `measuredSet` (one set of figures across sheets, one family,
  one unit), `standBehind` (the link only, each figure's own share),
  `measurementsBehind` (the reverse link, read per line, per sheet and per
  figure), `unitAccepts` / `measureKindForUnit` / `driftedSince` (pure).
  **And the figures a trace yields (ADR 0110)**: `parseFigures`, `yieldsOf` /
  `yieldFor` (net area, perimeter, wall, roof, volume, each with its working),
  `pitchFactor`, `whyNoYield`, `familyOf`; `yieldsOfMarkup` on the ops side;
  the link table `job_estimate_line_traces` and `TracePickInput`.
- `src/packs/jobs/components/measure-line-dialog.tsx` — the drawings opened
  FOR an estimate line (ADR 0109): the sheets with what stands behind the line
  on each, the viewer in its `forLine` mode, the total across sheets, *Use*.
  The estimate editor holds the ruler, the sheets chip and *From the drawings*.
- `src/packs/jobs/markups-ops.ts` + `markups-math.ts` + `components/sheet-viewer.tsx`
  — markups (ADR 0073): the shape checked once in `parseGeometry` on both
  sides, the revision cloud as `cloudPath`, a pin's punch item through the
  field slice's own `addPunchItem`, and the viewer's SVG over the canvas in
  the page's own units.
- `src/packs/jobs/components/current-set.tsx` + `discipline-settings.ts` +
  `src/lib/blob-paths.ts` + `src/app/api/jobs/sheet-thumbs/**` — **the sheet
  cards, with pictures, in the business's order.** The picture is stored at a
  pathname DERIVED from `(tenant, document, page)` — no column, no migration —
  and the streaming route reads the `job_sheets` row for that pair through
  RLS before it serves anything. `blob-paths.ts` exists because `blob.ts` is
  `server-only` and the browser builds the pathname before it asks for a
  presigned URL; `blob.ts` re-exports it so every prefix is still in one
  place. The order lives in `config.disciplineOrder`, owner-only, read by
  `disciplineOrderFrom` and threaded through `listSheets` so the sheets sort
  by it too.
- `src/packs/jobs/components/page-loupe.tsx` — **one page, big enough to read
  the title block off**. Drawn from the PDF at up to 8×, `Title block` going
  to the bottom-right corner at 4×, and the `Sheet`/`Title`/`Rev` boxes in it
  so a set the reader could not make sense of is still one pass. Mirrors
  `sheet-viewer.tsx`'s rendering deliberately (whole page, one canvas at
  `boxWidth * zoom`, `PIXEL_CAP`, ctrl+wheel and drag). **Portalled to the
  body** — a dialog's `translate` makes it the containing block for anything
  `fixed` — and its Escape is caught in the capture phase so it does not
  close the index behind it.
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

- **[ADR 0078](../decisions/0078-a-bond-is-recorded-on-the-job-and-a-job-counts-once-against-the-suretys-line.md)** —
  a bond is recorded on the JOB and names a contract when there is one (a
  bid bond has none); a job counts ONCE against the surety's line however
  many bonds it carries; what is used is BACKLOG, not contract value; a
  bond ties up the line from the day it is asked for and lets go when
  released, expired or dropped; the limits are a row per company because
  nothing tenant-facing writes pack config; the kind is an open taxonomy
  and the premium is recorded, never posted.
- **[ADR 0077](../decisions/0077-a-back-charge-is-money-the-business-spent-that-was-the-subcontractors-kept-back-from-their-next-application-and-never-a-change-to-the-order.md)** —
  a back-charge is a record on the order and never a deductive change
  order; it comes off the BOTTOM of an application, so `due_cents` and
  `certifiedCents` stay gross and the deduction cannot be taken twice; it
  reaches the books once, as its own negative line against the code the
  cost landed on, so the job cost report nets out; more than the payment
  refuses by name rather than making a negative bill.
- **[ADR 0076](../decisions/0076-a-warranty-claim-is-the-record-of-a-call-its-work-is-a-work-item-the-period-is-the-jobs-and-a-claim-outside-it-is-said-never-refused.md)** —
  a warranty claim is the record of a call and its work is a Work item
  linked to the CLAIM (so the punch list stays the punch list and Work says
  which call); where it stands is derived from the decision and the item;
  the period is the job's — months from substantial completion, the expiry
  derived; the cost is read from the job cost report under the claim's code;
  a claim outside the period is said, never refused. Not covered closes the
  work item: going to look was the work.
- **[ADR 0075](../decisions/0075-a-change-order-and-an-order-print-from-their-rows-the-change-order-at-its-price-with-the-contract-sum-either-side-the-order-with-its-changes-beneath-it.md)** —
  the change order prints at its PRICE with the contract sum before and
  after it, read as a ladder through the approved changes; the order prints
  as placed with its changes beneath it and only the approved ones in the
  total; both from the live rows, which are locked once they stand; one
  layout, two pure models. The money prints in the house style, no symbol.
- **[ADR 0074](../decisions/0074-a-measurement-is-a-markup-with-a-quantity-the-scale-is-the-sheets-and-a-takeoff-is-a-quantity-pushed-onto-an-estimate-line.md)** —
  the scale is the sheet's, as page points per unit with the page's size
  beside it; a measurement is a markup with points whose quantity is
  derived every time; a push STATES an estimate line's quantity and never
  adds; a re-read keeps a sheet's row. A CHECK that evaluates to NULL
  passes — `coalesce` the nullable columns it compares.
- **[ADR 0073](../decisions/0073-a-markup-is-a-vector-on-a-sheets-issue-and-a-pin-is-a-punch-item-where-it-sits.md)** —
  a markup is a vector in fractions of the page over one issue of a sheet,
  the PDF untouched; a pin is a punch item where it sits, the ordinary Work
  item with a key that SETS NULL in the column-list form; a reissue starts
  clean and nothing is carried forward for anybody.
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
- **A FINISHED walk can be picked back up, and only by a person** —
  [ADR 0102](../decisions/0102-a-person-picks-a-finished-walk-back-up-and-a-phase-lands-in-the-item-it-already-made.md).
  `goToStep` and `reopenQuestion` are the two doors a CLICK reaches and they
  put a `finished` interview back to `running`; `claimTurn`, `recordAnswers`
  and `moveToStep` still refuse a closed walk, and an `abandoned` one is never
  resumed. There is no revisiting mode and ADR 0099 turned one down: the walk
  is running because somebody is walking it, and it closes itself again by the
  same rule as the first time.
- **A walk ends when nothing is OUTSTANDING, never when the list runs out.**
  `onwardStep`, not `nextStep`: forwards stopped meaning finished the day the
  rail let somebody jump about, and EST-6 on dev closed over eight phases
  nobody had been asked about because the one it finished was last on the
  list. Null from `onwardStep` is the only thing that closes a walk.
- **A phase that lands twice lands in the SAME item.** `applyProposal` finds
  it through the `estimate_line_id` the proposed row kept — never through the
  name, because two items may share one and a person may rename the walk's —
  and replaces the lines it put there. Appending made a second `Landscaping`
  in the total, and the linking pass then matched the wrong one by name, so
  the new rows were never linked and the reckoning could not see the money.
- **`Work on this` is offered only where a phase has a question outstanding.**
  `currentStep` honours a bookmark only while its step has work (ADR 0099
  turned down honouring it regardless), so on a covered phase the button
  would send the walk somewhere else. **Ask again** is the door into a
  covered phase, and on a finished walk it is the only one.
- **Read the constraint from `err.cause`, never `err.message`.** Under drizzle's
  wrapper the message is the SQL. `violatedUniqueIndex` in `src/lib/db-errors.ts`;
  four translations in this pack were dead for three slices before a test noticed.

## Open items

- **A bond is a record, not a document, and the line is one surety's.**
  Printing a bond, attaching the surety's paper to the row (Documents'
  attachments are the seam), capacity as a percentage of working capital,
  the surety's rate schedule and consent of surety are not built (ADR
  0078). A bond the business requires FROM a subcontractor is the party
  document slice's job, which already lists a bond as a kind.
- **A back-charge is one order's, and settles in one go.** Telling the
  subcontractor by Mail, charging one against a supplier's purchase order,
  splitting one across two applications and disputing one as a state of its
  own are not built (ADR 0077): a disputed back-charge is dropped with the
  reason and charged again if it survives the argument.
- **A warranty is one period per job.** The 1-2-10 tiers some builders
  carry, a per-contract warranty and telling the owner by Mail are not
  built; a manufacturer's warranty on a product is a document in the
  cabinet. ~~The back-charge to the responsible trade~~ **closed
  2026-09-16 (ADR 0077)**: a claim names the trade and the cost comes off
  that trade's next application.
- **A sheet is a page to look at, draw on and measure (9a–9c; ADRs 0072–0074).**
  ~~Markups~~ shipped as 9b, ~~the takeoff~~ as 9c. Still each a slice of its
  own: comparing two issues of a sheet by overlay, reading the cover sheet's
  index to fill titles, a per-job Drawings folder in the cabinet; from the
  markups, moving or resizing a shape after the fact (today: rub it out and
  draw again), a freehand pen, carrying markups onto a reissue by choice, a
  markup on a photo, burning markups into a PDF to send, telling the pinned
  trade (the digest and Mail are the seams); and from the takeoff, a scale
  read from the PDF's own metadata, ~~an opening deducted from an area, a
  volume~~, ~~a running total across sheets~~ and ~~the reverse link from an
  estimate line back to the sheets that fed it~~ — **all built 2026-09-22
  (ADRs 0109 and 0110): a line is measured from where it is priced, what
  stands behind it follows it across sheets, and a trace yields its net
  area, the run around it, a wall, a roof and a volume, each able to stand
  behind a line of its own** — and a quantity converted into a line's own
  unit (sf → sy, m → lf — today a line priced in another unit is refused by
  name, `unitAccepts`). Still open there: clipping an opening to its area
  (today the net is the plain difference), openings on a length, the walk
  opening a sheet for a phase's line, and the DROP of
  `estimate_line_id` / `pushed_quantity_thousandths` off the markups once
  ADR 0110 has deployed. A scanned set's
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
- **The proposal prints in both formats; it is not SENT, and the client cannot
  accept it on a screen of their own (10b, ADR 0070).** Mail's seam is there
  for the sending when somebody asks, and since E5b there are bytes to attach:
  `proposalPdf` returns them for either format. **The client link WITH an
  Accept button SHIPPED as E5c** (ADR 0085): the client reads the proposal at
  `/proposal/<token>` and accepts by typing their name. Today the link is
  copied to the clipboard and pasted into the builder's own message.
- ~~**THE BUILDER IS NOT TOLD WHEN A CLIENT ACCEPTS.**~~ — **closed
  2026-09-17**: `jobs-site` is the pack's attention source, so an acceptance
  reaches What needs you and the morning email, owners only. Two more
  obligations came with it (overdue selections, a subcontractor with no cover),
  and three were left out for failing the self-clearing test — see the build
  log entry. **Still open from the same idea:** a lien waiver outstanding, a
  draft pay application nobody issued (money not billed, and the strongest
  owner line the pack has left), and a warranty claim past its period. Each is
  one read plus one pure helper now that the seam is in.
- **The builder's own share block has never been clicked.** `The client's link`
  in the estimate editor — Make a link, Copy, Revoke — typechecks, lints and
  builds, and all four ops behind it were driven by script, but the buttons
  need a Clerk session the browser pane has not had since 2026-09-09. The
  CLIENT's half is fully driven, which is the half that carries the risk.
- ~~**The document is letter-width on a phone.**~~ — **closed 2026-09-18**: on
  a narrow screen the sheet reflows and the paper is untouched. See the build
  log entry; the answer was NOT the PDF-reader scaling this note guessed at.
- **The brochure's PDF needs one variable set before it works in production.**
  `CHROMIUM_PACK_URL`, pointing at a hosted `chromium-v*-pack.x64.tar`
  ([the runbook](../runbooks/printing-html-documents.md)). Unset, a brochure's
  PDF answers 503 and says so; the letter needs no browser and is unaffected.
  **The serverless path is unverified until that is done** — E5b was driven
  against a real Chrome on a laptop, which proves the document and the press
  but not the function.
- **The estimate program: E1, E2, E3a, E3b, E3c, E4a, E5a, E5b, E5c and E6 are
  all shipped** — see [the plan](#the-estimate-program-open-started-2026-09-16),
  each with the founder's decision behind it. ~~keyboard grid navigation
  (E3c)~~, ~~the price memory (E4a)~~ and ~~assemblies (E6)~~ all closed
  2026-09-18; this paragraph said otherwise until 2026-09-19. Still open:
  **E4b**, estimated-versus-actual per cost code, **deliberately blocked** until
  a job closes with real spend — the dev tenant has three budget lines across
  two jobs and no completed job, so the screen would render empty and could
  only be "verified" against invented accounting; and **E7** — bid alternates,
  copying an estimate, and the tenant unit cost book. The whole of row 10 — the
  estimate, its proposal, both formats, the PDF and the client link — is done.
- **THE ESTIMATE INTERVIEW (X, ADR 0098) IS ONE SLICE IN.** X1 is the outline —
  the steps and questions a walk is made of, as the tenant's own data behind a
  two-flag gate. What is NOT built is the rest of it: **the interview** that
  reads an outline and holds the conversation; **bid requests** to
  subcontractors, which the *Bidding it out* answer implies and which nothing
  in the pack does today (a commitment is the subcontract after you have bought
  it, and SES production access is still denied, so a request would reach only
  a verified address); **quantities from a Revit schedule** — **built
  2026-09-21 as X14 (ADR 0106)**: a schedule exported from the model becomes
  measurements and rooms; the join from type names to assemblies stays open
  until there is a library to join against; and **a takeoff opened inline**
  from a question. Nothing in X1 touches the estimate editor, which is the claim of a
  layer and what makes the pilot safe.
- ~~**THE ESTIMATE SCREEN MAKES THE PAGE SCROLL SIDEWAYS.**~~ — **closed
  2026-09-16 (E3a, ADR 0081)**, and the cause was not the table's width:
  the row buttons' `sr-only` labels are `position: absolute`, so with no
  positioned ancestor their containing block is the PAGE and they stretch
  the document from past 1,200px while `overflow-x-auto` — not their
  containing block — never clips them. `relative` on the wrapper; measured
  1220 → 944. **Eight other screens have `overflow-x-auto` and `sr-only` in
  one subtree** (the invoice, bill and journal editors among them) and are
  their own task.
- **Hiding a line is about not itemising, not concealment (E2, ADR 0080).** A
  hidden line's money still lands in its cost code's sum, so the `codes`
  presentation can print an amount that is only a hidden line's. A business
  that wants the money untraceable prices the item by hand. Hiding a whole
  item, a client-facing name on the cost code itself (ADR 0079 rejected
  that: it is a rename of `09 30 00` for every job the business will ever
  run) and a client-facing unit are not built, the last because `cy` is `cy`
  to everybody.
- **An estimate is lines and items, and nothing more yet (slice 10, ADR 0069;
  E1, ADR 0079).**
  ~~Assemblies — a named bundle of lines dropped in as one ("interior door,
  prehung": slab, hardware, casing, labour)~~ **now E6, and their shape is
  settled: an assembly is a saved item.** A tenant-level unit cost book
  that fills a line's cost from the last time it was priced ~~and a takeoff
  from the drawings~~ are each a real thing the trade has and each a slice
  of its own. **Items are one level deep** on purpose, and a loose line
  always sorts after the items rather than between them — a builder who
  wants "general conditions" printed first makes it an item. **The takeoff shipped as drawings 9c, 2026-09-16 (ADR 0074).** ~~The proposal as a printed document~~ shipped as 10b. An estimate is not
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
  value is. ~~Still open from it: **a back-charge**~~ — **closed 2026-09-16
  (ADR 0077)**: money the business spent that was the subcontractor's is a
  record on the order, not a change to the scope, and rides an application
  as its own negative line. ~~And **a change
  order does not print**~~ — **closed 2026-09-16 (ADR 0075)**: the order prints
  as placed with its changes beneath it, and the client's change order
  prints at its price; the subcontractor's application still does not,
  being theirs.
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
