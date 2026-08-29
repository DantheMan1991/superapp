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
| **2a.0** | **Boundaries** — GeoJSON in jsonb, spherical area, containment, paste-a-boundary | **shipped 2026-08-19** |
| **2a.1** | **The map** — MapLibre over NAIP aerial, and DRAWING in the same slice | **shipped 2026-08-19** |
| **2a.1b** | **Find my parcels** — the county's own boundary by parcel number or tax mailing address | **shipped 2026-08-19** |
| **2a.2** | **Standing in a field** — point-in-polygon fills the paddock in for you | **shipped 2026-08-19** |
| **2b.0** | **The as-built layer** — `land_features`, `planned`/`built`/`removed`, symbology, the length function, the aerial/plan toggle | **shipped 2026-08-28** |
| 2b.1 | **Plans and the takeoff** — a named set of proposals, saved quantities, hand-added lines | |
| 2b.2 | **"What is here"** — the phone screen: what am I standing on, within 100 ft | |
| 3 | **Weather + GDD** — Open-Meteo by parcel centroid | |
| 4 | Lease screens, haul movement and cost, the improvement-payback warning | |

Weather is late deliberately and it is not a lapse: Open-Meteo serves history by
lat/long, so a delayed start loses no data. Geometry is late because nothing is
blocked on it and its top-ranked payoff — point-in-polygon pre-filling a zone on
mobile — had no consumer until there were field forms to pre-fill. **There is one
now**: `livestock` slice 1a shipped the daily round on 2026-08-19, which is the
form 2a.2 pre-fills.

**2a was split into three when it came to be built**, agreed 2026-08-19: the
shapes and the arithmetic, then the map, then the pre-fill. The map and the
DRAWING surface are deliberately one slice and not two — this farm's zones have
no coordinates, so a map shipped without a way to draw would render an empty
grey rectangle and prove nothing.

**Never in `land`:** profit per acre (downstream of the allocation engine), the
grazing wedge and dry-matter measurement, and every **optimizer** — a routine
that decides a layout for you, of which water layout is the named example.
Operations first, planning second.

**That rule used to say "every planner", and it was wrong** — corrected
2026-08-28 with the founder, who had never agreed to it and pointed out that he
had asked for planning from the start. One word was covering two things. An
OPTIMIZER designs for you: a spanning tree over hydrant points, gravity versus
pumped, pipe sizing. It stays out, and the category design already drew that
line for a second reason — *"this is planning support, not engineering… pipe
sizing, friction loss and pump selection are somebody's stamped design and the
liability is not ours to carry."* A TAKEOFF is arithmetic on a shape you drew
yourself: 1,240 ft of fence ÷ 8 ft spacing = 156 posts. That is in, and it is
slice 2b. Nothing about it decides anything for anybody.

## The site plan — designed 2026-08-28, **2b.0 SHIPPED**

**Read this before starting 2b.1 or 2b.2.** The first version of this section
was a brainstorm; it was argued through with the founder the same afternoon and
**four of its conclusions changed**, and then 2b.0 was built from it that
evening. What follows is the settled shape. **The as-built layer, the status
column, the symbology and the length function are now live**; plans, the saved
takeoff and the phone screen are not. The sections below describe all of it,
because the argument for the unbuilt half is the same argument that produced
the built half — but the slice table above is what says which is which.

2b was expected to split the way 2a did, and it did: the table + status +
symbology + length pay for themselves on their own, and everything else waits
on a consumer. It split when it came to be built, not before.

**The founder's ask, in his words:** take the parcel map and identify what is
actually there — tree lines, fencing rows, buildings — *"and then keep that map
but also generate a site plan drawing that I can add features like fencing,
gates, buildings, waterlines to. It needs measuring tools. A full suite."* And,
in the conversation that settled it: *"I just need it transferred to a line
drawing"*; buried electric lines, and *"the fence has the 3 strand hot"*; a new
fence where *"it then helps you figure out the materials you would need"*; and
on the phone, *"it auto displays relevant information to whatever is at your
location."*

### Most of the foundation is already here

Not a rewrite. The 2026-08-13 design chose GeoJSON in jsonb *specifically* so
this would be cheap — *"land is not only polygons… GeoJSON handles all three
natively, so it is free now and painful to retrofit."* Shipped and usable:

  - **MapLibre over NAIP aerial**, with tracing and corner-dragging
  - **Spherical area**, accurate enough to agree with a county figure to 0.003%
  - **Point-in-polygon**, bounding box, centroid — `core/geo.ts`
  - **Boundaries on parcels and zones**, validated and parsed
  - **Terra Draw** already mounted and already lazy-loaded for the polygon mode.
    Points and lines are modes it ships with.

### One map, two views, and NO transfer step

**Settled: the site plan is not a second drawing.** The founder's phrasing
sounded like one — *"transferred to a line drawing"* — and the brainstorm left
the choice open. It is one map, one set of georeferenced objects, and a basemap
switch: aerial on to trace and to check reality, aerial off to read the plan.

**Why that is the whole answer and not a compromise.** The aerial is a TRACING
SOURCE — you find the tree line on the photo because that is the only place it
is visible — and the object you draw from it is stored in lat/long like
everything else here. So there is nothing to transfer, nothing to copy, and no
second coordinate frame to keep in step. A correction to a fence is a correction
to both views, because there is only one fence.

**What makes it read as a drawing is SYMBOLOGY, not a second surface.** With the
imagery off, undifferentiated grey lines on white are worse than the photo. A
tree line drawn scalloped and green, a fence with tick marks, buried electric
dashed red, a waterline blue, a building as a filled polygon carrying its name:
that lookup from feature kind to line style is the entire difference between "a
plan" and "some lines", and it is a table rather than an engine. **This is where
the drawing work actually is** — budget for it as the substance of the slice,
not as polish at the end of it.

The sheet-shaped parts of "a drawing" — north arrow, title block, scale bar, PDF
export — answer no question on the list and are out of 2b.

### The unit of a feature: a thing you would say the name of

**Settled, and it is the change that made the rest cheap.** The founder asked
for *"individual fence posts"*, was asked what question a post row would answer,
and said he does not need them.

**A fence is ONE LineString with attributes** — post spacing, wire count, which
strands are hot, type — and posts are RENDERED as ticks along it and COUNTED by
dividing. Store 400 posts instead and every promotion of a proposal to built is
a 400-row transaction, four hundred rows can individually disagree with the line
they sit on, and none of it answers a question the line did not.

**The rule for what earns a row: something you would say the name of, or
something another record points at.** A gate, a corner brace, a hydrant, a
trough, a valve, a tank, an energizer — those are points, and they are named
("the gate at the top of the lane"). Post #237 is not a thing anybody refers to.

This is the same argument the pack has already won twice — a polywire strip is
an AREA ON AN EVENT rather than a geometry, and a zone's use is a dated row
rather than a column — and it lands the same way: model the thing people talk
about, derive the rest.

### Status: `planned` / `built` / `removed`, in the first migration

**Unchanged from the brainstorm, and the mobile screen supplied a better
justification than the one it was written with.** One table, a status column,
promotion in place. Never a separate "plans" table duplicating geometry, or a
built fence and the proposal it came from drift apart.

The brainstorm justified it with reports — *a planned waterline must not answer
"which paddocks have water"*. The sharper case is 2b's own phone screen:
**standing in a field, the app must never tell you there is a buried electric
line under you when that line is a proposal.** That is the status column earning
its keep on day one rather than in some future report.

`removed` is the third value, on the reasoning that already makes `land_parcels`
`retired` and never deleted. **No dates on it** — a feature is not a dated
history the way occupancy is, and nobody has asked where the fence ran in 2019.
If that question arrives it is two nullable date columns, added cheaply.

### Plans: a named set of proposals, with a SAVED takeoff

**New in the 2026-08-28 conversation.** The founder asked for the materials list
to be savable, and saving it pulls in a grouping the brainstorm had deferred.

A plan is a **named set of planned features** — "north fence 2027", "waterline
via the lane". Features carry a nullable `plan_id`. It is one small table doing
three jobs at once:

  - it is what a saved takeoff attaches to (a fence project is several runs,
    some gates and a brace, not one line)
  - it answers the mutual-exclusivity problem the brainstorm flagged and had no
    answer for: two competing waterline routes are two plans, and only one gets
    built
  - it is what you mark built, by promoting its features

