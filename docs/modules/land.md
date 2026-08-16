# Land

> The ground the business holds, and what each part of it is for. Two levels of
> place — a **parcel** is the legal unit (a deed or a lease), a **zone** is the
> management unit inside it (a paddock, a bed, a field). Everything spatial in
> every other pack references this one. **The second capability pack (Layer 2a)
> to ship.**
> Status: `available` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

**Read [packs-and-profiles.md](packs-and-profiles.md) first** if you are touching
the pack machinery rather than land itself, and
[extension-model.md](../extension-model.md) §2–§3 before adding anything that
names an industry. The full design this is sliced from lives in
[homestead-farm.md → Category design — Land](homestead-farm.md#category-design--land-brainstormed-2026-08-13);
this dossier is the build record.

## Slice order

Land was the one pack whose design carried no slice order, so proposing one was
the first act of building it. Agreed 2026-08-15:

| # | Slice | State |
| --- | --- | --- |
| **0** | **Places** — parcels, zones, dated zone use | **shipped 2026-08-15** |
| **1** | **Occupancy + rest** — `land_occupancy`, rest days, grazing days, the paddock-count arithmetic | **shipped 2026-08-15** |
| 2a | **Geometry** — GeoJSON polygons, area, point-in-polygon, the map | |
| 2b | **Features** — points and lines: troughs, hydrants, wells, fences, lanes. The `assets` seam | |
| 3 | **Weather + GDD** — Open-Meteo by parcel centroid | |
| 4 | Lease screens, haul movement and cost, the improvement-payback warning | |

Weather is late deliberately and it is not a lapse: Open-Meteo serves history by
lat/long, so a delayed start loses no data. Geometry is late because nothing is
blocked on it and its top-ranked payoff — point-in-polygon pre-filling a zone on
mobile — has no consumer until there are field forms to pre-fill.

**Never in `land`:** profit per acre (downstream of the allocation engine), the
grazing wedge and dry-matter measurement, and every planner including water
layout. Operations first, planning second — and no planner before three
examples exist.

## Build log

### 2026-08-16 — Moving is one act, and the day belongs to one paddock (`claude/move-occupant`)

`moveOccupant` — take an occupant off wherever it is and put it on a zone, in
one call. `startOccupancy` refuses a second open stay for the same occupant,
correctly, but that made MOVING impossible from the animal's own page: the daily
loop was Land → find the paddock → move off → back to the lot → move on. Five
clicks across two modules, times however many groups. Found by driving it.

- **THE DATE RULE IS THE WHOLE DESIGN.** `ended_on` is inclusive, so a move on
  the 16th closes the old stay on the **15th** (`dayBefore`). Closing it on the
  16th would count that day's grazing on both paddocks and inflate every
  rotation figure that reads them — and nothing on any page would look wrong.
  `tests/land-rest.test.ts` states it as a property: the two stays must sum to
  exactly the days that passed.
- **It lives in `land`, not in the pack calling it.** `livestock` should no more
  do arithmetic on `ended_on` than it should know what a paddock is. It calls
  `moveOccupant` and gets back `{ occupancy, movedOff }`.
- **Only an OPEN arrival displaces anything.** Writing up last month's grazing
  must not take them off the ground they are on today — and that is exactly the
  condition `startOccupancy`'s guard fires under, so the two cannot drift.
- **Same-day is clamped, not refused.** Moved the day they arrived gives a
  one-day stay. Refusing would put the user back in the five-click hole this
  exists to close, and one day is the honest record at day granularity.
- **Moving them where they already are is refused** (`ALREADY_THERE`). Changing
  the strip size or the pen is an EDIT of the stay they are on; closing and
  reopening would invent a break in ground they never left. The UI leaves that
  paddock out of the picker rather than offering an option that only errors.
- The dialog says the consequence before it happens — *"They come off Creek
  Paddock the day before, and its rest clock starts there"* — and the toast
  names the paddock now resting. The audit entry records which stay was closed.

### 2026-08-16 — A chest freezer was on the list of places to put chickens (`claude/structure-kinds`)

Found by driving the write-level change on production. `listStructures` selected
every ACTIVE asset with no filter at all, so the picker headed *"In a pen or
barn"* offered **Chest freezer** and **Tractor** alongside the garage. The
function's name claimed a filter it never applied, and nothing in ~1,500 tests
was ever going to say that out loud.

- **`structureKindsFrom(config)`** in `vocabulary.ts`, the third instance of the
  pattern `areaUnitFrom` and `speciesFrom` established: read a key out of
  `packConfig.land`, total by construction, tenant-tailorable through
  `tenant_modules.config`.
- **The default is `building` + `infrastructure`** — a thing you put up and then
  put something inside. Industry-neutral, per ADR 0004.
- **`equipment` is deliberately excluded even though a chicken tractor is
  equipment.** That tension is the whole reason this is config and not a
  constant: the homestead-farm profile adds `chicken_tractor`, `hoop_house`,
  `coop` and `barn` on top, and a tenant can add their own.
- **`listStructures` now REQUIRES the kinds argument.** An optional one with a
  default would let the next caller reintroduce the bug by not thinking about
  it; a required parameter makes not thinking about it a compile error.
- **An empty list is honoured as an answer**, not read as "no filter" — a farm
  that keeps nothing in a structure gets no picker.
- The livestock page resolves LAND's pack context to get this, and hands the
  config straight back to `structureKindsFrom` rather than reading a key out of
  it. That is the `requires` seam working: livestock never learns what a
  structure kind is.

### 2026-08-15 — Moving the herd stops being an owner's job (`claude/pack-write-levels`)

Platform-wide change; the reasoning is in
[packs-and-profiles.md](packs-and-profiles.md). What it means here:

- **Occupancy is a chore.** `startOccupancy`, `endOccupancy` and
  `deleteOccupancy` are open to any member. Moving the herd to the next paddock
  is the most frequent act on a rotational farm, and the person doing it is
  holding a reel of polywire. Every rest and rotation number on the zone page is
  computed from those rows, so a rule that stops the hand recording them stops
  the page from meaning anything.
- **The shape of the farm is a decision.** Parcels, zones and zone uses stay
  owner-only — a deed, a fence and what the ground is for, each of them a cost
  object.
- The zone page's occupancy controls are no longer behind `isOwner`.

### 2026-08-15 — Occupancy names the STRUCTURE, and a wrong guard came out (`claude/occupancy-structures`)
- **A pen, a barn or a chicken tractor can now be named on an occupancy.** From
  the founder: *"sometimes there is no structure. cattle just roam in the zone,
  but chickens are assigned to a pen."* So `structure_asset_id`, nullable, and
  **null is a real answer rather than a missing one** — the UI says "Loose on
  the paddock", not nothing.
- **A structure is an ASSET, so `land` now requires `assets`.** The design
  settled this before either pack existed: a chicken tractor is an asset that
  holds a lot and sits on a zone. A structures table here would be that same row
  a second time, without its depreciation or its service schedule. It lives on
  `land_occupancy` rather than on `livestock` because it generalises — a
  greenhouse holds a planting exactly as a pen holds a flock.
- **THE REQUIREMENT EXPOSED A GUARD THAT WAS WRONG.** Slice 1 refused a second
  open stay on a zone, reasoning that two would make rest unanswerable. Both
  halves were false: `zoneRest` already takes the LATEST end date across every
  span, and a paddock really does carry several occupants at once — the pilot
  runs multiple chicken tractors on one paddock, and this design's own eggmobile
  follows the cattle onto ground they are still grazing. **The guard is now
  about the OCCUPANT**: the same lot cannot be in two places, which is a data
  mistake rather than a farming arrangement. Hand-entered records are exempt,
  having no identity to compare.
- `occupantsInStructures` answers *"what is in Pen 3"* without joining into any
  pack, because the occupant label is a copy.
- The wrong guard shipped with a test that asserted it, which is worth noting:
  **a test can lock in a mistake as firmly as it prevents one.** It took a
  requirement from someone who keeps animals to notice.

### 2026-08-15 — Slice 1: occupancy, and rest computed from it (`claude/land-occupancy-rest`)
- **The pack stops being a register and starts answering a question.** One
  table, `land_occupancy`, and every rest and rotation number on every screen is
  derived from it. Nothing is stored twice and nothing is entered twice.
- **`land` owns the table even though the fact is `livestock`'s.** Settled
  before building: rest is computed FROM occupancy and a pack may not read
  another pack's tables, so the record lands with the thing that reads it. The
  occupant is **described, not joined** — `occupant_label` is a copy, exactly as
  `dimension_members.display_name` is, so a rest report never needs a pack that
  may not be installed.
- **A manual form ships with it**, which is the point of the slice: the occupant
  is a name a person types today, and `livestock` writes the same row with a
  real lot id later. **A rest clock that only starts working after two more
  packs ship is a rest clock nobody ever sees.**
- **The strip decision is now real.** `area_acres` on the stay, null meaning the
  whole zone. A strip grazer records 0.4 of a 10-acre paddock and no new place
  is created; a fixed-paddock user leaves it blank. One model, no branch.
- **Several occupants may be on one zone at once, and the guard is about the
  OCCUPANT, not the zone.** The same lot in two places is a data mistake and is
  refused; two different lots on one paddock is ordinary — the pilot runs
  several chicken tractors on a paddock, and the eggmobile follows the cattle
  onto ground they are still grazing. Corrected 2026-08-15, after the stricter
  rule shipped with a test asserting it. `zoneRest` was always fine with it: it
  takes the latest end date across every span.
- **A structure is an asset, never a place of its own.** If a "pens" table ever
  appears in this pack, it is the same asset row a second time and the
  depreciation will not follow it.
- **`never_grazed` is not `resting`.** A paddock nobody has used and one resting
  200 days are different facts; collapsing them would put every new zone at the
  top of a "most rested" list on the day it was created.
- **The rest target is a comparison line, not a setting** — nullable, on the
  parcel, consulted by no write path. It sits on the parcel because the clock is
  discontinuous across a seasonal move, and one farm-wide number would flag a
  wintering parcel wrong all summer.
- **The finding is on the page.** `rotationFinding` runs the standard formula
  over the record and says, in a sentence, that 12 paddocks at a day each
  deliver 11 days of rest against a 21-day target and 22 would be needed — from
  numbers the app already held. It returns null rather than guessing below three
  completed stays.
- **Migration 0134 was NOT reordered**, and that is the rule working rather than
  being forgotten: its composite FK targets `land_zones`, whose unique index has
  existed since 0132. The trap only bites when the target table is new too.
- Zone detail page added, which slice 0's open items called for.
- 26 pure tests, 20 more ops tests, 6 more isolation tests.

### 2026-08-15 — The use picker was defaulting to a house site (`claude/land-use-picker-default`)
- **Found in the first minute of driving slice 0 on production**, and by nothing
  else. "What is North Pasture for?" opened with **Building site** selected and
  *Expected to earn* switched off — because the option list was sorted
  alphabetically and `building_site` wins that race. Anyone pressing the obvious
  button would have recorded their best ground as earning nothing, which is the
  single worst value in the list and it was the default.
- **Two fixes, and the second is the one that matters.** The list now renders in
  its declared order (productive uses first), and a zone with no use declared
  yet **pre-selects nothing at all** — the placeholder shows and *Record use* is
  disabled until somebody answers the question. A dialog that asks a question
  should not also supply the answer.
- A zone that already has a use still pre-selects it, because that one is the
  current answer rather than a guess.
- The ordering is now a tested invariant (`tests/land.test.ts`): no productive
  use may appear after a non-productive one, which is the property the picker
  depends on.
- **Nothing was wrong with the data model, the ops, or the 93 tests.** They all
  passed, and would have gone on passing.

### 2026-08-15 — Slice 0: parcels, zones, and use as a dated fact (`claude/land-places`)
- **The substrate now exists**, which is what `livestock` and `crops` were
  waiting for. Three tables under FORCE RLS, two dimension types, a list and a
  detail route.
- **Use is a dated history from the first commit, never a column.** This year's
  corn field is next year's pasture, and a `use` column migrated into a table
  later would already have thrown away the only thing that makes rotation
  reportable. The superseding rule is visible in the UI on day one: declaring
  pasture from 2026-04-01 closed the previous crop use at **2026-03-31**.
- **Two dimension types, `parcel` and `zone`.** Rent, property tax and interest
  are consequences of the deed; fence repair, mowing and seed belong to the
  paddock. One type would put deed-level rows in the column headings of a report
  about paddocks.
- **`resolveLabels` has its first caller**, built and tested and unread since
  Layer 2 shipped because no pack had a word worth overriding. Land does: a
  homestead says *paddock*. Verified live — the page renders "Paddocks (5)" and
  "In paddocks" from `tenant_modules.config.labels`, and "Zones" with no profile.
- **`packConfig` has its first real consumer** too. `areaUnit` flips the whole
  surface to hectares, which is the half of P5 that `assets`'s hardcoded kind
  list has been waiting on.
- **Tenure is a CLOSED set while zone use is OPEN**, and the asymmetry is the
  point: a use is vocabulary, a tenure is behaviour. Crop share is a revenue
  split, not an expense, so a fourth tenure with no defined accounting is worse
  than a refusal.
- **Nothing unmeasured is allowed to read as zero.** Area is nullable, renders
  as `—`, and every total reports its unknowns — *"184.5 acres (1 not
  recorded)"*. A zero acre count is a divide-by-zero waiting in every per-acre
  report, and the CHECK refuses one outright.
