# Onboarding

> Getting an existing business into Yosher without overwhelming the person
> doing it: what to load and in what order, what to do about the numbers
> nobody kept, how the books get a start, and how the daily habit stays light
> afterwards. Three pieces, not one wizard. The pilot is the founder's own
> farm, whose money is mixed with personal — which the plan treats as the
> normal case, because most small farms are the same.
> Status: partial — slice 1 (the derived "Getting set up" card) built; the rest is planned below · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->

## The plan (agreed with the founder 2026-09-08)

### Three problems, three pieces

Onboarding is three different problems, and the tool is built as three pieces
rather than one wizard that tries to be all of them:

1. **Standing data.** Who and what exists: companies, bank accounts,
   customers, vendors, kinds of stock, animals, places, paddocks, prices,
   team. No dollars attached. Most of it can be pasted in from a list, and
   much of it makes itself (a new name on an invoice creates the customer; a
   payee on a bank line is a vendor waiting to be confirmed).
2. **The opening position.** The money as of ONE chosen date: bank balances,
   what customers owe, what is owed to vendors, equipment and its book value.
   Everything before that date stays where it was.
3. **The daily habit.** What happens on day two and every day after. This is
   where overwhelm actually lives, and it is mostly solved by the bank feed
   doing the money side and one sentence box doing the farm side.

### The answers every farm will ask for, settled

- **Cost that was never tracked stays BLANK.** Never zero, never a guess. The
  inventory pack already keeps "no cost recorded" apart from zero on every
  screen and reports how many batches are uncosted instead of pretending
  ([inventory.md](inventory.md), slice 3a). A guess would land on a balance
  sheet; a zero says the freezer holds nothing worth anything. From the start
  date, cost arrives by itself: every delivery recorded with a price, every
  bill matched to it.
- **Animals have no cost either, and that is correct.** Raised stock has no
  purchase basis ([livestock.md](livestock.md)). Enter what is there with the
  date each joined the farm; record a purchase price only where one is known.
- **The books do not get history keyed in. They get a start date.** Enter
  balances as of that date and leave the past alone. For Hilltop the proposed
  start is **2026-01-01**, not today: the 2026 return needs the whole year,
  and on a cash-basis farm the bank statement plus the till IS the books, so
  importing the CSVs from January 1 and letting rules and the sweep code them
  gives a cash-basis year without typing one old invoice. Only invoices and
  bills still open on the start date are entered by hand.
- **Customers and vendors mostly make themselves.** A vendor is created when a
  new name is typed on a bill or when the Inbox finds none; a customer when a
  new name is typed on an invoice. A direct-to-consumer farm does not create a
  customer for every dozen eggs sold at market — only for who owes money or
  buys halves. Everyone else is the till.
- **Commingled money is the default case, not an edge case.** Hilltop's bank
  account and expenses are mixed with personal. The plan's answer is in slice
  3 below, and the setup interview's first question is *"Is the farm's money
  in its own account?"*.

### Three gaps the plan has to close, found while grounding it

1. ~~**There is no books-start date anywhere.**~~ — **closed 2026-09-08 by
   slice 4**: `entities.books_start_on`, per company, refused at
   `assertPeriodOpen` and dropped at import (ADR 0035). `accounting_settings`
   still has no settings screen; the day lives on the Close page.
2. ~~**Opening balances exist for bank accounts only**~~ — **closed 2026-09-09
   by slice 5a**: an open invoice or bill is a real document with one flag,
   its issuance dated on the start day against OBE, its lines what the cash
   basis recognises when it is paid (ADR 0037). `isCodableAccount` still
   refuses OBE by hand; the verbs write it.
3. ~~**An asset owned before the start date cannot carry the depreciation
   already taken.**~~ — **closed 2026-09-09 by slice 5b**: two entries dated on
   the day, the cost under `opening_balance` and the depreciation under
   `depreciation` with the `through:` key that marks the old months posted
   (ADR 0038). `postedToDateCents` reads the second and, because the cost is
   deliberately in the first, does not read the cost.

### Slice order

