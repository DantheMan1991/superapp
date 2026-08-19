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
| 1 | Receipts and issues — closes the `livestock` costing loop | next |
| 2 | Adjustments, physical counts, expiry/FEFO | |
| 3 | Valuation + COGS posting, basis-aware | |
| 4 | Commitments (pre-sold halves) — needs `production` and `retail` | |
| 5 | Reorder points, capacity warnings — needs history | |

## Build log

### 2026-08-19 — A second read, this one for the advisor (`claude/livestock-advisor`)

`datedMovementsForLots` — movements for a set of lots, newest first, capped.
`movementKindsForLots` drops the date because a BALANCE does not need one; a
DIAGNOSIS does, and livestock's advisor needs to know that seven of eight birds
died on days 22 and 27 rather than merely that eight died.

It has no opinion about which kinds are deaths. That classification is
`livestock`'s and stays there, as it has since its slice 0.

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
| `inventory_movements` | **The ledger.** Every quantity change | Composite FKs to item, lot and **`assets`** (the location). `quantity` is signed and CHECKed non-zero. FORCE RLS in its own right — it is the traceability chain |

Lots mirror into **`dimension_members`** with `dimension_type = 'lot'`, in the
same transaction as the write.

**Not columns, deliberately** — each would have no reader today: cost and
valuation (slice 3, and basis-aware per ADR 0007), expiry and FEFO (slice 2),
reorder points and capacity (slice 5), and commitments — a pre-sold half is
never inventory, it goes from a commitment against a live animal to delivered
without sitting on a shelf.

## Key files & seams

- `src/packs/inventory/core/units.ts` — pure. The three kinds of conversion, and
  why only two of them live in code
- `src/packs/inventory/core/balances.ts` — pure. The fold. **Read this before
  changing anything about quantities**
- `src/packs/inventory/ops.ts` — all reads and writes, takes a `Tx`. `splitLot`
  and `mergeLot` are the only operations that change cardinality
- `src/packs/inventory/actions.ts` — `requireTenant` + `requireModuleEnabled` +
  `withTenant({ role })` on every action
- `src/app/dashboard/m/inventory/[id]/page.tsx` — the item detail route
- `src/db/schema/inventory.ts` · `drizzle/0136_*.sql` · `drizzle/0137_inventory_rls.sql`
- `tests/inventory.test.ts` · `tests/inventory-ops.test.ts` · `tests/isolation/inventory.test.ts`

## Decisions & gotchas

- **NEGATIVE STOCK IS ALLOWED, and it is not a bug.** Somebody issues feed on
  Tuesday and records Monday's delivery on Wednesday; a system that refuses the
  Tuesday entry teaches people to stop entering things, which costs far more
  than a temporarily wrong number. It is surfaced on the item page and corrected
  by an adjustment or a count in slice 2. Do not "fix" this.
- **The stocking unit is immutable once anything has moved.** Converting the
  column alone would re-denominate every historical movement silently.
- **Live-to-hanging is a production YIELD, not a unit conversion.** A steer goes
  in at 1,150 lb and hangs at 690. Modelling that as a factor bakes an
  unauditable fudge into the books and every carcass is quietly wrong. It
  belongs to `production`; inventory must have no opinion on it.
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
- **No transfer between locations.** Moving stock from the barn to a freezer is
  two movements, and the UI does not offer it as one act.
- **Item-specific purchase conversions are entered as free text.** "bag" is not
  validated against anything, so two items can spell it differently.
- **`wouldGoNegative` has no caller.** Written for a warning the UI does not yet
  show.
- **No traceability view.** Lineage is recorded and `lotAncestry` walks it, but
  nothing renders the chain from an animal to a package.
