# Homestead Farm (industry profile)

> The first industry profile on the platform (Layer 2b). A homestead is roughly
> eight micro-businesses sharing one set of books — land, animals, gardens,
> processing, baking, retail — which makes it the hardest possible first
> industry and therefore the best test of whether
> [ADR 0004](../decisions/0004-capability-packs-and-industry-profiles.md)'s pack
> model actually holds. Four of its seven packs are neutral enough that the
> contractor market reuses them.
> Status: `coming_soon` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->

**Pilot tenant: the founder's own farm.** Every category below gets brainstormed
against a real operation before it is sliced, and the profile is expected to be
wrong in ways only daily use will surface. [ADR 0009](../decisions/0009-packs-are-modules-profiles-install-them.md)
chose the installer model specifically so that acting on what the pilot learns
is a toggle rather than a deploy.

## The pilot operation

Design against these numbers, not against an imagined homestead. **1,000 meat
birds is a real pastured-poultry enterprise**, not a hobby — the profile has to
survive commercial scale in at least one enterprise from day one.

| Stock | Count | Tracked as | Output shape |
| --- | --- | --- | --- |
| Cattle | 10 | Individuals | Terminal (meat) |
| Pigs | 6 | One group, split at slaughter booking | Terminal (meat) |
| Laying hens | 50 | One flock | **Recurring yield** (eggs, daily) |
| Meat chickens | 1,000 | Groups of ~70, **one per pen** | Terminal (meat) |

**Sells inspected meat.** Confirmed 2026-08-13. Traceability and lot codes are
therefore mandatory and cannot be a late slice — see the `production` notes.

**Both processing paths are in use.** Chickens are processed on-farm without
inspection *sometimes* and sent to a butcher *other times*, and there are
**multiple butchers**. The 1,000 broilers are **batched through the season**,
not raised concurrently.

### Design target: this farm and one 10× its size

> Stated by the founder 2026-08-13: *"I want this application built for farms my
> size and ones 10x mine."*

10× is ~100 cattle, ~60 pigs, ~500 layers, ~10,000 broilers. The governing rule
that came out of thinking about what actually breaks:

> **Schema at 10×, UI at 1×.** Lot cardinality, lineage and cost allocation are
> rewrites if they are wrong, so take the 10× shape in the data model now.
> Bulk-entry grids and offline sync are purely additive, so build them when the
> pens outnumber your patience.

What 10× does **not** break: storage (Postgres is indifferent), tenancy, or the
lot model — 100 cattle as individual lots is still correct, since cattle
operations track individuals into the several hundreds before going to groups.

What it **does** break:

- **Data entry.** A farm 10× the size has 2–3× the people, so per-record entry
  cost must fall by roughly an order of magnitude or the system goes unused —
  the normal fate of farm software. Daily mortality across 20 pens is one grid,
  not 20 forms. "Move every pen to the next paddock" is one action. Field
  recording is mobile and tolerates no signal.
- **Direct cost assignment.** At 1× a bag of feed goes to a pen and you know it.
  At 10× feed arrives by the ton into a bin serving 15 pens, so cost must be
  **allocated** by a rule (headcount × days on feed), not assigned. Same for
  labour across pens and tractor hours across fields. See the allocation note
  below — this is the single largest consequence of the 10× target.

## Build log

### 2026-08-13 — Categories captured, pack roster mapped (`claude/packs-and-profiles-design`)
- Founder walked through twelve operational categories (below, as given).
- Mapped them onto a pack roster. The headline: **twelve categories collapse to
  seven packs, only two of which are agricultural.** Three categories need no new
  code at all — they are core modules that already ship.
- Two collapses drove most of the reduction: land/buildings/equipment are one
  `assets` shape with an open `asset_kind`, and butchering/baking are one
  `production` shape (inputs + labour → outputs at a yield, cost rolled).
- Pilot operation captured with real numbers, and **the profile is one SKU** —
  the SKU is the profile, never the pack (reasoning in
  [packs-and-profiles.md](packs-and-profiles.md) Decisions).
- Confirmed the farm **sells inspected meat**, which reshaped `production` from
  an on-farm conversion into an external one (book a date, deliver, receive
  boxed cuts) and promoted traceability to a hard requirement.
- Settled the livestock shape: **every animal record is a lot, an individual is
  a lot of one**, with the pen as the cost object and lineage on every lot.
- Founder set the design target at **this farm and one 10× its size**, which
  promoted **cost allocation** to a first-class concern and produced the
  governing rule *schema at 10×, UI at 1×*.