- Migration `0132` **hand-reordered again** — third time. Both composite FKs
  target unique indexes created in the same migration.
- 47 pure tests, 30 ops tests, 16 isolation tests.
- **Found while driving it, and it was not this pack:** every nested route under
  `/dashboard/m/*` 404s in dev when `next dev` starts on a `.next` directory
  left by `next build`. See Decisions.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `land_parcels` | One row per deed or lease | `tenant_id`, FORCE RLS (`land_parcels_superadmin_all`, `land_parcels_member_all`). CHECKs: `tenure` in `owned\|leased\|crop_share`; `status` in `active\|retired`; name non-blank; area null or **> 0** |
| `land_zones` | Management units inside a parcel | Composite FK `land_zones_parcel_fk` on `(tenant_id, parcel_id)` → `(tenant_id, id)`, **RESTRICT**, so cross-tenant nesting is unrepresentable and a parcel cannot be deleted out from under its zones |
| `land_zone_uses` | What a zone is for, over a date range | Composite FK to the zone, **CASCADE**. `ended_on` is **INCLUSIVE**; null means current. CHECK `ended_on >= started_on`; `use` matches `^[a-z][a-z0-9_]{0,62}$` (**format only**) |
| `land_occupancy` | What was actually ON a zone, in what structure, and when | Composite FK to the zone, **CASCADE**. `ended_on` inclusive; null means still there, which is what makes a zone read as occupied. `extension_slug` + `occupant_type` + `occupant_id` describe the occupant (P3); `occupant_label` is a **copy**. `area_acres` null means the whole zone |

