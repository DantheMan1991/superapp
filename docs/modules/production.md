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
| 2b | The cut sheet as an order: pick the items for a batch, print it for the plant | |
| 2c | **The processing fee reaches inventory cost**, per plant — flat per animal plus per pound, accrued at completion and trued up by the bill | |
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

### 2026-08-23 — Slice 1d driven on `Test`, and the meat already in the freezer (`claude/the-meat-already-in-the-freezer`)

All three parts render, and the one that had never been seen before is the
counter: **"Done here this year · Poultry — 100 of 1000 — 900 left of 1000 this
year."** That number is the whole three-party chain working — `livestock` said
the lot was poultry through the P5 slot, the profile said the cap was a thousand,
and `exemption-ops` multiplied them. Nothing is stored, so nothing can drift. No
badge appears at 10%, which is correct: the warning starts at 80%.

The finished run reads **Finished · Done here · Not inspected**, and *What came
out* now carries the sentence that governs it: *"No inspection. What may be done
with this is narrow and varies by state — typically direct to the person eating
it, in state, with no resale."* It states the shape of the restriction and
asserts no state's specifics, which is the line the design draws.

**AND DRIVING IT FOUND A HALF-STAMPED STATE, which is the dangerous shape.**
0190 backfilled the RUN's inspection but not the lots': every lot that landed
before this slice shipped had `metadata = {}`, while every lot landing after it
carries the eligibility. A reader finding the key on newer lots and nothing on
older ones has to guess what an absent key means, and the two available guesses
are "inspected" and "not inspected" — one of which is the enterprise-ending
answer. `retail`'s guardrail is the next consumer of exactly this key.

`0191` backfills them from the run's own inspection, and is idempotent by
`NOT (metadata ? 'production')` — re-running changes nothing, and it can never
overwrite a stamp the application wrote. It is filling a gap, not claiming
authority over lots that already have an answer. Both databases verified: every
landed output lot now reads `{"inspection":"uninspected","runId":"…"}`.

**Still unexercised:** a run that was actually SENT OUT. Everything driven so far
is on-farm, so `Sent out · <plant>`, an inspection inherited from a processor
rather than defaulted, and the exemption counter correctly *not* counting a
sent-out run have all been tested but never seen.

### 2026-08-23 — Slice 1d: which path the meat took (`claude/which-path-the-meat-took`)

**THE PATH IS A NULLABLE FOREIGN KEY, AND THAT IS THE WHOLE MODEL.**
`production_runs.processor_id` names the plant, or is null because this farm did
it itself. The design put the path on the run and said why in one line: *"The
same batch of birds may be processed on-farm uninspected or sent out to a
butcher, decided at booking. Modelling the path on the animal or the species is
wrong."* Null is not missing data here — it is the other half of the choice, and
`pathOf()` derives the answer rather than a second column disagreeing with the
first.

**INSPECTION IS STAMPED WHEN THE MEAT LANDS, and it is the second derived thing
in this table that is stored.** `cost_basis` was the first, for the same reason.
A plant's status can be corrected, lapse or be upgraded, and re-deriving this
later would silently change what a box already in somebody's freezer may legally
be sold as. **What was true on the day is what governs the meat**, so it is
written down on the day. A run with no processor stamps `uninspected`: the farm
did it, and nothing inspected it.

**THE LOT INHERITS IT**, into `inventory_lots.metadata` — the P2 bag, not a
column, because `inventory` must not learn what an inspection is. That is the
line the design calls existential: *"`retail` should refuse to list a lot into a
channel that is not legal for it. Selling uninspected product through the wrong
channel can end a poultry enterprise, and nothing on the market prevents it."*
**`retail`'s refusal is the next consumer and is NOT built** — what exists now is
the fact travelling with the meat, and a sentence beside the boxes saying what it
means.

**THE EXEMPTION COUNTER IS THREE PARTIES WHO EACH KNOW ONE THING.** The design
says the pilot *"sits at exactly 1,000 birds — i.e. already managed to a line"*,
and that recording runs yields the count for free. It does:

- **`livestock` says which species is in a lot**, through a new `kinds()` method
  on the P5 slot. It is not told why it was asked.
- **the profile says which kinds carry a cap** — `packConfig.production.exemptions`,
  `[{ kind: "poultry", annualHead: 1000 }]`. Only poultry is listed, deliberately:
  there is no equivalent head-count exemption for beef or pork, and inventing one
  would be worse than omitting it.
- **`exemption-ops.ts` multiplies them.** Nothing is stored, so nothing can
  drift, and a tenant with no livestock has no handler claiming a lot — the whole
  feature is silently inert, which is correct for a bakery.

Four counting choices, each of which could have gone the other way, are argued in
that file's header: **inputs not outputs** (the limit is on birds, not packages),
**complete runs only**, **`processor_id IS NULL`**, and **`started_on` not
`completed_on`** (a run finished in January over December's birds belongs to
December). It warns at **80%**, and that number is a lead time rather than a round
one: a processor books six to twelve months ahead, so being told at 999 is being
told far too late to send the next batch out instead.

**THREE THINGS THE MIGRATION NEEDED BY HAND**, all worth knowing before the next
one:

- **`drizzle-kit` wanted to DROP and re-ADD four unrelated constraints** on
  `audit_log`, `interview_sessions`, `schedule_items` and `work_items` — snapshot
  churn, not a change. Checked against production with `pg_get_constraintdef`:
  all four already had exactly the definition it wanted to re-add. Dropping three
  other modules' foreign keys inside a production-pack migration is risk with no
  upside, so they were stripped.
- **A backfill had to run before the CHECK.**
  `production_runs_finished_states_inspection` says a complete run must say how
  it was inspected, and every run that completed before this migration says
  nothing — so the migration fails on every database that has one. `uninspected`
  is truthful for all of them: none had a processor, because there was no column
  to name one in.
