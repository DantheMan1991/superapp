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
| 1b | Meat runs: the processing path on the run, eligibility stamping, the exemption counter, and the kill sheet as a **document** (photograph or PDF → extraction → these rows) | next |
| 2 | Recipes + bake batches + results feedback | |
| 3 | Cost roll refinements: byproducts at NRV, costed internal transfers, labour | |
| 4 | Label generation | |
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

## Build log

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
| `production_runs` | One pass of turning things into other things | `tenant_id`, FORCE RLS. `run_kind` open taxonomy (P1), values from the profile. `status` in `in_progress\|complete` — two, because the only state that matters is whether the cost is still held here. `cost_basis` is stamped at completion and never re-derived. `crew_size` / `labour_hours` are recorded and **not costed** |
| `production_run_inputs` | **What went in. A JOIN, not a second ledger** | Composite FKs to the run (CASCADE) and to `inventory_movements`. UNIQUE per movement — two rows would put one cost in two runs, the same rule `livestock_feed_draws` follows. Its only own column is `weight_lb` |
| `production_run_outputs` | What came out — **and the one place holding a quantity before the ledger does** | Composite FKs to the run (CASCADE), the item, the lot, the receipt and the location. CHECK: `lot_id` and `inventory_movement_id` are null together — landed means both. Frozen once landed |
| `production_run_carcasses` | **The kill sheet, line by line** — the stage between the animal and the box | `tenant_id`, FORCE RLS. Composite FKs to the run and to the **input** (both CASCADE); `run_input_id` is REQUIRED, which makes the chain carcass → input → movement → lot total. `head_count` is 1 for a beef and 70 for a pen. `disposition` in `passed\|condemned` — two, because one line is one outcome. CHECKs: a condemned line carries no `hanging_lb`, a passed line carries no `condemn_reason`. **Writable on a finished run**, unlike everything else here |

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
- `src/db/schema/production.ts` · `drizzle/0168_soft_screwball.sql` ·
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

- **SLICE 1a HAS NOT BEEN DRIVEN IN A BROWSER.** Every test passes — the ops
  suite and the isolation certification included, against a database built from
  zero — and that is exactly the state the last five defects in this profile
  were found in. **Five of the last six slices had at least one defect that only
  clicking found, and one had a passing test over the wrong behaviour.** The
  screens most likely to be wrong are the ones in a state nothing else on this
  pack has: a sheet on a FINISHED run, and the form that changes shape when a
  carcass is condemned. The blocker is a signed-in Clerk session rather than a
  database.
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
