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

**Assets & garden:** equipment is a **tractor, tiller, 4-wheeler** and similar.
Structures are a **cow shelter, chicken tractors, and an egg layer coop built on
a wagon frame** — meaning **almost everything animal-related is mobile**; only
the garage and barn are fixed. **The eggmobile follows the cattle**, so the layer
flock's rotation is derived from the herd's, not independent. Hay is **bought
today, with haymaking planned soon**. The garden serves **both family and
market**.

**Channels & payment:** **one farmers market today, more soon.** Farm store runs
**both attended and honour-system**. **No shipping yet, but coming soon.**
Payment is **Square plus cash today**, with other providers required as options
and a stated goal of completing the whole transaction inside this app. On a
half, the processing fee is charged **both ways** (bundled into the price, or
paid by the customer directly to the plant), and the customer collects **either
at the plant or from the farm** — both per order.

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

### 2026-08-20 — Inventory slice 2: the slice that lets somebody be wrong (`claude/counting-what-is-actually-there`)
- **Three packs were waiting on this one thing.** A treatment removed left an
  orphaned cost with no way to correct it, a feed draw could not be reversed, a
  run input could not be taken off — all the same missing verb. Until now the app
  could record what happened and never that the record had drifted.
- **The reason is a diagnostic, not a correction**, which is the design's own
  line about rodents. `reason` is a column so it can be grouped, and the counting
  page leads with *what keeps happening* rather than with the list of counts.
- **A negative adjustment releases cost at the average; a positive one carries
  none.** Spoilage really cost money; stock that turns up was never bought, and
  the item average does not move for it.
- **A count is two acts and posting writes every variance at once.** A line that
  agrees writes nothing — there is no event in "nothing happened" — and
  `expected_quantity` is stamped at post time because a backdated movement
  tomorrow must not restate a variance that has already posted.
- **The count form deliberately hides what the ledger expects.** A number on the
  screen is the fastest way to make a count agree with a record that is wrong.
- **Expiry is on the LOT and FEFO is a suggestion.** Nothing refuses an issue
  from a later batch; the person holding the scoop can see which bag is open.
- Driven on the dev tenant: 20 lb of spoilage at $10.00, a count of 315 against
  330 posting −15 lb at $7.50, and the two reasons sitting apart on the panel.
  It found one defect — the ledger row said "Adjusted" and never why.
- Dossier: [inventory.md](inventory.md).

### 2026-08-20 — Production slice 0: the run, and the money that follows the meat (`claude/a-run-lands-in-stock`)
- **Fifth pack to ship, and the one that closes the profile's own thesis.** A pen
  accumulated chicks, feed and medicine and then the animals simply stopped being
  counted; nothing carried what they had cost into the freezer. *Every farm
  activity posts a cost to a cost object* described nothing for meat until now.
- **A run is two acts and the gap between them is WIP.** Starting takes the
  inputs out of stock; finishing lands the outputs with the input cost split
  across them. Forced rather than chosen — the split cannot be known until every
  box is off the line, and `inventory` stamps a receipt once.
- **The yield is folded and refuses more often than it answers.** Five of six
  outcomes in `core/yield.ts` are refusals, each because the alternative is
  confidently wrong in a stated direction. No stored factor anywhere: the design
  and `inventory`'s units file both say a baked-in live-to-hanging ratio is an
  unauditable fudge, and this is the place that was promised instead.
- **THE WITHDRAWAL CLOCK REFUSES SOMETHING FOR THE FIRST TIME**, which is what
  `livestock` slice 3 was built a slice early for. It needed a mechanism the repo
  did not have: `production` must not require `livestock` and `livestock` must
  not require `production`, so production names a slot and livestock fills it —
  **the first real use of P5**. Head still leaves through `removeHead`.
- **Condemnations decided and DEFERRED to slice 1, with the reason written
  down.** A condemnation arrives on the kill sheet from a party who is not this
  farm, and a `condemned_head` column here would make the yield wrong in a new
  way — the condemned animal's live weight is in the denominator and nothing
  short of per-animal weights takes it out. Slice 0 states its denominator
  plainly and refuses to adjust it.
- **Driven on `Hilltop Farm` before the PR** — 50 birds at 312 lb live, 218 lb
  of whole broilers out, **69.9%**, landed as a made-here batch, pen to 0 head
  with mortality still 0.0%. HOGS-1 refused with its clearing date. It found
  five defects, one of which had a passing test over the wrong behaviour
  (a pen with no recorded cost stamped $0.00, which says the birds were free).
- Dossier: [production.md](production.md).

### 2026-08-20 — Livestock slice 3: the guardrail, and the third state (`claude/the-withdrawal-clock`)

- **The design said "a default the user can override" and "never present a number
  as authoritative", and those two pull against each other.** Resolved by making
  the only default the farm's OWN previous entry for the same product, labelled
  with its date. A built-in drug table would satisfy the first and violate the
  second, and would be confidently wrong on somebody's actual bottle.
- **The design named two states and the build needed three.** Clear and under a
  period are not enough: a treatment given before anybody read the label is
  neither, and calling it clear is the app inventing the most dangerous number it
  has access to. `unknown` blocks exactly as a date does, and the screens say
  *"an unknown is not a zero"*.
- **A guardrail with nothing to guard, deliberately.** The clock cannot refuse
  anything today because processing is slice 6 and milk sale is `retail`. Wiring
  a refusal to the nearest available verb would have been worse than none — a
  withdrawal legitimately follows an animal sold live to another farm. The clock
  is loud everywhere instead, and slice 6 inherits the enforcement point.
- **PROVENANCE, A FOURTH TIME.** Feed cost carries measured-versus-allocated,
  weights carry their method, conversion carries both, and now a withdrawal
  carries whether it came off a label, from a vet, or from nobody. The profile's
  rule that *every derived cost should carry its provenance* turned out to
  generalise past cost entirely.
- **One pack's slice broke a number in another's**, and it is the first time that
  has happened here: medicine issued to a pen landed inside "Fed". Caught because
  the feed figures were driven immediately after. The fix is a kind exclusion in
  `livestock`, not a filter in `inventory` — the classification belongs to
  whoever owns the word.