| # | Slice | Status |
| --- | --- | --- |
| 1 | **The derived "Getting set up" card** on the Overview: each switched-on tool says what it is waiting for, rows vanish as the data appears, nothing stored ([ADR 0033](../decisions/0033-a-setup-step-is-a-prerequisite-the-data-proves-missing.md)) | **shipped 2026-09-08** |
| 2 | **Paste anything**: one dialog, reused — paste a list or a spreadsheet, or upload a photo of the herd book; the model proposes rows; the owner sees every row before it saves; duplicates checked against what exists (the CRM "From a note" shape, under the packs' rule that AI never writes a row without a human seeing it first). Targets in order of value: vendors, customers, kinds of stock, animals with tag and dam and sire where known, places, paddocks, prices. Built as a declared extension point, `src/lib/paste-targets/`: a target is FIELDS as data plus the module's own `save` ([ADR 0036](../decisions/0036-a-pasted-list-is-proposed-by-the-model-reviewed-by-a-person-and-written-by-the-modules-own-verb.md)) | **shipped 2026-09-09**, all seven targets: vendors, customers, kinds of stock and animals in `claude/paste-anything`; equipment and buildings (places as a `Things are kept here` column), paddocks and prices in `claude/paste-the-rest` |
| 2b | **Vendors from the bank import**: after an import, "eight payees you have no vendor for" with a checkbox each | **shipped 2026-09-09**: a card on the register, `payeeCandidates` computing the names from the descriptions (no model), `createVendor` writing them; build log in [accounting.md](accounting.md) |
| 3 | **The personal account**: a register kind whose ledger leg is owner's equity rather than a bank asset; personal by default — exclude rules act on arrival, the sweep asks "is this the business's?" first and may answer `PERSONAL`, one button sets aside the rest; setting aside proposes rules; no opening balance, never reconciled; visible to the owner and the accountant, never to staff, in RLS ([ADR 0034](../decisions/0034-a-personal-account-is-a-register-whose-ledger-leg-is-the-owners-equity.md), migrations `0278`–`0279`; the build log is in [accounting.md](accounting.md)) | **shipped 2026-09-08** |
| 4 | **The day the books begin**: `entities.books_start_on`, per company beside the close date (not on `accounting_settings` as first planned — the lock had already moved off it for the same reason); `assertPeriodOpen` refuses anything dated before it; the CSV import and the Plaid sync drop earlier lines and say how many; set on the Close page; the setup card asks for it first ([ADR 0035](../decisions/0035-the-books-begin-on-a-day-and-nothing-is-dated-before-it.md), migration `0280`; build log in [accounting.md](accounting.md)) | **shipped 2026-09-08** |
| 5 | **The opening position**: open invoices and bills as of the start date as real documents with their income or expense leg to OBE, so they age and get paid like any other; equipment with "depreciation already taken through", posted as that asset's own entry; the opening trial balance on one screen with the equity plug visible; an export for the accountant | **shipped 2026-09-09** in two parts: 5a the Opening page, open invoices and bills ([ADR 0037](../decisions/0037-a-document-open-when-the-books-began-is-real-and-its-other-leg-is-opening-balance-equity.md), migration `0281`), the standing with the plug named, the export pointed at; 5b equipment owned before the day, cost and depreciation already taken, on the asset's own page ([ADR 0038](../decisions/0038-an-asset-owned-before-the-books-began-arrives-as-two-entries.md), no migration) |
| 6 | **Tell it things**: one sentence box on the phone — "fed two bags to the broilers", "three chicks dead in pen two", "moved cows to paddock seven" — parsed into proposed record cards, one tap each to confirm, refusing where the packs already refuse | **shipped 2026-09-09**: `src/lib/tell-sources/`, the seventh declared extension point, with livestock as its first filler and the box on the daily round ([ADR 0039](../decisions/0039-a-pack-declares-what-it-can-be-told-in-one-sentence.md)). NOT on the Ask thread as first sketched — Ask answers, this records, and one box doing both is the ambiguity the confirm step exists to remove |
| 7 | **The setup interview**: the health-check machinery turned inward — a conversation that produces the plan for THIS business (which packs, what to load, the start date), opening on "Is the farm's money in its own account?" | **shipped 2026-09-09**: `/dashboard/setup`, running on a digest of what the app can already see and forbidden to ask for any of it, ending in a stored plan whose steps link to real screens ([ADR 0040](../decisions/0040-the-setup-interview-runs-on-what-the-app-can-already-see.md), migrations `0283`–`0284`) |

Two users for all of it: the founder, running a paid Tier 1 onboarding in an
hour instead of a day, and the client, who needs to see what is next without
calling. The Overview's first screen says the modules get switched on "as
part of onboarding, we'll take it from here", and installing a profile is a
superadmin act — so slice 1 serves both.

### Hilltop as the test script

| Step | What goes in | How today |
| --- | --- | --- |
| Profile and settings | Homestead Farm installed; fiscal year January; default basis cash; inventory posting left OFF until the accountant answers [the brief](../briefs/inventory-tax-treatment.md) | Admin page for the install; Business settings for the rest |
| The day the books begin | `2026-01-01`, set before any statement is imported, so 2025 lines are left out with a count | Opening page (or Close), `Books begin on`, exists |
| Open invoices and bills on that day | The half-beef buyers who had not paid by New Year; the December feed bill | Opening page, `Add an open invoice` / `Add an open bill` (slice 5a); each becomes a real document dated on the day against Opening Balance Equity, and the cash basis counts it when paid |
| Equipment already owned | The tractor, the truck, the barn, the freezers — each with what it cost and what the accountant had written off by 2026-01-01 | The asset's own page, `Put it on the books` at the foot of the Depreciation panel (slice 5b); the accountant's figure, not the schedule's guess |
| Companies and banks | One company; a farm-only account opened NOW so the mixed window is bounded (2026-01-01 to the day it opens) | Banking, exists; the mixed window needs slice 3 |
| Places | Garage with three freezers, barn with the walk-in, the two parcels, twenty paddocks | `Paste a list` on the Assets page with `Things are kept here` = Yes for the freezers and the barn (slice 2); the two parcels by hand or Find my parcels; then `Paste a list` on the Land page for the twenty paddocks (slice 2) |
| Vendors and customers | Feed store, hatchery, each butcher, the plant; half-beef buyers only | `Paste a list` on the Vendors and Customers pages (slice 2); or, once the statements are in, `Name the payees` on each register, which turns what the bank wrote into vendors (slice 2b) |
| Kinds of stock | Feed by pound, chicks, broilers, eggs by dozen, cuts as packages, cartons | `Paste a list` on the Inventory page, the unit read per row (slice 2); `Add item` for one |
| Animals | Cattle as individuals with tags; pigs as one lot; layers as one flock; broilers one lot per pen | `Paste a list` on the Livestock page — the herd book typed or photographed, dams and sires placed (slice 2); `Add animals` for one |
| Stock on hand | One count per place, no costs | Counting, exists |
| Prices | Per channel on the market stall | `Paste a list` on the Retail page — the chalkboard typed or photographed (slice 2); the price form for one |
| Bank history | CSVs from 2026-01-01 for every account the farm touched (checking, any card, Square, Venmo, PayPal), coded by rules and the sweep, reconciled | Import wizard, exists; personal lines need slice 3 |

Two things for the accountant rather than the software: cash from market
spent as cash is still income on a cash basis (the till records the sale; the
cash that never reached a bank is a draw), and the truck and four-wheeler used
partly for the farm are a business-use decision, so nothing personal goes on
the farm's asset list until they say so.

## Build log

Newest first. One entry per session/PR that touched this area.

### 2026-09-12 — The box leaves livestock, and learns what time it is (`claude/tell-clock-in`)

Voice slice 1. No migration. The slot itself, rather than a new filler of it —
the `time` source is written up in [time.md](time.md).

**The box moved to What needs you**, which is what slice 6 said a second filler
would mean: *"when a second pack fills the slot the box belongs somewhere both
can be reached from — What needs you — and moving it is a page change, not a
change to any source."* It was precisely that. `tell-box.tsx` did not change,
no source changed, and the two page edits were an import each. A prediction in
an ADR that turns out to cost what it said it would is worth recording as such.

It sits directly under the title and above the list, because this page REPORTS
and the box RECORDS — and half of what somebody records here is what makes a
row below go away.

**`TellCtx` gained `now: Date` and `timezone: string`.** It carried only
`today`, a date string, which is everything a loss or a move needs and nothing
a punch does. The two gates supply them differently, and the difference is the
point:

- `tell-sources/actions.ts` — typed on a screen, so `now` is `new Date()`.
- `device-grants/redeem.ts` — a phone (ADR 0048), where a sentence spoken with
  no signal is queued and arrives hours later. `redeemGrant` runs before the
  body is parsed and can only date the context to the REQUEST, so the route
  calls `atEffectiveTime()` after `clampSpokenAt` has answered, and every use
  of `ctx` below that line is dated to when the sentence happened.

`today` is re-derived from the two rather than kept, so a sentence spoken at
eleven at night and delivered at six the next morning logs against the night
before. The contract now says out loud that an action writing a timestamp must
read `ctx.now` and never a clock.

**The ordering of `tellSources` is now load-bearing in a small way.** Every
action a tenant has goes into ONE tool description (`tellToolFor`), so the
array is the order the model reads the catalogue in. `time` is first because
"clock me in" is the sentence said most often, by the most people.

The registry's own note about what comes next is unchanged: `inventory` (stock
used or counted), `land` (a paddock rested or topped), `production` (a run's
yield) — a file and a line each.