- Learned both processing paths are in use with multiple butchers, which moved
  the processing path onto the *run* rather than the species and surfaced two
  compliance features that fall out of data already being recorded: **channel
  eligibility on finished lots** and **the on-farm exemption counter**.
- No code. Machinery design is in [packs-and-profiles.md](packs-and-profiles.md).

## The categories, as given

Captured verbatim in substance so nothing is lost between brainstorms. Founder's
own words condensed, not reinterpreted.

| # | Category | What was asked for |
| --- | --- | --- |
| 1 | **Land** | Map the property and rented ground. Zones/sections with uses (crops, cow field). Land management: fencing that needs weed-whacking on a schedule, grass growth per section, rainfall and its effect on crops. Profitability per acre, cost of land, mowing. |
| 2 | **Buildings** | What each building is used for, maintenance needed, cost of upkeep, planning for new buildings. |
| 3 | **Equipment** | Inventory, cost, upkeep cost, maintenance, planning purchases and sales. |
| 4 | **Livestock** | Inventory of animals, breeds and genetics, health, feed rates, water intake, pasture rotation, butcher dates, birthing dates, feed purchasing, animal purchasing. |
| 5 | **Gardens / crops** | Soil improvement, planting dates, weeding, watering, growth and health tracking, produce storage, mulching, pest prevention, harvesting. |
| 6 | **Retail** | Selling produce, baked goods and meat at farmers markets, online, and at the farm store. |
| 7 | **Marketing** | Branding, website, social media. |
| 8 | **Accounting** | All the farm's books. Job costing per animal, land and equipment depreciation, profit per acre, tax preparation. |
| 9 | **Communication** | *(to be described)* |
| 10 | **Butchering** | *(to be described)* |
| 11 | **Scheduling suppliers/vendors** | *(to be described)* |
| 12 | **Baking** | *(to be described)* |

## Pack roster

| Category | Lands in | Farm-specific? | Brainstormed? |
| --- | --- | :---: | :---: |
| Land | `land` pack — parcels, zones, geometry, area | no | first pass |
| Buildings | `assets` pack, `asset_kind = 'building'` | no | first pass |
| Equipment | `assets` pack, `asset_kind = 'equipment'` | no | first pass |
| Livestock | `livestock` pack | **yes** | **partial** — lot model + pen settled; health, breeding, feed, water, rotation still open |
| Gardens/crops | `crops` pack | **yes** | first pass |
| Butchering | `production` pack | no | **partial** — external-conversion shape settled, nothing else |
| Baking | `production` pack — same tables | no | not yet |
| Retail | `inventory` + `retail` packs | no | first pass |
| Marketing | core CRM + email; thin pack at most | no | first pass |
| Accounting | **core module, already built** — seed + config | — | first pass |
| Communication | **core email + CRM, already built** | — | not yet |
| Scheduling vendors | **core scheduling + party spine, built** | — | not yet |

Seven packs: `land`, `assets`, `inventory`, `livestock`, `crops`, `production`,
`retail`. Two are agricultural.

### What this buys other industries

The point of the pack split, made concrete. Three of these profiles do not exist
and may never, but the columns show what is *not* farm-shaped:

| Pack | homestead-farm | cattle-ranch | market-garden | plumbing |
| --- | :---: | :---: | :---: | :---: |
| `assets` | ● | ● | ● | ● |
| `inventory` | ● | ● | ● | ● |
| `land` | ● | ● | ● | |
| `livestock` | ● | ● | | |
| `crops` | ● | | ● | |
| `production` | ● | ● | | |
| `retail` | ● | | ● | |

Building the pilot farm delivers `assets` (trucks, tools, depreciation, service
intervals) and `inventory` (parts, stock, reorder points) to the contractor
market as a side effect.

## The spine

Everything below is downstream of one idea, and a pack that forgets it has built
a to-do list instead of a business tool:

> **Every farm activity posts a cost to a cost object, and the cost object is a
> `dimension_member`.**

A pasture, a cow, a bake batch, a tractor. [dimensions.ts:9](../../src/modules/accounting/core/dimensions.ts:9)
is explicitly the pack seam — packs sync their entities into `dimension_members`
in the same transaction as their own CRUD, and the existing P&L groups by them.
Profit per acre and cost per finished hog are therefore reporting questions, not
new features.

This is also the differentiator. The cheap end of farm software tracks activity
and has no books; the accounting end has books and knows nothing about a
paddock. The whole reason this profile is worth building is the join.

## Per-category brainstorm status