**NO STATUS COLUMN ON A PLAN.** Its features already carry status, so "is it
built" is derivable, and a second status is a second thing that can be wrong.

**The saved quantities are a SNAPSHOT, and the drawing is allowed to drift from
them.** Not a new rule: it is exactly what `land_parcels.area_acres` already
does, where the declared figure is deliberately not recomputed from the geometry
because *"they disagree for real reasons… the screens report the difference;
nothing corrects it."* Same treatment here. You ordered from 1,240 ft, the line
now measures 1,310 ft, the screen shows both. Recomputing on read would silently
rewrite what you bought from, which is the one thing a saved estimate exists to
prevent.

**Line items are rows rather than a jsonb blob, and a line may be hand-added.** A
materials list that can only hold what geometry produced is useless the first
time you need insulators and a bag of staples, so an item's source feature is
nullable: from the drawing, or typed in. Rows because the obvious next consumer
is a bill for those materials and this repo already matches bills — a blob would
have to be exploded the day anybody used it.

**A unit cost is what you typed, on that line, on that day. It is NEVER a
catalog.** The moment there is a price list there are vendors, quotes and
effective dates, and 2b has quietly become purchasing. Quantities are the
deliverable; a dollar figure is a convenience stored beside them.

### Buried electric and hot wires: two asks, one cheap and one not

*"All of that is important"*, so all of it is in — but the three parts are not
the same size.

  - *"The fence has the 3 strand hot"* is an **attribute** on the fence line.
    Free.
  - *"There is a buried electric line where you are at"* is a **feature** of its
    own kind. Free.
  - **"Why is this stretch dead"** is a CIRCUIT GRAPH, and it is the expensive
    one: feature-to-feature connections and traversal through junctions.

**The middle answer 2b should ship:** an energizer is a point feature, and a
fence run carries a nullable `fed_by` pointing at it. That answers "show me
everything on the north energizer" and "what feeds this run" with one column and
no traversal at all. Real tracing waits until somebody is standing in front of a
dead fence asking for it.

### Measurement: one function buys three things

`core/geo.ts` has area and containment and **no length**, and haversine distance
is the missing piece behind all three of the slice's real questions:

  1. **How long is this fence** — distance along a LineString
  2. **What do I need to build it** — that same length, divided by spacing
  3. **What is within 100 ft of me** — distance from a point to a LineString

**Write it first.** It is a small pure function, area already exists and must be
reused rather than re-derived on the client, and the rest of the slice waits on
it.

### "What is here": the mobile screen, and its boundary

*"It auto displays relevant information to whatever is at your location"* is the
strongest item on the list and it is almost entirely machinery that exists.
Which zone am I in is `pointInBoundary`, **shipped in 2a.2** as
`where-am-i.tsx`. What is near me is the length function above against a fixed
radius (100 ft, not a setting). What it shows is the attribute bag: three
strands hot, buried electric here, this trough is on the north line.

**It is a button, not a background service.** No tracking, no breadcrumb trail,
no location history. Battery and permissions both say on-demand, and nothing in
this pack needs to know where anybody was an hour ago.

### Where it meets `assets` — the seam is real, the column is not yet

*"A fence has geometry from one and a cost, life and maintenance schedule from
the other (fence is typically 7-year property)."* **`land` owns where it is,
`assets` owns what it cost.** Unchanged, and it now covers buildings too.

**But the FK stays out of the first migration** — changed from the brainstorm,
and confirmed with the founder ("I'd say we can link them later"). The status
column genuinely is free-now-painful-later, because status changes what every
read of the table MEANS. A nullable `asset_id` does not: it can be added at any
point without reinterpreting a single existing row, and `assets.ts` itself
refuses columns only a future routine would read. Drawing a barn creates a
feature, not an asset. Linking is a later, separate act.

### Answered: this is `land`'s site plan, not a neutral drawing surface

**The brainstorm left this open as the founder's call and it was settled
2026-08-28: build it in `land`.** The Documents construction layer — drawings
with markups and measurements — looks like the same tool and shares only its
toolbar:

| | Land site plan | Documents markup |
| --- | --- | --- |
| Coordinates | lat/long, WGS84 | points on a sheet |
| Length | haversine metres | pixels × a calibrated scale |
| Background | NAIP tiles by z/x/y | one raster page |
| Anchored to | a parcel, permanently | a document VERSION, superseded by rev C |
| "Correct" means | agrees with the ground | agrees with the sheet |

A surface serving both abstracts over the coordinate system, the unit, the
background loader and the versioning target, which is four branches wearing an
abstraction's clothes. **The pack has made this call before:** `land_occupancy`
lives here rather than in a neutral core for exactly this reason — the table
lives with the thing that reads it.

The reuse that may genuinely arrive is a Terra Draw toolbar component, and that
is a UI extraction to perform the day a second real consumer exists, from
working code rather than from a guess. `core/geo.ts` stays pure and is the only
deliberate seam.

### What to resist

*"A full suite"* is where this goes wrong, and the pack model already has the
answer: **modules stay empty slots until a paying client pulls them in.**

Each tool justifies itself by the QUESTION it answers:

  - **the as-built layer** — *what is actually on my ground* — pays immediately
  - **length** — *how many feet of fence is that*
  - **the takeoff** — *what do I need to buy to build it*
  - **"what is here"** — *what am I standing on*
  - **water points against zones** — *which paddocks have water*, and this one
    needs NO new math: `pointInBoundary` already ships

Out of 2b, each because nothing on that list needs it: snapping and ortho
constraints, layer groups and visibility management, an undo stack beyond what
Terra Draw gives free, title blocks and PDF export, a price catalog, a status on
a plan, individual posts, and circuit traversal.

**Standalone dimension annotations are out too, and cost nothing to defer** — a
fence's length renders on the fence, derived. A floating dimension between two
arbitrary points is a construction want rather than a farm one, and if it ever
arrives it is a feature of kind `dimension` with a two-point line. The model
absorbs it with no new concept, which is the test of whether deferring something
is safe.

Ship the questions, not the toolbox.

## Build log

### 2026-08-28 — What a quick review of 2b.0 found (`claude/the-plan-needs-a-key`)

Five things, all from the founder clicking through the slice the same evening it
merged. Four were gaps and one was a bug of mine. Migration `0235` — one nullable
column — applied to dev and production before the merge.

**A block of trees is not a long thin one.** `tree_line` drew a line and there
was no way to say "these forty acres are woods", which `pond` could already do
because it happens to be declared as an area. **`woods` is now its own kind**
rather than a tree line somebody drew as a polygon: the word reaches the legend
and, later, whatever asks how much ground is wooded. Same green as `tree_line`
on purpose — they are both vegetation, and different greens would imply a
distinction that is not there. The SHAPE is what tells them apart. `tree` was
added at the same time, for a single specimen worth pointing at.

**Worth knowing before adding more of these:** woods here is NOT the same thing
as a `woodlot` zone use. A zone is a management unit with an acreage that
rotation and per-acre reporting can see; a feature is a shape on a drawing.
Drawing woods does not make them a zone, and it should not.

**THE KIND'S SHAPE WAS ALWAYS A HINT, AND NOW THE SCREEN SAYS SO.**
`featureStyle` has taken a kind and a shape separately since 2b.0 precisely
because the two come apart — and the draw tool was the only thing that minded,
because it opened one mode with no way out. There is a three-button shape
picker beside the kind now, defaulting to the kind's own and cleared whenever
the kind changes. A barn you only know the rough position of is a point; a pond
traced as its outline is an area; the data model never had a problem with
either. A REDRAW does not read it: changing a fence line into a polygon halfway
through its life would strand every length ever reported from it.

**Line thickness, per feature.** *"Click on the electric line and make it much
thinner."* `line_width` is a nullable column with a CHECK, and **deliberately
not a key in `attributes`** — that bag holds what is TRUE of a thing, and the
takeoff will compute from it. A stroke weight is the one value that means
nothing on the ground, and it must never reach a materials list. Null means the
kind's own weight, so the relative weights the palette sets (a lane is heavier
than a fence on purpose) survive until somebody overrides one. In screen pixels
rather than feet: a width in feet is truer to a drawing and would also make a
waterline invisible at parcel zoom and forty pixels wide at gate zoom.