### 2026-09-09 — Slice 7: the setup interview (`claude/the-setup-interview`)

The last slice, and the one whose case had to be argued before it was built:
by the time it came round, six slices had shipped and each answered part of
the same question in its own place, so a seventh screen asking them again
would have been a fifth path to the same settings.
[ADR 0040](../decisions/0040-the-setup-interview-runs-on-what-the-app-can-already-see.md)
opens with that argument. What it adds is the facts the database cannot
hold — the money is mixed, nobody tracked what feed cost, the accountant has
a depreciation schedule, the books should start in January not today — and
the ORDER those change.

`buildDigest` reads the business's own rows (tools on, the start day,
registers and how many are personal, counts, and what the Getting set up card
is currently asking for) and the prompt hands it over with one instruction:
never ask for any of this. That rule is the whole difference from both its
neighbours — the public health check is talking to a stranger and must ask
everything, and a wizard cannot skip what it can see.

It ends in a stored plan of six to ten steps, each linking to a screen chosen
from a fixed list by label, so a step can never point somewhere that does not
exist. **It changes nothing by itself**, and the page says so: a conversation
that quietly set the day the books begin would be the one place in the
product where a misheard sentence rewrote the ledger's lower bound.

Migrations `0283` (the table) and `0284` (RLS, tenant-scoped — its public
cousin is superadmin-only because an anonymous visitor has no tenant). Tests:
`tests/setup-interview.test.ts` (9, pure), `tests/setup-interview-db.test.ts`
(5) and three more in `tests/isolation/interview.test.ts`. Guide:
`workspace/setup.md`.

**Driven on Hilltop (dev), with the real model, and it behaved as designed.**
Four answers took it from the opener to the plan. The second reply read *"1
January 2026 it is, which matches what's already set"* — the digest doing its
one job, and the only proof that matters for it. The third turned "never
tracked what the feed cost me" into *"the cost side of your livestock and
stock stays blank rather than guessed"*, which is the founder's own settled
answer coming back. The plan named the farm account, the two half-beef
buyers, the December feed bill, the accountant's depreciation schedule and
the morning round, in that order, and every step's button resolved to a real
screen (Banking, Opening position, Inventory, Assets, Business settings,
Daily round). It survived a reload, the box was gone, and the Overview's card
links to it.

**One thing to fix when somebody uses it for real:** the model wrote "£500"
where the tenant's currency is dollars. The digest does not carry the
currency symbol, and it should — one line in `buildDigest`.

**With this the plan is finished.** Seven slices, ten pull requests, one day.