The agreed rhythm: **brainstorm a category → capture it here → slice it →
build → update this log.** No category gets sliced off a first pass alone.

- **First pass done** (recorded in session 2026-08-13, needs a real brainstorm
  before slicing): land, buildings, equipment, livestock, gardens/crops, retail,
  marketing, accounting.
- **Not yet described** by the founder: communication, butchering, scheduling
  suppliers/vendors, baking.

Notes worth keeping from the first pass, because they are the load-bearing
design calls and the ones most likely to be got wrong twice:

- **Land is the substrate.** Livestock rotate through zones, beds sit in
  gardens, equipment is stored in buildings, buildings sit on parcels. Build the
  spatial model before anything that references a place, or `location_id` gets
  retrofitted into six tables.
- **Zone use must be dated, not a column.** This year's corn field is next
  year's pasture, and the history is what makes rotation reporting possible.
- **Parcel tenure matters.** Owned, rented, leased, handshake — profit per acre
  is a different conversation on ground rented at $80/acre.
- **Every animal record is a lot; an individual is a lot of one.** The pilot
  numbers force both shapes at once (10 named cows, 6 pigs as a group, 50
  layers as a flock, 1,000 broilers as ~14 pens). Modelling them as two entities
  means every downstream table — feed, cost, movement, mortality, dimension sync
  — needs two code paths and a polymorphic target. As lots, there is one target,
  and "promote the pigs to individuals when the slaughter date is booked"
  is a **split**, not a migration between models. Split and merge are the only
  operations that change cardinality. Most livestock software fails exactly here.
- **Lots carry lineage; the batch is the root lot.** Broilers are batched
  through the season, so a batch of chicks arrives as one purchase, splits
  across pens, may consolidate as birds grow or after losses, and may leave for
  processing on different dates. Every lot knows its parent — split creates
  children, merge creates a parent. What makes this convincing rather than
  merely tidy: **lineage is demanded independently by two unrelated forces**,
  batch-and-pen management on one side and inspected-meat traceability on the
  other. One mechanism serves both.
- **The pen is the cost object, not just a location.** Feed goes to a pen,
  mortality happens in a pen, and a pen's birds go to the processor together and
  return as one inventory lot. So the pen is what syncs into `dimension_members`
  and profit-per-pen is free. Its shape spans three packs cleanly: a chicken
  tractor is an **asset** (depreciates, needs repair) that **holds a lot** and
  **sits on a zone** with a location history. That history prices the fertility
  transfer to the crop side — poultry manure is a real input with a real dollar
  value, and nothing else on the market accounts for it.
- **Livestock has two output shapes.** Terminal (cattle, pigs, broilers become
  meat once) and recurring yield (layers produce daily, as would a dairy cow).
  Same lot upstream, different tables downstream. Designing for one and
  discovering the other later is a rewrite.
- **The profit metric differs per species and must be visible while it can still
  be acted on.** Broilers live or die on feed conversion ratio and mortality —
  placement count vs processed count. At 1,000 birds the gap between 5% and 12%
  loss is most of the margin. Cattle are cost per finished animal; layers are
  eggs/hen/day and feed cost per dozen.
- **Withdrawal periods are a legal constraint.** After treatment, milk and meat
  cannot be sold for N days. The system should refuse to book slaughter or
  bottling inside the window. Cheap to build, worth more than most tracking.
- **Gestation is deterministic** — cow 283d, pig 114, sheep 147, goat 150,
  chicken 21. A breeding date yields the due date, dry-off and vaccination
  windows for free.
- **Traceability falls out of `production` writing lots, or is impossible.**
  "This pack of ground beef came from animal #47, processed 3/12, sold Saturday"
  cannot be retrofitted, and the pilot farm **sells inspected meat**, so it is a
  legal requirement rather than a nicety.
- **Cost allocation is first-class, not an afterthought.** Forced by the 10×
  target: most cost at scale is allocated by a rule rather than assigned
  directly. Two consequences. (1) **Core needs no change** — the pack computes
  the allocation and posts ordinary journal lines carrying dimension members,
  so core stays neutral exactly as [ADR 0004](../decisions/0004-capability-packs-and-industry-profiles.md)
  requires. (2) **The math has a house precedent and must follow it**:
  [cash-basis-allocate.ts](../../src/modules/accounting/core/cash-basis-allocate.ts)
  is "THE ONE PLACE IN REPORT MATH THAT DIVIDES", quarantined with an exact
  remainder rule so no cent is invented or lost. Splitting a feed bill across
  pens is the same problem; it does not get its own rounding.