**A key.** `plan-legend.tsx`, and the rule that makes it useful is what it
LEAVES OUT: only the kinds actually on this parcel, never the whole vocabulary.
A key listing sixteen kinds when three are drawn is a catalogue, and a catalogue
is the thing you stop reading. The status rows appear only when there is more
than one status present — on a plan of nothing but built fences, "Built" is not
news. The swatches are inline SVG driven by the SAME `featureStyle` and
`STATUS_STYLES` the map uses, because a legend drawn from a second copy of the
palette is a legend that goes quietly wrong. One conversion is needed and is
easy to miss: MapLibre expresses a dash in line-widths and SVG in user units.

**And the bug: the cursor was a grab hand while drawing.** *"It shows the hand
tool when drawing which makes it hard to pinpoint the right spot."* It was
`site-plan-map.tsx`'s own hover handler — the one that shows a pointer over a
clickable feature — running on every mouse move and resetting the canvas cursor
to the default, which MapLibre paints as `grab`. Terra Draw never stood a
chance. The handler now returns early while drawing, the click handler does too
(selecting something underneath would swap the panel out mid-trace), and the
canvas gets an explicit `crosshair` for the duration. **Both handlers read the
mode from a ref, not from state**, because they are registered once when the map
is created and would otherwise close over whatever `mode` was then — always
`"view"`.

**Driven again on Hilltop Farm**: woods traced over the wooded block as an area
(2,128 ft of perimeter, which is the right answer for an area), the buried
electric dropped to Hairline and visibly thinner on the map, the key showing
four kinds and both statuses, and `canvas.style.cursor` read back as
`crosshair` mid-draw and empty again after cancel.

### 2026-08-28 — Slice 2b.0: the site plan is one map with the aerial off (`claude/the-site-plan-design`)

**`land_features`** — points, lines and areas on the ground, in one table, with
`planned` / `built` / `removed` on every row. Migration `0233` (table) + `0234`
(RLS), applied to dev AND production before the merge.

**What shipped**

- **`core/geo.ts` grew a length function**, which is what the design said to
  write first and it was right: fence lengths, the future takeoff and the future
  "what is within 100 ft of me" are all `haversineM`. `FeatureGeometry` is a
  wider type than `Boundary` with its **own validator** — two functions rather
  than one with a flag, because a shared validator would put the decision at
  every call site, and getting it wrong there means a parcel whose "boundary" is
  a single point and whose acreage is therefore silently zero.
- **`core/length.ts`**, the sibling of `area.ts`, with one difference worth
  knowing: **length has no canonical store.** Nothing writes a length, so there
  is no `toMetres` matching `toAcres` — it is derived from the geometry every
  time it is shown, and rounded to the whole unit because a line traced off
  aerial imagery cannot support more.
- **`core/features.ts`** — kinds, symbology, status styles. Industry-neutral
  per ADR 0004: no `trough`, no `energizer`, both of which the founder wants and
  both of which arrive through `packConfig.land.featureKinds`. An unknown kind
  draws with the fallback for its shape and is never refused.
- **The map**, `site-plan-map.tsx`, separate from `boundary-map.tsx` because
  that one edits a single polygon and this one renders many features in two
  states. Aerial/plan toggle, Terra Draw in point/line/polygon modes, live
  measurement while drawing, click to select, promote in one act.

**Three things that were only found by driving it**

- **The cold start put the map on the arctic.** `boundary-map.tsx` passes
  `bounds: CONTINENTAL_US` to the constructor and this one did not, so a parcel
  with no boundary opened at zoom 0 over the null island. That reads as a broken
  map rather than an empty one, and it is the same lesson 2a.1 wrote up. The
  error handler was missing for the same reason and is now there — **MapLibre
  errors are events, not exceptions.**
- **The measurement said "Placed. Save it" in the middle of tracing a fence.**
  Terra Draw's snapshot holds a `Point` for every vertex placed, so taking the
  newest feature from it gets a vertex rather than the line.
  `boundary-map.tsx` filters by geometry type and polygons never showed it.
  `lastDrawn()` now filters, and the shape is held in state rather than
  recomputed at save time — a redraw takes its shape from the geometry ALREADY
  STORED, and the kind picker is free to say something else.
- **The palette had the halo on the wrong side.** Near-white lines over a dark
  casing read beautifully on the photograph and almost vanished on the plan,
  where a white line sits on white paper. Found by clicking the toggle. It is
  mid-tone ink with a **light** halo now: on the photo the halo separates the
  line from a busy background, on paper it is invisible and the line carries
  itself.

**And one that matters more than the other three.** For a kind that is ALREADY
dashed — every buried service is — `planned` at 0.75 opacity with a `[2,2]`
dash was nearly indistinguishable from `built`. That is the exact confusion the
status column exists to prevent, in the one place it matters most: somebody
standing over a line deciding whether it is safe to dig. Colour carries the kind,
so opacity is the only lever left, and it has to be wide enough to survive a
dashed kind — **half strength, fine dots**. `tests/land-features.test.ts` locks
the gap at 0.4 minimum so a future palette edit cannot quietly close it.

**Decisions worth knowing**

- **A fence is ONE row with a post spacing.** The founder asked for individual
  posts, was asked what question a post row would answer, and said he does not
  need them. The rule: a thing earns a row when somebody would say its name out
  loud, or when another record points at it.
- **Features hang off a PARCEL, never a zone.** A fence runs *between* paddocks
  and a lane runs *through* them, so a `zone_id` would force a choice that is
  wrong for the commonest features on any farm. Which zones a feature touches is
  a spatial question with a spatial answer.
- **Member-write, not owner-write**, and it is a deliberate difference from
  parcels and zones. Those are owner-only because `upsertDimensionMember` calls
  `requireOwnerRole`; a feature syncs no dimension, so the forcing reason is
  absent. Drawing the fence you just built is a chore, and the person who knows
  where the waterline went is not the owner.
- **The `assets` FK is NOT in this migration**, changed from the brainstorm and
  confirmed with the founder. Status is free-now-painful-later because it
  changes what every read MEANS; a nullable `asset_id` does not.
- **`attributes` and `metadata` are two bags with two owners** — the pack's and
  extensions'. New pattern in this repo, documented on the column, because one
  shared bag would make a stray key indistinguishable from a field the pack
  computes from.
- **Labels are HTML markers, not a symbol layer**, which closes the question
  2a.1 left open. A `text-field` needs a `glyphs` endpoint — another external
  host to depend on and agree terms with. A marker needs none of that and
  inherits the app's own typography.
- **`line-dasharray` is not data-driven in MapLibre.** Colour, width and opacity
  read per feature with `["get", …]`; a dash cannot, so every distinct pattern
  gets its own layer, built from the patterns actually present.
- **drizzle-kit emits a self-referential FK before the unique index it needs**,
  and Postgres rejects that. `0233` is hand-reordered and says so at the top. The
  isolation suite certifies the constraint precisely because a future generated
  migration could quietly lose it.

**Driven on the dev branch's Hilltop Farm**, which now has a traced boundary and
three features on it: a built fence, a built buried-electric run and a proposed
fence. Drawn, measured, saved, selected, renamed, given a `wire_count`, and
promoted from proposal to fact — the length on screen while drawing matched the
length stored, because it is the same function.

**Open after this slice:** nothing reads `attributes` yet (2b.1 does), `fed_by`
has a column and a picker but no screen that traces a circuit, and 2b.2's phone
screen is unbuilt — so `haversineM` currently has one consumer of the three it
was written for.

### 2026-08-26 — The land page was down, and it was a function prop (`claude/a-function-cannot-cross-the-boundary`)

**`/dashboard/m/land` WAS 500ING ON PRODUCTION**, reported by the founder with
the error page's reference on it. Not the UI sweep that landed hours earlier —
that PR's diff on this file is an icon, an import and a `DataTable` wrapper,
and none of it touches the failing line.

**`LandModule` IS A SERVER COMPONENT AND WAS PASSING A CLIENT ONE A FUNCTION.**

```tsx
<WhereAmIShortcut zoneHref={(zoneId) => `${BASE}/zones/${zoneId}`} />
```