### 2026-09-09 — Slice 6: tell it what happened (`claude/tell-it-things`)

Built as a declared extension point with livestock as its first filler; the
entry is in [livestock.md](livestock.md), the reasoning in
[ADR 0039](../decisions/0039-a-pack-declares-what-it-can-be-told-in-one-sentence.md).
What it means for the plan: the DAILY HABIT half opens. Every slice before
this one was about getting a business INTO the app; this is the first about
what happens on day two, which is where the founder said the overwhelm
actually lives. The money side was already answered by the feed and the
rules; this is the farm side.

**It is not on the Ask thread**, as the plan sketched. Ask is a conversation
that answers questions; this records facts. One box doing both would mean
half the sentences change the herd and half do not, which is exactly the
ambiguity the confirm step exists to remove.

### 2026-09-09 — Slice 2b: vendors from a register's payees (`claude/vendors-from-the-bank`)

Built in the accounting module; the entry is in [accounting.md](accounting.md).
What it means for the plan: the standing-data half is now complete both ways
round — paste a list you already have, or let the statements you imported name
the suppliers for you. It is the plan's own answer to *"customers and vendors
mostly make themselves"*, applied to the one moment when they do not: the
conversion, when a year of statements arrives before a single bill has been
entered. **No model call**: the names are computed from the descriptions by
the same tokenizer the rule-learner uses, so this is the cheapest of the
onboarding tools to run and the only one with nothing to get wrong.

### 2026-09-09 — Slice 5b: equipment owned before the day (`claude/the-asset-opening-balance`)

Built in the assets pack; the entry and the decision are in
[assets.md](assets.md) and
[ADR 0038](../decisions/0038-an-asset-owned-before-the-books-began-arrives-as-two-entries.md).
What it means for the plan: **the third and last gap is closed**, and with it
slice 5 as a whole. A business converting now has all three of its opening
balances — the bank (which existed already), what was owed either way (5a),
and what it owns (5b) — each landing on Opening Balance Equity, which the
Opening page names as the plug for the accountant to clear. The Hilltop script
gains a row for the tractor and the barn.

### 2026-09-09 — Slice 5a: the opening position (`claude/the-opening-position`)

Built in the accounting module; the entry, the data model and the decision are
in [accounting.md](accounting.md), the reasoning in
[ADR 0037](../decisions/0037-a-document-open-when-the-books-began-is-real-and-its-other-leg-is-opening-balance-equity.md).
What it means for the plan: the second gap is closed — an invoice or bill
open on the start day is a real document again, dated on the day against
Opening Balance Equity, aging and paid like any other, and counted by the
cash basis when the money moves. The Opening page is now the one screen the
plan asked for: the day, the two lists, and the standing with the plug
named; the setup card's first row lands there. Hilltop's script gains a row.
Gap 3 — depreciation already taken on equipment owned before the day — is
slice 5b, on the asset page.

### 2026-09-09 — Slice 2, the rest: assets, paddocks, prices (`claude/paste-the-rest`)

The three targets the first PR left as open items, one file each in the
pack (`assets/paste/target.ts`, `land/paste/target.ts`,
`retail/paste/target.ts`), a registry line each, a button on each hub, and a
guide section each. Nothing in the slot changed, which is the point of the
slot. What each deliberately is, in its header:

- **Equipment and buildings**, not "places": the plan's places are assets that
  hold stock, so `Things are kept here` is a Yes/No column and the freezers
  and the barn arrive in the same list as the tractor. Cost only when the list
  gives it, in dollars, with no depreciation method.
- **Paddocks**, with the parcel as a choice that is required only once there
  are two — and the first target that is BLOCKED (`describe` returns why) when
  there is nowhere for a paddock to be. Parcels are not a target.
- **Prices**, with the item and the channel as choices by name (nothing is
  created), dollars into cents, per pound where the pack allows it, and NO
  duplicate check, because a price change is a new row by that pack's rule.

Tests: three more in `tests/paste-targets-db.test.ts` (10 total) — the
kinds and cents and the place column; blocked without a parcel, the only
parcel used when blank, required with two, a parcel the list names that is not
one of them held as a hint; blocked without a channel, item and place by
label, two egg prices on two days, per pound refused in the pack's words with
nothing written. Guides: `assets/assets.md`, `land/parcels.md`,
`retail/channels.md`.