- Full build record in [livestock.md](livestock.md), with the read it needed in
  [inventory.md](inventory.md).

### 2026-08-20 — Livestock slice 5: the enterprise gets its verdict (`claude/weights-carry-a-method`)

- **Taken out of order, and the reason is a deadline rather than a preference.**
  Slice 3 was next; a batch that goes to the processor unweighed can never have
  an FCR, and the pilot's broilers are days away. Slices are an ordering of
  value, not a queue.
- **THE PROFILE'S PROVENANCE RULE IS NOW ONE FUNCTION.** *Broiler FCR from bagged
  feed against sampled weights is measured and can be acted on; cattle gain from
  a tape against allocated pasture cost is estimated and is a trend to watch* —
  written a week ago as a design principle, and now `combinedConfidence`, with
  the badge it produces on every conversion on the screen.
- **The tape divisor went in the PROFILE, not the pack**, which is the first time
  `packConfig` has carried a number that changes an answer rather than a word or
  a list. A pack that knew a pig is 400 and a cow is 300 would know what a pig
  is; poultry has no divisor because nobody tapes a chicken, and the form
  silently stops offering the method.
- **What the app refuses is now most of what it does here.** Six separate reasons
  a conversion is not given, each printed where the number would have been. For a
  farm's first season the reason is the useful part, and *"one weighing — gain
  needs two"* is an instruction where a blank cell is a shrug.
- **The advisor found the defect again, and again it was the digest.** Third time:
  the dates of the losses, then when the herd moved onto its ground, now the
  window a daily gain was measured over. **When an answer is poor, look at what
  it was told before touching the prompt** — that debugging loop has now paid for
  itself three times, and it is the single most transferable thing in this build.
- Full build record in [livestock.md](livestock.md), with the reads it needed in
  [inventory.md](inventory.md) and [land.md](land.md).

### 2026-08-20 — Livestock slice 2: the 10× seam, built at 1× (`claude/feed-and-fcr`)

- **The design's "single largest consequence of the 10× target" is now
  built, and the pilot does not use it.** At 1× a bag goes to a pen and somebody
  knows which pen; the allocation path exists for the day a ton arrives into a
  bin serving fifteen pens. Both paths are live, and the screen tells a farm at
  1× that having no shared feeder is the right answer at its size.
- **PROVENANCE TURNED OUT TO BE THE FEATURE.** The design's line — *every
  derived cost should carry its provenance; same report, different confidence* —
  was written as a reporting nicety. Driven, it is what makes the report
  credible: a pen reading "Both · $260.78" with the measured and allocated halves
  spelled out is a number a person can argue with, and one reading "$260.78" is a
  number they either accept or stop using.
- **The cold start's other face: a report is only as good as what it refuses.**
  FCR is the number this enterprise is judged on, weights are slice 5, and the
  temptation to divide feed by head and call it conversion is exactly the failure
  the profile's AI section warns about. The page says what it cannot compute, in
  words, on the card where the number would have gone.
- **The AI thesis held again, with no prompt change.** The digest gained feed
  cost and its provenance; asked what a pen had cost and whether its conversion
  was any good, the advisor gave the figure, called its own confidence *partial*,
  named the assumption the shared-feeder split rests on, and refused the FCR —
  *"it would be a number I made up wearing your farm's name"* — then said what to
  record to get a real one. **The digest is the product**, third demonstration.
- **Four defects, all found by clicking, none visible to a type or a test.**
  A pen nothing had been fed read "$0.00 a head"; two pens placed the same day
  were compared against each other as if they were a sequence; the draw picker
  offered live chickens as something to tip into a feed bin; and an allocated
  share was rendered to the gram. That is now five weeks running.
- Full build record in [livestock.md](livestock.md), with the reads it needed in
  [inventory.md](inventory.md).

### 2026-08-19 — The advisor, and the proof that the anchoring is the product (`claude/livestock-advisor`)

- **Livestock slice 1b: ask and orient.** The other half of the day-one wedge,
  and the piece that works with nothing recorded at all — which is the whole
  answer to the cold start this profile named as outranking the schema.
- **The AI thesis this dossier named is now demonstrated rather than asserted.**
  Given a digest of the farm's own records, the advisor answered "is this loss
  rate normal" by correlating two loss clusters with the day the pen moved
  paddock sixteen days in, separating predation from heat from flip and saying
  what to check today. The same question with no digest gets a paragraph anybody
  could have written. **The anchoring is the differentiation, not the model.**
- **The advisor found the gaps in its own context.** Driven against the live
  API, it twice said what it was missing — the DATES of the losses, and when the
  herd moved onto its current ground. Both were in the database and neither was
  in the digest. That is the debugging loop for every AI feature in this
  profile: when an answer is poor, look at what it was told before touching the
  prompt.
- **The consequence-and-reversibility line held under a real test.** Asked for a
  penicillin dose and withdrawal period it refused both, explained what governs
  them, and told the founder to record the treatment — which is slice 3's
  feature described by the thing that would not do slice 3's job.
- **No migration.** The conversation is component state and nothing is written,
  so the rule that AI never produces a number entering the books or an animal
  without a human seeing it first is true by construction here.
- Full build record in [livestock.md](livestock.md).

### 2026-08-19 — Inventory slice 1: the first money on the farm (`claude/feed-in-feed-out`)

- **The profile's thesis stops being a sentence.** *Every farm activity posts a
  cost to a cost object* has been the argument for this whole build, and until
  today nothing on the farm cost anything: beautiful ground, counted birds, and
  no money anywhere. Feed in with a price, feed out to a pen, and "what did this
  pen cost" became a query.
- **Two columns did it.** `cost_cents` on the movement and `issued_to_lot_id` —
  which lot ate it. The second is the whole loop: a pen of broilers charged for
  a delivery of feed that is a different item entirely, joined by the lot that
  the design named the cost object three months ago.
