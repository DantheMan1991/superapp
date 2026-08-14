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

**Herd management:** pigs are **feeders bought in** (no sow, no farrowing — the
reproductive cycle is cattle-only). **Own bull**, replaced every ~2 years to
avoid inbreeding; **replacement heifers are kept**, not bought. **Some cattle
are registered**, but none are in an association performance program, so
registry is a passive record with no outbound reporting. Feed is **bagged**.
**No scale for large animals** — cattle and pig weights come from tape or eye;
chickens *are* weighed. Layers are **one flock**.

**Processing & baking:** chickens are processed on-farm at **200–300 birds a day
with 2–3 people**, and the birds go out **both fresh and frozen**. Baking is in a
**home kitchen** under cottage food rules today, with a **commercial kitchen a
real possibility** — design for both. Own eggs, lard and milk are used in the
baking. Kill sheets arrive **both on paper and digitally**. Recipe management is
to be **a real workspace**, not a list. **No milk cow now, but eventually.**

**Selling:** beef is sold **both as halves and as individual cuts at market**;
**eggs are sold at market**; **all sales are direct-to-consumer for now** (no
wholesale or restaurant). Cold storage is **3 chest freezers in the garage plus
a walk-in refrigerator in the barn** — four locations across two buildings.
Reporting basis: **both cash and accrual must be supported**, tenant's choice.

> **The founder records nothing today.** No notebook, no spreadsheet, no phone
> notes. This is the single most consequential fact in this dossier and it is
> a design constraint, not a footnote — see *Cold start* under the Livestock
> design.

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