**Driven on Hilltop (dev), with the real model.** Three assets read in
three seconds: the freezer came back `Fixture` with `Things are kept here` =
Yes and its note, the tractor with its serial, its model `L3901`, the date and
`18500`, and the barn's "built 2015" was held as `The list said “2015” for
acquired — fill it in, or leave it blank.` rather than invented as a day;
`Add 3 assets` in under two seconds. Three paddocks on Hilltop's one parcel
with `Parcel` left `Not set`, `Add 3 paddocks`. The price list found Hilltop
has two places to sell, so `Where` was required and the two priced rows read
`Where is missing.` until `Farm gate` was picked; `Ground beef` matched the
existing `Ground beef 1 lb packs`, `Whole chicken` matched `Whole broilers`
with the model's own note `Listed as "Whole chicken"`, and `Eggs`, which the
farm does not hold, stayed as a hint and was unticked; `Add 2 prices`.
**Dev fixture now:** Hilltop has assets Chest freezer (garage), North barn and
Kubota L3901 tractor; paddocks North 40, Creek field and Pen 3; and farm-gate
prices on Ground beef 1 lb packs ($8.50/lb) and Whole broilers ($22 each).

### 2026-09-09 — Slice 2: Paste a list (`claude/paste-anything`)

The sixth declared extension point, and the first that runs a model
([ADR 0036](../decisions/0036-a-pasted-list-is-proposed-by-the-model-reviewed-by-a-person-and-written-by-the-modules-own-verb.md);
the pattern's sixth use in [extension-model.md](../extension-model.md)).

**The slot, `src/lib/paste-targets/`.** `types.ts` is the contract: a target
is `describe` (FIELDS — text, number, date, or a choice among labels read live
from the tenant), `duplicates` (the existing thing a row looks like, by name or
tag) and `save` (the module's own verb, refusing with the module's own words
via `PasteRefusal`), plus an optional `afterSave` for what needs the whole
batch. `shape.ts` is pure and shared with the dialog: the model's tool built
from the fields (every property nullable, every key required, a choice NEVER
an enum so the list's own words survive), the loose Zod boundary, and
`resolveRows`, which judges each cell and keeps what it could not place as a
HINT beside the empty cell rather than guessing or dropping the row. `model.ts`
is the one network call — text and/or a photo or PDF, normalised through
`vision-image`, adaptive thinking, injectable — with an in-process per-tenant
cooldown. `resolve.ts` runs a target: describe under RLS, call between
transactions, duplicates under RLS; then save, every row checked against the
fields BEFORE any is written, all rows or none, the refusing row named, audited
as `paste.rows_saved` with counts only. `actions.ts` are the two server
actions, `proposePasteAction(FormData)` and `savePasteAction`, the accountant
role refused at the door.

**The dialog, `src/components/app/paste-list-button.tsx`.** One component for
every target: `Paste a list` → a box and an optional photo → `Read it` → a
table on a wide screen and cards on a phone, one checkbox per row, an input per
field drawn from its kind, `Not set` on every choice, and under a row what
needs saying: `Already here as “Tractor Supply”. Unticked — tick it to add
another.`, `The list said “boxes” for counted in — pick one, or leave it
blank.`, `Counted in is missing.` → `Add 12 vendors`. The button sits beside
each page's own add button and is gated the way that button is.

**Four targets.** `accounting/paste/targets.ts`: vendors and customers, five
fields (name, email, phone, address, notes — terms and the default account
deliberately not, a pasted list does not carry them), duplicates by name,
saved through `createVendor` / `createCustomer` so a party is born with each.
`inventory/paste/target.ts`: kinds of stock — name, kind (the pack's suggested
kinds plus those in use), counted-in unit (the pack's `UNITS`, required),
bought in, how many each, kept, notes; no quantity and no cost on purpose.
`livestock/paste/target.ts`: animals — name or tag, what that is, species (the
industry's list plus those in use, or a typed word when there is neither),
sex, breed, born, arrived, dam, sire, head, counted under; one named animal
goes through `startIndividual` (a digits-only name becomes a visual tag), a row
with head > 1 through `createLivestockLot`; twenty rows saying "Beef cattle"
make one item because each row's lookup finds what the last one made; parents
are the second pass, a dam in the same list or already on the farm, and one
that is neither is a refusal that names the row.

**Tests.** `tests/paste-targets.test.ts` (8, pure): the tool, the boundary,
every kind of cell, the cap, `checkRow`, labels, exact-never-nearest matching.
`tests/paste-targets-db.test.ts` (7, db): a target exists only when its module
is on; vendors proposed, saved, party born, audit counts, second reading
flags what is here; a row without a name stops the batch before anything is
written; customers; kinds of stock with the pack's choices, a hint holding the
save, staff refused in the pack's words; animals as individuals and a group,
one stock line for three spellings, a dam three rows up, a tag told from a
name, and a dam nobody has refusing the batch. Guides: `vendors.md`,
`customers.md`, `inventory/items.md`, `livestock/lots.md`.

**Driven on Hilltop (dev), with the real model.** A four-line vendor list
read in six seconds: the one name the farm already had came back unticked
with `Already here as “Pleasant Valley Feed Mill”`, the other three landed in
the right columns (an email, a phone in brackets, an address with a comma in
it, a note after a dash) and `Add 3 vendors` added them. Blanking a name held
the button with `Name is missing.` and retyping it released it. Two customers
the same. A four-line herd book — a cow, her heifer with `dam Clover`, a steer
by tag, forty chicks — came back as Name/Visual tag, Cattle/Poultry,
Female/Male, Angus, the dates in the right columns, `Head` 40 on the group and
`Beef cattle` / `Broiler chicks` as the lines; `Add 4 animals` took five
seconds and Meadow's page shows Clover as her dam. On a phone the review is a
card per row with every field named. One thing it found that was not the
code: the first save's response was lost to a browser network-change event
(`ERR_NETWORK_CHANGED` in the console) while the rows had committed, which is
exactly the case the advisory duplicate check exists for — the second reading
would have unticked them. **Dev fixture now:** Hilltop has vendors Orscheln
Farm & Home, Hilltop Hatchery, Doc Reynolds Veterinary and Boone County Co-op,
customers Maple Street Market and The Hendersons, and animals Clover, Meadow
(dam Clover), 840 0042 and the group Spring broilers 2026 under a new
`Broiler chicks` line.

**Not in this slice.** Places, paddocks and prices — one target file and a
registry line each, and a button on their page. Slice 2b, vendors proposed
from the bank import's payees, is unchanged.

### 2026-09-08 — Slice 4: the day the books begin (`claude/the-books-begin`)

Built in the accounting module; the entry, the data model and the decision are
in [accounting.md](accounting.md), the reasoning in
[ADR 0035](../decisions/0035-the-books-begin-on-a-day-and-nothing-is-dated-before-it.md).
What it means for the plan: the first of the three gaps below is closed, and
the Hilltop script gains its first step — on the Close page, `Books begin on`
→ `2026-01-01` — before any statement is imported, so the 2025 lines on the
personal account's statements are left out with a count rather than sorted by
hand. The setup card now opens with `Say when your books begin`. Slice 5 (the
opening position) has a day to stand on.

### 2026-09-08 — Slice 3: the personal account (`claude/the-mixed-account`)

Built in the accounting module, where the register lives; the full entry, the
data model and the decisions are in [accounting.md](accounting.md) and the
reasoning in [ADR 0034](../decisions/0034-a-personal-account-is-a-register-whose-ledger-leg-is-the-owners-equity.md).
What it means for the plan: **Hilltop can now be loaded.** The mixed account is
added as `Personal (mixed)`, its statements imported whole from
2026-01-01, the business lines posted (each one money the owner put in), and
the rest set aside as personal — by rule on arrival, by the sweep's inverted
prior, or by one button for whatever is left. The setup card's first row now
says a personal account counts as the register it asks for. Slice 4 (the
books-start date) is the next blocker: nothing yet refuses a 2025 line that
wanders into an import.

### 2026-09-08 — Slice 1: Getting set up, derived (`claude/getting-set-up`)

**The card.** Owners see `Getting set up` on the Overview, above `Your
modules`, while any switched-on tool is waiting for something: one row per
prerequisite, with the tool's name, the ask, a line on what it is for, a
`Guide` link to the guide for the screen where it is done, and a button that
names the act and opens that screen. A row goes away when the thing exists.
When nothing is left the card is not rendered, and never returns. Staff and
accountants see nothing — every step is an owner's act.

**The seam.** `src/lib/setup-sources/` is `attention-sources` with the dates
and the person taken out: `types.ts` (the contract, imports no module),
`registry.ts` (the composition root, the only file that names modules),
`resolve.ts` (gates on enabled modules, runs sources concurrently behind a
four-second guard, REPORTS a failure rather than folding it). `has-any.ts`
is the one query every step asks — `LIMIT 1` on the tenant index, never a
COUNT. eslint.config.mjs bans modules from the registry and resolver the way
it does for attention.

**The rule, and it is the slice** ([ADR 0033](../decisions/0033-a-setup-step-is-a-prerequisite-the-data-proves-missing.md)):
a step is a PREREQUISITE the data proves missing, asked as *ever*, not *now*.
That is what lets the card have no dismiss button. "Invite your team" failed
the test — a solo operator would see it forever — and so did "record your
first sale"; nothing that failed it is on the card.

**What each tool contributes**, in card order:

| Section | Step | Appears while |
| --- | --- | --- |
| Accounting | Add your bank account | no `bank_accounts` row has ever existed |
| Accounting | Bring in your transactions | an account exists and no `bank_transactions` row ever has — points at the one account's import page, or at Banking when there are several |
| Assets | Add your equipment and buildings | no `assets` row |
| Inventory | Add what you hold | no `inventory_items` row |
| Inventory | Add somewhere to keep it | an asset exists and none has `is_storage_location` — waits for the first asset so it never stands beside the assets step asking about the same page |
| Livestock | Add your animals | no `livestock_lots` row (a named animal is a lot of one) |
| Land | Add your ground | no `land_parcels` row |
| Retail | Add where you sell | no `retail_channels` row |
| Retail | Set your prices | a channel exists and no `retail_prices` row — points at the one channel's page, or at Retail |
| CRM | Add the people you work with | no `parties` row — so a customer typed onto an invoice clears it too, which is right |
| Mail | Set up your mailboxes | no `mailboxes` row |

Not contributing, each deliberately: `production` (a run needs animals, which
is livestock's step), `documents` and `scheduling` (their first rows are
provisioned), `work`, `marketing` (the brand kit is layer 0 and a site is
optional). Each is an open item below with what its step would be if one is
ever wanted.

**Guide links are static slugs, checked by a test.** The Overview is not
traced to read `docs/help` at request time (`outputFileTracingIncludes` in
next.config.ts covers `/dashboard/guides` and `/api/help`), so the card must
not go looking. Each source declares the slug of the guide for the screen it
points at, and `tests/setup-sources-db.test.ts` asserts every slug it sees is
a file. A renamed guide fails that test rather than a link on the first page.

**The words avoid the packs' renameable labels.** `item`, `channel`, `parcel`
and `zone` are vocabulary a profile may rename in the guides; the card is
plain text on the Overview and does not run that machinery, so the titles say
"what you hold", "where you sell", "your ground".

**Tests.** `tests/setup-sources.test.ts` (pure): order, sections, a throwing
source reported, a timeout reported, one failure not stopping the rest, an
empty list with a failure NOT complete. `tests/setup-sources-db.test.ts`
(db-backed, as an owner through real RLS): a fresh tenant with eight modules
on is asked for exactly eight things in card order; each clears on the first
record and raises its second-order step where there is one; a switched-off
tool contributes nothing and is not a failure; every guide slug is a file.

**Guide.** `docs/help/workspace/getting-around.md` gains the card, every row,
every button, the two messages, and the owners-only line.
`docs/extension-model.md` records the fifth use of a declared extension point.

## Data model

The card stores nothing and may not ([ADR 0033](../decisions/0033-a-setup-step-is-a-prerequisite-the-data-proves-missing.md)).
The interview stores its own conversation, and that is the only table this
area owns.

| Table | Purpose | Notes |
| --- | --- | --- |
| — | The Getting set up card | Every step is a `LIMIT 1` over a module's own table, under the caller's RLS context. Derived, never stored |
| `setup_interviews` | The setup interview and the plan it wrote ([ADR 0040](../decisions/0040-the-setup-interview-runs-on-what-the-app-can-already-see.md), `0283`–`0284`) | Tenant-scoped RLS, unlike its public cousin `interview_sessions`, which is superadmin-only because a visitor has no tenant. One active per tenant by partial unique index. `plan` is written once, when the conversation ends |

## Key files & seams

- `src/lib/setup-sources/types.ts` — the contract. **Read the header before
  adding a step**: prerequisite not nudge, ever not now, caller's `tx` only
- `src/lib/setup-sources/registry.ts` — the composition root and the card's
  order, with the reasoning for the order
- `src/lib/setup-sources/resolve.ts` — gating, the timeout, the failure report
- `src/lib/setup-sources/has-any.ts` — the one query
- `src/modules/{accounting,crm,email}/setup/source.ts`,
  `src/packs/{assets,inventory,livestock,land,retail}/setup/source.ts` — what
  each tool is waiting for, and in each header what it deliberately is not
- `src/app/dashboard/getting-set-up.tsx` — the card; `page.tsx` renders it
  above the tiles, owners only
- `tests/setup-sources.test.ts` · `tests/setup-sources-db.test.ts`
- `docs/help/workspace/getting-around.md` — the guide, `## Getting set up`
- `src/lib/paste-targets/types.ts` — the paste-target contract. **Read the
  header before adding a target**: data plus the module's verb, the model
  never writes, choices by label never nearest, all rows or none