- **Cost is stamped at issue, never derived later**, or a later delivery would
  rewrite what an earlier batch cost and every FCR comparison would be
  meaningless. This is the same class of decision as `land`'s "rest is what
  happened, not what is planned".
- **Layer two of three, and the third stays out.** No posting to 1300 or 5000
  in this slice — presentation is basis-dependent and derived at read time per
  ADR 0007. Cost accumulation is always on; how it appears in the books is not
  this slice's business.
- **`livestock` slice 2 (feed + FCR) is unblocked**, which the design calls the
  broiler enterprise's verdict.
- Full build record in [inventory.md](inventory.md).

### 2026-08-19 — Land 2a.1b: ask the county, not the farmer (`claude/find-my-parcels`)

- **The founder's original ask, answered three slices late**, and the delay is
  the lesson: 2a.0 asked him to paste GeoJSON, 2a.1 asked him to trace by hand,
  and both put the survey work on the person who already paid a county to do it.
  *The data existed the whole time.* Worth carrying into every other pack in
  this profile — before building an entry screen, ask who already holds the
  record.
- **Ohio publishes all 88 counties as one statewide service**, free and keyless,
  so the pilot and every future Ohio client are covered by one integration.
- **Searching by tax mailing address finds a whole farm at once** — nine parcels
  across four roads and 462 acres in Knox County — because that is how a county
  groups a holding. It carries no owner name, and for this purpose the mailing
  address is the better handle anyway.
- **The geometry got its strongest verification as a side effect.** The county's
  acreage sits next to ours on nine real parcels and agrees within about 1% on
  every one. Until now the spherical formula had only been checked against
  polygons this codebase invented.
- Full build record in [land.md](land.md).

### 2026-08-19 — Land 2a.1: the map, and a wrong front door replaced (`claude/land-map`)

- **The founder drove 2a.0 and rejected its entry path**, correctly: *"I don't
  understand pasting the json coordinates."* The lesson is worth keeping at
  profile level, because it will recur in every pack this profile installs —
  **the machinery being right does not make the door right.** Everything under
  the paste box survived unchanged; only the way in was replaced.
- **The basemap is public-domain USDA/USGS orthoimagery.** The design already
  said NAIP and recorded US-only coverage as acceptable; building it turned that
  into a licensing decision, since the good-looking alternative (Esri World
  Imagery) is a licence a commercial multi-tenant product would have to hold.
- **What the founder actually asked for is not finished.** "Type in the parcel
  number and it auto traces the property" needs a parcel data source — a county
  ArcGIS service (free, per-county), Regrid (nationwide, paid), or FSA field
  boundaries the producer exports themselves. Recorded in [land.md](land.md) as
  2a.1b, undecided.
- Full build record in [land.md](land.md).

### 2026-08-19 — Land 2a.0: the shapes, and the arithmetic that had to be spherical (`claude/land-geometry`)

- **Geometry landed as `jsonb` on parcels and zones, with the math in JS** —
  the design's settled answer, and building it confirmed the sizing rather than
  straining it. The founder chose **MapLibre over NAIP aerial** for the map that
  follows, so the US-only geodata assumption in this dossier is now a decision
  rather than an acceptance.
- **2a split into three**: the shapes and the arithmetic (this), the map with
  drawing (2a.1), the standing-in-a-field pre-fill (2a.2). The map and the
  drawing surface are one slice because the pilot's zones have no coordinates —
  a map without a way to draw would render an empty grey rectangle.
- **The design's "point-in-polygon is the biggest data-entry win" claim now has
  a consumer.** When it was written, there was no field form to pre-fill.
  `livestock` slice 1a shipped the daily round four days later, and that is the
  form. `zoneAtPoint` is built and waiting for it.
- **A planar area formula would have been wrong by 23% at this farm's
  latitude** — over two acres on a ten-acre paddock. Worth recording in the
  profile and not only in the pack, because every per-acre figure this profile
  promises divides by that number.
- **The declared acreage is never overwritten by the measured one.** A deed
  figure and a fence line disagree for real reasons, and the profile's whole
  accounting claim rests on ground that carries a cost object with a stable
  area. Reported, never corrected.
- Full build record in [land.md](land.md).

### 2026-08-19 — The day-one wedge is built, and it stores a fact no ledger could (`claude/livestock-daily-log`)

- **Livestock slice 1a: the daily round.** The design named this the wedge for
  the cold start, and building it turned up the one thing in this profile that
  genuinely could not be composed out of a neighbour: **the fact that somebody
  looked.** Every other record in four packs is something that happened — head
  placed, head lost, a herd moved — and a day when nothing happened leaves all
  of them empty. Empty is indistinguishable from nobody walking the pens, and
  the mortality denominator the broiler enterprise is judged on rests on telling
  those apart. So `livestock` gained a third table, and it holds exactly that.
- **Slice 1 split in two.** The design's line is "daily log + advisory layer",
  which is a table and a screen plus an AI surface with no schema at all. 1a is
  the log; 1b is "ask it things", and it is next.
- **The pack model kept paying.** The loss entered on the round is an
  `inventory` movement, the paddock on the row comes from `land`, the head count
  is the same fold `inventory`'s own pages use, and this pack still stores no
  count of anything. The only new column is a status with two values.
- **Land's rule generalised to storage.** *Anything derivable from a record
  already being made must never become a second data entry* — a `deaths` column
  on the check would have been a second number that must agree with the ledger
  forever, so the round reads losses back out of it instead.
- **The 10× target decided the shape of the screen, not the schema.** One tap
  confirms the whole farm, exceptions cost a dialog, and the button cannot
  overwrite an exception already entered. At ~14 pens today that is a
  convenience; at ~30 it is the difference between a system used and one
  abandoned in March.
- Full build record in [livestock.md](livestock.md).

### 2026-08-15 — Animals go in a pen, not only on a paddock (`claude/occupancy-structures`)
- Founder, after driving livestock: *"sometimes there is no structure. cattle
  just roam in the zone, but chickens are assigned to a pen."* Occupancy now
  names an optional **structure**, which is an asset — a chicken tractor, a
  barn, a greenhouse. The design had already written that a chicken tractor is
  an asset that holds a lot and sits on a zone; this is that sentence built.
