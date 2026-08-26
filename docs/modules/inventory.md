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
| **3b** | **Perpetual posting, GRNI, and matching a bill to the deliveries it pays for** | **shipped 2026-08-21** |
| **3c** | **The screen: matching, the GRNI reconciliation, and the switch that turns posting on** | **shipped 2026-08-22** |
| **3d** | **Cost-adjustment corrections** — `inventory_cost_adjustments`, ADR 0012 §A.4 | **shipped 2026-08-22** |
| **3d ii** | **Recording a tax decision** — `inventory_tax_treatments`, resolution, screen | **shipped 2026-08-22** |
| **3d iii** | **The lens** — `paid` applies on a cash-basis report, through a seam core owns and a pack fills | **shipped 2026-08-22** |
| 3d iv | `billed`, `sold` and the two `later_of` rules | each needs different machinery — see `packs/inventory/basis-lens.ts` |
| 4 | Commitments (pre-sold halves) — needs `production` and `retail` | |
| 5 | Reorder points, capacity warnings — needs history | |
| **6a** | **A package is a unit** — the `pkg` stocking unit, and an item you can edit | **shipped 2026-08-25** |
| **6b** | **What a batch weighs** — `inventory_movements.weight_lb`, a per-lot average, production passes the weight it already has | **shipped 2026-08-25** |
| **6c** | **Selling by the pound** — `retail`'s half, see [retail.md](retail.md) slice 8 | **shipped 2026-08-25** |

## Build log

### 2026-08-25 — A filter bar that was half built (`claude/a-filter-bar-that-was-half-built`)

The founder's ask, alongside the packages one: *"there should also me a filter
tool to filter just chicken inventory or just animals or just feed etc."*

**MOST OF IT SHIPPED IN SLICE 0 AND THE CONTROL NEVER DID.** `listItems` has
taken a `kind` filter since the first commit, `InventoryModule` has read
`?kind=` and `?archived=1` since the first commit, and `listKindsInUse` — which
runs on every page load — carries the doc comment *"for the filter bar"*. Its
result went to the add-item form as autocomplete suggestions and nowhere else.
The read layer was designed, built and tested; nothing rendered a control.

**"JUST FEED" AND "JUST ANIMALS" ARE A KIND. "JUST CHICKEN" IS NOT**, and that
is what decided the shape. Chicken feed, live broilers and packaged chicken are
three kinds and one enterprise, so a kind filter structurally cannot answer the
founder's first example. A name search can, and does on the real data: "broiler"
returns Broiler chicks (livestock), Broilers (meat) and Whole broilers (meat).

- **Chips for the kinds, a form for the search** — the split between a closed
  choice and an open one. A tap is one round trip; typing is not, so the box
  submits on Enter or the button rather than on every keystroke. A farm holds
  forty items and this does not need to be clever.
- **Counts on the chips are free**, because `listKindsInUse` already groups, and
  they turn "is there anything under Medicine" into a question the bar has
  already answered.
- **`%` AND `_` ARE ESCAPED.** Unescaped, a search box is a way to match every
  row by typing one key — and `_` is the worse of the two, because it matches any
  single character and nothing about the result looks wrong. There is a test.
- **NAME ONLY, deliberately.** Matching notes too would make a search for "beef"
  return the bag of feed whose note says it is for the beef herd: a different
  question wearing the same word.
- **THE FILTER LIVES IN THE URL.** The list is server-rendered from it, so a
  filtered view is a link somebody can bookmark or send, and there is no
  client-side second filter to disagree with the server's.
- **"All" is a chip, not the absence of one.** A bar whose unfiltered state has
  nothing selected gives somebody no way to see that they ARE filtered except by
  noticing what is missing.

**"NOTHING MATCHES" AND "NOTHING TRACKED YET" ARE DIFFERENT FACTS, and showing
the second for the first is how a filter convinces somebody their data is gone.**
The empty state told an owner with forty items and a stale search box to go and
add their first one. It now says which filter emptied the list and offers to
clear it — and the bar itself is hidden entirely on a farm that holds nothing,
because a filter over an empty list is furniture.

**Two defects came out of clicking it, and neither had a failing test over it:**

1. **Enter did not submit.** The form is correctly structured — one text input,
   one `type="submit"` button — and implicit submission is a browser default this
   was relying on. Enter is handled explicitly now, through the same function as
   the button so the two cannot diverge. A search box that silently ignores the
   key somebody just pressed reads as a broken app.
2. **"Find a item by name".** `itemWord` comes from the installed profile, so any
   copy with an article in front of it is a grammar bug waiting for a profile
   whose word begins with a vowel. The label has no article now.

Driven on the dev branch's Hilltop Farm: the Livestock chip narrowing 8 rows to
2, "broiler" returning 3 across two kinds, kind and search composing to 1, a
no-match landing on the right empty state, and Show/Hide retired keeping the
search. No migration, no schema change.

### 2026-08-25 — What a batch weighs (`claude/what-a-batch-weighs`)

Slice 6b, and [ADR 0016](../decisions/0016-a-catch-weight-item-is-stocked-in-packages.md).
6a settled that meat is stocked in packages; this records what those packages
weigh, so the app can say roughly what a freezer holds in pounds and `retail`
can eventually price by the pound.

**THE ANSWER IS `cost_cents`'s ANSWER, AND THAT IS THE WHOLE DESIGN.**
`inventory_movements.weight_lb` is a TOTAL on the event — 47.5 lb for a receipt
of 38 packages, exactly as $340 for 12 bags — and the rate is a fold at read
time. `core/weight.ts` is `averageCostRate` with a different numerator, down to
skipping what arrived without a figure, and the two should stay recognisable as
one idea.

**PER LOT, NOT PER ITEM, AND THIS IS A DELIBERATE DIVERGENCE FROM COST.**
`averageCostRate` folds at the ITEM level and this dossier's open items already
record what that costs: *"lot A at $1.00 and lot B at $2.00 both issue at $1.50,
so A goes negative and B stays high."* A run packed in 1 lb bags and a run packed
in 2 lb bags are different batches and one figure across the item is true of
neither. The receipt movement carries `lot_id` already, so per-lot cost nothing
extra — there was no reason to repeat the mistake.

**TWO DESIGNS WERE WRITTEN AND THROWN AWAY FIRST, and both failed the same
test** — *does any figure here have to agree with another figure forever?*

1. **`inventory_lots.weight_lb`.** A batch can be received into more than once,
   so a stored batch total is a maintained number, which is the shape ADR 0007
   and this pack's own *"valuation is not a column and never will be"* exist to
   refuse.
2. **A signed pound ledger** — weight on every movement, pounds on hand as the
   fold. Tidier, and it breaks on the first transfer: a transfer carries no
   weight, so the freezer would still read 47.5 lb and the truck 0.0 lb after
   loading half of it. Fixing that means every transfer, adjustment and count
   line derives a weight, which is the invented factor `core/units.ts` refuses,
   spread across five writers instead of none.

**ONLY AN INBOUND MOVEMENT MAY CARRY ONE, and it is a CHECK rather than a
convention.** `core/weight.ts` folds only inbound rows, so a weight on an
outbound one would be read by nothing while looking exactly like a number that
meant something. `inventory_movements_weight_inbound` enforces it in the table
every pack writes to; `recordMovement` refuses it too, so the failure is a
sentence rather than a constraint violation somebody gets as a 500.