- `src/lib/paste-targets/shape.ts` — pure: the tool from the fields, the
  boundary, `resolveRows`, `checkRow`; shared with the dialog
- `src/lib/paste-targets/model.ts` · `resolve.ts` · `actions.ts` — the one
  network call, the two halves, the two server actions
- `src/lib/paste-targets/registry.ts` — the composition root; add a target here
- `src/modules/accounting/paste/targets.ts`,
  `src/packs/{inventory,livestock,assets,land,retail}/paste/target.ts` — the
  fillers, each header saying what the target deliberately does not take
- `src/components/app/paste-list-button.tsx` — the dialog; hosted beside each
  page's own add button
- `tests/paste-targets.test.ts` · `tests/paste-targets-db.test.ts`
- `src/modules/accounting/core/opening.ts` — how an open document posts (the
  day, the refusals, OBE); `opening/position.ts` — the two verbs and the
  page's read; `opening/actions.ts`; `src/app/dashboard/m/accounting/opening/`
  — the page and its two dialogs; `tests/opening-position.test.ts`;
  `docs/help/accounting/opening.md`
- `src/lib/setup-interview/prompt.ts` — pure: the digest, the words, the two
  tools, `PLAN_SCREENS` (the only screens a plan step may point at) and the
  boundaries; `session.ts` — the digest built from the tenant's rows, the two
  model calls, one turn; `actions.ts` — owners only;
  `src/app/dashboard/setup/` — the page and the chat;
  `tests/setup-interview.test.ts` · `tests/setup-interview-db.test.ts` ·
  `tests/isolation/interview.test.ts`; `docs/help/workspace/setup.md`