- **It exposed a guard that was wrong.** Land slice 1 refused two open stays on
  one paddock. But the pilot runs ~14 pens across 20 paddocks, and the eggmobile
  follows the cattle onto ground they are still grazing — several occupants on
  one paddock is the normal case here, not an error. Corrected; recorded in
  [land.md](land.md).
- **The profile was installed on the pilot tenant for the first time.** Until
  now the packs had been switched on individually, so `tenants.industry` was
  still `general` and every profile-supplied value was absent. Installing it is
  what finally made `packConfig` and `resolveLabels` reach a screen: Land now
  says "Paddocks", and livestock offers cattle, swine and poultry.

### 2026-08-15 — Livestock slice 0, and the pack model's bill comes due (`claude/livestock-lots`)
- **The largest pack in the profile needed TWO TABLES.** Its slice 0 is "lots +
  head ledger + occupancy", and all three already existed — the lot and the
  ledger in `inventory`, occupancy in `land`. What was left was species, birth
  date and tags. Six tables' worth of design, two tables of code.
- **That is the whole argument for ADR 0004, settled empirically.** Had
  `livestock` been built first, there would now be a livestock lot table, a
  livestock head counter and a livestock occupancy table — three duplicates that
  `crops` and `production` would each have had to choose between.
- **The claims held under composition**: a split still balances when livestock
  drives it and carries the biology across; head events land in inventory's
  ledger stamped as livestock's; moving a herd onto a paddock writes land's
  occupancy and starts its rest clock.
- **Four of seven packs built.** Full build record in [livestock.md](livestock.md).
- **The open item that now matters most is not a feature.** Writes are
  owner-only across all four packs, forced from below by
  `upsertDimensionMember`. Recording four dead birds is daily work done by
  whoever is in the pen, and slice 1 is the daily log — so this needs settling
  before the wedge, not after it.

### 2026-08-15 — Inventory slice 0: the lot spine exists (`claude/inventory-lot-spine`)
- **`livestock` is unblocked.** It declares `inventory` in `requires` for the lot
  spine, and the spine now exists: quantity-bearing lots with event-sourced
  balances and lineage, where an individual is a lot of one, and split and merge
  are the only operations that change cardinality.
- **A split BALANCES**, certified rather than asserted — 210 chicks split 70 into
  a pen leaves 140 and 70, with an item total still reading 210. That property is
  what makes a head count reconcile with its own history instead of being
  declared.
- **Head really is just a unit of measure**, as the design claimed. It sits in
  the `count` dimension beside `each` and `dozen`, and the head ledger turned out
  to be the inventory ledger with no special case anywhere in the code.
- **`inventory` now requires `assets`** — a storage location IS an asset, so the
  ledger points at one with a composite FK rather than growing a parallel
  location model. Every profile listing `inventory` already lists `assets`.
- **Three packs built, four to go.** Full build record in
  [inventory.md](inventory.md).

### 2026-08-15 — Land slice 1: occupancy is the join, and it exists now (`claude/land-occupancy-rest`)
- **The record that carries cost allocation in both directions is built**, which
  is the thing the Livestock design named as what joins `land` to `livestock`. A
  zone accumulates cost, occupancy allocates it to whatever grazed, and the
  animal's revenue allocates back by the same basis. Forage never has to be
  priced, and the table that makes that possible is in place before either pack
  that will use it.
- **`livestock` slice 0 is no longer blocked on anything in Land.** Its "lots +
  head ledger + occupancy (shared with `land`)" line now has the land half done,
  and the write path is an ordinary op call with `extensionSlug: 'livestock'`.
- **The pilot's grazing shortfall is now computed on screen** rather than in a
  dossier: 12 paddocks at a day each yield 11 days against a 21-day target, so
  the target is arithmetically out of reach and the app says so from records
  entered anyway. That was the argument for the whole category and it is now a
  card on a page.
- **The design's rule held under construction:** *anything derivable from a
  record already being made must never become a second data entry.* Rest days,
  grazing days, stay counts and the rotation finding are all derived. Nothing
  new is typed.
- Full build record in [land.md](land.md).

### 2026-08-15 — Land sliced and slice 0 built (`claude/land-places`)
- **Land was the only category whose design carried no slice order**, so
  proposing one was the first act of building it. Agreed order and reasoning are
  in [land.md](land.md); the headline is that **occupancy comes second, before
  geometry**, because it is what `livestock` is blocked on and it delivers rest
  days for free, while the map blocks nothing.
- **Slice 0 shipped**: parcels, zones, dated zone use, both levels synced as cost
  objects. Full build record in [land.md](land.md).
- **Settled where occupancy lives.** The design says occupancy is fact and comes
  from `livestock` and `crops` — which is true about who ORIGINATES it, and left
  open who owns the table. `land` owns it, because rest is computed from it and a
  pack may not read another pack's tables; the other packs write in through
  land's ops using the open `entity_type` pattern.
- **Slice 1 will ship a manual occupancy form**, so the record can be made
  months before `livestock` exists. That is the cold-start wedge applied to Land:
  a rest clock that only starts working after two more packs ship is a rest clock
  nobody ever sees.
- **Weather is deliberately late and it costs nothing** — Open-Meteo serves
  history by lat/long, so the "collection must start in slice one" worry in the
  design does not survive contact with the API.

