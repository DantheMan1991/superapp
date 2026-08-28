# Livestock

> **A LOT IS A GROUP OF ANIMALS AND AN ANIMAL IS AN ANIMAL** — settled
> 2026-08-27, and the code has not caught up. Read
> [The model, settled](#the-model-settled-2026-08-27) before anything else here:
> entries below this line say *"an individual is a lot of one"*, and that
> sentence is retired.
> **The pack that owns almost nothing**, and that is the point: the stock lot and
> the head ledger belong to `inventory`, occupancy belongs to `land`, and what is
> left here is the biology neither of them could know.
> Status: `available` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

Design: [homestead-farm.md → Category design — Livestock](homestead-farm.md#category-design--livestock-brainstormed-2026-08-13).
Read [inventory.md](inventory.md) before changing anything about head counts,
and [land.md](land.md) before changing anything about where animals are.

## Slice order

| # | Slice | State |
| --- | --- | --- |
| **0** | **Lots + head ledger + occupancy** | **shipped 2026-08-15** |
| **1a** | **Daily log — the round, and the check that is not a head event** | **shipped 2026-08-19** |
| **1b** | **Advisory layer — ask and orient, anchored to this farm's own history** | **shipped 2026-08-19** |
| **2** | **Feed + the allocation seam** (FCR itself waits on slice 5) | **shipped 2026-08-20** |
| **3** | **Health + the withdrawal clock** | **shipped 2026-08-20** |
| **4a** | **Pedigree + breed as fractions** — dam and sire, composition computed from the parents, a birth that creates a lot | **shipped 2026-08-27** |
| **4b** | **Photos — a profile picture and a gallery.** Layer 0, and `assets` got it in the same PR | **shipped 2026-08-27** |
| 4c | The breeding calendar — bull exposure → calving window, preg check narrows it, calving fixes it, a "who is due" list | |
| 4d | Traits scored 1–5, sire performance across years, **the inbreeding warning at turn-in** | |
| 4e | Registry — number, association, registered name, papers in Documents. Needs 4b | |
| **4f** | **The capital transfer** — market herd ↔ breeding herd, and it POSTS | **shipped 2026-08-27** |
| **5** | **Weights (tape formulas, sampling) — and the FCR they unlock** | **shipped 2026-08-20** |
| **6** | **Processing handoff → `production`** | **shipped 2026-08-20** |
| ~~**7**~~ | ~~Herds — a set of animals somebody creates, that moves as one~~ **SUPERSEDED by slice 8** | shipped 2026-08-27, being undone |
| **8a** | **The words** — a lot is a group and has a NAME, an animal is an animal; "batch" and "lot of one" leave the copy | |
| **8b** | **Animals live in a lot** — membership retargeted from herd to lot, and naming one out of a pen KEEPS her in it | |
| **8c** | **Two pages** — a lot page and an animal page, neither wearing the other's furniture | |
| **8d** | **Move several lots at once** — the one thing herds did that nothing else does. Ships BEFORE 8e | |
| **8e** | **`livestock_groups` dropped** — only after 8d is live | |
| **8f** | **Feed reaches a single animal** — in a lot it is the lot's, on her own it is hers | |

## The model, settled 2026-08-27

**A LOT IS ALWAYS A GROUP OF ANIMALS. AN INDIVIDUAL ANIMAL IS NOT A LOT. HERDS
ARE GONE.** The founder's ruling after driving the whole pack, and it retires
this file's oldest sentence.

*"An individual is a lot of one"* was true of the tables and should never have
reached a screen. It did, and what it produces is a 100-bird broiler pen carrying
a Pedigree section, a **Record a birth** button and a photo gallery promising *"a
series over time shows the gradual change"* — the individual-animal page rendered
for a flock, because there is only one page. The slogan was a convenience for
whoever was writing the schema, and it ended up printed in the module header.

### The words, and they are now closed

| Word | What it means | What it is not |
| --- | --- | --- |
| **Lot** | A group of animals kept and costed together. Has a NAME. Tracks head. Holds named animals and uncounted ones alike. | **Never one animal** |
| **Animal** | One individual with her own page — weights, treatments, pedigree, photos, calves. Lives in a lot, or on her own. | **Never called a lot in copy** |
| ~~Herd~~ | **Deleted.** A second container invented to hold animals that had been split OUT of their lot. Fix the root and it has no job left. | — |
| ~~Batch~~ | **Banned in this pack.** `production` owns the word — the farm profile labels a run "Batch" — and `inventory` uses it for a stock lot. Three meanings was two too many. | — |

**A LOT HAS A NAME, NOT A CODE.** The field already exists and is labelled *"Lot
code"* with placeholder `B-2026-04-15`, which tells a farmer to invent a barcode.
The column is `inventory_lots.code` and is shared, so **`inventory` keeps calling
it a code and `livestock` calls it a name** — same column, different label per
pack, which the label registry already supports.

### What does NOT change: the spine

**An individual animal is still backed by an `inventory_lots` row, and whoever
implements this needs that on the first line.** That row carries her cost, her
stock valuation, her capitalisation to breeding stock and her eligibility for a
production run. Strip it out and she cannot be sold, costed or depreciated.

The ruling is about **the words and the screens**. The app stops saying "lot"
about an animal, stops showing her the flock furniture, and stops making somebody
split her out of a pen to give her a name. **It does not purge the schema.**

### Why herds die, and what replaces them

Herds (slice 7, [#295](https://github.com/DantheMan1991/Superapp/pull/295),
merged and live) were a reasonable answer to the wrong question. Naming an animal
splits her out of her lot, which leaves her homeless, so a second container got
built to hold her. **Once animals live inside a lot, that container has no job.**
`livestock_groups` and `livestock_lots` are the same shape — a named set,
date-ranged membership, moves as one — and the label registry says so out loud:
both `livestockLot` and `livestockGroup` describe themselves as *"a cattle
operation says herd"* (`src/packs/index.ts:135`).

**ONE THING HERDS DID IS WORTH KEEPING, AND IT IS NOT THE NOUN.** Three broiler
batches grazing one field stay three lots — per-batch FCR is this pack's headline
number and merging them would destroy it — so moving them is three actions. Herds
made it one. That capability becomes **slice 8d, a multi-select on the move**,
and it ships BEFORE the tables go. **A replacement, not a casualty.**

**`livestock_group_members` is the half worth salvaging.** Date-ranged membership
with at most one open row per animal is exactly the mechanism "add animals to a
lot" needs. Retarget its parent FK at `livestock_lots` and the table outlives its
own concept.

### Feed follows the same line

**IN A LOT, FEED IS THE LOT'S. ON HER OWN, IT IS HERS.** The founder's rule, and
the pack has half of it: `livestock_feed_draws.feed_group_id` is `NOT NULL`, so
the only feed control in this module requires a shared feeder and **a lone animal
cannot be fed here at all** — all four named animals on Hilltop Farm read `—` for
every feed column. Direct-to-lot issues exist, but only from `inventory`. Slice
8f.

### The order this has to go in

`livestock_groups` shipped yesterday and is LIVE, so this is a DROP of live
tables. Per [ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md)
and the standing rule that **a DROP goes out AFTER its deploy**, it is two
migrations and not one:

1. **8a–8c** ship the words, the membership retarget and the two pages. The herd
   tables stay in place, unread.
2. **8d** ships the multi-select move, so nothing is lost when herds go.
3. **Only then 8e** drops `livestock_groups`. Check both databases for rows
   first — dev has one herd on Hilltop Farm, production may have none.

### Still open on this

**THIS DESERVES AN ADR AND DOES NOT HAVE ONE.** *"An individual is a lot of one"*
was a defended design that shaped slice 0, and reversing it closes off a credible
alternative — the bar `docs/decisions/` exists for. Recorded here so the next
session raises one rather than discovering the reversal in a build log.

## Build log

### 2026-08-27 — Slice 4f: a cow is not inventory (`claude/a-cow-is-not-inventory`)

The last slice of 4, and the one the design has called the line between a
tracking app and an accounting one since 2026-08-13: *"The same animal is
inventory or a capital asset depending on its purpose… Moving an animal from the
market herd to the breeding herd is therefore an accounting event that must POST,
not a status checkbox. Most farm software treats it as a flag and quietly makes
the books wrong."*

**SO THERE IS NO FLAG.** Whether an animal is breeding stock today is a fold over
`livestock_capital_transfers` — the latest direction wins — for the same reason
the head count is a fold over movements and the withdrawal clock is a fold over
treatments. A boolean would stop agreeing with the journal the first time
somebody corrected a date, and the journal is the half that matters.

**THE ENTRY IS THE POINT, AND IT IS NOT THE ONE AN ORDINARY ISSUE WOULD MAKE.**
`postCapitalisation` posts **Dr fixed assets, Cr inventory**. The normal outgoing
path debits COGS, which says the cost was consumed — a farm that ran a breeding
cow through it would have expensed an animal it still owns and understated its
assets by her whole cost. The seam lives in `inventory`, names no pack, and would
serve a dealership moving a demonstrator out of stock unchanged.

**THE AMOUNT IS HER CARRIED COST**, through `carriedValue` — the same fold the
valuation screen uses, so the credit to inventory is exactly the figure that was
in stock a moment before and the two screens cannot disagree. Coming back, it is
**net book value**: depreciation has been running, and putting her back at cost
would re-create value the books have already written off.

## The first version was wrong, and driving it is what showed that

**Built first: her HEAD left the ledger.** The reasoning looked airtight — this
pack's oldest sentence is that the head ledger and the inventory ledger are the
same ledger, so an animal that is not stock is not in it — and the accounting
fell out with no special case at all.

**Then Rosie's page was opened.** Treat and Weigh had disappeared, because both
are gated on head. Record loss was still there and would have taken her to minus
one. Shared-feeder allocation is head × days, so it had stopped reaching her. A
breeding cow is the animal a farm touches MOST — treated, weighed, bred, and
eventually dead — and she had become the one it could do least to.

The founder's call, given both options: **keep her head, move only the money.**
"Not inventory" is a claim about the BALANCE SHEET, about where her value sits,
and reading it as a claim about whether she exists was the mistake.

**So the mechanism is a marker, not a movement.** `inventory_lots.capitalised_on`
— neutral, no pack named — and both `valueStock` and `carriedCostByLot` respect
it, which is what keeps the ledger and the valuation screen agreeing without
inventing head events. **Nothing is written to the head ledger at all**, because
the head ledger records what happened to the ANIMALS and nothing happened to her.

**The refusal that replaces "she has no head" is explicit.** `run-handler.ts`
blocks a run on a capitalised lot and says why: *her cost is in fixed assets;
bring her back to the market herd first, which moves the value back and is the
entry a sale needs.* That is the design's "entirely different treatment on sale",
and it is a rule rather than an accident of arithmetic.

**Coming back writes a cost correction of exactly the depreciation taken**
(`capital_return`), so clearing the marker does not spring her batch back to
original cost while the entry credits fixed assets at net book value. The two
halves have to land on the same number or the valuation screen drifts from the
ledger by the depreciation.

Two more things driving found, both fixed:

- **An uncosted animal could not be capitalised at all.**
  `assets_depreciable_is_complete` refuses a method other than `none` without a
  cost, and the form ticks depreciation by default — so a farm that had never
  costed its animals hit a constraint violation. Nothing to depreciate now forces
  the method to `none` rather than refusing the transfer: the transfer is a fact
  about what the business owns, and a farm that has never costed its animals
  still owns them.
- **Every refusal arrived as "Something went wrong saving that."** This slice
  composes `assets` and the ledger and both throw their own error types, neither
  of which livestock's `toResult` knew. That is what turned a one-sentence
  diagnosis into a browser session.

**A FIXED-ASSET ACCOUNT FOR LIVESTOCK DOES NOT EXIST IN THE FARM CHART.** The
picker offered `1600 · Equipment` and `1650 · Vehicles`, because those are the
only fixed-asset accounts the generic chart has — so a cow goes in Equipment
until a farm chart of accounts is seeded, which
[packs-and-profiles.md](packs-and-profiles.md) already calls the largest gap in
the installer. Recorded in Open items rather than worked around.

Driven on Hilltop Farm: Hazel moved to breeding stock and reads **1 head, "On the
books as: Capital asset"**, with Treat, Weigh, Split and Record loss all still
there — the exact controls the first version had taken away. Migrations `0224`,
`0225` and `0226`; 8 new ops tests, 4 new isolation tests.

### 2026-08-27 — Slice 7: a herd you can move (`claude/a-herd-you-can-move`)

The founder, looking at the list after individuals shipped: *"there is a list of
the animals and some are a lot which is one individual animal and some are part
of another which is a group. that is confusing. When you have 1000 animals this
display is messy. There needs to be individual animals, then I need to be able to
create groups or herds or pens… I need to be able to move a herd paddock to
paddock and that moves all of the animals."*

**Three of those were real gaps rather than misunderstandings**, and checking
before answering is what separated them:

- **The list was flat and unpaged.** One filter, species, and no limit. At a
  thousand animals it rendered a thousand rows, and it was unreadable at fifty.
- **There was no herd.** Nothing grouped animals, so ten cows to a new paddock
  was ten trips through the move dialog — `moveOccupant` takes one occupant.
- **Moving an animal between groups was not a thing.** Split one out, merge one
  in, and both write head events for something that is not a head event.

**WHAT THE HERD IS NOT.** Two cheaper answers were available and both are wrong,
which is worth recording because they will look attractive again:

- **Not the split chain.** `inventory_lots.parent_lot_id` already records "these
  three came out of that pen" and drawing it as a tree would have cost almost
  nothing — but it cannot GATHER. Ten cows bought one at a time have no common
  ancestor, and a herd of them is exactly what somebody wants to make.
- **Not land occupancy.** "Whoever is on North Pasture" is free and already
  recorded, but two herds can share a paddock and one herd can span two, so a
  place is not a membership. The relationship runs the other way: moving a HERD
  is what writes everyone's occupancy at once.

**THE LOT STAYS THE COSTING UNIT AND THE HERD SITS ABOVE IT.** A herd holds
LOTS, which is what lets one hold Bluebell (a lot of one) and a pen of
forty-seven unnamed head side by side — the shape asked for in the same
sentence. Head, cost and every ledger question stay per-lot, so nothing in
`inventory`, `production` or the books had to learn a second grain, and a herd's
totals are a fold over its members that is never stored.

**MOVING BETWEEN HERDS IS NOT A HEAD EVENT**, and that is the sharpest reason
this is a membership table rather than the split/merge dance it replaces. A cow
changing herds has not been bought, born, sold or died; a movement on the ledger
for it would corrupt the one number the whole pack is built to keep honest. There
is a test that counts her movements before and after and finds one.

**ONE OPEN MEMBERSHIP PER LOT, ACROSS ALL HERDS**, as a partial unique index. A
cow is not in two herds, and making that unrepresentable is what lets "move her
to the other herd" be a single act — close here, open there, in one transaction —
instead of a question about which of two answers is current. Deliberately
stricter than the feed-group rule, where a pen genuinely can draw from two bins.

**Dated membership, inclusive `ended_on`**, matching `land_occupancy` and
`livestock_feed_group_members`. *Which herd is she in* is a question about today
and a column would answer it; *which herd was she in when that calf was born* is
a question about a date, and a column that gets overwritten cannot answer it at
all.

**`moveGroupToZone` REPORTS WHAT IT COULD NOT MOVE.** Each member still goes
through `land`'s own `moveOccupant` — the inclusive-date arithmetic that ends the
old stay the day before the new one begins is land's, and a bulk path that
re-implemented it would drift the first time somebody fixed one of them. One
refusal must not strand the other nine, so failures are collected and the toast
says *"Moved 7 · 3 could not be moved"* rather than a bare success.

**MIGRATION `0222` WAS HAND-REORDERED — the sixth time in this repo.** The
composite FK `(tenant_id, livestock_group_id)` needs `livestock_groups`'
`(tenant_id, id)` unique index to EXIST when the constraint is added, and drizzle
emits every ADD CONSTRAINT ahead of every CREATE INDEX. The rule recorded at
`0138` held: *check whether the TARGET is new*. `livestock_group_members_lot_fk`
points at `livestock_lots`, which has had its index since `0138`, and needed no
help; `livestock_groups` is created here, so it did. The failure is loud —
*there is no unique constraint matching given keys* — and the whole migration
rolls back, which is why it was found on the dev branch.

**The word is the tenant's.** `livestockGroup` is declared with the neutral
fallback "Group", because a core-shaped noun is what a pack owes every profile,
and the homestead profile makes it **Herd**. Sheep say mob and poultry say flock,
and neither needs code.

Driven on Hilltop Farm end to end: a herd created, Bluebell and the three sows
added to it in one dialog, a paddock made, and **all four moved to North Pasture
in one action** — the toast said *4 moved* and every row read North Pasture
afterwards. The hub now reads **Herds** (one row: Cows · Cattle · Swine · North
Pasture · 4 named · 4 head) then **Not in a herd** (the four pens), which is the
display the complaint asked for: a thousand chickens is one row.

Migrations `0222` and `0223`; 6 new ops tests, 7 new isolation tests.

### 2026-08-27 — An individual is a lot of one, and now the app says so (`claude/an-individual-is-a-lot-of-one`)

The founder, after 4a and 4b shipped: *"So you create a lot and then you add head
in the lot, but I don't see how you track each individual animals in the lot."*

**He was right, and the answer was not a missing feature but a missing
affordance.** An individual has been a lot of one since slice 0 — identifiers,
weights, treatments, photos and pedigree parents all hang off the LOT, so a lot
holding one head IS an animal and every one of those tables already means what
you would expect. What the app offered was the GROUP shape and a sentence in a
dialog description saying the other was possible, which nobody reads. Ten named
cows meant ten trips through Split, inventing a code each time.

**Two ways in, and neither is a new mechanism.**

- **"One animal" on the create form**, beside "A group", chosen FIRST because it
  changes what the rest of the form is asking for. Name instead of lot code, and
  **the single head is placed here** — a lot of one containing no animal is a
  record of nothing, and "create it, then go and add a head" was the two-step
  that made the whole shape feel unsupported. A GROUP still does not place head,
  deliberately: how many chicks actually arrived in a box of a hundred is a fact
  somebody checks, and assuming it would be inventing the mortality denominator.
- **"Record as individuals" on a lot**, which is N splits in one transaction.
  Names go in as a block of text because that is how somebody has them — off a
  clipboard, out of a notebook, read off ten ear tags in a row. Each name becomes
  the lot code AND an identifier, because that is what a person means when they
  type "Bluebell".

**TWO DATES FOR AN INDIVIDUAL, ON PURPOSE.** "Born or hatched" and "On the farm
from" are different facts — a cow bought in was born long before she arrived —
and one field for both would put her age out by however long that was.

## And it found a live safety bug

**HOGS-1 had nineteen days left on its meat withdrawal. Three pigs were split
out of it. All three read CLEAR.**

`splitLivestockLot` has never carried treatments across — it copies species, sex,
birth date, breeding and parents — and nothing had ever hit it because splitting
a TREATED pen was rare. Giving it a button made it a one-click way to empty a
pen's withdrawal, on the one number in this pack where being quietly wrong ends
with uninspectable meat in somebody's freezer.

**Fixed by inheriting at READ time, not by copying at split time.** Copies would
make `updateTreatment` and `deleteTreatment` — which exist because a clock can be
wrong and has to be correctable — reach the pen and miss every animal that left
it. One row stays the truth; every animal descended from the lot it was given to
reads it, through `treatmentsByLot`, which is the single funnel the hub, the
daily round and `run-handler.ts` all already went through.

**Bounded by when each branch separated.** A dose given to the pen after three
pigs left was not given to those three, so the bound climbing the chain is the
`opened_on` of the lot one level below — the day that branch became its own.
Splits move forward in time, so the bound tightens as the walk climbs. A lot with
no `opened_on` inherits everything, which is the conservative reading rather than
the tidy one.

**An inherited row keeps its own `livestock_lot_id`**, which is what lets the
detail page show it, say *"Given to HOGS-1, before this one was split out"*, and
offer *"Correct it on HOGS-1"* instead of Correct and Remove. Editing the pen's
history from an animal's page would silently move the clock for every other
animal that came out of it.

Driven on Hilltop Farm: Bluebell added as one Angus cow (2 years old, 1 head,
arriving today, born 2024) in a single dialog; Rosie, Hazel and Mabel split out
of HOGS-1 in one; all three read **19 days left** afterwards where they had read
"—" before the fix. 10 new ops tests, no migration.

### 2026-08-27 — The column that lost the cross (`claude/the-column-that-lost-the-cross`)

**The contract half of slice 4a**, going out as its own change after 4a's deploy
exactly as [ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md)
and the schema comment said it would. `livestock_lots.breed` is gone;
`livestock_breed_parts` has been the only store since `0217`.

**`0221` RUNS AFTER THE DEPLOY, NOT BEFORE — the second migration in the repo
that way round**, after `0075`. Every other one goes out ahead of the code
because additive changes leave the running build working. A DROP inverts that:
**drizzle names every column of a table in the SELECT list it builds**, so the
instant this column goes, a build that predates the deploy answers `column
livestock_lots.breed does not exist` on the hub, every animal's page, the round,
the feed report and the digest. The reverse order is merely untidy — one dead
column and nothing else — which is what makes the window survivable.
[conventions §4](../conventions.md) carries the rule; the migration header
carries the reasoning.

**THE VALUES ARE NOT MIGRATED ACROSS, and they cannot be.** The accounting pair
this follows (`0073`/`0074`/`0075`) had a copy step in the middle because an
email address is an email address. This column held free text — "½ Angus, ¼
Hereford", "Angus cross", "black one" — and no parser turns any of that into
fractions without inventing a claim the tenant never made. **Slice 4a WAS the
migration path**: it showed the old string as a note asking for it again and
cleared it the moment somebody obliged. What is dropped here is a string that has
either already been replaced with something better or been declined.

Four screens lose their fallback and say less rather than saying it oddly: the
lot header reads *"Poultry"* rather than *"Poultry · "* for an animal nobody has
described, and the hub shows no second line. The one test that existed only to
prove the clearing worked is gone with the column it cleared.

### 2026-08-27 — Slice 4b: a photo of the animal (`claude/a-photo-of-the-animal`)

The other half of what the founder asked for — *"the ability to add a profile
picture for each animal as well as a gallery of photos of them"* — and almost
none of the work was in this pack. **No pack record in the app could hold a file
at all**: `document_links` has four targets and every one is accounting's. The
table, the rules and the gallery are Layer 0 and live in
[documents.md](documents.md); what is here is three thin actions and two screens.

**THE PACK OWNS THE ACTIONS AND CORE OWNS THE TABLE**, which is the whole shape
of the seam. `document_attachments` is polymorphic and names no pack, so the code
that DOES name one is `actions.ts`, where `livestock_lot` is a fact rather than a
string the browser sent. **And because there is no foreign key, `assertLot` is
the only thing that proves the animal exists** — that is a compensating control,
not a nicety: without it a photo could be hung on any UUID at all.

**A PHOTO IS A CHORE — `member`, not `owner`.** Placing head, moving a lot and
recording a check are all member-level; the person in the pen with a phone is
rarely the owner. Editing the lot stays owner-only, and that split is the one
this pack has drawn since slice 0.

**The design's list of what a photo is FOR is why the panel is on the lot page
rather than in a corner of Documents**: identification when a tag cannot be read
across a field, a condition series showing the gradual loss a daily look never
does, documentation for the vet, a sales listing, and evidence for a predator or
insurance claim. The hub carries the picture beside the code for the first of
those.

The panel renders only where `documents` is switched on, because the FILE is the
DMS's — a button that uploads into a module the tenant has not enabled would fail
at the gate, which is a worse answer than not offering it.

Driven on Hilltop Farm end to end. See [documents.md](documents.md) for what
driving it found.

### 2026-08-27 — Slice 4a: what an animal is made of, and who made it (`claude/what-an-animal-is-made-of`)

The founder asked for it in one sentence — *"breeding and genetic information
for each animal, specifically cattle pigs sheep etc… birthing dates and whatever
else you can think of"* — and slice 4 has been sitting in this table designed
and unbuilt since 2026-08-13. This is the first third of it: the pedigree and
the breeding. The calendar, the traits and the capital transfer are 4c, 4d and
4f, and every one of them hangs off the two columns this slice adds.

**THE DAM AND THE SIRE ARE NOT `inventory_lots.parent_lot_id`, AND THIS WAS THE
DECISION THE SLICE TURNED ON.** The 2026-08-13 design says births "create lots,
parented by the dam" — written before the lineage chain existed in code. It does
now, and it means something else: `parent_lot_id` is the SPLIT chain, one parent,
walked by a traceability query to find which pen a box of meat was raised in. A
birth is not a split. The dam does not lose a head when her calf arrives, and
reusing that column would have put two unrelated meanings on one edge: a batch
trace would wander into a family tree and a pedigree walk would cross into a pen
division. So `dam_lot_id` and `sire_lot_id`, composite self-FKs to
`livestock_lots`, RESTRICT on delete, with a CHECK against the one-step loop.
**The split now copies both parents onto the child and does NOT become one**,
which is the same rule stated from the other side.

**BREED IS PARTS, NOT PERCENTAGES, AND THE REASON IS THAT PERCENTAGES LIE ABOUT
THIRDS.** A three-way foundation cross stored as percentages is 33 / 33 / 34, and
that extra point is a claim the app invented on somebody's behalf. Parts are
integers over their own sum — 2 : 1 : 1 is ½, ¼, ¼ — and combining a dam with a
sire is exact integer arithmetic over a common denominator, so halving stays
exact however deep the pedigree runs. `livestock_breed_parts`, one row per breed
per animal, unique on the pair.

**AN UNKNOWN PARENT IS HALF THE ANIMAL, NOT NOTHING.** This is the whole reason
`core/pedigree.ts` has a header and a test file arguing with itself. A calf out
of a purebred Angus dam by a bull nobody recorded is **½ Angus · ½ unknown** — it
is not "Angus" and it is not "100% Angus". Renormalising the known half up to a
whole is the single most tempting bug in a pedigree fold, it makes a herd read
purer on paper with every generation, and it is wrong in the direction that
costs somebody money when they sell. `unknownParts` is carried in the result type
and PRINTED, rather than dropped at the end.

**IT IS ALSO NEVER STORED.** A composition is a fold over the pedigree, like the
head count is a fold over movements and FCR is a fold over weighings. The first
time somebody corrects a grandparent — which is exactly what happens when the
papers turn up in a drawer — every descendant's answer changes with it.

**A STATED COMPOSITION BEATS A COMPUTED ONE**, deliberately rather than by
precedence accident: papers outrank arithmetic, and a registered purebred whose
great-grandsire is missing from the app is still a purebred.

**THE WALK REPORTS WHEN IT STOPPED LOOKING.** `truncated` is separate from the
unknown share, because "nobody knows" and "we ran out of generations" are
different sentences and the screen says which. Ten generations and 200 nodes,
both bounded; a pedigree somebody has managed to loop terminates on a visited
set rather than hanging, whatever the write path let through.

**WHAT THE WRITE PATH REFUSES, AND WHAT IT POINTEDLY DOES NOT.** A loop (walked,
because a CHECK cannot see other rows) and a STATED contradiction of sex — a dam
recorded as male is a mis-click, not a fact about biology. **An unrecorded sex is
not a contradiction** and goes through, which is this pack's rule everywhere.
What it does not refuse is a parent of another species: **a mule is a real
animal**, so the picker offers same-species animals and the app declines to
invent a rule about what can breed with what.

**A PARENT NEED NOT BE A LOT OF ONE, and that is how chickens get in.** Fifty
layers are one lot, and "these chicks came from that flock" is both true and the
only pedigree a flock will ever have. Requiring an individual would have made
the whole mechanism unusable for most of the animals on the pilot farm — which
is the lot model paying for itself for the fourth or fifth time.

**A BIRTH IS ONE ACT**: `recordBirth` creates the lot, links both parents and
places the head in one transaction, `source: "raised"` because a born animal has
no purchase basis at all. One calf is a lot of one; ten piglets are a lot of ten.
**The stock line is asked for rather than inherited**, pre-set to the dam's: a cow
in the breeding herd and her calf destined for beef are frequently not the same
item, and inheriting silently would file every calf under her mother.

**ONE BREED ON THE CREATE FORM IS THE WHOLE ANIMAL.** A batch of Cornish Cross or
a purebred cow is the common case and wants one box; a cross is stated on the
animal's own page where there is room for fractions. Four part-fields on the form
that starts a pen of broilers would be three too many.

**THE SUPERSEDED `breed` COLUMN IS NOT DROPPED IN THIS PR** — expand now, contract
after the deploy, per [ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md).
Nothing can parse "½ Angus, ¼ Hereford" back into fractions, so what a tenant
typed is shown as a NOTE asking for it again, and it disappears the moment
somebody obliges. A split still copies the legacy string, so a lot entered before
today does not lose the only breed it has.

**THE ADVISOR NOW SEES THE REAL BREEDING**, resolved and formatted, unknown share
included. It is asked feed-conversion questions, and Cornish Cross against a
slow-growing bird is the difference between a six-week bird and a twelve-week
one. Told "Angus" about a half-Angus calf it would answer with more confidence
than the records support.

**THE HUB SHOWS THE STATED COMPOSITION ONLY**, and that is a decision rather than
a shortcut. Resolving every lot means walking every lot's pedigree; the honest
cheap answer is not a rougher figure but a narrower one. A hub showing a
worked-out fraction and a detail page showing a differently-worked-out one would
be two numbers for one fact, which this pack refuses everywhere else.

**DRIVEN ON HILLTOP FARM, AND IT FOUND THREE THINGS NO TEST WAS GOING TO.**
PEN-1 was given ½ Angus · ¼ Hereford · ¼ Simmental through the dialog, a hatch of
twelve was recorded off it, and the chick read **¼ Angus · ⅛ Hereford · ⅛
Simmental · ½ unknown** — the claim, on real data, in the real app. What clicking
found:

- **Stating a composition EMPTIED THE PAGE HEADER.** The breed has sat beside the
  species since slice 0 because it is half of how a person recognises an animal,
  and `setBreedParts` clears the superseded string — so entering the better
  answer removed the worse one from the header and put nothing back. The header
  reads the resolved composition now.
- **THE BIRTH FORM LIED ABOUT ITS OWN DAM.** It pre-selects the animal whose page
  you are on, and its picker was handed the parent-candidate list, which excludes
  that animal — correctly, for the *parents* form, where an animal cannot be its
  own parent. On a BIRTH the animal is the parent and the new lot is the child.
  The Select had a value with no matching option and rendered "Not recorded" over
  a dam that was in fact set. Two lists now, and the difference is commented
  where it is made.
- **`slugLabel` IS THE WRONG HUMANISER FOR A BREED.** It is sentence case, which
  is right for a kind of thing and wrong for a name: `cornish_cross` came back
  "Cornish cross", which reads as a typo to anybody who keeps cattle. `breedLabel`
  title-cases, and every screen that renders a breed uses it.

Breeds come from the profile, per species (`breedsFrom`), for the same reason
species do — a pack that knew what a Hereford was would know what industry it
was in. Migrations `0217` and `0218`; 24 new pure tests, 10 new ops tests, 6 new
isolation tests. **Applied to BOTH databases before the merge, per
[ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md)** —
`db:migrate` and `db:verify-rls` against the dev branch and against production,
both reporting 148 tables with RLS enabled, forced and policied. Additive only:
a new table and two nullable columns, so the deployed code is unaffected while
it waits for the merge.

### 2026-08-26 — The pack puts on the design system (`claude/two-packs-follow-the-pattern`)

No behaviour changed. Shipped alongside `production` as PR 3 of five, in the
shape [inventory.md](inventory.md) set; the sweep itself is in
[design-system.md](design-system.md).

**THREE OUTLINE BUTTONS OUT OF THE HEADER** — the daily round, feed and Ask —
leaving `LivestockLotForm` as the action. Their ORDER is preserved in
`components/livestock-nav.tsx` because it was a recorded decision rather than
the order they were built in: the round is the daily act, feed is looked at when
one batch is judged against the last, and Ask is the only screen in the pack
that works with nothing recorded at all.

**No props on this strip, unlike production's.** None of the four names is a
word the tenant owns. `lotWord` is — which is exactly why the hub tab is
"Overview" and not a pluralised `lotWord`, the same rule this pack already
records as *"NEVER PLURALISE A LABEL"* after the profile turned `Batch` into
"No batchs yet" on the first screen anybody looked at.

**The three round cards and the four feed cards became `StatCard`s**, including
the feed-conversion one whose label carries a Measured/Estimated badge — the
label slot takes a node, so the provenance stays beside the name of the figure
rather than dropping into a footnote. `Lost today` and `Checked` gained a tone,
so a bad day and a finished round read at a glance instead of only on the
number.

**THE SEVEN CARDS ON THE LOT PAGE STAYED `Panel`, NOT `StatCard`.** Several
carry two or three qualifying lines under the figure — the weight with its tape
badge, the withdrawal with its milk note — and `StatCard` has exactly one
`footnote`. Bending it to take a stack would make every other stat card in the
product harder to reason about. Same call the inventory item page made.

Two dashed-border paragraphs became real `EmptyState`s, six tables went into
`DataTable`, and section headings moved from 14px to the house 20px.

**A REGEX THAT WRAPS EVERY `<Table>` WILL DOUBLE-WRAP THE ONES YOU ALREADY
DID.** Two tables on the lot page ended up `DataTable > DataTable > Table` —
a panel inside a panel, which `tsc` is perfectly happy with. Caught by counting
opens against `<Table>` opens, not by reading. Count, or convert by hand.

Driven on Hilltop Farm: hub, round, feed, Ask and a lot page, read out of the
DOM.

### 2026-08-20 — The pen stopped charging itself for cost that left with the meat (`claude/cost-that-left-with-the-meat`)

**Found by driving `production` slice 0 on the live app**, on a pen with real
feed on it — which the dev tenant could not show, because nothing there had ever
been fed.

BATCH-2 carried **$141.67 of feed across 197 birds — 72 cents a head**. A run
took 100 of them and **$43.15** into the freezer. The Fed card then read
**$141.67 · $1.46 a head**: the numerator sat still while the denominator
halved, so a pen that had just sent most of its cost to the freezer read as
twice as expensive. Read literally, the farm had paid for that feed twice.

**Nothing in the ledger was wrong.** `inventory`'s `lotCarried` had known the
released figure since the day production shipped. This pack simply had no
concept of cost LEAVING a lot — and was right not to, because until that week
nothing could take any out.

- **`FeedLotInput` gains `releasedCents`, `FeedLotRow` gains
  `remainingCents`**, fed from `inventory`'s `carriedCostByLot` — through
  inventory's own query, because the ledger is its table.
- **`centsPerHead` is now over what the pen STILL CARRIES.** That is the number
  that was wrong. `centsPerHeadPlaced` deliberately keeps the gross total: it is
  the batch-against-batch comparison, and what a batch cost to raise does not
  change because some of it was processed and sold on.
- **The Fed card headline stays the full bill**, because the feed WAS fed and
  that is what the word means. A line underneath says how much left with what
  was processed and how much is still on the lot. The feed report's Cost column
  gained the same second line.
- **`releasedCents` is NOT windowed by the report's period**, unlike everything
  else on the row. What a pen is still carrying is a fact about now; answering
  "the last 30 days" with cost handed to the freezer in April would be worse
  than useless.
- **Not clamped at zero.** A negative remainder would mean more cost left than
  was ever recorded going in — a real disagreement somebody should see, not a
  number to tidy away.
- **The allocated share can never be released, and the card now says so.** Only
  cost stamped on a movement can travel; a share of a shared feeder is worked
  out at read time and was never money on the ledger. That is the
  measured-versus-allocated line this pack draws everywhere else, drawn once
  more — and it is why a run carried $85.00 of that pen's $141.67 rather than
  all of it.
- 4 new pure tests, 1 new ops test. No migration, no schema change.

### 2026-08-20 — Slice 6: the clock finally refuses something (`claude/a-run-lands-in-stock`)

Built from the other side, by `production` slice 0. This pack's own Open items
have said the same thing since the clock shipped — *"the clock blocks nothing in
code… and that is all it can be until there is a processing action to refuse"* —
and there is one now.

- **THE SLOT, NOT A DEPENDENCY.** `production` must not require this pack (a
  bakery running runs over purchased flour is a legitimate composition) and this
  pack must not require `production` (a farm that never processes anything still
  has a clock). So production NAMES an extension point in
  `production/core/handler.ts` and `livestock/run-handler.ts` FILLS it. The two
  meet in `src/packs/run-handlers.ts`, which is the only file that knows both
  exist — the same layer, and the same justification, as `src/packs/index.ts`.
  First real use of P5 in the repo.
- **THE REFUSAL IS VERBATIM.** The handler hands back `describeWithdrawal`'s own
  sentence and `production` repeats it: *"PEN-DRUG — Cannot be processed until
  2026-09-05, after Penicillin G."* A withdrawal message is a legal statement
  about whether meat may lawfully be sold, and the pack that does not own the
  clock has no standing to reword it. **`unknown` blocks exactly as `under`
  does, and there is no override** — a farm that genuinely knows the period
  enters it, which is the same act and leaves a record instead of a hole.
- **HEAD STILL LEAVES THROUGH `removeHead`.** That is why `consume` is on the
  handler rather than done in `production`: a run writing its own head movement
  would be the parallel counter this pack was built to avoid. The movement still
  carries `extension_slug = 'livestock'`, because the slug says which pack owns
  the record and not which one pressed the button.
- **A fourth removal reason, `processed`, AND IT IS NOT IN THE PICKER.**
  `REMOVAL_REASONS` is the full set the folds classify; `HAND_REMOVAL_REASONS` is
  what a person may choose, and it is the three it always was. Offering
  `processed` on the lot page would be a way to empty a pen without landing the
  meat, carrying the cost or consulting the clock.
- **`processed` is a REMOVAL in `core/herd.ts`, and getting that wrong would have
  moved the one number the broiler enterprise lives on.** Unrecognised kinds fall
  through to `transfer`; a transfer IN inflates mortality's denominator, and
  classing it as a death would make a successful batch read as a catastrophic
  one. Birds that reach the killing cone are the batch succeeding.
- **`removeHead` now takes a cost and returns its movement.** The pen's
  accumulated cost — chicks, feed and medicine, net of anything already processed
  out — is pro-rated by the head being taken and stamped on the way out, exactly
  as `issueStock` stamps a bag of feed. That is what carries the pen into the
  freezer and makes profit-per-pen answerable. Null for everything a person
  records by hand: a bird that died took no stamped cost anywhere.
- No migration, no schema change in this pack. Full build record in
  [production.md](production.md).

### 2026-08-20 — A clock can be wrong, and now it can be put right (`claude/correct-the-clock`)

Slice 3's own first open item, closed the same day — and the reason it could not
wait is in the item itself: a wrong feed figure costs a bad decision, a wrong
withdrawal clock is a legal record and the row somebody reads before loading a
trailer.

- **THE SAME CALL WEIGHTS MADE, FOR THE SAME REASON.** A treatment record is an
  OBSERVATION, not a ledger entry: if somebody typed 10 days where the label said
  21, no such record ever existed and there is nothing to compensate for. So
  `updateTreatment` edits in place and `deleteTreatment` removes. Third table in
  this pack to land on that distinction, after `land_occupancy` and
  `livestock_weights`.
- **THE VALIDATION RUNS AGAINST THE MERGED ROW, NOT THE PATCH.** Clearing the
  only period a treatment had, while its source still says "off the label",
  produces exactly the row that later reads as CLEAR to somebody about to book a
  processor. Refused — but the same clearing is allowed when the source is
  changed to `none_stated` in the same edit, because that state blocks.
- **THE STOCK ISSUE OUTLIVES THE TREATMENT, and the dialog says so BEFORE the
  button.** The medicine really did leave the shelf: that is an event in
  `inventory`'s ledger, and unwriting it would rewrite what happened — the rule a
  movement exists under. So the record goes, the cost stays on the pen, and the
  screen names the loose end rather than letting somebody find it later as a cost
  they cannot explain. The toast repeats it: *"Removed — the stock that went out
  is still on the pen."*
- **Correcting never offers a previous entry.** The figures on screen ARE this
  farm's record; quietly replacing them with an older entry for the same product
  is the opposite of what somebody opening a correction wants. The
  last-time-you-used-this suggestion fires only when recording something new.
- **The stock picker disappears in correction mode**, for the same reason: the
  medicine already left the shelf, and adjusting that is `inventory`'s job.
- 5 new ops tests. No migration, no schema change.

**Driven, and it caught me repeating yesterday's mistake.** The correction dialog
said *"What it said before is kept"* — the same overpromise the weight form
carried, pointing a farmer at `audit_log.meta`, which nothing in the app renders.
Rewritten to say what the correction actually does to the clock.

The rest held. 21 days corrected to 28 moved the clearance from 2026-09-15 and
the countdown from 19 days to 26, one row throughout. A second treatment recorded
on the same lot showed the binding rule working on real data — Draxxin clearing
2026-09-06 did not displace Penicillin G clearing 2026-09-15 — and removing the
Draxxin row left its 6 fl oz stock issue standing in the ledger, exactly as the
dialog warned.

### 2026-08-20 — Slice 3: the withdrawal clock, and an unknown is not a zero (`claude/the-withdrawal-clock`)

The pack's legal guardrail, and the feature the advisor had twice refused a
question by pointing at — a penicillin dose in slice 1b, an aspirin withdrawal
on the production drive. Both times it said *record the treatment*, which was
slice 3 described by the thing that could not do slice 3's job.

- **THE VALUE IS THE CLOCK, NOT THE TREATMENT RECORD.** A note that a pen got
  penicillin is a diary entry; the fact that those birds cannot go to a
  processor until the 8th is a legal constraint, and it is the one thing in this
  pack that can put uninspectable meat in somebody's freezer if it is wrong.
- **TWO CLOCKS, MEAT AND MILK, NEVER MERGED.** The same injection routinely
  clears milk in days and meat in weeks; one column with a type would force
  whoever entered it to pick which truth to keep. Driven: on the 6th the milk
  was saleable and the animal was not.
- **AN UNKNOWN PERIOD IS NOT CLEARANCE, and that is the safety decision in the
  slice.** A treatment recorded before anybody read the label leaves the lot in a
  third state — `unknown` — that blocks exactly as a future date does. A screen
  that said "clear" because a column was null would be the app inventing the most
  dangerous number available to it. `blocksProcessing` is true for both, because
  to somebody about to load a trailer they mean the same thing.
- **NOTHING IS SUPPLIED BY THE APP.** There is no drug registry behind this and
  there must not be a hardcoded one: periods vary by dose, route, species and
  formulation, extra-label use extends them, and jurisdictions differ. The design
  asks for *a default the user can override* while forbidding the app from
  presenting a number as authoritative — so **the only default is what THIS FARM
  entered last time for the same product**, labelled with the date it came from.
  Driven: recording Penicillin G on a second lot offered *"You last recorded
  Penicillin G on 2026-08-20"* and filled in nothing, because the first record
  had no period either.
- **A stated source has to state something.** Claiming a period came off the
  label while leaving both clocks empty is the row that later reads as clear to
  somebody loading a trailer, so the ops layer refuses it. If nobody looked, that
  is `none_stated` — which blocks.
- **The binding treatment is the one that clears LAST**, not the most recent. A
  30-day product on the 1st outlasts a 2-day product on the 10th, and a clock
  showing the latest treatment would clear the lot while the first was still in
  the animal.
- **Nothing is blocked in code yet, and that is honest rather than an
  oversight.** The design says the lot cannot be PROCESSED and the milk cannot be
  SOLD — and neither of those verbs exists: processing is slice 6, blocked on
  `production`, and milk sale is `retail`. So the clock is loud on every screen
  that shows the lot and sits in the advisor's digest, and **slice 6 must consult
  it before booking anything**. A hard refusal wired to the wrong verb today —
  `sold_live`, say, where a withdrawal legitimately follows the animal to another
  farm — would be worse than none.
- **A sick pen carries its own expense**, through the same door feed does: an
  optional `issueStock` to the lot, with the movement id on the treatment. No
  cents column here.
- 20 new pure tests, 9 new ops tests, 6 new isolation tests. Migration `0166`
  needed **no hand-reordering** — both composite FK targets already existed.
  Seventh check, second time the answer was no. `0167` carries the policies.

**THE CORRECTION SLICE 3 FORCED ON SLICE 2.** Medicine goes through
`issued_to_lot_id` exactly as feed does, which meant the feed report silently
absorbed it: the cost per head, the pounds fed, and worst of all the feed
conversion ratio. `consumedByLotAndItem` and `consumedDatedByLots` now return the
item's KIND and the report excludes medicine — an exclusion rather than a
whitelist of `feed`, because waste streams are recorded under whatever kind they
were bought as. A card reading "Fed" that included the penicillin would be wrong
in the pack that owns the word.

**Two reading defects, both found by clicking.** The Withdrawal card said
"Clear" three times over for a lot nothing had ever been given — badge, headline
and sentence — so the badge is now suppressed until something has been recorded,
the same rule the list already followed. And the Treatments heading lowercased
the whole sentence, turning the one word somebody needs to recognise into
"penicillin g was given…".

**The advisor answered the question it had been deflecting for three sessions.**
Asked whether the processor could be booked for next week: *"HOGS-1: not next
week. Your own record has a meat withdrawal until 2026-09-08 (Penicillin G, off
the label — you looked it up). Next week is Aug 24–30, so any kill date then is
inside it."* On the lot with no period looked up: *"Unknown is not cleared. Those
birds can't go to a processor until someone reads the actual label on the bottle
you used, at the dose and route you gave... I'm not going to put a number on
it."* It quoted their record and still refused to supply one, which is exactly
the line the prompt draws.

### 2026-08-20 — A weighing can be wrong, and now it can be put right (`claude/a-weighing-can-be-wrong`)

Slice 5's own first open item, closed the same day it was written. A mistyped
crate weight was in the gain until somebody edited the database, which for a
number the enterprise is judged on is not a gap that keeps.

- **A MEASUREMENT IS NOT A LEDGER ENTRY, AND THAT DECIDES THE WHOLE SHAPE.**
  Every quantity in `inventory` is corrected by a compensating movement, because
  a movement is an EVENT: the feed really did leave the barn, and unwriting it
  would be rewriting what happened. A weighing is an OBSERVATION — if somebody
  typed 625 for a crate of ten broilers, no such measurement ever existed. There
  is nothing to compensate for and no corrective weighing that would mean
  anything, so `updateWeight` edits in place and `deleteWeight` removes. Same
  call `land` already made for a stay entered by mistake: *correcting a record is
  not rewriting history.*
- **WHICH READING WINS IS DECIDED BY THE DATA, NOT THE METHOD STRING.** Supply a
  scale weight and the tape columns clear; supply a girth and the scale column
  does, and the sample size drops to one because a tape reads one animal. A row
  carrying both would claim two measurements were taken. The method taxonomy is
  open, so this could not be keyed on it.
- **A delete, not a void flag.** A voided row is one every fold in this pack
  would have to remember to exclude, and the only thing it preserves — that
  somebody once typed a wrong number — is what `logAudit` is for. Both verbs are
  `member`: the person who typed 625 is the person standing at the scale, and
  making them fetch the owner to fix a digit is how a wrong number stays in.
- **One form for recording and correcting**, because they are the same act done
  twice. A separate edit dialog would drift from this one the first time a field
  changed, and the fields are the interesting part — the method decides which of
  them exist at all.
- 6 new ops tests. No migration, no schema change.

**Driven, and it found a claim that was true in the database and false on the
screen.** The correction dialog said *"what it said before is kept in the audit
log"*. It is — `logAudit` writes the old and new figures into `meta` — but
**nothing in the app renders `meta`**, so a farmer was being pointed at a record
they cannot open, and a superadmin at one they would have to query by hand. The
copy now says what the correction actually does to their numbers instead, and
the invisible-meta gap is an open item below.

The rest held: 62.5 corrected to 68 moved the average from 6.25 to 6.8 lb, the
gain from 0.129 to 0.144 lb/day and the conversion from 1.04 to 0.94 — one row
throughout, never two. A bogus 45 lb broiler recorded and then removed left the
other two weighings and their gain exactly as they were.

### 2026-08-20 — Slice 5: weights carry a method, and FCR stops being a dash (`claude/weights-carry-a-method`)

Taken out of order, ahead of slice 3, for one reason: **a batch that goes to the
processor unweighed can never have an FCR, and the pilot's broilers are days
away.** Everything on the feed side shipped this morning; this is the other half
of the division.

- **A WEIGHT IS AN OBSERVATION CARRYING A METHOD**, and the method is why this is
  a table rather than a column. A crate of ten on a scale and a tape round a
  heart girth are the same shape of fact and deserve very different confidence —
  the design's rule, now computable: feed measured against a scale is a number to
  act on, anything with an estimate at either end is a trend to watch.
- **A TAPE STORES THE TAPE.** `heart_girth_in` and `body_length_in` are what
  somebody actually measured; the pounds are derived at read time through a
  divisor that lives in the PROFILE. So a corrected divisor reweighs every animal
  ever measured rather than only the next one — the opposite call from
  `cost_cents`, deliberately, because a cost is a transaction and a measurement
  is an interpretation.
- **The divisor is config, not code.** A pack that knew a pig is 400 and a cow is
  300 would know what a pig is. `tapeDivisorFrom` reads `packConfig`, poultry is
  deliberately absent — nobody tapes a chicken — and the form does not offer the
  method for a species with no divisor. Driven: Tape appears on a swine lot and
  not on a poultry one.
- **THE FCR WINDOW IS THE GAIN WINDOW, NOT THE REPORT'S**, and this is the
  sharpest decision in the slice. Feed fed before anybody put a bird on a scale
  made gain nobody measured, so counting it would inflate the number badly — for
  exactly the farm that starts weighing halfway through its first batch, which is
  every farm's first batch. `foldGroups` became a function so the allocation can
  be re-run over each lot's own window; it is the same arithmetic over fewer
  draws rather than a pro-rated guess.
- **A HAUL LIES TO WEIGHT DATA, AND A WALK DOES NOT.** Cattle drop 3–5% on a
  trailer and take days to put it back. `land.lastHauledOn` finds the last move
  that CROSSED A PARCEL BOUNDARY — land's own definition of a haul — because a
  flag that fired on every daily paddock move would be ignored inside a week.
  A weighing within three days of one is kept, badged, and left out of the gain.
- **Refusals outnumber answers, and each one says why.** No weighings, one
  weighing, two on the same day, everything shrink-affected, a negative gain, no
  feed recorded by weight: six paths, each returning null with a sentence the
  screen prints in the cell. A blank would be indistinguishable from a bug, and
  for a farm's whole first season the reason is the useful part.
- **Feed per pound of LIVEWEIGHT is not FCR and is never called it.** It exists so
  a first batch with one weighing gets something real, and it counts the weight
  the animal arrived with as though the feed had made it — nearly true for a
  chick, not true at all for a bought-in feeder steer.
- 31 new pure tests, 7 new ops tests, 6 new isolation tests. Migration `0164`
  needed **no hand-reordering** — its one composite FK targets `livestock_lots`,
  which has existed since `0138`. Sixth time the rule was checked, first time the
  answer was no. `0165` carries the policies.

**Driven, and the advisor found the defect — for the third time it was the
DIGEST rather than the prompt.** Given *"gaining 0.129 lb a day"* and nothing
else, it noticed the figure was close to the latest weight divided by the bird's
age and told the founder the gain was being read off hatch rather than off two
weighings. It was not — the lot page says "over 39 days" — but nothing in the
digest could prove it, so the objection was fair and the answer was wrong. The
gain window now travels with the rate, and the same question came back: *"0.129
lb a day — that's from your own records: 6.25 lb a head on 2026-08-18, measured
against a weighing on 2026-07-10, 39 days apart."*

It also did the thing this pack keeps being built for: said unprompted that a
1.04 : 1 conversion *"usually means some of the feed they ate wasn't booked to
PEN-1, not that they're doing something remarkable"* — which is exactly right
about the test data, and is the mixed-provenance badge being reasoned from
rather than merely displayed.

### 2026-08-20 — Slice 2: feed, and the seam that survives fifteen pens on one bin (`claude/feed-and-fcr`)

The largest cash cost, and the first slice in this pack whose output is a
REPORT rather than an entry screen. Inventory slice 1 had already closed the
costing loop for a bag handed to a named pen; what was missing was the number
that loop exists to produce, and the other half of the design's *"both paths
must exist"*.

- **THE SLICE IS THE ALLOCATION SEAM, and the design calls it the single
  largest consequence of the 10× target.** At 1× a bag goes to a pen and
  somebody knows which pen: that is `issued_to_lot_id`, it was already built,
  and it needed nothing here. At 10× a ton arrives into a bin serving ~15 pens
  and nobody will ever know which bird ate which pound, so the cost must be
  **allocated by head × days on feed rather than assigned**. Three tables carry
  that and not one number about feed.
- **A DRAW IS AN ORDINARY ISSUE.** `recordFeedDraw` calls
  `inventory.issueStock` with `issuedToLotId` null and stamps the cost at the
  average exactly as a direct issue does; `livestock_feed_draws` is a JOIN table
  saying that movement was drawn for that feeder. No second ledger, no second
  cost, and the allocated figure can therefore never disagree with the delivery
  it came from. Same shape as `livestock_lots` on the spine: inventory owns the
  quantity, this pack owns what it means.
- **HEAD IS NEVER RE-ENTERED.** The basis is head × days and head on any given
  day is a running balance of the ledger the count on the lot page already
  comes from. What the ledger cannot know is *when a pen went onto the bin* — a
  batch brooded on bagged starter has head standing the whole time and is only
  on the bin for part of it — so membership is date-ranged and that is the only
  extra fact collected. Land's rule, applied to a report.
- **PROVENANCE IS ON THE ROW, NOT IN A FOOTNOTE.** Measured / Allocated / Both,
  with the reasoning in the tooltip. The design's rule is that every derived
  cost carries its provenance and that at 10× the bagged number becomes an
  allocated one, so this is permanent rather than transitional.
- **NO FCR, SAID IN WORDS.** Feed conversion is feed per pound of GAIN, gain
  needs weights, and weights are slice 5. The card reads "—" and the page says
  what it cannot compute. `FCR_NEEDS_WEIGHTS` is one string in one place so the
  feed page and the lot page cannot drift into implying different things.
- **The pieces sum exactly to the pot**, by largest remainder. Unlike
  `issueCostCents` — where the remainder is a real consequence of stamping each
  issue as it happened — a pot divided in one act has nothing for a remainder to
  be a fact about, and an allocated bill that is three cents off is checked once
  and never trusted again.
- **Cost that could not be allocated is REPORTED, never dropped.** Feed drawn
  for a feeder no lot was on is money the farm spent; the banner names the
  figure and says how to make it land. Driven: a $25.00 draw against an empty
  bin, surfaced with the fix beside it.
- **Waste streams stay representable.** Spent grain, surplus milk, garden culls
  and expired bakery arrive with a null cost, are carried through as fed rather
  than spent, and are COUNTED so the report can say so. The item picker for a
  draw excludes only livestock — a whitelist of `feed` would have refused half
  of what this farm actually feeds.
- **The advisor can see feed now**, which closes one of this dossier's own open
  items. Asked what PEN-1 had cost, it answered *"$260.78 so far, $2.61 a head.
  That's cost, not pounds of feed"*, called its own confidence *partial* because
  part of it is a shared-feeder share, named the assumption the split rests on
  (a bird in one pen eats like a bird in the other), and refused the FCR: *"I'm
  not going to hand you an estimated FCR, because it would be a number I made up
  wearing your farm's name."* Then it said exactly what to record to get a real
  one. No prompt change — the digest carries feed and its provenance, and that
  is the whole of it.
- 33 new pure tests, 13 new ops tests, 10 new isolation tests. Migration `0162`
  **hand-reordered, sixth time**; `0163` carries the policies.

**Driving it found four defects, and every one of them was a reading problem
that types and tests could not see.**

| What the screen said | Why it was wrong |
| --- | --- |
| `$0.00 a head` on a pen nothing had been fed | Reads as *feeding this batch cost nothing*. Same lie `mortalityRate` refuses when it returns null rather than 0% for an empty pen. Now an em dash |
| `+$1.00 vs last batch` between two pens placed the same day | Two batches placed on one day are contemporaries, not a sequence — and the "previous" one had no feed recorded at all, so the delta was the whole of this batch's cost dressed as a regression. Now: strictly earlier, and it must have been fed |
| **Broiler chicks offered as something to draw into a feed bin** | Both are inventory items and the ledger has no opinion; nothing would have refused issuing live birds out of stock and charging them to themselves. Third time this shape has appeared — after land's structures and inventory's locations |
| `521.569 lb` of feed | An allocated quantity carries the full precision of the division. A share rendered as a measurement to the gram |

### 2026-08-19 — Animals are started here, and Inventory now says so (`claude/animals-live-in-livestock`)

`Start a lot` on this page creates the inventory item, the batch and the biology
in one transaction — it always has, including naming a brand-new "Counted as"
item inline. What was missing was anywhere SAYING so: the founder, looking at
"Broiler chicks" on the Inventory list beside his feed, asked which page he was
supposed to add animals to.

Fixed on the other side of the seam, because that is where the confusion lives.
See [inventory.md](inventory.md) — a livestock-kind item now links here, and
picking "Livestock" in Inventory's *Add an item* sends people to this page
instead of letting them make a stock line with no animal behind it.

**Both pages are right.** Market animals ARE inventory, which is exactly what
makes cost per pen fall out of the same ledger as the feed. Inventory shows the
stock line; this page shows the batches and their biology.

### 2026-08-19 — Driven on production, and the migration that had not run (`claude/mark-normal-reads-as-a-button`)

Both slices clicked on the live tenant for the first time. **The first thing it
found was not in the code: PRs #205 and #206 were merged and deployed while
migrations 0156 and 0157 had never been run against production**, so the round
page and the lot detail page both threw. Applied, then verified in `pg_class`
and `pg_policies` — the table is there with RLS enabled and forced and both
policies present. See [prod migration drift](../runbooks/) territory: a merged
migration is not an applied one, and nothing in the deploy runs it.

**What held.** The round listed BATCH-2 and correctly left STEERS-26 off it —
zero head is a batch that has gone, not a pen somebody forgot. One tap recorded
the farm ("1 lot marked normal"), the streak went to a day, and last-checked
went to Today. Recording three dead through the exception dialog moved the head
count 200 → 197 on the same screen, flipped the badge from Normal to Noted,
filled "Lost today", and put the note in "Noted today" — and the loss appeared
in `inventory`'s own ledger on the lot page as a Died event, which is the
cross-pack spine visible in one screen.

**The advisor, on real records, did the thing the design argued for.** Asked
whether BATCH-2's loss rate was normal it separated 6.2% total into 9 on day 7
(brooding, high but not alarming), 38 clean days, then 1 on day 46 and 3 on day
49 — and noticed the first of those landed **the day the birds were moved to
North Pasture**. It named what to check today and gave a falsifiable follow-up:
another 3 tomorrow is a trend, back to zero or one means it was the move.
Nothing in that answer is available to a model without the digest.

**The guardrail held in production too.** Asked for an aspirin dose and a
withdrawal before processing, it refused both, explained why no withdrawal
figure exists to look up (no approved label, so no residue study), noted these
birds are days from processing, and moved to management — water, shade, air,
feeding times — and a poultry vet.

**One defect, and it was a reading problem rather than a logic one.** The
per-lot quick action was a ghost button reading "Normal", in the same cell that
shows a "Normal" badge once the lot is checked. Control and state looked nearly
identical. Now an outlined **"Mark normal"** — an instruction rather than a
fact.

### 2026-08-19 — Slice 1b: the advisor, and the digest is the product (`claude/livestock-advisor`)

The other half of the wedge — *ask it things, tell it things*. Slice 1a made
telling it things cheap; this makes asking possible on a farm with no history at
all, which is the half that works on the day a tenant is created.

- **No migration, and that is the slice.** The conversation lives in component
  state, the facts are assembled per question inside `withTenant`, and nothing
  is written. The pack-wide rule that *AI never produces a number entering the
  books or an animal without a human seeing it first* is therefore true here by
  construction rather than by discipline.
- **The digest is the whole differentiation.** `core/digest.ts` builds what the
  advisor is told about this farm: head, intake and losses per lot with the
  DATES of each loss and the animal's age at it, where each group is and since
  when, how long each paddock has rested, what stock is on hand, and how the
  recording habit is going. A model without it is a worse search engine. The
  design's AI thesis, now built: *the anchoring is the differentiation, not the
  model.*
- **DRIVING THE PROMPT AGAINST THE REAL API FOUND TWO GAPS, AND THE ADVISOR
  NAMED THEM ITSELF.** Asked whether a loss rate was normal, it answered *"what
  matters most is when the eight died, and your records don't capture that"* —
  but they do; the digest was dropping the dates. Asked where a herd should go
  next, it said the digest did not show when she moved onto the paddock. Both
  are now carried, and the second answer changed completely: it correlated two
  loss clusters with the paddock move sixteen days in, separated predation from
  heat from flip, and told the founder what to look at today. **That is the
  difference between a chatbot and this feature, in one before-and-after.**
- **Where the line sits, and it is on the screen as well as in the prompt.**
  Ask-and-orient is ungated and approximate. Compute-and-commit is refused: no
  dose, no withdrawal period, no jurisdiction's inspection rule. Asked for a
  penicillin dose and withdrawal it declined, explained what governs both (the
  label, the dose and route actually used, extra-label use, a vet under a valid
  relationship) and told the founder to record the treatment — which is the
  right answer and is also slice 3's feature described.
- **It never claims a fact it was not given.** With no pigs on record it said so
  and answered from general husbandry, then said what to record so the next
  answer would be about this farm. That behaviour is prompted, and it is the
  reason the digest states its own caps out loud rather than truncating quietly.
- **The classification stays this pack's.** `inventory.datedMovementsForLots`
  returns dated rows and has no opinion about which are deaths; `headEffect`
  decides, here, as it has since slice 0.
- 14 new pure tests, 4 new ops tests. No new isolation tests, deliberately: the
  slice adds no table, and every read it makes is already certified where it
  lives.

### 2026-08-19 — Slice 1a: the round is one tap, and the row IS the check (`claude/livestock-daily-log`)

The day-one wedge, and the first thing built in this pack that is not about
animals arriving or leaving. The cold start is the constraint the design says
outranks the schema: the pilot records nothing today, has no spreadsheet to
replace and no habit to attach to, and every report this pack will ever produce
— FCR, mortality by week, sire comparison — returns nothing at all until
somebody has been entering things for a season.

- **The whole table exists for one distinction: "zero died" and "didn't check"
  are different facts.** A ledger cannot carry it. `inventory_movements.quantity`
  is CHECKed non-zero, correctly — a zero-quantity movement is not an event — so
  a day when nothing happened leaves the ledger empty, and empty is
  indistinguishable from nobody having walked the pens. `livestock_daily_logs`
  is that missing fact and nothing else: **the row's presence IS the check.**
  There is no `checked` boolean, because a row saying `checked = false` would be
  a record of an absence, which is what absence already is.
- **The losses are NOT a column on it.** A loss entered during the round goes
  through `removeHead` into inventory's ledger, in the same transaction, and the
  round screen reads it back out with `movementsOnDate`. Land's rule — *anything
  derivable from a record already being made must never become a second data
  entry* — applies to storage as much as to forms: a `deaths` column here would
  be a second number that has to agree with the ledger forever, and the first
  time they disagreed nobody would know which was right.
- **One tap for the whole farm.** "All normal" inserts a check for every lot not
  yet looked at, `ON CONFLICT DO NOTHING` against the one-per-lot-per-day index.
  That clause is what makes the button usable rather than dangerous: enter the
  exception first, tap the button second, and **the exception survives** — in
  the database, not in a read-then-write race.
- **A loss forces `attention`, whatever the caller says.** Four dead birds
  against a "normal" check is a contradiction, and the ops layer is where it has
  to be impossible rather than the screen.
- **The streak does not reset at breakfast.** It counts back from today when
  today has an entry and from yesterday when it does not, and breaks on the
  first missing day before that. A counter that dropped to zero every morning
  would punish somebody for opening the app early, and a habit counter nobody
  trusts is worse than none.
- **The round is the lots with animals standing in them** — balance > 0. A
  finished batch is not a pen somebody forgot; leaving them on would grow the
  list by one every time a batch closed, and the first thing an unusable list
  teaches is to stop tapping the button.
- **Writes are `member`, and this is the table that proves the point of that
  change.** Owner-only here would mean the check that distinguishes "zero died"
  from "didn't check" simply never gets recorded, because the person in the pen
  is not the owner.
- **`attention` is a bookmark, not a severity.** Two values only. A third would
  be a scale nobody calibrates the same way twice, and the notes carry what was
  actually seen. It renders as "Noted" rather than "Needs a look", because a
  live sale recorded on the round is not a problem.
- Migration `0156` needed **no hand-reordering** — both its FK targets
  (`tenants`, `livestock_lots`) already existed, which is the documented rule
  working rather than the exception to it. `0157` carries the policies.
- 17 new pure tests, 11 new ops tests, 4 new isolation tests.

### 2026-08-16 — You could not add cattle without leaving (`claude/counted-as`)

Founder, trying to add cattle: *"the counted as only has an option for broiler
chicks? Maybe I'm not understanding the purpose of that. Also the breed has
cornish cross."*

Both halves were real, and the first was a wall.

- **"Counted as" is the inventory ITEM the head are counted in**, and it had to
  exist before the lot could. The tenant's only head-stocked item was "Broiler
  chicks", so the picker cheerfully offered to count cattle as broiler chicks,
  and the only way out was to leave for the Inventory module and come back.
- **The explanation existed exactly once, in a state you never see again** — the
  zero-items empty state. The moment you added your first item it vanished, and
  it was needed most for your second species.
- **`createLivestockLot` now takes `newItemName` instead of `itemId`**, creating
  the stock line and the lot in one transaction. The picker gets the same
  *"Something else…"* escape the species picker already had, which is why the
  fix costs one option and a text box.
- **The item is still a real and separate thing, and is not auto-created from
  the species.** A farm running beef and dairy wants two stock lines for one
  species. Guessing one item per species would have made that unrepresentable
  and quietly wrong in the P&L.
- **The button no longer requires an item to exist**, so a farm's first animal
  is enterable from this page. The "nothing to count animals as" empty state is
  gone with it.
- **The breed placeholder follows the species.** A fixed *"e.g. Cornish Cross"*
  under Species: Cattle reads as an instruction, not an example. `breedHint`
  returns nothing for a species it does not know — an empty box beats a
  confident irrelevance, and species is an open taxonomy so unknown is ordinary.

### 2026-08-16 — Rotating a herd is one act again (`claude/move-occupant`)

`moveLotToZone` calls land's new `moveOccupant` instead of `startOccupancy`, so
moving a lot that is already on a paddock takes it off that paddock rather than
refusing. The refusal was correct and the workflow was broken — five clicks
across two modules for the single most frequent act on a rotational farm.

- **The date arithmetic is land's, not this pack's.** `moveOccupant` returns
  `{ occupancy, movedOff }`; this pack passes it through and never touches
  `ended_on`. See [land.md](land.md) for the inclusive-bound rule.
- The dialog names the paddock they will come off before the move happens, the
  toast names the one whose rest clock just started, the picker leaves out the
  paddock they are already on, and the audit entry records the closed stay.
- **Still one lot at a time.** "Move every pen to the next paddock" is one act
  in the design and N dialogs here — but N is now one dialog each rather than
  five clicks each.

### 2026-08-15 — The daily log gets someone to write it (`claude/pack-write-levels`)

This pack is the one that forced the change; the full reasoning is in
[packs-and-profiles.md](packs-and-profiles.md). What it means here:

- **Placing head, recording a loss, moving a lot to a zone and applying or
  retiring a tag are open to any member.** Recording four dead birds across
  twenty pens is daily work done by whoever is standing in the pen.
- **Creating, editing and splitting a lot stay with the owner**, all three
  because they touch the cost object. Splitting is the awkward one — it is a
  chore in the yard — but it happens at batch placement, a handful of times a
  season.
- The detail page's action bar is no longer wrapped in `isOwner`; only
  `SplitHerdForm` is.
- **Slice 1 is now unblocked.** It was waiting on exactly this.

### 2026-08-15 — Slice 0: two tables, because the other three already existed (`claude/livestock-lots`)
- **THE PACK MODEL'S BILL CAME DUE, AND IT PAID.** The design's slice 0 is "lots
  + head ledger + occupancy", and all three already existed: the lot and the
  ledger are `inventory`'s, occupancy is `land`'s. What was left to build was
  species, birth date and tags — **two tables instead of six**.
- **A split still balances when livestock drives it**, and carries the biology
  across: 210 chicks split 70 into a pen leaves 140 and 70, both still Cornish
  Cross hatched on the same day. Certified in `tests/livestock-ops.test.ts`.
- **Head events go into inventory's ledger, stamped `extension_slug =
  'livestock'`.** Attributable without being a second ledger, and the head count
  is the same fold inventory's own pages use.
- **Putting a herd on a paddock writes `land`'s occupancy and starts its rest
  clock** — the seam land slice 1 was built for, now with a real caller. The
  occupant reference is the INVENTORY lot id, not the biology row's, because
  that is the spine and it survives this pack being switched off.
- **This pack imports two others, and that is allowed because it declares
  them.** `requires: ["inventory", "land"]` is the whole permission; a pack must
  never reach into something it does not require.
- **Mortality is a query**, not a stored field, and it returns null rather than
  zero before anything has been placed — a lot showing 0% loss with no animals
  in it reads as reassurance.
- 18 pure tests, 11 ops tests, 9 isolation tests.

## Data model

| Table | Purpose | Notes |
| --- | --- | --- |
| `livestock_lots` | The biology on an inventory lot | **1:1**, enforced by a unique index on `(tenant_id, inventory_lot_id)`. Composite FK to `inventory_lots`, CASCADE. `species` open taxonomy; `sex` in `male\|female\|mixed`. **`dam_lot_id` / `sire_lot_id`** are composite SELF-FKs, RESTRICT, with a CHECK against being one's own parent — and they are NOT `inventory_lots.parent_lot_id`, which is the split chain. The free-text `breed` column was DROPPED by `0221` |
| `livestock_breed_parts` | **What an animal is made of, as somebody stated it** | One row per breed per animal, unique on `(tenant_id, lot, breed)`. `parts` is an integer out of the row's siblings — 2 : 1 : 1 is ½, ¼, ¼ — because percentages force a rounding decision the person never made. **The RESOLVED composition is never stored**: it is a fold over the pedigree in `core/pedigree.ts`, and a stated one beats a computed one |
| `livestock_capital_transfers` | **An animal stopped being inventory, or started again** | Slice 4f. Direction `to_breeding\|to_market`, the amount that moved, and the three things the event produced: the ASSET she became, the ENTRY that moved the money, and (historically) a movement. **There is no `breeding` flag anywhere** — the state is a fold over these rows, newest first. `journal_entry_id` is null for a tenant with no books: the decision still happened |
| `livestock_groups` | ~~A herd, mob or flock~~ **BEING DROPPED — slice 8e.** See [The model, settled](#the-model-settled-2026-08-27) | Holds LOTS, not animals, which is what lets one hold a named cow and a counted pen at once. Same shape as `livestock_feed_groups`: named, `active\|closed`, closed keeps reporting. **The head total is a fold over its members and is never stored** |
| `livestock_group_members` | Which lots are in a herd, **between which dates**. **SURVIVES slice 8 with its parent FK retargeted at `livestock_lots`** — this is the mechanism "animals live in a lot" needs | Inclusive `ended_on`, matching `land_occupancy`. **At most ONE OPEN membership per lot across all herds**, partial unique index — a cow is not in two herds, and that is what makes moving between them one act. Composite FKs to both sides, CASCADE. **No head event is ever written by a membership change** |
| `livestock_identifiers` | What an animal is called | Many per lot, typed and **date-ranged**. Composite FK to the lot, CASCADE. Indexed by value, because finding an animal by its tag happens in a chute |
| `livestock_daily_logs` | **Somebody looked.** One row per lot per day | UNIQUE on `(tenant_id, livestock_lot_id, logged_on)` — one look is one fact, and the constraint is what lets the one-tap round insert ON CONFLICT DO NOTHING. `status` in `normal\|attention`. **No deaths column**: losses are movements, joined by lot and date |
| `livestock_feed_groups` | **A shared feeder** — a bin, a bulk bag, a trough | Holds the FEEDER, not the feed: no quantity, no cost, no balance. `status` in `active\|closed`; closed keeps reporting. Deliberately not an asset — a feeding group is a set of animals sharing a cost, so two bins feeding one flock are one group |
| `livestock_feed_group_members` | Which lots eat from it, **between which dates** | The dates are the whole reason this is a table: head on any day is already in the ledger, but *when a pen went onto the bin* is not. `ended_on` INCLUSIVE, matching `land_occupancy` |
| `livestock_treatments` | **What went into an animal, and when it is safe to eat** | TWO clocks — `meat_withdrawal_days` and `milk_withdrawal_days`, both nullable and never merged. `withdrawal_source` in `label\|vet\|none_stated` carries where the number came from; `none_stated` BLOCKS. `dose` is free text and nothing computes on it. Optional `inventory_movement_id` puts the cost on the pen |
| `livestock_weights` | **What they weighed, and how anybody knows** | `method` open taxonomy (`scale`, `sample`, `tape`, `visual`). `sample_size` head went on the scale and together weighed `sample_weight_lb` — the AVERAGE is a division at read time and is never stored. A tape stores `heart_girth_in` + `body_length_in` and no pounds at all. CHECK: something must have been measured |
| `livestock_feed_draws` | **This movement was feed drawn for that feeder** | A JOIN, not a second ledger. Composite FK to `inventory_movements`, which holds the quantity and the stamped cost. UNIQUE per movement — two rows would put one cost in two pots |

**Everything else lives in a pack this one requires:**

| The question | Answered by |
| --- | --- |
| How many head? | `inventory_movements`, folded by `core/herd.ts` |
| Which batch, and what did it come from? | `inventory_lots` |
| What did this pen cost? | `dimension_members`, synced by `inventory` |
| What did it eat, and what did that cost? | `inventory_movements` — measured via `issued_to_lot_id`, allocated via a draw |
| What is it made of, and who were its parents? | This pack — `livestock_breed_parts` and the two parent columns, folded by `core/pedigree.ts` |
| Which paddock are they on, and in what pen? | `land_occupancy`, via `land's own query |
| How long has that paddock rested? | `land`, computed from the same record |

## Key files & seams

- `src/packs/livestock/core/herd.ts` — pure. Head summary, mortality, age,
  identifier preference. **The classification of movement kinds lives here**,
  not in inventory: what counts as a death is livestock's business
- `src/packs/livestock/ops.ts` — composes `inventory` and `land`
- `src/packs/inventory/ops.ts` → `movementKindsForLots` — added for this pack.
  `MovementRow` carries only what a balance needs; a caller that must tell a
  death from a transfer needs the kinds too
- `src/packs/land/ops.ts` → `currentZoneForOccupants` — added for this pack, and
  it lives in `land` because `land` owns that table
- `src/packs/livestock/core/daily.ts` — pure. The round's arithmetic: streak,
  progress, last-checked, and the losses read back out of the ledger
- `src/packs/livestock/components/daily-round.tsx` — the one-tap button, the
  per-lot quick confirm, and the exception dialog
- `src/app/dashboard/m/livestock/log/page.tsx` — the round
- `src/packs/livestock/core/digest.ts` — pure. **What the advisor is told about
  this farm.** Read this before changing anything about answer quality; the
  model is not the variable, the digest is
- `src/packs/livestock/ai/advisor.ts` — server-only. The system prompt and the
  call. Never imported by a client component, so the prompt does not ship in the
  public bundle
- `src/packs/livestock/components/advisor-chat.tsx` — the ask screen
- `src/app/dashboard/m/livestock/ask/page.tsx` — fetches almost nothing: the
  digest is built per question, so an answer never comes from a snapshot taken
  when the tab was opened
- `src/packs/inventory/ops.ts` → `datedMovementsForLots` — added for the digest.
  Dates matter to a diagnosis and not to a balance
- `src/packs/inventory/ops.ts` → `movementsOnDate` — added for the round, so it
  can show today's losses WITHOUT storing them
- `src/packs/livestock/core/feed.ts` — pure. **The allocation fold, and the
  provenance rule.** Head day by day, head-days against a membership span,
  largest-remainder split, and `FCR_NEEDS_WEIGHTS`. Read this before changing
  anything about what a pen was charged
- `src/packs/livestock/ops.ts` → `feedReport` — assembles it from three sources
  and no fourth: this pack's feeders, `inventory`'s ledger, and the head balance
  that is itself a fold of that ledger. Nothing stored, so re-running after a
  correction gives the corrected answer
- `src/app/dashboard/m/livestock/feed/page.tsx` — the report and the feeders
- `src/packs/inventory/ops.ts` → `consumedByLotAndItem` — added for this report.
  A total answers a card; a report needs the quantity, the unit it is
  denominated in, and how many entries carried no price
- `src/packs/inventory/ops.ts` → `movementsByIds` — added for the draws, which
  are inventory rows this pack holds ids for
- `src/packs/inventory/ops.ts` → `datedMovementsForLots(…, null)` — **`limit:
  null` means every row**, because a running balance cannot start in the middle
  of a ledger. A cap is right for a digest and wrong for arithmetic
- `src/packs/livestock/core/withdrawal.ts` — pure. **The clock, and the file
  where being quietly wrong is a legal problem.** Read this before changing
  anything about treatments; every function in it errs toward saying an animal is
  still under a period
- `src/packs/livestock/components/treatment-controls.tsx` — the form whose job is
  to refuse to guess
- `src/packs/livestock/run-handler.ts` — **the enforcement point.** Fills the
  slot `production/core/handler.ts` declares: claims this pack's lots, blocks on
  the meat clock, and takes head out through `removeHead`. Read
  [production.md](production.md) before changing its shape
- `src/packs/livestock/core/weights.ts` — pure. **The tape formula, the gain, the
  shrink window and the confidence rule.** Read this before changing anything
  about FCR; nearly every function in it returns null on purpose
- `src/packs/livestock/vocabulary.ts` → `tapeDivisorFrom` — the profile's
  girth² × length ÷ divisor, per species. Null means no estimate, never a default
- `src/packs/land/ops.ts` → `lastHauledOn` — added for this slice, and it lives
  in `land` because the record is land's. A haul is a PARCEL crossing; a walk to
  the next paddock is not
- `src/packs/inventory/ops.ts` → `consumedDatedByLots` — added for the FCR
  window, which is different for every lot
- `src/packs/livestock/components/weight-controls.tsx` — the form whose shape
  changes with the method
- `src/packs/livestock/core/pedigree.ts` — pure. **The composition fold, and the
  file where being generous is the bug.** Read this before changing anything
  about breeding: `resolveComposition` takes half from each parent whatever
  either is made of, and `unknownParts` is carried through and printed rather
  than normalised away. Also `isAncestor`, which is the write-time loop guard a
  CHECK cannot be
- `src/packs/livestock/ops.ts` → `pedigreeIndex` — walks UPWARD generation by
  generation, so a ten-deep pedigree is ten queries and not a thousand. Bounded
  twice, and a bound that bites shows up as `truncated` rather than as an
  unknown parent
- `src/packs/livestock/ops.ts` → `setParents` — every refusal it makes, and the
  one it deliberately does not (another species: a mule is real)
- `src/packs/livestock/ops.ts` → `recordBirth` — the lot, both parents and the
  head in one transaction. **Read its comment before touching lineage**: it does
  not set `inventory_lots.parent_lot_id`, and that is the point
- `src/packs/livestock/ops.ts` → `transferToBreeding`, `returnToMarket`,
  `capitalStateByLot` — **slice 4f, and the only place this pack posts a journal
  entry.** Read the section header before changing any of it: the head stays,
  the money moves, and the first version got that the other way round
- `src/packs/inventory/ledger-ops.ts` → `postCapitalisation` — Dr fixed assets,
  Cr inventory. **Not `postMovement` with a different account**, and its header
  says why
- `src/packs/inventory/ops.ts` → `valueStock`, `carriedCostByLot` — both respect
  `capitalised_on`, which is what stops a capitalised cost being counted twice
- `src/packs/livestock/components/capital-controls.tsx` — the two dialogs, whose
  copy carries more accounting than anything else in the pack on purpose
- `src/packs/livestock/ops.ts` → `moveGroupToZone` — **the reason a herd is worth
  having.** Every member through `land`'s own `moveOccupant`, in one
  transaction, reporting what it could not move rather than a count
- `src/packs/livestock/ops.ts` → `groupSummaries` — the hub's herd rows: head,
  how many are named, and where, in as few queries as the shape allows
- `src/packs/livestock/components/herd-controls.tsx` — start, move, add, take
  out, edit. **Every string takes the tenant's word as a prop**
- `src/app/dashboard/m/livestock/herds/[id]/page.tsx` — one herd and what is in
  it, named animals and counted pens in the same table
- `src/packs/livestock/components/individual-controls.tsx` — "record as
  individuals": a block of names in, N lots of one out, with the balance and
  duplicate checks shown before the button rather than as refusals after it
- `src/packs/livestock/ops.ts` → `splitIntoIndividuals`, `startIndividual` — the
  two ways an animal becomes its own record. **Read `inheritedTreatmentSources`
  before touching either**: a split carries the withdrawal clock, and it is the
  one thing in this pack whose failure is a legal problem rather than a wrong
  number
- `src/packs/livestock/components/pedigree-controls.tsx` — the composition
  editor (parts in, share shown as you type), the parent pickers and the birth
  form
- `src/packs/inventory/ops.ts` → `lotsByIds` — added for the pedigree screens,
  which hold animal ids and need the code a person calls each one
- `src/packs/livestock/vocabulary.ts` → `breedsFrom` — the profile's breeds per
  species. The pack names none, for the reason it names no species
- `src/db/schema/livestock.ts` · `drizzle/0138_*.sql` · `drizzle/0139_livestock_rls.sql`
  · `drizzle/0156_*.sql` · `drizzle/0157_livestock_daily_logs_rls.sql`
  · `drizzle/0162_*.sql` · `drizzle/0163_livestock_feed_rls.sql`
  · `drizzle/0164_*.sql` · `drizzle/0165_livestock_weights_rls.sql`
  · `drizzle/0166_*.sql` · `drizzle/0167_livestock_treatments_rls.sql`
  · `drizzle/0217_*.sql` · `drizzle/0218_livestock_breed_parts_rls.sql`
  · `drizzle/0221_*.sql` (**the contract — runs AFTER the deploy**)
  · `drizzle/0222_*.sql` (**hand-reordered**) · `drizzle/0223_livestock_groups_rls.sql`
  · `drizzle/0224_*.sql` · `drizzle/0225_livestock_capital_transfers_rls.sql`
  · `drizzle/0226_*.sql` (`inventory_lots.capitalised_on`)

## Decisions & gotchas

- **AN UNKNOWN WITHDRAWAL PERIOD IS NOT CLEARANCE.** A treatment recorded with
  `none_stated` blocks exactly as a future date does, and `blocksProcessing` is
  true for both. Never relax this into "no period means no wait": the null column
  is the absence of a fact, and reading it as zero is the app inventing the most
  dangerous number it has access to.
- **NO DRUG REGISTRY, EVER.** Periods vary by dose, route, species, formulation
  and jurisdiction, and extra-label use extends them. The only default offered
  anywhere is what THIS farm entered last time for the same product, labelled
  with its date. A built-in table would be confidently wrong on somebody's
  actual bottle.
- **A stated source has to state something.** `label` or `vet` with both clocks
  empty is refused — that row would later read as clear.
- **The binding treatment clears LAST, not most recently.** A long-withdrawal
  product given first outlasts a short one given after it.
- **THE MEAT CLOCK NOW REFUSES A PRODUCTION RUN, and that is its only
  enforcement point.** `livestock/run-handler.ts` consults `blocksProcessing`
  before a run may consume a pen, exactly as this section promised it would.
  **Do not wire a refusal to `sold_live`**: a withdrawal legitimately follows an
  animal sold live to another farm. The MILK clock still refuses nothing —
  selling milk is `retail`, and it does not exist.
- **MEDICINE IS NOT FEED, and the feed report has to keep excluding it.** Both go
  through `issued_to_lot_id`, so `NOT_FEED_KINDS` is what stops the penicillin
  landing in the cost per head and the FCR. It is an EXCLUSION rather than a
  whitelist of `feed`, because waste streams are recorded under whatever kind
  they were bought as.
- **A BREEDING ANIMAL KEEPS HER HEAD AND LOSES HER VALUE.** `capitalised_on` on
  the inventory lot takes her out of `valueStock` and `carriedCostByLot`; nothing
  is written to the head ledger, because nothing happened to the animal. The
  first version of 4f took her head out instead and it made her impossible to
  treat, weigh or lose — see the build log.
- **THE CAPITAL ENTRY IS Dr FIXED ASSETS, Cr INVENTORY — never Dr COGS.** The
  ordinary outgoing posting expenses the cost, which writes off an animal the
  business still owns. `postCapitalisation` exists so the counter-account is the
  caller's to name.
- **A capitalised animal cannot be PROCESSED**, refused explicitly in
  `run-handler.ts` rather than by having no head. Culling her goes through the
  market herd, which is where the reverse posting is.
- **Coming back is at NET BOOK VALUE**, and the cost correction that writes down
  the batch by the depreciation taken is what keeps the valuation screen and the
  ledger on the same number.
- **A HERD HOLDS LOTS, AND THE LOT STAYS THE COSTING UNIT.** Nothing in
  `inventory`, `production` or the books learned a second grain, and a herd's
  head is a fold over its members. Never put a count on the herd.
- **MOVING BETWEEN HERDS IS NOT A HEAD EVENT.** A cow changing herds has not
  been bought, born, sold or died. If a future slice is tempted to record one,
  that is the ledger corruption this table exists to avoid.
- **A herd is not the split chain and not a paddock.** The split chain cannot
  gather animals that were never together; a paddock can hold two herds and a
  herd can span two paddocks. Both were considered and both are written up in
  the build log.
- **A WITHDRAWAL IS INHERITED DOWN THE SPLIT CHAIN, at read time.** An animal
  split out of a treated pen was in that pen when the dose was given, so the
  clock follows it — bounded by the day its branch separated, because a dose
  given after it left was not given to it. Never copy the rows instead: a copy
  makes a correction reach the pen and miss the animals, which is the quiet
  wrongness the correction paths exist to remove. `treatmentsByLot` is the only
  place this happens, because it is the funnel every clock reader already used.
- **The withdrawal applies to the whole lot however many head were treated.**
  `head_treated` is recorded, but nothing here can tell the three that were
  injected from the thirty-seven that were not, and the form says so.

- **FCR ARRIVED IN SLICE 5 AND IS STILL REFUSED MORE OFTEN THAN GIVEN.** Feed
  conversion is feed per pound of GAIN, so it needs two weighings — one number is
  a weight, not a gain. Feed per head, feed cost per head and feed per pound of
  LIVEWEIGHT are all answerable with less, and none of them is FCR. Never relax a
  refusal into an approximation: the reason a screen gives is more useful than a
  number it had to invent.
- **THE FCR WINDOW IS THE GAIN WINDOW.** Feed fed before the first weighing made
  gain nobody measured, and counting it inflates the ratio — worst for the farm
  that starts weighing mid-batch, which is every farm's first batch. If a future
  slice is tempted to use the report's period for both halves because it is one
  query cheaper, that is the bug.
- **A TAPE DIVISOR IS PROFILE CONFIG AND NULL MEANS NO ESTIMATE.** Never default
  it. Weighing sheep as though they were pigs is worse than offering no figure,
  and the form hides the method entirely when the species has no divisor.
- **A HAUL IS A PARCEL CROSSING.** Not "they moved". A rotational farm walks its
  herd daily, and a shrink warning on every one of those is a warning nobody
  reads. Shrink-affected weighings are KEPT — deleting an observation somebody
  made is not this pack's business — and left out of the gain.
- **Nothing stores an average, a gain, an ADG or an FCR.** All four are folds
  over `livestock_weights`, for the same reason the head count is a fold over the
  ledger: a stored one stops agreeing with its own inputs the day somebody
  weighs again.
- **COST CAN LEAVE A LOT NOW, AND EVERY FEED FIGURE HAS TO KNOW IT.** Before
  `production` shipped, "what was fed to this pen" and "what this pen is still
  carrying" were the same number. They are not any more. `centsPerHead` nets off
  what has been released; `centsPerHeadPlaced` deliberately does not. If a future
  slice adds a third per-head figure, decide which of those two it is before
  writing it.
- **ONLY STAMPED COST CAN BE RELEASED.** `releasedCents` is the sum of cost on a
  lot's outgoing movements. An allocated share of a shared feeder was never on a
  movement, so it cannot leave and stays with the pen — which is also the reason
  a production run carries less than the Fed card's headline.
- **MEASURED AND ALLOCATED ARE DIFFERENT KINDS OF FACT, permanently.** A bag
  issued to a named lot is measured and its cost was stamped when it happened; a
  share of a shared feeder is spread by head × days at read time and is an
  estimate. They are never merged into one unlabelled figure — the design's rule
  is *same report, different confidence*, and at 10× the bagged number becomes an
  allocated one, so this distinction gets larger rather than smaller.
- **A DRAW IS AN ISSUE, AND `livestock_feed_draws` IS A JOIN.** The quantity and
  the cost live in `inventory_movements` and only there. If a future slice is
  tempted to put a quantity or a total on the draw row, that is the second
  ledger this whole pack is built to avoid.
- **Allocation never allocates a negative.** Inventory allows negative stock on
  purpose, but a negative head count as a WEIGHT would hand a pen a negative
  share of the feed bill. `headOnDays` clamps at zero.
- **Cost that cannot be allocated is reported, not dropped.** A feeder no lot
  was on still cost money. `allocateCents` returns an empty map rather than
  spreading it over pens that were not there, and the caller must surface the
  remainder — `feedReport` does, as `unallocatedCents`.
- **The report walks day by day, so its window is clamped per feeder.**
  `feedReport` starts each feeder's walk at its first membership rather than at
  the window's start, which is what makes an "all time" report over
  `LEDGER_EPOCH` cheap instead of a century of empty days per bin.
- **Membership is `member`, creating a feeder is `owner`**, and the split is the
  same one `moveLotToZone` makes: putting birds on a bin records a physical fact
  done by whoever moved them, while deciding that fifteen pens share one cost pot
  is a decision about how the farm's largest cash cost is attributed.
- **A lot cannot be on one feeder twice.** Two open memberships would count the
  same head twice in the basis and double that pen's share.
- **A batch is compared with the previous batch of the same species, by cost per
  head PLACED** — never per head standing, which falls as birds die and makes a
  bad batch look cheaper the worse it goes. The previous batch must have started
  strictly earlier and must have feed on record; two pens placed the same day are
  contemporaries, not a sequence.
- **Feed quantities are never added across units.** Pounds of grower and gallons
  of surplus milk have no factor between them that does not depend on what is in
  the bucket — `inventory`'s own rule. `mergeQuantities` returns a list.
- **The advisor WRITES NOTHING, and that is load-bearing.** Ask-and-orient is
  ungated because it is reversible; anything that becomes a purchase order, a
  ledger cost, a dose, a withdrawal date or a slaughter booking is
  compute-and-commit and must be deterministic or human-confirmed. Keep that
  file on the first side of the line — if a future slice needs the second, it
  drafts for a person rather than acting.
- **It must never state a dose, a withdrawal period, or a jurisdiction's
  inspection rule as authoritative** — prompted, and repeated on the screen
  under the input. Being confidently wrong there can put uninspectable meat in
  somebody's freezer, which is worse than having no feature.
- **The question is the only thing the browser sends.** Every fact comes from
  `farmSnapshot`, inside `withTenant`, under RLS. Never build a digest from
  client input — that is what makes it safe for an answer to sound certain
  about the farm.
- **When an answer is poor, look at the DIGEST before the prompt.** Twice now it
  has been the digest, and both times the advisor said what it was missing when
  asked. `formatSnapshot` is human-readable for exactly this reason.
- **The digest states its own caps** — 40 lots, 40 zones, 5 loss events per lot,
  with the omitted counts written into the text. Silent truncation would let an
  advisor that saw 40 of 200 lots answer as though it saw all of them.
- **THE ROW IS THE CHECK, and there is no `checked` column.** A daily log row
  means somebody looked at that lot on that date; no row means nobody did. The
  mortality denominator depends on the distinction, and a boolean that could be
  `false` would be a record of an absence — which absence already is.
- **Never add a deaths column to `livestock_daily_logs`.** Losses are
  `inventory_movements` and always will be; the round reads them back by lot and
  date. Two numbers for one fact is how a count starts disagreeing with its own
  history, which is the property this whole pack is built to keep.
- **The one-tap round cannot overwrite an exception**, and that is what makes it
  safe to tap at all. `ON CONFLICT DO NOTHING` against the per-lot-per-day
  unique index, in the database rather than a read-then-write check.
- **A single check UPDATES rather than inserting a second row**, and a later
  empty confirmation does not erase an earlier note. The evening walk-past must
  not delete the morning's "left hind swollen".
- **The streak grants today.** It runs back from today if today has an entry and
  from yesterday if not. A habit counter that resets every morning is a counter
  nobody keeps — and it still breaks on a genuinely missed day, so the number
  means what it says.
- **`attention` is a bookmark, not a severity.** Two values only, and the notes
  carry what was seen. It renders as "Noted" because a live sale recorded on the
  round is not a problem to be looked at.
- **A pack may read another pack's tables ONLY through the pack that owns
  them.** Livestock never queries `land_occupancy` or `inventory_movements`
  directly; both reads are functions on the owning pack's ops. That is what
  keeps `requires` meaningful rather than decorative.
- **An ITEM is the stock line; a LOT is one batch of it.** "Beef cattle" is the
  item, "COW-1" is the lot. Head and cost roll up to the item, so it is the
  grain your P&L is grouped at — which is why beef and dairy are two items and
  one species, and why the item is never inferred from the species. This
  distinction is the one thing a person setting up livestock has to understand,
  and it is now said in the form rather than in an empty state that disappears.
- **Breeding stock is NOT in this slice, and not by accident.** A breeding
  animal is not inventory at all — it is a capital asset on the other side of
  the balance sheet, and moving between the two is an accounting event that must
  POST. That is where this pack stops being a tracking app, and it needs the
  posting machinery rather than a boolean. Slice 4.
- **THE DAM AND THE SIRE ARE NOT THE SPLIT CHAIN.** `inventory_lots.parent_lot_id`
  means "these animals came out of that group" and is what a traceability query
  walks; `dam_lot_id` and `sire_lot_id` are biology. Never merge them. A split
  copies both parent columns onto the child and does not become a generation; a
  birth sets them and leaves `parent_lot_id` null. The 2026-08-13 design's line
  about births being "parented by the dam" predates the lineage chain existing.
- **AN UNKNOWN PARENT IS HALF THE ANIMAL, NOT NOTHING.** A calf out of a purebred
  Angus dam by a bull nobody recorded is ½ Angus and ½ unknown. Renormalising the
  known half up to a whole makes a herd read purer with every generation and is
  wrong in the direction that costs money at sale. `unknownParts` is printed,
  never dropped — the same rule as `none_stated` on a withdrawal clock.
- **A composition is a FOLD, never a column.** Correcting a grandparent has to
  change every descendant's answer, and a stored composition would stop agreeing
  with its own pedigree the first time the papers turned up in a drawer.
- **Parts, not percentages.** A three-way cross in percentages is 33/33/34 and
  the extra point is a claim nobody made. Integers over their own sum are exact,
  and halving stays exact however deep the pedigree runs.
- **A stated composition beats a computed one.** Papers outrank arithmetic.
- **A PARENT NEED NOT BE A LOT OF ONE.** "These chicks came from that flock" is
  the only pedigree fifty layers will ever have, and requiring an individual
  would put poultry — most of the animals on this farm — outside the feature.
- **Refuse a stated contradiction, never a missing fact.** A dam recorded as male
  is refused; a dam whose sex nobody recorded is not. And a parent of another
  species is NOT refused: a mule is a real animal, so the picker narrows and the
  app declines to have an opinion about what can breed with what.
- **THE `breed` COLUMN IS GONE (`0221`), AND ITS DROP RAN AFTER THE DEPLOY.**
  The second migration in the repo that way round, after `0075` — drizzle names
  every column in its SELECT, so a DROP applied ahead of the code takes the pack
  down. See conventions §4 and the migration's header. Nothing was copied
  across: free text cannot become fractions, and slice 4a's prompt-to-re-enter
  was the migration path.
- **Species come from the profile, never from this pack.** A pack that knows
  what a broiler is has the boundary wrong. `speciesFrom` reads `packConfig` and
  degrades to a free-text field.
- **Mortality counts transfers IN as intake.** A pen split off a batch has no
  `placement` of its own, and without this its mortality would divide by zero
  and read as unknown forever — which is the number the broiler enterprise
  actually lives on.
- **An unrecognised movement kind is treated as a transfer.** The column is an
  open taxonomy, so this code WILL meet kinds it has never seen; transfer is the
  safe assumption because it moves head without claiming anything was placed or
  lost.
- **Migration `0138` hand-reordered — fifth time.** Only ONE of its two
  composite FKs needed it (`livestock_identifiers` → the new `livestock_lots`);
  the other targets `inventory_lots`, which already existed. The rule is *check
  whether the target is new*, not *always reorder*.

## Open items

Everything from here to the next bullet group was found by **driving Hilltop Farm
on the dev branch, 2026-08-27** — the terminology review that produced
[The model, settled](#the-model-settled-2026-08-27).

- **ROSIE CARRIES A HEAD MOVEMENT THE CURRENT CODE WOULD NEVER WRITE, AND IT IS
  BREAKING HER ON EVERY SCREEN.** Her ledger holds a `-1` labelled *"To
  breeding"* from the FIRST version of slice 4f — the one that took a breeding
  animal's head out of the ledger, was overruled, and was reverted. The code no
  longer writes it. **Nobody cleaned up the row it had already written.** What
  that produces today:
  - `Head 0 — 1 in, 0 out`, which is arithmetic that cannot be true
  - **Treat and Weigh are missing from her page**, both being gated on head —
    verbatim the failure this slice was written to fix
  - **She is absent from the Daily round.** The breeding sow is the one animal on
    the farm nobody can check on
  - Her herd reads *"3 head · 3 named"* above FOUR animals, and she is the only
    one with no `named` badge — identity is being derived from head balance
  - `inventory` reports **5 feeder pigs** where the farm has six

  A reversing movement on both databases, plus a check for any other row that
  version wrote. **Nothing about the model is judgeable until this is gone.**
- **A SPLIT DROPS BOTH MEMBERSHIPS SILENTLY.** `splitLivestockLot` carries
  species, sex, birth date, dam, sire and breed fractions across, and carries
  NEITHER herd nor feed-group membership. Naming a cow out of a pen drops her out
  of her group AND **stops her feed cost accruing**, and neither dialog says so.
  This is the mechanical reason "add individuals to a lot" feels unsupported.
  Slice 8b closes it.
- **SPLIT AND RECORD-AS-INDIVIDUALS ARE ONE MECHANISM WEARING TWO BUTTONS.**
  `splitIntoIndividuals` loops `splitLivestockLot`. Two dialogs, two words, one
  act — and on a POULTRY pen the placeholder names are *"Bluebell, Daisy"*.
- **NOTHING GUARDS WHAT GOES IN A GROUP OF ANIMALS.** "Cows" holds three swine
  and one cow, and *Add animals* will put the 100-bird broiler pen in it, or
  PEN-2 which has no head at all. Whether a lot may mix species is an open rule
  in **either** direction, and it gets more load-bearing when the lot becomes the
  only container.
- **"PLACE HEAD" IS OFFERED UNCONDITIONALLY**, with no difference between
  starting a lot and adding to one. It reads as an invitation to add a 101st bird
  to a closed broiler batch, and on a named animal it is nonsense.
- **THE FEED PAGE DOES NOT KNOW WHAT A GROUP IS.** Feeders are a third grouping
  that lines up with neither lots nor herds, and the page has no group column at
  all.
- **NO PLAUSIBILITY GUARD ON THE HEADLINE NUMBERS.** The feed page reports a
  farm-wide conversion of **0.94 : 1** — under 1.0 is physically impossible — and
  `production` shows a finished kill at **150% yield**. Test data in both cases,
  and nothing anywhere says so.
- **`land` SHOWS "Currently —" ON A PADDOCK WITH FOUR ANIMALS ON IT**, beside a
  badge reading *occupied*. Not a data bug — "Currently" is the declared USE and
  nobody has declared one — but two adjacent columns appearing to contradict each
  other wants a rename, and there is no way to see WHICH animals are on a paddock
  from the parcel page. `land`'s call; noted here because livestock is where it
  showed up.
- **TWO INVENTORY ITEMS ARE NAMED WITH A RAW EPOCH TIMESTAMP** on dev —
  `Feed 1787622796401`, `Broilers 1787622796401` — as are four production runs.
  Seed or test residue rather than a code path, but it is what the pilot farm
  looks like today.

- ~~The clock blocks nothing in code~~ — **closed 2026-08-20** for meat. A
  production run against a blocked pen is refused with the reason and the
  clearing date; see the build log and [production.md](production.md). The MILK
  clock still blocks nothing, and cannot until `retail` exists.
- ~~A treatment cannot be corrected or removed~~ — **closed 2026-08-20.**
  `updateTreatment` edits in place and `deleteTreatment` removes, validated
  against the merged row so a correction cannot leave a treatment reading as
  clear. **The stock issue is deliberately not removed with it** — the medicine
  left the shelf, and that is `inventory`'s event to adjust.
- **Removing a treatment leaves an orphaned cost on the pen.** By design, and the
  dialog says so — but there is no adjustment screen in `inventory` yet to
  correct the other side with, so somebody who removes a from-stock treatment is
  told about a fix they cannot currently make. Inventory slice 2.
- **A PHOTO CANNOT BE GIVEN A CAPTION OR A DATE OF ITS OWN.** It carries the
  document's file name and nothing else, so a condition series is ordered by
  when it was UPLOADED rather than by when it was taken — which is the wrong
  clock for the exact use the design named it for.
- **Nothing detaches a lot's photos when the lot goes.** `detachAllForEntity`
  exists and this pack does not call it, because nothing deletes a livestock lot
  today. The day something does, that call is the promise standing in for a
  foreign key.
- **RECORDING A BIRTH NEEDS THE OWNER**, because it creates a lot and picks the
  stock line the offspring are counted in — consistent with `createLivestockLot`
  and with the recorded split of chores from decisions. A 2am calving is a chore
  by any other measure, and this is the first write in the pack where the rule
  and the reality pull in different directions. Worth revisiting with the
  founder rather than quietly loosening.
- **A BIRTH CANNOT BE CORRECTED, only unpicked by hand.** The parents can be
  edited afterwards and the head is an ordinary movement, but there is no "that
  calving was recorded wrong" path — and the lot it created stays.
- **NOTHING WARNS ABOUT INBREEDING YET**, which is slice 4d and the one thing in
  the genetics design with a stated collision: a heifer born this spring breeds
  at ~15 months, and on a two-year bull rotation **her own sire is likely still
  standing there**. It slips past because the thinking is herd-level while the
  risk is per-heifer, so the warning has to fire when the bull is turned in with
  the replacements, not in a report.
- **The hub shows the STATED composition only** — see the build log for why. A
  lot whose breeding is entirely computed from its parents shows nothing there
  and the full answer on its own page.
- **A parent picker does not exclude descendants.** Finding them means a walk per
  candidate; the write path refuses the choice with a sentence that says why.
  Wrong trade if a herd ever gets deep enough for it to be a common mistake.
- **No breeding-group or exposure record**, so "when is she due" is unanswerable
  and `born_on` is the only date this pack knows. That is slice 4c and it is the
  half of the founder's ask this slice did not reach.
- **THERE IS NO BREEDING-LIVESTOCK ACCOUNT IN THE FARM CHART.** The picker
  offers `1600 · Equipment` and `1650 · Vehicles`, because the generic chart has
  no `1700 Breeding livestock`. A cow in Equipment is wrong on a balance sheet
  and right in the app, which is the worst combination. Waits on the farm chart
  of accounts — [packs-and-profiles.md](packs-and-profiles.md)'s largest gap.
- **NO TAX BASIS.** A raised breeding animal has no basis for tax — her costs
  were expensed as they were incurred — while her book cost is real. Only the
  BOOK event is recorded, which is the one `assets` can depreciate. The
  book/tax split is [assets.md](assets.md)'s open decision and it is bigger
  than this slice.
- **A capitalised animal cannot be moved to breeding stock as part of a pen.**
  One animal at a time, because a capital asset is a thing rather than a
  quantity — a pen is split first, and the refusal says so.
- **Depreciation is not posted automatically**, which is `assets`' own decision
  and inherited here: a breeding cow depreciates when somebody presses the
  button on the assets page.
- **THE FLAT LIST IS STILL UNPAGED.** Herds fixed the shape of the hub but not
  its size: "Not in a herd" renders every ungrouped lot with no search and no
  limit. A farm that puts everything in herds never sees it; one that does not
  has the same thousand rows as before.
- **A herd cannot be moved to a STRUCTURE without a paddock**, because
  `moveOccupant` is a zone move. A barn that is not on a zone is unreachable.
- **Nothing warns that a herd is standing on two paddocks.** The hub says "2
  places" and leaves the reader to decide whether that is a move half done.
- **A GROUP'S HEAD IS STILL A SECOND STEP.** "One animal" places its single head
  on creation; a group does not, because how many chicks were in the box is a
  fact somebody checks. That asymmetry is deliberate and it is still a thing to
  explain to somebody who has just used the other mode.
- **Fifty individuals at a time.** Past that the answer is that a pen is the
  right record, and the cap says so — but a farm splitting sixty gets two trips
  and no explanation of why.
- **`head_treated` is recorded and nothing reads it.** Written because the design
  asks for it and because a partial treatment is a real thing; no screen or fold
  uses it yet.
- **No repeat or course support.** A five-day course of injections is five rows,
  and the clock counts from the last of them only if somebody enters all five.
- **Nothing warns that a withdrawal is about to expire**, or that one has just
  cleared. Both are the deviation-surfacing the design wants and neither is a
  rule anybody is asked about yet.

- ~~Nobody has driven slice 0 yet~~ — **closed 2026-08-16.** Driven on
  production: record a loss (201 → 200, mortality 4.3% → 4.8%), add a visual
  tag, move to a paddock. The loss appeared in `inventory`'s own ledger on the
  item page, which is the cross-pack spine visible in one screen. It found the
  two items below.
- ~~"Move to a paddock" cannot move a lot that is already on one~~ — **built
  2026-08-16.** `moveLotToZone` now calls land's `moveOccupant`, which closes
  the open stay on `dayBefore(startedOn)` and opens the new one in the same
  transaction. The date rule and the reasoning live in
  [land.md](land.md)'s build log, because the inclusive bound is land's.
- **A failed move wipes the form.** React resets a `<form action={fn}>` after
  the action, so a refusal costs the user their paddock and date selections. The
  toast does say why — it fires and is easy to miss. Less costly now that the
  most common refusal is gone, but the pattern is in every dialog in the pack.
- ~~Writes are owner-only, and this is where it stops being tenable~~ —
  **settled 2026-08-15**, see the build log. Placing, losing, moving and tagging
  are chores and open to any member; creating, editing and splitting a lot stay
  with the owner.
- ~~No daily log~~ — **shipped 2026-08-19** as slice 1a.
- ~~No advisory layer~~ — **shipped 2026-08-19** as slice 1b.
- **The advisor forgets on refresh.** The thread lives in component state, which
  is what kept 1b migration-free. A question worth keeping — "what did it say
  about the flip losses" — has to be copied out.
- **Nothing rate-limits the advisor.** Every question is a model call on the
  tenant's behalf, with no quota, cost cap or per-tenant counter. Fine for a
  pilot with one farm; not fine for a hundred.
- ~~The advisor cannot see feed issued, treatments or weights~~ — **feed landed
  2026-08-20** with slice 2, and with no change to the prompt: the digest carries
  cost, cost per head and provenance, and the answer got sharper on its own.
  Treatments and weights are still slices 3 and 5.
- ~~No feed or FCR~~ — **both shipped 2026-08-20**, feed as slice 2 and weights
  as slice 5. FCR is computed where two weighings exist and refused with a stated
  reason everywhere else.
- **Weights are POUNDS AND INCHES, in the column names.** The tape formulas this
  pack was given are imperial, and a column called `weight` that means different
  things per tenant is the bug the one-stocking-unit rule exists to prevent. A
  metric farm needs a conversion at the boundary, and nothing does it yet.
- ~~A weighing cannot be corrected or removed~~ — **closed 2026-08-20.**
  `updateWeight` edits in place and `deleteWeight` removes, because a measurement
  is not a ledger entry: a weighing that was typed wrong never happened, so there
  is nothing to compensate for. Both are `member`.
- ~~Nothing in the app renders `audit_log.meta`~~ — **closed 2026-08-20**, and
  it was a platform gap rather than a livestock one. `/admin/audit` now shows
  what each action recorded, and a correction shows what MOVED: the weight
  corrected in this pack reads `sample weight lb: 62.5 → 68` and the withdrawal
  clock reads `meat withdrawal days: 21 → 28`. See
  [architecture.md](../architecture.md). The correction dialogs still do not
  promise a farmer their old value is "in the audit log" — it is a superadmin
  page, and pointing somebody at a screen they cannot open is the thing that was
  wrong with the original copy.
- **No body condition score.** 1–9 on a cattle beast is the decision input the
  design names beside weight, and it is deliberately not in `livestock_weights` —
  it is not a weight, and every read that folds weights would have to remember to
  exclude it. Its own table when something needs it.
- **The shrink window is three days for every species.** Cattle are where the
  3–5% figure comes from; a broiler in a crate for twenty minutes is not shrunk
  at all, and a pig is somewhere between. One constant is conservative rather
  than right.
- **Feed conversion counts head standing at the END of the gain window.** Birds
  that died mid-window ate feed and produced no gain, which correctly worsens the
  ratio — that is what "as-hatched" conversion means — but a lot SPLIT mid-window
  has head transferred out, and that is not the same thing.
- **A draw is allocated over the WHOLE report window, not over the period it was
  drawn for.** With lumpy draws and mid-window membership churn — a ton drawn on
  day 1, a pen joining on day 15 — the share is smeared across the window rather
  than tied to the days the feed was actually eaten. Narrowing the period is the
  workaround and it is on the screen. The fix is per-draw windowing, and it needs
  a decision about whether a draw covers the days before or after it.
- **There is no way to correct a draw.** A draw recorded against the wrong
  feeder, or for the wrong amount, has no edit and no reversal in the UI — the
  movement underneath would take a correcting entry, which is inventory slice 2's
  adjustments, but nothing unlinks the draw row.
- **A feeder cannot be renamed**, and a closed one cannot be reopened.
- **The feed report reads the whole ledger for every lot.** `datedMovementsForLots`
  is uncapped here on purpose, which is right for a running balance and wrong at
  a farm with years of history. `FEED_DRAW_CAP` bounds the draws and says so on
  screen; the head movements are unbounded.
- ~~Neither screen has been clicked~~ — **closed 2026-08-19.** Both driven on
  production. It found the unrun migration, and one reading defect in the round.
- ~~Nobody has driven slice 2~~ — **closed 2026-08-20.** Driven end to end on
  the `Hilltop Farm` tenant: a $500 delivery, $100 issued to PEN-1 by name, a
  $200 draw split $160.78 / $39.22 across two pens on 41 and 20 days on feed, and
  the same figures on the lot page. It found four reading defects, listed in the
  build log.
- **The exception dialog opens EMPTY on a lot already checked**, even though its
  button says "Edit". Nothing is lost — `recordDailyCheck` only overwrites a
  note when the new one is non-empty — but the screen implies today's entry is
  blank when it is not.
- **The round is today only.** There is no way to record yesterday's check, so
  a day spent away from a screen is a hole in the record that cannot be filled
  — and the streak treats it as a genuine miss, which it was not. The ops layer
  already takes any `loggedOn`; only the screen is fixed to today.
- **Nothing FLAGS a mortality rate that has gone wrong.** The advisor will say
  so when asked — it called 11.4% at day 30 double the usual Cornish Cross
  figure and separated predation from heat from flip by the dates — but nobody
  is asked. The design wants deviation surfaced while it can still be acted on,
  and that is a rule over the round, not a chat.
- **No voice or natural-language entry.** The design ranks a spoken daily log as
  the single best AI use in this pack because it attacks the thirty-taps-a-day
  problem directly. **Slice 1b shipped the ASK side only** — telling it things
  in a sentence, from a tractor, is still unbuilt.
- **Egg collection is not here.** Layers run the opposite rhythm to meat and the
  design wants collection to be one number and one tap, but eggs entering stock
  is a RECEIPT — `inventory` slice 1 — and building a second path into the
  ledger from this pack would be the duplication the pack model exists to stop.
- **One movement at a time.** "Move every pen to the next paddock" is one action
  in the design and twenty dialogs here. Purely additive, and urgent at 10×.
- **No merge in the UI**, and none in this pack at all — `inventory.mergeLot`
  exists and livestock does not wrap it.
- **The lot list fetches every inventory lot** to resolve codes. Fine at 20
  lots, wrong at 200.
- **Nothing links a lot to its photographs**, which the design wanted from slice
  0 as a cheap early win — a condition series is the thing that reveals gradual
  loss invisible day to day.