React cannot serialise a function across that boundary, so the render threw
*"Functions cannot be passed directly to Client Components"* and took the route
with it. `WhereAmIShortcut` now takes `basePath: string` and builds the URL
itself — the caller still owns the URL, it just hands over the prefix rather
than the builder.

**IT WAS INVISIBLE BECAUSE IT IS GATED ON `mapped > 0`.** The button only
renders once some zone has a boundary, so every farm without one — including
the local dev tenant, which is why the whole four-PR sweep drove this page
clean — rendered it perfectly. It broke the moment the first boundary was
traced and stayed broken.

**Reproduced before fixing and re-broken after**, by forcing `hasGeometry` true
locally: same error, same shape, `digest 3142074346`. The production data was
ruled out first — a read-only probe ran all three of this page's queries against
every production tenant and every one succeeded, including the farm with six
parcels and a mapped zone. The failure was never in the data.

`tests/server-client-boundary.test.ts` now fails on this class. See
[conventions.md §9](../conventions.md).

### 2026-08-26 — The pack puts on the design system (`claude/the-last-three-packs`)

No behaviour changed. PR 4 of the five that bring the packs onto the primitive
layer, and the last of them — see [design-system.md](design-system.md) for the
sweep as a whole.

**THIS PACK GETS NO `CategoryStrip`, AND THAT IS THE FINDING RATHER THAN AN
OMISSION.** The first three packs each had a header stuffed with four or five
outline buttons that were really destinations. This one has exactly one section — `/find` — and it is conditional on a
parcel source covering the tenant, so the strip would have had one tab on most
farms and two on some. The strip exists to
show a module's SECTIONS, and a strip with one tab is chrome that teaches
people the control is useless. So the hand-rolled back-links on the record
pages **stay**: with no sections there is nothing to replace them with, and a
record-to-list link is the only navigation those pages have.

Accent chip on every `PageHeader`, `Card` to `Panel`, tables into `DataTable`,
section headings to the house 20px, and dashed-border paragraphs to real
`EmptyState`s.

**A BARE `Map` IMPORT FROM lucide SHADOWS THE GLOBAL `Map` CONSTRUCTOR** for
the whole module, and `LandModule.tsx` had one. Nothing in that file builds a
lookup today, which is exactly why it was worth aliasing to `MapIcon` now
rather than after somebody adds one and gets a baffling error. The same trap is
recorded in `icon-registry.ts`, which aliases for the same reason.

**Not driven: `/land/[id]` and its zone page.** Hilltop Farm has no parcels —
the hub renders "No ground recorded yet" — and `retireParcel` is a soft retire
with no hard delete, so creating one to look at a layout would leave permanent
fixture data. Same call this sweep made about `/inventory/counts/[id]`. The
conversions there are the same shapes verified on retail and assets, and `tsc`,
`eslint` and the build are green, but nobody has looked at those two screens.

### 2026-08-20 — `deleteOccupancy` turned out to be a precedent (`claude/a-weighing-can-be-wrong`)

No code change here. Recorded because `livestock`'s weights copied this pack's
call and its reasoning verbatim: *remove a stay entered by mistake — correcting a
record is not rewriting history.*

The distinction is worth having written down once, because both packs will keep
meeting it. An EVENT is corrected by a compensating entry — the feed really did
leave the barn, and unwriting it would rewrite what happened. An OBSERVATION or
an intention is corrected in place — a stay somebody keyed against the wrong
paddock, or a weighing typed as 625 instead of 62.5, never happened at all, and
there is no compensating row that would mean anything.

`inventory_movements` is the first kind. `land_occupancy` and
`livestock_weights` are the second.

### 2026-08-20 — A haul is a parcel crossing, and this pack is the one that knows (`claude/weights-carry-a-method`)

`lastHauledOn` — when each occupant last moved to a zone on a DIFFERENT parcel.
Added for `livestock`'s weights, and here because the record is this pack's.

**Shrink will lie to weight data**: cattle drop 3–5% on a trailer and take days
to put it back, so a weighing taken just after a move must not read as a loss.
The obvious version of that guard — "when did they last move" — would fire every
morning on a rotational farm and be ignored inside a week. This design's own
sentence settles it instead: *a move between adjacent paddocks is a walk — daily,
free. A move between parcels is a haul.*

**Nothing new is stored.** The walk-versus-haul distinction was designed as a
movement kind on a future movement event, and it turns out the existing rows
already carry it: the parcel of the zone they left and the parcel of the zone
they arrived on. The op walks each occupant's stays in order and remembers the
last time the ground underneath them changed parcel. A first stay is an arrival
rather than a haul — nobody hauled them from nowhere.

### 2026-08-19 — Two deeds, one block of ground (`claude/two-deeds-one-block`)

Founder, after importing five parcels from the county: *"I would like the
ability to select multiple properties and combine them. Yes they are 2 different
parcels, but I would like them combined."* Two adjacent 4.12-acre deeds on Paige
Rd, farmed as one.

**The constraint that forces this is not tidiness.** A zone belongs to exactly
one parcel — composite FK — so a fence line crossing a deed boundary is a
paddock this app cannot draw at all. Combining is what makes the operational
unit representable, and both legal units stay in the record.

- **It ABSORBS into a survivor rather than creating a new parcel.** The survivor
  keeps its id, its `dimension_member`, its zones and every journal line ever
  tagged to it. Creating a third parcel and retiring both originals would be
  easier to write and would strand the reporting history of both.
- **The absorbed parcels are RETIRED, never deleted** — the pack's standing
  rule. Ground that carried cost for six years does not stop having done so
  because two deeds are now worked together.
- **PADDOCKS MOVE FIRST, and that is the sharpest trap in the operation.**
  `retireParcel` retires a parcel's zones, so a paddock left behind would be
  silently lost ground. Certified.
- **The geometry becomes a MultiPolygon and the shared edge is NOT dissolved.**
  A true union needs a polygon-clipping library and buys one cosmetic thing: no
  seam where the deeds meet. It is also WRONG for the ordinary case — this
  farm's parcels sit across four roads, and non-adjacent ground has no union to
  take. A MultiPolygon is exact either way: `boundaryAreaSqM` sums the parts and
  `pointInBoundary` tests each.
- **Both parcel numbers are kept**, joined with `+`. The county still bills
  these separately and always will; losing the numbers would make the combined
  parcel impossible to reconcile against the record it came from.
- **An unmeasured part poisons the total**, per `totalArea`'s rule. Storing 4.12
  for a parcel whose other half has never been measured would put a confidently
  wrong divisor into every per-acre figure — null is the honest answer, and the
  measured boundary still reports on the page.
- The dialog states all three invisible effects before they happen: what moves,
  what is retired, and that retirement is currently one-way.
- 6 new ops tests.

### 2026-08-19 — A search that finds four of your five parcels is not broken, it is old (`claude/how-old-is-this-record`)

The founder searched his tax mailing address and got four parcels back. The
fifth — 19 acres on Paige Rd, on his screen in the auditor's own record — did
not appear.

**It is not in Ohio's data at all.** The statewide layer holds only its parent,
`4900583000`, at 50.27 acres, still carrying the PREVIOUS owner's mailing
address in Amelia. His `49-00583.001` is a split off that parent, and the `.001`
suffix is exactly how a Knox split is numbered. It happened after the state's
snapshot.

**And the snapshot is a single day.** Asked for the oldest and newest record
dates across the county: 41,757 Knox parcels, `oldest: 2023-05-16`,
`newest: 2023-05-16`. Ohio aggregates from 88 counties on its own cadence and
Knox's last contribution was that day. Franklin is 2023-09-26; Wayne is
2023-07-28. **Every county is its own snapshot with its own age.**

- **The finder now says so**, on the results and — more importantly — on the
  empty state, because the moment somebody most needs to know the data is three
  years old is when their parcel is not in it.
- **The date is READ, never written down.** `CurrentTo` is queried per county on
  every search, so the message moves the moment Ohio refreshes Knox and nothing
  here needs changing. A hardcoded date would itself go stale and then lie about
  staleness.
- **Asked as a separate request from the search**, deliberately: a search that
  returns nothing has no rows to read a date off, and that is precisely the case
  the line exists for. Cached for a day.