Mirrored into **`dimension_members`** with `dimension_type = 'parcel'` and
`'zone'`, in the same transaction as the write. That is what makes ground a cost
object the existing P&L can group by, and it is the whole reason this pack is
worth more than a list of field names.

**Not columns, deliberately** — each would be a column with no reader today:
**geometry** (slice 2, GeoJSON in jsonb, no PostGIS), **centroid** lat/long
(derivable from geometry, so it arrives with the slice that can derive it),
**occupancy** (slice 1, a table), and **lease terms** (slice 4). `tenure` is the
exception and is here now on purpose: profit per acre computes differently on
rented ground, and retrofitting it means rewriting the report.

## Key files & seams

- `src/packs/land/ops.ts` — all reads and writes. Takes a `Tx` so the caller
  owns the transaction; that is what keeps a write and its dimension sync atomic.
  **`moveOccupant` is the one other packs call** — `startOccupancy` puts
  something somewhere, `moveOccupant` takes it off wherever it was first
- `src/packs/land/core/area.ts` — pure. Unit conversion, formatting, totals that
  report their unknowns, and parcel-vs-zone coverage
- `src/packs/land/core/rest.ts` — pure. Rest and grazing days from spans, the
  `paddocks = (rest ÷ graze) + 1` formula both directions, and the rotation
  finding. **The one file to read before changing anything about rest**
