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
| 1b | Advisory layer — ask and orient, anchored to this farm's own history | next |
| 2 | Feed + FCR | |
| 3 | Health + withdrawal clock | |
| 4 | Breeding, genetics, registry, **and the breeding/market capital transfer** | |
| 5 | Weights (tape formulas, sampling) | |
| 6 | Processing handoff → `production` | |

## Build log

### 2026-08-19 — Slice 1: the round is one tap, and the row IS the check (`claude/livestock-daily-log`)

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
- `src/packs/inventory/ops.ts` → `movementsOnDate` — added for the round, so it
  can show today's losses WITHOUT storing them
- `src/db/schema/livestock.ts` · `drizzle/0138_*.sql` · `drizzle/0139_livestock_rls.sql`
  · `drizzle/0156_*.sql` · `drizzle/0157_livestock_daily_logs_rls.sql`

## Decisions & gotchas

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
- ~~No daily log~~ — **shipped 2026-08-19** as slice 1a. **The advisory layer is
  still missing**, and it is the other half of the wedge: the design's
  "ask it things, tell it things" needs the ask side, which is slice 1b and
  needs no new table.
- **NOBODY HAS DRIVEN THE ROUND YET.** Every bug this month was found by
  clicking, and two of them had passing tests over the wrong behaviour.
- **The round is today only.** There is no way to record yesterday's check, so
  a day spent away from a screen is a hole in the record that cannot be filled
  — and the streak treats it as a genuine miss, which it was not. The ops layer
  already takes any `loggedOn`; only the screen is fixed to today.
- **Nothing knows what mortality to EXPECT.** The design wants deviation flagged
  while it can still be acted on — first-week losses point at chick quality or
  brooding, late ones at heat — but that needs a reference rate, which is the
  advisory layer's job rather than a hardcoded table.
- **No voice or natural-language entry.** The design ranks a spoken daily log as
  the single best AI use in this pack because it attacks the thirty-taps-a-day
  problem directly. Slice 1b at the earliest.
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