**THE SEAM WAS ALREADY THERE AND HAD BEEN THROWING THE DATA AWAY.**
`production_run_outputs` has recorded `quantity` AND `weight_lb` since it was
written — *"38 packages, 47.5 lb"* is what a plant reports — and `completeRun`
passed the count to `receiveStock` and dropped the weight, because inventory had
nowhere to put it. **One argument on one call and the whole thing wires itself
up**, with no new data entry anywhere. There is a test that drives the loop end
to end: a run output with a weight lands as stock whose average package weight
reads 1.25 lb.

`output.weightLb` and NOT the derived `outputWeightLb(output, item)`: the derived
form falls back to converting the quantity for a mass-stocked item, which
inventory can work out for itself and which would only put a redundant second
copy of the quantity in the ledger.

**UNWEIGHED IS NOT ZERO**, the same rule as UNVALUED and with the same
discriminator shape (`hasRecordedWeight`, beside `hasRecordedCost`). A batch
nobody weighed is ABSENT from `weightRatesForItems`'s maps rather than present at
zero, and every screen shows nothing rather than "0 lb".

**THE FIGURE SAYS "ABOUT", AND THE FLAG THAT MAKES IT SAY SO IS IN THE RETURN
TYPE.** `WeightReading.approximate` is true whenever the number came from an
average, so a caller cannot drop the caveat by forgetting it. **Pounds on hand
will never equal the pounds actually sold and never need to** — one is a shelf
estimate, the other a transaction record. Written down here because it is
exactly the kind of gap somebody arrives to "fix" in six months.

Three screens read it, and the same rule decides all three: **show it only when
it says something the quantity does not.** For an item stocked by mass
`weightOf` returns the quantity converted — exact, and "840 lb" under "840
pounds" is one number twice — so `approximate` doubles as the display guard.

- The item's **On hand** card, under the balance.
- Each **batch** row, which is where the per-lot rate earns itself.
- The **truck load** dialog, per line, live as somebody types a count. A truck
  is loaded in packages and the one thing a count of packages cannot answer is
  whether the van will take it.

**Somebody has to be able to enter one by hand, or the whole feature is
reachable only through a production run.** The receipt form has a weight box —
hidden for a mass-stocked item, because the quantity is already the weight and
asking twice invites two numbers that disagree.

Migration `0212`, two CHECKs, no new table and therefore no RLS migration and no
new isolation coverage. Applied to dev and to production before the merge, per
[ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md).

### 2026-08-25 — A package is a unit, and an item you can edit (`claude/a-package-is-a-unit`)

Slice 6a, and the first of three. The founder's ask: *"meat will be a package.
that package is sometimes just sold by the package or by the weight. when
loading the truck, for retail we will always be loading packages. not 10 lbs of
beef."*

**NEITHER EXISTING UNIT COULD SAY THAT, AND BOTH WERE DEFENSIBLE.** Stock ground
beef in `lb` and the on-hand figure and the price per pound are right, while
loading the truck is *"43.2 lb"* — not an instruction anybody can follow — and
counting the freezer is counting packages and multiplying. Stock it in `each` and
the truck, the count and the price per package are all right, and it can never be
sold by weight or answer how many pounds are in the freezer. **The item genuinely
has two measures**, which is the case `units.ts` already names as the third kind
of conversion and refuses.

**THE REFUSAL STAYS. A PACKAGE WEIGHT IS NOT A CONVERSION, IT IS A
MEASUREMENT** — so it gets recorded rather than computed, and that is slice 6b.
This slice only settles which of the two measures the BALANCE is kept in, and the
answer is the package: it is what gets loaded, counted, handed over and put back,
and it is a whole number somebody can check by looking. Pounds are a property of
it.

- **`pkg` is one entry in `UNITS` and no other code at all.** `moveStockToTruck`
  already moves "quantity in the item's stocking unit", so **the truck loads
  packages the day an item is stocked in packages** with nothing changed in
  `retail`. Physical counts stop asking anybody to weigh a freezer, by the same
  mechanism. That is the evidence the shape is right rather than bolted on.
- **THREE COUNT UNITS NOW SHARE `perBase: 1`** — `each`, `head` and `pkg` — so
  `convert(70, "head", "pkg")` returns 70 and means nothing. Already true of
  `each`/`head`; a third makes it worth asserting, so there is a test that pins
  the nonsense down rather than a comment hoping nobody hits it. It stays
  harmless only because a conversion is offered between ONE item's own purchase
  and stocking units, which a person chose as a pair.
- **The meat sentence is in the copy BEFORE the picker, not in a hint after
  it.** It is meant to decide the choice, not to explain one already made.

**`updateItem` AND `archiveItem` FINALLY HAVE A CALLER**, which is not a
side-quest: the unit locks on the first movement, and until now nothing in the
app could fix it before then. Somebody adding "Ground beef" in pounds when they
meant packages had to live with it forever. Now `Edit` opens on the item page,
with the unit picker disabled once `rows` is non-empty and saying which of the
two sentences applies.

- **Locked on ANY movement, not on the balance.** An item that received ten and
  issued ten is back at zero and its ledger is still denominated in the old unit.
- **`restoreItem` is new, and archiving without it would have been a trap.**
  Retiring an item is a judgement and judgements are wrong sometimes; a one-way
  control on a list somebody is tidying strands the item where only
  `?archived=1` can see it. Its own act rather than a field on `updateItem`, so
  it gets its own audit entry — retiring a thing the business holds is not the
  same kind of event as correcting its spelling.
- **The retire confirm names what stays on hand.** Archiving does not touch the
  ledger, so stock behind a retired item is still in every balance and every
  valuation. Better said in the dialog than found in a report.
- **Retire sits OUTSIDE the edit dialog rather than in its footer.** A confirm
  opened from inside an open dialog is two Radix modals deep, and `useConfirm`
  must be awaited before any transition starts. Side by side, both are one
  modal, and Save is nowhere near the destructive control.
- **The item page's header actions are no longer gated on `active`.** A retired
  item is precisely the one somebody needs to reach, to put it back. Starting a
  batch and moving stock still are.

No migration, no schema change, no new RLS. The plan for 6b and 6c, with the
alternatives each rejected and why, is the one this slice was cut from.

### 2026-08-22 — The hydration error that was not inventory's (`claude/laughing-herschel-e284b2`)

`/value` and `/tax` both logged *"Hydration failed because the server rendered
HTML didn't match the client"* on load. **Neither page is at fault, and nothing
in this pack was changed to fix it** — the entry is here because this is where
the hunt started and where the next person will look.

**HOW IT WAS SETTLED, since it would not reproduce on demand.** Fetching each
page's SSR HTML from inside the loaded tab and walking it against the live DOM
node-for-node: `<main>` matched 182 of 182 nodes, `<header>` 13 of 13, `<html>`
and `<body>` attributes identical. The ONLY divergence in the whole document was
the sidebar footer, where the server emits an empty
`<div class="flex items-center justify-between gap-2">` and the client fills it
with Clerk's `OrganizationSwitcher` and `UserButton`. A page whose every node
matches cannot be the page that mismatched.

**THE CAUSE IS A RACE IN THE SHELL, WHICH IS WHY IT LOOKED PAGE-SHAPED.** Both
Clerk widgets render `clerk.loaded && <ClerkHostRenderer/>` — a condition read
DURING RENDER (`@clerk/react` `hooks-*.mjs`, `withClerk`), and always false on
the server, because `clerk.browser.js` only exists in a browser. That script is
remote and the app's chunks are local, so on a quick machine Clerk loses the race
and the first client render also produces nothing; when it wins, the client
renders a subtree the HTML never had. Every dashboard page is exposed equally —
you blame whichever one you were looking at.