- `src/app/dashboard/m/land/[id]/zones/[zoneId]/page.tsx` — the zone detail
  route, nested under its parcel so the URL says where the zone lives
- `src/packs/land/actions.ts` — `requireTenant` + `requireModuleEnabled` +
  `withTenant({ role })` on every action
- `src/packs/land/vocabulary.ts` — no imports, no directive, so client
  components can read it without dragging drizzle into the bundle
- `src/packs/land/LandModule.tsx` — the renderer
- `src/app/dashboard/m/land/[id]/page.tsx` — the parcel detail route. **A pack's
  sub-routes live under `src/app/`**, guarded with `requireModuleEnabled`
- `src/lib/packs/tenant-context.ts` — **Layer 0, not the pack.** Resolves a
  tenant's labels and a pack's config. `land` is its first caller; every
  later pack uses it unchanged
- `src/db/schema/land.ts` · `drizzle/0132_*.sql` · `drizzle/0133_land_rls.sql`
- `tests/land.test.ts` · `tests/land-ops.test.ts` · `tests/isolation/land.test.ts`

## Decisions & gotchas

- **`land` owns occupancy, even though occupancy is not land's fact.** Settled
  2026-08-15. The design says occupancy comes from `livestock` and `crops`, and
  it does — but rest is computed *from* occupancy and
  [extension-model.md §4](../extension-model.md) forbids a pack reading another
  pack's tables. So the table lands here with an open `occupant_type` +
  `extension_slug` (the `work_item_links` P3 pattern) and the other packs write
  into it through land's ops. Land owns the place and the clock; it stays
  ignorant of what a lot is.
