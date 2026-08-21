# Inventory

> What the business holds, where it is, and which batch it came from. **Owns the
> lot spine** — the quantity-bearing, lineage-carrying record that `livestock`,
> `crops`, `production` and `retail` all declare this pack in `requires` for.
> The third capability pack (Layer 2a) to ship.
> Status: `available` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

**Read [packs-and-profiles.md](packs-and-profiles.md) first** if you are touching
the pack machinery rather than inventory itself. The design this is sliced from
is in [homestead-farm.md → Category design — Inventory](homestead-farm.md#category-design--inventory-brainstormed-2026-08-13);
this dossier is the build record.

## Slice order

| # | Slice | State |
| --- | --- | --- |
| **0** | **Items + units + locations + on-hand ledger + the lot spine** | **shipped 2026-08-15** |
| **1** | **Receipts and issues** — closes the `livestock` costing loop | **shipped 2026-08-19** |
| **2** | **Adjustments, physical counts, expiry/FEFO** | **shipped 2026-08-20** |
| **3a** | **Valuation — what stock is worth, as of a date** | **shipped 2026-08-21** |
| 3b | **Perpetual posting to 1300/5000 — and the bill→item link it cannot ship without** | next — see Open items |
| 4 | Commitments (pre-sold halves) — needs `production` and `retail` | |
| 5 | Reorder points, capacity warnings — needs history | |

## Build log

### 2026-08-21 — Slice 3a: what the shelf is worth, and what it will not guess at (`claude/what-the-shelf-is-worth`)

The third of the design's three layers, and the first that a balance sheet
could ever read. `costing.ts` said outright that the third was not there; it is
now — as a **read**, with nothing posted yet, for a reason recorded below that
turned out to be a hard blocker rather than a preference.

**A LOT IS VALUED AT WHAT IT CARRIED, NEVER AT QUANTITY × THE ITEM'S AVERAGE**,
and that ordering is the whole design. The average is only meaningful for a
fungible item; the design is explicit that it is *"emphatically NOT fine for
specific identity (meat from animal #47, where traceability forbids averaging)
and there is no such thing for raised stock with no purchase basis"*. A pen that
accumulated chicks plus feed already knows what it is worth, and averaging it
against every other batch of the same item would throw that away to produce a
worse number. The average is the FALLBACK, for stock held outside any lot.

**UNVALUED IS NOT ZERO, AND A TOTAL THAT CONFLATES THEM IS A LIE.** A raised lot
nobody costed has no basis: zero says the shelf holds something worthless, a
guess puts an invented number on a balance sheet, and it is neither. So
`valuationTotal` reports what it could NOT value beside what it could, the page
gives the gap the same size as the figure, and **any screen that shows the total
without the caveat has recreated the bug — that is the defect, not a display
preference.**

**Which is exactly the bug this slice then shipped into its own first draft.**
`lotCarried` folds an uncosted lot and a fully-released lot to the same
`remainingCents: 0`, so 30 dozen eggs valued at `$0.00` — *after* the file
header warning about that precise mistake was already written. A db-backed test
caught it. `carriedValue` is now where the distinction is actually made rather
than merely described, and the discriminator is whether money has EVER touched
the lot in any direction. **Third appearance of this bug class here**:
`costPerUnit` refuses it, `production` slice 0 shipped it, this one was caught.

- **COGS resolves by CODE `5000` before subtype**, because the general chart
  ships two accounts with subtype `cogs` — `5000 Cost of Goods Sold` and
  `5100 Subcontractor Expense`. A resolver that took the first row would have
  booked a farm's meat against subcontractors, quietly, and compounded it every
  movement until somebody reconciled. Everything else follows
  `resolveDepreciationAccounts`: config first, convention second, refuse rather
  than guess.
- **The shrinkage account defaults to COGS**, and sharing an account does not
  lose slice 2's diagnostic: the reason travels in the entry memo, and grouping
  still happens where it always did, over `inventory_movements.reason`.
- **`carriedCostByLot` gained an as-of filter**, and it filters the MOVEMENTS
  rather than the lot — a pen created in June has eaten more by August, and a
  June balance sheet must not see August's feed.
- **`averageRatesForItems` is the many-item form of `itemCostRate`.** A stock
  list asks for fifty at a time, and fifty round trips is the pattern that makes
  a page crawl.
- **As-of is a URL parameter, not component state.** A valuation is a figure
  somebody quotes to an accountant, and a number that cannot be linked to has to
  be described instead.
- 17 new pure tests, 8 new db-backed. Migration `0176` is three enum values and
  nothing else.

**ADR 0011 came out of this slice and is the part with teeth.** Perpetual posting
collides head-on with the ledger's owner check: every feed issue, market sale and
production run posts, and all three are deliberately staff-level chores.
`livestock` settled that on 2026-08-15, `retail`'s till exists so a staff member
can sell at a stall, and production runs are recorded by whoever ran them — so
the old rule would have silently made all three owner-only. Machine-sourced
entries now ride the authorisation of the act that produced them. What keeps it
from being a privilege escalation is that `source` is absent from
`entryInputSchema`, defaults to `manual`, and is a Postgres ENUM: a source cannot
be invented at a call site, only chosen. A test that tried to assert a made-up
source is refused **could not be written — it does not compile.**

**WHY NOTHING POSTS YET, and it is a blocker rather than a slice line.**
`bill_lines` has an `account_id` and **no link to an inventory item**. A bill
today posts `Dr Feed Expense / Cr AP`. If a receipt also posted `Dr 1300`, the
same delivery would sit on the books twice — so the receipt side and the bill
side are not separable, and shipping half of perpetual would double-count every
purchase a farm makes. Slice 3b is both together.

### 2026-08-21 — One act instead of two, for a truck that drives away (`claude/the-till-that-cannot-double-post`)

`transferStock` and `stockAtLocation`, added for `retail`'s till and living here
because the ledger is this pack's table.

**This closes an open item slice 0 wrote down and slice 1 did not fix**: moving
stock was *"two movements, and the UI does not offer it as one act"* — which is
precisely the shape that gets one leg entered and the other forgotten, leaving
stock in two places at once.

- **The item's balance does not move; only the "where" split does.** Both legs
  are recorded rather than one row with two locations, which is the same reason
  `splitLot` writes a pair.
- **A transfer carries NO COST.** Moving a box of beef from a garage freezer to
  a market truck does not change what it cost, and stamping a figure would
  release cost from the lot and then put a different one back — which is how
  `remainingCents` starts disagreeing with itself. Same reasoning `livestock`
  applies to a pen walking to the next paddock.
- **From and to must differ.** Both null is the common attempt: a farm that has
  never recorded a location asking to move something from nowhere to nowhere.
  Two rows that cancel would be noise in the one table that has to reconcile.
- **`stockAtLocation` drops a line that has gone back to zero**, the same call
  the item page's "where it is" panel makes: stock that went out and came back
  is not "0 lb on the truck", it is not on the truck.
- 3 new ops tests. No migration, no schema change.

### 2026-08-20 — Slice 2: counting what is actually there, and saying why (`claude/counting-what-is-actually-there`)

The slice that lets somebody be WRONG. Everything before this could record what
happened; nothing could record that the record had drifted, and three packs had
open items saying so — a treatment removed left an orphaned cost with no way to
correct it, a feed draw could not be reversed, a run input could not be taken
off. All of them were waiting on the same missing thing.

**THE REASON IS THE POINT, AND IT IS A DIAGNOSTIC RATHER THAN A CORRECTION.**
The design says it outright: *sustained feed shrinkage is not an accounting
problem, it is a rodent problem.* So `inventory_movements.reason` is a column
rather than free text, `adjustmentReasons` groups it, and the counting page
leads with **what keeps happening** rather than with the list of counts. One
spoiled bag is a wasted bag; the same reason four months running is a freezer
that is not holding temperature, and nobody sees that in a ledger.

**A NEGATIVE ADJUSTMENT RELEASES COST AT THE AVERAGE; A POSITIVE ONE CARRIES
NONE.** Stock that spoils really did cost money, and stamping it is what turns a
loss into a number somebody acts on — the same rule `issueStock` follows. Stock
that turns up was never bought, so it arrives at null rather than at a price the
farm did not pay, and the item average does not move: `averageCostRate` counts
only what came in WITH a price, which is how raised stock is already treated.

**A COUNT IS TWO ACTS, LIKE A RUN, AND FOR THE SAME REASON.** Counting a freezer
takes an hour and is done a shelf at a time, so lines are recorded as they are
found and POSTING writes every variance in one transaction. Half a posted count
would leave some shelves reconciled and others not with nothing to say which.

- **A line that agrees writes NOTHING.** A movement of zero is refused by the
  ledger anyway, and a row meaning "nothing happened" in the one table that has
  to reconcile is noise. The line still records that it was counted and what was
  expected, which is the useful half.
- **`expected_quantity` IS STORED, and it is the only stored derivation in the
  pack.** What the ledger believed at the moment somebody disagreed with it is a
  historical fact the fold stops being able to reproduce as soon as anybody
  backdates a movement — and recomputing it would silently restate a variance
  that has already posted. Same reasoning as `production_runs.cost_basis`.
- **`count_variance` is its own reason, separate from `shrinkage`.** One means
  the record drifted; the other means stock actually went missing. A single
  number covering both would hide each of them.
- **The form does NOT show what the ledger expects.** A count is worth nothing
  if the screen tells the person with the clipboard what to write: they will see
  92, find 88, and write 92. The comparison is the OUTPUT of counting.
- **Zero is a real count; a shelf nobody got to is not a line.** That distinction
  is why `counted_quantity` is NOT NULL and why lines are added rather than
  pre-generated for every item.

**EXPIRY IS ON THE LOT, AND FEFO IS A SUGGESTION.** A batch goes off; a kind of
thing does not, and two deliveries of the same feed bought a month apart go off a
month apart. `expiringLots` answers both views the design asks for — *oldest
first* and *expiring soon* — because sorted-by-expiry is the same list. **Nothing
refuses an issue from a later batch**: the person holding the scoop can see which
bag is already open and this cannot. Batches at zero are dropped, because a batch
that is not there cannot go off into a loss.

**Driven on the dev tenant, and it found one defect.** 20 lb of spoilage came off
Grower crumble at $10.00 (the $0.50 average, unmoved), a count of 315 against a
record of 330 posted a −15 lb variance at $7.50, and the two reasons sat apart on
the diagnostic panel — drift told from loss, which is the whole argument for
keeping them separate. **The ledger row said "Adjusted" and nothing about why**,
on the one screen somebody opens when they wonder where the feed went; the
reason now renders under the kind. A row that hides the reason turns the
diagnostic back into a correction.

- 11 new ops tests, 4 new pure tests, 8 new isolation tests. Migration `0170`
  **hand-reordered — ninth check, fourth time the answer was yes**; `0171` is the
  RLS pair.
- **`recordMovementAction` still has no UI caller.** Adjustments got their own
  action rather than reusing it, because an adjustment has a required reason and
  a signed quantity and routing it through the generic primitive would have made
  the action lie about what it takes. That open item is now a decision: it should
  go.

### 2026-08-20 — Two reads and a `source`, so a run can land its boxes (`claude/a-run-lands-in-stock`)

`production` slice 0 needed three things from this pack, and all three live
here for the reason `movementsOnDate` does: the ledger is this pack's, and a
neighbour querying `inventory_movements` directly is the leak the extension
model forbids.

- **`carriedCostByLot`** — what a lot has cost, and **what has already left it
  carrying some of that**. `consumedCostByLot` answers "what was fed to this
  pen"; a run consuming the pen needs the whole accumulated figure — chicks plus
  feed plus medicine — because pricing a bird at what the chick cost throws away
  eight weeks of feed. **`remainingCents` is the new idea, and it exists because
  of an ordinary farm fortnight**: half a $1,000 pen processed on Saturday and
  the rest a fortnight later. The accumulated total never goes down, so
  pro-rating the gross twice charges $1,500 for a $1,000 pen. Netting the
  released cost off first makes the two halves sum. Folded in
  `core/costing.ts` as `lotCarried`; `lotCost` is untouched.
- **`balanceByLots`** — the fold per LOT, summed in SQL. `onHandByItem` answers
  the same question one grain coarser, and a run pro-rating a pen needs the
  pen's balance *before* it takes anything out.
- **`receiveStock` takes a `source` and an `extensionSlug`.** It hardcoded
  `purchased`, which is right for a delivery and wrong for a box of meat: an
  output is **`produced`**, and this pack's own column comment says slice 3
  cannot infer that retroactively. The slug follows `issueStock`'s, for the same
  reason — a row should be attributable to the pack that will explain it.

**Nothing about cost changed.** An output's receipt is stamped once, when it
lands, exactly as an issue is — which is what lets a run completed in August
still say what it cost after feed prices move in October.

**One thing to know if you are reading `averageCostRate` and worrying:** a
`processed` movement carries a cost on a NEGATIVE quantity, and the average
ignores anything that did not come in with a price. Stamping cost on the way out
cannot move the item average, and that was checked rather than assumed.

### 2026-08-20 — The consumption reads now say what KIND was consumed (`claude/the-withdrawal-clock`)

`consumedByLotAndItem` and `consumedDatedByLots` return `itemKind`, and neither
has an opinion about what it means.

**`livestock` slice 3 put medicine through the same door feed goes through** —
`issued_to_lot_id`, so a sick pen carries its own expense — and that silently
broke a number in the pack next door: the feed report absorbed the penicillin
into cost per head, pounds fed, and the feed conversion ratio. A card reading
"Fed" that includes the medicine is wrong in the pack that owns the word.

The classification stays the CALLER's, exactly as `movementKindsForLots` leaves
the death-versus-transfer decision to `livestock`. This pack knows an item has a
kind; what counts as feed is somebody else's judgement.

### 2026-08-20 — One more read, and its window is different for every lot (`claude/weights-carry-a-method`)

`consumedDatedByLots` — what was issued into each lot, movement by movement,
with its date. `consumedByLotAndItem` aggregates over a fixed period, which is
what a report wants; **feed conversion needs a window that differs per lot.**

Conversion is feed per pound of GAIN, gain is measured between that lot's own
first and last weighing, and feed fed before anybody put a bird on a scale
produced gain nobody measured. Summing it into the ratio would inflate the one
number the enterprise is judged on — worst for the farm that starts weighing
halfway through its first batch, which is every farm's first batch. So the caller
gets the rows and does its own arithmetic per lot.

Still one query whatever the lot count, and still no opinion here about what any
of it means. Full reasoning in [livestock.md](livestock.md).

### 2026-08-20 — Three reads and one flag, for livestock's feed report (`claude/feed-and-fcr`)

Slice 1 gave `livestock` the costing loop. Its slice 2 turns that into the
report the broiler enterprise is judged on, and needed this pack to answer three
questions it could not before. All three live here for the reason
`movementsOnDate` does: the ledger is this pack's, and a neighbour querying
`inventory_movements` directly is the leak the extension model forbids.

- **`consumedByLotAndItem`** — what was issued into each lot, broken down by
  item and carrying its stocking unit, optionally windowed by date.
  `consumedCostByLot` answers a card in one number; a report needs the QUANTITY
  (and pounds of grower never add to gallons of surplus milk), and **how many of
  those entries carried no price at all**. That last count is not an error tally
  — spent grain and windfalls are real feed with no invoice, and the design is
  explicit that a model insisting every input has a purchase price will be lied
  to. A null cost is carried through as fed-but-not-spent and counted.
- **`movementsByIds`** — rows behind a set of ids, with the item name and unit.
  A shared-feeder draw is an ordinary issue in this ledger plus an association
  row in `livestock`; what a feeding group IS has nothing to do with inventory,
  so the caller arrives holding ids.
- **`datedMovementsForLots(…, limit: null)` now means every row.** A running
  balance day by day — what livestock's allocation divides by — cannot be
  computed from the most recent 200 movements, because the opening balance would
  silently start in the middle of the ledger. **A cap is right for a digest and
  wrong for arithmetic**, and the default stays 200.
- **`issueStock` takes an optional `extensionSlug`**, so a draw is attributable
  to the pack that will explain it — the same reason every head event carries
  one.

Nothing about cost changed. A draw is stamped at the average exactly as a bag
handed to a named pen is, which is what lets livestock's allocated figure be
compared with its measured one without a reconciliation step.

### 2026-08-19 — A second read, this one for the advisor (`claude/livestock-advisor`)

`datedMovementsForLots` — movements for a set of lots, newest first, capped.
`movementKindsForLots` drops the date because a BALANCE does not need one; a
DIAGNOSIS does, and livestock's advisor needs to know that seven of eight birds
died on days 22 and 27 rather than merely that eight died.

It has no opinion about which kinds are deaths. That classification is
`livestock`'s and stays there, as it has since its slice 0.

### 2026-08-19 — "Where do I add livestock, both pages or one?" (`claude/animals-live-in-livestock`)

The founder's question after driving slice 1, and it is a fair one that neither
screen answered: *"the inventory versus the livestock page. Where do i add
livestock. to both? just one?"*

**The answer is Livestock, always** — `Start a lot` creates the stock line, the
batch and the biology in one transaction. But an item called "Broiler chicks"
sitting in this list beside the feed reads as a duplicate of the Livestock page,
and nothing anywhere said otherwise.

**Both pages are right and the model is not the problem.** Market animals ARE
inventory — head is a unit of measure, a pen is a batch — and that is precisely
what makes cost per pen fall out of the same ledger as the feed bought for it.
Inventory shows the STOCK LINE ("Broiler chicks · 407 head"); Livestock shows
the BATCHES with their biology. One thing, two questions.

- **The row now says so.** A livestock-kind item carries a *managed in
  Livestock* link, gated on the pack actually being switched on — pointing at a
  module a tenant does not have is the mistake `land` made with its parcel
  finder the day before.
- **The trap is closed.** Picking "Livestock" as a kind in *Add an item*
  produced an item with no batch and no biology: a half-thing that shows up in
  the Livestock form's "Counted as" picker and nowhere else, looking like a
  fault. Choosing it now explains that animals are started in Livestock, links
  there, and disables the submit rather than letting somebody build the broken
  half.

**The pattern, third time this week:** the model was right, the screen was
silent, and a person had to ask. Types and tests cannot see the difference.

### 2026-08-19 — The page that owns the money never mentioned it (`claude/the-page-that-never-mentions-money`)

Slice 1 driven on production, and the loop closed on the first try: a
600 lb delivery at $340, 150 lb issued to BATCH-2, and the toast came back
**"Stock recorded out · 85.00"** — 150 at 56.67 cents, stamped. The livestock lot
page then showed a **Fed** card at 85.00 and *"0.43 a head at today's count"*,
with a *Fed in* row carrying the same figure. Feed bought, fed to a pen, carried
by the animal, across three packs and two screens.

**The defect: the item page never showed a cost anywhere.** Recent entries had
When / What happened / Where / Amount and no money at all, so a $340 delivery
landed and the page that owns it said nothing. Same shape as the round's
`attention` badge and the parcel finder's missing button — a capability stored
and never surfaced, invisible to types and tests, thirty seconds to find by
clicking.

- A **Cost** column on Recent entries, showing the stamped figure per movement.
- The **average paid** on the On hand card — *"Averaging 56.67 a pound across
  everything received"*. That is cost ACCUMULATION, deliberately not valuation:
  what the stock on hand is worth is basis-dependent and belongs to slice 3, not
  to a card that would have to guess.
- *"the price per pounds"* now reads *per pound*. `unitLabel` is the plural and
  a price is per one of them.

**Not changed, and worth a decision rather than a quiet fix: no currency symbol
anywhere.** `formatCents` is deliberately symbol-free because it was built for
debit/credit columns whose headers carry the currency. On a card reading
*"Fed · 85.00 · 0.43 a head"* there is no header to carry it, and the number
reads as a quantity. That is an app-wide design-system question — accounting's
own reports say *"1,234.56 overdue"* — so changing it in one pack would make the
app inconsistent rather than better.

### 2026-08-19 — Slice 1: the first money on the farm (`claude/feed-in-feed-out`)

Slice 0 could say a pen held 210 birds. Nothing anywhere could say what anything
cost. This is the slice the profile's whole thesis rests on — *every farm
activity posts a cost to a cost object* — and until now that sentence described
nothing.

**Two columns on the ledger, and that is the whole schema change.**
`cost_cents` is what a movement cost, as a TOTAL rather than a rate, because
"$340 for 12 bags" is the number on the ticket and a rate is derived from it.
`issued_to_lot_id` is **which lot ate it** — the join that closes the loop, and
the reason a pen of broilers can be charged for a delivery of feed that is a
different item entirely.

**THE ISSUE COST IS STAMPED, NEVER DERIVED LATER, and that is the sharpest
decision here.** If a pen's feed cost were computed from today's average, then
buying dearer feed next month would retroactively change what that pen cost last
month, and every FCR comparison between batches would move under its own feet.
Certified: issue at a 10-cent average, buy in feed at 90, and the first issue
still reads 100 cents while the next reads 500.

**THIS IS LAYER TWO OF THREE. Nothing here posts to the ledger.** The design
splits inventory into quantities (always on), cost accumulation (always on —
cost per finished hog is wanted whatever the tax basis) and financial
presentation (basis-dependent, derived at read time). No 1300, no 5000, no
journal line: slice 3 does that through the lens ADR 0007 already established,
rather than writing a second set of numbers that must agree forever.

- **Cost is a fold, never a column.** No stored average, no stored valuation —
  the same discipline the quantity balance follows, and for the same reason.
- **The average ignores issues**, or it would be circular: an issue's cost came
  from the average, so folding it back in would make the rate depend on how much
  had been used.
- **Unpriced stock is not free.** Raised stock has no purchase basis and an
  invoice can be late; both arrive as null and are excluded from the average
  rather than dragging it down.
- **A rounding remainder is real and does not compound.** 100 cents over 3
  units, issued singly, sums to 99. That is ordinary average costing, and it is
  visible because receipts and issues are both on the ledger.
- **THE SAME DOOR, NOT A SECOND ONE.** This could have added "Receive" and "Use"
  buttons and left three ways to move stock. It extends the form people already
  know instead: In carries a price, Out carries who ate it.
- **The cost lands on the animal.** The livestock lot page gained a **Fed** card
  and a "Fed in" list, read through `inventory`'s ops rather than its tables.
  That is the pack seam doing the thing it was built for, visible on one screen.
- 15 new pure tests, 7 new ops tests. Migration `0159` is additive and needed no
  hand-reordering — its FK target `inventory_lots` already existed.

### 2026-08-19 — One read added for livestock's daily round (`claude/livestock-daily-log`)

`movementsOnDate` — movements against a set of lots on one day, keyed by lot.
It exists so `livestock`'s round can show what was lost today WITHOUT storing
it: the losses entered during a check are ordinary movements in this ledger, and
the round reads them back rather than keeping a copy that would have to agree
with this table forever.

It lives here, like `movementKindsForLots` before it, because the ledger is this
pack's and a neighbour querying `inventory_movements` directly would be the leak
the extension model forbids. Full reasoning in [livestock.md](livestock.md).

### 2026-08-19 — The location picker only offers places (`claude/assets-hold-stock`)

`listLocations` filters on `assets.is_storage_location` now, so the *Where*
picker stops offering a gate and a tractor as somewhere to put chickens. The
flag, the backfill and the reasoning for putting it on the asset rather than
keying it on kind are in [assets.md](assets.md) — this pack only reads it.

The function's name finally describes what it does, which is the whole of the
defect `land` fixed for structures in August and this one inherited.

### 2026-08-19 — Driven for the first time (no code change yet)

Slice 0 was written, migrated against both databases and covered by 61 tests,
and its own Open items said the obvious thing: *every bug found this week was
found by clicking*. So it was clicked.

**What holds up, and it is most of it.** The fold reconciles exactly: six ledger
entries (+210, +210, −9, −70, +70, −1) sum to the 410 head on the card, and the
three batches (200 + 70 + 140) sum to the same number by a different route. The
split's −70/+70 nets to zero at item level, which is the property `livestock`
depends on. Recording stock updates *Where it is* into a per-location split, and
a location that returns to zero DISAPPEARS from that panel rather than showing
"0 head" — the right call. The dialog explains the model in one line: *"Every
quantity on this page is the sum of these, so nothing is counted twice and a
correction is just another entry."*

**FOUR OF THE EIGHT ACTIONS HAVE NO UI CALLER**, and only one of them is
recorded as a known gap:

| action | UI callers | consequence |
| --- | --- | --- |
| `updateItemAction` | **0** | an item cannot be renamed, and its purchase conversion cannot be corrected |
| `archiveItemAction` | **0** | an item can never be retired; the list only grows |
| `closeLotAction` | **0** | a batch can never be closed — B-2026-04-15 from April is still listed as open |
| `mergeLotAction` | 0 | already recorded in Open items |

The sharpest of these is `updateItem`. This dossier says the stocking unit
**locks once anything has moved**, which implies it can be set right *before*
then — but there is no screen to change it at any point, so an item created with
the wrong unit is wrong for ever and the only remedy is a new item and a lost
ledger. The ops layer and the actions are complete and tested; the screens expose
half of them, and no test can see the difference.

**`listLocations` returns EVERY active asset**, so the *Where* picker offered
**Oak Row gate** and **Tractor** as places to put chickens. That is the shape
land fixed on 2026-08-16 (*"A chest freezer was on the list of places to put
chickens"*) — a function whose name claims a filter it never applies.

**But land's remedy does not transfer, and that is the interesting part.** There
the fix was a config-driven kinds filter defaulting to `building` +
`infrastructure`. Here the real data defeats it: on the live tenant a **chest
freezer and a tractor are both `equipment`**, and a **garage and a gate are both
`building`**. A kinds filter either admits the tractor or excludes the freezer,
and the freezer is the canonical inventory location — this pack's own header
calls it one. So this needs a decision rather than a copy of the previous fix:

- **Add storage kinds to the taxonomy.** `assets.kind` is deliberately open, and
  the homestead profile already adds `chicken_tractor`, `hoop_house`, `coop` and
  `barn` for structures. `freezer` / `cold_storage` would make a
  `storageKindsFrom(config)` filter work exactly like `structureKindsFrom`.
- **Or mark the asset itself as holding stock**, which survives a tenant whose
  freezer is recorded as equipment and needs no vocabulary agreement.

Unlike the accounting register pickers, **nothing refuses a bad location** — the
engine accepts any asset — so this is a quality question rather than a correctness one,
and it is why it was never going to fail a test.

**Not tested on purpose:** negative stock. It is allowed by design and covered by
tests, and deliberately creating a negative on the live tenant would leave a
number somebody later reads as a fault.

### 2026-08-15 — Feeding out is a chore; a lot is still a decision (`claude/pack-write-levels`)

Platform-wide change; the reasoning is in
[packs-and-profiles.md](packs-and-profiles.md). What it means here:

- **`recordMovement` and `mergeLot` are open to any member.** Every ledger row
  in this pack is somebody reporting what they physically did with a bag of
  feed. Requiring the owner for that does not make the count safer, it makes the
  count empty.
- **`createItem`, `updateItem`, `archiveItem`, `createLot`, `closeLot` and
  `splitLot` stay owner-only.** A lot is a dimension member, and
  `upsertDimensionMember` requires the owner role — a staff-created lot would
  exist with nothing to group it by. `splitLot` is on this side because it makes
  a lot, not because it feels like a decision.

### 2026-08-15 — Slice 0: items, the lot spine, and the ledger (`claude/inventory-lot-spine`)
- **`livestock` is now unblocked.** That was the point of building this pack
  ahead of the one that needs it, and it is why the lot spine was folded into
  slice 0 rather than left for later.
- **Nothing writes a balance.** Movements are events and the balance is their
  sum, folded in `core/balances.ts` — the same reasoning `assets` applies to
  accumulated depreciation. It reconciles, **split and merge stop being special
  cases**, and the traceability trail IS the model rather than an addition to it.
- **A split BALANCES**, and that is the property `livestock` actually needs: 210
  chicks split 70 into a pen leaves 140 and 70, and the item total is still 210.
  Certified in `tests/inventory-ops.test.ts`.
- **The LOT is the cost object, not the item.** "What did this pen cost" is a
  lot question; nobody asks what "feed" cost in the abstract. So lots sync into
  `dimension_members` as `lot` and items do not — which is what makes
  profit-per-pen fall out of the existing P&L with no accounting change.
- **`inventory` now requires `assets`.** A storage location IS an asset — a
  chest freezer, in a garage, on a parcel — so the ledger points at `assets`
  with a composite FK rather than inventing a parallel location model. Every
  profile listing `inventory` already lists `assets`.
- **One stocking unit per item, and it locks once anything moves.** Every
  movement was recorded in the old unit, so changing the column alone would
  silently restate the whole ledger. The pack refuses it and says why.
- **Conversions refuse across dimensions.** There is no factor between pounds
  and gallons that does not depend on what is in the bucket.
- **Negative stock is allowed on purpose** — see Decisions. It is the single
  most likely thing to be mistaken for a bug.
- Migration `0136` **hand-reordered, for the fourth time** — four composite FKs
  into brand-new tables. Done with a script rather than by hand, because
  spotting four by eye is how the fifth gets missed.
- 29 pure tests, 22 ops tests, 10 isolation tests.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `inventory_items` | A kind of thing held | `tenant_id`, FORCE RLS. One `stocking_unit`, and the balance is kept only in it. `purchase_unit` + `purchase_unit_qty` are an ENTRY convenience, never a second balance |
| `inventory_lots` | **The spine.** A batch, with lineage | Composite FKs to the item and to a parent lot (self-referential, RESTRICT). `source` in `purchased\|raised\|produced` — recorded now because slice 3 cannot infer it retroactively. CHECK: a lot is not its own parent |
| `inventory_movements` | **The ledger.** Every quantity change, and what it cost | Composite FKs to item, lot and **`assets`** (the location). `quantity` is signed and CHECKed non-zero. FORCE RLS in its own right — it is the traceability chain. `reason` (slice 2) is an open taxonomy and the diagnostic |
| `inventory_counts` | **A physical count.** Two acts: `draft` while walking, `posted` once the variances are in the ledger | `tenant_id`, FORCE RLS. `location_asset_id` null means everywhere. CHECK: `posted` status and `posted_on` are set together |
| `inventory_count_lines` | One shelf: this batch of this item, and how much is actually there | Composite FKs to the count (CASCADE), item, lot and the adjustment it wrote. `expected_quantity` is stamped at POST time. `counted_quantity` NOT NULL because zero is a real count |

Lots mirror into **`dimension_members`** with `dimension_type = 'lot'`, in the
same transaction as the write.

`cost_cents` (total, never a rate) and `issued_to_lot_id` (which lot ate it)
arrived in slice 1. Both are nullable and null is ordinary — a transfer, a count
and most head events `livestock` writes carry no money at all.

**Since 2026-08-20 a movement can carry a cost on the way OUT as well as in.**
`production` stamps a pen's share of its accumulated cost on the `processed`
movement that empties it, which is the same discipline `issueStock` follows.
`averageCostRate` is unaffected: it counts only what came in with a price.

`expires_on` on the lot and `reason` on the movement arrived in slice 2. Both are
nullable and null is ordinary: a batch with no date is one nobody has dated (and
the pack does not try to tell that apart from "does not expire"), and a movement
with no reason is one whose kind already says why.

**Valuation is not a column and never will be.** What stock is worth is a fold
over the movements (`core/valuation.ts`), exactly as an account balance is a
fold over journal lines rather than a maintained total. A stored valuation is a
second source of truth that must agree with the ledger forever, which ADR 0007
names as accounting software's worst bug class.

**Not columns, deliberately** — each would have no reader today: the POSTING to
1300/5000 (slice 3b, and see Open items for the bill link it waits on),
reorder points and capacity (slice 5), and commitments — a pre-sold half is never inventory, it goes from a
commitment against a live animal to delivered without sitting on a shelf.

## Key files & seams

- `src/packs/inventory/core/units.ts` — pure. The three kinds of conversion, and
  why only two of them live in code
- `src/packs/inventory/core/balances.ts` — pure. The fold. **Read this before
  changing anything about quantities**
- `src/packs/inventory/core/valuation.ts` — pure. **What the shelf is worth, and
  what it refuses to guess at.** Read `carriedValue` before touching any figure
  that could be zero
- `src/packs/inventory/ledger-ops.ts` — **the only file that touches core's
  tables.** Account resolution today; the posting will live here
- `src/packs/inventory/ops.ts` — all reads and writes, takes a `Tx`. `splitLot`
  and `mergeLot` are the only operations that change cardinality
- `src/packs/inventory/actions.ts` — `requireTenant` + `requireModuleEnabled` +
  `withTenant({ role })` on every action
- `src/app/dashboard/m/inventory/[id]/page.tsx` — the item detail route
- `src/db/schema/inventory.ts` · `drizzle/0136_*.sql` · `drizzle/0137_inventory_rls.sql`
- `tests/inventory.test.ts` · `tests/inventory-ops.test.ts` · `tests/isolation/inventory.test.ts`

## Decisions & gotchas

- **UNVALUED IS NOT ZERO.** A lot nobody costed and a lot whose cost has all
  been released both fold to `remainingCents: 0`, and only the second is worth
  nothing. `carriedValue` is the discriminator and `valueLine` must never be
  handed `remainingCents` directly. A total is always reported with the count
  and quantity it could not value.
- **A LOT IS VALUED AT ITS CARRIED COST, NEVER AT QUANTITY × AVERAGE.**
  Reversing the two quietly re-averages the one case the lot spine exists to
  keep apart.
- **RESOLVE AN ACCOUNT BY CODE BEFORE SUBTYPE, AND REFUSE AMBIGUITY.** Two
  accounts ship with subtype `cogs`. A resolver that picks the first row is
  wrong quietly and compounds.
- **NEGATIVE STOCK IS ALLOWED, and it is not a bug.** Somebody issues feed on
  Tuesday and records Monday's delivery on Wednesday; a system that refuses the
  Tuesday entry teaches people to stop entering things, which costs far more
  than a temporarily wrong number. It is surfaced on the item page and corrected
  by an adjustment or a count in slice 2. Do not "fix" this.
- **AN ADJUSTMENT'S REASON IS A DIAGNOSTIC, NOT A CORRECTION.** It is a column
  so it can be grouped, and the counting page leads with the pattern rather than
  with the counts. If a future slice is tempted to fold the reasons into one
  "adjustments" total, that throws away the only thing they were for.
- **`count_variance` IS NOT `shrinkage`, and must not be merged into it.** The
  first means the record drifted; the second means stock went missing. It is
  also deliberately absent from `SUGGESTED_ADJUSTMENT_REASONS`, so nobody can
  pick it by hand — it is written by posting a count and only there.
- **A COUNT NEVER EDITS A MOVEMENT.** It writes new ones. What happened,
  happened; a disagreement is another event rather than a rewrite of an old one.
  This is why a posted count is frozen rather than editable.
- **A count line's `expected_quantity` is STORED and must never be recomputed.**
  It is what the ledger believed when somebody disagreed with it. A backdated
  movement tomorrow must not restate a variance that already posted.
- **THE COUNT FORM MUST NOT SHOW THE EXPECTED FIGURE.** A number on the screen
  is the fastest way to make a count agree with a record that is wrong. If a
  future slice adds a "pre-fill from the ledger" convenience, it has defeated
  the feature.
- **`inventory_count_lines`'s unique index does not hold for lot-less lines.**
  Postgres treats two nulls as distinct; `NULLS NOT DISTINCT` would fix it and
  this drizzle version cannot emit it, and hand-writing the index in a custom
  migration would drift the snapshot — which this repo has paid for before.
  `recordCountLine` upserts on the same key instead, including the null case.
- **EXPIRY IS ON THE LOT, AND FEFO IS NEVER ENFORCED.** A batch expires; a kind
  of thing does not. Nothing refuses an issue from a later batch, because the
  person holding the scoop can see which bag is already open and this cannot.
- **The stocking unit is immutable once anything has moved.** Converting the
  column alone would re-denominate every historical movement silently.
- **Live-to-hanging is a production YIELD, not a unit conversion.** A steer goes
  in at 1,150 lb and hangs at 690. Modelling that as a factor bakes an
  unauditable fudge into the books and every carcass is quietly wrong. It
  belongs to `production`; inventory must have no opinion on it. **Since
  2026-08-20 that is a place rather than a promise** — `production/core/yield.ts`
  measures it per run and refuses to state one when the weights are not all
  there. See [production.md](production.md).
- **Merge records lineage in the MOVEMENTS, not in `parent_lot_id`**, and the
  asymmetry with split is deliberate. A single parent pointer cannot express
  "these three batches became that one", and pointing the merged lots at the
  survivor would read backwards — as though they had descended from it. The
  `merge_out`/`merge_in` pair records the join in both directions.
- **A balance that nets to zero is dropped from the "where is it" view.** A lot
  that went in and came out is not "0 lb in the freezer"; it is not in the
  freezer. But a NULL location is kept, because "somewhere, uncounted" is honest
  and hiding it would stop the parts adding to the total.
- **drizzle-kit emits every FK before every index** — fourth time (`0125`,
  `0130`, `0132`, `0136`). The rule is *check whether the FK's target is created
  in the same migration*, not *always reorder*: `inventory_movements_location_fk`
  points at the pre-existing `assets` and would have been fine either way.
- **An isolation test cannot cover a pack's ops.** That suite builds fixtures
  under `withSystem` on purpose, so a pack needs BOTH files.

## Open items

- ~~Nobody has driven slice 0 yet~~ — **closed 2026-08-19.** Driven on
  production; the fold, the split, the location split and the return to zero all
  reconcile. It found the two items below.
- **PERPETUAL POSTING IS BLOCKED ON A BILL→ITEM LINK, and this is the next
  thing to build.** `bill_lines` carries an `account_id` and nothing that names
  an inventory item, so a bill for feed posts `Dr Feed Expense / Cr AP` with no
  idea stock arrived. Post `Dr 1300` from the receipt as well and the delivery
  is on the books twice. The two halves are one change:
  1. **A nullable `inventory_item_id` on `bill_lines`**, so a bill line can say
     it bought stock.
  2. **That line posts to `1300` instead of an expense account**, which is what
     makes the receipt's own entry non-duplicative.
  3. **Then the movement postings**: receipt debits inventory, issue credits it
     against COGS, adjustment against the variance account. Transfers, splits
     and merges post NOTHING — they move cost within one account.
  4. **Idempotency is the movement id**, so one movement is one entry forever
     and a replayed write cannot double-post.
  The account resolver and the `MACHINE_SOURCES` seam this needs are already
  built and tested; what is missing is the link.
- **A valuation cannot be exported.** The figure is on a screen and an
  accountant will want it as a file, with the as-of date and the unvalued count
  in it — an export that carried the total alone would strip the caveat, which
  is the one thing this slice was careful about.
- **Nothing values stock BY LOCATION.** `valueStock` groups by item and lot; a
  farm with three freezers and a market truck cannot ask what is in each. The
  read already joins movements, so this is a `groupBy` away rather than a
  design question.
- **`recordMovementAction` should now GO.** Slice 2 gave adjustments their own
  action rather than reusing it: an adjustment has a required reason and a signed
  quantity, and routing it through the generic primitive would have made the
  action lie about what it accepts. Nothing calls it, and nothing is going to.
- **A batch's expiry cannot be edited after it is created.** There is no
  `updateLot` at all — the same shape as the four actions below — so a delivery
  entered without a date, or with the wrong one, is stuck with it.
- **A posted count cannot be corrected.** By design, and the screen says so: the
  variances are in the ledger and unwriting them would rewrite what happened.
  What is missing is the honest remedy — count again — and nothing on the screen
  suggests it.
- **Nothing warns that a batch has gone past its date and is still on hand.**
  The item page colours it and the home page lists it; neither is a rule anybody
  is asked about, which is the deviation-surfacing the design keeps wanting.
- **Four of the eight actions have no UI caller**: `updateItem`, `archiveItem`,
  `closeLot` and `mergeLot`. So an item cannot be renamed or retired and a batch
  cannot be closed. `updateItem` is the one that stings: the stocking unit is
  documented as locking after the first movement, which implies it can be fixed
  before then, and no screen can fix it at all.
- ~~`listLocations` returns every active asset~~ — **fixed the same day** with
  `assets.is_storage_location`, a flag on the asset rather than a kind rule,
  because a freezer and a tractor are both `equipment`. See [assets.md](assets.md).
- ~~Writes are owner-only, and this pack is where that starts to hurt~~ —
  **settled 2026-08-15**, see `docs/modules/livestock.md` for the reasoning.
  Movements and merges are chores; items, lots, archiving and splits stay with
  the owner because each of them creates or retires a cost object.
- **Merge is not in the UI.** `mergeLot` exists, is tested, and has no caller —
  splits are what `livestock` needs first.
- ~~No transfer between locations~~ — **closed 2026-08-21.** `transferStock`
  writes both legs as one act, and `stockAtLocation` answers "what is at this
  place". Built for `retail`'s market truck, which is a storage-location asset
  like any other — the whole reason that design has no distributed-inventory
  problem in it. A transfer carries **no cost**: moving a box does not change
  what it cost, and stamping a figure would release cost from the lot and put a
  different one back. **Still no UI in this pack** — the only caller is retail's
  load/unload, so moving between two freezers is still two entries here.
- **Item-specific purchase conversions are entered as free text.** "bag" is not
  validated against anything, so two items can spell it differently.
- **`wouldGoNegative` has no caller.** Written for a warning the UI does not yet
  show.
- **No traceability view.** Lineage is recorded and `lotAncestry` walks it, but
  nothing renders the chain from an animal to a package.