**Derived rather than assumed, because it would not fire here.** A probe of the
same shape (a client component rendering one extra `<span>`, nothing on the
server) was put in the sidebar footer: it produced that exact message, naming
`data-probe="1"`. Wrapped in the new
[`AfterHydration`](../../src/components/app/after-hydration.tsx), the message
went away and the span still rendered. That is the fix, now applied to the real
widgets in both shells — see
[design-system.md](design-system.md), which had already recorded this as an open
item and warned it "masks any real hydration bug that shows up later".

`/value`, `/tax` and `/admin` reload clean afterwards, with the switcher, the org
avatar and the user button all still in the rail. No inventory file changed, no
migration, no test.

### 2026-08-22 — The lens that applies a rule (`claude/the-lens-that-applies-a-rule`)

Slice 3d iii. A recorded decision now changes a report, and `paid` is the rule it
learned. `IMPLEMENTED_TIMING_RULES` widened from one to two, which is the whole
public shape of this slice.

**ACCOUNTING CORE STILL DOES NOT KNOW INVENTORY EXISTS, and that cost a seam.**
`getBalances` is the one function every report goes through, and teaching it
about `item_kind` would have undone the rule slice 3b paid for — `approveBill`
copies a line verbatim precisely so the bill path never learns what a stock
receipt is. So core names a slot in vocabulary true of any lens (*some entries do
not belong in this basis; some lines belong under a different account*),
`src/lib/basis-lens/` holds it, and the registry there is the only file naming
the pack. Same direction as `mail-extensions` and `attention-sources`: **core to
lib to pack, never core to pack.**

**A PROVIDER MAY DROP AN ENTRY WHOLE AND RE-POINT A LINE. IT MAY NOT TOUCH AN
AMOUNT OR A DATE.** That is not politeness — an entry dropped by one leg, or a
line re-priced, unbalances the report, which ADR 0007 names as the failure to
design against and which only a trial balance nobody ran would notice.

**A FAILING PROVIDER BREAKS THE REPORT RATHER THAN BEING SWALLOWED**, which is
`attention-sources/resolve.ts`'s posture and not `mail-extensions`'s. Folding to
"no adjustment" would hand somebody a profit and loss computed on a treatment
they did not elect, that balances, that looks like every other report, and that
says nothing about having fallen back.

**`paid` NEEDED NO DATE LOGIC AT ALL, WHICH IS THE OPPOSITE OF WHAT THIS DOSSIER
PREDICTED.** The open item said the lens would have to split a shared control leg
pro rata. It does not — `cashBasisAdjustment` already recognises a document's
lines against the PAYMENT that lands in the window, so on a cash basis `paid` is
a change of ACCOUNT and not of timing. The control-leg problem is real and
belongs to `billed`, the rule that needs a line to stay on its accrual date.
**The prediction was right about the obstacle and wrong about which rule hits
it.**

**CASH BASIS ONLY, and that is deliberately not an answer.** ADR 0013's own
"least sure of" asks whether some basis/treatment pairs are incoherent; `paid` on
accrual is the likeliest, and `getBalances` documents the accrual path as
byte-identical to before. The lens declines on accrual and the question stays
open. Driven both ways on the dev farm: accrual `1300` at $1,359.93, cash at
$0.00, both in balance.

**Three things clicking found, and the first is the one that matters:**

1. **The page still said "This does not change your reports yet"** — written an
   hour earlier when it was true, and left standing when it stopped being. A
   screen that UNDER-claims is not the safe direction: somebody would set a rule
   believing it inert and watch their cash reports move.
2. **A substituting rule could be saved with no expense account**, and the
   refusal then arrived on a report, far from the decision and possibly in front
   of a different person. `setTaxRule` refuses now — and the report still
   refuses too, because an account can be deactivated after the fact.
3. **The account field said it could stay undecided** while the server was about
   to refuse without it. The hint follows the rule now.

**AND ONE THING CI FOUND THAT CLICKING DID NOT.** The save-time guard above
broke the test for the REPORT-time guard — which had recorded a rule with no
account, a state `setTaxRule` now refuses. It passed locally only because the
guard was added after that suite last ran, and re-running the suite that tested
the guard is not the same as re-running the suite the guard breaks.

The fix was better than the test. With the save-time guard in place a null
account is nearly unreachable, so the report check was defending a state the app
cannot produce — while the state it CAN produce went unguarded: **this chart
never hard-deletes a referenced account, it deactivates**, so a rule can end up
pointed at a retired one. A report that quietly recognised cost into it would
balance, look ordinary, and put money somewhere the business had stopped using.
The lens checks the account is present AND active now. **A guard whose test needs
an impossible fixture is guarding the wrong thing.**

**`total_cents` on a bill is a stored column the posting-test fixture never
set**, which nothing noticed until a test tried to PAY one and got
`BILL_OVERPAYMENT` against a remaining balance of zero. Fixed in the fixture.

3 posting tests, 2 ops, and the pure suite's implemented-rules assertion moved by
design. No migration.

**Still not built, and each for its own reason** — `basis-lens.ts` carries the
list: `billed` needs the shared control leg split pro rata; `sold` needs
recognition against a retail sale rather than a document or a payment;
`later_of_*` needs per-line dates the adjustment does not carry at all.

### 2026-08-22 — Where a decision gets recorded (`claude/where-a-decision-gets-recorded`)

Slice 3d stage 1: `inventory_tax_treatments`, the resolution, and a screen.
[ADR 0013](../decisions/0013-inventory-tax-treatment.md) §A.2 and §A.5.
**Nothing on it changes a report yet, and the page says so in its first card.**

**THE LIST IS MOMENTS THE LEDGER CAN DATE, NOT TAX TREATMENTS**, and that is the
whole design rather than a limitation. A list of treatments would be a reading of
the regulations, maintained by people not qualified to read them, and every gap
in it would be invisible to everybody. A list of dates is checkable: `billed` is
`bills.bill_date`, `paid` is `bill_payments.payment_date` reached through the
allocation chain, `sold` is the movement a `retail_sale_lines` row names. If an
election needs a moment that is not on the list, the answer is to add another
observable event — never to round to the nearest one already there.

**WHAT IS SETTABLE IS NARROWER THAN WHAT IS LISTED, AND THE GAP IS ENFORCED.**
`consumed` is the only rule the lens can apply, because it is the only one
meaning "change nothing". `setTaxRule` refuses the rest with a message saying the
reports cannot apply it yet; the screen shows them greyed as *"not built yet"*.
Showing them is deliberate — this page exists so an accountant's answer has
somewhere to go, and hiding the answers the software cannot take would let
somebody conclude it never will.

**PER `item_kind`, WHICH ALREADY EXISTED.** An earlier draft of the ADR made this
one setting for a whole business in the same document that says merchandise held
for resale behaves differently from feed. Resolution is item kind → tenant
default → built-in, and **both fields come from ONE row**: resolving them
independently would let a category say "expense this at payment" while the
account came from a row that never agreed to it.

**IT IS A RECORD, NOT A PREFERENCE**, so it carries `decided_by` and
`decided_on`. Free text, for the reason `inventory_counts.counted_by` is: the
accountant has no login here. The screen shows the name beside the rule, and
badges every row with where its answer came from — `inherited` when the default
answered, `not decided` when nothing has.

