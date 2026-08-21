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

| # | Slice | State |
| --- | --- | --- |
| **0** | **Channels + per-item-per-channel price lists + the market day record** | **shipped 2026-08-20** |
| 1 | Market POS: offline-first, cash, draw from the truck location, sold-out capture, day-end reconciliation | next |
| 2 | Payment adapter — read (settlements, fees → books) | |
| 3 | Commitments: reservations, deposits, hanging-weight final invoice, fulfilment point — needs `production` | |
| 4 | Farm store, attended and count-derived | |
| 5 | Payment adapter — write (drive the terminal) | |
| 6 | Online orders + pickup windows | |
| 7 | Shipping (costed), then wholesale (eligibility becomes load-bearing) | |

## Build log

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
| `retail_prices` | **What one item costs in one channel, from one day** | Composite FKs to the channel (CASCADE) and the item. UNIQUE on (channel, item, `effective_from`) — two prices starting the same morning is a question, not a change. No `effective_to`. CHECK: not negative |
| `retail_market_days` | **A day of selling, and what it cost to stand there** | Composite FK to the channel. `crew_size` and `hours` are recorded and **not costed**. Deliberately NOT unique on (channel, day): a morning market and an evening one are two days of standing there |

**Everything else lives in a pack this one requires:**

| The question | Answered by |
| --- | --- |
| What is a price a price OF? | `inventory_items` |
| What is actually on the truck? | `inventory_movements` — the truck is a mobile location, which is why there is no distributed-inventory problem |
| What did the thing cost to make? | `production`, through the output lot's stamped receipt |

**Not columns, deliberately** — each would have no reader today: sales and sale
lines (slice 1), stockouts (slice 1 — they belong with the till they are the
absence of), settlements and fees (slice 2), commitments and deposits (slice 3),
and **channel eligibility** — the stamp comes off a production run and
`production` does not stamp one until ITS slice 1, so the column would be a
guard with nothing to read.

## Key files & seams

- `src/packs/retail/core/pricing.ts` — pure. **The price timeline and the day's
  cost.** Read this before changing anything about what a price means
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

- **Nothing sells anything yet, and that is the slice line rather than a gap.**
  Slice 0 is channels, prices and what a day cost. The till, the truck draw,
  stockouts and day-end reconciliation are slice 1, and profit per market day is
  a subtraction that needs them.
- **A market day cannot be edited from the UI.** `updateMarketDay` exists, is
  tested, and has no caller — only remove-and-re-enter. The same shape
  `inventory`'s four callerless actions had.
- **A channel cannot be renamed or re-kinded from the UI** either;
  `updateChannel` is only reached by the close/reopen button.
- **There is no per-day page.** A market day is a row in two tables and nothing
  more, so the home page's date column is plain text. That changes the moment
  sales hang off a day.
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
- **No stockout capture**, which the design calls the only route by which a
  lost-revenue event ever enters the system. Slice 1, with the till.