- **`ON DELETE` was left off `production_runs_processor_fk` on purpose**, so it
  is NO ACTION: a plant that has processed your animals cannot be deleted out
  from under the record. `SET NULL` was not available anyway — composite FK, same
  trap as 1c.

**And a bug in two other modules fell out of reading that churn.**
`schedule_items_parent_fk` and `work_items_parent_fk` are composite FKs declared
`ON DELETE SET NULL`, which is the exact shape that cannot work. Verified on the
dev branch inside a rolled-back transaction: deleting a parent schedule item that
has a child fails with *"null value in column tenant_id violates not-null
constraint"*. Live on production, out of scope here, and raised as its own task.

### 2026-08-23 — Slice 1c driven on `Test`, and two things reading it out loud found (`claude/booked-for-in-18-days`)

Two dates booked by hand on the live site, chosen so the slice's own claim could
be tested rather than described: **one ahead** (Miller's, 20 cattle, 2026-09-10,
$200 down, confirmed) and **one already in the past** (Valley, 180 birds,
2026-08-18, no deposit).

**THE WHOLE ARGUMENT HELD.** The past date landed in **Nothing recorded**, above
everything else, with *Start the batch* beside it. Starting the batch moved it to
**Done with**, the badge became *Went ahead*, the actions collapsed to *Open the
batch* — no Edit, no Remove, because a date that became a processing day is no
longer editable — and the section vanished. Self-clearing, without a status
anybody set.

**AND IT REACHED `What needs you`**, which is the first time a PACK has put a
line there: *"Miller's Custom Meats is booked in 18 days · 20 head cattle ·
Soon"*, with *Email me this each morning* switched on. The missed one was gone
from that list too, in the same act that cleared it from the page.

**The capacity warning behaved as designed**: 20 head against Miller's stated 8 a
day produced *"They told you 8 a day, and this is 20… so nothing is stopping
you"*, and **Book it stayed enabled**. Advisory, not a refusal. It also carries
into the list as *"Cattle · they said 8 a day"*. Kinds in the form were correctly
scoped to what each plant actually takes — Miller's offered only Cattle, Valley
only Poultry — and an unpaid deposit rendered as an em dash, never `$0.00`.

**TWO DEFECTS, BOTH ONLY VISIBLE BY READING THE SCREEN:**