**CLEARING IS NOT SETTING IT BACK TO `consumed`.** "Nobody has decided about this
category" and "somebody decided it is used-based" are different facts, and
`resolveTaxRule`'s `source` is what tells them apart. Collapsing them would put
an accountant's name against a decision they never made.

**The null-kind default hits the `NULLS NOT DISTINCT` trap again**, the third
time in this pack. The unique index does not hold for the tenant default row, so
`setTaxRule` selects then updates — `recordCountLine`'s remedy, for
`recordCountLine`'s reason.

Driven on the dev farm: the page builds its rows from the categories that tenant
actually holds (feed, livestock, meat, medicine — `item_kind` is an open
taxonomy, so a page built from the SUGGESTED list would have missed anything
typed by hand). Recording feed, then the business default, flipped the other
three to `inherited`.

11 pure tests, 6 ops, 5 isolation. Migrations `0182` (table + enum) and `0183`
(RLS).

**Still not built: the lens.** Slice 3d iii is what applies a rule other than
`consumed`, and it is where the two things reading `cash-basis.ts` turned up have
to be solved — an entry has ONE control leg shared across mixed lines, and the
adjustment only runs for documents with a payment in the window.

### 2026-08-22 — A method is not a toggle (`claude/a-method-is-not-a-toggle`)

**TURNING POSTING OFF STRANDED THE BALANCE SHEET, and nothing stopped it.** Found
by asking what a change of accounting method should do, and finding a plain bug
underneath the tax question.

`postMovement` returns null on `none`. So a tenant that capitalised $10,000 of
feed and then switched off kept every one of those debits in `1300`, while the
issues that would have relieved them stopped posting entirely. The stock gets
eaten and the asset never moves. Nothing reconciles it and nothing reports it —
and the valuation screen goes on being right the whole time, because it folds
MOVEMENTS rather than reading the ledger, so the two silently part company.

The switch's own copy said it does not backfill. **Nobody had said it does not
unwind either**, and the turn-off dialog read *"what is already posted stays
posted"*, which is true, reassuring, and the exact half of the sentence that
matters least.

`assertPostingChangeSafe` refuses now, and it refuses rather than warning for the
reason this pack refuses everywhere else: the damage is silent and compounding,
and a warning is read once by somebody who has already decided. **Turning it ON
is untouched** — additive, and where every tenant starts. **Nothing has posted
yet is still allowed**, so somebody who switched it on by mistake five minutes ago
is not trapped.

The screen does not offer a switch that will fail, which is slice 3c's rule
applied again: the toggle is disabled with the count and the date beside it. No
in-product remedy is offered, on purpose — unwinding capitalised stock is a
decision about what the business owns, made as a journal entry by a person.
[ADR 0013](../decisions/0013-inventory-tax-treatment.md) §A.6.

**The audit line now records BOTH ENDS.** It logged `{treatment}`, which does not
say whether that was the first time or the third. It is the only durable record
of the change anywhere.

**`INVENTORY_ENTRY_SOURCES` is a list, and the list is the fragile part.** The
guard counts entries across all four sources this pack posts under. A fifth added
to `ledger.ts` without being added here would under-count, and under-counting
presents as the switch ALLOWING a change it should refuse. A test asserts the
count covers every `inventory_*` source actually present in the tenant, so the
omission fails rather than passes.

5 new tests, 56 in the file. No migration.

### 2026-08-22 — Slice 3d (first half): a cost you can put right (`claude/a-cost-you-can-put-right`)

`inventory_cost_adjustments`, [ADR 0012](../decisions/0012-what-capitalises-stock.md) §A.4.
Until this, a stamped cost was final: a ticket could overstate, understate, omit
the freight or carry no price at all, and the only remedy was SQL.

**IT IS A ROW, NOT A MOVEMENT, and the database settled that rather than taste.**
`inventory_movements` carries two CHECKs a pure-money correction cannot satisfy —
`quantity <> 0` rules out a row that moves nothing, and `cost_cents >= 0` rules
out a correction downwards. Relaxing either would weaken a constraint protecting
the quantity ledger for every other caller. Both halves were driven: a −$20
correction posted `Cr 1300 / Dr 5000` on the live dev farm, which is the entry
that column could never have carried.

**THE SPLIT IS STORED, and it is why two money columns exist where one would
do.** A correction lands partly on stock still on the shelf (which raises the
batch's carrying value) and partly on stock already issued (which is expensed,
because capitalising it would put an asset back on the balance sheet for feed
that has been eaten). `$60 → $36 + $24` on a batch with 60 of 100 lb left. The
proportion is what the ledger believed at that moment and is written down rather
than re-derived, for the reason a count line stores `expected_quantity`: a
movement backdated tomorrow must not restate a posting that already happened.
`quantity_on_hand` and `quantity_received` sit beside it so the proportion can be
READ rather than reverse-engineered out of two cent figures.

**THE CREDIT IS THE VARIANCE ACCOUNT AND DELIBERATELY NOT GRNI**, which is the
one decision here that had a plausible alternative. Crediting Goods Received Not
Invoiced reads right — a delivery that cost $60 more is $60 more a supplier will
invoice for — and it is wrong in a way that only shows up later. **Matching
clears GRNI at the RECEIPT's stamped cost**, which a correction does not change,
so the extra credit is one nothing can ever debit: a permanent balance in a
liability account, in the exact place slice 3c built a reconciliation to make
such things visible, and blamed by that card on "deliveries from before the
switch". It would also DOUBLE COUNT, because §A.5 books the same difference again
when the invoice arrives. So the two are complementary rather than overlapping:
**§A.5 corrects the books when an invoice disagrees with the ticket; §A.4
corrects the stock record when there is no invoice to disagree with.** They land
in the same account, which is why a delivery that gets both ends up with the
right inventory value, the right liability and no net variance:

```
receipt $340         Dr 1300 340   Cr 2050 340
correction +$60      Dr 1300  60   Cr 5000  60
bill $400 matched    Dr 2050 340   Dr 5000 60   Cr AP 400
                     ───────────────────────────────────
                     1300 = 400 · 2050 = 0 · AP = 400 · P&L = 0
```

**THE LINES ARE NETTED BY ACCOUNT AND ZEROES DROPPED**, which is not tidiness:
`varianceAccountId` DEFAULTS to the consumption account, so a correction against
a batch entirely issued out would try to post `Dr 5000 / Cr 5000`, and
`postEntry` refuses a zero-amount line. Netted, that correction posts nothing at
all — which is the truth about it — and every other correction posts exactly
`Dr 1300 / Cr 5000` for the on-hand half, so the ledger and `lotCarried` move by
the same number *by construction* rather than by a second calculation.

**THE TRAP THE OPEN ITEM NAMED, and it needed two files.** `carriedValue`
decided "was this batch ever costed" from purchased/consumed/released, and
`production/ops.ts` asked the same question independently in a different shape
(`purchased + consumed === 0`). A batch costed ONLY by a correction passes
neither: the valuation screen would have said "No cost recorded" about a batch
carrying real money, and a kill day would have stamped NULL on the meat it
produced. **Two shapes of one question is a question that can be answered
differently in two places, and it duly was** — so it is one exported predicate
now, `hasRecordedCost`, in the pack that owns the fold. Driven end to end: a
30 lb delivery entered with no price read "No cost recorded", a $45 correction
turned it into `$45.00` on both the item page and the valuation screen, and a
production run against a pen in the same state stamps its share instead of null.