- `src/lib/tell-sources/types.ts` — the tell contract. **Read the header
  before adding a source**: actions as data plus the pack's verb, the model
  never writes, choices by label never nearest, all the cards or none
- `src/lib/tell-sources/shape.ts` — pure: the tool from every action, the
  boundary, `resolveEntries`, `checkEntry`; shared with the box
- `src/lib/tell-sources/{model,registry,resolve,actions}.ts`;
  `src/packs/livestock/tell/source.ts` — the first filler, its header saying
  what it deliberately will not take; `src/components/app/tell-box.tsx`
- `tests/tell-sources.test.ts` · `tests/tell-sources-db.test.ts`
- `src/modules/accounting/banking/rules-learn.ts` — `payeeCandidates`, pure:
  the payees a statement names; `banking/payees.ts` — the proposal and the
  write; the card in `[id]/register-controls.tsx`;
  `tests/banking-payees-db.test.ts`
- `src/packs/assets/depreciation-ops.ts` — `getAssetOpeningState` (the four
  prerequisites, each named) and `recordAssetOpening` (the two entries);
  `vocabulary.ts`'s `openingBlockedMessage`, said by both the page and the
  action; the section at the foot of `components/depreciation-panel.tsx`;
  `tests/asset-opening-db.test.ts`; `docs/help/assets/asset.md`

## Decisions & gotchas

- **Derived, never stored; prerequisite, never nudge; ever, not now.**
  [ADR 0033](../decisions/0033-a-setup-step-is-a-prerequisite-the-data-proves-missing.md)
  has the alternatives and the costs. The one that will be asked about first:
  a business that retires its only bank account is not asked again.