- **Acres are canonical, and the column name says so.** Something has to be, or a
  farm with one parcel in acres and one in hectares cannot be totalled.
  `packConfig.land.areaUnit` is a display and entry unit, converted at the edge
  in `core/area.ts`. US-only geodata is confirmed acceptable for this profile.
- **Unknown is not zero, anywhere.** Nullable area, `—` in every cell, and
  `formatAreaTotal` says *"not recorded"* rather than *"0 acres"* when nothing is
  known. `zoneCoverage` refuses to compute a remainder when any zone is
  unmeasured, because that subtraction would be a guess wearing a number's
  clothes.
- **`ended_on` is INCLUSIVE.** Stated loudly because this repo has been bitten by
  an exclusive bound before (`after` on Stalwart, contra RFC 8621), and because
  `startZoneUse` closes a superseded use at `new_start - 1 day`, which only reads
  correctly if the bound is inclusive.
- **A use that never elapsed is deleted, not closed.** Superseding an open use
  that started on or after the new date would need an `ended_on` before its own
  `started_on`, which the range CHECK rightly refuses. It is not history being
  lost: it is a row entered by mistake minutes ago, describing a period that
  never happened.
- **Day arithmetic happens in SQL, never in `Date`.** Same family of bug as the
  month arithmetic `assets` wrote up: `new Date("2026-03-01")` minus a day is a
  timezone question in JS and is not one in Postgres.
- **Retiring a parcel cascades to its zones**, and the dialog says how many
  before the button is pressed. Ground you no longer hold has no active paddocks
  on it, and a cascade nobody expected is discovered a week later when a picker
  is empty.
- **Zones do not have to tile a parcel.** Lanes, ditches and the bit behind the
  barn are real and frequently unmapped, so coverage is REPORTED and never
  enforced. A constraint here would make the honest state unrepresentable.
- **Rest is an outcome and the code has to keep it that way.** `rest_target_days`
  exists, and it would be easy to mistake for the thing the design forbids. The
  line: nothing schedules against it, no write path consults it, and nothing is
  refused for missing it. It is a number a report draws a line at. If anything
  ever branches on it, that decision has been reversed by accident.
- **Only an open second stay is refused.** The guard exists because `zoneRest`
  reads an open stay as "occupied" and two of them make the rest clock
  unanswerable — not because a zone can only hold one thing. Closed overlaps are
  legitimate and the pilot has them.
- **A MOVE is not two stays, it is one act** — `moveOccupant`. The guard above
  is right and made moving impossible from the occupant's own page, which is a
  reminder that a correct refusal can still be a broken workflow. The day the
  move happens belongs to the NEW paddock only; see the 2026-08-16 entry.
- **A day count is inclusive at both ends.** On Monday, off Monday is one day of
  grazing. It feeds the paddock arithmetic, so an off-by-one there reaches every
  rotation figure on the page.
- **drizzle-kit emits every FK before every index** — hit three times (`0125`,
  `0130`, `0132`) and NOT on `0134`. The rule is *check whether the FK's target
  unique index is created in the same migration*, not *always reorder*: a
  composite FK to a pre-existing table is fine as generated.