- **The processing path belongs to the run, not the species.** The same batch of
  birds may be processed on-farm uninspected or sent out to a butcher, decided
  at booking. Modelling the path on the animal or the species is wrong.
- **The processing path determines legal sales channels.** Finished inventory
  inherits a market eligibility from how it was processed: inspected product
  goes anywhere, uninspected on-farm poultry is restricted (direct-to-consumer,
  in-state, no resale — specifics vary by state and are **not** asserted here).
  **`retail` should refuse to list a lot into a channel that is not legal for
  it.** Selling uninspected product through the wrong channel can end a poultry
  enterprise, and nothing on the market prevents it.
- **The on-farm exemption is a countable annual limit**, and the pilot sits at
  exactly 1,000 birds — i.e. already managed to a line. Recording processing
  runs yields the year-to-date count for free, so the app can warn as the cap
  approaches. At 10× this stops being a warning and becomes the rule that
  decides which batches *must* go out to inspection.
- **A processor is a vendor** — the party spine already holds it, no new contact
  model. What hangs off it is processor-specific: establishment number, booking
  lead time, price schedule, kill capacity, and **its own cut sheet options**.
  With multiple butchers in use, the yield from an identical animal depends on
  where it went.
- **Inspected meat means `production` is an external conversion.** For the meat
  sent out, the farm does not butcher; a licensed processor does. The path is
  *book a date → deliver animals → receive boxed cuts*, which reshapes the pack:
  - **Slaughter dates are the scarce resource.** Processors book 6–12 months
    ahead, deposits are involved, and losing a date is expensive. Booking and
    holding dates is a first-class feature, not a date column on an animal. It
    is also the loudest unmet need in small livestock production.
  - **The cut sheet is the recipe.** Two identical steers yield completely
    different SKU sets depending on how they are cut, and on a half-beef sale
    the cut sheet is often the *customer's* choice.
  - Establishment number and lot codes are retained records.
- **Half and whole animal sales are priced on hanging weight, which is unknown
  until after the kill.** The sale is a deposit at booking plus a final invoice
  computed post-slaughter from a weight the processor reports. Check this
  against what core invoicing does today before slicing `retail`.
- **Maintenance emits work items** into the existing Work module rather than
  owning a task engine. Biggest single reuse win available; hold the line.
- **Growing degree days beat rainfall** as a derived metric — they predict
  harvest timing and pasture regrowth far better than the calendar. Open-Meteo
  is free, keyless, historical + forecast, by lat/long from a parcel centroid.
- **Pasture is measured in lb of dry matter per acre**, per paddock per date.
  Stacked into a grazing wedge it says which paddock to move to and whether
  you are about to run short. Nobody at this price point does it well.
- **Unpaid family labour breaks job costing.** If only payroll counts, every
  enterprise looks profitable. Hours need an imputed rate; the retainer-hours
  machinery may be reusable.

## Open questions

- **Is the baking under cottage food law?** Caps what `retail` may legally list
  and by which channel. The meat half of this question is settled (both paths in
  use), the baking half is not.
- **Which state's rules apply**, for the on-farm poultry exemption cap and the
  channel restrictions on uninspected product. The *mechanism* is
  state-independent — a countable annual cap and an eligibility flag on finished
  lots — and no specific limit or restriction is asserted anywhere in this
  dossier on purpose.
- **What allocation basis does feed actually use?** Headcount × days on feed is
  the obvious default, but whether the pilot can measure bin draw per delivery
  decides how coarse the allocation has to be, and that decides how much the
  per-pen cost figure can be trusted.
- **Units of measure** — head, lb, bushel, dozen, bale, ton, gallon, acre. A
  day-one decision for `inventory`, a rewrite if deferred.
- **PostGIS or GeoJSON-in-jsonb** for zone geometry. jsonb plus a spherical area
  formula gets ~95% of the value with no Neon extension risk; PostGIS is only
  needed for "which zone contains this point".
- **Raised-livestock inventory accounting** is genuinely gnarly — raised animals
  have no purchase basis, and cash-basis farm accounting is unusually permissive.
  Deserves its own session, probably its own ADR.
- **Schedule F, not Schedule C.** The existing books-export needs a farm mapping.

## Explicitly deferred

- `marketing` as code. Branding, website and social are either core CRM/email
  or they are services delivered, not software built. A market-day calendar is
  core scheduling.
- Crop *planning* features beyond what feeds inventory and costing. Crowded
  space, low willingness to pay.
- EPD-style breeding value calculations. Rabbit hole.
- CSA share management. Real, but its own pack, after `retail`.