- **Not attention items.** A step has no date and no person, and putting it in
  the morning digest would email "add your bank account" to staff who cannot,
  every day, until muted. The card lives on the Overview only.
- **Owners only, decided in the card, not in the sources.** A source's context
  is the tenant and nothing else; there is no role for it to reason with.
- **A failure renders as a warning, not as nothing.** An absent card must mean
  set up. If `Inventory could not be checked just now` appears with no rows
  under it, that is the design working.
- **`inventory.place` waits for the first asset** so two rows never point at
  the same page with the same ask. The cost: a tenant with Inventory on and no
  assets is asked for equipment before it is asked for a freezer, which is the
  order the assets step already imposes.
- **The transactions step is the one that is almost advice.** Accounting can
  write an invoice with no register at all. It is a step because a register
  with nothing in it has not started, and because the feed is the single most
  valuable thing a converting business can switch on. It clears on the first
  row of any kind and never returns.
- **Static guide slugs.** See the build log; the reason is tracing. If a guide
  is renamed, the db-backed test fails and names the slug.
- **A paste target is data plus the module's verb, and the model never
  writes** ([ADR 0036](../decisions/0036-a-pasted-list-is-proposed-by-the-model-reviewed-by-a-person-and-written-by-the-modules-own-verb.md)).
  The consequences worth knowing before the next target: a choice is shown to
  the model as labels and resolved by exact label, so labels are names and
  nothing more (they are what leaves the tenant); a cell that could not be
  placed is a hint, not a guess; a save is all rows or none, the refusing row
  named; and the refusal is the module's own, so a pack that lets only an owner
  create a thing refuses staff here too, in its words.
- **The paste cooldown is in-process.** Ten seconds per tenant, in a map;
  it stops a double submit from two tabs on one server and nothing more. The
  other extractors keep theirs on a settings row; the platform has none, and
  the dialog's disabled button is the real guard.

## Open items

- **THE SLICE ORDER IS FINISHED.** 3 and 4 shipped 2026-09-08; 2, 2b, 5, 6
  and 7 on 2026-09-09. All three of the plan's gaps are closed, a business
  can be converted end to end, the daily habit has its first tool, and the
  interview writes the plan for doing it. What follows is no longer a
  roadmap: it is whatever driving a real conversion turns up.
- **Nothing here has been used on a real client yet.** Every slice was driven
  on Hilltop (dev) as it was built, and the dossier entries say exactly what
  was clicked, but a conversion done end to end by somebody who did not build
  it is the test none of this has had.
- **The digest does not carry the currency symbol**, and the interview wrote
  "£500" for a dollar tenant on its first real run. One line in
  `buildDigest`, and the first thing to fix in this area.
- **The interview's plan goes stale on purpose.** It is what somebody agreed
  to on a day; the Getting set up card stays the live answer to what is
  missing. Switching a tool on after the plan is written does not change the
  plan, and going through it again is one button.
- **The tell box has one filler.** Livestock. Three packs could fill the slot
  next — inventory (stock used or counted), land (a paddock rested), and
  production (a run's yield) — and each is one file plus a registry line. The
  box moves to What needs you when the second one exists; while there is one,
  it belongs on that pack's own daily round.
- **Only money out becomes a vendor.** Slice 2b deliberately leaves the
  deposits alone: a payee you pay is a supplier, and a deposit's description
  is usually the bank's word for a transfer rather than anybody's name.
  Customers from the feed would be a different proposal with a different
  rule, and nothing is asking for it yet.
- **An asset's opening balance can be recorded once.** The cost entry's key
  is one per asset and the ledger's unique index is not freed by a void, so a
  correction is a journal entry (ADR 0038). Said in those words by the page
  and by the action.
- **The Opening page shows one company at a time**, like Close. A tenant
  with several companies switches with the pills; there is no "all
  companies" position, because an opening balance is a fact about one set of
  books.
- **Slice 2b, vendors from the bank import's payees**, is still planned and is
  a different shape: nothing is pasted, the rows come from `bank_transactions`.
- **Parcels are not pasted.** Two deeds are typed or found from the county;
  a tenant with twenty parcels would want a target, and it is one file.
- **Feed rows that arrived before the day was set are not swept.** They stay
  in the queue and are refused one by one at posting (ADR 0035); a "left out
  by the start date" sweep would be a delete of imported rows, which is a
  different decision.
- **A deposit into a personal account is a draw, and is not yet a deposit.**
  The account is left out of the deposit picker until a deposit can say so
  (ADR 0034); recording the receipt on the register itself works.
- **Steps that could exist and do not**, if a tenant ever needs them:
  `production` — a processing plant recorded as a vendor before its first bill
  can be matched; `marketing` — a site started; `scheduling` — a calendar
  shared beyond the provisioned one. Each would be one `setup/source.ts` and a
  registry line.
- **The card does not reach the founder's admin view.** A concierge onboarding
  would want the same list on `/admin/tenants/[id]` — "what is this tenant
  still missing" — read under `requireSuperAdmin()` and `withSystem`. Not
  built; the sources take a `tx`, so it is a page, not a change to them.
- **No retry.** A failed source is stated; nothing re-asks until the next load.
- **The accountant's brief on inventory treatment is still unanswered**
  ([docs/briefs/inventory-tax-treatment.md](../briefs/inventory-tax-treatment.md)),
  and the Hilltop script keeps inventory posting off until it is.