- **It returns null rather than throwing.** A footnote must never be the reason
  a page fails, nor show the word "null" in a sentence about how current
  somebody's records are.
- The message also says what to do: search the parent parcel number and adjust
  the boundary, or trace it on the map.

**The general lesson, and it outlives this pack:** when a feature reads somebody
else's data, its age is part of the answer. Without the date, stale source data
is indistinguishable from a broken search — and the person debugs the wrong
thing, which is exactly what happened here.

### 2026-08-19 — Slice 2a.2: the field answers the question (`claude/which-paddock-am-i-in`)

The read the whole geometry stack was ranked around. The Land design put
point-in-polygon **above the map itself**: every other data-entry saving in this
pack is a better form, and this one is the ground telling the app where you are.

- **"Use where I am" on the livestock move dialog.** Standing in a paddock,
  the picker fills itself in rather than making somebody scroll twenty names —
  two hundred at 10x. It fills the field and never submits: GPS is good to a few
  metres, a hand-traced boundary to a few more, and a fence line is exactly
  where those errors meet.
- **"Which paddock am I in?" on the Land page**, which navigates. The useful
  thing on a phone is not a form to fill in but arriving at the right record
  without reading a list.
- **The button only appears once something is mapped** (`mappedZoneCount`).
  Offering it against a farm with no boundaries would answer "not inside any
  paddock" every single time.
- **Off the mapped ground it says so, and never guesses the nearest.** A
  nearest-match would quietly put animals on the wrong paddock, and the rest
  clock is computed from that record.

**THE OP ALREADY EXISTED AND I WROTE IT AGAIN.** `zoneAtPoint` shipped in 2a.0 —
deliberately, with a comment saying the screens that would call it were 2a.2 —
and this slice began by adding a near-identical `zonesAtPoint` beside it. Caught
by its own test file failing to look wrong. The duplicate is gone and the
original survives, including the better decision it already carried: **the
SMALLEST containing zone wins**, because a strip inside a paddock is the more
specific answer and is what somebody standing on it means. Now certified, along
with a point off the mapped ground and a zone with no boundary at all.

The lesson is cheap to state and was not free: **when a slice says a read is
"for later", later has to search for it.** Three tests now cover behaviour that
had one.

### 2026-08-19 — The finder worked and nothing linked to it (`claude/find-parcels-needs-a-door`)

2a.1b driven on production against real Knox County records, and it did the
whole job: a mailing-address search returned **nine parcels across four roads**,
ticking one showed *"1 chosen, 41.02 acres"*, and importing it produced a parcel
whose boundary is the county's own survey drawn over aerial imagery — an
irregular shape with a notch in the south end, following the actual field edges.
The page then read:

> Measured **41.0189 acres** · Recorded 41.02 acres · *Close enough to the
> recorded figure. Both are kept as they are.*

**Three one-thousandths of a percent from the assessor's figure**, on ground
this codebase had never seen.

**The defect was that nobody could get there.** The "Find my parcels" button was
gated on a PINNED `packConfig` source, while the page itself falls back to
letting the person choose one — so on a tenant with no config, which is every
tenant today, the feature worked perfectly and had no door. The only way in was
typing the URL. The button now uses the same condition the page does.

**A pattern worth naming, because this is the second time in two days:** a
capability and its entry point drifted apart — the livestock daily round shipped
with `attention` meaning one thing in the ops layer and another on the badge, and
here a page and its button disagreed about when the feature exists. Both were
invisible to types and tests, and both took thirty seconds to find by clicking.

### 2026-08-19 — Slice 2a.1b: the county already drew it (`claude/find-my-parcels`)

Three slices in, the founder's original ask finally gets answered: *"type in the
parcel number and it auto traces the property."* 2a.0 asked him to paste GeoJSON
he had no way to make and 2a.1 asked him to trace by hand — both still put the
work on the farmer. **The county did the survey. Ask the county.**

**Ohio publishes every county's parcels as one statewide service**, free, public
and keyless, so this covers Knox County and the other 87 without per-county
work. Verified against real Knox data before a line of UI was written: 40 of 40
parcels parsed by `core/geo.ts`, centroids landing where they should.

**Two searches, because two questions.** By parcel number when you are holding
the tax bill; by TAX MAILING ADDRESS when you want the whole farm at once. Ohio
carries no owner name — only where the bill goes — and for this purpose that is
better than a name, because it is how the county groups a holding. One address
in Knox County returns **nine parcels across four roads and 462 acres**.

**The best evidence this slice produced was accidental.** Running that search
through our own code puts the county's acreage next to ours, parcel by parcel:

| County | Measured here |
| ---: | ---: |
| 25.05 | 24.6670 |
| 67.99 | 67.3777 |
| 126.52 | 125.4095 |
| 107.78 | 107.0568 |
| 63.08 | 64.0969 |
| 41.02 | 41.0189 |

Nine parcels, every one inside about 1%. The spherical area formula from 2a.0
had only ever been checked against polygons this codebase invented; it now
agrees with a county assessor's independent figures on real ground. **That is
the strongest verification the geometry has had.**

- **The county's acreage becomes the DECLARED figure**, never the truth. It
  lands in `area_acres` and the boundary is measured separately, so the
  comparison built in 2a.0 works from the first second on imported ground.
- **Nothing is pre-ticked.** Mailing address groups by where the bill goes, so a
  trust, an LLC or a farm manager's address pulls in ground that is not yours.
  Every row is a proposal; the person chooses. Same discipline as the rest of
  the pack.
- **The number on the bill is not the number in the database.** Ohio stores
  `2900403000`; auditors print `29-004-03-000`. Both sides normalise, or a
  farmer typing his own parcel number correctly finds nothing at all.
- **A county's `0` acres means "never measured", not "no land".** Stored as
  null, because a zero would land in every per-acre divisor downstream.
- **`O'Brien Rd` is an ordinary Ohio address**, so the where-clause escaping is
  a correctness fix before it is a security one.
- **The source registry is CLOSED, and that is the SSRF defence.** The obvious
  next feature — paste your own county's service URL — is a server-side fetch of
  an attacker-chosen address. A fixed list means the question never arises: a
  caller chooses BETWEEN sources by id and can never introduce one.
- **ArcGIS reports failure with HTTP 200.** A bad field name comes back as
  `{error:{message}}` with an OK status, so trusting the status alone would turn
  every query mistake into "no parcels found" and send somebody looking for
  their farm in the wrong county.
- **The source is picked in the UI rather than configured**, because
  `packConfig` still has no editing surface — the same gap `assets` records for
  its depreciation accounts. A pinned config value wins when one exists.
- 23 pure tests.

### 2026-08-19 — Tracing works; "Move the corners" had no corners (`claude/corners-need-selecting`)

The map finally drove end to end, and the two halves came out differently.

**Tracing and saving are verified on production.** Clicking four corners on
Creek Paddock drew the shape live, the readout ran alongside it — *"4.6502 acres
· −3.5998 acres against the 8.25 acres recorded"* — and Save stored exactly the
figure the screen had been showing: the header changed to *"measures 4.6502
acres"*, the badge to *"4.6502 acres traced"*, the comparison to *"44% apart"*,
and the declared 8.25 acres in the page header did not move. Client and server
run the same `boundaryAreaAcres`, and this is what that buys.

**"Move the corners" entered a mode with nothing to grab.** Terra Draw's select
mode only means *clicking a shape would select it*; the draggable vertices
belong to a SELECTED feature. So the button loaded the boundary, switched the
toolbar, and left a map that looked identical — with no hint that you were
supposed to click your own paddock first.

- `selectFeature(id, "select")` after seeding, so the corners are there the
  moment the mode opens.
- The banner now speaks for the edit path too: *"Drag a corner to move it, or a
  midpoint to add one."* It previously only knew how to explain a fresh trace.

**A note on how this was found, because it nearly was not.** Clicking the button
by screen coordinate did nothing and produced no error, which read like a dead
handler; clicking the same button by element worked immediately. The coordinate
mapping was the lie, not the code. When a control appears inert in a driven
browser, click it by element before believing it.

### 2026-08-19 — The map drew the ground and none of the boundaries (`claude/map-worker-loses-its-import`)

