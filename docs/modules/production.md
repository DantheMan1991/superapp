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
| 2d | The plant's BILL, matched to the run: clear the accrual and make the variance a number | |
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

**Slices 0 to 1d are in [production-build-log.md](production-build-log.md)**,
swept there on 2026-08-23 under the dossier-length rule in `AGENTS.md` — this
file had reached 1,658 lines and the log was 60% of it. Nothing was superseded
by the move: the two live weights, the condemnation adjustment, the withdrawal
guard, the booking model and the migration that never ran are all argued there,
and that is the file to read before changing any of them.

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

**AND THE REFUSAL THAT LOOKED LIKE A BUG WAS NOT ONE.** Completing the run
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

Migration `0202`. 4 new tests. Everything else in this entry is copy or a picker.

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
| `production_processor_price_items` | **One priced thing off a rate sheet** — the menu, as data | Composite FK to the processor (CASCADE). UNIQUE per `(processor, kind, label)` — two rows for one named option would be two prices with nothing to say which is current, and it is what makes next year's sheet re-readable over this year's as a correction. **`unit` is CLOSED** (`head`, `live_lb`, `hanging_lb`, `finished_lb`, `package`, `box`, `flat`, `hour`) and is the whole point: $1.05 is five different amounts of money across them. `category` and `label` are OPEN, the same call `..._cuts` made about cut names. `price_cents` NULL is "call them", never zero; `minimum_cents` is a floor, not a price. Still a QUOTE — what was paid is a bill in `payables` against the same party
| `production_processor_cuts` | What a processor will produce | Composite FK to the processor (CASCADE). Free text by design — cut names are a trade's prose and every plant's list differs. `kind` empty means "anything they take". This is CAPABILITY; the per-animal cut sheet is a later slice |

| `production_orders` | **The cut sheet** — what this farm asked one plant to do with one lot of animals | `tenant_id`, FORCE RLS. Composite FKs to the processor, the booking and the run, **all CASCADE**; `booking_id` is where it began and `run_id` is what it became, and the CHECK asks for at least one — a sheet attached to nothing is a sheet for a day that does not exist. **No unique index**: the design's *one animal, two cut sheets* is the ordinary case, and `title` tells them apart until `retail`'s commitments can name the customer |
| `production_order_lines` | **One line of a sheet — an option chosen, or an instruction given** | Composite FK to the order (CASCADE) and to the price item (**`SET NULL (price_item_id)`**, PG 15's column-list form — a line is a SNAPSHOT and must survive the rate sheet being tidied). `unit_price_cents`, `unit` and `minimum_cents` are **stamped and never re-read**. A line with no `price_item_id` is an INSTRUCTION and carries no money. CHECK: a price must say what it is per; a unit with no price is allowed. `quantity` NULL means *work it out* on a computable unit and *nobody has counted* on the rest |
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
- `src/packs/inventory/ledger-ops.ts` → `postServiceAccrual`,
  `resolveServicesAccruedAccount`. **The entry that makes the output receipt
  honest**, and the argument for `2060` over `2050`
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
- `src/db/schema/production.ts` · `drizzle/0197_amazing_mentallo.sql` ·
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

- ~~**NEITHER READER HAS BEEN GIVEN A REAL PHOTOGRAPH.**~~ **The price-list
  reader has** — a real two-page USDA poultry rate sheet, 2026-08-23, and it
  refused correctly in both places a naive reader gets wrong. See the build log.
  **The KILL-SHEET reader still has not**, and it is the harder of the two:
  handwriting on a clipboard rather than a typeset PDF.
- **NOTHING RATE-LIMITS IT, and it spends money per press.** Accounting's
  extractor claims a 15-second per-tenant cooldown slot inside its gating
  transaction; this has none, so a double-click is two calls.
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
- **THE PLANT'S BILL IS NOT MATCHED TO THE RUN, so `2060` never clears.** The
  third row of the worked entry in the build log is not built: the accrual goes
  on and nothing takes it off, so the balance grows by every run that names a
  fee. That is *deliberately* a useful state in the meantime — a non-zero
  balance per plant is the list of processing nobody has invoiced you for, the
  same self-surfacing shape `missedBookings` has — and it is still an open
  liability that wants a screen. Slice 2d, and it is what turns "they charged
  more than they quoted" from two numbers a person compares into one number the
  app reports.
- **NOTHING WARNS THAT AN ACCRUAL HAS BEEN OPEN FOR MONTHS.** Same reason: until
  the bill can be matched there is nothing to close it against, so a digest line
  would be an obligation nobody can discharge.
- ~~**NOTHING HAS BEEN PRINTED.**~~ **Printed and read 2026-08-23**, by
  injecting the compiled `@media print` rules as screen styles rather than
  opening a print dialog — which is a technique worth keeping, because it makes
  the printed page readable and screenshotable. It found four defects. **What
  has still never happened is an actual printer**, so nothing has checked page
  breaks on a sheet longer than one page.
- **A LONG SHEET'S PAGE BREAKS ARE UNTESTED.** Every sheet driven so far fits
  on one page. A twelve-option chicken sheet will not, and nothing says a line
  may not break across pages or that the header repeats.
- **A SHEET STILL HAS NO "HANDED OVER" STATE** — see below; driving did not
  change that, but printing one made it more obviously missing, because the
  moment you print is the moment you would want it recorded.
- **A SHEET CANNOT BE REORDERED.** Lines sort by the sheet's own grouping and
  then alphabetically, which is right for reading against a rate sheet and
  arbitrary for a plant working down a list. Nobody has asked yet.
- **A SHEET HAS NO "HANDED OVER" STATE.** Whether the plant actually got it is
  not recorded, so a run can complete against a sheet nobody sent. It wants a
  date rather than a status, and it wants somebody to have missed one first.
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
