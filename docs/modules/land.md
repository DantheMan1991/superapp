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
| 1 | **Occupancy + rest** — `land_occupancy`, rest days, grazing days, the paddock-count arithmetic | next |
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
  owns the transaction; that is what keeps a write and its dimension sync atomic
- `src/packs/land/core/area.ts` — pure. Unit conversion, formatting, totals that
  report their unknowns, and parcel-vs-zone coverage
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
- **drizzle-kit emits every FK before every index** — hit for the third time
  (`0125`, `0130`, `0132`). Reorder to: tables, unique indexes, foreign keys,
  everything else.
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
  is an application concern — owner-only, forced from below by
  `upsertDimensionMember` calling `requireOwnerRole`.

## Open items

- **The owner write path has never been exercised in a browser.** The 30 ops
  tests cover it, but the Clerk dev session available while building this slice
  is `org:member` on the Test org, and owner comes only from Clerk `org:admin` —
  so every create, edit, retire and use dialog rendered for nobody. Given that
  every real bug this week was found by driving the app, this is the first thing
  to close, not a footnote.
- **A zone's dimension member is its bare name**, so two parcels with a "North
  Pasture" produce two identically-labelled columns in a P&L split by zone.
  Prefixing the parcel would make the headings unreadable; disambiguating only on
  collision is the likely answer, and it needs deciding before there is data.
- **No zone detail page.** Zone edits and the use timeline live in dialogs on the
  parcel page, which is enough for slice 0 and will not be once occupancy,
  rest days and geometry all want somewhere to render. Slice 1 builds it.
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