- **"Miller's Custom Meats is booked FOR in 18 days."** `describeBookingDate`
  returns a phrase that already carries its own preposition ("in 18 days", "5
  days ago") or none at all ("today", "tomorrow"), so anything placed in front of
  it has to work with all four. "is booked" does; "is booked for" does not. The
  missed variant read "was booked for 5 days ago" for the same reason.
- **Starting a batch defaulted its date to TODAY.** On the one screen whose
  entire purpose is catching up with a date that already went by — it put 23
  August on a kill that happened on the 18th. It defaults to the booked day now.

Neither is a logic error and both survived tsc, eslint, 63 pure tests and 38
isolation tests. They are the class the dossier keeps recording: **the defects
that only exist in the sentence a person reads.**

### 2026-08-23 — Slice 1c: the date you cannot lose (`claude/the-date-you-cannot-lose`)

**THE SCARCE RESOURCE FINALLY HAS A ROW.** The design has said since 2026-08-13
that slaughter dates are it, that plants book six to twelve months ahead with
deposits involved, that losing a date is expensive, and that booking one is *"a
first-class feature, not a date column on an animal"*. `production_bookings` is
that feature. A column on a pen could not hold a deposit, could not survive the
pen being split across two dates, and could not exist before the animals do —
which is exactly when the date has to be booked.

**A BOOKING IS A PLAN; A RUN IS THE FACT — and that split is the whole design.**
`run_id` is what the booking became, null until the day happens, and there is
deliberately **no `delivered` or `completed` status**. A status somebody must
remember to advance is a second answer to a question `run_id` already answers,
and the two would disagree within a season. What the split buys is the item this
slice exists for, and it is derived rather than stored:

> **a date that has passed with no run recorded against it and no cancellation.**

Either the animals went and nobody wrote it down — so the yield, the cost and
the traceability chain for that kill are all missing — or the date was lost.
Nothing has to remember to flag it, and it clears two ways, both of which are the
correct thing to do: record what happened, or cancel the booking. That is exactly
the self-clearing shape [notifications.md](notifications.md) requires.

**THE FIRST ATTENTION SOURCE THAT IS A PACK.** `src/packs/production/attention/source.ts`
puts those rows in the morning digest and on *What needs you*, which is what
makes the bookings page something nobody has to remember to open. Three notes on
it:

- **It goes to everybody, and that costs something.** A booking has no assignee
  and inventing one would be a column nobody fills — a processing day is two or
  three people and the design says so. So a three-person farm gets the line three
  times. Accepted, because the failure in the other direction is a kill date
  nobody was told about, and because it disappears for all three the moment any
  one of them acts.
- **The horizon is 21 days, three times Work's seven.** A livestock number, not a
  software one: animals at weight, a trailer, and a withdrawal that has cleared —
  the last of which cannot be fixed in the final week.
- **No rule in `eslint.config.mjs` changed.** Its module-isolation patterns are
  generated from `MODULE_SLUGS`, which covers `src/modules/**` only, and the
  registry is the documented composition root whose job is naming concrete
  implementations. The source still imports `types.ts` and nothing else.

**`startRunFromBooking` IS WHAT MAKES A PROCESSOR MEASURABLE AT ALL.** Slice 1b
could record what a plant charges and what the farm thinks of it, but could not
compute one measured figure, because nothing joined a run to a plant. Booking →
run is that join. It is **not** total yet — it covers runs that came from a
booking — and slice 1d, which puts the processing path on the run itself, is what
finishes it. Any screen showing a measured comparison before then has to say
which runs it covered. The run starts EMPTY on purpose: a booking made in March
cannot know which pen will be ready in October, and carrying the promised head
over as a real input would be this pack inventing a movement nobody made.

**THE CAPACITY WARNING IS A SENTENCE, NEVER A REFUSAL.** Promising twenty hogs to
a plant that said eight a day is often correct — two days, a stale figure, or an
exception they agreed to. This app has no standing to overrule a farm about what
another business agreed to, so it says the two numbers disagree. Same call `land`
makes between declared and measured acreage.

**AND A COMPOSITE-FK GOTCHA WORTH CARRYING, caught by a test that was written to
prove the opposite.** `production_bookings_run_fk` was first declared
`ON DELETE SET NULL`, on the elegant argument that a booking should outlive the
run it became because it records a date held and a deposit paid. It does not
work: **on a COMPOSITE foreign key, `SET NULL` nulls *every* referencing column,
`tenant_id` included, and that column is `NOT NULL`** — so the delete fails
outright rather than clearing the link. (PG 15 added `SET NULL (run_id)`;
drizzle's `onDelete` takes an action, not a column list.) It is CASCADE now, and
that is also the *right* answer rather than merely the working one: **nothing in
this app deletes a run**, so the elegant argument was defending a state nothing
can reach — the same mistake this pack removed a guard for once already.

### 2026-08-23 — Slice 1b driven on `Test`, and the word the note forgot (`claude/the-word-the-note-forgot`)

Two butchers stood up by hand on the live site, chosen to be the comparison the
design says a farm actually makes:

| | Miller's Custom Meats | Valley Poultry Processing |
| --- | --- | --- |
| Inspection | USDA, EST 4712 | Custom exempt |
| Takes | Cattle, 8/day | Poultry, 400/day |
| Kill fee | $105.00 a head | $4.50 a head |
| Cut and wrap | $0.90 a lb | *not quoted* |
| Label | Yours | Not established |
| Books ahead | 300 days | — |

**"Some do only poultry" is now a row rather than a sentence**, which was the
whole argument for putting `handles` in its own table.

**ONE DEFECT, AND IT IS THE EXACT MISTAKE THIS SLICE ARGUES AGAINST.** The note
under the inspection field read *"Nobody has recorded how this **processor** is
inspected"* — on a screen headed **Butcher directory**, under a button saying
*Add a butcher*, beside a caveat that already said "butcher". Every other string
resolves through `labelFor`; this one had the pack's default baked into it, in
the one paragraph a person actually reads. A pack that declares a renameable
word and then hardcodes it there has not really made it renameable.
`inspectionNote(status, word)` now substitutes `{word}`, and the test asserts
that **no** rendered note contains "processor" when the tenant's word is
something else — which catches the next one written the same way.

**Everything else held.** The upsert corrected rather than duplicated: editing
Miller's cattle fee from $95 to $105 left one row, and the audit log shows it as
two `handle_set` entries on the same `handleId` — 9500 then 10500. That is the
column earning its place: *when did the quote change* is answerable, and the
prose (`good_at`, `price_notes`) is correctly absent from the meta. An unquoted
fee rendered **"Cut and wrap not quoted"** and never `$0.00`. `Cattle` came
pre-selected from the profile's `processorHandles`, and the kind was locked on
edit.

**Worth knowing, not yet fixed:** the *Only for* dropdown on a cut offers every
kind in the profile, not just the ones this processor takes — so "Dry-cured
bacon · Swine only" now sits on a butcher whose only handle is cattle, and
nothing flags it. Arguably right (you can learn what they make before recording
what they take) and arguably a record that contradicts itself. Left as it is
because the honest fix is a warning rather than a refusal, and there is nothing
yet reading these rows that would be misled.

### 2026-08-23 — Slice 1b: the processor directory, and the roadmap gap it closed (`claude/the-processor-and-the-date`)

**THE DESIGN CALLED BOOKING A DATE "THE LOUDEST UNMET NEED IN SMALL LIVESTOCK
PRODUCTION" AND THE ROADMAP HAD NO SLICE FOR IT.** Processors appeared once, at
slice 5, as a *report* — "processor comparison, throughput analysis, needs
history". Nothing created the processor record and nothing held a date. That is
the gap this slice starts closing; 1c is the dates themselves.

**A PROCESSOR IS A ROLE ON A PARTY, WHICH THE DESIGN HAD ALREADY SETTLED** —
*"the party spine already holds it, no new contact model."* So
`production_processors.party_id` points at `parties`, the same spine `customers`
and `vendors` hang off, and the plant that both processes your animals and
invoices you is one party with two role rows.

**AND THE NAME IS NOT IN THIS TABLE.** `customers` and `vendors` each still
carry their own `name` beside the party's — `role-sync.ts` calls that the "both
exist" stage of an expand/deploy/contract nobody has finished — and there was no
reason to open a third copy of that problem. A rename here updates the party and
nothing else, so this table cannot disagree with the rest of the app.

**THREE TABLES, AND THE SPLIT IS WHAT MAKES "SOME DO ONLY POULTRY" A QUERY.**
A plant that kills birds and a plant that kills everything differ by how many
`production_processor_handles` rows they have, not by a column. Price lives on
that row too, per kind, because that is how plants quote: a kill fee per head and
cut-and-wrap per pound, both different for a beef than for a hog. A single price
on the processor would have to pick one animal and be wrong about the rest.

**INSPECTION IS NOT A BADGE AND IT IS NOT A BOOLEAN.** Five values, and the fifth
is the one that matters: `unknown` is a real answer. A farm that has not asked is
not a farm that has been told no, and a boolean would turn the second into the
first on the very screen a legal question gets answered from. `custom_exempt` is
its own value rather than a flavour of uninspected, because it is inspected for
the owner and may not be resold — precisely the distinction
[`retail`'s channel guardrail](retail.md) will have to make. Each status carries
a sentence describing the SHAPE of its restriction and asserts no state's
specifics, which vary and are not this app's to declare.

**THE RATING IS SPLIT IN TWO ON PURPOSE, AND ONLY HALF OF IT EXISTS YET.**
`rating` and `good_at` are somebody's opinion, stored as one, and they are the
only assessment that works on day one. What the app can COMPUTE — dressing
percentage, condemnation rate, turnaround — is a ratio over runs and is therefore
never stored, by the rule that keeps a yield out of every other table here. **The
computed half is not merely unbuilt, it is not yet possible**: nothing says WHICH
processor did a given run, because that link arrives with the booking. The screen
says so in words rather than showing an empty chart, since a chart with no data
reads as "no difference" instead of "not asked". The design's own caveat applies
when it does arrive — yield varies by animal as well as by plant, so a computed
figure is evidence about a processor, never a verdict on one.

**TWO THINGS THIS SLICE CAUGHT THAT WERE NOT ABOUT PROCESSORS AT ALL:**

- **`drizzle-kit` generates an unrunnable migration whenever a new table
  references another NEW table on `(tenant_id, id)`.** It emits every CREATE
  TABLE, then every FOREIGN KEY, then every index — so the composite FK is added
  before the unique index that makes those columns referenceable, and Postgres
  refuses with *"there is no unique constraint matching given keys for referenced
  table"*. `0186` was hand-reordered. Slice 1a asked itself this question and the
  answer was no, because both of ITS targets already existed; this is the first
  time in the pack that the answer was yes. `scripts/dry-run-migration.ts` is new
  and is how it was found — it applies migration files in a transaction and rolls
  back, so a broken file is a message rather than a half-migrated database.
- **`toResult` moved out of `actions.ts` into `action-errors.ts`.** A
  `"use server"` module may export nothing but async functions, so the moment a
  second actions file needed that mapping the choice was a shared module or a
  second copy — and two copies of the mapping from error codes to sentences is
  how two screens start describing the same refusal differently. Its `FORBIDDEN`
  message is now "Only an owner can change this", where it used to name starting
  and finishing a run; it serves both files.

Writes are OWNER here, and the contrast with slice 1a is deliberate: transcribing
a kill sheet is a chore, but recording what a plant charges and what you think of
it is a decision. Every write is audited, and the prose never is — `good_at`,
`notes`, `labelling_notes` and `price_notes` stay in the row, the same rule the
condemn reason follows.

### 2026-08-23 — Slice 1a driven on `Test`, and for once it found nothing (`claude/driven-on-test`)

**THE FIRST KILL SHEET ANYBODY HAS EVER TRANSCRIBED IN THIS APP**, entered by
hand on the live site against the finished Butchering run (BATCH-2, 100 head in,
618.0 lb on the trailer, 468.0 lb packaged). Three lines, deliberately chosen to
walk the sheet from useless to answerable:

| Line | Head | Live (plant) | Hanging | Outcome |
| --- | --- | --- | --- | --- |
| 1 | 60 | 368.0 lb | 292.0 lb | Passed |
| 2 | 37 | 226.5 lb | 180.0 lb | Passed |
| 3 | 3 | 18.5 lb | — | Condemned · Airsacculitis |

**The refusal held at both incomplete stages, which is the behaviour worth
having.** At 60 head the page said *"40 of the 100 that went in are not on it
yet"* and both ratios read `—`; at 97 it said *"3 … not on it yet"* and still
refused. Only at 100 — *"matches the 100 that went in"* — did it answer. A
cutting yield computed at line one would have read about 160% and looked like a
triumph.

**Both ratios came out exactly where the arithmetic says**, over the passed
animals only: dressing **79.4%** (472.0 hanging / 594.5 live) and cutting
**99.2%** (468.0 packaged / 472.0 hanging). The condemned bird is out of both
sides rather than averaged out of one.

**The headline did not move, and that is the decision working.** Yield stayed
75.7% over the full 618.0 lb and grew the line *"3 of 100 head condemned (3.0%),
and they are still in the pounds that went in. This number is meant to read low
when that happens."* The loss stays visible in the number a person actually
looks at.

Everything else behaved: the condemned form dropped the hanging-weight field
entirely and offered an optional cause; causes grouped into *"Why they were
condemned — Airsacculitis · 3 head"*; the `Condemned` column appeared on the run
list only once a sheet existed, having been correctly absent while none did; and
a FINISHED run accepted the sheet without complaint, which is the one write a
complete run is meant to allow.

**Checked behind the screen too.** Three `production.carcass.recorded` audit
rows carrying `carcassId`, `runInputId`, `headCount` and `disposition` — and
**not** the cause, which is free text off somebody else's paperwork and stays in
the row. In the table, the condemned line holds `hanging_lb = NULL` and the
passed lines hold an empty `condemn_reason`, so both CHECK constraints are doing
their job rather than being enforced only in TypeScript.

**No defect was found, which breaks a run of five slices in six.** Worth stating
plainly rather than quietly: it is one sheet on one run, and the paths below are
still untouched.

### 2026-08-23 — The migration that never ran, and the re-land (`claude/the-migration-that-never-ran`)

**SLICE 1a TOOK THIS PACK'S PAGE DOWN FOR FIVE HOURS, AND THE CODE WAS NEVER THE
PROBLEM.** #251 merged at 03:24 UTC and auto-deployed. Nothing in the deploy path
runs migrations — `build` is `next build`, `prebuild` copies the map worker,
`vercel.json` is crons — so `production_run_carcasses` was queried by live code
before it existed anywhere. #252 reverted at 08:16 and the page came back.

**The blast radius was the whole module, not the new screen**, and that is worth
knowing before adding the next read here. `ProductionModule` calls
`listRunCarcasses` for every run in its summary loop, to decide whether the sheet
column has earned its width. A read that exists to keep a column honest is still
a read on every page load, so a missing table erased the run list rather than one
detail page.

**Two diagnoses in the revert were wrong, and re-landing meant disproving them
rather than working around them.** Both are recorded because each would have sent
the next session somewhere expensive:

| Claim | What production actually says |
| --- | --- |
| `app_user` has no `SELECT` on the new table, because `ALTER DEFAULT PRIVILEGES` only covers tables created by the role that set it | True in general, irrelevant here. `db:create-role` and `db:migrate` both connect as `DATABASE_URL_OWNER` — the same `neondb_owner` — which is the case where default privileges **do** apply. `pg_default_acl` holds `app_user=arwd/neondb_owner`, and **no** table in `public` is unreadable by `app_user`. |
| Running the migration by hand did not fix it, so a second cause is underneath | The table existed on neither database. The migration had not run anywhere, so nothing was tested by "running it by hand". Replaying `0184` and `0185` against production inside a transaction and rolling back applied both cleanly. There is no second cause. |
| `0184` may have reached production, leaving an orphan table to `DROP` before re-applying | It did not. `to_regclass` returned null. There was no orphan, and dropping on that advice would have been a destructive act taken on a guess. |

**The re-land is the same code, certified in the opposite order.** Migrations were
applied to the dev branch and then to production **before** the merge; the table
was verified in `pg_class`/`pg_policies` on both (RLS enabled *and* forced, both
policies, six CHECKs, three FKs, `app_user` holding SELECT and INSERT with no
manual grant); then the isolation suite ran — 429 tests, 25 files. That run is the
one that means something, because the dev branch created this table by migration
**long after** `app_user` existed. The from-zero ordering CI uses grants
`app_user` after the schema is built and structurally cannot see a grant skew;
this ordering can, and there was none.

The rule this leaves behind is [ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md),
and a `migrations` job in CI that refuses a PR adding a `drizzle/*.sql` without
the `full-tests` label. **The guard checks a label, not a database** — it makes
forgetting loud, it does not make it impossible, and the pipeline change that
would is still open.

The lesson is not about this pack. **A green suite certifies the code, not the
deploy.** Everything passed on #251, honestly, and it was reported as though it
meant the change was safe to ship.

### 2026-08-23 — Slice 1a: the carcass stage, and where a condemnation finally goes (`claude/homestead-farm-modulas-elewgg`)

**ONE HONEST RATIO BECAME TWO, and the pack stopped owing the design an
explanation.** Slice 0 could say packaged over live and said no more, on purpose:
telling **dressing percentage** (live → hanging) from **cutting yield** (hanging
→ packaged) needs the carcass recorded as a stage of its own, and the design
names those two as the ratios a butcher actually argues about. `production_run_carcasses`
is that stage. Both ratios are folded in `core/carcass.ts` and stored nowhere,
which is the rule this pack was built on.

**CONDEMNATIONS WERE DEFERRED FOR AN ARITHMETIC REASON, AND THE ARITHMETIC IS
WHAT SETTLED THEM.** Slice 0's note is worth re-reading, because the fix is
exactly the shape it predicted: a `condemned_head` column would have made the
head reconcile while leaving the condemned animal's live weight in the
denominator, and *nothing short of per-animal weights can take it out*. So
`live_lb` sits on the carcass row, and there is exactly ONE honest adjustment —

> **Sum only the animals that PASSED, on both sides of the ratio.**

The condemned animals are then in neither number, nothing is averaged, and no
correction is applied to anything. It works only when the plant weighed the
carcasses. When it did not, the app **declines to adjust and says so**:
`includesCondemned` is true, the denominator is the farm's own trailer weight
with everything that left the yard in it, and the screen names the gap. A real
condemnation reading as a bad kill forever is the failure that flag exists to
prevent.

**TWO LIVE WEIGHTS ARE ALLOWED TO DISAGREE, AND THEY ARE NEVER SUMMED.** The
input's `weight_lb` is what left the farm; the carcass's `live_lb` is what the
plant's scale said hours later, and shrink makes them differ by 3–5% for a real
reason the design already recorded. The fold **chooses** — the plant's when it
covers every passed carcass, the farm's otherwise — and prints which. That is
`land`'s declared-versus-measured acreage rule generalised off geometry: report
both, prefer the one that answers the question, never overwrite.

**THE NEW REFUSAL IS THE ONE THAT WOULD HAVE READ OVER 100%.** Sixty birds
transcribed off a sheet of a hundred puts all the boxes over some of the
carcasses, and `SHEET_INCOMPLETE` catches it. The sheet reconciles against
`head_in` read off the input's own ledger row — not a number retyped — and the
count comes through the count dimension's base, so five dozen is sixty rather
than five. Ten refusals now, each with a sentence.

**A FINISHED RUN ACCEPTS A KILL SHEET, and it is the first thing on this pack
that does.** Everything else refuses once the cost has landed, because everything
else stamped something. A carcass row stamps nothing — no quantity, no cost, no
movement — and the design is explicit that the sheet *arrives days after the run,
from a party who is not this farm*. A sheet enterable only before the boxes
landed would be a sheet nobody ever entered. So it follows `livestock_weights`
rather than `production_run_outputs`: corrected in place, because a number typed
wrong never happened. An ops test asserts the landed cost is byte-identical
before and after.

**ONE LINE IS ONE DISPOSITION**, which is what keeps `hanging_lb` meaning one
thing. "100 birds, 3 condemned" is two rows, not one with a count on it, and a
condemned line carries no hanging weight — CHECKed in the database and refused in
words by ops. A partial condemnation is deliberately NOT a third state: the
carcass passed, and the bruised quarter that never came off it is a byproduct
that failed to materialise, which is slice 3's business.

**THE CAUSES ARE OPTIONAL AND THE UNSTATED ONES ARE COUNTED.** `inventory` made
an adjustment's reason required because the reason is the diagnostic and the farm
is the one who knows it; here the farm is reading somebody else's paperwork,
which can be smudged, abbreviated or silent. Refusing to record the FACT of a
condemnation until somebody supplies a cause would trade a real number for an
invented one — `livestock`'s *an unknown is not a zero*, a second time. They
group under an empty key rather than being dropped, so the causes always add up
to the count beside them.

- **The overall yield's denominator did not move, and that is the whole point.**
  Slice 0 chose to state it plainly as everything that went in so a condemnation
  reads as a visibly low yield rather than a normal one with a hidden correction.
  What was missing was the explanation. The sheet is the explanation; the number
  stays exactly where it was and gains a sentence beside it.
- **The condemnation column is on the LIST, and only once a sheet exists.** A
  cause repeating across runs is the finding the design asks for — *the variance
  across batches is the learning* — and a per-run page can never show it. A
  tenant whose runs are bakes never sees the column.
- **A run with no sheet reads "—", never "0".** Zero would say the plant passed
  everything.
- Migration `0184` needed **no hand-reordering** — ninth check, and this time the
  answer was no. Both composite-FK targets (`production_runs`,
  `production_run_inputs`) were created back in `0168`, which is what the rule
  actually asks: *check whether the target is created in the same migration*.
  `0185` is the RLS pair.
- 25 new pure tests, 8 new ops tests, 7 new isolation tests. `killSheet` declared
  in `src/packs/index.ts` and set by the homestead profile.
- **The whole suite ran green — 3,470 tests, isolation included** — against a
  Postgres built from zero inside this container. The first attempt at this
  slice reported the db-backed suites as unrun because no `DATABASE_URL` was
  set, which was true and was the wrong conclusion: **the runner has Postgres
  installed and CI's own local-proxy path works on a laptop too.** Written up in
  [ci-and-tests.md](ci-and-tests.md) so the next session does not repeat it.
- **STILL NOT DRIVEN IN A BROWSER**, and that one is not a missing database: the
  app needs a signed-in Clerk session and there are no Clerk keys here. Kept as
  the top open item — five of the last six slices had a defect only clicking
  found, and every one of them had passing tests over it.

### 2026-08-22 — The question this pack was answering for itself (`claude/a-cost-you-can-put-right`)

**"Has anybody said what this batch cost" was asked here AND in `inventory`, in
two different shapes, and two shapes of one question is a question that can be
answered differently in two places.** It duly was.

`addRunInput` tested `purchased + consumed === 0` before stamping a pen's share
onto its output; `inventory`'s `carriedValue` tested
`purchased !== 0 || consumed !== 0 || released !== 0`. When
[ADR 0012](../decisions/0012-what-capitalises-stock.md) §A.4 landed
`inventory_cost_adjustments` — a correction to what a batch cost, which is a row
of its own rather than a movement — a pen whose ONLY money was an appended
correction passed neither test. A kill day would have stamped NULL on meat
carrying real money while the valuation screen called the same pen "No cost
recorded": the `$0.00`-per-bird bug this pack shipped in slice 0, arriving
through a new door, in two files at once.

It is `hasRecordedCost` now, exported from `inventory/core/valuation.ts` and
called by both. **This pack must not restate that test**, and if a future slice
adds another way for money to reach a batch, that predicate is the one thing to
change.

Nothing else moved: the genuine zero still gets through (a pen whose cost was
already carried out by an earlier run has accumulated something and has nothing
left), and the unpriced pen still stamps null. One new ops test stands a pen up
with no priced chicks, corrects its cost, and expects half the pen to carry half
the money.

### 2026-08-20 — Driven on the live app, and it found what the dev tenant could not (`claude/cost-that-left-with-the-meat`)

Slice 0 driven on the `Test` tenant against **a pen with real feed on it** —
BATCH-2, 197 Cornish Cross at 7 weeks, $141.67 fed. Everything the slice claims
held up:

| | |
| --- | --- |
| Yield | **75.7%** — 468.0 lb out of 618.0 lb in |
| Cost carried | **$43.15** = $85.00 stamped feed × 100/197 head |
| Split | $39.74 + $3.41 = **$43.15 exactly** |
| Landed | Two *Made here* batches, receipts carrying the cost |
| Head | 97 standing, `Processed −100`, **mortality still 6.2%** |
| Guard | *"BATCH-2 — Cannot be processed until 2026-09-03, after Tylan 50."* |

**And it found a defect this pack caused in the pack next door.** With the cost
gone to the freezer, `livestock`'s Fed card went on showing the whole $141.67
against the 97 birds left — 72 cents a head became **$1.46 a head**, because the
numerator sat still while the denominator halved. The fix is in
[livestock.md](livestock.md); what belongs here is the rule it establishes:

> **Once cost can leave a lot, every figure derived from "what this lot cost"
> has to say which side of the departure it is on.** `production` created that
> possibility, so `production` owns the consequence.

The second half was quieter and is a boundary decision. The run carried $85.00
of that pen's $141.67 because the other $56.67 is an *allocated* estimate that
was never stamped on a movement — correct, and completely unexplained on screen.
The Cost in card now says **"Only cost stamped on the ledger travels. Anything a
batch carries as an estimate stays with the batch."** Deliberately worded
without naming what the estimate is OF: a shared feeder is `livestock`'s idea
and this pack must not know what one is, so the batch's own page says that half
in the words of the pack that owns the distinction.

### 2026-08-20 — Slice 0: the run model, and the clock that finally refuses (`claude/a-run-lands-in-stock`)

The pack that makes profit-per-pen answerable. Before this, a pen accumulated
chicks, feed and medicine and then the animals simply stopped being counted;
nothing carried what they had cost into the freezer, so the profile's whole
thesis — *every farm activity posts a cost to a cost object* — described nothing
for meat.

**A RUN IS TWO ACTS, AND THE GAP BETWEEN THEM IS THE POINT.** Starting takes the
inputs out of stock; finishing lands the outputs in `inventory` with the input
cost split across them. In between, the cost is on no shelf anywhere — which is
**work in progress**, the third inventory state the design says every accounting
system models and no farm app does. It is not a design flourish: the split
across outputs cannot be known until they have all come off the line, and
`inventory` stamps a receipt's cost once, when it happens.

**THE YIELD IS FOLDED AND IT REFUSES MORE OFTEN THAN IT ANSWERS.** 690 lb out of
1,150 lb in is 60%, it will be different for the next steer, and it is different
again at the next plant — which the design notes is real money that essentially
nobody measures. There is no stored factor anywhere in this pack, because
`inventory`'s own units file says a live-to-hanging conversion baked into a unit
is an unauditable fudge that makes every carcass quietly wrong. What there is
instead is `core/yield.ts`, and **five of its six outcomes are refusals**. The
sharp one is `PARTIAL_OUTPUT_WEIGHTS`: three of five boxes weighed, divided by
the whole animal, does not read as approximately right — it reads as a
catastrophic kill, and it looks precise. Same rule `livestock` applies to FCR:
never relax a refusal into an approximation.

**THE WITHDRAWAL CLOCK NOW REFUSES SOMETHING, AND THAT NEEDED A NEW MECHANISM.**
`livestock` built its two-clock guardrail a slice ahead of anything that could
enforce it and said so in its own dossier: *"when slice 6 lands it must consult
`blocksProcessing` before booking anything — that is the enforcement point this
slice was built for."* The problem is that `production` must NOT require
`livestock` — a bakery running runs over purchased flour is a legitimate
composition — and `livestock` must not require `production`, because a farm that
never processes anything still has a clock.

So this is **the first use of P5, a declared extension point**
([extension-model §4](../extension-model.md)):

| File | Role |
| --- | --- |
| `src/packs/production/core/handler.ts` | Production NAMES the slot. Types only |
| `src/packs/livestock/run-handler.ts` | Livestock FILLS it: claims its lots, blocks on the meat clock, and removes head through `removeHead` |
| `src/packs/run-handlers.ts` | The registry. **The only file that knows both packs exist** — same layer and same justification as `src/packs/index.ts` |

A refusal carries the owning pack's own sentence verbatim, because a withdrawal
message is a legal statement about whether meat may lawfully be sold and this
pack has no standing to reword it. *"PEN-DRUG — Cannot be processed until
2026-09-05, after Penicillin G."* **There is no override**, and `unknown` blocks
exactly as `under` does.

**HEAD LEAVES THROUGH `livestock.removeHead`, NOT A SECOND LEDGER.** The reason
`consume` is on the handler rather than done here: a run writing its own head
movement would be the parallel counter the whole pack model exists to prevent.
`removeHead` gained a fourth reason, `processed`, and it is **not offered to a
person** — `HAND_REMOVAL_REASONS` is what the pickers use — because head leaving
for a run must also land the meat, carry the cost and consult the clock, and a
dropdown does none of those. `processed` is a REMOVAL in `core/herd.ts`:
unrecognised kinds fall through to `transfer`, and a transfer would have moved
mortality's denominator on the one number the broiler enterprise lives on.

**TWO COST BASES ON THE INPUT SIDE, AND THEY ARE DIFFERENT ON PURPOSE.** A lot a
handler claims carries its ACCUMULATED cost — chicks plus feed plus medicine —
pro-rated by the share being taken; ordinary stock leaves at `inventory`'s
average, exactly as a bag of feed does. Pricing a bird at what the chick cost
would throw away eight weeks of feed.

**AND THE PRO-RATA IS NET OF WHAT HAS ALREADY LEFT.** Half a $1,000 pen on
Saturday, the rest a fortnight later: the accumulated figure never goes down, so
pro-rating the gross twice charges $1,500 for a $1,000 pen. `lotCarried` in
`inventory/core/costing.ts` subtracts what has been released, and
`tests/production-ops.test.ts` certifies the two halves summing to the pen on
the real ledger rather than in the fold.

**THE OUTPUT SPLIT PICKS A BASIS AND SAYS WHICH.** Weight when everything was
weighed, count when nothing was and every output is counted the same way (sixty
loaves are each a sixtieth of the flour — how a bakery has always costed), and
**`none` when neither**, which lands the boxes with no cost and explains why. A
dozen eggs and a pound of butter have no ratio between them, which is
`inventory`'s own rule about adding across units. The basis is the one derived
thing in the pack that is STORED, on `production_runs.cost_basis`: the rule may
change, and a historical run must keep explaining the split it actually had.

**CONDEMNATIONS ARE SLICE 1, and the reasoning is in Decisions below** — the
design is explicit that delivered head ≠ sellable carcasses, and this slice
neither models it nor pretends it away.

**DRIVEN ON `Hilltop Farm` BEFORE THE PR, and the loop closed on the second
try.** 50 birds out of PEN-2 at 312 lb live, 218 lb of whole broilers out: the
run page showed **69.9%**, the birds landed in Inventory as a **Made here**
batch called *Kill day 2026-08-20*, and the pen went to 0 head with mortality
still reading 0.0% — processing is not loss. HOGS-1, 26 days into a penicillin
withdrawal, was greyed out of the picker under *"HOGS-1 — Cannot be processed
until 2026-09-15, after Penicillin G."* That sentence is the first time this app
has refused anything on the strength of the clock.

**It found five defects, and every one of them was invisible to types and
tests:**

| What | Why no test saw it |
| --- | --- |
| **"No batchs yet"** on the very first screen | A label is the tenant's to rename and the profile renames this one to *Batch*. Naive `+ "s"`. Every other pack keeps these words singular; now this one does too |
| **Starting a run left you on a stale empty list** | `router.refresh()` immediately before `router.push()` raced, and the refresh won. `revalidatePath` had already done the server half, so the refresh was redundant as well as harmful |
| **A blocked pen's REASON was unreachable** | It rendered only for the selected lot — and a blocked lot is disabled, so it cannot be selected. All anybody saw was a greyed row saying "Not looked up", with nothing to say that an unknown is not a zero. Now every blocked batch of the chosen item lists its sentence, selected or not |
| **A pen with no recorded cost stamped `$0.00`** | **The one with a passing test over the wrong behaviour.** Every ops test used a pen with feed on it. Zero says the birds were free; nobody had said what they cost. It now stamps NULL and lands in the unpriced count, which this pack already reports honestly. A genuine zero — a pen whose cost an earlier run already carried out — still gets through |
| **A run could not land its own outputs on a farm with no meat item** | The picker offered feed, chicks, pigs and penicillin. A first kill day produces whole broilers, and the only way to record one was to leave for Inventory mid-processing-day. The output form can now create the stock line, owner-gated, exactly as `createLivestockLot` does — livestock hit this with its first cattle and fixed it in the same slice |

- `production` flipped to `available` in `scripts/seed.ts`; both databases
  re-seeded. The homestead profile gained
  `packConfig.production.runKinds` — the pack declares no kinds of its own,
  because one that knew what "butchering" meant would know what industry it was
  in.
- `receiveStock` gained `source` and `extensionSlug`. An output is `produced`,
  which `inventory`'s own column comment says slice 3 cannot infer
  retroactively.
- Two new `inventory` reads for this pack, both there because the ledger is
  `inventory`'s: `carriedCostByLot` and `balanceByLots`.
- 31 new pure tests, 11 new ops tests, 15 new isolation tests. Migration `0168`
  **hand-reordered — eighth check, third time the answer was yes**; `0169` is
  the RLS pair per table.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `production_runs` | One pass of turning things into other things | `tenant_id`, FORCE RLS. `run_kind` open taxonomy (P1), values from the profile. `status` in `in_progress\|complete` — two, because the only state that matters is whether the cost is still held here. `cost_basis` is stamped at completion and never re-derived. `crew_size` / `labour_hours` are recorded and **not costed** | **`processor_id`** is the processing path — null means on-farm, and null is a real answer. **`inspection`** is stamped at completion and never re-derived, because a plant's status can change and a box in a freezer is governed by what was true when it was packed
| `production_run_inputs` | **What went in. A JOIN, not a second ledger** | Composite FKs to the run (CASCADE) and to `inventory_movements`. UNIQUE per movement — two rows would put one cost in two runs, the same rule `livestock_feed_draws` follows. Its only own column is `weight_lb` |
| `production_run_outputs` | What came out — **and the one place holding a quantity before the ledger does** | Composite FKs to the run (CASCADE), the item, the lot, the receipt and the location. CHECK: `lot_id` and `inventory_movement_id` are null together — landed means both. Frozen once landed |
| `production_run_carcasses` | **The kill sheet, line by line** — the stage between the animal and the box | `tenant_id`, FORCE RLS. Composite FKs to the run and to the **input** (both CASCADE); `run_input_id` is REQUIRED, which makes the chain carcass → input → movement → lot total. `head_count` is 1 for a beef and 70 for a pen. `disposition` in `passed\|condemned` — two, because one line is one outcome. CHECKs: a condemned line carries no `hanging_lb`, a passed line carries no `condemn_reason`. **Writable on a finished run**, unlike everything else here |

| `production_processors` | **Who does the work you do not** — a role on a party, not a new contact model | `tenant_id`, FORCE RLS. Composite FK to `parties` (CASCADE); UNIQUE per party, because two rows would be two opinions about one plant with nothing to say which is current. **No `name` column** — it is the party's, so this table cannot disagree with the rest of the app. `inspection` in `usda\|state\|custom_exempt\|uninspected\|unknown`: five, and `unknown` is a real answer rather than a missing one. `rating` 1–5 or null, and it is an OPINION — the measured half is folded, never stored |
| `production_processor_handles` | **What one processor will take** | Composite FK to the processor (CASCADE). UNIQUE per `(processor, kind)`. `kind` is an open taxonomy from the profile's `processorHandles`, a **separate list** from `livestock.species` because what a plant takes is not what this farm raises. **The three fee columns are superseded** — copied out by `0196`, read and written by nothing, awaiting their DROP in a follow-up PR. What is left is `capacity_per_day` and the prose that is not a price |
| `production_processor_price_items` | **One priced thing off a rate sheet** — the menu, as data | Composite FK to the processor (CASCADE). UNIQUE per `(processor, kind, label)` — two rows for one named option would be two prices with nothing to say which is current, and it is what makes next year's sheet re-readable over this year's as a correction. **`unit` is CLOSED** (`head`, `live_lb`, `hanging_lb`, `finished_lb`, `package`, `box`, `flat`, `hour`) and is the whole point: $1.05 is five different amounts of money across them. `category` and `label` are OPEN, the same call `..._cuts` made about cut names. `price_cents` NULL is "call them", never zero; `minimum_cents` is a floor, not a price. Still a QUOTE — what was paid is a bill in `payables` against the same party
| `production_processor_cuts` | What a processor will produce | Composite FK to the processor (CASCADE). Free text by design — cut names are a trade's prose and every plant's list differs. `kind` empty means "anything they take". This is CAPABILITY; the per-animal cut sheet is a later slice |

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
- `src/db/schema/production.ts` · `drizzle/0194_wide_winter_soldier.sql` ·
  `drizzle/0195_production_processor_price_items_rls.sql` ·
  `drizzle/0196_backfill_processor_price_items.sql` ·
  `drizzle/0168_soft_screwball.sql` ·
  `drizzle/0169_production_rls.sql` · `drizzle/0184_rare_the_anarchist.sql` ·
  `drizzle/0185_production_run_carcasses_rls.sql`
- `tests/production.test.ts` · `tests/production-ops.test.ts` ·
  `tests/isolation/production.test.ts`

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
- **NOTHING SELECTS A PRICE ITEM YET.** The list is recordable, comparable and
  totalable, and nothing totals it: the cut sheet as an order is 2b and the fee
  reaching inventory cost is 2c. **The four computable units exist for 2c** —
  `head` and `hanging_lb` together are the flat-per-animal-plus-per-pound
  arrangement most plants quote, and the reason a smaller animal costs more per
  pound — and nothing reads them until it is built.
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