### 2026-08-13 — Assets & Crops designed; every category now has one (`claude/packs-and-profiles-design`)
- Final two categories, taken together because both were confirmations rather
  than discoveries. Write-ups:
  [Assets](#category-design--assets-brainstormed-2026-08-13) ·
  [Crops & garden](#category-design--crops--garden-brainstormed-2026-08-13).
- **Almost every structure on this farm is mobile** — chicken tractors and an egg
  coop on a wagon frame. So **asset location is a time series, not a field**, and
  mobile assets reuse `livestock`'s occupancy model rather than getting their
  own. The layers rotate too, which an earlier session had wrong.
- **Occupancy can be scheduled relative to another lot's, with a lag.** The
  eggmobile follows the cattle, so the layer flock has a *derived* rotation, can
  never overtake the herd, and the relationship suspends at the seasonal haul.
- **Reversed an earlier judgement on crop planning.** "Crowded space, build the
  minimum" was right about a standalone planner and wrong here — the same
  structural reason the AI feed position was wrong. Rotation by family is the
  real agronomy and it needs bed history, which Land already supplies.
- **Named the product's AI thesis** after rediscovering it three times: every AI
  feature here beats its standalone equivalent because of the context around it.
  The anchoring is the differentiation, not the model.
- **Found a gap spanning the whole profile: personal-use draw.** Household
  consumption is not a sale, and without it every enterprise that feeds the
  family looks worse than it is.
- **Haymaking needs no model change** — bought hay has a purchase basis, made hay
  has accumulated production cost, and Inventory's third cost flavour already
  carries both.

### 2026-08-13 — Retail brainstormed to a design (`claude/packs-and-profiles-design`)
- Fifth category to a design. Write-up under
  [Category design — Retail](#category-design--retail-brainstormed-2026-08-13).
- **The offline problem at market was already solved** by the Inventory
  decision that the truck is a mobile location — sales draw down the truck, not
  the farm, so there is no shared state to conflict over.
- **Stockouts are invisible unless recorded.** Selling out looks like a perfect
  day in the sales data and is actually lost revenue; "sold out of X at Y"
  is the only way that signal ever enters the system.
- **A deposit is a liability, not revenue** — the case where the pilot's two
  required reporting bases disagree on real money for months.
- **Fulfilment point is per commitment** (plant or farm), and a half that comes
  home occupies freezer space, so the capacity headroom must count transiting
  commitments and not just retained stock.
- **The processing fee charged both ways is a comparability trap** — same
  margin, very different $/lb — so the arrangement is captured per order.
- **Payments: an adapter seam, staged read-then-write.** A web app cannot talk
  to a card reader, so the Terminal API is the route that makes this app the
  point of sale. Stage 1 (pull settlements and fees into the books) carries most
  of the accounting value with no hardware dependency. Honest limit recorded:
  card authorisation needs connectivity, so cards cannot go fully offline.
- **The honour-system store derives sales from counts**, making shrinkage and
  revenue indistinguishable without count discipline — the one channel with no
  transaction record.

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
| Land | `land` pack — parcels, zones, geometry, area | no | **done** — [category design](#category-design--land-brainstormed-2026-08-13) · **slices 0–2a.1b built**, [land.md](land.md) |
| Buildings | `assets` pack, `asset_kind = 'building'` | no | **done** — [category design](#category-design--assets-brainstormed-2026-08-13) |
| Equipment | `assets` pack, `asset_kind = 'equipment'` | no | **done** — same design |
| Livestock | `livestock` pack | **yes** | **done** — [category design](#category-design--livestock-brainstormed-2026-08-13) · **slices 0–1 built**, [livestock.md](livestock.md) |
| Gardens/crops | `crops` pack | **yes** | **done** — [category design](#category-design--crops--garden-brainstormed-2026-08-13) |
| Butchering | `production` pack | no | **done** — [category design](#category-design--production-brainstormed-2026-08-13) |
| Baking | `production` pack — shared run, separate template | no | **done** — same design |
| Retail | `inventory` (**slices 0–1 built**, [inventory.md](inventory.md)) + `retail` packs | no | **done** — [inventory](#category-design--inventory-brainstormed-2026-08-13) · [retail](#category-design--retail-brainstormed-2026-08-13) |
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

**Status as of 2026-08-13: every category has a design.** All seven packs were
brainstormed against the pilot farm in one sequence — `land`, `livestock`,
`inventory`, `production`, `retail`, then `assets` and `crops` together. Each has
a category-design section below and a slice order.

- **Designed:** land · livestock · inventory · production · retail · assets ·
  crops.
- **Mapped to existing core, no pack needed:** accounting (seed + config),
  communication (email + CRM), vendor scheduling (scheduling + party spine).
- **Explicitly deferred as code:** marketing — see *Explicitly deferred*.

**Four of the seven are being built.** `assets` has shipped register,
containment, depreciation, disposal and maintenance
([assets.md](assets.md)); `land` has shipped slice 0
([land.md](land.md)) and carries the slice order the design lacked. The other
five are still designs. The risk the earlier version of this paragraph named —
that designing stays comfortable while building does not — has not gone away, it
has just moved down the list to `livestock` — which is now unblocked, and is the
pack the pilot farm actually lives in.

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

### Slice order

Added 2026-08-15. This design shipped without one, alone among the seven — the
order below was proposed and agreed before slice 0 was written, and the
reasoning behind each position lives in [land.md](land.md).

| # | Slice | Why here |
| --- | --- | --- |
| 0 | Parcels, zones, dated zone use | Everything spatial references it. Usable alone on day one |
| 1 | Occupancy + rest | What `livestock` is blocked on, and the free feature this whole category was argued for |
| 2a | Geometry — polygons, area, map | Nothing is blocked on it, and its best payoff needed field forms that did not exist — the daily round is now that form. **Split into 2a.0 shapes (shipped 2026-08-19), 2a.1 map + drawing, 2a.2 pre-fill** |
| 2b | Features — points and lines | The `assets` seam. Needs 2a's primitives |
| 3 | Weather + GDD | Cheap, and **backfillable** — Open-Meteo serves history by lat/long, so being late costs nothing |
| 4 | Lease screens, hauls, payback warning | Deferred by this design already |

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
| 1 | **Daily log + advisory layer** | The day-one wedge. Habit and cold start. **Split when built: 1a the log, 1b the advisory — both shipped 2026-08-19** |
| 2 | Feed + FCR (direct issue now, allocation seam for 10×) | Largest cash cost, and the broiler enterprise's verdict. **Feed and the allocation seam shipped 2026-08-20; FCR itself waits on slice 5, because gain needs weights and nothing may invent one** |
| 3 | Health + withdrawal clock | Legal guardrail; useful at first use. **Shipped 2026-08-20** |
| 4 | Breeding + genetics + registry | Needs a season of calving to pay off |
| 5 | Weights (tape formulas, sampling) | Sharpens everything above. **Shipped 2026-08-20, ahead of 3 and 4: a batch processed unweighed can never have an FCR** |
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
| 0 | Items + units + locations + on-hand ledger + **the lot spine** | The day-one wedge: what do I have and where |
| 1 | Receipts and issues | Feed in, feed out to lots — closes the `livestock` costing loop |
| 2 | Adjustments, physical counts, expiry/FEFO | Makes the balance trustworthy |
| 3 | Valuation + COGS posting, basis-aware | Rides the existing ADR 0007 lens |
| 4 | Commitments (pre-sold halves) | Needs `production` and `retail` to be useful |
| 5 | Reorder points, capacity warnings | Needs history |

Production outputs land in inventory but are blocked on the `production` pack.

> **The lot spine is IN slice 0, decided 2026-08-15.** The original list did not
> name it, and that ambiguity mattered: `livestock` declares `inventory` in
> `requires` specifically for the lot spine, so an inventory slice 0 without it
> would ship and leave livestock exactly as blocked as before — which defeats
> the reason for building inventory ahead of the pack that needs it. Head is
> just a unit of measure, a lot is a ledger of head, and split and merge are the
> only operations that change cardinality; all of that is the spine rather than
> an extension of it. Items and locations ride alongside.

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

## Category design — Retail (brainstormed 2026-08-13)

Where four parked items land: commitments, the hanging-weight invoice, channel
eligibility enforcement, and market-truck reconciliation.

### The offline problem was already solved in `inventory`

Markets often have no signal and a customer is standing there with cash, so this
was flagged early as the constraint easiest to design past. The usual answer is
a distributed-inventory problem. There isn't one, because **the market truck is
a mobile location** (Inventory design):

1. Loading the truck is a **transfer** — the app knows exactly what left
2. Sales at market draw down **the truck's own inventory**
3. Unsold stock transfers back on return

**No shared state, so nothing to conflict over.** The truck holds what the truck
holds. Build the market screen offline-first, but the data-model problem is gone.

### A market day is a run-like event, and it should be profitable

Date, location, stall fee, hours, staff, weather, stock taken, sold, returned,
cash counted. Record it and **profit per market day** falls out, net of stall
fee, travel and the hours actually stood there.

With two or three markets a week, **one is usually a dud attended out of habit**,
and two seasons of this data ends that argument. At 10×, with paid staff working
stalls, it stops being interesting and becomes necessary.

### Stockouts are invisible unless recorded

> Bring 30 dozen eggs, sell 30 dozen. In the sales data that is a perfect day.
> **It is a lost-revenue event** — nobody knows how many people wanted eggs at
> noon and found none.

So the market day record needs **"sold out of X at time Y"**. One tap, and the
only route by which that signal ever enters the system. It answers "how much
should I bring" and feeds the cut-balance report from the Inventory design.

### The hanging-weight invoice, and where the two bases genuinely disagree

Reservation + deposit → slaughter → hanging weight known → final price = weight ×
$/lb → balance due less deposit.

**A deposit is a liability, not revenue** — a half a steer is owed until
delivery. On accrual it sits in unearned revenue until pickup; on cash basis it
is income the day it banks. **This is the case where the pilot's two required
bases disagree on real money for months.** Farm software routinely books the
deposit as a sale and overstates the year.

**Fulfilment point is an attribute of the commitment** — the customer collects
**either at the plant or from the farm**, both per order:

| Fulfilment | Path |
| --- | --- |
| At the plant | WIP → **delivered**. Never enters possession, never a location, never inventory |
| From the farm | WIP → **inventory at a location** → delivered |

**Consequence for capacity:** a half that comes home occupies freezer space while
it waits. Since one processing day roughly fills the pilot's cold storage, the
headroom calculation must count **transiting commitments**, not just retained
stock, or it is wrong exactly when it matters. Plant pickup has its own failure
mode — an uncollected half accrues storage charges billed to the farm — so
pending pickup is a state that should age visibly.

**The processing fee is charged both ways, and it is a comparability trap:**

- **Bundled** — the farm pays the plant (expense) and charges more (revenue).
  $/lb looks high.
- **Customer pays the plant** — that money never touches the books. $/lb looks
  low.

**Same margin, very different headline numbers.** Any report comparing price per
pound across years or against other farms is meaningless unless the arrangement
is captured per order and normalised.

### Channel eligibility is the guardrail

A sale line **validates the lot's eligibility against the channel** and refuses a
mismatch. The stamp already comes off the production run, so this is nearly free.

Today, all direct-to-consumer, it rarely fires. **At 10× with wholesale it is
what stands between the farm and an enterprise-ending mistake** — which is the
real argument for building the wholesale seam before wholesale exists.

### Customers are the existing party spine

Half-beef buyers and online orders are named parties; market cash customers are
anonymous (the traceability limit from the Inventory design). No new customer
model — the CRM party spine already carries it.

> **The customer who buys a half every year is the most valuable relationship on
> the farm.** No marketing cost, commits before the animal is processed, and
> takes a *balanced carcass* including the cuts nobody asks for at market.
> Prompting last year's buyers for this year's booking is ordinary CRM work with
> a direct line to revenue, and it never happens without a system.

### Payments: a provider seam, staged read-then-write

Pilot uses **Square and cash**, wants other providers as options, and wants the
whole transaction completed in this app.

**The constraint that decides the architecture:** taking a tap/dip card payment
needs either the provider's hardware or a **native** mobile app — a web app
cannot talk to a card reader, which is an OS-level fact rather than a Square
limitation. **The Terminal API sidesteps it**: the server sends a checkout
request to a physical terminal, the customer pays on the device, a webhook comes
back. **The app is the point of sale; the terminal is a card-handling
peripheral.** Card-not-present (online orders) uses the hosted web flow.

Two rules regardless of provider:

- **Card data never touches this server** — already this codebase's rule for
  Stripe. Use the provider's terminal or hosted flow, never handle the number.
  It is also what keeps the product out of PCI scope.
- **Payment API specifics move.** The shape above is stable; exact SDKs and
  endpoints deprecate regularly, so treat them as build-time verification rather
  than design-time memory.

**Build an adapter seam with Square as the first implementation, not three
integrations.** Stripe is the cheapest second provider — this codebase already
has a Stripe client, signature-verified webhooks and a server→Stripe reconcile
in `billing-sync.ts`, and Stripe has a Terminal product.

| Stage | What | Value |
| --- | --- | --- |
| **1. Read** | Pull transactions and settlements in, match to market days, post to books | High, low risk, **no hardware dependency** |
| **2. Write** | Drive the terminal so the sale starts in this app | The stated goal |

Stage 1 delivers most of the accounting value while cards are still tapped in
Square's own app, and it solves a chore that exists today: **settlements arrive
batched and net of fees.** A $500 market day lands as roughly $484 — the books
need revenue $500, a fee expense, and cash $484. The API supplies the fee
breakdown and the banking module already does the matching.

**Honest limit: cards and offline conflict.** Authorisation must reach the
network, so server-driven terminal payments simply cannot happen at a dead-signal
market. The design is: offline for inventory and cash, cards degrade gracefully,
and a dead market falls back to the provider's own app with reconciliation after.
Better stated in the design than discovered at a stall.

### The honor-system store derives sales from counts

Unattended breaks an assumption every other channel makes: **there is no
transaction record.** What sold is discovered by counting what is gone.

So that channel posts **revenue and variance from a periodic count**, and it is
the one place where **shrinkage and revenue are indistinguishable** without count
discipline. A self-checkout tablet closes the gap, but not before theft is known
to be material.

### Multi-market now, shipping as a costed seam

One market today with more soon, so build the list from day one — it costs
nothing. **Shipping frozen meat is a different operation**: insulated boxes, gel
packs or dry ice, overnight or two-day service, at a per-box cost high enough to
eat the margin outright if not priced deliberately. A designed-for seam with its
own costing, not a checkbox on the order.

### At 10× the bottleneck moves

Everything produced can currently be sold. At 10× the farm needs buyers for
something like 40,000 lb of chicken a year and markets do not absorb that.
**Production stops being the constraint and sales becomes it** — which is the
growth path that runs through wholesale, and why the eligibility machinery has to
be right before the first pallet leaves.

### Slice order

| # | Slice | Why here |
| --- | --- | --- |
| 0 | Channels + per-item-per-channel price lists + the market day record | Foundation; multi-market from the start |
| 1 | Market POS: offline-first, cash, draw from the truck location, sold-out capture, day-end reconciliation | The pilot's only channel today |
| 2 | **Payment adapter — read** (settlements, fees → books) | Most accounting value, no hardware dependency |
| 3 | Commitments: reservations, deposits, hanging-weight final invoice, fulfilment point | Needs `production`; unblocks the halves business |
| 4 | Farm store, attended and count-derived | Second channel |
| 5 | Payment adapter — write (drive the terminal) | The stated goal, once the seam is proven |
| 6 | Online orders + pickup windows | "Coming soon" |
| 7 | Shipping (costed), then wholesale (eligibility becomes load-bearing) | Both flagged as coming; neither exists yet |

## Category design — Assets (brainstormed 2026-08-13)

Buildings and equipment, which were always one shape. Short session by design:
this pack was *confirmed* rather than discovered, because Land, Inventory and
Production had each already needed it.

### The shape, already established three times

An asset is **a thing owned, with an acquisition cost, a depreciation life, a
location, an upkeep cost and a service schedule.** Land needed it for fences,
Inventory for freezers, Production for processing equipment. `asset_kind` is an
**open taxonomy (P1)** — building, equipment, vehicle, infrastructure, fixture —
so core stores the column and the profile supplies the values.

### Almost everything on this farm is mobile

The finding that made this session worth having. Pilot structures are a cow
shelter, **chicken tractors**, and an **egg layer coop on a wagon frame**. Only
the garage and barn are fixed.

> **Asset location is a time series, not a field.** "Where is the eggmobile" has
> a history exactly as a livestock lot's occupancy does — so **mobile assets
> reuse the occupancy model from `livestock`** rather than getting their own.
> Fixed assets simply have a static location.

Two consequences:

- **The layers rotate too.** An earlier assumption of a static henhouse was
  wrong. The flock has zone occupancy like the cattle and broilers, and
  contributes fertility as it moves — so the manure transfer priced in the
  Livestock design applies to eggs as well.
- **Occupancy can be scheduled *relative to another lot's*, with a lag.** The
  eggmobile **follows the cattle** (hens scratch through manure a few days
  behind, breaking the fly and parasite cycle). So the layer flock has no
  independent rotation — it has a derived one. If the cattle slow because grass
  is behind, the hens slow with them, and **the hens can never get ahead**, which
  makes it a constraint rather than a convenience. **It suspends at the seasonal
  haul** — a wagon coop does not casually trailer to the summer parcel — so the
  relationship holds within a parcel and breaks across the migration.

### Maintenance: two flavours, and it emits work items

- **Calendar** — annual service, seasonal checks.
- **Meter** — tractor and 4-wheeler hours. A meter reading is a recorded
  observation, and the same usage log allocates machine cost across zones.

> **Maintenance emits work items into the existing Work module rather than
> owning a task engine.** The single biggest reuse available in this profile;
> hold the line on it.

**Implements are separate assets, optionally linked.** The tiller attaches to the
tractor but has no hours of its own. Do not build a prime-mover/implement
hierarchy for one relationship.

### Assets contain things

Assets are also **locations for other things**: freezers hold inventory,
buildings hold assets, pens hold livestock lots. So containment is part of this
pack, and it is what makes the Inventory location chain resolve
(location → asset → building → parcel).

### The ledger side

- **Depreciation posts to the ledger.** Section 179 and bonus depreciation matter
  disproportionately to farms.
- **`livestock` also feeds the fixed-asset register** — purchased breeding stock
  is depreciable, raised breeding stock has no basis but is still a capital
  asset. The breeding-vs-market distinction from the Livestock design lands here.
- **Assets can be justified by measured outcomes.** From the Production design: a
  better plucker measurably improves birds per person-hour, and this pack holds
  both the asset cost and the labour hours. Equipment ROI proved rather than felt.

### Planning

Per the doctrine established in Land — planning ends in dollars, comes after
operations, and gets no `planning` pack until three examples share a shape:

- **Buy vs custom-hire**, which the pilot is about to face on **haymaking
  equipment** specifically (see Crops).
- **Repair vs replace**, from accumulated upkeep cost against the asset's value.

## Category design — Crops & garden (brainstormed 2026-08-13)

Mostly falls out of Land's zones and Inventory's harvest path — with one part
that does not, because the founder asked for a garden planner and was right to.

### Planting is the unit, not "crop"

A planting is **a variety, in a bed, on a date, with days to maturity, producing
harvests.** Beds are land zones, so the spatial half is free. Successions are
repeated plantings on an interval.

**Harvest feeds inventory** — that is the seam, and it is where the garden stops
being a hobby record and starts being an enterprise.

### The garden planner — a reversed judgement

An earlier session said crop planning was a crowded, low-willingness-to-pay space
and to build only what feeds costing. **That was a fair argument about a
standalone planner and the wrong argument here**, for the same structural reason
the AI feed position was wrong:

> A companion-planting chart is free on the internet. *"Here is what to plant in
> Bed 4 given what was there last year, your soil test and your frost dates"* is
> not.

The caution that survives is narrower: **the planner is downstream of the
operational record.** It is only good once beds and history exist, so it is not a
slice-one feature — but it is a feature.

**What is real agronomy and what is folklore.** Classic companion planting mixes
solid practice with thin evidence, and the app should not dress tradition up as
science. The load-bearing part:

- **Rotation by plant family** — the highest-value rule there is (disease cycles,
  pest cycles, nutrient depletion). **It needs bed history, which the dated
  zone-use decision in Land already provides.**
- Legumes ahead of heavy feeders; a few well-supported antagonists; shading from
  tall crops.

Encode the folk layer as *common practice*, and let rotation carry the weight.

**Planting dates are arithmetic, not AI.** Frost dates for the location + days to
maturity + direct-seed-or-transplant gives start-indoors, set-out and harvest
windows; fall planting works backward from first frost. **GDD refines all of it**
— the calendar says one thing, accumulated heat says another, and the second is
right.

### Photo diagnosis: assistive, and the loop closes

Plant disease is among the better-suited vision tasks — blights, mildews,
mosaics and deficiencies have distinctive symptoms. It is also genuinely
error-prone, because fungal, bacterial, nutrient and herbicide-drift damage can
look alike while their treatments differ completely.

So: **ranked possibilities with confidence and what to check to confirm** —
never a flat diagnosis. What makes it better than a plant-ID app is anchoring: it
knows what is in that bed, what was there last season, what has been sprayed, and
what the weather has been (humidity and rainfall drive most fungal disease).

**And the loop closes on machinery already built** — suspected issue → treatment
options → **the treatment starts a pre-harvest interval clock**, which is the
withdrawal mechanism from Livestock under another name.

### Soil and fertility

- **Soil tests over time per bed** with amendments applied — a tiny table with
  the longest-horizon value in the pack.
- **Fertility arrives from livestock.** Grazing and the eggmobile deposit real
  value on a zone, and the Livestock allocation already prices it. So crops
  *receive* an allocated input rather than starting from zero — which is the
  clearest single demonstration of the two-way allocation working.

### Hay: bought now, made soon

Bought hay is a vendor purchase into feed inventory. Made hay is the
crop → harvest → feed-inventory loop with **accumulated production cost instead
of a purchase price** — the third cost flavour the Inventory design already
carries. **So starting to make hay requires no model change, only the crop side.**

It also hands the pilot a decision it is about to face: **is making hay cheaper
than buying it?** Equipment, fuel, labour and the real risk of weather ruining a
cutting, against a known purchase price. Small farms routinely find that owning
haymaking equipment for few acres loses to custom hire or buying. With both data
points recorded it is answerable rather than argued.

## Cross-cutting items from the Assets & Crops session

Three things that are not confined to one pack.

### Personal-use draw — a gap across the whole profile

The garden serves family *and* market, which surfaces something missing
everywhere until now: **household consumption is not a sale.** Own eggs, own
beef, own vegetables leave inventory with **no revenue against them**, so every
enterprise that feeds the family looks worse than it is — and the books are wrong
in a way that matters, since personally-consumed product should not sit in
business cost of goods.

> **Personal-use draw must be a first-class inventory movement, valued at cost**,
> and it applies to eggs, meat and produce alike — not just the garden.

### Sequenced occupancy belongs to `livestock`

The eggmobile-follows-cattle relationship is an addition to the **occupancy
model**, not to assets: a lot's occupancy may be scheduled **relative to another
lot's, with a lag**, and the follower cannot overtake the leader. Recorded in
full under the Assets design above; the implementation lands in `livestock`.

### The product's AI thesis, named

It has now been rediscovered three times — feed advice, batch results, plant
disease — so it is written down once:

> **Every AI feature in this product beats its standalone equivalent because of
> the context around it.** The answer is anchored to the tenant's own data — its
> animals, beds, weather, history and books. A generic tool cannot do that, and a
> general-purpose model has none of it. **That anchoring is the differentiation**,
> not the model.

It composes with the doctrine from the Livestock design (*ask-and-orient* is
ungated; *compute-and-commit* is deterministic or human-confirmed) rather than
replacing it.

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
- ~~Crop *planning* features beyond what feeds inventory and costing~~ —
  **reversed 2026-08-13.** That judgement was about a standalone planner; a
  planner anchored to the tenant's own beds, history, soil tests and frost dates
  is a different product. See the Crops design. It remains *downstream of the
  operational record*, so it is not an early slice.
- EPD-style breeding value calculations. Rabbit hole.
- CSA share management. Real, but its own pack, after `retail`.