**A NEW ENTRY SOURCE, AND DELIBERATELY NOT A NEW MACHINE SOURCE.**
`inventory_cost_adjustment` had to be its own value because `source_id` names one
of these rows rather than a movement, and two sources pointing into two tables
would leave the ledger unable to say which. It is NOT in `MACHINE_SOURCES`: the
other three are there because issuing feed is a staff chore riding its own
authorisation, and re-stating what stock cost is not one. It meets
`requireOwnerRole` like any hand-written journal, and `adjustLotCost` refuses a
non-owner before it ever gets there.

**`resolveLotEntity`, because a correction has no location.** A movement carries
one and `resolveMovementEntity` uses it; money does not. So the batch's own
places answer instead — a freezer is an asset and an asset already names its
books — and it REFUSES where they disagree or say nothing, the same refusal for
the same reason: a default chosen at posting time is exactly the behaviour the
`entity_id` column replaced.

**A CORRECTION DOES NOT MOVE THE ITEM'S AVERAGE, and that is a decision rather
than an omission.** `averageCostRate` folds movements at the ITEM level; a
correction belongs to one batch. Feeding it in would spread one mis-ticketed
delivery across every other batch of that item and re-price future issues out of
batches that had nothing to do with it — the exact re-averaging the lot spine
exists to prevent. The consequence is real and is in Open items rather than
hidden: stock issued out of a corrected batch is still stamped at the uncorrected
average, so the correction stays standing in the batch instead of leaving with
the stock. That is the same drift item-level average costing already produces
whenever two batches of one item arrived at different prices.

**Three things clicking found, and two of them were the screen lying about the
direction:**

1. **A fat-fingered `99999999999` went straight through** — posted a
   $99,999,999,999 entry and left a batch carrying sixty billion dollars, because
   the ledger's own ceiling is $100B and nothing between the box and it had an
   opinion. `receiveStockAction` already bounds a delivery's cost at
   $10,000,000,000; a correction is the same kind of number and takes the same
   limit.
2. **"It cost less" said the money "goes to cost of goods sold"** when $8 was
   about to come OFF it — in the preview panel that exists precisely so nobody
   has to read a journal entry to find out. The verb follows the direction now.
3. **The toast said the same thing**, and it is keyed off the STORED
   `issuedCents` rather than the form's direction, because that is what was
   actually written.

The dialog is deliberately separate from the adjustment form rather than a fourth
tab on it: that one changes HOW MUCH IS THERE and this one changes WHAT IT COST.
One picker offering both reasons would invite somebody to record a spoiled bag as
a cost correction, which re-prices the batch and leaves the bag on the shelf —
which is also why `COST_ADJUSTMENT_REASONS` is its own list.

15 new tests (11 posting, 1 production, 8 pure across two files) and 6 isolation.
Migrations `0180` (table + enum value) and `0181` (RLS).

**NOT BUILT, on purpose: the `expense_on_payment` lens**, slice 3d's other half.
[ADR 0013](../decisions/0013-inventory-tax-treatment.md) is still Proposed and
should not be accepted without an accountant.

### 2026-08-22 — Nobody invoices you for what you made (`claude/nobody-invoices-you-for-what-you-made`)

**Found on the live app**, which is the first time this pack has been looked at
with real data in it. A kill day's output — "Whole broilers · Kill day
2026-08-21", and the chicken backs beside it — was sitting in *deliveries with
no invoice yet*, next to a draft lumber bill for $16,677.33. The screen was
inviting somebody to match the two.

`postMovement` already knew better: a **produced** or **raised** lot credits the
CONSUMPTION account, not GRNI, because a run's inputs were charged there on the
way in and its output credits the same account on the way out. `unbilledReceipts`
did not know it, and listed every priced receipt whatever its provenance.

Three consequences, and only the first is visible:

1. The list offers stock no supplier ever sold the business.
2. **The GRNI working could never agree with the account**, because made goods
   were in one and not the other — and the card blames a difference on
   "deliveries from before the switch", which would have been wrong every time.
3. Matching one would point a bill line at GRNI to clear a credit that was never
   made — the same failure as matching with posting off, arriving through
   provenance instead of through a setting.

The predicate is now **shared** — `owesASupplier`, used by both ends — so they
cannot drift again. Lot-less stock counts as bought, which is what a receipt
with no batch almost always is, and is what posting already assumed.

4 tests, 40 in the file. One of them had to be rewritten as a DIFFERENTIAL
measurement rather than an absolute one: the file shares a tenant, so "the gap
is at least $70" was a claim about every test before it as much as about itself.

### 2026-08-22 — Slice 3c: the screen, and three things clicking it found (`claude/the-screen-that-matches-a-delivery`)

Everything 3b built was reachable only from ops. This is the first time anybody
can turn posting on at all, let alone match a bill to a delivery.

**Both halves are on ONE page deliberately.** "Deliveries with no invoice" and
"bill lines with no delivery" are the same question asked from opposite ends,
and seeing them together is the whole value of GRNI — a reconciliation split
across two screens is one nobody finishes.

**The quantity boxes start EMPTY.** A pre-filled number is a number nobody
reads, and the one question this screen exists to ask is whether what the
invoice charges for is what actually turned up. "How much is the bill charging
for?" is a separate box for the same reason, and it is what turns a short
delivery into owed stock rather than a cost.

**Three defects came out of opening it**, and the first two were only findable
by clicking:

1. **Matching worked while posting was OFF.** Only `postMovement` checked the
   treatment. With posting off a receipt credits nothing to GRNI, but matching
   still re-coded the bill line to it — and approving posted `Dr 2050` against a
   credit that was never made, leaving a debit nothing could ever clear.
   `allocateBillLineToStock` refuses now, and the screen does not offer the
   button rather than offering one that fails.
2. **The GRNI card reported the WORKING and called it the ANSWER.** It showed
   "$700 is what Goods Received Not Invoiced should be holding" about an account
   holding nothing, because every one of those deliveries predated the switch
   and turning posting on does not backfill. Its own doc comment described a
   comparison the code never made. It now shows the account as the headline, the
   deliveries beside it, and names the difference — which is almost always
   exactly that: stock recorded before the books were watching.
3. **The three new actions called `requireTenant()` INSIDE their try block.**
   It signals "not signed in" by THROWING `NEXT_REDIRECT`, a Next control-flow
   exception — caught, it became "Something went wrong saving that". Every other
   action in the file calls it first, outside. Found by clicking the switch with
   a stale session.

The treatment switch says what it does before it does it, including the thing
people assume and should not: **it does not backfill.** It also says out loud
that an accountant should be the one deciding.

Only the acts are owner-gated — seeing what arrived and what was billed for it
is a bookkeeper's daily question. 3 new tests, 36 in the file.

**NOT FULLY DRIVEN, and recorded rather than glossed.** The page, the switch,
the confirm and the GRNI card were all clicked; the match dialog itself was not,
because the dev tenant with inventory has no draft bills and the org switcher
kept reverting on full page loads. What the match path has is 36 tests against a
real database, and this repo's history says that is not the same thing.

### 2026-08-22 — Unpicking a match (`claude/what-a-shortfall-is-not`)

