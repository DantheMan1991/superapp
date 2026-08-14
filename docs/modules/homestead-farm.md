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

**Grazing:** 20 paddocks, **polywire only** (no fixed subdivision), ~1 day per
paddock, 21-day rest target. Water is **hauled daily** — there is no water
infrastructure. The cattle **migrate by trailer between two parcels**: wintered
on one, grazed there in spring, hauled to the summer parcel, hauled back in
fall. Rents no ground, but renters must be supported. US-only geodata is fine.

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

### 2026-08-13 — Land brainstormed to a design (`claude/packs-and-profiles-design`)
- First category taken past a first pass. Full write-up under
  [Category design — Land](#category-design--land-brainstormed-2026-08-13).
- **Two levels of place, not three.** A polywire strip is an *area on the
  grazing event*, not a geometry — which lets one model serve strip grazers and
  fixed-paddock users with no branch, as ADR 0004 requires.
- **Rest is an outcome, not a setting**, and it is discontinuous across a
  seasonal parcel migration, so a single farm-wide target is wrong.
- Ran the pilot's own numbers through `paddocks = (rest ÷ graze) + 1` and found
  the 21-day target is **arithmetically unreachable** on a 12-paddock summer
  loop at a day per paddock. The finding came from data the app would already
  hold, which is the argument for the whole category.
- **Settled geometry: GeoJSON in jsonb, math in JS** — no PostGIS. Land carries
  points and lines (troughs, fences) as well as polygons.
- **GDD from free weather data replaces pasture measurement** as the growth
  signal, and outranks the grazing wedge for the pilot because it needs no
  discipline to sustain.
- Established the planning-tool doctrine: they end in dollars, they come after
  operations, and **no `planning` pack until three examples exist**.

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
| Land | `land` pack — parcels, zones, geometry, area | no | **done** — [category design](#category-design--land-brainstormed-2026-08-13) |
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

## Category design — Land (brainstormed 2026-08-13)

The first category taken past a first pass. Everything here is settled unless
marked open. Pilot facts that drove it: **20 paddocks, ~1 day per paddock,
polywire only, water hauled daily, 21-day rest target, and a seasonal migration
by trailer between a wintering parcel and a summer parcel.**

### Two levels of place, not three

- **Parcel** — the legal/tenure unit (deed or lease). Also the unit you *haul
  between*. Changes over years.
- **Zone** — the management unit ("North Pasture", "Bed 4"). Changes seasonally.
- ~~Strip~~ — **not a place.** A polywire strip has no persistent identity; the
  wire lands somewhere different every time. What persists is the paddock.

**A strip is an area on the grazing event, not a geometry.** This is what lets
one model serve both grazing styles with no branch, which
[ADR 0004](../decisions/0004-capability-packs-and-industry-profiles.md) requires:

| | Event record |
| --- | --- |
| Strip grazer (pilot) | lot 3, North Pasture, Aug 13, **0.4 of 10 acres** |
| Fixed-paddock user | lot 3, North Pasture, Aug 13–17, **10 of 10 acres** |

Rest follows one rule for both: **the zone's rest clock starts at the end of the
last grazing event in it.** Area grazed is the load-bearing field — it drives
stocking density and days-of-feed-remaining, the numbers a strip grazer manages
to.

### Intent and fact are separate

Both look like "zone use", and conflating them is why most farm software does
one of them badly.

- **Intent** — "North Pasture is hay ground this year." A dated plan on the
  zone. Exists *before* anything happens; it is what you budget against.
- **Fact** — occupancy. And **fact does not belong to `land`** — it comes from
  `livestock` and `crops`. Land owns the place; other packs point at it.

### Rest is an outcome, never a setting

Do not ask for a rest period and then nag against it. Measure what each paddock
actually got, show it against the target, flag early returns. **Free from
occupancy data, zero additional entry.**

The rest clock is **discontinuous** and a single farm-wide target is wrong: the
wintering parcel's paddocks rest 100+ days over summer while the summer parcel
runs an 11–19 day cycle. Flagging every over-rested winter paddock trains the
user to ignore alerts within a fortnight.

**The arithmetic the app should surface, from the standard formula
`paddocks = (rest ÷ graze) + 1`:** at ~1 day per paddock, a 21-day target needs
22 paddocks. The pilot has 20 *split across two parcels*, so the summer rotation
runs over a subset — 12 paddocks yields 11 days of rest. The stated difficulty
hitting 3 weeks is therefore **arithmetically unavoidable, not a management
failure**, and the app would have said so from data entered anyway. Three fixes,
all priceable: more subdivisions (cheapest — polywire), slower rotation (needs
grass), or reaching ground currently unusable (needs water).

### Movement: one model, walks and hauls

A move between adjacent paddocks is a walk — daily, free. A move between parcels
is a **haul** — fuel, labour, trailer time, posting to the ledger against the
cattle enterprise. **One movement event with a method and optional cost**, not
two models.

- **Haul cost scales in trailer-loads, not smoothly.** 10 cows is one trip; 100
  is 5–7 trips each way, twice a year. At 10× it becomes a capital question
  (bigger trailer vs hired hauler), the same shape as well-vs-pond.
- **Shrink will lie to weight data.** Cattle drop 3–5% when hauled and take days
  to recover. Growth and cost-per-pound metrics must not read a haul as a loss.
- **Seasonal parcel migration is the market norm**, not a pilot quirk — land
  becomes available in pieces and rarely contiguous.

### Geometry — settled: GeoJSON in jsonb, math in JS

Ranked by what it actually buys:

1. **Point-in-polygon on mobile** — standing in a field, the app knows the zone
   and pre-fills it. This is the 10× data-entry reduction, and the least obvious
   item on the list.
2. **The map** — how a farmer verifies the data matches reality.
3. **Computed acreage** — modest; the county already told you.
4. **Adjacency** for rotation planning — later.

None needs PostGIS. Ray-casting containment is trivial for a few hundred
polygons and 10× is still a few hundred. **Closes the PostGIS open question.**

**Land is not only polygons.** Zones are polygons, fences and lanes and water
lines are **lines**, troughs and hydrants and wells are **points**. GeoJSON
handles all three natively, so it is free now and painful to retrofit. At 10×,
**water is the binding constraint on rotation** — "which paddocks have water" is
a real planning question once points exist. This is also where `land` meets
`assets`: a fence has geometry from one and a cost, life and maintenance
schedule from the other (fence is typically 7-year property), which is exactly
the founder's weed-whacking example.

**Base imagery: US-only confirmed acceptable.** NAIP aerial imagery is free and
public domain; USGS 3DEP elevation is free. Elevation is core rather than
enrichment because the pilot has *no* water infrastructure — the planner designs
from scratch and gravity is the biggest lever on cost.

### Grass growth: build the free version first

Measuring dry matter means walking every paddock weekly with a plate meter.
Most people do not sustain it, and the grazing wedge is a beautiful feature that
frequently sits empty. Two of the three useful numbers are free:

| Number | Cost to obtain |
| --- | --- |
| Rest days since last grazed | **free** — computed from occupancy |
| Grazing days achieved per zone | **free** — computed from occupancy |
| Dry matter per acre | requires measurement |

**GDD answers "it depends on grass growth" without any measurement.** Growing
degree days plus rainfall proxy regrowth rate, both free from Open-Meteo by
parcel centroid: *"GDD is 30% below the five-year average; at your current pace
you return to Paddock 4 in 16 days, not 21."* Ranked **above** the grazing wedge
for the pilot precisely because the wedge needs discipline and this needs none.

> **The pack-wide rule this generalises to: anything derivable from a record
> already being made must never become a second data entry.** At 10× that is the
> difference between a system used and a system abandoned.

### Profit per acre is downstream of allocation

Not a Land feature. A cow grazes five paddocks and becomes beef — attributing
that revenue to an acre requires allocating it back across paddocks by head ×
days, which is the **same allocation engine as feed**. Two distinct questions
hide in the phrase:

- **Enterprise analysis** — is the cattle operation profitable?
- **Land analysis** — is this parcel earning its keep?

Land's contribution is narrow: **supply the acreage and the occupancy record
that drives the allocation.** Reporting is core dimensions. Profit-per-acre
therefore cannot ship before allocation exists.

**Non-productive zones need marking** — woodlot, house site, yard, lanes carry
tax and interest and earn nothing. Including them makes every farm look broken.

### Rented ground: schema now, screens later

The pilot rents nothing but the founder wants renters supported.

- **Tenure on the parcel** (owned / leased / crop-share) goes in the model
  **now** — profit-per-acre computes differently on rented ground and
  retrofitting means rewriting the report.
- **Lease management** — terms, renewals, rent invoices — is deferred until a
  tenant actually rents, then built against a real lease.
- **Crop share is a revenue split, not an expense.** Landlord takes a third of
  the crop instead of cash; it books completely differently.
- **The improvement-payback warning** is decision support nothing else offers:
  *"you are about to spend $4,000 liming ground with 2 years left on the lease."*

**Honest cost:** unexercised code paths rot unnoticed. The first renting tenant
will find bugs in whatever is built blind. Accepted deliberately.

### Weather: log from day one, insight in year three

Rainfall-to-yield correlation needs years and is badly confounded. Actionable
immediately: **is the ground workable** (recent rain blocks haying and tillage),
**GDD → maturity prediction**, and drought triggers for destocking. The
correlation pays off in year three but collection must start in slice one, and
it is free.

### Planning tools

> **A farm planning tool that doesn't end in dollars is a toy.** Every planning
> question the founder named is a capital allocation question, and the books are
> already here. This is the platform's edge: everyone else building farm software
> is a farmer or a developer.

**Water system planning** is the pilot's stated ask and its biggest pain — water
is hauled daily, which means **the rotation is constrained by truck access, not
by grass.** That reframes it: the water system is not an efficiency project, it
is what would let rest drive the rotation. Its ROI is unusually clean (labour
hours saved, daily, forever), and it is a **hard gate on 10×** — nobody hauls
water to 200 paddocks.

What is genuinely computable from data already held: demand (≈1–2 gal per 100 lb
per day × known lots and weights), coverage against zone polygons, layout via
minimum spanning tree over hydrant points, and gravity-vs-pumped from elevation.
**Where to stop: this is planning support, not engineering.** Pipe sizing,
friction loss and pump selection are somebody's stamped design and the liability
is not ours to carry.

**The planner works per-parcel, not per-farm** — you generally cannot run pipe
across ground you do not control, so non-contiguous parcels may need independent
sources. The summer parcel pays back first.

Others worth building, ranked:

| Tool | Why it earns its place |
| --- | --- |
| **Winter feed budget** | Highest-anxiety question a grazier has, simplest math, currently done on a napkin |
| **Carrying capacity** | Decides everything downstream |
| **Paddock count for target rest** | Turns "how much polywire do I buy" into arithmetic. Would have caught the pilot's shortfall on day one |
| **Water layout + source** | Above |
| **Enterprise add/drop** | Pure accounting; the one nobody else can build |
| **Break-even pricing** | What must I charge per lb to hit target margin |
| **Buy vs custom-hire equipment** | Same shape as well-vs-pond |

Lower: lane/access planning, shade placement, manure capacity, rotation with
nitrogen credits, succession scheduling.

**Two warnings.** Planning tools are where farm software goes to die — they demo
beautifully and get abandoned, because a planner is only as good as the
operational record beneath it. Build operations first, planning second, but
design the operational model *knowing* they are coming. And **do not create a
`planning` pack yet**: each planner attaches to the pack owning its physical
model (water → `land`, feed budget → `livestock`). Extract the shared
capital-comparison shape when there are three examples, not one.

### UI scale

20 paddocks now, ~200 at 10×. **List-first with a map view.** The map is genuinely
useful for a strip grazer thinking about where the herd goes next, but it is not
primary navigation until the count is in the hundreds — **do not gate the pack on
the map being finished.** Water points start empty, so the constraint model must
handle "no infrastructure anywhere" gracefully rather than assuming otherwise.

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
- ~~PostGIS or GeoJSON-in-jsonb~~ — **settled 2026-08-13: GeoJSON in jsonb,
  containment and area in JS.** See the Land category design.
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