### 2026-08-13 — Production brainstormed to a design (`claude/packs-and-profiles-design`)
- Fourth category to a design, covering **butchering and baking together**.
  Write-up under [Category design — Production](#category-design--production-brainstormed-2026-08-13).
- **One run, two planning directions.** Butchering is forward (known input,
  discovered outputs); baking is backward (known output, derived inputs). Shared
  run model, **separate templates** — a cut sheet specifies treatment, a recipe
  specifies quantities, and forcing them into one table because they rhyme would
  be wrong.
- **Outputs either fulfil a commitment or enter stock** — pre-sold halves and
  pre-ordered fresh birds behave identically, so fresh-vs-frozen is not a
  species branch. Yields the planning number *pre-orders + freezer headroom*.
- **WIP is the third inventory state.** An animal at the processor is off the
  farm but still owned; every accounting system models this and no farm app does.
- **Facility status → product eligibility → channel eligibility** is one
  mechanism serving both inspected-vs-exempt meat and commercial-vs-cottage
  kitchen, which makes designing for the possible commercial kitchen nearly free.
  **Exemption counters generalised** — the bird cap and the cottage food revenue
  cap are the same shape.
- **Results feedback turned out to be yield analysis.** The recipe is a
  hypothesis, the batch is the experiment, the variance is the learning — which
  is exactly dressing percentage under another name.
- Recipes specified as a real workspace: baker's percentages, **version pinning
  per batch** (without which the requested feedback is noise), sub-recipes both
  inline and batched, and **the label as a generated legal artifact**.
- Dairy recorded as a designed-for seam, not built, with raw-milk sale flagged
  as the most legally fraught activity on the farm.

### 2026-08-13 — Inventory brainstormed to a design (`claude/packs-and-profiles-design`)
- Third category to a design. Write-up under
  [Category design — Inventory](#category-design--inventory-brainstormed-2026-08-13).
- **Market livestock *is* inventory** — the capital-asset distinction settled in
  the Livestock design answers the structural question. `inventory` owns the lot
  spine, `livestock` declares it in `requires`, breeding stock stays a fixed
  asset, and head is just a unit of measure.
- **Live-to-hanging is a yield, not a unit conversion.** The trap that would have
  baked an unauditable fudge into every carcass. Conversions are exact or
  item-specific; measured outputs belong to `production`.
- **Corrected mid-session:** "valuation optional" was wrong for this codebase.
  ADR 0007 already derives cash basis at read time and rejected a second stored
  ledger, so inventory valuation follows — quantities and costs always, financial
  presentation basis-dependent. The pilot needs both bases and already has them.
- **A pre-sold half is never inventory** — it is a commitment on the livestock
  lot, delivered without ever sitting on a shelf. One animal, two cut sheets,
  two output paths.
- **Selling halves is how the unpopular cuts move**, so the halves/cuts mix is a
  calculation over what the market actually buys, not a preference.
- **Locations are assets with a type, and their capacity constrains the kill
  schedule** — three freezers is three or four half-carcasses, which feeds back
  into slaughter-date booking.

### 2026-08-13 — Livestock brainstormed to a design (`claude/packs-and-profiles-design`)
- Second category taken to a design. Write-up under
  [Category design — Livestock](#category-design--livestock-brainstormed-2026-08-13).
- **A lot is a ledger of head, not a counter.** Head movements are events and
  the count is their balance, so it reconciles, split/merge stop being special,
  and the traceability trail *is* the model rather than an addition to it.
- **The allocation runs both directions**, which is what joins `land` to
  `livestock`: zone costs flow to the lots that grazed, animal revenue flows
  back to the paddocks that fed it. Forage never has to be priced.
- **Breeding herd vs market herd is an accounting event, not a checkbox** — the
  same animal is inventory or a capital asset depending on purpose, and moving
  between them must post. This is where the pack stops being a tracking app.
- Genetics taken properly after the founder flagged it was thin: breed
  composition as **fractions**, inbreeding with a specific warning (a heifer's
  own sire is likely still present on a 2-year bull rotation), sire performance
  across bulls, scored traits, passive registry.
- **The AI position was corrected mid-session.** The founder pushed back on an
  over-restrictive first take and was right: the line is not feed-versus-not, it
  is **ask-and-orient vs compute-and-commit**. Being 10% off on "what does a pig
  eat" costs nothing; dose and withdrawal are where precision matters.
- **Cold start named as the constraint outranking the schema.** The founder
  records nothing today and there is no history, so a tool valuable only in year
  two never reaches year two. Day-one wedge chosen as *ask it things, tell it
  things*.

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
| Livestock | `livestock` pack | **yes** | **done** — [category design](#category-design--livestock-brainstormed-2026-08-13) |
| Gardens/crops | `crops` pack | **yes** | first pass |
| Butchering | `production` pack | no | **done** — [category design](#category-design--production-brainstormed-2026-08-13) |
| Baking | `production` pack — shared run, separate template | no | **done** — same design |
| Retail | `inventory` + `retail` packs | no | `inventory` **done** ([design](#category-design--inventory-brainstormed-2026-08-13)); `retail` first pass |
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

## Category design — Livestock (brainstormed 2026-08-13)

The largest pack, and the one the pilot operation actually lives in. Earlier
rounds already settled lots-with-lineage, the pen as cost object, the two
processing paths and withdrawal as a legal constraint; this is the rest.

### A lot is a ledger of head, not a counter

Nothing writes to a `count` column. **Head movements are events and the count is
their balance** — the ledger pattern, applied to animals.

| Event | Head |
| --- | ---: |
| Placed (hatched / bought / born) | +70 |
| Died | −4 |
| Culled or sold live | −2 |
| Transferred to another lot | −64 |
| **Balance** | **0** |

What it buys, and why it is not merely tidy:

- **It reconciles.** The count can never silently disagree with its own history
  — which is exactly the property needed when a processor's paperwork has to
  match the farm's records for inspected meat.
- **Split and merge stop being special.** A split is a transfer out of one lot
  and into another, and it balances. The "promote the pigs to individuals"
  operation falls out instead of being bespoke.
- **Mortality rate is a query**, not a stored field: deaths ÷ placed, per lot,
  per batch, per season.
- **The audit trail is the model**, not something added for traceability.

A materialised current count still exists for fast reads. It is derived, the way
a balance is.

### Identity: many identifiers, not one column

An animal carries a visual tag, possibly an EID/RFID button, possibly an
official metal tag. **Tags are lost and replaced while the official ID must
persist**, and electronic-ID requirements for interstate movement have been
tightening. So: many identifiers per animal, each typed and date-ranged. The
official one carries the traceability chain onto processor paperwork.

### The allocation runs both directions

The unification between `land` and `livestock`, and the reason they were
designed together. **Grazed forage is never priced.** Instead:

1. A **zone accumulates its own costs** — rent or tax, fence maintenance,
   mowing, seed, water infrastructure.
2. **Grazing occupancy allocates those costs to the lots that grazed it**, by
   head × days.
3. **The animal's revenue allocates back across the paddocks that fed it**, by
   the same basis.

One engine, run two directions, producing both requested reports: cost per
animal and profit per acre. No forage price ever has to be guessed, because the
cost is measured on the land side and simply flows. If only purchased feed were
counted, pastured beef would look impossibly cheap.

### Weights are observations carrying a method

| Method | Applies to | Pilot has it? |
| --- | --- | --- |
| Scale | Individual cattle through a chute | **no** |
| **Sample** (weigh 10, average, × head) | Broilers | **yes** |
| **Tape** (heart girth; pigs ≈ girth² × length ÷ 400) | Cattle, pigs | the only option |
| Visual estimate | Anything | low confidence |
| Body condition score (1–9) | Cattle | not weight, but the decision input |

Sample size is recorded so the system knows how far to trust the number. **A
haul distorts weights** — cattle shrink 3–5% and take days to recover, so a
weight taken near a trailer move must not read as loss.

> **Every derived cost should carry its provenance.** Broiler FCR from bagged
> feed against sampled weights is *measured* and can be acted on. Cattle gain
> from tape against allocated pasture cost is *estimated* and is a trend to
> watch. Same report, different confidence — and at 10× the bagged number
> becomes an allocated one, so the distinction is permanent, not transitional.

### Health and the withdrawal guardrail

A treatment records product, dose, route, date and who administered it. Its
value is the **withdrawal clock**: the lot cannot be processed, and milk cannot
be sold, until it clears.

- **Meat and milk withdrawals differ for the same product** — two clocks.
- Periods vary by dose, route and species, and extra-label use extends them.
  The app carries **a default the user can override and must never present a
  number as authoritative.** Being confidently wrong here is worse than having
  no feature.
- **Group treatments put the whole lot under withdrawal** — the normal case in
  poultry, where it goes in the water.
- Treatments allocate as cost to the lot, so a sick pen carries its own expense.

### Breeding: a bull means windows, not dates

With a bull running with the cows there is no known service date. The model is
**bull exposure period → calving window**: in May 1, out Aug 1 means calves
arrive roughly Feb 7 – May 10. Individual dates are then *refined backward* as
evidence arrives — a preg check narrows it, the actual calving fixes it
(conception = calving − 283).

- **Where a cow calves within the window is a cull signal.** Late means she bred
  late, and she will be later again until she is open. Free from the calving
  record.
- **Births create lots, parented by the dam.** Cattle create a lot of 1; a
  farrowing would create a lot of 10. Same mechanism — the third time the lot
  model absorbed something expected to need its own shape.

### Breeding herd vs market herd is an accounting distinction

**The same animal is inventory or a capital asset depending on its purpose.** A
heifer raised for beef is inventory; kept for breeding she becomes a capital
asset — depreciable if purchased, no basis if raised, and entirely different
treatment on sale. The bull is a capital asset; the steers are not.

**Moving an animal from the market herd to the breeding herd is therefore an
accounting event that must post**, not a status checkbox. Most farm software
treats it as a flag and quietly makes the books wrong. Getting this right is a
large part of what distinguishes this pack from a tracking app.

### Genetics

Not genomics. Five concrete things, all of which the pilot wants tracked:

- **Pedigree with multi-generation traversal** — free from birth events creating
  parented lots.
- **Breed composition as fractions, never a string.** Homestead cattle are
  deliberately crossbred for hybrid vigour; "½ Angus, ¼ Hereford, ¼ Simmental"
  is the real answer and computes automatically from the parents. A single
  `breed` text column throws this away irrecoverably.
- **Inbreeding coefficient** (Wright's), computed from the pedigree. **The
  specific collision to warn on:** a heifer born this spring breeds at ~15
  months — two summers out — and on a **2-year bull rotation her own sire is
  likely still standing there.** That is the one that slips past, because the
  thinking is herd-level while the risk is per-heifer. The warning must fire
  **when the bull is turned in with the replacements**, not in a report.
- **Sire performance across years.** One bull cannot be compared within a
  season, but can be across them: *"Bull #2's calves weaned 40 lb heavier."* On
  ten cows that decides whether he stays, and the bull is half the genetics of
  every calf on the place.
- **Trait observations, scored 1–5** — calving ease, temperament, mothering,
  udder, feet and legs. Heritable, and what culling actually runs on. "This cow
  always has trouble calving" *is* genetics data.

**Registry** (some pilot cattle are registered, none in a performance program):
registration number, association, registered name, papers stored in Documents.
Selling a registered animal is a **transfer of papers** — a real workflow. Higher
value also sharpens the capital-asset distinction above.

Breed matters beyond cattle: Cornish Cross vs a slower-growing broiler is a
completely different FCR and time to market.

### Feed

Largest cash cost, and **feed conversion ratio** decides the broiler enterprise.

- Pilot uses **bagged** feed, so feed-per-pen is *measured* today. At 10× it
  arrives by the ton into a bin serving many pens and becomes *allocated* by
  head × days. Both paths must exist, and the provenance rule above says which
  one produced a number.
- **Waste streams are real feed** — spent grain, surplus milk, garden culls,
  expired bakery. Near-zero or odd cost basis. A model that insists every input
  has a purchase price will be lied to.

### Recurring yield: layers are structurally different

Eggs arrive daily rather than once, so the flock has a **production curve and an
economic life**: pullets start ~18–20 weeks, peak ~30, decline after, with a
molt that stops production and a winter drop without supplemental light.

The cull decision is therefore **economic, not health** — feed cost per dozen
rises until it crosses the value of the eggs. That is a report the app can
make, and it is the decision people get wrong by keeping hens two years too long.
Daily collection must be one number, one tap.

### Mortality is a diagnostic

Expected broiler mortality is a few percent; the system should know the expected
rate and flag deviation while it can still be acted on. **Timing implies cause**
— first-week losses point at chick quality or brooding, late losses at heat or
the leg and heart problems of fast growth.

**Carcasses can be condemned at the plant**, so delivered head ≠ sellable
carcasses and the loss lands after the animal left the farm's control. Yields
will not reconcile without somewhere to put it.

### Images

File storage is free — Documents already holds files with metadata and the open
entity-link pattern attaches them to a lot with no core change. What matters is
what photos are *for*: identification (markings, when tags are unreadable across
a field), **a condition series** (the same animal over time reveals gradual loss
invisible day to day), health documentation for the vet, sales listings, and
loss documentation for insurance or predator claims. A field photo attaches in
one tap and inherits its zone from Land's point-in-polygon.

### AI: where it belongs

Corrected during the session after the founder pushed back on an
over-restrictive first position. The line is **not** feed-versus-not; it is
**consequence and reversibility**:

| | Treatment |
| --- | --- |
| **Ask and orient** — what does a 3-month pig eat, when do I wean, is this gain normal, what's typical mortality | AI, approximate, no gate. The value *is* that anything can be asked; a hardcoded table answers only what someone anticipated |
| **Compute and commit** — becomes a purchase order, a ledger cost, a medication dose, a withdrawal date, a slaughter booking | Deterministic, or AI-drafted with a human confirming before it lands |

Being 10% off on "roughly what does a pig eat" costs nothing, because the
answer is a starting point and the pig is observed and adjusted daily. Precision
matters for **dose and withdrawal**, not feed.

**The version better than either a table or a chatbot:** the reference answer
anchored to the farm's own history. *"Roughly 5 lb/day at that weight. Last
year's batch averaged 5.4 and finished at 250 lb in four months, at $X of feed
per pig."* Only this app can answer that, because only it has both.

Best AI uses, ranked: **natural-language daily log** (a voice memo from the
tractor into structured events — this attacks the thirty-taps-a-day problem
directly), cross-module synthesis (detection is a rule, the explanation is AI),
paperwork extraction (feed tickets, vet bills, processor kill sheets — the
accounting bill-prompt pattern already exists), and photo assistance (assistive,
never a diagnosis; body-condition scoring from a photo is not reliable).

**The line held everywhere: AI never produces a number that enters the books or
an animal without a human seeing it first.** This mirrors the accounting
module's own lesson that rules beat AI for anything that must be correct.

### Cold start — the constraint that outranks the schema

**The founder records nothing today.** No spreadsheet to replace, no habit to
attach to. Two consequences:

1. Creating a recording habit from zero is harder than replacing one, and it is
   why most farm software dies in its first season.
2. **There is no history.** FCR trends, sire comparison, rest analysis and
   profit per acre all produce *nothing* on day one. **If the tool is only
   valuable in year two, nobody reaches year two.**

What is valuable on day one with no history: the **advisory layer** (needs no
data at all), the paddock arithmetic (needs a count), the calving window (needs
one date), the withdrawal clock (useful at the first treatment), and the
inbreeding check (needs a pedigree entered once).

> **Day-one wedge: ask it things, tell it things.** The advisory layer solves
> the cold start; the natural-language daily log makes entry cheap enough that
> the habit can form. Everything else in this design is a report over data the
> log collects. Chosen deliberately when the founder said "build the whole
> tool" and had no single must-have — the risk is not that the tool is too
> small, it is that it is complete and unused.

### The daily entry principle

At 10× there are ~30 broiler pens and nobody opens thirty records to type zeros.
**Most days nothing happens**, so: **one tap confirms "all normal" across the
whole farm**, and only exceptions are entered individually. Explicit zeros still
result — and they are needed, because "zero died" and "didn't check" are
different facts that FCR depends on distinguishing.

That, plus Land's rule that nothing derivable is ever re-entered, decides whether
this is used daily or abandoned in March.

### Slice order

| # | Slice | Why here |
| --- | --- | --- |
| 0 | Lots + head ledger + occupancy (shared with `land`) | The spine. Nothing works without it, and seeing your animals on paddocks already beats nothing |
| 1 | **Daily log + advisory layer** | The day-one wedge. Habit and cold start |
| 2 | Feed + FCR (direct issue now, allocation seam for 10×) | Largest cash cost, and the broiler enterprise's verdict |
| 3 | Health + withdrawal clock | Legal guardrail; useful at first use |
| 4 | Breeding + genetics + registry | Needs a season of calving to pay off |
| 5 | Weights (tape formulas, sampling) | Sharpens everything above |
| 6 | Processing handoff → `production` | Blocked on that pack |

Images ride along with slice 0 — cheap, and high satisfaction early.

## Category design — Inventory (brainstormed 2026-08-13)

The pack everything else lands in: feed, eggs, meat, produce, baked goods and
supplies. Designed third, deliberately, because its shape is constrained by
decisions already made in `land` and `livestock` and those constraints were
still fresh.

### Market livestock *is* inventory — the accounting already said so

The structural question was whether a livestock lot and an inventory lot are the
same mechanism. The answer falls out of the capital-asset distinction settled in
the Livestock design:

- **Market lots** (steers, broilers, feeder pigs) **are inventory lots**, with a
  livestock extension carrying the biology — age, health, occupancy, withdrawal.
- **Breeding stock** (the bull, retained cows) **is not inventory at all.** It is
  a capital asset, tracked by `livestock`, living on the other side of the
  balance sheet.

So **`inventory` owns the lot spine and `livestock` declares it in `requires`.**
And the breeding-herd/market-herd transfer becomes literally what it is in the
books: **a movement between inventory and fixed assets.** The model and the
accounting agree rather than approximating each other.

**Head is just a unit of measure.** "70 head" is a quantity exactly as "500 lb"
is. The head ledger and the inventory ledger were always the same ledger.

### Units: three kinds of conversion, and one of them is a trap

| Kind | Example | Where it lives |
| --- | --- | --- |
| Fixed and exact | 12 each = 1 dozen; 2,000 lb = 1 ton | Global, per dimension |
| Fixed but item-specific | A 50 lb bag of feed; a flat of eggs is **30**, not 12 | **On the item** — "1 bag" means nothing in general |
| **Measured per lot** | A steer goes in at 1,150 lb live, hangs at 690 | **Not a conversion at all** |

**Live-to-hanging is a production yield, not a unit conversion.** Modelling it as
a factor bakes a permanent fudge into the books that nobody can audit, and every
carcass is quietly wrong. You do not convert a live steer — you record what came
off the rail. **That belongs to `production`; inventory must have no opinion on
it.** Hay has a milder version: a small square is 40–50 lb and a round is
800–1,200, so bale-to-lb is item-specific *and* approximate.

> **Every item has exactly one stocking unit and its balance is kept only in
> that unit.** Buy feed in bags, keep the balance in pounds. This kills the "is
> my number in bags or pounds" class of bug before it starts. Where a conversion
> is approximate, the balance inherits that softness — the provenance rule from
> the Livestock design applies here too.

### Cost has three flavours, only one of them easy

| Flavour | Example | Costing |
| --- | --- | --- |
| Fungible purchased | Feed, seed, cartons | Average cost is fine |
| Specific identity | Meat from animal #47 | Must know which — traceability forbids averaging |
| **Raised, no purchase basis** | Eggs, produce, a calf you bred | Only accumulated production cost, partly allocated |

### Quantities, costs, presentation — three layers, and the third is already built

**Corrected during the session.** The first proposal was "quantities always,
valuation optionally". That is wrong for this codebase, because
[ADR 0007](../decisions/0007-cash-basis-reporting.md) already established the
better pattern and explicitly rejected the alternative: *"two ledgers that must
agree forever. This is accounting software's worst bug class."* Inventory
valuation is the same problem and gets the same answer.

| Layer | Always on? |
| --- | --- |
| **Quantities** — what is on hand, where | Always. Operational truth |
| **Cost accumulation** — what this animal cost | Always. Cost per finished hog is wanted regardless of tax basis |
| **Financial presentation** — inventory as an asset with COGS at sale, versus inputs expensed when paid | **Basis-dependent, derived at read time** |

The pilot requires **both cash and accrual**, and that is already
architecturally solved — `getBalances` takes a `basis` parameter today, and
inventory extends the same lens instead of inventing a second one.

**Boundary already drawn in core:** the accounting catalogue explicitly says it
is *not* inventory — *"Real inventory is a different feature with a different
data model"* ([invoicing.ts:52](../../src/db/schema/invoicing.ts:52)). The two
**link, never merge**: the catalogue is a price list, inventory is quantity on
hand. `1300 Inventory` and `5000 Cost of Goods Sold` already exist in the
general chart of accounts, so the posting targets are present.

### Locations are assets, carry a type, and their capacity is a constraint

The pilot has **3 chest freezers in the garage and a walk-in refrigerator in the
barn**. The chain resolves entirely through packs already designed: a location
is an **asset**, in a **building**, on a **parcel**. Nothing new is invented.

- **A location has a type** — frozen, refrigerated, dry, ambient. The walk-in is
  not a cold freezer; it holds eggs, aging and fresh product with entirely
  different shelf life. Items carry storage requirements and a mismatch is
  catchable.
- **Capacity is a planning constraint, not a display field.** A chest freezer
  holds roughly 350–450 lb of packaged meat, so three is near 1,200 lb — three
  or four half-carcasses of retained beef. **Freezer space therefore limits how
  many animals can be processed at once**, which feeds straight back into
  slaughter-date booking: *"you have booked four steers for October; after
  existing stock there is room for two."* At 10× this stops being a warning and
  becomes the wall that sets the kill schedule.

### Halves and cuts: a pre-sold half is never inventory

The pilot sells **both**, which is the hard case. The timeline resolves it:

1. Customer commits to a half and pays a deposit — **before slaughter**
2. Slaughter — hanging weight finally exists
3. Final invoice = hanging weight × $/lb, less deposit
4. Their cut sheet turns their half into their boxes
5. Collection

**At no point does that half sit on a shelf.** It goes from *commitment against
a live animal* to *delivered*. So a pre-sold half is a **commitment on the
livestock lot**, not an inventory item, and only the retained portion becomes
stocked SKUs. One animal therefore carries **two cut sheets** and a single
production run has two output paths.

This yields a number the pilot does not have: **how much of the future beef is
already sold**, which is what should drive how many animals to raise and how
many dates to book.

**The cut-balance problem, and why the halves/cuts mix is a calculation:**
selling cuts earns several times more per pound than hanging-weight halves, but
costs market days and freezer space, and leaves the seller with what nobody
asks for —

> Ground beef and steaks sell out; shanks, roasts and organ meat accumulate.

**Selling halves is how the unpopular cuts move**, because the customer takes a
balanced carcass. So the right mix is determined by what the market actually
buys, and inventory knows which cuts move and which pile up. Likely the single
most valuable report in the retail direction.

### Eggs run the opposite rhythm to meat

**Continuous production, batch sale** — collected daily, sold on market day, so
inventory builds through the week and empties on Saturday. Meat is the reverse:
batch production, continuous sale. The same model absorbing both opposite
rhythms is good evidence it is the right model.

Cartons are a **consumable supply**, and supplies are where reorder points
actually matter — running out of cartons on market morning is a real failure,
while running out of ribeye is merely disappointing. Note that reusing cartons
carrying another producer's brand or grade marks is generally not permitted;
the app should not encourage it.

### Adjustments, counts, expiry

- **Adjustments carry a reason**, and reasons are a diagnostic rather than a
  correction: sustained feed shrinkage is not an accounting problem, it is a
  rodent problem.
- **A physical count reconciles to actual and posts the variance.** The record
  and reality will disagree; counting is how that is discovered.
- **FEFO, not FIFO.** For perishables the useful order is *first expired, first
  out*. Meat has a practical freezer life, eggs a sell-by, feed goes mouldy in
  humidity, vaccines expire outright. "Oldest first" and "expiring soon" are the
  two views that prevent loss.

### Traceability has an honest limit

The chain runs animal → production run → output lots → sale, and lineage carries
all of it. But at a cash market stall the buyer is unknown. So **traceability is
complete up to the point of sale, and beyond it only for named customers** —
CSA, online orders, wholesale. That matches what is generally expected of a
producer at this scale (one step forward, one step back), and the product should
state the limit rather than imply more.

### Channels: build the seam, not the feature

All pilot sales are **direct-to-consumer for now**, and "for now" is load-bearing
— inspected meat permits wholesale and that is the obvious 10× growth path. So
**price is per item per channel from day one**, even with a single channel,
because retrofitting a price list into a single-price model is painful. Nothing
else about wholesale gets built until someone sells that way.

### Day one, with no history

**"Which freezer has the ribeyes."** The pilot tracks nothing and finds out by
opening the lid. That answer needs no history, is useful from the first count,
and is the first screen.

### Slice order

| # | Slice | Why here |
| --- | --- | --- |
| 0 | Items + units + locations + on-hand ledger | The day-one wedge: what do I have and where |
| 1 | Receipts and issues | Feed in, feed out to lots — closes the `livestock` costing loop |
| 2 | Adjustments, physical counts, expiry/FEFO | Makes the balance trustworthy |
| 3 | Valuation + COGS posting, basis-aware | Rides the existing ADR 0007 lens |
| 4 | Commitments (pre-sold halves) | Needs `production` and `retail` to be useful |
| 5 | Reorder points, capacity warnings | Needs history |

Production outputs land in inventory but are blocked on the `production` pack.

## Category design — Production (brainstormed 2026-08-13)

The pack that joins `livestock` to `inventory`: a lot goes in, inventory lots
come out. It is also where three items parked in earlier sessions land — the
hanging-weight yield, the two cut sheets from one animal, and the pre-sold half.

### One run, two planning directions

A run is **inputs consumed + labour → outputs produced, at a yield, with cost
rolled through.** That much really is shared. But butchering and baking differ
in a way that matters, and the earlier "they are the same build" framing was too
strong:

- **Butchering is forward.** The input is known — one steer. The outputs are
  *discovered*. You cannot order 40 lb of ribeye; you get what the animal had.
- **Baking is backward.** The output is known — 60 loaves. The recipe *derives*
  the inputs, and it scales.

| | Artifact | Semantics |
| --- | --- | --- |
| Baking | **Recipe / BOM** | Fixed input ratios → predictable output count. Scalable |
| Meat | **Cut sheet** | Transformation instructions on a variable input. Not scalable |

A cut sheet is not a recipe in reverse — it specifies *treatment* ("ribeyes at
one inch, grind the chuck"), not quantities. So: **the run is one shared model;
the templates that seed it stay separate.** Do not force a recipe and a cut
sheet into one table because they rhyme.

### Outputs either fulfil a commitment or enter stock

The unification the pilot's answers produced. Both meat paths do the same thing:

| | Fulfils a commitment | Enters stock |
| --- | --- | --- |
| **Beef** | Pre-sold half, delivered | Retained cuts → freezer |
| **Chicken** | Pre-ordered fresh, collected | Retained birds → freezer |

**One mechanism, no species branch.** A pre-sold half and a pre-ordered fresh
bird both go from *commitment against a live animal* to *delivered* without ever
sitting on a shelf (established in the Inventory design).

**And the planning number falls out:** how many to process = **pre-orders +
freezer headroom**. *"80 birds pre-ordered, room for 180 more after existing
stock — process 260."* Both halves of that are already modelled.

### WIP is the third inventory state

When an animal goes to the processor it is off the farm but still owned. Not on
hand, so not inventory; not gone either. That is **work in progress** — the
animal's accumulated cost sits there, the processing fee accrues into it, and
the whole thing releases into finished inventory when the boxes come home.

Every accounting system models this; **no farm app does.** It also answers a
practical question asked four times a year: *where is my steer and when is it
back.*

### Facility status → product eligibility → channel eligibility

**One mechanism serving both meat and baking**, which is why designing for the
possible commercial kitchen costs almost nothing:

| Facility | Restricts |
| --- | --- |
| On-farm exempt poultry vs inspected plant | What the meat may be sold into |
| Cottage (home) kitchen vs commercial kitchen | Shelf-stable products only, capped revenue, restricted channels, disclosure label |

**Exemption counters are a general pattern, not a poultry quirk.** The on-farm
bird cap and the cottage food revenue cap are the same shape — a countable
annual limit that gates eligibility — and get built once.

**Home vs commercial is a computable crossover**: home is free but capped and
restricted; a shared commercial kitchen rents by the hour plus travel and
scheduling, but unlocks wholesale and refrigerated products. Larger batches
amortise the rental, so there is a crossover volume. Same planning shape as
well-vs-pond.

### The processing day

Pilot: **200–300 birds, 2–3 people** — roughly 8–12 birds per person-hour.

- **Labour is recorded per day, not per bird.** Crew and hours go on the run and
  the allocator spreads them across the birds. Third use of the same allocator.
- **Throughput becomes an asset ROI metric.** Birds per person-hour is
  measurable, so a better plucker can be *proved* to have paid — the app holds
  both the asset cost and the labour hours. Rare, and worth surfacing.
- **The on-farm vs processor comparison**: on-farm cost per bird (labour,
  supplies, equipment depreciation) against the processor's fee. Runs straight
  into the unpaid-labour problem — if own hours count as zero, on-farm
  processing always wins on paper and never on Sunday evening.
- **10× is a different operation, not a bigger one.** 10,000 birds at 250/day is
  30–40 processing days with 2–3 people. The answer is a hired crew, much better
  equipment, or sending them out. **The app should show that wall coming**
  rather than let it be discovered in July.

### Yields, and the report only this product can produce

Live, hanging and packaged weights give dressing percentage, cutting yield and
overall yield. These vary by animal, breed, finish — **and by processor**.

> The pilot already uses **multiple butchers**. Same kind of animal, different
> plant, different pounds in the freezer. That difference is real money and
> essentially nobody measures it.

**Processor yield comparison** is the differentiated report. Honest caveat: yield
varies by animal too, so separating processor effect from animal effect needs
several runs, and at 2–4 beeves a year that is a multi-year answer. Collection
starts with the first kill sheet and is free thereafter.

**Kill sheets arrive both on paper and digitally.** Extraction is the
"compute and commit" case from the Livestock AI doctrine — AI extracts, human
confirms, then it posts — and it is a **port of an existing pattern**, since
accounting already does this with bills and Documents already does text
extraction. Paper means a phone camera, so OCR quality varies and the
confirmation step matters more than the extraction.

### Byproducts and internal transfers

A run produces more than one thing: bones, tallow, organ meat, lard. Some sells,
some is waste, and **some returns to the farm** — lard into the baking being the
obvious loop. Standard treatment: **credit byproducts at net realisable value**
and let the remainder fall to the main products. "What did a pound of pork chop
cost" moves materially depending on whether the lard was free.

**Internal transfers are costed, and this is a day-one decision.** The pilot uses
its own eggs, lard and milk in the baking. If those arrive at zero cost the
bakery looks wonderful and the layers look terrible, and neither is true.
Retrofitting means every historical enterprise P&L was wrong. Same applies to
culls fed to pigs, bedding from the woodlot, manure to the garden.

### Recipes — a real workspace, not a list

Explicitly requested as a workspace. What that means:

- **Baker's percentages** — every ingredient as a percentage of flour weight.
  How professional recipes are actually written, and it makes scaling correct
  rather than approximately correct.
- **Versioned, with each batch pinned to a version.** Non-negotiable given the
  results feedback below: tweak a recipe without version pinning and the batch
  history becomes noise instead of learning.
- **Sub-recipes, supported both ways** — a levain used inline is *an ingredient
  that happens to have a recipe*, cost rolling through with no separate run; a
  levain made in a batch and stored is an ordinary run producing a stocked item.
  Both genuinely happen; allowing both is simpler than choosing.
- **The label is a generated artifact.** Cottage food rules generally require
  ingredients in descending weight order, allergen declaration, net weight and
  the home-kitchen disclosure — **all computable from the recipe.** A legal
  deliverable falling out of data already held, and when the commercial kitchen
  arrives the disclosure line drops and nothing else changes.
- Plus: scaling to batch size or to available ingredient, live cost per unit from
  current lot costs, method steps, tags, result photos.

### Results feedback is the same mechanism as yield analysis

Requested for baking, and it turns out not to be a baking feature.

> **The recipe is a hypothesis. The batch is the experiment. The variance is the
> learning.**

A batch records actual yield against expected (57 loaves, not 60), quality,
failures, and the conditions behind them — flour lot, humidity, yeast age, proof
time. Over enough batches: this recipe really yields 57, this flour performs
better, humid days want less water.

**That is identical to meat yield analysis** — expected vs actual with the gap as
the signal. Baking calls it batch results, meat calls it dressing percentage.
**One mechanism, two names**, and the fifth thing the shared run model absorbed.

Natural fit for the agreed AI split: detection is a rule ("this batch
underyielded 5%"), pattern across batches is where AI earns its place ("your last
four batches with this flour all came in low").

### Dairy: designed for, not built

No milk cow now, **eventually yes.** The recurring-yield shape from the layers
already accommodates it — continuous production from a live animal into
inventory. Additions when it arrives: lactation cycles, and a **milk withdrawal
clock**, which the health model already anticipates as a second clock.

> **Flag, not a design: selling raw milk is the most legally fraught activity on
> this farm.** Banned outright or heavily restricted in most states, with
> herd-share arrangements the common workaround where permitted. Using it in
> one's own baking is a different and far simpler matter.

### Slice order

| # | Slice | Why here |
| --- | --- | --- |
| 0 | Run model + outputs landing in `inventory` | The spine; unblocks the meat path |
| 1 | Meat runs: both paths, eligibility stamping, exemption counter, kill-sheet capture | The pilot's largest enterprise, and the legal machinery |
| 2 | Recipes + bake batches + results feedback | The requested workspace |
| 3 | Cost roll, byproducts at NRV, costed internal transfers | Makes enterprise P&L honest |
| 4 | Label generation | Legal deliverable, cheap once recipes exist |
| 5 | Processor comparison, throughput analysis | Needs history |

Commitments (pre-sold halves, pre-ordered fresh birds) are shared with `retail`
and slice with it.

## Open questions

- ~~Is the baking under cottage food law?~~ — **settled 2026-08-13: yes, home
  kitchen today, commercial kitchen a real possibility.** Both are designed for
  via facility status → product eligibility → channel eligibility. See the
  Production design.
- **Which state's rules apply**, for the on-farm poultry exemption cap and the
  channel restrictions on uninspected product. The *mechanism* is
  state-independent — a countable annual cap and an eligibility flag on finished
  lots — and no specific limit or restriction is asserted anywhere in this
  dossier on purpose.
- **What allocation basis does feed actually use?** Headcount × days on feed is
  the obvious default, but whether the pilot can measure bin draw per delivery
  decides how coarse the allocation has to be, and that decides how much the
  per-pen cost figure can be trusted.
- ~~Units of measure~~ — **settled 2026-08-13.** One stocking unit per item;
  conversions are exact or item-specific; measured outputs (live→hanging) are
  yields owned by `production`, not conversions. See the Inventory design.
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
