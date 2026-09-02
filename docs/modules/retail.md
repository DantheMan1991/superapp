# Retail

> Where the business sells, what it charges there, and what a day of selling
> cost to stand at. **The revenue half of the farm profile** — the pack that
> makes profit-per-enterprise a whole sentence rather than the cost side of one.
> The sixth capability pack (Layer 2a) to ship.
> Status: `available` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

**Read [inventory.md](inventory.md) first** if you are touching anything about
what a price is a price OF. The design this is sliced from is in
[homestead-farm.md → Category design — Retail](homestead-farm.md#category-design--retail-brainstormed-2026-08-13);
this dossier is the build record.

## Slice order

**REORDERED 2026-08-25, and the numbers are identities rather than positions —
read the State column, not the order of the digits.** This table used to say
offline (1b) was next. The founder corrected that: *he has signal almost all of
the time, and what he actually cannot do is take a credit card.* So the payment
slices move to the front and **1b becomes robustness rather than a blocker.**
Rows are listed in build order; the numbers are left alone because the build log,
`src/db/schema/retail.ts` and ADR 0015 all cite them by name.

| # | Slice | State |
| --- | --- | --- |
| **0** | **Channels + per-item-per-channel price lists + the market day record** | **shipped 2026-08-20** |
| **1** | **The till: sales, the truck, sold-out capture, day-end reconciliation** | **shipped 2026-08-21** |
| **1p** | **Stripe Connect: the farm's own connected account, per company** | **shipped 2026-08-25** — Layer 0, [ADR 0015](../decisions/0015-a-connected-account-belongs-to-a-company.md), dossier in [payments.md](payments.md). **Parked 2026-09-02**: the provider on offer is now Square |
| **1q** | **Square: the account the farm ALREADY takes cards with, per company** | **shipped 2026-09-02** — Layer 0, [ADR 0017](../decisions/0017-the-square-account-the-farm-already-has.md), dossier in [payments.md](payments.md). The homestead brief's own recommendation, Square-first and read-before-write, finally followed |
| 2 | Payment adapter — read (Square payments and payouts, with fees → books) | **next** — no hardware, no till change; the pilot's Square payments already exist to match against |
| 5 | **Payment adapter — write: the till takes a card** | after 2 — two paths, both wanted: the Square app-switch (the $59 reader or the phone) and the Square Terminal API; `collectPayment` on Stripe stays as the parked third |
| 1b | Offline: service worker, durable queue, flush on reconnect | deferred — robustness, not a blocker. See Open items |
| 3 | Commitments: reservations, deposits, hanging-weight final invoice, fulfilment point — needs `production` | |
| **8** | **Selling by the pound** — `retail_prices.price_basis`, `weight_lb` and `line_total_cents` on the sale line, a weigh box on the till. [ADR 0016](../decisions/0016-a-catch-weight-item-is-stocked-in-packages.md) | **shipped 2026-08-25** |
| 4 | Farm store, attended and count-derived | |
| 6 | Online orders + pickup windows | |
| 7 | Shipping (costed), then wholesale (eligibility becomes load-bearing) | |

## Build log

### 2026-08-26 — The pack puts on the design system (`claude/the-last-three-packs`)

No behaviour changed. PR 4 of the five that bring the packs onto the primitive
layer, and the last of them — see [design-system.md](design-system.md) for the
sweep as a whole.

**THIS PACK GETS NO `CategoryStrip`, AND THAT IS THE FINDING RATHER THAN AN
OMISSION.** The first three packs each had a header stuffed with four or five
outline buttons that were really destinations. Retail has NONE: every non-hub route in the pack — `[id]` and
`days/[id]` — is a record, not a section. The strip exists to
show a module's SECTIONS, and a strip with one tab is chrome that teaches
people the control is useless. So the hand-rolled back-links on the record
pages **stay**: with no sections there is nothing to replace them with, and a
record-to-list link is the only navigation those pages have.

Accent chip on every `PageHeader`, `Card` to `Panel`, tables into `DataTable`,
section headings to the house 20px, and dashed-border paragraphs to real
`EmptyState`s.

**The market day's three figures became `StatCard`s, and the margin keeps its
`tone`.** That card already carried a comment insisting a losing day must LOOK
like one, because `formatMoney` drops the sign and a market that cost $53 and
took nothing otherwise reads as $53 earned. `tone="destructive"` says the same
thing in colour. Driven against the founder's live $29.60 day: it renders
**−$23.40 in red**.

**The tin keeps its em dash.** Not counted and counted-and-balanced are
different facts, so the uncounted state is "—" and not a zero variance — the
`value` prop takes a node, which is what makes that expressible without a
second card.

One more back-arrow was standing in as an empty-state glyph on *No truck to
sell from*; it is a truck now, and *Nothing sold yet* is a receipt.

### 2026-08-25 — The till weighs a package (`claude/the-till-weighs-a-package`)

Slice 8, and the last of the three [ADR 0016](../decisions/0016-a-catch-weight-item-is-stocked-in-packages.md)
cut into. `inventory` made meat a package with a weight; this is where a
customer pays for the pounds.

**THE INVARIANT THE WHOLE SLICE IS ABOUT: the MONEY comes from the scale and
the STOCK comes from the package count, and neither is derived from the other.**
Three packages weighed together at 3.7 lb is one line — quantity 3, weight 3.7,
$29.60 — and it takes **three packages** off the truck.

**`retail_sale_lines.quantity` STILL MEANS PACKAGES, and that was the constraint
every other decision had to fit around.** It is the number that issues the
movement and the number `soldByItem`/`remainingOnTruck` count the truck down by.
Putting the weight in `quantity` and letting the existing arithmetic multiply is
very tempting — 3.7 × 800 is exactly 2960, no branch, no new column — and it
makes the till count 3.7 packages off a truck holding 12.

**THE MONEY IS RECORDED RATHER THAN RECONSTRUCTED, and one worked example is the
entire argument.** 3 packages, 3.7 lb, $8.00 a pound is $29.60. There is no
per-package price that reproduces it: $29.60 over three is $9.8667, which rounds
to $9.87 and multiplies back to $29.61. **A till that is a cent wrong in front of
the customer holding the note is the failure `core/till.ts` exists to prevent**,
so `line_total_cents` is stamped and read straight back.

**IT IS ONE BRANCH IN `lineTotalCents`, IN THE FILE EVERY CUSTOMER-FACING NUMBER
COMES FROM.** A stamped total wins; everything else takes the path it always
took and produces the number it always produced. One branch rather than a second
function, so the receipt and the day-end report cannot drift by taking different
ones — and `!== null` rather than `??`, because a stamped **zero** is a free
weighed line and `??` would fold it back to the derived branch and charge for a
giveaway. There is a test on exactly that.

**THREE PLACES TOTAL A SALE AND THEY NOW SHARE ONE ADAPTER.** The idempotent
replay, the fresh post and the day's list each built their own object literal for
the fold; three literals is how one of them quietly forgets the stamped total and
starts pricing weighed lines per package at a per-pound rate. `asTotalled` is the
only one, and the replay path has its own test because it folds STORED rows
rather than the input.

**THE PAIR IS REFUSED IN BOTH DIRECTIONS, and the second direction is the one
that matters.** A weight with no total falls into the derived branch and prices
the line per PACKAGE at a per-POUND rate — silently, and low. The table CHECKs
that one (`retail_sale_lines_weighed_has_total`). A total with no weight is
arithmetic stored twice, which only `recordSale` can refuse, and it does.

**PER-POUND IS REFUSED FOR AN ITEM STOCKED BY MASS.** The quantity already IS the
weight there, so the two bases mean the same thing and the till would ask
somebody to weigh a number they had just typed. The picker is hidden on the price
form rather than offered and then refused.

**A BASIS CHANGE IS A NEW ROW, like any other price change** — *"we used to sell
it by the package at $9, now by the pound at $8"* is a fact a margin report reads
back, so `price_basis` sits on the effective-dated row and not on the item.

Three things the screens had to say that they did not:

1. **The truck tile shows `/lb`.** Without it a tile reads "$8.00" for a package
   that rings up at $9.60 — the one place somebody at a stall notices too late.
2. **The basket has two shapes**, because they are two different sales. A unit
   line is quantity × price and reads exactly as it always has. A weighed line is
   a count, a scale reading, and money worked out from the two — and the money is
   the editable box there, because *two for twenty* on a weighed line is a total
   and not a rate. Changing the weight clears a typed total, since a haggled
   figure belongs to what was on the scale at the time.
3. **The sales list prints the pounds.** Otherwise the row reads "1 package at
   $8.00" beside a sale that took $9.60 and looks like a mistake.

**A weighed line with no weight cannot be sold, AND MUST NOT BE TOTALLED — and
the second half was a real bug that only clicking found.** `lineTotalCents`
falls back to quantity × price when no total is stamped, which is correct for a
unit line and, for a `'lb'` line, is one package at a per-POUND rate. A basket
holding one unweighed package of $8.00/lb beef read **$8.00** — plausible, not
what the customer will pay, and **precisely the per-package-at-a-per-pound-rate
mistake this whole slice exists to prevent**, sitting in the one place nothing
guarded. Every test passed over it, because every test handed the fold a line
that was already weighed.

Unweighed lines are now left out of the total, the panel says which ones
(*"Not counting Ground beef 1 lb packs — still on the scale"*), and the button
is disabled rather than erroring on tap: the reason is already on screen, and a
dead button beside it reads as the same sentence. `take` keeps its own guard for
anything that reaches it another way.

**Driven at the screen, on the dev branch's Hilltop Farm**, which is what found
the above. $8.00 per pound set on Ground beef 1 lb packs; 12 packages loaded
(the load dialog reading "about 18.125 lb"); the truck tile reading `$8.00/lb`
beside Whole broilers' plain `$5.50`; then 3 packages at 3.7 lb ringing up at
**$29.60** — the ADR's worked example, to the cent. The truck went from 12 to
**9 packages**, takings to $29.60, margin from −$53.00 to −$23.40, the tin to
$129.60 expected. The stored row is `quantity 3.0000 · unit_price_cents 800 ·
weight_lb 3.7000 · line_total_cents 2960`, and the sales list prints *"3 packages
Ground beef 1 lb packs · 3.7 lb at $8.00/lb"*.

**A NOTE FOR WHOEVER DRIVES THIS NEXT:** the local Clerk session reverts its
active organisation between a page load and a server action, so a write executes
against the wrong tenant and the page 404s. Calling `Clerk.setActive` immediately
before the click — in the same script, with a short wait — is what makes it land.
This has now cost time in three separate sessions.

Migration `0213`: one column on `retail_prices`, two on `retail_sale_lines`, four
CHECKs. No new table, no RLS migration. Applied to dev and to production before
the merge, per [ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md).

### 2026-08-25 — What is on the truck, in pounds (`claude/what-a-batch-weighs`)

Retail's share of `inventory` slice 6b, and it is small on purpose. **A truck is
loaded in packages — that is the whole point of the `pkg` unit — and the one
thing a count of packages cannot answer is whether the van will take it.** So
the load and bring-back rows now show what the line weighs, live, as somebody
types the count.

- **The batch's rate beats the item's**, because that is where the figure is
  true: a run packed in 1 lb bags and a run packed in 2 lb bags are different
  lots. `LoadableLot.weightRate` carries it; `LoadableItem.weightRate` is only
  the fallback for a line with no batch chosen.
- **One query for the whole price list**, not one per row. `weightRatesForItems`
  returns both maps at once for exactly this reason.
- **An item nobody has weighed says nothing**, and a mass-stocked one says
  nothing either — "43.2 lb" under a box already reading 43.2 is one number
  twice. `WeightReading.approximate` is the guard for both cases.

**NOTHING ABOUT SELLING CHANGED.** The price is still per stocking unit and the
till still cannot take a weight; that is slice 8, and it needs
`retail_prices.price_basis` and a weight on the sale line. See
[ADR 0016](../decisions/0016-a-catch-weight-item-is-stocked-in-packages.md) for
the shape it will take and for why `retail_sale_lines.quantity` must keep
meaning packages.

### 2026-08-25 — Load the whole truck, not one thing at a time (`claude/load-the-whole-truck`)

**A TRUCK IS LOADED WITH MANY THINGS AT ONCE.** Five cuts of beef, four of
chicken and a crate of produce is one trip — and both truck forms asked for
them one at a time, so putting a real load on meant opening the same dialog ten
times. That is a form nobody finishes, which is another way of saying the truck
stayed empty and the till had nothing to sell.

Both directions take a line per thing now: item, batch, quantity, add another,
remove.

- **ONE TRANSACTION FOR THE WHOLE LOAD, and it is the point of the shape.** Nine
  lines where the fifth fails must not leave four on the truck: the farmer
  drives off believing they have stock the ledger says is still in the yard, and
  **the till then counts down locally from a number that was never true**, so
  nothing catches it until the day-end variance. All or nothing.
- **BRINGING BACK STARTS FULL.** At the end of a market you take home whatever
  did not sell, so the unload dialog opens with a row per batch still on the
  truck at its remaining quantity, each showing "N on the truck". The common
  case is one click; adjusting is for the pound somebody gave away.
- **The unit is per row.** A load of pounds and head reads right line by line —
  "How much (lb)" above one and "(head)" above the next — because a mixed truck
  is the normal truck.
- **The day and the other end stay per MOVE, not per line.** You load the whole
  truck on one morning out of one place; asking twice per row would be a worse
  form for no more truth.
- **Changing a row's item clears its batch.** A lot belongs to the thing it was
  made of, and carrying it across would move stock out of a batch that is not
  this item's.
- **A blank row is skipped, an entirely blank form is refused.** Somebody adding
  a row and thinking better of it should not have to find the remove button.

Two ops tests cover the guarantee: a load that throws partway leaves **nothing**
on the truck, and a load of three different things puts all three on.

**Driven on the dev branch.** Three rows, three items, three units — and the
server received one call carrying three lines. The bring-back opened prefilled
with the truck's own stock. **The write was not observable through the browser**
for the same reason as the last change: the local Clerk session keeps reverting
its active organisation between the page load and the server action, so the
action executes against a tenant with no `retail`. The action was confirmed
running with the right payload; the ops tests cover what it writes.


### 2026-08-25 — What you still need before you can sell (`claude/what-you-still-need-to-sell`)

**THE TILL NEEDS FOUR THINGS AND NOTHING ANYWHERE SAID SO.** A price, somewhere
to sell out of, a market day, and stock loaded onto it. Miss any and the failure
is silent in a particular way: the channel page shows an empty *"market days
here"*, the day page says *"No truck to sell from"* — and each message is only
visible **after** you have already guessed the step before it.

That is the whole reason this dossier said for weeks that *"the market truck has
not left a yard"*. The founder went looking for the point of sale on a live
channel and could not find one. **Reach, not reluctance.**

So the channel page opens with **Before you can sell here** — three steps, each
either ticked or carrying the sentence that says what to do about it.

- **It disappears once it is satisfied.** A checklist that keeps congratulating
  an established stall is noise, and noise is what teaches somebody to skip the
  one panel that had something to say.
- **The truck step links to Assets**, because that is where it lives, and it is
  the step nothing in Retail has ever mentioned. The link only appears when that
  module is switched on; otherwise the copy says plainly that it is not.
- **Loading the truck is deliberately NOT a step here.** It happens on the
  day's own page, next to the button that does it — and a checklist item you
  cannot act on from the page you are reading is worse than no item.

Driven both ways on the dev branch: an empty channel shows the panel with the
truck step already ticked and the other two open, and the established channel
renders without it.

### 2026-08-25 — A market day is opened, then closed (`claude/open-the-stall-then-close-it`)

**THE OBJECT CHANGED JOBS BETWEEN TWO SLICES AND THE WORDS NEVER CAUGHT UP.**
Slice 0 built `retail_market_days` as a retrospective cost record — *what did it
cost to stand there*, so two seasons settle which market is habit. Slice 1 then
hung the TILL off that same row, which made it the thing you must create
**before** you can sell anything. One object, two opposite tenses, and the
dialog only ever spoke the first.

The founder found it by looking at it: *"Record a market day makes it seem like
this is recording something that has already happened."* It is worse than the
label, and the evidence was in the fields:

- **"Hours stood there"** — unknowable at seven in the morning.
- **"Weather · e.g. rained until eleven"** — past tense by construction.
- **The one genuinely start-of-day field was missing from the start-of-day
  form.** `opening_float_cents` — the change you take to the stall — was
  collected at the END, inside "Count the tin". So the form named for the past
  asked about the future, and the form named for the end asked about the
  beginning.

**Opening and closing are two moments now.**

- **"Start a market day"** asks only what somebody knows before they have stood
  there: where, when, the float in the tin, and the stall fee *if* it was paid
  upfront. Submit reads **"Start selling"**.
- **"Close the day"** on the day's own page absorbs the old cash panel and
  everything retrospective: the count, the fee, getting there, crew, hours,
  weather, notes. It reads "Edit the day" once those facts exist.
- **STARTING A DAY NOW TAKES YOU TO IT.** `recordMarketDayAction` returns the
  id and the form pushes to `/days/<id>`. Leaving somebody on the page they
  started from is most of why the till was unfindable: the truck, the tin and
  the till live only there, and the other way in is clicking a date in a list
  that was empty a second earlier.

**No `closed_at` column.** Nothing reads a closed state, and a column with no
reader is what this repo refuses; the button leans on whether the end-of-day
facts exist yet.

**The risk in merging the tin into the close form is that it resubmits EVERY
field**, so a mis-read prefill would silently blank whatever the opening form
set. Two ops tests cover exactly that, including that **a blank count is still
not a zero count** — the rule the cash panel has always turned on.

**`scripts/retail-fixture.ts` is how any of this got looked at.** The till only
renders when four things already exist — a channel, a market day, a
storage-location asset, and priced stock on it — which is why this dossier has
said since slice 1 that *"the market truck has not left a yard"*. The reason
was reach, not reluctance. The script builds the chain in one command, writes
through the real ops, and refuses any database that is not the dev branch.

**What could NOT be driven, and why it is honest to say so.** The two dialogs
were verified on screen — copy, fields, prefilled values, and the button
switching between "Close the day" and "Edit the day". The SAVE round trip was
not: the local Clerk session kept reverting its active organisation to `Test`
between the page load and the server action, so every action executed against a
tenant with no `retail`. The action itself was confirmed to run with the right
payload in the server log; what it wrote could not be observed through the UI.
The ops tests cover the write.

### 2026-08-25 — The order changed: cards before offline (`claude/the-account-that-belongs-to-the-farm`)

No retail code moved. What moved is the roadmap, and a roadmap that contradicts
the order things are being built in is worse than no roadmap.

This dossier said offline (1b) was next. The founder corrected it: **he has
signal almost all of the time, and what he cannot do is take a credit card.** So
the payment slices went to the front, 1b became robustness, and the Layer 0 half
of payments — the farm's own Stripe connected account, one per company — shipped
the same day. That work has its own dossier ([payments.md](payments.md)) and its
own decision ([ADR 0015](../decisions/0015-a-connected-account-belongs-to-a-company.md)),
because a connected account is platform machinery that any pack could sell
through rather than something retail owns.

The two things this pack still needs, in order: a registered Terminal reader with
a PaymentIntent pushed to it (slice 5), then the settlement and its fee reaching
the books (slice 2).

### 2026-08-21 — Slice 1: the till, and the column that makes a retry safe (`claude/the-till-that-cannot-double-post`)

Slice 0 could say what a selling day COST. This says what it made — so **profit
per market day is a number for the first time in the build**, and the design's
argument about the dud market attended out of habit finally has data behind it.

**`retail_sales.client_ref` IS THE POINT OF THIS SLICE, and it is in the schema
before any offline code exists.** A market stall often has no signal, so a till
has to take a sale and post it later — which means posting WILL be retried, and a
retry whose request arrived but whose reply did not would take the money twice
and issue the stock twice with it. The till mints an id before it touches the
network; the unique index makes a replay a no-op.

That sequencing was deliberate. **Everything else about offline is client code
that can be swapped** — a service worker, an IndexedDB queue, flushing on
reconnect. Idempotent posting is a column and an index, and retrofitting it means
reconciling every sale already taken. So it landed first, and
`recordSale` returns `alreadyPosted` so a flush can report *"5 sent, 1 was
already in"* rather than double-counting its own success.

**THE OFFLINE PROBLEM IS A DATA-MODEL PROBLEM AND IT WAS ALREADY SOLVED.** The
market truck is a storage-location asset — no new concept — so loading it is an
ordinary transfer: the app knows exactly what left, the till draws down the
truck's own stock, and what did not sell comes back. Nothing is shared between
devices, so nothing can conflict. The till counts the truck down **locally** from
one snapshot, which is why it needs no server round trip between customers.

- **`inventory` gained `transferStock` and `stockAtLocation`**, which closes an
  open item that pack has carried since its slice 0: moving stock was "two
  movements, and the UI does not offer it as one act" — exactly the shape that
  gets one leg entered and the other forgotten. A transfer carries **no cost**:
  moving a box does not change what it cost, and stamping a figure would release
  cost from the lot and put a different one back.
- **The price is stamped as charged, not looked up.** The list is where the till
  reads a suggestion; a market haggles, and *two for twenty* is what happened.
  Deriving it later would let an October price change restate June's revenue.
- **The rounding happens once, per line.** Three lines at $12.925 are $38.79, not
  $38.775 rounded. A stall adds up in front of somebody holding a note and the
  day-end report adds the same lines up hours later; a cent between them is the
  till being wrong where a customer can check it.
- **Cash is kept apart from everything else**, because only cash can be counted.
  A reconciliation that checked the tin against total takings would report every
  card sale as a shortfall — the fastest way to teach somebody to ignore it.
- **A blank count is not a zero count.** Not counted and counted-and-right are
  different facts, and the panel says which. Zero variance reads "Balanced"
  rather than a signed nothing.
- **Stockouts are one tap and nothing can infer them.** Selling everything you
  brought looks like a perfect day; nobody knows how many people wanted eggs at
  noon and found none. Unique per item per day, so a double-tap corrects the
  time rather than inventing a second event.
- **Voiding a sale leaves the stock issue behind**, the call `livestock` made for
  a treatment whose medicine had already left the shelf. The goods went over the
  table. `inventory` slice 2's adjustment is the remedy — and for the first time
  in this repo the loose end has a screen to fix it on.
- **It is a MARGIN, not a profit, and the name is doing work.** What the goods
  cost to produce is not in it; that lives on the stock's stamped receipt, and
  joining the two is a report nobody has built.
- 22 new pure tests, 9 new ops tests, 14 new isolation tests, plus 3 in
  `inventory` for the transfer and 3 in `money-symbol` for the sign. Migration
  `0174` **hand-reordered — eleventh check, sixth yes**; `0175` is the RLS trio.

**DRIVEN END TO END BEFORE THE PR** — truck asset, channel, price, market day,
four sales, a haggled line, a cash count, a stockout, a bring-back and a void —
**and it made five of the last five slices with a defect that only clicking
found.** Every one was already covered by a passing test.

1. **The margin card read `$53.00` for a day that took nothing and cost $53 to
   stand there.** `formatMoney` drops the sign by design, so **the loss rendered
   identically to a profit** — the exact fact this pack exists to surface,
   inverted. Now `formatMoneySign`, whose doc comment says what every
   `formatMoney` caller is really asserting: that the number cannot go negative.
   A subtraction produced this one.
2. **The truck read 35.65 lb with 36.65 lb in the cooler.** The page re-reads
   the truck a beat after each sale; the local delta was then applied to a
   figure that already contained it, so **the truck ran short by the whole
   session's sales** and would have driven a "ran out" tapped over stock that
   was there — the one event here nothing else can reconstruct. Fixed by tagging
   each delta entry with the `clientRef` it was posted under, so the question it
   answers is exact rather than timed: what has this device sold that the
   snapshot does not know about? See `unconfirmedSales`. **This is also the
   shape the offline queue needs**, so 1b inherits it.
3. **The local count was trapped in the same transition as `router.refresh()`**,
   so the truck would not move until the server answered — in a till whose whole
   reason for counting locally is that there may be no server to answer. The
   network call is a plain `useState` flag now and the refresh is a transition
   of its own, allowed to be slow and one day allowed to fail.
4. **"Bring it back" offered the entire price list**, feed and antibiotics
   included, defaulting to something never on the truck — each one a transfer
   driving the truck negative, and unbatched, which would strand the lot on a
   vehicle. It now offers the truck's own stock with its batches, and greys out
   when the truck is empty.
5. **Void had no confirmation**, on a row of buttons used one-handed at a stall,
   for an action that destroys posted revenue and deliberately does NOT put the
   stock back — so a mis-tap leaves the takings short, the truck right, and
   nothing saying the two disagree. The doc comment already claimed a dialog.
   **Then the dialog did not appear**: asking inside a transition deadlocks,
   because opening it is a transition update the transition cannot commit while
   suspended on the answer. The button silently did nothing, which is the exact
   failure `useConfirm` was written to end. The guard belongs ahead of the
   transition, as every other call site in the app has it.
6. **Sale and stockout times rendered in UTC** via `toISOString()`. A Denver
   farm selling at four in the afternoon read its own market back as 22:00.
   `ctx.tenant.timezone` was already on the page.

Not fixed here, and filed separately: one accounting call site
(`companies-controls.tsx`) has the same confirm-inside-transition deadlock.

### 2026-08-20 — Slice 0: where it sells, what it charges, what standing there costs (`claude/what-a-market-day-costs`)

The first pack on the revenue side. Every other pack in this profile answers
what something COST; until now nothing could say what anything sold for, so
profit per enterprise was half a sentence.

**A PRICE IS NOT A PROPERTY OF A THING, and that is the decision the whole pack
turns on.** The same pound of ground beef is one price at a market stall,
another at the farm gate, and another again to a wholesaler — and none of them
is *the* price. So price lives on the pair (channel, item) and never on
`inventory_items`. It is what makes the wholesale seam nearly free later, and it
is why the list of channels exists on day one with exactly one entry on it: the
pilot has one farmers market and says more are coming, and retrofitting the list
would cost a migration plus every price ever entered.

**A PRICE CHANGE IS A NEW ROW, NEVER AN EDIT.** `retail_prices` is
effective-dated: the current price is the latest row that has STARTED, and
setting the same day twice replaces it rather than adding a second. Updating in
place would answer *what do I charge* and destroy *what did I charge in June*,
which is the only version of the question a margin report can ask. Same shape as
`retainer_allotments`, and for the same reason.

- **There is no `effective_to`.** A price runs until the next one starts. A
  second column saying so is a second number that has to agree with the first
  forever; the gap is arithmetic, not a fact anybody enters.
- **A price set AHEAD does not apply today**, and the screen says it is coming.
  A price entered for next season and then silently applied the moment it was
  typed is what stops people entering them in advance.
- **The price is per the item's STOCKING UNIT** and there is no unit column.
  `inventory` allows one unit per item precisely so every number about it reads
  the same way, and a price denominated differently from the balance would put
  the "is it bags or pounds" bug back in the one place it costs real money.
- **Free is a real price; negative is not.** A sample, a giveaway and a loss
  leader are all zero. A negative is a refund, and that is a sale's business.

**WHAT A DAY OF SELLING COST, AND THE HOURS DELIBERATELY OUTSIDE THE MONEY.**
The design's argument for this table is blunt: *with two or three markets a week,
one is usually a dud attended out of habit, and two seasons of this data ends
that argument.* Stall fee, travel, crew and hours are all recordable before any
till exists — so slice 0 answers the cheaper half honestly rather than showing a
profit column full of em dashes.

`marketDayCost` returns person-hours BESIDE the out-of-pocket money and never
inside it, because **if own hours count as zero then every market is profitable
and the dud is invisible** — which is the exact thing the table was built to
settle. Costing them needs a decision about what an hour is worth, which is
`production`'s open item too.

**Driven on the dev tenant.** A Saturday market at Elm Street, whole broilers at
$5.50 a pound from today with $6.00 queued for 1 October, and a market day at
$35 stall + $18 travel over 2 crew × 5 hours → **$53.00, 10 person-hours, $5.30
an hour**. The future price sat in the *Next* column without touching today's,
and the history showed both rows with the current one badged.

**It found one reading defect:** on the home page the DATE was the link and it
led to the channel, while the channel's own name sat inert in the next column.
There is no page for a single day, so the date is now plain and the channel is
the link. The link goes on the thing it opens.

- `retail` flipped to `available` in `scripts/seed.ts`; both databases
  re-seeded. The homestead profile gained `packConfig.retail.channelKinds` —
  the pack declares none of its own, because one that knew what a farmers market
  was would know what industry it was in.
- 18 pure tests, 12 ops tests, 13 isolation tests. Migration `0172`
  **hand-reordered — tenth check, fifth time the answer was yes**; `0173` is the
  RLS trio.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `retail_channels` | **Where the business sells** — a stall, the gate, a shop, a wholesale account | `tenant_id`, FORCE RLS. `channel_kind` open taxonomy (P1), values from the profile. `location` is FREE TEXT and deliberately not an asset: the farm does not own the square its stall stands on |
| `retail_prices` | **What one item costs in one channel, from one day** | Composite FKs to the channel (CASCADE) and the item. UNIQUE on (channel, item, `effective_from`) — two prices starting the same morning is a question, not a change. No `effective_to`. CHECK: not negative. **`price_basis` (`'unit'`\|`'lb'`, default `'unit'`) says what the figure is PER** — part of the price, so a basis change is a new row like any other, and `'lb'` is refused for an item stocked by mass |
| `retail_market_days` | **A day of selling, what it cost to stand there, and the two ends of the cash tin** | Composite FK to the channel. `crew_size` and `hours` are recorded and **not costed**. `opening_float_cents` / `cash_counted_cents` arrived with the till. Deliberately NOT unique on (channel, day): a morning market and an evening one are two days of standing there |
| `retail_sales` | **A sale.** Somebody paid and took it away | Composite FKs to the channel, the day (nullable) and the location. **`client_ref` UNIQUE per tenant — the column that makes a retry safe.** Nullable, and multiple nulls are fine: a server-side sale has no till behind it. No customer column — a cash buyer is anonymous, and named buyers arrive with commitments in slice 3 on the CRM party spine |
| `retail_sale_lines` | One thing sold, at the price actually charged | Composite FKs to the sale (CASCADE), item, lot and **the issue that took it off the truck** (NOT NULL — revenue with nothing behind it is not revenue). UNIQUE per movement. `unit_price_cents` is stamped, never re-derived — **per stocking unit, or per POUND when `weight_lb` is set**. `weight_lb` is what was on the scale and `line_total_cents` is the money it came to; CHECKed as a pair, and **`quantity` still means PACKAGES** because it is what issues the movement |
| `retail_stockouts` | **Ran out of something, at a time** | Composite FKs to the day (CASCADE) and the item. UNIQUE per item per day. The only record anywhere of revenue that was NOT taken |

**Everything else lives in a pack this one requires:**

| The question | Answered by |
| --- | --- |
| What is a price a price OF? | `inventory_items` |
| What is actually on the truck? | `inventory`'s `stockAtLocation` — the truck is a storage-location asset, which is why there is no distributed-inventory problem |
| How did the stock get there? | `inventory`'s `transferStock`, wrapped as `moveStockToTruck` |
| What did the thing cost to make? | `production`, through the output lot's stamped receipt |

**Not columns, deliberately** — each would have no reader today: settlements and
fees (slice 2), commitments and deposits (slice 3),
and **channel eligibility** — the stamp comes off a production run and
`production` does not stamp one until ITS slice 1, so the column would be a
guard with nothing to read.

## Key files & seams

- `src/packs/retail/core/pricing.ts` — pure. **The price timeline and the day's
  cost.** Read this before changing anything about what a price means
- `src/packs/retail/core/till.ts` — pure. **The rounding, the takings split, the
  cash count and the day's margin.** Read this before changing any number a
  customer can check
- `src/packs/retail/components/till.tsx` — the point of sale, and where a
  `clientRef` is minted
- `src/packs/retail/core/till.ts` → `unconfirmedSales` — how a server snapshot
  and a local delta are added together without counting a sale twice
- `src/app/dashboard/m/retail/days/[id]/page.tsx` — one selling day
- `src/packs/inventory/ops.ts` → `transferStock`, `stockAtLocation` — added for
  the truck, and living in `inventory` because the ledger is its table
- `src/packs/retail/ops.ts` — reads and writes, takes a `Tx`
- `src/packs/retail/actions.ts` — `requireTenant` + `requireModuleEnabled` +
  `withTenant({ role })` on every action. `setPrice` is the one write in the
  pack that is audited
- `src/app/dashboard/m/retail/[id]/page.tsx` — one channel: its price list and
  its days
- `src/db/schema/retail.ts` · `drizzle/0172_gorgeous_yellowjacket.sql` ·
  `drizzle/0173_retail_rls.sql`
- `tests/retail.test.ts` · `tests/retail-ops.test.ts` ·
  `tests/isolation/retail.test.ts`

## Decisions & gotchas

- **`retail_sale_lines.quantity` MEANS PACKAGES, ON EVERY LINE, INCLUDING A
  WEIGHED ONE.** It issues the movement and it is what `soldByItem` /
  `remainingOnTruck` count the truck down by. Putting a weight in it is the
  tempting shortcut — 3.7 × 800 is exactly $29.60 with no branch and no new
  column — and it makes the till take 3.7 packages off a truck holding 12.
- **A STAMPED `line_total_cents` WINS IN `lineTotalCents`, AND THE TEST IS
  `!== null` RATHER THAN `??`.** A stamped **zero** is a free weighed line; `??`
  would fold it back to the derived branch and charge for a giveaway. There is a
  test pinning it.
- **THREE PLACES TOTAL A SALE AND THEY MUST SHARE `asTotalled`.** The idempotent
  replay, the fresh post and the day's list. Three hand-written object literals
  is how one of them forgets the stamped total and starts pricing weighed lines
  per package at a per-pound rate — and the replay path is the likeliest, because
  it folds STORED rows rather than the input it was handed.
- **A WEIGHT AND A TOTAL ARE A PAIR, REFUSED IN BOTH DIRECTIONS.** A weight with
  no total is priced per PACKAGE at a per-POUND rate, silently and low (the table
  CHECKs it). A total with no weight is arithmetic stored twice (only
  `recordSale` can refuse that one).
- **`price_basis = 'lb'` IS REFUSED FOR AN ITEM STOCKED BY MASS.** There the
  quantity already IS the weight, so both bases mean the same thing and the till
  would ask somebody to weigh a number they had just typed.

- **A MARKET DAY IS OPENED AND THEN CLOSED, AND THE TWO FORMS MUST NOT MERGE
  BACK.** "Start a market day" collects only what is knowable at the start; the
  retrospective half belongs to "Close the day" on the day's own page. The row
  is both a container the till hangs off and a record of what the day cost —
  that dual job is what made the original dialog ask about the weather before it
  had happened.
- **THE CLOSE FORM RESUBMITS EVERY FIELD.** Anything added to the market day
  must be prefilled there, or closing the day will blank it. `tests/retail-ops`
  covers the ones that exist.
- **STARTING A DAY NAVIGATES TO IT.** `recordMarketDayAction` returns the id for
  that reason; do not "simplify" it back to `{ ok: true }`.
- **THE CHECKLIST HIDES ITSELF WHEN SATISFIED, AND THAT IS THE FEATURE.** If a
  future step is added to selling, add it to `SellingChecklist` — a prerequisite
  that only announces itself once you have already failed at it is what the
  panel exists to end.
- **A TRUCK MOVE IS ATOMIC ACROSS ITS LINES.** `loadTruckAction` and
  `unloadTruckAction` run every line inside ONE `withTenant`. Do not "simplify"
  them into a call per line: a half-loaded truck is stock the till believes in
  and the ledger does not, and the till counts locally so nothing would notice.
- **BRINGING BACK PREFILLS FROM THE TRUCK, REBUILT ON EVERY OPEN.** The truck's
  stock changes as things sell, so a prefill captured at mount would offer this
  morning's load at four in the afternoon.
- **`client_ref` IS LOAD-BEARING AND MUST NEVER BECOME OPTIONAL FOR A TILL.**
  Posting is retried by design; without the ref a retry takes the money twice.
  Any future till — farm store, online — mints one before it touches the network.
- **A NUMBER A SUBTRACTION PRODUCED IS RENDERED WITH `formatMoneySign`.**
  `formatMoney` drops the sign, so reaching for it is an assertion that the
  figure cannot be negative. A margin, a balance and a variance all can.
- **THE LOCAL DELTA IS KEYED TO WHAT THE SERVER HAS NOT SEEN**, never to a
  clock or a render. `unconfirmedSales` is the whole of it, and it is what makes
  a snapshot plus a delta add up to the truth no matter how late, how repeated
  or how out of order the server's answer is.
- **THE TILL NEVER WAITS ON THE SERVER TO SHOW WHAT IT JUST DID.** The refresh
  that catches the day's cards up is its own transition, and the till is already
  correct without it.
- **AN "ARE YOU SURE" IS ASKED BEFORE THE TRANSITION, NEVER INSIDE ONE.** Inside,
  it deadlocks and the button silently does nothing.
- **THE TRUCK IS COUNTED DOWN LOCALLY.** A till that re-fetched the balance
  between customers would be unusable at a stall with no signal and no better
  anywhere else. It is safe precisely because one device touches one location.
- **ROUND ONCE, PER LINE.** The sale is the sum of rounded lines, never a
  rounded sum. Getting it backwards is a penny a receipt and a customer who
  stops trusting the number.
- **ONLY CASH IS RECONCILED AGAINST THE TIN.** Counting card takings as a
  shortfall teaches people to ignore the variance.
- **A SALE'S PRICE IS STAMPED, NOT LOOKED UP.** The price list is a suggestion;
  what was charged is the record. This is the same rule that makes
  `retail_prices` effective-dated.
- **VOIDING LEAVES THE STOCK ISSUE.** The goods went over the table. Correct the
  stock with an `inventory` adjustment, not by unwriting a movement.
- **PRICE BELONGS TO (CHANNEL, ITEM), NEVER TO THE ITEM.** If a future slice is
  tempted to add a "default price" on `inventory_items` because most items have
  one channel, that is the migration this pack was shaped to avoid.
- **A PRICE CHANGE IS A NEW ROW.** Never edit one in place to "fix" a price
  going forward — that erases what was charged before, which is what a margin
  report reads. Correcting a *mistake* is what `removePrice` is for.
- **`removePrice` STOPS BEING SAFE THE DAY A SALE REFERENCES THE ROW.** A price
  typed as $80 where the sign said $8 never applied to anything; one a sale was
  made at is a different thing entirely. Slice 1 has to make this refuse, and
  the note is on the function.
- **A price set ahead must not apply today.** `priceOn` ignores future rows on
  purpose. A fold that took the newest row regardless would be the bug.
- **THE HOURS ARE NEVER FOLDED INTO THE MONEY.** Own time counted as nothing
  makes every market look worth going to, and settling that argument is the
  whole reason `retail_market_days` exists.
- **"Nothing recorded" and "cost nothing" are different**, and `marketDayCost`
  returns `unrecorded` so a screen can tell them apart. A farm gate with no fee
  and no journey is a real zero.
- **`location` on a channel is free text and must stay that way.** Pointing it
  at `assets` would claim the business owns the market square. The market TRUCK
  is an asset and a mobile inventory location — a different thing, and slice 1's.
- **A closed channel keeps its prices and its history.** Closing is not
  deleting; the margin report still has to read what was charged there.
- **Setting a price is OWNER, recording a day is MEMBER.** A price is the number
  the whole business turns on and is not something whoever is standing at the
  stall should move. What the pitch cost is a chore recorded by the person who
  stood there — and a record only the owner can enter is a record that stays
  empty.
- **Migration `0172` hand-reordered — tenth check, fifth yes.** Both composite
  FKs pointing at `retail_channels` needed it; the one targeting
  `inventory_items` did not. The rule is *check whether the target is created in
  the same migration*, not *always reorder*.
- **An isolation test cannot cover a pack's ops.** That suite builds fixtures
  under `withSystem` on purpose, so this pack needs BOTH files.

## Open items

- **The checklist does not cover stock on the truck**, because loading happens on
  the day page. So a farm can tick all three, open a day and still find an empty
  till. The day page says so, which is the right place — but it is the one step
  in the chain with no signpost ahead of it.
- **THE TRUCK IS AN ASSETS CONCEPT WITH NO MENTION IN RETAIL** beyond the
  checklist's link. A market truck is an asset with "Things are kept here"
  ticked, which is the right model and still not something anybody would guess.
- **The truck is whichever storage location sorts first**, changeable only by
  hand-editing a `?truck=` query parameter. A farm with a van and a chest
  freezer gets whichever the alphabet picks.
- **THE TILL CANNOT TAKE A CARD YET, and the gap is now one wire.** The farm's
  own Stripe account and a registered card reader both exist as of 2026-08-25
  ([ADR 0015](../decisions/0015-a-connected-account-belongs-to-a-company.md),
  [payments.md](payments.md)), and a real card-present charge has settled on a
  connected account. What is missing is that **the till does not call it**:
  `collectPayment` takes a reader, an amount and a `clientRef` and its only
  caller is a panel on the settings page. Wiring it into `recordSale` should
  pass the till's OWN `client_ref` as the idempotency key rather than minting a
  second one — that is what makes a retry at a stall with no signal safe on both
  sides at once. `retail_sales.payment_method` has recorded the method since
  slice 1 precisely so the settlement slice has something to match against.
- **THE TILL IS NOT OFFLINE YET, and this is no longer the next thing to
  build.** The founder has signal almost all of the time (2026-08-25), so this
  is robustness rather than a blocker and the payment slices went first. What
  exists is the half that could not be added later: a client-minted `client_ref`
  and idempotent posting. What is missing is the half that can — and all three
  parts are needed for a stall with no signal:
  1. **A service worker caching the app shell**, or the till cannot even OPEN
     without a connection and a queue is worthless.
  2. **A durable queue in IndexedDB** rather than localStorage — async, larger,
     far less eviction-prone.
  3. **Flush on `online` and on focus.** Deliberately NOT the Background Sync
     API: it is Chromium-only, and the phone at a market stall is as likely to be
     an iPhone. Depending on it would be building for the wrong browser.
  A service worker changes caching for **every page in the app**, so it is Layer
  0 platform work and wants its own change and an ADR rather than riding along
  with a pack.
- **Cards genuinely cannot work offline**, and the till should say so rather than
  appear to accept one. Authorisation has to reach the network — an OS-level
  fact, not a provider limitation. Today the payment method is simply recorded.
  This is also why the two open items above do not compete: offline is for the
  cash and the stock, and a card was never going to be in it.
- **The till has been driven; the market truck has not left a yard.** Six
  defects came out of one browser session (above) and every one had a passing
  test over it. What no amount of clicking here can test is a phone, one hand,
  a queue of people and no signal.
- ~~**A market day cannot be edited from the UI.**~~ **Closed 2026-08-25** —
  "Close the day" is a full editor for everything except where and when.
  Changing the channel or the date is still remove-and-re-enter.
- **A channel cannot be renamed or re-kinded from the UI** either;
  `updateChannel` is only reached by the close/reopen button.
- ~~**There is no per-day page.**~~ **Closed** — slice 1 built one and starting a
  day now lands on it.
- **A channel is not a cost object.** Lots sync into `dimension_members`;
  channels do not, so "profit per channel" is a page rather than a P&L
  dimension. Same open item `production` has for runs, and the same accounting
  decision behind it.
- **Travel is recorded in money, not miles.** Miles are what a person knows, but
  turning them into money needs a mileage rate — an accounting policy with a tax
  consequence that this pack has no business owning. If a rate ever lands
  somewhere central, this should take miles and use it.
- **Nothing compares two channels' prices side by side yet.**
  `spreadAcrossChannels` is written and tested and has no caller; it wants a
  screen on the item, which belongs with `inventory` rather than here.
- **The truck is whichever storage location the page is pointed at**, defaulting
  to the first one. A farm with two vans needs to pick, and the picker is a
  query parameter rather than a control.
- **A sale with no location issues stock from nowhere.** That is correct for a
  farm-gate sale and a footgun for a market one: the till always passes the
  truck, but an ops caller that forgets silently leaves the truck full. It cost
  a wrong test before it cost anything else.
- **Nothing joins revenue to what the goods cost to produce.** The margin here is
  takings less the cost of standing there; the stock's own cost is stamped on its
  receipt in `inventory`. Putting the two together is the report that would
  finally answer profit per pen end to end.
