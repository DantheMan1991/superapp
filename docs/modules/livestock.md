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
| 2 | Feed + FCR | next |
| 3 | Health + withdrawal clock | |
| 4 | Breeding, genetics, registry, **and the breeding/market capital transfer** | |
| 5 | Weights (tape formulas, sampling) | |
| 6 | Processing handoff → `production` | |

## Build log

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

**Everything else lives in a pack this one requires:**

| The question | Answered by |
| --- | --- |
| How many head? | `inventory_movements`, folded by `core/herd.ts` |
| Which batch, and what did it come from? | `inventory_lots` |
| What did this pen cost? | `dimension_members`, synced by `inventory` |
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
- `src/db/schema/livestock.ts` · `drizzle/0138_*.sql` · `drizzle/0139_livestock_rls.sql`
  · `drizzle/0156_*.sql` · `drizzle/0157_livestock_daily_logs_rls.sql`

## Decisions & gotchas

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
- **The advisor cannot see feed issued, treatments or weights**, because none of
  those are recorded yet — slices 2, 3 and 5. Its answers sharpen as those land,
  with no change to the prompt.
- ~~Neither screen has been clicked~~ — **closed 2026-08-19.** Both driven on
  production. It found the unrun migration, and one reading defect in the round.
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
