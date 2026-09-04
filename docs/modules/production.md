# Production

> Inputs consumed + labour → outputs produced, at a **yield**, with cost rolled
> through. The pack that joins `livestock` to `inventory`: a pen goes in, boxes
> of meat come out, and the money follows them. The fifth capability pack
> (Layer 2a) to ship.
> Status: `available` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

**Read [inventory.md](inventory.md) first** if you are touching anything about
quantities or cost — this pack owns neither. Read
[livestock.md](livestock.md) before touching the withdrawal guard. The design
this is sliced from is in
[homestead-farm.md → Category design — Production](homestead-farm.md#category-design--production-brainstormed-2026-08-13);
this dossier is the build record.

## Slice order

| # | Slice | State |
| --- | --- | --- |
| **0** | **Run model + outputs landing in `inventory`** — the spine | **shipped 2026-08-20** |
| **1a** | **The carcass stage** — the kill sheet, dressing percentage vs cutting yield, **and condemnations** | **shipped 2026-08-23** |
| **1b** | **The processor directory** — who does the work you do not, what they take, what they charge, how they are inspected, what you think of them | **shipped 2026-08-23** |
| **1c** | **Booking a date** — holding the scarce resource, deposits, and the link from a booking to the run it becomes | **shipped 2026-08-23** |
| **1d** | **The processing path on the run**, eligibility stamped onto the meat, and the on-farm exemption counted | **shipped 2026-08-23** |
| **1e** | **Paperwork, extracted** — a kill sheet AND a processor's price list, as photograph or PDF → AI extraction → **a human confirms** → the rows | **shipped 2026-08-23** |
| **2a** | **The itemised price list** — what a plant charges, one row per priced thing, each carrying the UNIT that says what the figure means | **shipped 2026-08-23** |
| **2b** | **The cut sheet as an order** — pick the items for a batch, print it for the plant | **shipped 2026-08-23** |
| **2c** | **The processing fee reaches inventory cost**, per plant — flat per animal plus per pound, accrued at completion | **shipped 2026-08-23** |
| **2e** | **One row per bird** — the animal in the column not the label, grouped, filtered, and editable in bulk | **shipped 2026-08-23** |
| **2f** | **The front door, the whole-bird remainder, and the app doing its own lookup** | **shipped 2026-08-23** |
| **2d** | **The plant's BILL, matched to the run** — the accrual clears and the variance becomes a number | **shipped 2026-08-24** |
| 2 | Recipes + bake batches + results feedback | |
| 3 | Cost roll refinements: byproducts at NRV, costed internal transfers, labour | |
| 4 | Label generation, including a processor's own-label capability | |
| 5 | Processor comparison, throughput analysis | needs history |

Commitments (pre-sold halves, pre-ordered fresh birds) are shared with `retail`
and slice with it. A pre-sold half is never inventory and is never an output
lot.

**Slice 1 split in two when it came to be built**, agreed 2026-08-23, and the
reason is an ordering constraint rather than a preference: the extraction half of
kill-sheet capture — photograph the plant's paperwork, let AI read it, have a
person confirm it — has to extract INTO something, and until 1a there was no
carcass row to put a hanging weight in. The record first, then the door onto it.
That is the same shape `land` found when 2a became three slices.

**1e NOW CARRIES BOTH EXTRACTIONS, and merging them is the point.** The kill
sheet was in 1d and the price list was on its own; they are the same path —
document in, AI reads it, **a person confirms**, then it writes — differing only
in which table they land in (`production_run_carcasses` and
`production_processor_handles`). Building that path once with two consumers is
cheaper than building it twice, and it keeps the confirm step from being
re-litigated on the second one.

**The price-list half was asked for on 2026-08-23 and is recorded so it is not
lost.**
A processor's price list arrives as a sheet of paper or a PDF once a year, and
retyping it into `production_processor_handles` is exactly the transcription
chore the design's *compute-and-commit* pattern exists for: **AI extracts, a
human confirms, then it writes.** It is a port of what `accounting` already does
with bills and `documents` with text, and it must not be a port of anything that
writes without the confirm step — these rows are the terms of a commercial
relationship, and a fee silently changed by an extraction is worse than one
nobody typed. It follows 1d rather than leading it because 1d builds the
document → extraction → confirm path for the kill sheet, and this is the second
consumer of it, not the first.

**Slice 1 split again on 2026-08-23**, and the renumbering is worth explaining
because it moved work forward rather than adding it. The design calls slaughter
dates *"the scarce resource"*, says booking them is *"a first-class feature, not
a date column on an animal"*, and calls it *"the loudest unmet need in small
livestock production"* — and the roadmap had processors appearing only at slice
5, as a **report**. Nothing created the processor record; nothing held a date.
1b is the directory that had to exist first, and 1c is the dates. What was 1b
becomes 1d, unchanged.

## Build log

### 2026-09-03 — One answer for the cut sheet (`claude/one-answer-for-the-cut-sheet`)

Two mismatches, in opposite directions, both closed.

**A cut sheet is a chore, on all three screens that start one.**
`StartSheetDialog` was `isOwner` on `/orders` and `AddOrderDialog` was `isOwner`
on `/bookings`, while the identical dialog on a run's own page was ungated and
`createOrder` has been `member`-level since it was written
(`order-ops.ts:246`). Adding, counting, editing, removing and printing a sheet's
lines are all `member` too, and the sheet's own detail page gates none of them —
so a staff member could rewrite every line of a sheet and delete it, and could
not start one. Both list screens now ask `allowsWrite(ctx.role, "member")`.
Booking the date stays the owner's: that is a commitment to a plant.

**Reading a kill sheet off a photo is the owner's, and now the dialog says so.**
`readKillSheetAction` calls `requireWrite(ctx, "owner")` and
`ReadKillSheetDialog` was ungated, so a staff member picked a file, waited for
two pages of handwriting to be read, and was refused at the end of it. **Settled
2026-09-03 by gating the dialog rather than opening the action**, on cost: the
read spends money per press and nothing rate-limits it — two `change` events once
held a run's dialog for six minutes, which is still an open item below — and
`ReadPriceListDialog`, the pack's other reader with the same cost and the same
shape, has been `isOwner` on the processors page all along. `CarcassDialog`
beside it stays `member`, so transcribing the sheet by hand is open to whoever
is holding it.

Guides swept in the same PR. `orders.md` carried the mismatch as a written
apology — *"That is us being inconsistent, not a rule"* — and no longer needs
one; `run.md` and `overview.md` now say the photo reader is the owner's and why.

### 2026-09-03 — Eight tenant guides, and what writing them found (`claude/production-guides`)

Guides in `docs/help/production/` for all seven screens plus an overview:
`overview` (0), `runs` (10), `run` (20), `orders` (30), `order` (40),
`bookings` (50), `billing` (60), `processors` (70), numbered in the pack's own
strip order. Four agents read the hub and the run page, the two order screens,
the three admin screens and the action layer across six `"use server"` files.
**This completes the packs run**: assets, inventory, livestock, retail and
production, 29 guides over five PRs.

**The vocabulary result is the best of the five, and the worst.** `processor` is
cleanly resolved everywhere on every screen — the only declared word in any pack
that is never hardcoded, and the guides use `{{processor}}` freely because of it.
The other three are not: `productionRun` is hardcoded in about fifteen strings
including the panel label `Held by this run`; `killSheet` is resolved for its own
panel and then hardcoded inside the four `STAGE_REFUSALS` that render directly
beneath it; `cutSheet` is hardcoded in two places.

**`cutSheet`'s fallback is `Order`, and that is a problem of its own.** It
produces `Start a order` and `A order for X` (`order-controls:172/177/337/343`),
it collides with the app's own `orders` route and entity, and on the homestead
profile it resolves to `Cut sheet`, putting two panels ending in "sheet" on one
page. The guides lead with what it IS — the instruction you print and hand over,
not a customer order — because a manual that confused the two would be worse than
none.

**`updateOrderAction` is dead, and it is the biggest hole in the pack.** No caller
anywhere in `src/`, so **a cut sheet's head count can never be edited** — and that
count is exactly what the price-band lookup is checked against. The app's own copy
tells the reader to put the count on the sheet. `updateRunOutputAction` is dead
too, so an output cannot be corrected before it lands.

**Two permission mismatches, in opposite directions — both closed 2026-09-03.**
Starting a cut sheet is `member`-level on all three screens that offer it now,
and `ReadKillSheetDialog` is behind `isOwner`, matching the action it calls and
matching `ReadPriceListDialog`. See the build log for why the reader moved rather
than the action.

**The vendor prerequisite is confirmed and has no message.**
`matchableProcessorBillLines` joins processors to vendors through the party and
returns `[]` when none match, so a plant that is not a vendor is **silently
absent** from the billing screen. The only surfacing is section 2's empty state,
which vanishes as soon as any other plant has a draft bill. And the dossier
already records that adding the vendor the ordinary way mints a second party and
makes it worse. The `billing` guide states both plainly and tells the reader to
ask rather than add them again.

**Flattening is worse here than in any sibling pack.** Eleven distinct "gone"
sentences — `that run no longer exists`, `that sheet is gone`, `that price is
gone`, `that bill line is gone` and seven more — all collapse to `That no longer
exists.` at `action-errors.ts:22`.

**Other findings.**

- **No unique index on a run `code`**, though `booking-ops.ts:287` claims
  `startRun` refuses duplicates.
- **`completedOn < startedOn` is CHECK-only**, so it surfaces as `Something went
  wrong saving that.`
- **`attachOrdersToRun` has no `requireWrite`.**
- **`removeBooking` deletes a booking `updateBooking` refuses to cancel.**
- **The `Not in use` badge on a processor has no writer**, and a processor can
  never be removed.
- **The bookings `Standing` column can never print `missed`, `today`, `soon` or
  `upcoming`.**
- **`{money} more on its own line` and the billing `Difference` column both drop
  the sign**, so an under-charge reads as an over-charge. The guide tells readers
  to compare the two figures instead.
- **Booking `reference`, `notes` and `depositPaidOn` are write-only.**
- **Four one-click ghost `Remove` buttons with no confirmation.**
- **`?status=` and `listKindsInUse` are unreachable** — nothing emits the param.
- **A stale comment claims the cut-sheet card is print-visible**; it has no
  `print:` class and printing lives on the orders route.
- **`Cost in` disagrees between the hub and the run page once a processing fee
  exists** (`ops:1586` against `ops:1793`).
- **The kill-sheet reader's Head, Live and Hanging boxes are untyped** and coerce
  a bad head count to 1.

**What the guides lead with, because the pack earns it:** a ratio is measured or
it is refused. Ten distinct refusal sentences across yield, dressing percentage
and cutting yield, each naming what is missing, and the guides quote them rather
than paraphrase — a reader who sees a dash should be able to find the sentence.

**Not clicked through live:** the pane's Clerk session is expired.

### 2026-09-01 — The plant's bill had the same hole, one account along (`claude/a-match-survives-an-edit`)

`production_run_bill_allocations` cascades off a bill line's id exactly as
`bill_line_stock_allocations` does, so the whole-replace in `updateBillDraft`
unmatched every run on a bill the moment somebody saved a memo — while the line
came back still coded to `2060` and still carrying what was accrued. The plant's
bill cleared the accrual and the run went back on `openProcessingAccruals` to be
billed again. The fix is in accounting core; see [accounting.md](accounting.md).

**`2060` WAS NOT EVEN ON THE UNPICKABLE LIST.** `isCodableAccount` excluded GRNI
and Inventory and stopped there, so a person could hand-code a bill line to
Services Received Not Invoiced from the ordinary picker and clear an accrual no
run ever made — the same state, reachable without a match at all. It is on the
list now. One test in `inventory-posting`, where this pack's matching tests live
because the production test tenant keeps no books. **No migration.**

### 2026-08-31 — The boxes belong to the run, not to the item (`claude/the-cost-side`)

Folded into the same PR as the entry below, after an adversarial review of it.
Read [enterprises.md](enterprises.md) for the worked numbers.

**`completeRun` LANDED ITS OUTPUTS WITHOUT SAYING WHOSE THEY WERE.**
`receiveStock({newLotCode})` with no enterprise means `createLot` inherits the
output ITEM's tag — right for a delivery, wrong for boxes made out of specific
batches. The inputs had already been debited to the consumption account under
the INPUT batch's line of business, so the two halves of one transformation
landed under different ones and **5000 grouped by enterprise did not net to
zero**: a Broilers pen killed into an untagged meat item read Broilers +$4,000
against Unassigned −$4,235.

**THE RUN ALREADY KNEW; IT JUST WAS NOT ASKED TWICE.** `enterpriseForRun` was
computed inline for the fee accrual only. It is now `runEnterpriseId`, hoisted
above the output loop and spent on both — so the fee and the boxes cannot
disagree, which was the other half of the same defect.

**Nothing else can tag a production output batch**, which is why the default
mattered so much: it is minted inside `completeRun` and there is no form
anywhere between a person and it.

A mixed run derives null and its boxes are Unassigned while its inputs keep
their own tags — the reserved allocation question again, and the run form's
override is how somebody says otherwise.

### 2026-08-30 — The plant's fee knows which line of business it is (`claude/the-cost-side`)

The pack's half of [enterprises](enterprises.md) slice 3. No migration, and
nothing about what a run does changed — only where its fee lands on a P&L
grouped by enterprise.

**THE RUN'S OWN COLUMN IS THE OVERRIDE, WHICH IS WHAT IT ALREADY SAID IT WAS.**
`RunInput.enterpriseId` shipped in slice 2 with the rule written on it — *"Set it
when a run mixes inputs from more than one, which is the case nothing else can
work out; otherwise the input lots already know and this stays null"* — and
nothing had ever read it. `enterpriseForRun` folds the input batches and the
column settles a mixed run, so **a farm that tagged its pen months ago gets its
kill-day fee under Broilers without ever opening the run form.** Reading the
column as the primary answer instead would have un-tagged every run nobody filled
the field in on, which today is all of them.

**A MIXED RUN DERIVES NULL AND ITS FEE IS UNASSIGNED.** Two enterprises' animals
through one kill day cannot have the plant's fee attributed to one of them, and
splitting it pro rata is an allocation that wants its own decision rather than a
helper inventing one. It is the mixed market stall's answer wearing different
clothes.

**UNTAGGED INPUTS ARE SKIPPED, NOT COUNTED AS A DISAGREEMENT.** A run that
consumed tagged broilers and an untagged pallet of ice is still a Broilers run;
treating the ice as a second opinion would silently un-tag it.

**THE OVERRIDE HAD NO UI AT ALL, and that is why no run anywhere is tagged.**
Slice 2 added the column and left it unreachable. `StartRunForm` gets the shared
`EnterprisePicker` — with a hint saying it is normally left alone, because a
field most people should skip has to say so or it becomes a question everybody
answers wrongly. `listRunInputs` gains `lotEnterpriseId` on a join it was
already making.

### 2026-08-26 — The pack puts on the design system (`claude/two-packs-follow-the-pattern`)

No behaviour changed. PR 3 of the five bringing the packs onto the primitive
layer, done in the shape [inventory.md](inventory.md) set a day earlier;
[design-system.md](design-system.md) holds the sweep and what it found.

**FOUR OUTLINE BUTTONS OUT OF THE HEADER**, leaving `StartRunForm` as the only
thing in `actions` — because it is the only verb. Booked dates, the sheet list,
the reconciliation and the directory are places, and they are now
`components/production-nav.tsx`.

**THE NAV TAKES ITS LABELS AS PROPS, WHICH `AccountingNav` DOES NOT NEED TO.**
Two of the five name things the tenant renames — the homestead profile calls a
processor a *Butcher* — so a module-level constant would have hardcoded one
tenant's vocabulary into navigation. They arrive already through `labelFor`.
**And the strip lowercases the sheet word itself** rather than trusting six call
sites to remember: the first attempt passed `.toLowerCase()` at the call site,
one of the two edits silently did not match after prettier reflowed the line,
and the tab shipped reading *Every Cut sheet* until it was read out of the DOM.

**`sheetWord` ON THE RUN PAGE IS THE KILL SHEET, NOT THE CUT SHEET**, and
passing it to the nav would have put the wrong noun in the navigation on that
one page. `[id]/page.tsx` declares both; the nav gets `cutSheetWord`. Worth
knowing before the next thing takes a "sheet word" from this file.

**Eight cards became `Panel`, three tables `DataTable`, and the exemption
counter a `StatCard`** — its label and value both take a node, so the standing
badge stays on the label line and the *of 1000* stays small beside the figure.
Two more back-arrows were standing in as empty-state glyphs (*Nothing has gone
in yet*, *Nothing has come out yet*); they are a package and a box now.

**ONE HAND-ROLLED BACK-LINK SURVIVES THE SWEEP, on `orders/[id]`**, and it is
the only one in either pack that goes somewhere a strip cannot: a sheet attached
to a run belongs to *that* run, and no tab can name a particular one. Its other
half — pointing at "Every {sheet}" when there was no run — is dropped, because
that IS a tab now.

**A TABLE INSIDE A `Panel` DOES NOT GET `DataTable`'s ROW STYLING**, and the
kill-sheet card is where that bites. Its body is genuinely mixed — the tally,
the condemnation causes, then the carcass list — so it stays a `Panel`, and the
table in it keeps `--border` hairlines rather than `--divider`. `DataTable` is
"panel + table selectors" with no way to ask for the second without the first.
Recorded as an open item rather than solved here.

Driven on Hilltop Farm: every page in the pack, strip active on the right tab,
read out of the DOM rather than eyeballed.

### 2026-08-25 — The weight finally reaches the shelf (`claude/what-a-batch-weighs`)

One argument, and the reason it is worth a build-log entry is what it says about
this pack rather than what it changes in it.

**`production_run_outputs` HAS RECORDED THE PAIR SINCE IT WAS WRITTEN** —
`quantity` and `weight_lb`, *"38 packages, 47.5 lb"*, with the column's own
comment explaining that the weight is *"required in practice for anything
counted, because without it there is no yield to state."* `completeRun` then
called `receiveStock` with the count and **dropped the weight on the floor**,
because `inventory` had nowhere to put it. It does now
([ADR 0016](../decisions/0016-a-catch-weight-item-is-stocked-in-packages.md)),
so the boxes land knowing what they weigh and nobody types a number twice.

**`output.weightLb`, NOT `outputWeightLb(output, item)`.** The derived form falls
back to converting the quantity for a mass-stocked item — a weight `inventory`
works out for itself — and passing it would put a redundant second copy of the
quantity in the ledger. The raw column is the measurement; the derived one is for
this pack's own yield arithmetic.

A test drives the loop end to end: a run output with a weight completes, and the
resulting stock's average package weight reads 1.25 lb.

**STILL UNBUILT AND NOW CHEAP:** `RunMeasures` has four fields and
`MEASURED_BY.package` is null, with the note *"However many packages came back —
somebody has to count them."* Once outputs are stocked in `pkg` nobody has to —
the count IS `output.quantity` — so a plant's per-package cutting line could
total itself instead of being reported as unpriced. Deliberately not in this
change: it is a fee-engine decision and belongs with the fee engine.

**Slices 0 to 1d are in [production-build-log.md](production-build-log.md)**,
swept there on 2026-08-23 under the dossier-length rule in `AGENTS.md` — this
file had reached 1,658 lines and the log was 60% of it. Nothing was superseded
by the move: the two live weights, the condemnation adjustment, the withdrawal
guard, the booking model and the migration that never ran are all argued there,
and that is the file to read before changing any of them.

### 2026-08-24 — Slice 2d: the bill that clears the accrual (`claude/the-bill-that-clears-the-accrual`)

**`2060` ONLY EVER GREW.** 2c posted `Dr consumption / Cr 2060 Services Received
Not Invoiced` at completion and said plainly that nothing would ever take it off
again — calling the balance a feature in the meantime, because a non-zero 2060
per plant IS the list of processing nobody has invoiced you for. It stops being a
feature the moment a bill arrives. This is the third line of that entry:

```
accrual        Dr 5000 22370   Cr 2060 22370
outputs land   Dr 1300 22370   Cr 5000 22370
bill matched   Dr 2060 22370   Dr 5000 1130   Cr AP 23500   ← built
               ─────────────────────────────────────────────
               1300 = 22370 · 2060 = 0 · 5000 = 1130 · AP = 23500
```

**IT IS `bill_line_stock_allocations` ONE ACCOUNT ALONG**, and the shape is
copied from `inventory/ledger-ops.ts` rather than reinvented: upsert the
allocations, **rebuild the line from ALL of them** rather than from this call,
split the invoice so the liability clears EXACTLY, and put the rest on a sibling
line. Every one of those was learned there by a bug, and the comments in that
file say which.

**WHAT IS OPEN IS READ FROM THE LEDGER, NOT FROM `processing_fee_cents`.** The
fee column is what somebody typed; the accrual entry is what actually posted, and
they differ for two ordinary reasons — a tenant with stock posting off accrues
nothing, and a waived fee accrues nothing. Building the list off the column would
offer runs with nothing to settle and then fail at match time.

**THE AMOUNT IS NOT A FIELD.** A processing day is invoiced as a whole; there is
no natural unit to settle part of one with, the way a delivery has a quantity. So
ticking a run settles its whole outstanding accrual, and whatever the invoice
charges beyond that is the variance.

── WHERE THE DIFFERENCE GOES, WHICH WAS THE DECISION ────────────────────────

**THE FOUNDER CHOSE: P&L NOW, THE MEAT SEPARATELY** (2026-08-24). Matching books
the difference to the profit and loss and the batch keeps what it landed with.
Moving the batch's cost to what was actually billed is a **second, deliberate
act** — `correctRunCost` — because by the time a plant invoices the meat is
frequently sold, and restating a batch's value every time a bill is $11 out, with
nobody asked, is not a decision software should make.

**IT IS `inventory`'s OWN SPLIT, ARRIVING HERE.** ADR 0012 §A.5 corrects the
books when an invoice disagrees with a ticket; §A.4 corrects the stock record
when there is no invoice to disagree with. A delivery that gets both ends up with
the right value, the right liability and no net variance — and so does a kill day.

**THE CORRECTION IS IDEMPOTENT THROUGH `corrected_cents`**, apportioned across
the output batches by what each landed carrying, and `adjustLotCost` does the
hard part: the on-hand share raises the batch's carrying value and the
already-sold share is expensed, because capitalising it would put an asset back
on the balance sheet for meat that has been eaten.

**AND UNPICKING REFUSES ONCE THE COST HAS MOVED.** It would leave the accrual
unsettled while the meat carries a figure that came from the very match being
undone — two records disagreeing about one bill. The way back is another
correction, which is an event rather than an erasure.

**THE SIBLING LINE IS LEFT UNCODED ON PURPOSE.** A processing overcharge may be a
rate rise, a service nobody asked for, or a mistake to query, and this pack must
not decide which. `approveBill` refusing an uncoded line is what forces somebody
to say — which is the ordinary path for any bill line.

**A BILL CANNOT SETTLE ANOTHER COMPANY'S PROCESSING**, and the picker does not
offer it rather than offering and then refusing. The accrual posts in the books
the run's stock belonged to; a bill clears in its own; if they differ neither
2060 ever nets. `Test` keeps two companies, which is where that class of defect
keeps being found.

── THE SCREEN ───────────────────────────────────────────────────────────────

`/dashboard/m/production/billing`, **both halves on one page** for the reason the
GRNI screen gives: *processing with no invoice* and *a plant's bill with no
processing* are the same question from opposite ends, and a reconciliation split
across two screens is one nobody finishes. **Not on the inventory matching page**
— 2c kept this out of 2050 so the stock reconciliation stays explainable by its
own workings, and one screen would re-mix what that decision separated.

The third section is an **offer, not an obligation**: it appears only when a bill
disagreed with an accrual, and a farm that never presses it is not wrong.

── DRIVEN, AND WHAT IT FOUND ────────────────────────────────────────────────

**THE WHOLE LOOP RUN ON THE DEV BRANCH'S `Hilltop Farm`:** matched a $235.00 bill
to a run that had put aside $223.70, moved the meat's cost by the $11.30, and
approved the bill — **2060 went from −83,110 to −60,740, exactly the 22,370 that
was accrued.** The cost adjustment is on the output batch as `processing_bill`
and `corrected_cents` records it, so a second press moves nothing.

Four defects, and the first is the one that matters:

- **`toResult` SWALLOWED A PERFECTLY GOOD SENTENCE.** Slice 2d added two error
  codes to `ProductionError` and did not add them to the switch in
  `action-errors.ts`, so *"nothing came out of this one that is on a shelf, so
  there is no batch to move a cost onto"* reached the screen as **"Something went
  wrong saving that."** The switch is now **exhaustive by construction** — an
  unhandled code fails to compile, the same trick `MEASURED_BY` uses in
  `core/fee.ts` — so this cannot recur.
- **"anything the plant charged"** on a screen that says *butcher* everywhere
  else. Eighth slice running.
- **"Difference $235.00" in red before anything was ticked**, which reads as the
  plant overcharging by the whole invoice. There is no comparison to make until
  something is selected.
- **A matched row read `$223.70` on a `$235.00` invoice** and looked like the
  bill had shrunk. Matching rewrites the line down to what was accrued and puts
  the rest on its own line, so the row now says so.
- **AND ONE COPY DEFECT THE LEDGER ITSELF EXPOSED**: the page said the account
  clears "when their bill is matched". It does not — matching points the line,
  **approving posts it**. Reading the balance after matching two bills is what
  caught it, and saying only the first half would have been this screen making
  the same mistake the GRNI card made: reporting the working and calling it the
  answer.

Migrations `0204` + `0205` (RLS). 17 new tests — 7 ledger claims in
`inventory-posting.test.ts` where a tenant keeps books, 5 correction claims in
`production-ops.test.ts`, 5 in the isolation suite.

### 2026-08-23 — Slice 2f: the app does the lookup (`claude/the-app-does-the-lookup`)

**FOUR THINGS, AND THE FOURTH IS THE ONE THAT CHANGES THE MODEL.**

**THE CUT SHEET HAD NO FRONT DOOR, AND THAT WAS THE BUG.** The founder could not
find one. Two slices built it, printed it and priced it, and the only ways in
were a row on `Booked dates` and a card inside an open run — so a sheet was
reachable only by somebody who already knew which date or which run it hung off,
which is the opposite of how anybody looks for a piece of paper. It has its own
page now, beside `Booked dates`: every sheet, with its plant, its animal, the day
it is for and whether it has been printed. **Not a card on the Production landing
page**, which is the run list and its yield column; a sheet is not a run — it
exists before one and frequently without one.

**STARTING ONE ASKS WHICH DAY, RATHER THAN MAKING YOU NAVIGATE TO IT.** The plant
is NOT a field on that form: it comes with whatever the sheet is attached to,
because a sheet quotes the rates of the place it is going to, and offering the
two independently would let somebody pair a date at Miller's with Valley
Poultry's prices — which `addOrderLine` refuses later, at the point where it is a
confusing error rather than an impossible choice.

**`listOrders` AND `getOrder` NOW CARRY THE DAY**, which is why the list could
not have been written before: every screen wanting to list sheets had to join for
the booking's date or the run's, and 2c's printed header was doing exactly that
join by hand.

── THE WHOLE-BIRD REMAINDER ─────────────────────────────────────────────────

**TEN OF THE HUNDRED GO BACK WHOLE AND NOTHING RECONCILED THAT.** Ask for 90
quartered out of 100 and no screen mentioned the other 10; ask for 130 and
nothing objected. `core/portions.ts` derives it, refuses in three named ways, and
reads like `tallyCarcasses` because it is the same shape one table along.

**IT PRINTS, AND IT IS THE ONLY THING BESIDES THE LINES THAT DOES.** *"90
Quartered · 10 back whole"* is what the plant needs; the money on the same page
stays screen-only for 2b's reason. **Over-accounting is flagged the way
`SHEET_OVER_ACCOUNTED` is; under-accounting is not a refusal at all** — head no
cutting line claims ARE the whole birds, and a sheet with no cutting on it is a
hundred whole birds, which is a real arrangement.

**A BLANK QUANTITY MEANS ALL OF THEM, DELIBERATELY.** `core/fee.ts` →
`lineQuantity` already measures the whole run for a head-priced line with nothing
typed, and that is the figure that reached the meat on the $235.00 receipt.
Reading the same blank as *nobody has said* would put two answers to one question
on one screen. Its consequence is visible rather than hidden: two blank cutting
lines each claim every bird, which over-accounts, which is flagged. `fee.ts` was
left alone — this was a decision about how the remainder READS a blank, not a
change to what the plant is charged.

**ONLY `cutting` COUNTS, AND ONLY PER HEAD.** Slaughter is per head too and every
animal gets it, so counting it would read 100 slaughtered plus 90 quartered as a
sheet for 190 birds. The sheet's own grouping is the only thing that says which
lines divide the animals up, and guessing that from the label is how this pack
would start knowing what a chicken is.

── THE PRICE LIST, FOUR SPECIFIC THINGS ─────────────────────────────────────

- **`1001 to 1500, 101 to 250, 251 to 500, 50 to 100`** was on the screen.
  Alphabetically correct and, to anybody holding the sheet, nonsense.
  `compareLabels` compares digit runs as numbers — a general comparison, not a
  band-shaped one, because `Box of 6` before `Box of 12` has the same problem.
- **`Slaughter, Cornish x, 50 to 100 · Slaughter`.** The suppression fired only
  on an EXACT match, which was enough while a label was one word.
  `categoryRepeatsLabel` fires when the label BEGINS with the category, with a
  boundary check so `Slaughterhouse levy` is not a repeat.
- **45 rows in one animal is a wall.** The sheet's own `category` is the second
  axis, in the order the paper uses it — the same rank the picker already
  grouped by.
- **A `Checkbox`, because `Switch` was saying the wrong thing.** Beside a
  heading reading *Cattle 2* a switch reads as *switch cattle on*. The kit had no
  tick box; there is one now, in `src/components/ui/checkbox.tsx`, on registered
  tokens. `Switch` stays where it genuinely toggles a behaviour — *Replace the N
  already on file* is still one, and the split is written down at both sites.

── AND THE ONE WITH THE MIGRATION ───────────────────────────────────────────

**24 OF CHICKEN'S 45 ROWS WERE ONE DECISION.** Pleasant Valley's sheet prices
slaughter as a **4-breed × 6-band grid** — Cornish x, Non-Cornish, Heritage,
Tough Roosters against 50–100, 101–250, 251–500, 501–1000, 1001–1500, over 1500.
For a given batch exactly one cell is the price, and the app made you find it
among 24 siblings.

**THE DIAGNOSIS: 2a MODELLED A LOOKUP AS A MENU.** *A menu is not a rate* was
right for cutting options — quartered against eight-piece is a choice somebody
makes — and wrong for a breed × batch-size grid, which is a table. So `variant`
and `[head_min, head_max]` came out of the label and became fields, and
`core/band.ts` reads them. A sheet for 800 Cornish Cross resolves **$2.75** and
says which band it used.

**A BATCH NO BAND COVERS IS REPORTED, NEVER ROUNDED**, and it is printed on the
sheet: *"if you show up with less than 50 chickens, we do not offer cutting,
whole birds only."* The nearest band would quote a price the plant has said it
will not offer, at the moment somebody is deciding whether to load a trailer.
**Overlapping bands are a different failure** — the sheet being ambiguous, or a
row typed wrong — and it says so rather than picking, because a confident figure
would hide the transcription error.

**THE BAND IS RESOLVED WHEN THE LINE IS WRITTEN, NOT WHEN THE FEE IS COMPUTED.**
`core/fee.ts` never sees any of this. The order line already snapshots
`unit_price_cents`; the band only decides WHICH price gets snapshotted. Putting
the lookup in the fee would make a rate change move last October's sheet, which
is the one thing the snapshot exists to prevent.

**AND THE SNAPSHOT'S LABEL IS COMPOSED, WHICH IS THE OPPOSITE RULE FROM THE
CATALOGUE'S.** `Slaughter` on its own no longer says which of 24 prices was
quoted, and the line has to go on saying so after the rate sheet is replaced. So
`snapshotLabel` writes `Slaughter · Cornish Cross · 501 to 1000 head` onto the
line. On the CATALOGUE those facts belong in fields so the app can read them; on
a LINE they are a decision already made, and a decision is prose.

**RULE 5 IN THE EXTRACTOR PROMPT WAS HALF WRONG AND IS AMENDED.** It said a
matrix of prices is a matrix of items — still true — and that *the label must say
what tells them apart* — which is what made the app unable to read its own data.
The three fields are in the TOOL SCHEMA rather than regex-parsed out of labels
afterwards, because a regex over a plant's own prose is a second reader with none
of the first one's judgement.

**THE UNIQUE INDEX HAD TO CHANGE, AND NULLS WOULD HAVE MADE IT A NO-OP.** Parse
the band out and all 24 rows become label `Slaughter` and collide on
`(tenant, processor, kind, label)`. The key gains the variant and the band's
FLOOR, and **both are `NOT NULL`** — `variant` defaults to `''` the way `kind`
already does, `head_min` to `0`, which means *from the first head* and is true of
every unbanded row. Postgres treats two nulls as distinct, so a nullable column
in that index would have constrained nothing; this repo has now been bitten by
that three times (`inventory_count_lines`, `inventory_tax_treatments`, and the
note in `inventory.md`). Only the CEILING stays nullable, meaning no ceiling.

**THE OLD INDEX IS DROPPED IN THE SAME MIGRATION, WHICH IS NOT THIS REPO'S USUAL
DISCIPLINE, AND THE ALTERNATIVE WAS TRIED AND RUN.** Keeping it — renamed out of
the way, since ON CONFLICT infers a target from an index's columns and not its
name — was written, applied to `dev`, and the suite failed: it refuses the second
of any plant's 24 slaughter rows, because that is exactly what it says. An
expand-only release would therefore have shipped a feature that cannot be used
and tests that cannot pass. **What is accepted instead, stated plainly:** between
the migration being applied and the merge deploying, the running code's
`setPriceItem` infers its ON CONFLICT target from the four old columns and fails
with *"no unique or exclusion constraint matching the ON CONFLICT
specification"*. A few minutes, writes to a price list only, nothing lost and
nothing corrupted — and it is the reason ADR 0014 has the apply happen at a
moment somebody is watching.

**`production_orders.printed_at` IS THE NEAREST HONEST THING TO "HANDED OVER"**,
and it is the shape this dossier asked for before it existed: *a date rather than
a status*, because a status somebody has to advance is a status nobody advances.
The print button writes it and nothing else does, so null means *nobody pressed
Print here* and never *the plant never got one* — which is what the list says.

── DRIVEN, ON THE REAL SHEET ────────────────────────────────────────────────

**PLEASANT VALLEY'S TWO-PAGE PDF, READ THROUGH THE AMENDED EXTRACTOR, ON THE DEV
BRANCH'S `Hilltop Farm`: 115 rows recorded in one pass** — 108 prices and 7
animals. The 24-cell grid came back as FIELDS, `Slaughter Fee` × {Cornish x,
Non-Cornish, Heritage, Tough Roosters} × six bands, and the app then did the
lookup twice on two sheets against one rate card:

| Sheet | Head | What it resolved | Snapshotted as |
| --- | --- | --- | --- |
| Autumn broilers | 100 | **$3.75** | `Slaughter Fee · Cornish x · 50 to 100 head` |
| Big batch | 800 | **$2.75** | `Slaughter Fee · Cornish x · 501 to 1000 head` |

Same plant, same breed, same label, two prices — and the line says which. **The
picker showed 4 options where the list holds 24**, one per breed, each already
resolved. The 40-bird sheet withdrew twelve of them and gave the plant's own
reason. 90 quartered out of 100 printed **"Of 100 head — 90 Quartered, 10 back
whole"**; adding a 50-bird Split on top flagged **140 against 100**. `printed_at`
stamped and showed on the list.

**AND THE VARIANT GENERALISED WITHOUT BEING ASKED TO**, which is the argument for
it being free text: the reader used it for turkey weight classes (*up to 29.99
lbs.*, *30 lbs. and up*), container sizes (*16 oz.*, *5 Gal. Bucket*) and bone
broth batch sizes (*120lb. Batches*). This pack does not know what a breed is and
did not need to.

**SIX DEFECTS, AND EVERY ONE WAS IN A STRING OR A RENDER.** Seventh slice
running:

- **"What each plant was asked to do"** — a hardcoded word for a renameable one,
  directly above a column headed *Butcher*, on the first screen this slice
  opened.
- **Every price row repeated its own sub-group heading.** This slice's own
  defect: 2e suppressed the category when it exactly repeated the label, 2f put a
  *Cutting 10* heading above the rows, and all ten then said "Cutting" under it.
  The heading is the category; the row says nothing.
- **The extractor's note repeated the band** — `Over 1500` sitting under a row
  already reading *1501 head and over*, on eight rows, and *50 bird minimum*
  under *50 head and over* on six more. Rule 5 now says the note is for what the
  fields cannot hold.
- **`90 Quartered · 50 head and over · 10 back whole`** — the reconciliation
  joined with the same `·` the snapshot label composes with, so the band read as
  a third portion. `shortLabel` takes the head of the label and the sentence
  joins with commas.
- **Twelve identical sixty-word refusals**, one per blocked option, on the
  40-bird sheet. The reason is the same reason for all of them: it is printed
  once with the names under it. Same complaint as *45 rows in one run*, one
  screen along.
- **An empty sheet claimed "800 back whole"** beside *Nothing on it yet*. It
  reconciles perfectly and says nothing anybody decided.

**ONE CLAIM WAS WRONG AND IS CORRECTED IN `design-system.md`:** `switch.tsx`'s
`data-checked:` looked like a variant matching nothing, because Radix emits
`data-state="checked"`. Tailwind v4 compiles the shorthand to BOTH forms. Reading
the compiled rule out of `document.styleSheets` settled it; grepping the Radix
dist proves only half the question.

**AND IT WAS RE-READ ON PRODUCTION AFTER THE DEPLOY**, which is what makes the
slice mean anything to the one tenant holding a real rate sheet: `Test`'s plant
went from 108 rows with their bands buried in label text to 108 rows where **69
carry a variant or a band**, the chicken grid among them. See Open items.

**TWO THINGS THAT ONLY APPEAR ON PRODUCTION, worth knowing before driving there
again:** the extractor took **~4 minutes** on the two-page PDF against Vercel
(85 seconds locally), and a stray second `change` event started a second
concurrent read that ran six minutes more — holding `pending` true, which
disables **Record**. The dialog sat with its answer on screen and would not
accept it. That is the missing cooldown showing up as something other than a
double charge.

Migration `0203`. 24 new tests.

### 2026-08-23 — Slice 2e: one row per bird, and a list you can find things in (`claude/one-row-per-bird`)

**108 ITEMS OFF ONE REAL RATE SHEET, AND 75 OF THEM MIS-FILED.** The founder
read the live list and said the thing that decides this slice: *"a giant list of
turkey geese etc when all i need to look at is chicken if that is the batch."*
The counts were worse than the complaint — 29 rows with no animal at all, 46
under `poultry` on a sheet that distinguishes chicken from turkey from duck, and
exactly **one** row under `chicken`.

**THE ANIMAL WAS IN THE LABEL, WHICH IS WHY NOTHING COULD FILTER ON IT.**
`Duck & Geese: Quartered $1.05` — the reader met a line covering two animals,
could not map it to one `kind`, and correctly put the words in the label
instead. Correct, and useless: a farm looking at its chickens had to read past
its ducks.

**A LINE COVERING SEVERAL ANIMALS IS NOW SEVERAL ROWS.** One per animal,
identical but for the kind, and the animal comes out of the label. The
alternative — a list of kinds on one row — was considered and refused: it needs
an array column or a join table, it breaks the unique index, and every filter
becomes an overlap instead of an equals. **It is per SPECIES, not per animal**:
a batch of 1000 chickens is still one row, and 108 items becomes roughly 125.

**AND THE READER NOW PREFERS THE SPECIFIC WORD.** The profile offers `poultry`
AND `chicken`, `turkey`, `duck`, `goose`, `quail`; the prompt was happy to file
everything under the general one. It is now told to take the most specific word
the farm's list offers, and that broilers, fryers and roasters are chicken.

**REPLACING A LIST HAD TO EXIST BEFORE ANY OF THIS WAS SAFE.** `setPriceItem`
upserts on `(processor, kind, label)`, so a re-read that CORRECTS the animal
does not correct the row — `Duck & Geese: Quartered` with no kind and
`Quartered` on a duck are different keys, and recording the second leaves the
first sitting there. Re-reading Pleasant Valley's sheet would have taken `Test`
from 108 rows to 183. `clearPriceItems` plus a **Replace the N already on file**
switch on the read dialog, defaulting ON when there is a list, because a rate
sheet IS the whole list.

**DELETING IS SAFE ONLY BECAUSE THE ORDER LINE SNAPSHOTS.** What a sheet was
quoted lives on `production_order_lines` and survives its price item being
deleted — `price_item_id` goes null and the label, price, unit and minimum stay.
That is the whole reason the snapshot exists, and a test now pins it, because
"replace the list" would otherwise rewrite last October.

**BULK EDITING IS NOT A CONVENIENCE HERE.** The founder's words again: *"there
has to be bulk editing or something."* 108 rows arrived wrong; fixing them one
at a time is not a thing anybody does, so the list would simply stay wrong.
`setPriceItemKind` moves many rows onto one animal in a single call — and where
a move would collide with the unique index it **leaves that row alone and names
it**, rather than refusing the whole batch or failing with an index name. Naming
is what makes it actionable: the fix is to rename or remove the one already
there.

**THE LIST IS GROUPED BY ANIMAL AND CLOSED BY DEFAULT.** The groups are
whatever animals this plant has prices for, in the farm's own words — nothing
here decides what an animal is. **The unsorted group sorts LAST and is labelled
`Needs sorting`**, because it is the pile you are meant to empty and must not
sit at the top pretending to be a category.

**AND THE CUT SHEET'S PICKER IS SCOPED TO THE BATCH'S ANIMAL**, which is most
of what makes the list usable at all: a chicken sheet offers chicken prices and
the genuinely-any ones — a delivery charge, a container — and nothing about
ducks. A sheet that has not said which animal still offers everything, because
there is nothing to filter on and hiding rows would be worse than a long list.

**THE PICKER IS GROUPED BASE-THEN-LAYERS**, which is the other half of what the
founder described: *"every bird gets the flat per bird item, but then there are
layers to add."* That axis already existed as `category`; the picker was
rendering forty options in one run, which makes the base look like an option.
Slaughter first, then cutting, then packaging, then giblets, then anything
unanticipated — `priceCategoryRank`'s order, the same one the paper uses.

**NO MIGRATION.** Everything here is the `kind` column being used properly, a
delete path, and three screens. 5 new tests.

**WHAT THIS SLICE DELIBERATELY DID NOT DO: the whole-bird remainder.** *"10 of
the 100 birds might need to be whole birds and then some will get cut up."*
That is the head reconciliation on the cut sheet — cutting lines carrying
portions, the remainder derived and shown, an over-accounted sheet flagged — and
it is the same shape the kill sheet already uses. It is slice 2f and it wants
this slice's filtering to exist first, because reconciling portions is
meaningless while the sheet is still offering you turkey options for a batch of
chickens.

### 2026-08-23 — The fee that reached the meat (`claude/the-fee-that-reached-the-meat`)

**THE CLAIM THE WHOLE SLICE RESTS ON, PROVEN ON THE LIVE APP.** `Batch
2026-08-23` on `Test` — 40 broilers out of Pen 1, sent to Valley Poultry, cut
sheet quoting $223.70, finished at the **$235.00 they actually billed**:

| | |
| --- | --- |
| Run | `complete` · basis `weight` · inspection `custom_exempt` · `processing_fee_cents` **23500** |
| Receipt | 168 lb of Whole broilers landed carrying **$235.00** |
| Accrual | `Dr 5000 Cost of Goods Sold 23,500` / `Cr 2060 Services Received Not Invoiced 23,500` |

**THE PEN CARRIED NO COST, WHICH IS WHY THIS IS THE CLEANEST POSSIBLE PROOF.**
Those birds had no purchase basis and no feed posted against them, so the pot
was the processing fee and nothing else — every cent on that receipt is money
the plant charged, arriving on the meat. Before 2c the same run would have
landed 168 lb carrying nothing at all.

**AND THE QUOTE AND THE BILL ARE BOTH ON FILE, WHICH WAS THE POINT.** The cut
sheet still says $223.70 and the run says $235.00. *They charged $11.30 more
than they quoted* is now two numbers sitting next to each other rather than a
thing somebody remembers — and slice 2d's matching is what turns it from two
numbers into one the app reports.

**THE INSPECTION CAME ACROSS TOO**: `custom_exempt`, inherited from Valley
Poultry at completion and stamped on the batch, so `retail` will have something
to refuse against. That path had never run either.

### 2026-08-23 — Slices 2a–2c driven on `Test`, and what the sheet forgot to say (`claude/what-the-sheet-forgot-to-say`)

**DRIVEN END TO END ON THE LIVE `Test` TENANT**, and it found nine things — two
of them real gaps rather than copy. The pattern held: everything the tests
assert was true, and everything they cannot see was where the defects were.

**WHAT WORKED, INCLUDING ONE THING THAT HAD NEVER RUN.** The backfill landed
Miller's `$105.00 per head` and `$0.90 per lb hanging` with the units the old
columns only implied. A cut sheet was written against a September BOOKING —
months before any run — which is the case that needed the order to hang off
both. `startRunFromBooking` carried the processor onto the run and the badge
read *Sent out · Valley Poultry Processing*: **that closes slice 1d's
longest-standing open item**, a run actually sent out, which had never been
exercised. The fee then computed on the live run — `40 head measured × $4.50` +
`38 packages counted × $1.15` = **$223.70** — with "measured" and "counted"
rendering differently and the uncounted line reported rather than assumed.

**THE ONE THAT WAS A REAL DEFECT IN 2c ITSELF, and only a two-company tenant
could have found it.** Completing a run with a fee refused every time, with
*"stock has to say where it is before its cost can be posted"* — on a run whose
stock HAD said. The accrual resolved the company from the RUN's location, and a
run started from a booking never has one: `startRunFromBooking` knows a date and
a plant, not a freezer. It now falls back to where the outputs went, which is
not a guess — the receipts resolved a company from exactly that location moments
earlier, and where they genuinely disagree `resolveMovementEntity` still
refuses. **The pack's own test tenant keeps one company, where a null location
resolves fine**, so the test for this lives in `inventory-posting.test.ts`
beside the two-company fixture that can see it.

**AND THE REFUSAL THAT LOOKED LIKE A BUG THE FIRST TIME WAS NOT ONE.** Completing the run
failed repeatedly with what appeared to be a hang. It was
`resolveMovementEntity` refusing correctly: `Test` keeps TWO companies and the
output had no location, so *"This business keeps more than one set of books, so
stock has to say where it is before its cost can be posted."* The message was on
screen the whole time; the browser tooling was timing out on screenshots. Worth
recording because the wrong conclusion was drawn twice before the toast was read
directly out of the DOM.

── THE TWO THAT WERE NOT COPY ───────────────────────────────────────────────

**A RUN STARTED BY HAND COULD NEVER NAME A PLANT.** `production_runs.processor_id`
has existed since 1d and only `startRunFromBooking` ever set it; the *Start a
batch* form had no picker at all. That was survivable while the column drove a
badge and stopped being survivable the moment the cut sheet and the processing
fee hung off it — a farm that drove the animals over without recording a booking
had no way to record what it was charged, and `Test`'s own first butchering run
is exactly that case. The form now offers it, hidden entirely when no plant has
been recorded, and defaulting to *Done here*.

**THE PRINTED CUT SHEET HAD NO DATE ON IT.** The print header carried the plant,
the animal and the head count, and said WHEN only when a run already existed —
so a sheet written against a September booking printed with nothing to say which
day it was for. That is the one document that leaves the building, handed to
somebody who is holding a date. It now prints the run's day once there is one,
the booking's day before that, and both when they differ, because a sheet
written for the 10th and used on the 12th is a real thing to be able to see.

**A DUPLICATE LINE WOULD HAVE DOUBLED THE FEE.** The option picker went on
offering an option already on the sheet, nothing refused a second line, and
`feeTotal` sums every line — so "Slaughter" twice would have silently doubled
what the plant appeared to charge, on the figure that reaches the cost of the
meat. Fixed at all three levels the pack usually uses: a PARTIAL unique index
(`0202`), a refusal in words at the ops layer, and a picker that stops offering
what is already there. **Partial and scoped to the ORDER**, because an
instruction line has no price item and a sheet may carry as many as the customer
has opinions — and because the same option on two SHEETS is the design's *one
animal, two cut sheets*, which this must not refuse.

── THE COPY, WHICH IS WHERE THIS PACK KEEPS BLEEDING ────────────────────────

Sixth slice running where driving found copy defects that `tsc`, eslint and the
whole suite were blind to:

- **`Slaughter · Duck · Slaughter · $10.55 per head`** — the category repeated
  the label, on five of Valley Poultry's rows. The grouping is now suppressed
  when it only repeats the label, on both screens.
- **The printed sheet said `· cattle ·`** — the raw slug, lowercase, where every
  screen says *Cattle*. `slugLabel` was missing from the one header that prints.
- **The sheet's title printed twice**, and the head count twice, because the
  print header and the shared `CutSheet` component both render the identity. The
  component's row is now screen-only; on the run page it is what tells two
  sheets apart, so it stays there.
- **The category printed at all** — a butcher does not need to be told that
  "Keep the heart and liver" is filed under *Extras*. That is this farm's
  filing, not an instruction to them.
- **An instruction row's Remove sat inline** in the sentence while every priced
  row's sat at the margin: the price span carried the `ml-auto` and the
  instruction branch had nothing to push it.
- **`Vacuum Shrink Pkg.. The real figure is higher`** — a label routinely ends
  in a full stop and the sentence added a second. Both places now use a dash.
- **The finish dialog opened "sharing the $0.00 that went in"** while the
  outputs were about to share $223.70. It quoted `potCents`, which deliberately
  excludes the fee because nobody has said what the fee is until the box below
  is filled in. It now reads off the typed fee and splits the sentence when
  there is one.

**THE LESSON THAT GENERALISES, and it is the same one as `the-word-the-note-forgot`:**
every one of these is in a string, and every one was found by reading a screen
out loud rather than by running anything. The two structural gaps were found the
same way — by trying to do the thing rather than by asserting that it could be
done.

**HOW THE SILENT FAILURE WAS FINALLY READ:** the action returned 200 every
time and the error toast expired before a screenshot could catch it. A
`MutationObserver` on `[data-sonner-toast]`, armed before the click, is what
produced the sentence — worth keeping, because Sonner unmounts its region when
empty and "no toaster on the page" reads exactly like "no error".

Migration `0202`. 5 new tests. Everything else in this entry is copy or a
picker.

### 2026-08-23 — Slices 2b and 2c: the sheet you hand over, and what it costs the meat (`claude/what-the-menu-actually-costs`)

**THE POT WAS ONLY EVER HALF A COST.** `completeRun` rolled the animals'
accumulated cost across the outputs and nothing else, so a box of ground beef
out of a $95-a-head kill carried eight weeks of feed and nothing at all for the
killing, cutting and wrapping that turned an animal into a box. On a farm
sending stock out, the processing bill is frequently the largest single cost of
the conversion. `production_runs.processing_fee_cents` goes in the pot with the
feed, and the roll splits the whole thing.

**FLAT PER ANIMAL PLUS PER POUND IS THE ARRANGEMENT, AND IT IS WHY THE UNIT HAD
TO BE MODELLED FIRST.** $95 a head to kill and $0.90 a pound of hanging weight
to cut is what most plants quote, and its consequence is arithmetic nobody
should do in their head: **a smaller animal costs more per pound at the same
plant**, because the flat half spreads over less meat. 900 lb hanging comes out
at 100.6c a pound and 600 lb at 105.8c, from identical rates. A test pins both
figures, because that 5% is the thing the model exists to make visible and it
disappears the moment a fee becomes one number.

**THE ORDER HANGS OFF BOTH A BOOKING AND A RUN, and neither alone would do.** It
has to exist BEFORE the run — the sheet goes over with the animals at drop-off,
and `startRunFromBooking` does not create a run until the day happens — and it
has to be reachable FROM the run, because that is where the fee is worked out
and a run started without a booking is ordinary (the live `Test` tenant's first
butchering run is exactly that). So `booking_id` is where it began, `run_id` is
what it became, and `attachOrdersToRun` carries it across on the day. The same
pairing `production_bookings` already uses.

**A CUT SHEET IS TWO THINGS AND THE TABLE HOLDS BOTH.** *"Vacuum pack, $0.35 a
package"* is a charge; *"ribeyes at one inch, grind the chuck"* is an
instruction with no price at all, and the design is explicit that a cut sheet
*specifies treatment, not quantities*. A line with no `price_item_id` is the
second kind: it prints on the sheet the plant reads and contributes nothing to
the total. **An instruction is not an unpriced line** — listing it among the
things the fee could not work out would make every cut sheet look broken.

**THE PRICE IS SNAPSHOTTED ONTO THE LINE AND THEN FORGOTTEN.** Label, price,
unit and minimum are copied when the line is written; `price_item_id` survives
only as provenance and is nulled if the price is later deleted. A rate sheet
updated in March must not restate what an October order was quoted — the same
rule a movement's cost follows, and the thing that keeps *"they charged more
than they quoted"* answerable a year later. **The price is also not patchable**:
somebody who quoted the wrong option takes the line off and adds the right one,
because a quote that can be edited after the fact is not a quote.

**NULL QUANTITY MEANS TWO DIFFERENT THINGS AND THAT IS THE POINT.** For the four
units a finished run can measure it means *work it out* — nobody knows a hanging
weight when the sheet is written. For the other four it means *nobody has
counted*, and the fee reports the line rather than assuming one of anything.
Assuming "one" is how a $0.35 vacuum pack charge on 140 packages reads as $0.35.
The screen prints which, and labels a measured quantity as measured so nobody
reads it as a figure they confirmed.

**HEAD COUNTS EVERY CARCASS LINE, CONDEMNED ONES INCLUDED**, which is the exact
opposite of what `dressingPercentage` does with the same rows — and both are
right. A yield asks what the surviving meat came from; a fee asks what work was
done, and a plant kills an animal and charges for killing it whatever an
inspector decides afterwards. Leaving condemnations out would understate the
bill by exactly the animals the farm has already lost most on.

── THE LEDGER, WHICH IS WHERE THE DECISION WENT ─────────────────────────────

**THE OPTION CHOSEN WAS C, STAGED**, decided before any of it was written. Three
were on the table: land on the quote, wait for the bill, or land on the quote
and true up. The quote wins the first half because *"what did this pen make"*
must be answerable on the day the boxes land rather than whenever a plant gets
round to invoicing, and because a bill that never gets entered would leave the
freezer silently undervalued forever.

**THE PACK'S OWN RULE DID NOT FORBID IT, AND WORKING OUT WHY IS WHAT SETTLED
IT.** *"Only cost stamped on the ledger travels. Anything a batch carries as an
estimate stays with the batch"* was written about `livestock`'s feeder spread —
an allocation of money ALREADY POSTED somewhere else, where capitalising it
would double-count. A processing quote is money posted nowhere for a service
definitely rendered; its analogue is a delivery ticket, which `inventory`
capitalises on purpose through GRNI. And *"stamping it makes an estimate
permanent"* stopped being true on 2026-08-22, when `adjustLotCost` shipped. That
rule was written on 2026-08-20.

**THE ACCRUAL IS WHAT MAKES THE OUTPUT RECEIPT HONEST, and it had to ship with
the fee rather than after it.** A produced receipt credits the CONSUMPTION
account — the run's inputs were debited there on the way in, so a transformation
nets to nothing on the P&L. That holds only while everything in the pot was
debited to consumption first, and a fee taken from a quote never was. So
`completeRun` posts `Dr consumption / Cr 2060 Services Received Not Invoiced`:

```
accrual        Dr 5000 730   Cr 2060 730
outputs land   Dr 1300 730   Cr 5000 730
bill matched   Dr 2060 730   Cr AP   730      ← NOT BUILT YET
               ───────────────────────────────
               1300 = 730 · 2060 = 0 · 5000 = 0 · AP = 730 · P&L = 0
```

Without it, completing a run leaves a credit balance in an expense account,
self-correcting only if the plant's bill happens to be coded to the same place
and never if it is coded to a contract-butchering account of its own.
Retrofitting it later would have left every run completed in between carrying a
credit nobody backed, which is why it is in this PR and the matching is not.

**`2060` AND NOT `2050`.** A processing fee genuinely is money owed for
something received and not invoiced, so GRNI reads right — and
`unbilledReceipts` builds the GRNI working from stock RECEIPTS, which an accrued
service has none of. A balance in 2050 its own reconciliation could never
explain is precisely the defect `owesASupplier` was extracted to stop, when a
kill day's output was listed as awaiting an invoice.

**THE UNCLEARED BALANCE IS A FEATURE UNTIL THE MATCHING SHIPS.** A non-zero 2060
per plant IS the list of processing nobody has been invoiced for — the same
self-surfacing shape `missedBookings` has, where nothing must remember to set a
flag.

**A FEE ON AN ON-FARM RUN IS REFUSED.** `processor_id` null means the farm did
it itself, and its own labour is deliberately recorded and not costed; a figure
there would put a made-up wage into the price of the meat through the back door.

**AND THE FIGURE IS STILL CONFIRMED BY A PERSON.** `orderFee` proposes what the
sheets come to and the finish dialog offers it; a plant's actual bill routinely
differs from its rate sheet, and a number that reached the ledger without
anybody looking at it would be a quote pretending to be an invoice. The box is
EMPTY when there is no quote, because a pre-filled `0.00` is the fastest way to
get a fee of nothing onto a box of meat.

── THE REST ─────────────────────────────────────────────────────────────────

**THE SHEET HAS ITS OWN PAGE AND IS RENDERED ONCE.** `components/cut-sheet.tsx`
is a server component shared by the order page; the run page shows a summary
that links to it. Two renderings of the same lines is how a farm ends up handing
over a sheet that says something the app no longer thinks it says. Printing
follows the invoice pattern — `print:` variants plus `window.print()`, no
separate route, for the same reason. **The money is screen-only**: the plant
knows its own rates, and printing the farm's running total onto a document
handed across a counter is an unforced disclosure.

**`cutSheet` IS A RENAMEABLE LABEL and its fallback is `Order`.** A bakery hands
a co-packer a spec and a shop hands a subcontractor a work order; only meat says
cut sheet. The homestead profile sets it, which is the same arrangement
`killSheet` and `processor` already use.

Migrations `0197` (tables + the fee column), `0198` (the ledger source, alone —
`depreciation`'s arrangement), `0199` (RLS), `0200` (the PG 15 `SET NULL
(price_item_id)` form, 0192's fix on a new table), `0201` (`2060` for every
tenant that already has books, `0142`'s arrangement). **`0197` hand-reordered —
eleventh check, fourth yes**: one FK targeted an index the same file creates, and
the other five pointed at tables from earlier migrations, so the rule *check
whether the target is created in the same migration* gave five noes and one yes.
28 new tests (17 pure, 10 db-backed across two suites, 7 isolation).

### 2026-08-23 — Slice 2a: the menu is the data (`claude/what-the-menu-actually-costs`)

**THE REFUSAL BECOMES A SHAPE.** Slice 1e's reader met a real USDA poultry sheet
and would not fold twelve chicken cutting options at nine prices into one
per-bird column, because *a menu is not a rate*. That was right and it threw
away most of a rate sheet: the figures survived in `price_notes` as prose
nothing could select, compare or total. `production_processor_price_items` is
one row per priced thing, and picking between them stops being the reader's job
on a sheet and becomes the farm's job on an order.

**THE RULE UNDERNEATH IT DID NOT MOVE, AND A TEST PINS THAT IT DID NOT.** A
MENU is now a list; a RANGE is still nothing. Pleasant Valley's turkey slaughter
is $0.65–$0.90 a pound with a $10 minimum — the unit is now expressible and the
minimum has a column, and the PRICE is still null, because the sheet names no
figure and averaging the two ends would invent one the plant never quoted.

**`unit` IS THE WHOLE POINT, AND IT IS CLOSED.** Eight values: `head`,
`live_lb`, `hanging_lb`, `finished_lb`, `package`, `box`, `flat`, `hour`. $1.05
is five different amounts of money across them, and this pack has already paid
once for a column that could hold only one — `cut_wrap_cents_per_lb` was per
pound, every poultry plant quotes cutting per bird, and adding
`cut_fee_cents_per_head` a day earlier fixed exactly one case out of twelve. The
lesson recorded on that column now: **the unit belongs ON the price, not in a
column name.** The first four are computable from a finished run and the last
four are a number only a person knows, which is the split the fee roll rests on.

**`category` AND `label` ARE OPEN, and that is the same call
`production_processor_cuts` made about cut names.** What a plant charges for is a
trade's prose, every sheet is laid out differently, and a taxonomy here would
make the first unanticipated fee a migration. `priceCategoryRank` sorts the five
anticipated groups the way a rate sheet reads them and anything else last —
a rank rather than an `ORDER BY`, because no SQL can express "unanticipated goes
to the end" without duplicating the list into the query.

**THE THREE FEE COLUMNS ARE SUPERSEDED AND STILL THERE, ON PURPOSE.** `0196`
copies them into price items with the units they always implied; `setHandle`
stops reading AND writing them, and leaves them out of its conflict `SET` rather
than nulling them, so they stay exactly as they were until the DROP. That drop
is a follow-up PR after this one's deploy — nothing in the deploy applies
migrations and `main` auto-deploys (ADR 0014), so dropping a column in the same
migration takes the processor page down for the minutes in between. What stays
on the handle is what a price cannot say: whether they take this animal, how
many a day, and the prose that is not a price.

**THE EXTRACTOR NOW FILLS TWO LISTS, AND THE SPLIT IS THE FIX FOR A REAL BUG.**
A rate sheet says both *we take turkeys* and *quartering a chicken is $1.05*;
those are two facts with two lifetimes, and the second used to be crammed into
the first. The clash check from `five-prices-one-row` survives at both grains —
an item clashes on `(kind, label)`, an animal on `kind` — and itemising is what
makes most of the old clashes disappear: quartered and eight-piece were two
claims on one column and are now two labels.

The prompt gained rule 5, which generalises what the first real sheet exposed:

> **IF THE SHEET PRICES THE SAME THING SEVERAL WAYS** — by breed, by batch size,
> by weight band — each priced cell is its own item, and the label must say what
> tells it apart. A matrix of prices is a matrix of items.

That is the chicken slaughter grid — 4 breeds × 6 batch bands, 24 prices — which
the old shape could only put in a note verbatim. It is now 24 rows a person
ticks through, or unticks.

**THE ONE THING THE VALIDATOR DROPS IS A PRICE WITH NO UNIT**, and it is the
exception that proves the rule the rest of the file follows. Everything else
survives with a field emptied, because dropping a row silently loses a price off
the sheet. But `1.05` with nothing saying whether it is a bird or a pound is the
exact ambiguity this table was built to end, and a form cannot ask somebody to
supply a unit they would have to guess at either. The prompt is told to describe
such a line in the note, so it is reported rather than gone.

Migrations `0194` (table), `0195` (RLS), `0196` (backfill). No hand-reordering
needed — **tenth check, third yes to the question and second no in a row**: the
composite FK target `production_processors(tenant_id, id)` was created back in
`0184`, so drizzle's ordering was already right. 22 new tests (11 pure, 8
db-backed ops, 6 isolation) plus the price-list suite rewritten around the new
shape.

### 2026-08-23 — What a bird costs to cut (`claude/what-a-bird-costs-to-cut`)

**THE COLUMN A REAL RATE SHEET PROVED WAS MISSING.**
`production_processor_handles.cut_fee_cents_per_head` sits beside
`cut_wrap_cents_per_lb`, and the two are not interchangeable: **every red-meat
plant quotes cutting per pound of hanging weight, and every poultry plant quotes
it per bird.** Pleasant Valley's list is $1.05 to quarter a chicken and $1.25 for
an eight-piece cut, and there was nowhere to put either — the reader correctly
refused to fold them into the per-pound column, because `$1.05` sitting there is
indistinguishable from a real per-pound rate, so the figures survived only as
prose that nothing can compare.

**BOTH MAY BE SET, and no CHECK says otherwise.** A per-pound cut with a flat
per-bird handling fee on top is an ordinary arrangement; a constraint forbidding
it would be this app telling a business how it may quote. What decides which a
farm reads is the animal, not a rule here.

**THE EXTRACTOR NOW HAS THREE FEE SLOTS AND A RULE ABOUT NOT MIXING THEM.** The
prompt gained the distinction and, more importantly, a new rule that generalises
the thing the first real sheet exposed:

> **A MENU IS NOT A RATE.** If a sheet lists several cutting options at different
> prices — quartered $1.05, eight-piece $1.25, deboned $1.30 — there is no single
> cutting fee, so leave BOTH cutting slots null and put the menu in the note.

**SO THIS COLUMN DOES NOT MAKE PLEASANT VALLEY'S CUTTING REPRESENTABLE, and that
is correct.** Twelve chicken options at nine prices is a menu; picking one would
be inventing the farm's choice. What the column fixes is the case where a plant
names ONE cutting price for an animal — which is most of them, red meat
especially — and which previously had to be either mis-stated or thrown away. A
test pins the menu case so a later prompt change cannot start guessing at it.

### 2026-08-23 — A real rate sheet, and the five prices that became one (`claude/five-prices-one-row`)

**THE FIRST GENUINE PAPERWORK THROUGH THE READER**: Pleasant Valley Poultry's
2026 price list — a real two-page USDA poultry plant sheet, 277 KB, uploaded to
the live app against `Valley Poultry Processing`. What it produced is worth
recording in full, because the useful half is what it REFUSED.

| Row | Kill fee returned | Right? |
| --- | --- | --- |
| Chickens | *empty* | **Yes.** The sheet prices them as a 4-breed × 6-batch-band matrix — 24 numbers. Any one of them is wrong for the other 23. The whole matrix went into the note verbatim. |
| Turkeys | *empty* | **Yes.** Priced **per pound** ($0.65–$0.90) with a $10 minimum, not per head. `0.65` would have looked entirely plausible in a per-head field. |
| Ducks | **$10.55** | Exact |
| Geese | **$11.55** | Exact |
| Quail | **$2.75** | Exact |

Every cut-and-wrap field came back empty, and that is also correct: **this plant
prices cutting per BIRD** ($1.05 quartered, $1.25 for an 8-piece cut), and the
column is per pound of hanging weight. `$1.05` in a per-pound field would have
been indistinguishable from a real rate. The notes captured the cutting fees,
the packaging fees, the seasonal minimums and the plant's advice about booking
duck and geese by age.

So the prompts' central instruction — *leave it out rather than guess* — held on
the first real document, in exactly the two places a naive reader gets it wrong.

**AND THEN THE DEFECT, WHICH ONLY REAL DATA COULD HAVE FOUND.** All five rows
came back as `poultry`, because that was the only bird in the profile's
vocabulary. `setHandle` upserts on `(processor, kind)`. **Recording all five
would have written five rows into ONE**, each silently overwriting the last,
leaving quail's $2.75 as the price of all poultry — and reporting "5 recorded".
Nothing was recorded; the dialog was closed instead.

Two fixes:

- **The confirm refuses a clash and marks it inline.** The dialog already warned
  that recording a kind already on file replaces it; it said nothing about rows
  in the SAME batch colliding with each other, which is the case that actually
  arises. Now a ticked duplicate is labelled *· clashes* and Record refuses,
  naming the kind.
- **`processorHandles` widened** to `chicken, turkey, duck, goose, quail`
  alongside `poultry`. $2.75 a quail against $11.55 a goose is not a rounding
  difference, and one bucket could not hold them. `livestock.species` still says
  `poultry` — a farm counts birds in a pen as birds — and the two lists being
  separate is exactly what let one move without disturbing the other.

**Still unfixed, and now certain rather than suspected: the schema cannot hold
poultry cutting.** `cut_wrap_cents_per_lb` is per pound; every poultry plant
prices cutting per bird. The reader is right to refuse the field and the note
carries the real figures, but a farm cannot compare two plants' cutting rates
until there is a column for it. That is a migration and a modelling decision,
recorded as an open item rather than guessed at here.

### 2026-08-23 — Slice 1e: reading somebody else's piece of paper (`claude/paperwork-somebody-else-wrote`)

**ONE PATH, TWO CONSUMERS, WHICH IS WHY THEY SHIPPED TOGETHER.** A kill sheet
and a processor's price list are the same problem — a photograph or a PDF
arrives, somebody would otherwise retype it, and what it says has to land in a
table. They differ only in which table. Building the path twice would have meant
arguing about the confirm step twice, and the second argument is the one that
gets lost.

**NOTHING THE MODEL SAYS IS EVER WRITTEN.** `ai/paperwork.ts` and both consumers
return a PROPOSAL. A person reads it against the paper still in their hand,
edits any field, unticks any row, and presses Record — which calls
`addRunCarcassAction` and `setHandleAction`, **the ordinary write paths**, one
row at a time, with the same validation, the same refusals and the same audit
entries as typing it in. There is no privileged path into these tables. The
reason is specific rather than philosophical:

- a carcass row is **a statement about whether meat was fit to sell**, made by a
  licensed plant. An extraction that quietly recorded a condemnation — or
  quietly failed to — would be this app putting words in an inspector's mouth.
- a handle row is **the terms of a commercial relationship**. A fee changed by
  an extraction nobody read is worse than a fee nobody typed, because it looks
  like it was agreed.

**THE PROMPTS' REAL JOB IS TEACHING IT WHEN TO SAY NOTHING.** A model asked to
read a smudged sheet will produce a plausible number for every cell, and a
plausible hanging weight is indistinguishable from a real one once it is in the
table. Every instruction is aimed at the same thing — leave it out, never
calculate, never convert, never average, copy the plant's own words — and the
screen says an empty box means it would not guess.

**AND THE PROMPT IS NOT A GUARD.** Every rule the prompts state is re-applied in
`validateKillSheet` / `validatePriceList`, because a prompt is a request and the
validator is the thing that is true. A condemned line arrives with its hanging
weight stripped whatever the model said, because the table's CHECK says so and a
proposal that violated it would become a form somebody fills in and then gets a
constraint violation from.

**A REAL BUG, CAUGHT BY A TEST WRITTEN TO ASSERT THE PRINCIPLE.** `readNumber("")`
returned **0**, because `Number("")` is 0 — which is precisely the failure this
whole slice exists to prevent: a blank cell on a rate sheet becoming a confident
`$0.00` fee that reads as *"they waived it"* rather than *"nobody said"*. Fixed,
and the empty-and-whitespace cases are now asserted.

**`normalizeImageForVision` MOVED OUT OF `accounting/ai/` INTO `src/lib/`.**
Nothing in it was ever accounting's — it is "make an image safe and cheap to send
to the vision API", the same job for a bill, a kill sheet and anything after
them. A pack reaching into a core MODULE to get it would have been the first
arrow of its kind in this codebase, drawn for a utility rather than for a
boundary that meant anything. It keeps its lazy `sharp` import and the incident
that produced it.

**Thinking is ADAPTIVE here**, unlike the accounting call site which pins it off
to preserve a budget tuned on an older model. This is a new call site and reading
a handwritten, column-misaligned kill sheet is exactly what thinking is for.

**THE FILE IS NOT KEPT, and that is a gap rather than a decision.** The design
says "the kill sheet as a DOCUMENT", and a kill sheet genuinely is a retained
record. Filing it would make `production` the first pack to import a core module,
which deserves to be decided on its own merits rather than smuggled in behind an
AI feature. Recorded as an open item.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `production_runs` | One pass of turning things into other things | `tenant_id`, FORCE RLS. `run_kind` open taxonomy (P1), values from the profile. `status` in `in_progress\|complete` — two, because the only state that matters is whether the cost is still held here. `cost_basis` is stamped at completion and never re-derived. `crew_size` / `labour_hours` are recorded and **not costed**. **`processing_fee_cents`** is what the plant charged, stamped at completion beside the other two and IN the pot the outputs are split from; null is nobody-said and zero is they-waived-it, and a fee on a run with no processor is refused | **`processor_id`** is the processing path — null means on-farm, and null is a real answer. **`inspection`** is stamped at completion and never re-derived, because a plant's status can change and a box in a freezer is governed by what was true when it was packed
| `production_run_inputs` | **What went in. A JOIN, not a second ledger** | Composite FKs to the run (CASCADE) and to `inventory_movements`. UNIQUE per movement — two rows would put one cost in two runs, the same rule `livestock_feed_draws` follows. Its only own column is `weight_lb` |
| `production_run_outputs` | What came out — **and the one place holding a quantity before the ledger does** | Composite FKs to the run (CASCADE), the item, the lot, the receipt and the location. CHECK: `lot_id` and `inventory_movement_id` are null together — landed means both. Frozen once landed |
| `production_run_carcasses` | **The kill sheet, line by line** — the stage between the animal and the box | `tenant_id`, FORCE RLS. Composite FKs to the run and to the **input** (both CASCADE); `run_input_id` is REQUIRED, which makes the chain carcass → input → movement → lot total. `head_count` is 1 for a beef and 70 for a pen. `disposition` in `passed\|condemned` — two, because one line is one outcome. CHECKs: a condemned line carries no `hanging_lb`, a passed line carries no `condemn_reason`. **Writable on a finished run**, unlike everything else here |

| `production_processors` | **Who does the work you do not** — a role on a party, not a new contact model | `tenant_id`, FORCE RLS. Composite FK to `parties` (CASCADE); UNIQUE per party, because two rows would be two opinions about one plant with nothing to say which is current. **No `name` column** — it is the party's, so this table cannot disagree with the rest of the app. `inspection` in `usda\|state\|custom_exempt\|uninspected\|unknown`: five, and `unknown` is a real answer rather than a missing one. `rating` 1–5 or null, and it is an OPINION — the measured half is folded, never stored |
| `production_processor_handles` | **What one processor will take** | Composite FK to the processor (CASCADE). UNIQUE per `(processor, kind)`. `kind` is an open taxonomy from the profile's `processorHandles`, a **separate list** from `livestock.species` because what a plant takes is not what this farm raises. **The three fee columns are superseded** — copied out by `0196`, read and written by nothing, awaiting their DROP in a follow-up PR. What is left is `capacity_per_day` and the prose that is not a price |
| `production_processor_price_items` | **One priced thing off a rate sheet** — the menu, as data, and since 2f a TABLE the app reads rather than a list a person searches | Composite FK to the processor (CASCADE). UNIQUE per `(processor, kind, variant, head_min, label)` — two rows for one named option would be two prices with nothing to say which is current, and it is what makes next year's sheet re-readable over this year's as a correction. **`variant`** is the breed or qualifier in the plant's own words and **`[head_min, head_max]`** is the batch band; they are in the key because one plant's 24 chicken slaughter rows all carry the label `Slaughter`, and **both key columns are `NOT NULL`** (`''` and `0`) because Postgres treats two nulls as distinct and a nullable column in a unique index constrains nothing. Only `head_max` is nullable, meaning no ceiling. **`unit` is CLOSED** (`head`, `live_lb`, `hanging_lb`, `finished_lb`, `package`, `box`, `flat`, `hour`) and is the whole point: $1.05 is five different amounts of money across them. `category` and `label` are OPEN, the same call `..._cuts` made about cut names. `price_cents` NULL is "call them", never zero; `minimum_cents` is a floor, not a price. Still a QUOTE — what was paid is a bill in `payables` against the same party
| `production_processor_cuts` | What a processor will produce | Composite FK to the processor (CASCADE). Free text by design — cut names are a trade's prose and every plant's list differs. `kind` empty means "anything they take". This is CAPABILITY; the per-animal cut sheet is a later slice |

| `production_orders` | **The cut sheet** — what this farm asked one plant to do with one lot of animals | `tenant_id`, FORCE RLS. Composite FKs to the processor, the booking and the run, **all CASCADE**; `booking_id` is where it began and `run_id` is what it became, and the CHECK asks for at least one — a sheet attached to nothing is a sheet for a day that does not exist. **No unique index**: the design's *one animal, two cut sheets* is the ordinary case, and `title` tells them apart until `retail`'s commitments can name the customer. **`printed_at`** is the nearest honest thing to a handed-over state — a DATE rather than a status, written by the print button and by nothing else, so null is *nobody pressed Print here* rather than *they never got one* |
| `production_order_lines` | **One line of a sheet — an option chosen, or an instruction given** | Composite FK to the order (CASCADE) and to the price item (**`SET NULL (price_item_id)`**, PG 15's column-list form — a line is a SNAPSHOT and must survive the rate sheet being tidied). `unit_price_cents`, `unit` and `minimum_cents` are **stamped and never re-read**. A line with no `price_item_id` is an INSTRUCTION and carries no money. CHECK: a price must say what it is per; a unit with no price is allowed. `quantity` NULL means *work it out* on a computable unit and *nobody has counted* on the rest |
| `production_run_bill_allocations` | **The plant's bill, matched to the processing day it pays for** — slice 2d | `tenant_id`, FORCE RLS. Composite FKs to `bill_lines` (**CASCADE** — when the LINE goes the settlement goes with it, because a deleted line no longer debits `2060`; `updateBillDraft` used to fire it on every ordinary edit, which silently unmatched every run on a bill while leaving the accrual cleared) and to the run (**no cascade** — erasing the record that a bill settled one would hide the money). UNIQUE per `(bill line, run)`: a second match is a CORRECTION, not a second settlement. **`accrued_cents` is STAMPED at match time and never re-read** — it is what the ledger credited, and a later cost correction must not restate a variance that has posted. **`corrected_cents`** is how much of the difference has been pushed onto the meat, and is what makes that second act idempotent |
| `production_bookings` | **A date held with a processor — the scarce resource** | `tenant_id`, FORCE RLS. Composite FKs to the processor and to the run, **both CASCADE**; `run_id` is what the booking BECAME and is null until the day happens. `status` in `held\|confirmed\|cancelled` — three, and there is deliberately **no "it happened"**, because `run_id` answers that and a status somebody must advance would disagree with it. CHECK: a cancelled date cannot claim a run. Deposit in cents, and null is not zero — a date held on a phone call is ordinary |

**Everything else lives in `inventory`:**

| The question | Answered by |
| --- | --- |
| How much went in, and what did it cost? | `inventory_movements`, via the input's `inventory_movement_id` |
| How much came out, and what did it land carrying? | `inventory_movements`, via the output's receipt |
| What is on the shelf now? | The fold in `inventory/core/balances.ts` |
| What had the pen accumulated? | `carriedCostByLot`, folded by `inventory/core/costing.ts` |
| Is this pen clear to process? | `livestock`, through the run-input handler |

**Not columns, deliberately** — each would have no reader today: a yield or a
ratio (folded, and a stored one is the fudge this pack exists to refuse — which
now covers dressing percentage, cutting yield AND the condemnation rate), a
`cost_cents` on any of the three tables (the movements hold it), byproduct NRV
and labour cost (slice 3), cut sheets and recipes (slices 1b and 2 — one shared
run model, separate templates), and the processing path and eligibility flag
(slice 1b).

## Key files & seams

- `src/packs/production/core/yield.ts` — pure. **The report only this product
  can produce, and its five refusals.** Read this before changing anything about
  what a yield means
- `src/packs/production/core/carcass.ts` — pure. **The two stage ratios, and the
  single honest condemnation adjustment.** Read this before changing anything
  about what a dressing percentage means, and in particular before being tempted
  to subtract an average condemned weight from a total
- `src/packs/production/core/roll.ts` — pure. The pro-rata off a lot, the basis
  rule, and the largest-remainder split. **Read this before changing anything
  about what an output cost**
- `src/packs/production/core/band.ts` — pure. **The lookup the app should have
  been doing**, and the two ways it refuses rather than guessing. Read this
  before being tempted to fall back to the nearest band. It also holds
  `snapshotLabel`, and the argument for why a LINE composes the variant and the
  band into its label while the CATALOGUE keeps them in fields
- `src/packs/production/core/portions.ts` — pure. **The whole-bird remainder,
  derived and never stored.** Read the header before changing what a blank
  quantity means: it agrees with `core/fee.ts` on purpose, and the two
  disagreeing would put two answers to one question on one sheet
- `src/app/dashboard/m/production/orders/page.tsx` — **the front door.** Every
  sheet, with the day it is for. The founder could not find a cut sheet before
  this existed
- `src/components/ui/checkbox.tsx` — the tick box the kit did not have. **Note
  the variant it uses**: Radix emits `data-state`, and `switch.tsx`'s
  `data-checked:` matches nothing — see `design-system.md`
- `src/packs/production/core/fee.ts` — pure. **What the plant charged, and the
  four measures it is allowed to work out for itself.** Read this before adding
  a ninth price unit: `MEASURED_BY` is exhaustive over `PRICE_UNITS` by
  construction, so a new unit that nobody decides about is a type error rather
  than a fee that quietly shrinks
- `src/packs/production/order-ops.ts` — the cut sheet. **Writes are MEMBER,
  which is the opposite call from `setPriceItem`** and the header says why.
  `orderFee` proposes; it never writes and never posts
- `src/packs/production/components/cut-sheet.tsx` — one rendering of one sheet,
  shared by the page and the printout. **Two renderings is how a farm hands over
  a sheet the app no longer agrees with**
- `src/packs/production/components/price-list.tsx` — the rate sheet, grouped by
  animal and editable in bulk. **Read the header before flattening it again**:
  one real sheet is 108 rows, and the unsorted group sorting LAST is deliberate
- `src/packs/production/processor-ops.ts` → `clearPriceItems`,
  `setPriceItemKind`. **`clearPriceItems` is what makes re-reading a sheet
  possible at all**, because the upsert cannot correct an animal
- `src/packs/inventory/ledger-ops.ts` → `postServiceAccrual`,
  `resolveServicesAccruedAccount`. **The entry that makes the output receipt
  honest**, and the argument for `2060` over `2050`
- `src/packs/production/billing-ops.ts` — **this pack's only file that touches
  core's tables**, the same boundary `inventory` drew with `ledger-ops.ts`. It
  reads `journal_entries` to find what was accrued and rewrites `bill_lines` to
  point at the liability; it posts no entry itself — `approveBill` does, from the
  lines. Read the header before changing what a match clears
- `src/app/dashboard/m/production/billing/page.tsx` — the reconciliation, both
  halves on one page. **Matching points the line; approving posts it**, and the
  copy has to keep saying both
- `src/packs/production/core/handler.ts` — **the P5 slot.** Types only, so a
  pack filling it never drags this pack's ops into its bundle
- `src/packs/livestock/run-handler.ts` — livestock filling it: the withdrawal
  refusal and `removeHead`
- `src/packs/run-handlers.ts` — the registry, and the only file that knows both
  packs exist
- `src/packs/production/ops.ts` — reads and writes, takes a `Tx`.
  `completeRun` is the whole slice in one transaction
- `src/packs/production/ai/paperwork.ts` — **the shared read path, and the
  rule: nothing in `ai/` ever writes.** Read its header before adding a third
  consumer
- `src/lib/vision-image.ts` — image normalisation for the vision API. **Moved
  here from `accounting/ai/` in 1e** so a pack need not import a module. Keeps
  the lazy `sharp` import and the production incident that caused it
- `src/packs/production/exemption-ops.ts` — the on-farm cap, counted at read
  time. **Read the header before changing what counts**: four choices are argued
  there, and each could have gone the other way
- `src/packs/production/booking-ops.ts` — dates. **`missedBookings` is the read
  the slice exists for**, and it is two predicates: the day has passed, and
  nothing says what happened
- `src/packs/production/attention/source.ts` — **the first attention source that
  is a pack, not a core module.** Puts a missed date in the morning digest.
  Imports `@/lib/attention-sources/types` and nothing else
- `src/packs/production/processor-ops.ts` — the directory. **Split out because
  nothing in it touches a run, a movement or a cost**, the same reason
  `inventory` split `ledger-ops.ts`. A processor is a standing fact that stays
  true between runs. `sheetOrder` is why the price list sorts in TypeScript
  rather than SQL: the grouping is a rank over an open taxonomy
- `src/packs/production/vocabulary.ts` → `PRICE_UNITS` and
  `COMPUTABLE_PRICE_UNITS`. **Read the header on `PRICE_UNITS` before adding a
  ninth**, and before assuming a unit can be worked out from a run — the split
  between the four that can and the four that cannot is what the fee roll rests
  on
- `src/packs/production/action-errors.ts` — `toResult`, shared by both actions
  files. **It is here because a `"use server"` module may export nothing but
  async functions**, so this could not live in `actions.ts` once a second one
  needed it — see `tests/use-server-exports.test.ts` for what happens otherwise
- `scripts/dry-run-migration.ts` — applies migration files in a transaction and
  rolls back. **`db:generate` emits FKs before the indexes they reference**, so a
  new table pointing at another new table on `(tenant_id, id)` produces a file
  that cannot run; this is how to find that out without a half-migrated database
- `src/packs/production/actions.ts` — `requireTenant` + `requireModuleEnabled` +
  `withTenant({ role })` on every action
- `src/app/dashboard/m/production/[id]/page.tsx` — the run detail route
- `src/packs/inventory/ops.ts` → `carriedCostByLot`, `balanceByLots` — added for
  this pack, and living in `inventory` for the reason every other neighbour read
  does
- `src/packs/inventory/core/costing.ts` → `lotCarried` — the net-of-released
  fold, and the partial-processing bug it prevents
- `src/packs/production/components/carcass-controls.tsx` — the sheet's one
  dialog, used for both adding and correcting. **The form changes shape when a
  carcass is condemned** rather than taking a number it will throw away
- `src/db/schema/production.ts` · `drizzle/0204_aberrant_star_brand.sql` ·
  `drizzle/0205_production_run_bill_allocations_rls.sql` ·
  `drizzle/0203_amused_devos.sql` ·
  `drizzle/0197_amazing_mentallo.sql` ·
  `drizzle/0198_processing_accrual_source.sql` ·
  `drizzle/0199_production_orders_rls.sql` ·
  `drizzle/0200_order_line_price_item_set_null.sql` ·
  `drizzle/0201_services_received_account.sql` ·
  `drizzle/0194_wide_winter_soldier.sql` ·
  `drizzle/0195_production_processor_price_items_rls.sql` ·
  `drizzle/0196_backfill_processor_price_items.sql` ·
  `drizzle/0168_soft_screwball.sql` ·
  `drizzle/0169_production_rls.sql` · `drizzle/0184_rare_the_anarchist.sql` ·
  `drizzle/0185_production_run_carcasses_rls.sql`
- `tests/production.test.ts` · `tests/production-ops.test.ts` ·
  `tests/production-fee.test.ts` · `tests/isolation/production.test.ts`.
  **The accrual's own tests live in `tests/inventory-posting.test.ts`**, because
  this pack's test tenant keeps no books and the whole point of that entry is
  what it does to a set that does

## Decisions & gotchas

- **A YIELD IS NEVER STORED, ANYWHERE, IN ANY FORM.** Not as a factor on a unit,
  not as a percentage on a run, not as a cached ratio. It is measured per run
  and folded at read time. This is `inventory`'s rule as much as this pack's,
  and it is the single most likely thing a future slice will be tempted to
  "optimise".
- ~~**CONDEMNATIONS ARE SLICE 1**~~ — **built 2026-08-23, and slice 0's stated
  reason is what decided the shape.** That note said a `condemned_head` column
  would make the head reconcile while leaving the condemned animal's live weight
  in the denominator, and that *nothing short of per-animal weights can take it
  out*. It was right, so `live_lb` went on the carcass row and there is exactly
  **one** adjustment: sum only the animals that PASSED, on both sides of the
  ratio. Nothing is averaged and nothing is corrected. When the plant did not
  weigh the carcasses the app **declines to adjust**, flags
  `includesCondemned`, and names the gap on screen.
- **THE OVERALL YIELD'S DENOMINATOR IS STILL *EVERYTHING THAT WENT IN*, and the
  kill sheet did not change it.** Slice 0 chose that so a run which lost one to
  condemnation reads as a visibly low yield rather than a normal one with a
  hidden correction, and it is still the right call — a softened headline number
  is how a real loss stops being noticed. What was missing was the explanation
  beside it. The sheet supplies that, and the two stage ratios say where the
  pounds actually went.
- **ONE CARCASS LINE IS ONE DISPOSITION.** "100 birds, 3 condemned" is two rows,
  never one row with a count on it, and that is what keeps `hanging_lb` meaning a
  single thing: a line carrying a hanging weight is a line that passed. **A
  partial condemnation is not a third state** — a bruised quarter trimmed off an
  otherwise good carcass means the carcass PASSED, and what did not come off it
  is a byproduct that failed to materialise, which is slice 3's business.
- **TWO LIVE WEIGHTS, CHOSEN BETWEEN AND NEVER SUMMED.** The input's `weight_lb`
  is the trailer ticket; the carcass's `live_lb` is the plant's scale hours
  later. Animals lose 3–5% in between, so they disagree for a real reason. The
  fold takes the plant's when it covers every passed carcass — because only then
  can a condemnation be left out properly — and the farm's otherwise, and the
  screen prints which. This is `land`'s declared-versus-measured acreage rule
  arriving somewhere with no geometry in it: report both, prefer the one that
  answers the question, never overwrite.
- **A CONDEMNATION'S CAUSE IS OPTIONAL, WHICH IS THE OPPOSITE OF WHAT
  `inventory` DECIDED FOR AN ADJUSTMENT'S REASON.** The difference is who knows
  it. A farm adjusting its own stock knows why; a farm transcribing a plant's
  sheet is reading somebody else's handwriting, and refusing to record the FACT
  of a condemnation until a cause is supplied trades a real number for an
  invented one. `livestock`'s *an unknown is not a zero*, applied to a cause
  rather than a clock. The unstated ones are grouped and counted, never dropped,
  so the causes always add to the count beside them.
- **A FINISHED RUN ACCEPTS A KILL SHEET.** The only write on this pack that a
  complete run does not refuse, and the reason it is safe is that a carcass row
  posts nothing: no quantity, no cost, no movement. The design says the sheet
  arrives days after the run from a party who is not this farm, so a sheet
  enterable only before the boxes landed would be a sheet nobody entered.
  Corrections are in place, following `livestock_weights` — a number typed wrong
  never happened — rather than `production_run_outputs`, which freezes because a
  receipt exists.
- **A QUOTE MAY CROSS INTO COST, AND THE RULE THAT SEEMED TO FORBID IT DOES
  NOT.** *"Only cost stamped on the ledger travels. Anything a batch carries as
  an estimate stays with the batch"* was written about `livestock`'s feeder
  spread — an allocation of money ALREADY POSTED elsewhere, where capitalising
  would double-count. A processing quote is money posted nowhere for a service
  definitely rendered, and its analogue is a delivery ticket, which `inventory`
  capitalises on purpose. The rule's second half — *stamping it would make an
  estimate permanent* — stopped being true when `adjustLotCost` shipped two days
  after it was written. Both halves are still right about the feeder.
- **THE ACCRUAL SHIPS WITH THE FEE OR NOT AT ALL.** A produced receipt credits
  the consumption account because the run's inputs debited it; a fee taken from a
  quote never did, so without `Dr consumption / Cr 2060` a completed run leaves a
  credit in an expense account. Runs completed before a later accrual would carry
  a credit nobody backed, and there is no way to find them afterwards. This is
  the general shape: **an entry that exists to make another entry honest cannot
  be the follow-up PR.**
- **A FEE ON A RUN WITH NO PROCESSOR IS REFUSED**, and it is the unpaid-labour
  decision arriving somewhere new. `processor_id` null means the farm did it
  itself; a figure there would put a made-up wage into the price of the meat
  through the back door, which is the thing *labour is recorded and not costed*
  exists to prevent.
- **HEAD FOR A FEE COUNTS CONDEMNED CARCASSES; HEAD FOR A YIELD DOES NOT.** The
  same rows, folded two opposite ways, and both are right: a yield asks what the
  surviving meat came from, a fee asks what work was done. A plant kills an
  animal and charges for it whatever an inspector decides afterwards.
- **AN INSTRUCTION LINE IS NOT AN UNPRICED LINE.** *"Grind the chuck"* has no
  price, no unit and no minimum. Counting it among the things the fee could not
  work out would make every cut sheet look broken; a line only counts as
  unpriced when it LOOKS like a charge and nothing said how many.
- **A MINIMUM IS A FLOOR AND IS APPLIED LAST.** $0.65 a pound with a $10 minimum
  charges $10 for a 12 lb bird and $13 for a 20 lb one. Adding it to the price —
  the mistake the extractor's prompt is explicitly told not to make — would
  charge $17.80 for the first. A line with a minimum and NO price still costs the
  minimum, because that is the one figure on it anybody is sure of.
- **AN ORDER LINE'S PRICE IS NOT PATCHABLE.** A quote that can be edited after
  the fact is not a quote, and the one question this table exists to keep
  answerable is whether the plant charged more than it said. Somebody who quoted
  the wrong option takes the line off and adds the right one.
- **ONE ROW PER SPECIES, NOT A LIST OF SPECIES ON A ROW.** A sheet line covering
  "Duck & Geese" becomes a duck row and a goose row. The alternative needs an
  array column or a join table, breaks the `(processor, kind, label)` index, and
  turns every filter into an overlap. The duplication is per SPECIES — a batch
  of 1000 chickens is one row — and a plant that later charges differently for
  geese is then one edit rather than a fork in a list.
- **THE READER TAKES THE MOST SPECIFIC ANIMAL THE PROFILE OFFERS.** Given both
  `poultry` and `chicken`, a sheet talking about broilers is chicken. The
  general word is for a sheet being general, and empty is for a charge that is
  not about an animal at all. Filing 46 rows under `poultry` is how a list stops
  being searchable.
- **A BULK MOVE THAT WOULD COLLIDE LEAVES THAT ROW ALONE AND NAMES IT.** Not
  refusing the batch, and not failing with an index name. The label is what
  makes it actionable, because the fix is to rename or remove the one already
  there.
- **CLEARING A PRICE LIST IS SAFE BECAUSE THE ORDER LINE SNAPSHOTS.** What a
  sheet was quoted survives its price item being deleted. If a future change
  makes an order line read through to the price item, replacing a list starts
  rewriting history and this stops being true.
- **A UNIT BELONGS ON THE PRICE, NOT IN A COLUMN NAME**, and this pack paid
  twice to learn it. `cut_wrap_cents_per_lb` meant per pound because of its
  name; a poultry plant quotes cutting per bird, so a second column was added on
  2026-08-23 — and the same sheet lists twelve chicken options at nine prices, so
  a third would have fixed nothing either. `PRICE_UNITS` is closed, and it is
  closed rather than free text because a unit the app cannot interpret is a
  figure it cannot total, compare or explain.
- **A MENU IS A LIST OF ITEMS; A RANGE IS STILL NOTHING.** The half of slice
  1e's rule that changed and the half that did not. Quartered $1.05 and
  eight-piece $1.25 are two rows, because each names a price the plant will
  stand behind. $0.65–$0.90 a pound is one row with a NULL price and the range
  in its note, because averaging the ends invents a figure nobody quoted. A test
  pins both, so a later prompt change cannot start averaging.
- **THE PRICE ITEM'S `category` AND `label` ARE OPEN AND ITS `unit` IS CLOSED**,
  in one table, and the asymmetry is the decision. What a plant charges FOR is a
  trade's prose that differs on every sheet; what a price is PER is arithmetic
  this app has to do. Free text in the first place costs nothing and a taxonomy
  would cost a migration; free text in the second place is the ambiguity the
  table exists to end.
- **THE SUPERSEDED FEE COLUMNS ARE LEFT OUT OF `setHandle`'s CONFLICT `SET`
  RATHER THAN NULLED.** Read by nothing and written by nothing, so they hold
  exactly what `0196` copied out of them until the DROP lands. Nulling them
  would have been tidier and would have destroyed the only copy if the follow-up
  ever had to wait — which is the whole reason expand/contract exists.
- **`killSheet` IS THE ONE PLACE THIS PACK SAYS SOMETHING INDUSTRY-SHAPED**, and
  it is a renameable label declared in `src/packs/index.ts` rather than a rule.
  The STAGE is general — anything that turns a whole thing into parts of it has
  one — but the noun is meat's, and pretending otherwise with a euphemism would
  make every comment in `core/carcass.ts` worse. Declaring it is what makes it
  changeable from the admin screen; the homestead profile sets it, and a bakery
  profile would set something else with no code change.
- **`unknown` BLOCKS, AND THERE IS NO OVERRIDE.** A treatment with no period
  looked up stops a run exactly as a future date does. A farm that genuinely
  knows the period enters it — which is the same act as overriding, and leaves a
  record instead of a hole.
- **THE GUARD IS NOT GATED ON THE PACK BEING SWITCHED ON.** A handler claims a
  lot by finding a row, so a tenant without `livestock` has nothing to find and
  the guard is inert. Where it is not inert is the case that matters: a farm
  that switched `livestock` off still has animals under a withdrawal, and a
  clock that stopped applying because a toggle moved would be the most dangerous
  kind of quiet.
- **`production` DOES NOT REQUIRE `livestock`, AND MUST NOT START.** A bakery
  running runs over purchased flour is a legitimate composition. Everything
  animal-shaped reaches this pack through the declared slot.
- **HEAD LEAVES THROUGH `removeHead`, and the movement still says
  `extension_slug = 'livestock'`.** The slug says which pack owns the record,
  not which one pressed the button. A pen's head ledger that suddenly read
  `production` for the one movement that empties it would be the parallel
  counter this pack model exists to avoid.
- **`processed` IS NOT IN THE REMOVAL PICKER.** `REMOVAL_REASONS` is the full
  set for the fold; `HAND_REMOVAL_REASONS` is what a person may choose. Offering
  it on the lot page would be a way to empty a pen without landing the meat,
  carrying the cost or consulting the clock.
- **AN INPUT REQUIRES A BATCH**, unlike almost everything else in `inventory`.
  The clock is a property of a pen and the accumulated cost is a property of a
  lot; an input with no lot could be guarded by nothing and costed by nothing.
- **ONLY STAMPED COST TRAVELS, and the screen has to say so.** A batch can carry
  cost that was never posted to a movement — `livestock` spreads a shared
  feeder's bill by head × days at read time. That estimate cannot cross into
  stock, because stamping it on a receipt would make an estimate permanent. The
  consequence is that a run carries less than the batch's own page appears to
  say, and the Cost in card explains it in neutral words.
- **THE COST IS STAMPED TWICE AND DERIVED NEVER.** Once on the movement that
  takes stock out, once on the receipt that puts it back. Recomputing either
  later would make last month's batch move under its own feet, which is the rule
  `inventory` established at its slice 1 and the reason FCR comparisons hold.
- **A RUN IS NOT A LOT, so an input's `issued_to_lot_id` stays null.** That
  column means "which lot ate it". The link from the flour to the bread is the
  run, and it is `production_run_inputs`.
- **OUTPUTS DO NOT LAND UNTIL THE RUN IS FINISHED, and that is forced rather
  than chosen.** The pieces of a largest-remainder split only sum to the pot if
  they all land in one transaction.
- **AN OUTPUT IS EDITABLE UNTIL IT LANDS AND FROZEN AFTERWARDS.** The same call
  `livestock` made for weights and treatments: nothing has happened in
  `inventory` yet, so a mistyped box never happened and there is nothing to
  compensate for. Once the receipt exists, the receipt is the fact.
- **`none` IS A COST BASIS, NOT AN ERROR.** Outputs in different units with no
  weights land carrying nothing, and the screen says so. Splitting them by
  whichever number happened to be there would be worse than not splitting them.
- **UNPRICED INPUTS ARE COUNTED AND REPORTED, NOT TREATED AS FAULTS.** Raised
  stock has no purchase basis and an invoice can be late. `inventory` is explicit
  that a model insisting every input has a price will be lied to.
- **LABOUR IS RECORDED AND NOT COSTED.** Crew and hours go on the run per day,
  as the design asks, but nothing turns them into money: that needs a decision
  about what an hour is worth, and the on-farm-versus-processor comparison runs
  straight into the unpaid-labour problem — own hours at zero make on-farm
  processing win on paper and never on Sunday evening. Slice 3 costs them, slice
  5 compares them.
- **Migration `0168` hand-reordered — eighth check, third yes.** Only the two FKs
  pointing at `production_runs` needed it; the four targeting `inventory_*` and
  `assets` were fine where drizzle put them. The rule is *check whether the
  target is created in the same migration*, not *always reorder*. **`0184`
  needed none — ninth check, and applying the rule rather than the habit is what
  gave the answer**: both of its composite-FK targets were created back in
  `0168`, so drizzle's ordering was already correct.
- **An isolation test cannot cover a pack's ops.** That suite builds fixtures
  under `withSystem` on purpose, so this pack needs BOTH files — and every claim
  the slice makes lives in `tests/production-ops.test.ts`.

## Open items

- **`updateOrderAction` is dead, so a cut sheet's head count can never be
  edited** — the value the price band is checked against, on a screen whose own
  copy tells the reader to set it. `updateRunOutputAction` is dead too.
- ~~**`ReadKillSheetDialog` is ungated while `readKillSheetAction` is owner-only**~~
  — **fixed 2026-09-03.** The dialog is gated and the two cut-sheet screens are
  not; see the build log.
- **A processor that is not a vendor is silently absent from billing**, and the
  one empty state that explains it disappears once any other plant has a bill.
- **Eleven distinct "gone" sentences flatten to `That no longer exists.`**
- **No unique index on run `code`**, contradicting a comment that says otherwise.
- **`attachOrdersToRun` has no `requireWrite`.**
- **`removeBooking` deletes what `updateBooking` refuses to cancel.**
- **A processor can never be removed**, and the `Not in use` badge has no writer.
- **Billing differences render unsigned**, so an under-charge reads as an over.
- **`productionRun`, `killSheet` and `cutSheet` are hardcoded in places**, and
  `cutSheet`'s `Order` fallback yields `Start a order` and collides with the
  `orders` route. `processor` is the one clean word in the pack. Fixing any of it
  sweeps `docs/help/production/*.md`.
- **"plant" IS HARDCODED IN ABOUT FIFTEEN STRINGS ACROSS THIS PACK**, where the
  word is the tenant's — the homestead profile calls it *Butcher*. Driving 2f
  fixed the one it introduced and left the rest: `cut-sheet.tsx`'s "the plant
  reads this rather than guessing", `carcass-controls.tsx`'s "Live weight at the
  plant", and the refusal sentences in `core/carcass.ts` and `core/band.ts`.
  Sweeping them is a copy change with no behaviour in it and wants its own PR;
  the pure files also have no `labelFor` to reach for, so their sentences need a
  word passed in the way `inspectionNote` takes one.
- ~~**THE LIVE 108 ROWS ON `Test` STILL CARRY THEIR BANDS IN THE LABEL TEXT.**~~
  **Re-read 2026-08-24, on production, against the deployed code.** 115 recorded
  with Replace on; the plant's list is 108 rows again and **69 of them now carry
  a variant or a band**, including the 24-cell chicken slaughter grid as FIELDS
  — `Cornish x · 501 to 1000 head · 275c`. The screen reads *Slaughter 24 ·
  Cutting 10 · Packaging 3 · Giblets and offal 5 · Extras 3*, bands in numeric
  order, no repeated category and no "Over 1500" note under a row that already
  says *1501 head and over*.
- **NOTHING WARNS THAT A PLANT'S BANDS HAVE A HOLE IN THEM.** `resolveBands`
  reports that no band covers a particular batch, which is the right answer at
  the moment somebody is writing a sheet. What nothing does is look at a rate
  sheet as a whole and say *there is no price between 1500 and 1501* or *these
  two overlap* — that is a check on the LIST rather than on one lookup, it wants
  a screen on the processor page, and it wants a second plant's sheet on file
  before it can say anything useful.

- ~~**NEITHER READER HAS BEEN GIVEN A REAL PHOTOGRAPH.**~~ **The price-list
  reader has** — a real two-page USDA poultry rate sheet, 2026-08-23, and it
  refused correctly in both places a naive reader gets wrong. See the build log.
  **The KILL-SHEET reader still has not**, and it is the harder of the two:
  handwriting on a clipboard rather than a typeset PDF.
- **NOTHING RATE-LIMITS IT, and it spends money per press — CONFIRMED THE
  EXPENSIVE WAY ON PRODUCTION, 2026-08-24.** Accounting's extractor claims a
  15-second per-tenant cooldown slot inside its gating transaction; this has
  none. Two `change` events on the file input started two concurrent reads of the
  same two-page PDF: the first returned 115 rows and the second went on running
  for **another six minutes**, holding `pending` true, which disables Record. So
  the visible symptom of the missing cooldown is not a double charge — it is a
  dialog that has its answer on screen and will not let you accept it. A cooldown
  would fix both halves.
- ~~**THE SCHEMA CANNOT HOLD POULTRY CUTTING.**~~ ~~**What is still not
  representable is a cutting MENU.**~~ **Both closed 2026-08-23** —
  `production_processor_price_items`, one row per priced thing with its own
  unit. What is still not representable, and correctly, is a RANGE.
- **THE THREE FEE COLUMNS ON `production_processor_handles` HAVE NOT BEEN
  DROPPED.** Superseded, backfilled, read and written by nothing, and still on
  the table — the contract half of an expand/contract that must go out as its
  own PR after this one's deploy (ADR 0014). Until it does, `db:generate` will
  keep emitting them and the isolation suite still asserts their CHECKs.
- ~~**NOTHING SELECTS A PRICE ITEM YET.**~~ **Closed 2026-08-23** — the cut
  sheet quotes from it and the fee reaches the meat.
- **A FEE NOT KNOWN AT COMPLETION CAN STILL NEVER BE RECORDED**, and 2d did NOT
  close this. `completeRun` takes the figure and nothing else ever sets it, so a
  run finished before the bill arrived carries `null` — and with `null` there is
  no accrual, so there is nothing for the bill to match against either. 2d
  answers *the accrual was wrong*; it does not answer *there was no accrual*.
  The honest advice is still to wait for the bill before finishing a run, and the
  fix is an edit path for `processing_fee_cents` on a finished run that posts the
  accrual late — which wants the run edit path below to exist first.
- **A RUN'S PLACE CANNOT BE CHANGED AFTER IT STARTS.** There is no edit at all
  for a run — not the location, not the crew, not the notes. It went unnoticed
  until the accrual needed a location and a run started from a booking had none;
  the fallback fixed that case, and a run with no outputs carrying a location
  still has nowhere to get one from.
- ~~**THE PLANT'S BILL IS NOT MATCHED TO THE RUN, so `2060` never clears.**~~
  **Shipped 2026-08-24** — matching, the variance as a number, and the cost
  correction as a separate act. Driven on the dev branch: 2060 fell by exactly
  what was accrued when the matched bill was approved. **What is still true on
  the LIVE `Test` tenant is that its $235.00 is not cleared yet**, and it cannot
  be until Valley Poultry exists as a VENDOR — a bill has to name one, and a
  processor is a role on a party rather than a vendor. See below.
- **NOTHING WARNS THAT AN ACCRUAL HAS BEEN OPEN FOR MONTHS.** The reason has
  changed rather than gone: there is something to close it against now, so a
  digest line WOULD be dischargeable — it just has no horizon yet. A plant that
  has not invoiced in sixty days is worth a nudge; one that invoices quarterly is
  not, and nothing here knows which. It wants a plant's own billing habit before
  it can say anything true, which is the same shape `lead_time_days` is in.
- **A PLANT MUST BE A VENDOR BEFORE ITS BILL CAN BE MATCHED, AND CREATING ONE THE
  ORDINARY WAY MAKES IT WORSE.** `production_processors` is a role on a `parties`
  row and a bill names a `vendors` row; `matchableProcessorBillLines` joins the
  two **through the party**, which is the whole reason the processor table carries
  no name of its own. **`createVendor` calls `createPartyForRole` and therefore
  mints a NEW party every time** — so adding "Valley Poultry Processing" as a
  vendor from the accounting screen produces a SECOND party with the same name,
  and the reconciliation still cannot see the bill. Two rows, same name, no link,
  and nothing on any screen says why.

  It is not a bug in either half: `processor-ops.ts` argues at length that
  matching parties by NAME is the thing to refuse (*"a customer called Miller's
  becoming the plant called Miller's"*), and it is right — so the fix is not to
  loosen the join. The fix is an act that mints a VENDOR ROLE on the party that
  already exists, which `src/lib/parties/role-sync.ts` can already do; what is
  missing is a screen offering it, and a decision about whether it lives on the
  processor page ("they also send bills") or on the vendor picker ("this is
  somebody you already know").

  **THE LIVE `Test` TENANT IS IN EXACTLY THIS STATE**, which is why its real
  $235.00 in `2060` is still uncleared after 2d shipped. Nothing is wrong with
  the books; there is simply no bill it can be matched to yet.
- **NOTHING SPLITS A BILL LINE ACROSS PART OF A RUN.** Ticking a run settles its
  whole accrual, because a processing day has no natural unit to divide — but a
  plant that invoices a deposit and a balance against one kill day cannot be
  represented. A deposit is a booking concept and this may be the wrong place to
  fix it.
- ~~**NOTHING HAS BEEN PRINTED.**~~ **Printed and read 2026-08-23**, by
  injecting the compiled `@media print` rules as screen styles rather than
  opening a print dialog — which is a technique worth keeping, because it makes
  the printed page readable and screenshotable. It found four defects. **What
  has still never happened is an actual printer**, so nothing has checked page
  breaks on a sheet longer than one page.
- **A LONG SHEET'S PAGE BREAKS ARE UNTESTED.** Every sheet driven so far fits
  on one page. A twelve-option chicken sheet will not, and nothing says a line
  may not break across pages or that the header repeats.
- ~~**A SHEET STILL HAS NO "HANDED OVER" STATE.**~~ **Half closed 2026-08-23** —
  `production_orders.printed_at`, stamped by the print button, and shown on the
  new list. What it does NOT record is whether the plant received it: a sheet can
  be read off a screen at the counter or photographed, so null means "nobody
  pressed Print here" and the copy says exactly that. A real handed-over state
  wants somebody to have missed one first.
- **A SHEET CANNOT BE REORDERED.** Lines sort by the sheet's own grouping and
  then alphabetically, which is right for reading against a rate sheet and
  arbitrary for a plant working down a list. Nobody has asked yet.
- **NOTHING KNOWS THE BREED, so the variant is chosen on the line.** The order
  carries `kind` (chicken) and nothing carries "Cornish Cross" — the picker
  offers the variants a plant prices and somebody picks one. Reaching into
  `livestock` for a lot's breed would make this pack depend on that one, which is
  a P5 question and not this slice's; it also would not be enough, since a batch
  can be mixed and the plant prices the batch.
- **AN ORDER LINE CANNOT BE MOVED BETWEEN SHEETS.** On a half-beef sale where
  the customer changes their mind about which half something is on, the answer
  today is remove and re-add — which loses the quote it was written at.
- **THE ITEMISED SHEET IS NOT COMPARED BETWEEN TWO PLANTS**, which is the
  question the farm actually has and the reason the figures were worth
  structuring. It wants slice 5's screen; the data is now shaped for it, and
  before it can say anything true it needs the units reconciled — one plant's
  per-bird cutting fee against another's per-pound one is not a comparison
  without a weight.
- **THE FILE IS NOT KEPT.** The design says "the kill sheet as a DOCUMENT" and a
  kill sheet is a retained record; the bytes are currently read, sent and
  dropped. Filing it means `production` importing the Documents module — the
  first pack to import a core module — which is an architectural decision that
  should be made deliberately rather than as a side effect of an AI feature.
- **THE PRICE-LIST READER WILL HAPPILY REPLACE A PRICE NOBODY MEANT TO CHANGE.**
  Both `setHandle` and `setPriceItem` are upserts, so re-reading a sheet
  overwrites what is on file for a matching row. The dialog says so in a
  sentence; it does not show the price that is about to be replaced beside the
  new one, which is what it should do — and it matters more now than it did with
  three fee columns, because a re-read of a thirty-line sheet silently restates
  thirty prices.

- ~~**BOOKING A DATE IS THE NEXT SLICE.**~~ **Shipped 1c.** What it did NOT do:
  **a booking is not on the calendar.** `schedule_item_links` takes an
  `extension_slug` and an `entity_type`, so a booking could become a real
  calendar event without a cross-module column — it does not yet, and a kill day
  is exactly the thing somebody expects to see in a week view. The attention
  source covers the "do not lose it" half; the calendar covers the "see it beside
  everything else" half, and only the first is built.
- **NOTHING SAYS "YOU SHOULD BE BOOKING NOW."** `production_processors.lead_time_days`
  exists and is filled in (300 for Miller's), but no obligation is derived from
  it. That would be advice rather than an obligation — a digest that offers
  advice gets muted — so it wants a screen, not a digest line, and probably wants
  next season's plan to exist before it can say anything true.
- ~~**1c HAS NOT BEEN DRIVEN IN A BROWSER.**~~ **Driven on `Test` 2026-08-23** —
  a future date and a past one, `startRunFromBooking`, the capacity warning and
  the `What needs you` line all exercised; see the build log. **What is still
  unexercised: cancelling a date, and the refusal that stops a booking which
  already became a run from being cancelled.** Neither has run outside a test.
- ~~**SLICE 1b HAS NOT BEEN DRIVEN IN A BROWSER.**~~ **Driven on `Test`
  2026-08-23** — two butchers stood up, one USDA doing cattle and one custom
  exempt doing birds; see the build log. It found one defect (a hardcoded word in
  the inspection note) and confirmed the upsert corrects rather than duplicates.
  **The rename is still unexercised**: nothing has renamed a processor, so the
  write that goes to `parties` and can refuse on a version conflict this pack did
  not raise has never run outside a test. So is `Remove`, on either child.
- **A CUT CAN NAME A KIND THE PROCESSOR DOES NOT TAKE.** The *Only for* dropdown
  offers every kind in the profile, so "Dry-cured bacon · Swine only" now sits on
  a butcher whose only handle is cattle. Nothing flags it. The honest fix is a
  warning rather than a refusal — you can learn what a plant makes before
  recording what it takes — and nothing reads these rows yet, so it waits.
- **NOTHING LINKS A RUN TO THE PROCESSOR THAT DID IT**, so the measured half of a
  processor's rating cannot be computed at all — not merely unbuilt. Dressing
  percentage, condemnation rate and turnaround per processor all wait on the
  booking link. The screen says so in words; do not replace that with an empty
  chart, which reads as "no difference" rather than "not asked".
- ~~**SLICE 1a HAS NOT BEEN DRIVEN IN A BROWSER.**~~ **Driven on `Test`
  2026-08-23** — the kill sheet transcribed line by line on the finished
  Butchering run, including the condemned line. Nothing was found; see the build
  log entry. What is still unexercised is narrower and worth naming: **`Correct`
  and `Remove` were never clicked**, so the two audited edit paths
  (`production.carcass.corrected`, `production.carcass.removed`) have never run
  outside a test — and editing a condemnation back to a pass is the write those
  audit rows exist for. `SHEET_OVER_ACCOUNTED` and `ALL_CONDEMNED` have also
  never been seen on a screen.
- **NOTHING EXTRACTS A KILL SHEET FROM A PHOTOGRAPH YET**, which is the other
  half of what the design calls kill-sheet capture and is slice 1b. The rows
  exist to extract into now, which is the ordering that made 1a first. The
  design is explicit about the shape: AI extracts, a human confirms, then it
  posts — the *compute-and-commit* case, and a port of what accounting already
  does with bills and Documents already does with text.
- **A CONDEMNED CARCASS'S COST STAYS IN THE POT.** The pen's accumulated cost
  crossed onto the run when the animals left, and the roll splits all of it
  across the outputs — so the boxes that DID come off the line carry the
  condemned bird's share of the feed. That is arguably right (the loss is a real
  cost of producing what survived) and arguably wrong (it makes the per-pound
  figure include an event that had nothing to do with cutting), and it is a
  genuine accounting decision rather than a column. Nothing on the screen says
  which way it went, which is the part that is definitely wrong.
- **A LOW CONDEMNATION RATE IS NOT COMPARED AGAINST ANYTHING.** The rate is on
  the run and on the list, and whether 3% is good is exactly the question the
  advisor could answer from this farm's own history — the profile's AI thesis,
  and the digest is where it would go. Nothing feeds it there yet.
- **THE SHEET RECONCILES AGAINST HEAD, NOT AGAINST WEIGHT.** A run whose inputs
  are counted gets `SHEET_INCOMPLETE`; a run whose inputs are stocked by mass
  gets no reconciliation at all, because there is no head to count. That is
  correct and it means a mass-stocked meat item — a pig bought by the pound —
  has an unpoliced sheet.
- **NEVER PLURALISE A RENAMABLE LABEL.** Recorded here because it will be
  tempting again: `productionRun` is a word the tenant owns, the homestead
  profile calls it *Batch*, and `+ "s"` produced "No batchs yet" on the first
  screen anybody opened. Keep these words singular and rewrite the sentence.
- **An input cannot be taken off a run.** A pen entered by mistake has left the
  pen, and unwriting that movement would rewrite what happened — the rule a
  movement exists under. A compensating entry needs a decision about which kind,
  which is `inventory` slice 2's adjustments. Same shape as `livestock`'s
  "removing a treatment leaves an orphaned cost".
- **A run cannot be abandoned or reopened.** A started run with no outputs sits
  open forever, holding its inputs' cost in a state nothing clears.
- **A run is not a cost object.** Lots sync into `dimension_members`; runs do
  not, so "what did this bake cost" is a page rather than a P&L dimension. It
  should probably become one, and that is an accounting decision rather than a
  column.
- ~~Dressing percentage and cutting yield are not told apart~~ — **closed
  2026-08-23.** Both are folded in `core/carcass.ts` off the carcass stage, and
  each refuses with a stated reason rather than approximating.
- **Nothing compares two runs.** Processor comparison is the differentiated
  report and it needs history — the design's own honest caveat is that
  separating processor effect from animal effect takes several runs, and at 2–4
  beeves a year that is a multi-year answer. Collection starts now and is free
  thereafter.
- **Volume outputs cannot carry a weight automatically.** A mass-stocked item
  derives its pounds from the quantity; gallons do not, because there is no
  factor between them that does not depend on what is in the bucket. Milk
  therefore always needs its weight typed, and nothing on the form explains
  that yet.
- **The run list fetches every summary row.** Three grouped queries whatever the
  run count, but uncapped — fine at twenty runs, wrong at a farm with years of
  history. Slice 1a added the third and did not make the cap any less overdue.
- **Nothing links a run to its kill sheet as a FILE — the photograph, the PDF,
  the posted original.** Slice 1a took what the sheet SAYS; the sheet itself is
  still unattached, and for inspected meat the paperwork is a retained record. It
  is the same port as the extraction above and belongs with it in slice 1b.
- **Nothing warns that a run is about to consume the last of a pen**, or that a
  withdrawal on a pen somebody is planning around clears next week. Both are the
  deviation-surfacing the design wants and neither is a rule anybody is asked
  about yet.