Reported by the founder, tracing on the live map: *"it would mark where I
clicked and there was no visible outline of the boundary."* The saved boundaries
were not drawn either. The imagery, the zoom control, the attribution, the fit
and the acreage badge were all correct — **only vector rendering was dead, and
nothing anywhere said so.**

**The cause is a bundler seam, not a map bug.** MapLibre v6 ships a module
worker that does `import ... from "./maplibre-gl-shared.mjs"`. Next copies
`maplibre-gl-worker.mjs` into `/_next/static/media/` under a content-hashed
name, but does **not** emit the sibling chunk and does **not** rewrite the
specifier — so the worker's own import 404s, returns the app's HTML shell, and
the browser refuses it: *"non-JavaScript MIME type of text/html"*. That message
had been in the console since the map first shipped and reads like noise.

The worker then never starts. Raster tiles are decoded on the main thread so the
map looks alive, while **every GeoJSON source silently never parses**. Measured
on production before the fix: `isStyleLoaded()` false forever, both sources
`isSourceLoaded()` false, `queryRenderedFeatures` returning 0 — and a plain red
square added from the console never rendered either, which is what ruled out our
data and our styling.

- **`public/maplibre/` now serves the worker and its chunk**, with
  `setWorkerUrl` pointing at it, so the relative import resolves against a path
  we control. Copied by `scripts/copy-map-worker.ts` on `prebuild`/`predev` and
  gitignored — a committed copy would drift from `maplibre-gl` on the next bump
  and reproduce this exact bug wearing a different hat.
- **`mjs` added to the proxy matcher.** `js(?!on)` does not match a `.mjs`
  suffix, so both files were taking the middleware path for no reason.
- Verified at the point of failure rather than by redeploying and hoping: the
  worker returns 200 as JavaScript, its `./maplibre-gl-shared.mjs` resolves to
  200 where it used to 404, and the module worker constructs with no error.

**The lesson worth keeping: a raster map that renders is not evidence the map
works.** Imagery and vectors travel different paths, and only one of them needs
the worker.

### 2026-08-19 — A white square with a working zoom control (`claude/map-needs-no-glyphs`)

The map shipped and rendered nothing. Driven in the browser the moment it
deployed, and the failure was worth the trip twice over.

**The bug: a symbol layer in a style with no `glyphs`.** The context shapes
carried a `text-field` so paddocks would be named on the map, and a MapLibre
style cannot render text without a glyphs endpoint. `addLayer` threw inside the
`load` handler — before `fitBounds` and before `setReady(true)` — so the result
was a map at zoom 4 over the whole continental US, no boundary drawn, and a
toolbar permanently disabled. **Nothing said so anywhere**: MapLibre reports
through an `error` EVENT rather than an exception that reaches the console, and
nothing was listening.

- **The labels are gone, and that is a dependency decision rather than a
  cosmetic one.** Glyphs mean a font service: another external host, another
  thing to be down, another set of terms. Neighbours are dashed and the shape
  being edited is solid green, which distinguishes them. Names return with 2b,
  where a glyph source can be chosen deliberately.
- **`map.on("error")` is wired now.** The first failure of this component was
  invisible, and that must not be how the second one is found.
- **`fitBounds` runs BEFORE the layers.** A failure adding one used to leave the
  view over the whole country, which reads as "the imagery is broken" rather
  than "a layer threw" — the diagnosis cost more than the fix.

**Everything around the bug was fine, which is why it took evidence rather than
a guess to find:** the tile service answered (24 requests, 200s, `image/jpeg`),
CORS was fine, MapLibre itself constructed, and the attribution and zoom control
rendered. The canvas was blank because the render never got past the throw.

### 2026-08-19 — Slice 2a.1: trace it on the picture (`claude/land-map`)

The founder drove 2a.0 and gave the verdict the slice deserved: *"I don't
understand pasting the json coordinates. That seems complicated. I was expecting
to have a map pull up and be able to trace the parcels."* He was right. Nothing
UNDER the paste box was wrong — the storage, the spherical acreage, the
containment test and the comparison all survive untouched, and the map feeds the
same two ops — but asking a farmer to produce a GeoJSON file he has no way to
make is a developer's idea of an entry path.

- **The map is the front door now; pasting is the side one.** The paste dialog
  stays, because a county GIS export is more accurate than anything traced by
  hand, but it is a second button rather than the only one.
- **The basemap is USDA/USGS orthoimagery, and that is a LICENSING decision
  rather than a technical one.** Esri's World Imagery is the obvious
  alternative and serves better-looking tiles, but its terms are a licence a
  commercial multi-tenant product would have to hold. The USGS service carries
  NAIP, is public domain, and costs every future tenant nothing but attribution.
  Verified live before shipping: it answers, serves 256px JPEG tiles, and
  declares zoom 0–23. `USGSNAIPPlus` and the USDA APFO ImageServer were both
  unreachable when checked, which is exactly why the URL is config-overridable
  rather than a constant.
- **`basemapFrom` takes both the URL and the attribution or neither.** Imagery
  with no credit is the one combination that is never acceptable, so a
  half-filled config falls back whole. A URL without `{z}` is refused too —
  MapLibre would request one image for every tile and the map would look broken
  in a way nobody would think to blame on config.
- **The acreage moves as you trace**, through the same `boundaryAreaAcres` the
  server runs. Not a preview of a guess: the number on screen while drawing is
  the number that gets stored.
- **A zone is drawn with its parcel and its sibling paddocks on the map.**
  Ground is subdivided in relation to what is already there, and tracing a
  paddock against a blank aerial is how you end up with paddocks that overlap.
- **Self-intersecting polygons are refused while being drawn**
  (`ValidateNotSelfIntersecting`). A figure-of-eight paddock has no area the
  formula can trust, and refusing it at the pointer is kinder than storing a
  shape whose acreage is quietly nonsense.
- **Terra Draw, not mapbox-gl-draw**: the latter is unmaintained and painful
  with MapLibre. Wired directly to `terra-draw` + its MapLibre adapter rather
  than through the `@watergis` control, because this slice needs three buttons
  in this product's voice, not a thirteen-mode toolbar.
- **MapLibre and Terra Draw load through `await import()` inside an effect.**
  Both touch `window` on construction, so a static import would break the server
  render of every page carrying a map.
- **Cold start is worse for a map than for a form**: a form with no data is
  empty, a map with no data is a picture of the wrong place. It opens on the
  continental US with a "find my location" button, which is the one-tap fix for
  somebody standing on the ground in question.
- 6 pure tests for the basemap config. The map itself is not unit-tested — it is
  a canvas and an external tile service, and the parts worth certifying (parse,
  area, containment) were certified in 2a.0 and are unchanged.

### 2026-08-19 — The box that would not show you what was in it (`claude/boundary-box-shows-what-is-there`)

2a.0 driven on production, on Home Farm and Creek Paddock. **The arithmetic is
right on real data**: a 120-acre boundary pasted against a 120-acre declared
figure previewed at 119.995 acres — 0.004% out, which is the coordinate rounding
and nothing else — and a deliberately small 6.4-acre boundary on the 8.25-acre
Creek Paddock produced *"Measured 6.4001 acres · Recorded 8.25 acres · 22%
apart"*, with the declared figure untouched in the header above it. Both refusal
paths behaved: a LineString was refused **by name**, a three-feature file was
refused by **count** (*"That file has 3 shapes in it"*), and Save stayed disabled
for both.

**What was wrong was the second visit.** "Replace boundary" opened an empty box.
The stored shape was therefore invisible and unrecoverable — there is no other
way to get a boundary out of the app, and until the map ships there is no way to
*see* one at all. It is the same defect shape as `livestock`'s exception dialog
opening blank on a lot already checked, found the same way, one day apart: **a
button that says Edit or Replace must show what it is editing.**

- The box now opens with the stored boundary in it, printed whole rather than
  truncated — two decimal places short of the stored precision would be a lie.
- After a save it holds what was saved; after a remove it is empty, because
  there is nothing stored to show.
- **The comparison line had no unit.** *"a difference of −0.01"* is a number
  with nothing attached to it, on a screen whose entire subject is acres against
  acres. It goes through `formatArea` now, like every other area in the pack.

### 2026-08-19 — Slice 2a.0: shapes and arithmetic, no map (`claude/land-geometry`)