- **`next dev` on a `.next` left by `next build` silently breaks nested
  routing.** Every route under `/dashboard/m/<static>/…` 404s with no compile
  line in the log — including long-shipped ones like
  `/dashboard/m/accounting/journal/[id]`. It looks exactly like a broken new
  route and it is not. `rm -rf .next` before `npm run dev` if you have just
  built. Cost most of an hour on this slice.
- **An isolation test cannot cover a pack's ops**, by design: that suite builds
  fixtures under `withSystem` so a bug in the ops cannot make it agree with them.
  A pack therefore needs BOTH files, and the ops one is where the dimension-sync
  guarantees live.
- **RLS is tenancy, not role.** Land has no owners-only subset, so these tables
  do not reach `app_tenant_role()` the way `document_folders` must. Who may write
  is an application concern, decided in the ops layer through `allowsWrite()`
  (`src/lib/packs/authorize.ts`): the shape of the farm — parcels, zones, uses —
  is the owner's, because each carries a cost object; occupancy is a chore and
  open to any member.
- **A structure is an ASSET, and which kinds count is config.** `land_occupancy`
  points at `assets`, so the set of things that can hold animals is whatever the
  tenant owns — which means the picker has to be filtered by kind, and the kind
  taxonomy is open. `structureKindsFrom` is the filter and
  `packConfig.land.structureKinds` is where it comes from. See the 2026-08-16
  build log entry for what unfiltered looked like.

## Open items

- ~~The owner write path has never been exercised in a browser~~ — **closed
  2026-08-15.** Driven on production: create a parcel, add a zone, declare a
  use, supersede it. The supersede showed *"Pasture (to 2026-06-14)"* against
  hay starting 2026-06-15, which is the inclusive bound doing its job on real
  data. It also immediately found the use-picker default above — the first
  build-log entry of this pack that exists because somebody clicked something.
- **A zone's dimension member is its bare name**, so two parcels with a "North
  Pasture" produce two identically-labelled columns in a P&L split by zone.
  Prefixing the parcel would make the headings unreadable; disambiguating only on
  collision is the likely answer, and it needs deciding before there is data.
- ~~No zone detail page~~ — **built in slice 1.**
- **Nobody has driven slice 1 yet.** It was written, migrated against both
  databases, and covered by 52 tests, but the local dev session is `org:member`
  and the production deploy is what can actually be clicked. Slice 0 shipped a
  bug that only clicking found; assume this one has too until somebody looks.
- **Stocking density stops at area.** Land supplies the acreage a stay used;
  head count belongs to `livestock`, so animal-units-per-acre cannot be computed
  until that pack exists. Deliberate — a `head` column here would be this pack
  growing an opinion about its neighbours.
- **Moving a herd across ten paddocks is ten dialogs.** The design's *"move
  every pen to the next paddock is one action"* is exactly what this does not do
  yet, and it is the entry-cost problem the 10× target names. Purely additive.
- **A stay cannot be edited**, only ended or removed. Fixing a wrong start date
  means deleting and re-recording.
- **The rotation finding is per parcel and needs three completed stays.** Below
  that it says nothing, which is right, but it also means the pilot's most
  interesting number does not appear until the habit has held for a week.
- **Zone use suggestions are hardcoded** in `vocabulary.ts`, exactly as
  `assets`'s kinds are. They should come from profile `packConfig` once P5
  exists — and now two packs are waiting on it rather than one.
- **Retired parcels are opt-in on the list** (`?retired=1`) with no UI control to
  set it. The query param works and nothing renders a toggle.
- **A retired zone cannot be un-retired**, and neither can a parcel. Retirement
  is deliberately not a delete, but it is currently also not reversible, which is
  a harsher rule than intended for what is often a mis-click.
- **No bulk entry.** Twenty paddocks is twenty dialogs. The design's *schema at
  10×, UI at 1×* rule says this is correct for now and that a grid is purely
  additive — but 200 paddocks is the number that makes it urgent.
- **Nothing validates that a zone's area fits its parcel**, by design (see
  Decisions) — but nothing surfaces a wildly over-assigned parcel either beyond
  one line on the detail page.
