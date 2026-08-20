# Livestock

> Animals tracked as lots — every animal record is a lot, and an individual is a
> lot of one. **The pack that owns almost nothing**, and that is the point: the
> lot and the head ledger belong to `inventory`, occupancy belongs to `land`,
> and what is left here is the biology neither of them could know.
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
| 4 | Breeding, genetics, registry, **and the breeding/market capital transfer** | |
| **5** | **Weights (tape formulas, sampling) — and the FCR they unlock** | **shipped 2026-08-20** |
| **6** | **Processing handoff → `production`** | **shipped 2026-08-20** |

## Build log

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
| `livestock_lots` | The biology on an inventory lot | **1:1**, enforced by a unique index on `(tenant_id, inventory_lot_id)`. Composite FK to `inventory_lots`, CASCADE. `species` open taxonomy; `sex` in `male\|female\|mixed` |
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
- `src/db/schema/livestock.ts` · `drizzle/0138_*.sql` · `drizzle/0139_livestock_rls.sql`
  · `drizzle/0156_*.sql` · `drizzle/0157_livestock_daily_logs_rls.sql`
  · `drizzle/0162_*.sql` · `drizzle/0163_livestock_feed_rls.sql`
  · `drizzle/0164_*.sql` · `drizzle/0165_livestock_weights_rls.sql`
  · `drizzle/0166_*.sql` · `drizzle/0167_livestock_treatments_rls.sql`

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
- **`breed` is free text, and nothing may compute on it.** Homestead cattle are
  deliberately crossbred, so "½ Angus, ¼ Hereford, ¼ Simmental" is the real
  answer and a single string throws it away. Slice 4 replaces it with fractions
  computed from parents; until then it is display-only.
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