The first half of the geometry slice, and deliberately the half with no picture
in it. `geometry jsonb` on parcels and zones, the math in
`src/packs/land/core/geo.ts`, and a paste box to get a boundary in.

- **GeoJSON in jsonb, math in JS, no PostGIS** — the design settled this and
  building it confirmed the sizing: containment is ray casting and area is
  spherical excess, both trivial at a few hundred polygons, and 10× this farm is
  still a few hundred. PostGIS would have bought indexes nothing here needs and
  cost an extension every environment has to carry.
- **The area formula is SPHERICAL, and that is not fussiness.** A planar formula
  over degrees is wrong by the cosine of the latitude — about 23% at 40°N, over
  two acres on a ten-acre paddock — which is the difference between a computed
  acreage that corrects the county's figure and one that quietly libels it.
  Certified against an independently derived number, and against the property a
  planar formula could not have: the same box measures smaller at 60°N than at
  20°N.
- **Winding order is ignored.** GeoJSON asks for counter-clockwise outer rings
  and plenty of real files disagree; trusting it would make a valid boundary
  measure negative, and a negative paddock is not a state anything here can
  report on.
- **`area_acres` IS NOT RECOMPUTED, and never will be.** The declared figure
  comes from a deed or a county record and is what rent and tax are based on;
  the boundary is what the fence encloses. They disagree for real reasons — an
  easement, a creek, a deed written loosely — so the screens report the
  difference and nothing corrects it. Same rule as `zoneCoverage`, which reports
  undivided ground rather than refusing it.
- **The entry path is a paste box, not the map**, and it is not a placeholder: a
  county GIS export is more accurate than anything traced by hand, so this stays
  the best route even after 2a.1. It accepts a Feature and a one-shape
  FeatureCollection because that is what every real source emits, refuses a
  multi-shape file by saying **how many** shapes are in it, names the type when
  handed a LineString (troughs and fences are real, and they are 2b), and drops
  the altitude a GPS export carries.
- **The same parser and the same area formula run in the paste box**, as you
  type. `core/geo.ts` is pure precisely so both sides can run it — the acreage
  the dialog previews is the acreage that gets stored, not a client-side guess
  at it.
- **`zoneAtPoint` is here with no screen calling it yet**, which is a deliberate
  exception to this repo's usual rule. It is the read the column exists for —
  the 10× data-entry win — and shipping the shapes without it would be storing
  geometry for a map to look pretty with. It returns the SMALLEST containing
  zone, because zones legitimately overlap and the most specific answer is what
  somebody standing on the ground means.
- **Ray casting is half-open**, so a point on a fence line between two paddocks
  lands in exactly one of them. Both answering "yes" would make the pre-fill
  ambiguous exactly where people walk.
- **Nothing validates that a zone's boundary sits inside its parcel's.** Same
  decision as area: this pack reports, it does not enforce.
- Migration `0158` is two nullable columns. Applied to **both** databases and
  verified with `scripts/verify-rls.ts` before the PR was opened — RLS is
  unchanged, since these are columns on tables that already carry it.
- 25 pure tests, 8 ops tests.

### 2026-08-16 — "Where is it" needed a date too (`claude/current-needs-today`)

The loose end of the entry below, found by driving it an hour later. `zoneRest`
and `completedStayDays` learned to clip to `today`; `currentZoneForOccupants`
and `occupantsInStructures` read the same table and did not.

Both matched on *"the stay with no end date"*. After a move dated ahead, that is
the wrong row twice over: the stay they are actually on has been closed on a
date that has not arrived, and the one with no end has not started. So the
Livestock page said the herd was on Creek Paddock while Land said Creek Paddock
was resting — **two pages, the same rows, different answers.**

- Both now take `today` and match the stay that COVERS it:
  `started_on <= today AND (ended_on IS NULL OR ended_on >= today)`.
- Overlapping stays are legitimate, so when two cover today the **most recent
  arrival** wins.
- **Three reads have now needed `today`.** That is the pattern: anything in this
  pack answering "currently" is a question about a date, and the date has to be
  passed in rather than assumed. Written into Decisions & gotchas.

### 2026-08-16 — Rest is what happened, not what is planned (`claude/rest-not-yet`)

Found by driving the one-act move. Recording an arrival with a forward `On`
date read the destination as **occupied** from the moment it was typed, stopping
its rest clock days early on ground nothing was standing on. Rest is the number
this pack exists to produce, and nothing on the page looked wrong.

- **`zoneRest` clips every span to `today`.** A stay that has not begun
  contributes nothing — not a day, not a count. A stay that has begun
  contributes only the part that has elapsed.
- **A booked departure is still OCCUPIED.** `endedOn` in the future means they
  are standing there now. This is the half that was wrong *with a test asserting
  it*: the old code clamped a negative rest to `0`, and the old test checked for
  the `0`. Clamping hid the question instead of answering it. **Second time this
  month a test has locked in a mistake** — the other was the occupancy guard.
- **A paddock whose only stay is in the future is `never_grazed`**, not
  "occupied" and not "rested forever". Nothing has been on it.
- **`completedStayDays` takes `today`** and drops stays that have not finished.
  A planned departure is not a measurement, and the rotation formula would
  otherwise report a graze length the farm has never done.
- The zone page follows: "Move off" and the *Currently* card need an open stay
  that has **begun**, and a future arrival's row reads **not yet** rather than
  *still on it*. Without that the headline card and the table underneath it
  would contradict each other on the same screen.
- Nothing is stored to make this work. The same two rows answer differently on
  the 15th and the 20th, which is the pack's rule about derived numbers holding.

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
| `land_parcels` | One row per deed or lease. **`geometry` jsonb since 2a.0**, nullable, unvalidated by the database — every reader goes through `asBoundary` | `tenant_id`, FORCE RLS (`land_parcels_superadmin_all`, `land_parcels_member_all`). CHECKs: `tenure` in `owned\|leased\|crop_share`; `status` in `active\|retired`; name non-blank; area null or **> 0** |
| `land_zones` | Management units inside a parcel. **`geometry` jsonb since 2a.0**, same rules as the parcel's | Composite FK `land_zones_parcel_fk` on `(tenant_id, parcel_id)` → `(tenant_id, id)`, **RESTRICT**, so cross-tenant nesting is unrepresentable and a parcel cannot be deleted out from under its zones |
| `land_zone_uses` | What a zone is for, over a date range | Composite FK to the zone, **CASCADE**. `ended_on` is **INCLUSIVE**; null means current. CHECK `ended_on >= started_on`; `use` matches `^[a-z][a-z0-9_]{0,62}$` (**format only**) |
| `land_occupancy` | What was actually ON a zone, in what structure, and when | Composite FK to the zone, **CASCADE**. `ended_on` inclusive; null means still there, which is what makes a zone read as occupied. `extension_slug` + `occupant_type` + `occupant_id` describe the occupant (P3); `occupant_label` is a **copy**. `area_acres` null means the whole zone |
| `land_features` | **Slice 2b.0.** Things ON the ground: fences, gates, buildings, woods, waterlines, buried cable. One table for points, lines AND areas — `geometry` jsonb, read through `asFeatureGeometry`, nullable meaning "not drawn yet" | Composite FK `land_features_parcel_fk` → the parcel, **RESTRICT**. Attached to a PARCEL, never a zone: a fence runs *between* paddocks. `land_features_fed_by_fk` is the same shape pointed at **its own table**. CHECKs: `status` in `planned\|built\|removed`; `kind` format-only; `fed_by_id` is distinct from `id`; `line_width` null or 0.5–12. **No posts** — a fence is one row with a spacing. `line_width` is a DRAWING property and deliberately not in `attributes`, which the takeoff will compute from |

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
- `src/packs/land/core/geo.ts` — pure. Parsing what somebody pasted, spherical
  area, ray-casting containment, bbox and centroid, and the declared-vs-drawn
  comparison. **Coordinates are [longitude, latitude]**, which reads backwards
  to anyone used to saying it out loud. Since 2b.0 it also holds
  `FeatureGeometry` (the wider type), its own validator — **separate from
  `validateBoundary` so neither can be called wrongly** — and `haversineM` /
  `geometryLengthM`