Somebody will match the wrong delivery, and until now the only way out was SQL.
`unmatchBillLine` undoes the three things matching did, and it has to do all
three or the bill is left in a state no screen can explain: release the
allocations so the deliveries return to the reconciliation, fold the variance
sibling's amount back into the line so the vendor is still owed exactly what
they invoiced, and **clear the coding so the line is UNCODED again**.

Uncoded is the honest state. The alternative is guessing an expense account on
the way out, and `approveBill` already refuses an uncoded line — so the bill
cannot be approved until a person says what it was for, which is the right place
for that question.

Refuses on an approved bill for the same reason matching does: the entry has
posted, and this would change what the bill says without changing what was
posted. Owner-only, the same as matching.

### 2026-08-22 — Three defects that only showed up in the books (`claude/what-a-shortfall-is-not`)

The correctness items 3b left open, cleared before any screen invites somebody
to switch posting on.

**AN ISSUE CANNOT RELEASE COST THAT NEVER CAME IN.** `averageCostRate` is the
average of what arrived WITH A PRICE — priced cost over priced quantity — and
applying it to a quantity that includes unpriced stock invents money. 100 lb at
$100 plus 100 lb with nothing on the ticket is a $1.00/lb rate, so issuing all
200 stamped $200 against $100 that ever existed and drove `1300` to a CREDIT
balance with stock still on the shelf. The rate is left alone deliberately:
putting unpriced receipts in the denominator would treat stock nobody has costed
as costing nothing, which is the one thing the valuation slice exists to refuse.
So the release is bounded instead — **and bounded at the STAMP, not only at the
posting**, so the ledger and `carriedValue` stay the same number by construction
rather than by a second calculation somebody has to keep in step.

**A SHORT DELIVERY IS NOT A PRICE DIFFERENCE.** Every gap between an invoice and
the tickets was booked as a variance, so an invoice for ten bags against six that
arrived was EXPENSED and GRNI cleared to zero — the reconciliation showed nothing
outstanding and nobody chased the supplier. The allocation now takes the invoiced
QUANTITY, which is what tells the two apart: a rate difference is a real cost and
goes to the P&L, a shortfall is stock paid for and not held and stays in GRNI as
a debit, which is what that account is for.

**WHAT THE INVOICE CHARGES IS NO LONGER A PARAMETER.** It was passed in and
nothing reconciled it against the line it rewrites, so a caller could change what
the bill posts to AP while the aging report kept the old number. It is derived
from the line now — reconstructed as the line plus its variance sibling, because
matching rewrites the line and may already have done so. That also makes the
freight case correct **by construction**: whatever is not matched to stock stays
on the bill as an expense line instead of the line being shrunk to the matched
amount, which would have taken money off what the vendor is owed.

The first attempt at that last one validated `invoiceCostCents` against
`line.amountCents` and broke both idempotency and matching a line one delivery at
a time — the line no longer carries the invoice amount once it has been matched.
Deriving removes the disagreement rather than validating it away.

5 new tests, 30 in the file.

### 2026-08-22 — The company a movement's cost belongs to (`claude/the-books-follow-the-shelf`)

**`postMovement` used to post to the tenant's DEFAULT company**, because a
movement carries no `entity_id` — while the bill clearing it posts to the bill's
own. In a tenant with two companies neither GRNI ever netted: one kept a
permanent credit the reconciliation called settled, the other a permanent debit,
and the stock sat on the wrong balance sheet. Only a consolidated view hid it,
and **the Test tenant deliberately holds two companies**, so it was reachable.

`assets` had already settled this and the answer is copied deliberately — its
`entityOf` refuses rather than defaulting, because *"a default chosen at posting
time is exactly the behaviour this column replaced"*. So `resolveMovementEntity`
takes the only company when there is one, the LOCATION'S company when there is
more than one (a freezer, a barn and a market truck are all assets, and an asset
already names its books), and **refuses otherwise**. A match across companies is
refused from the other end.

**Every one of the 21 existing tests passed while this was broken**, because
every one of them ran single-company. The four new ones stand up a second
company on purpose.

Two things the fix taught, both recorded because they cost a red run:
`provisionAccounting` ADOPTS the assets that already exist, so the fixture
freezer does name a company and resolving it was never ambiguous — the first
version of that test asserted a refusal that correctly never came. And a company
cannot be deleted once entries have posted to it, so the cleanup deactivates it;
a failed delete is what made a dozen later tests inherit the ambiguity.

### 2026-08-21 — Slice 3b: the books follow the shelf, and only when asked to (`claude/what-the-shelf-is-worth`)

Inventory reaches the ledger. `costing.ts` has said since slice 1 that the third
layer was not there; it is now, and it is **off by default**.

**`inventory_treatment` DEFAULTS TO `none`, and that is the decision that made
this safe to merge.** Perpetual posting rewrites how every purchase reaches the
books. Switching that on by migration, for tenants already keeping accounts, is
not something anybody should acquire without being asked — so nothing changes
until an owner turns it on. ADR 0013 had it defaulting to `capitalise`; that was
wrong for live books and the ADR is now the thing that is out of step.

**THE RECEIPT CAPITALISES AND THE BILL CLEARS.** `Dr 1300 / Cr 2050 Goods
Received Not Invoiced` when stock arrives; `Dr 2050 / Cr AP` when the bill for it
is matched and approved. GRNI is the join between what the business HAS and what
it OWES, and its balance is a report rather than plumbing: a credit is stock
received with no invoice, a debit is an invoice for stock the books never
received.

- **Accounting core never learns that inventory exists.** `approveBill` copies a
  bill line's account verbatim, so **the allocation sets the line's account to
  GRNI at match time** and the bill path is untouched by this slice. Teaching
  `approveBill` about allocations would have put a Layer 1, industry-blind module
  in the business of reading a pack's tables.
- **An item link was never enough**, and the first draft of ADR 0012 thought it
  was. `bill_line_stock_allocations` matches a quantity against a specific
  receipt, which is what lets one invoice cover two deliveries at two prices,
  a receipt be part-invoiced, and a variance be attributed to something.
- **The invoice splits by what each delivery was worth**, not evenly, largest
  remainder so the parts sum to the whole.
- **Transfers, splits and merges post NOTHING.** The entry would be
  `Dr 1300 / Cr 1300` — a row that says nothing and balances.
- **A movement with no cost posts nothing rather than posting zero**, which is
  the same distinction `carriedValue` keeps on the valuation screen, arriving in
  the ledger.
- **One movement is one entry forever.** The idempotency key is the movement's
  own id, so a replayed write lands once — the property `retail`'s till needed a
  `clientRef` for, obtained here free because a movement already has an identity.