- `src/packs/land/core/length.ts` — pure. The sibling of `area.ts`, with one
  difference: **length has no canonical store.** Nothing writes a length, so
  there is no `toMetres` matching `toAcres`; it is computed from the geometry
  every time it is shown
- `src/packs/land/core/features.ts` — pure. Feature kinds, per-kind symbology,
  the status styles, and `featureKindsFrom` for a profile's own words.
  **Industry-neutral (ADR 0004): no `trough`, no `energizer`** — those come from
  `packConfig.land.featureKinds`, and an unknown kind draws with the fallback
  for its shape
- `src/packs/land/components/site-plan-map.tsx` — the site plan. One map, a
  basemap toggle, a shape picker, and Terra Draw in point/line/polygon modes.
  **The map handlers read the draw mode from a REF**, because they are
  registered once and would otherwise close over the mode at creation
- `src/packs/land/components/plan-legend.tsx` — the key. Only the kinds
  actually on this parcel, drawn from the same `featureStyle` the map uses
- `src/packs/land/core/parcel-lookup.ts` — pure. The source registry, the
  where-clause building and the candidate mapping
- `src/packs/land/parcel-lookup-service.ts` — the only outward fetch in this
  pack. Server-side, closed registry, fifteen-second timeout
- `src/packs/land/components/parcel-finder.tsx` · `src/app/dashboard/m/land/find/page.tsx`
- `src/packs/land/components/boundary-map.tsx` — the map and the tracing.
  MapLibre + Terra Draw, both loaded through `await import()` inside an effect
  because they touch `window` on construction
- `src/packs/land/core/basemap.ts` — pure. The imagery source, why it is the
  public-domain one, and the both-or-neither config rule
- `src/packs/land/components/boundary-controls.tsx` — the paste box, which runs
  the same parser and the same area formula the server will
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
- **"CURRENTLY" IS A QUESTION ABOUT A DATE, so pass `today` in.** A stay can be
  recorded ahead — the move dialog has an `On` date — and a stay recorded ahead
  has not happened. It contributes nothing until it starts, and an `ended_on` in
  the future means they are still on the ground. Four reads have needed this
  and each was found separately: `zoneRest`, `completedStayDays`,
  `currentZoneForOccupants`, `occupantsInStructures`. **A new read that folds
  occupancy spans or asks "where is it now" takes `today` — assume it does until
  you have proved otherwise**, because the failures are silent and they
  contradict each other across pages. See the two 2026-08-16 entries.
- **Never match on "the stay with no end date" to mean the current one.** After
  a move dated ahead, the row they are actually on is CLOSED (on a date that
  has not arrived) and the open one has not begun. The correct predicate is
  `started_on <= today AND (ended_on IS NULL OR ended_on >= today)`.
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

- **A COMPUTED ACREAGE NEVER OVERWRITES A DECLARED ONE.** `area_acres` is what
  the deed or the county says and is what rent and tax are based on; `geometry`
  is what the fence encloses. Saving a boundary does not fill in a blank area
  either. Report the difference, never correct it — the same rule as
  `zoneCoverage`.
- **Coordinates are `[longitude, latitude]`**, GeoJSON's order and every
  exporter's. It reads backwards to anyone used to saying "lat/long", and the
  classic paste error only fails loudly when the latitude exceeds 90 — which,
  longitudes being what they are, is most of the United States.
- **The geometry column is not validated by the database and cannot usefully
  be.** jsonb has no shape constraint and a CHECK could only test for an object.
  Every reader goes through `asBoundary`, which returns null for anything it
  cannot read, so a bad row degrades to "no boundary" rather than a broken page.
- **Winding order is ignored when measuring**, deliberately. Trusting it would
  make a valid but clockwise boundary measure negative.

## Open items

- **Nobody has drawn a feature on production.** 2b.0 was driven end to end on
  the dev branch's Hilltop Farm — drawn, measured, saved, promoted — and every
  bug it found is written up in the build log. Production has the table, the RLS
  and the screen, and nothing on it.
- **`haversineM` has one consumer of the three it was written for.** Fence
  lengths use it; the takeoff (2b.1) and "what is within 100 ft of me" (2b.2) do
  not exist yet. That is the same shape as `zoneAtPoint` shipping ahead of 2a.2,
  and it is deliberate for the same reason — but it is a debt until they land.
- **Nothing reads `attributes`.** The panel displays whatever is in the bag and
  the pack computes from none of it. Per-kind fields (`spacing_ft`, strand
  counts) wait for 2b.1, because that is the slice where a wrong key stops being
  cosmetic and starts producing a wrong materials list.
- **`fed_by_id` has a column and a picker and no screen that uses it.** "Show me
  everything on the north energizer" is one query away and nothing asks it yet.
- ~~Nobody has pasted a boundary yet~~ — **closed 2026-08-19.** Driven on
  production; the measured acreage, the disagreement badge and both refusal
  paths all behaved. It found the empty Replace box, now fixed.
- **`zoneAtPoint` has no caller.** Written for slice 2a.2, where the daily round
  and the move dialog pre-fill the zone from a phone's location. It is the one
  thing in this pack shipped ahead of its consumer, and the build log says why.
- ~~No map~~ — **shipped 2026-08-19.** MapLibre over public-domain USDA/USGS
  orthoimagery, with tracing, corner-dragging and live acreage.
- ~~Nobody has traced a boundary on the map yet~~ — **closed 2026-08-19.**
  Traced and saved on production; the stored acreage matched the live readout
  exactly. Corner-dragging is fixed but has not itself been driven since.
- ~~No parcel-number lookup~~ — **shipped 2026-08-19** for Ohio, by number and
  by tax mailing address.
- ~~Nobody has run the finder in a browser~~ — **closed 2026-08-19.** Driven on
  production against real Knox County records: nine parcels found, one imported,
  its boundary measuring within 0.003% of the county's figure. It found the
  missing entry point, now fixed.
- **Ohio's parcel data is a per-county snapshot, and Knox's is from
  2023-05-16.** Anything split or sold since is missing or shows its previous
  owner. The finder reports the date; it cannot fix it. Regrid, the paid route,
  refreshes far more often and is the answer if this bites across clients.
- **Ohio only.** `PARCEL_SOURCES` has one entry. Every other state needs either
  its own statewide service added to the registry or the paid nationwide route
  (Regrid, which has an owner-name search Ohio's data cannot offer).
- **No FSA import.** Field boundaries a producer exports themselves from
  farmers.gov are already paddock-level, which is the half this lookup does not
  reach — it returns deed parcels, and paddocks inside them are still traced by
  hand.
- **A second import of the same parcel makes a second parcel.** Nothing matches
  on the county number to offer an update instead.
- **No address or place search.** With no boundary anywhere the map opens on the
  continental US, and "find my location" is the only way in. Fine for a farmer
  standing on the farm, useless at a desk three states away.
- **Nothing checks that a zone's boundary falls inside its parcel's**, by design
  — but nothing reports a zone drawn on the wrong side of the county road
  either, and that is a report this pack could honestly make.
- **A boundary cannot be edited, only replaced or removed.** Fixing one corner
  means editing the GeoJSON in the box by hand — which is at least possible now
  that the box shows it. The map slice is what makes this reasonable rather than
  a gap worth closing twice.

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
- ~~Nobody has driven slice 1 yet~~ — **closed 2026-08-16.** Driven on
  production across four sessions of clicking. It found, in order: the
  structure picker offering a chest freezer, the move that could not move, and
  rest counting a booked arrival as occupancy. All three are fixed; none of them
  was going to be found by a test, and two of them had passing tests over the
  wrong behaviour.
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
  a harsher rule than intended for what is often a mis-click — and it now also
  means **a combine cannot be undone**. The dialog says so; reversing a
  retirement is worth more than it was.
- **Combining does not merge notes or dissolve the seam** between adjacent
  deeds. Both are cosmetic against a boundary that already measures correctly.
- **No bulk entry.** Twenty paddocks is twenty dialogs. The design's *schema at
  10×, UI at 1×* rule says this is correct for now and that a grid is purely
  additive — but 200 paddocks is the number that makes it urgent.
- **Nothing validates that a zone's area fits its parcel**, by design (see
  Decisions) — but nothing surfaces a wildly over-assigned parcel either beyond
  one line on the detail page.