- 15 posting tests, 7 isolation. Migrations `0177` (table + enum + column) and
  `0178` (RLS + the GRNI backfill, `0151`'s shape).

**Mapping the seams before writing anything turned up nine things that would have
shipped silently.** Three mattered enough to change the design, and two were
already-live bugs:

- **`LEDGER_ACCOUNTS` was a declared error code with no case in `toResult`**, so
  every refusal from `resolveInventoryAccounts` rendered as "Something went
  wrong saving that." The message carries the repair; it passes through now.
- **GRNI would have fallen silently into "Other Liabilities"** without a
  `BS_GROUP_BY_SUBTYPE` entry — `bsGroupFor` does not error on an unmapped
  subtype, it just picks the fallback, and nobody notices until a client reads
  the balance sheet. It is also excluded from `isCodableAccount`, so nobody can
  hand-code a bill line to it and clear a balance no receipt created.

**Two of the new tests were wrong before they were right**, both the same shape:
a test that passes over behaviour that never ran. "POSTS NOTHING for a transfer"
passed `null` for both locations, which `transferStock` refuses as `SAME_PLACE`,
with a `.catch()` swallowing the refusal — it asserted that nothing changed after
an operation that did not happen. And the GRNI round-trip assertion took its
baseline AFTER the receipt, so the bill's debit read as `+6000` and looked like a
failure. The code was right both times.

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

**Older entries — slices 0 to 2, and the run-up to them — are in**
**[inventory-build-log.md](inventory-build-log.md).** Swept there on 2026-08-22 under
AGENTS.md's rule that a dossier is read at the START of every session touching this
area, so its length is a tax on every future change to it. build-docs walks the whole
tree, so the archive renders at /admin/docs with no code change.

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

**`weight_lb` on the movement arrived in slice 6b, and it is `cost_cents`'s
shape** — a TOTAL on the event, never a rate, with the average folded at read
time by `core/weight.ts`. **Only an inbound movement may carry one**
(`inventory_movements_weight_inbound`), which is the deliberate difference from
cost: an issue DOES stamp a cost because cost is released from a batch, whereas
weight is a standing property of what is in it. Null is ordinary — feed, cartons
and live animals have no package to weigh, and an item stocked by mass has its
weight in `quantity` already.

`expires_on` on the lot and `reason` on the movement arrived in slice 2. Both are
nullable and null is ordinary: a batch with no date is one nobody has dated (and
the pack does not try to tell that apart from "does not expire"), and a movement
with no reason is one whose kind already says why.

| `inventory_tax_treatments` | **Where an accountant's decision is recorded**, per category — ADR 0013 §A.2 | `item_kind` NULL is the tenant default, and the unique index does NOT hold for it (Postgres nulls are distinct) — `setTaxRule` selects then updates, third time this pack has hit that. Composite FK to `accounts`. Carries `decided_by` and `decided_on`, because it is a record rather than a preference |

| `inventory_cost_adjustments` | **A correction to what a batch COST.** Appended, never an edit — ADR 0012 §A.4 | Composite FKs to the item and the lot, **neither cascading**: erasing the record that somebody re-stated a cost would hide the money. `amount_cents` is SIGNED and CHECKed non-zero, which is the pair of things `inventory_movements` structurally cannot carry. `on_hand_cents + issued_cents = amount_cents` is CHECKed, so a stored split can never fail to account for the whole |

| `bill_line_stock_allocations` | **Which delivery a bill line is settling** | Composite FKs to `bill_lines` (**CASCADE** — a draft edit re-creates every line, so ids do not survive one) and to the receipt movement (**no cascade** — erasing the record that a bill settled it would hide the money). UNIQUE per (line, movement): a second match is a correction, not a second settlement |

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
  that could be zero, and `hasRecordedCost` before adding anything that can put
  money on a batch — it is shared with `production` and is the ONE place "has
  anybody said what this cost" is answered
- `src/packs/inventory/core/tax-rules.ts` — pure. The timing rules, what is
  implemented, and the resolution order. **Read the header before adding a rule**
- `src/packs/inventory/core/weight.ts` — pure. **What a package weighs, and what
  this file exists to NOT be** — a conversion. `averagePackageWeight` is
  `averageCostRate` with a different numerator; `weightOf` is the one place the
  mass/counted split is decided; `WeightReading.approximate` is why no screen can
  present an estimate as a measurement
- `src/packs/inventory/core/costing.ts` — pure. `lotCarried` folds movements AND
  cost corrections; `splitCostAdjustment` is the on-hand/issued arithmetic and is
  called by the server and by the dialog's preview, so the two cannot disagree
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

- **`each`, `head` AND `pkg` ALL SIT AT `perBase: 1` IN THE `count` DIMENSION**,
  so `convert` will happily turn 70 head into 70 packages. There is a test
  asserting the nonsense so it is found here rather than in somebody's balance.
  It is harmless only because a conversion is offered between ONE item's own
  purchase and stocking units, chosen by a person as a pair — **a caller that
  picks two count units itself would be silently wrong.**
- **THE STOCKING UNIT IS THE PACKAGE FOR ANYTHING THAT LEAVES A FREEZER
  WRAPPED, and its weight is a measurement rather than a conversion.** Modelling
  a package's weight as a factor is exactly the third kind of conversion
  `core/units.ts` refuses, and refusing it is why meat is not stocked in pounds
  with a packages-per-pound fudge. Slice 6b records the measurement instead.
- **UNWEIGHED IS NOT ZERO**, and it is UNVALUED's rule with a different noun. A
  batch nobody weighed is absent from `weightRatesForItems`'s maps rather than
  present at zero, `hasRecordedWeight` is the discriminator, and every screen
  shows nothing rather than "0 lb" over stock nobody has measured.
- **POUNDS ON HAND ARE APPROXIMATE AND WILL NEVER RECONCILE WITH POUNDS SOLD.**
  38 packages at an average of 1.25 lb is 47.5 lb and the actual 38 are each a
  little more or less. **That is what catch weight IS.** One figure is a shelf
  estimate and the other is a transaction record; nothing should ever try to make
  them agree. `WeightReading.approximate` carries the caveat into the return type
  so a caller cannot drop it by forgetting, and it doubles as the guard that
  keeps a mass-stocked item from printing its own quantity twice.
- **UNVALUED IS NOT ZERO.** A lot nobody costed and a lot whose cost has all
  been released both fold to `remainingCents: 0`, and only the second is worth
  nothing. `carriedValue` is the discriminator and `valueLine` must never be
  handed `remainingCents` directly. A total is always reported with the count
  and quantity it could not value.
- **"HAS THIS BATCH EVER BEEN COSTED" IS ONE FUNCTION, NOT A TEST YOU WRITE.**
  `hasRecordedCost` is exported from `core/valuation.ts` and used by
  `carriedValue` AND by `production/ops.ts`. It was two independent expressions
  in two files, of two different shapes, and when
  `inventory_cost_adjustments` arrived neither counted a correction — so a batch
  costed only by one would have read "No cost recorded" on the valuation screen
  while a kill day stamped NULL on the meat. **If a future slice adds another
  way for money to reach a batch, this predicate is the thing to change**, and
  changing it fixes both callers at once, which is the whole point of it.
- **A BASIS-LENS PROVIDER MAY DROP AN ENTRY WHOLE AND RE-POINT A LINE, AND
  NOTHING ELSE.** Not an amount, not a date, not one leg of a pair. Every one of
  those unbalances a report, and the only thing that would notice is a trial
  balance nobody ran. See `src/lib/basis-lens/types.ts`.
- **A FAILING LENS MUST BREAK THE REPORT.** Folding to "no adjustment" hands
  somebody a balanced, ordinary-looking report computed on a treatment they did
  not elect. `attention-sources/resolve.ts`'s posture, for its reason.
- **THE TIMING-RULE LIST IS MOMENTS THE LEDGER CAN DATE, NOT TAX TREATMENTS.**
  Every value in `TIMING_RULES` names a column that exists. A list of treatments
  would be a reading of the regulations maintained by people who cannot read
  them, and its gaps would be invisible; this list is checkable against the
  ledger. **If an election needs a moment that is not on it, add another
  observable event — never round to the nearest one that is.**
- **`IMPLEMENTED_TIMING_RULES` MUST NOT WIDEN AHEAD OF THE LENS.** It is what
  stops a recorded decision being a lie about what the reports do, and it is
  enforced in `setTaxRule` rather than only in the UI.
- **CLEARING A TAX RULE IS NOT SETTING IT TO `consumed`.** One means nobody has
  decided, the other means somebody did. `resolveTaxRule`'s `source` is the
  discriminator, and collapsing them would put an accountant's name against a
  decision they never made.
- **A COST CORRECTION IS NOT A MOVEMENT, AND MUST NOT BECOME ONE.** Two CHECKs
  refuse it: `quantity <> 0` rules out a pure-money row, `cost_cents >= 0` rules
  out a correction downwards. Both constraints protect the quantity ledger for
  every other caller.
- **A COST CORRECTION'S SPLIT IS STORED AND MUST NEVER BE RECOMPUTED**, the same
  rule as a count line's `expected_quantity` and for the same reason.
- **A COST CORRECTION CREDITS THE VARIANCE ACCOUNT, NEVER GRNI.** Matching clears
  GRNI at the receipt's stamped cost, which a correction does not change, so a
  credit put there is one nothing can ever debit — and §A.5 already books the
  invoice-vs-ticket difference, so it would double count. See the build log for
  the worked entry.
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

- **THERE IS NO ENTERPRISE DIMENSION, and the search box is standing in for one.**
  "Just chicken" is answered today by typing a word that happens to appear in the
  names — which works on this farm because its items are called *Broiler chicks*,
  *Broilers* and *Whole broilers*, and stops working the day somebody names one
  *Cornish Cross*. Kind is what a thing IS (feed, meat, livestock); enterprise is
  which animal or crop it belongs to, and they are orthogonal. It is also the
  dimension the pack's own thesis needs — *profit per enterprise* cannot be a
  report while the only way to group is a substring. `livestock` already has
  species and `production` already has run kinds, so the vocabulary exists; what
  is missing is a column on the item and a decision about who owns it.
- **The filter does not reach the other inventory screens.** Counting, valuation
  and matching all list items and none of them can be narrowed. The valuation one
  is the likeliest to be asked for first: *"what is the meat worth"* is a
  question somebody will have the moment they see the total.

- ~~Nobody has driven slice 0 yet~~ — **closed 2026-08-19.** Driven on
  production; the fold, the split, the location split and the return to zero all
  reconcile. It found the two items below.
- ~~A COST CORRECTION HAS NOWHERE TO GO~~ — **closed 2026-08-22.**
  `inventory_cost_adjustments`, ADR 0012 §A.4, driven on the dev farm in both
  directions. The `carriedValue` trap this item named is closed by making the
  test one shared predicate (`hasRecordedCost`) rather than two.
- **A CORRECTION DOES NOT MOVE THE ITEM'S AVERAGE, so it does not leave with the
  stock.** `averageCostRate` is an ITEM-level fold over movements and a
  correction belongs to one batch; folding it in would spread a mis-ticketed
  delivery across every other batch of that item, which is the re-averaging the
  lot spine exists to prevent. The cost of that: stock issued out of a corrected
  batch is stamped at the UNCORRECTED average, so the correction stays standing
  in the batch, and once the batch empties it stands there with no stock behind
  it — visible on the batch while it has stock, and invisible on the valuation
  screen afterwards, because `valueStock` drops lines that net to zero.
  **This is not new with corrections**: item-level average costing already does
  it whenever two batches of one item arrived at different prices (lot A at $1.00
  and lot B at $2.00 both issue at $1.50, so A goes negative and B stays high),
  and the valuation screen and `1300` already disagree by that drift. What is
  new is a second way to produce it. The honest fixes are per-lot costing or a
  reconciliation that names the drift; neither is a slice yet.
- ~~The cash lens re-times balance-sheet lines, and it is a standalone bug~~ —
  **the claim was wrong and is corrected 2026-08-22.** Recognising an asset on
  the date it was paid for is defensible on a cash-basis report; it only breaks
  for a tenant ALSO capitalising the same stock through the pack, and that
  tenant is double-counting on any basis. **The reachable defect was the coding,
  and it is closed** — `isCodableAccount` excludes the inventory subtype now,
  for the reason it already excluded GRNI. Zero bill lines on either database
  had ever been coded that way.
  What remains is real and is not standalone: **the lens has no concept of a
  capitalising line**, so it treats one as something to re-time. That only needs
  solving when a rule other than `consumed` exists to re-time it to, which makes
  it slice 3d iii rather than a fix somebody can do this afternoon — see the
  next item for what it will have to solve.
- ~~Nothing applies a tax rule yet~~ — **closed 2026-08-22 for `paid`.** The two
  obstacles this item predicted turned out to belong to OTHER rules: `paid`
  needed no date logic, because `cashBasisAdjustment` already recognises a
  document against the payment in the window. The shared control leg is
  `billed`'s problem, and the payment-in-window limit is what makes `paid`
  correct rather than what blocks it.
- **THREE RULES ARE STILL LISTED AND UNBUILT**, each for a different reason, all
  named in `packs/inventory/basis-lens.ts`. `IMPLEMENTED_TIMING_RULES` refuses
  them on the way in, so none can be silently wrong.
- **THE LENS DECLINES ON ACCRUAL, and that is an open QUESTION rather than a
  settled answer.** ADR 0013's "least sure of" asks whether some basis/treatment
  pairs are incoherent. A tenant on accrual who elects `paid` currently sees no
  change at all, which is defensible and is also the shape of a setting that does
  nothing — the thing this whole area keeps guarding against.
- ~~The expense account is recordable and unread~~ — **read as of 2026-08-22.**
  `paid` substitutes to it, `setTaxRule` refuses a substituting rule without one,
  and the lens refuses to report if it has gone away since.
- **A COST CORRECTION CANNOT BE UNPICKED.** By design — appended, never edited —
  and the remedy is an equal-and-opposite correction, which nothing on the screen
  suggests. The same gap a posted count has.
- **The cost-correction list is per ITEM, not per business.** There is no "every
  correction this quarter" view, which is the question an accountant reviewing
  the variance account will actually ask.
- **A correction is offered on a CLOSED batch**, deliberately (the invoice
  routinely arrives after the feed is eaten), but nothing warns that the batch is
  closed, so it reads as an oversight rather than a decision.
- **`editEntry` can still rewrite a bill's posted entry from the journal
  screen**, with no source guard — `assertEntryNotSourceManaged` is called by
  the void action and not the edit path. An allocation can therefore be left
  clearing a balance whose entry no longer says so. That is an accounting-side
  gap and predates this pack; matching and unpicking both refuse an approved
  bill, which is as far as this side can reach.
- **The valuation screen is basis-blind and does not say so.** It reports
  accumulated cost, which is right and always on — but a cash-basis tenant
  reading "$463 on hand" will not find that figure in their financial
  statements, because on their basis it is not an asset
  ([ADR 0013](../decisions/0013-inventory-tax-treatment.md)). The card should
  say which basis it is and is not.
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
- ~~**Four of the eight actions have no UI caller**~~ — **two of the four closed
  2026-08-25.** `updateItem` and `archiveItem` are reached by `ItemControls` on
  the item page, along with a new `restoreItem`, so an item can be renamed,
  re-kinded, re-housed, retired and put back. The unit picker is disabled once
  anything has moved and enabled before then, which is the case that stung.
  **`closeLot` and `mergeLot` still have none**, so a batch cannot be closed or
  merged from any screen — splits are what `livestock` needed first.
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
