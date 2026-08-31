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
| **2b.1** | **Walk to place a point** — an input mode for every kind, with the accuracy figure shown. [Designed 2026-08-29](#the-paddock-layout--designed-2026-08-29-not-yet-built) | **shipped 2026-08-29** |
| **2b.2** | **Subdivide** — pick the ground and a lane, say how many, get n planned paddocks with their dividing fences and gates. `planned` arrives on zones | **shipped 2026-08-29** |
| **2b.3** | **Navigate to a point** — distance counting down, bearing, and arrival judged against the live accuracy | **shipped 2026-08-30** |
| **2b.4** | **Plans and the takeoff** — a named set of proposals, saved quantities, hand-added lines | **shipped 2026-08-29** |
| **2b.5** | **Snap, and the ground inside the fences** — a drawn point joins what is already there, and the loops the fences make become ground you can divide | **shipped 2026-08-29** |
| **2b.6** | **Getting rid of things** — discard a proposed paddock, and sort/filter/bulk-delete the plan list | **shipped 2026-08-30** |
| **2b.7** | **The paddock table gets it too** — same filter/sort/select, and the bulk act is RETIRE | **shipped 2026-08-30** |
| ~~2b.x~~ | ~~**"What is here"** — the phone screen~~ — **absorbed into 2b.1/2b.3 on 2026-08-29.** It was always the same machinery, and it is far more trustworthy once the boundary was WALKED rather than traced | |
| **3** | **Weather + GDD** — Open-Meteo by parcel centroid, no table and no cron | **shipped 2026-08-30** |
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
grazing wedge and dry-matter measurement, and any **optimizer whose output
cannot be checked by eye** — pipe sizing, friction loss, gravity versus pumped.
Operations first, planning second.

**That rule used to say "every planner", and it was wrong** — corrected
2026-08-28 with the founder, who had never agreed to it and pointed out that he
had asked for planning from the start. One word was covering two things. An
OPTIMIZER designs for you: a spanning tree over hydrant points, gravity versus
pumped, pipe sizing. It stays out, and the category design already drew that
line for a second reason — *"this is planning support, not engineering… pipe
sizing, friction loss and pump selection are somebody's stamped design and the
liability is not ours to carry."*

**Sharpened again 2026-08-29, and the qualifier is the whole rule now.** The
2026-08-28 wording banned every optimizer, which would also have banned dividing
a paddock into four equal strips — arithmetic with a VISIBLE answer, where being
wrong means you look at it and drag it. What actually needs refusing is output
nobody can verify by looking, because that is where a wrong number becomes
somebody's stamped design. A layout you can see is a PROPOSAL, and the
planned/built machinery already exists to hold proposals. Water layout stays
out on the original grounds, which were never about optimisation as such. See
[The paddock layout](#the-paddock-layout--designed-2026-08-29-not-yet-built).

A TAKEOFF is arithmetic on a shape you drew
yourself: 1,240 ft of fence ÷ 8 ft spacing = 156 posts. That is in, and it is
slice 2b. Nothing about it decides anything for anybody.

## The site plan — designed 2026-08-28, **ALL OF IT SHIPPED**

**Read this before touching the site plan.** The first version of this section
was a brainstorm; it was argued through with the founder the same afternoon and
**four of its conclusions changed**, and then 2b.0 was built from it that
evening. What follows is the settled shape. **Everything it describes is now
live** — the as-built layer, the status column, the symbology, the length
function, plans, the saved takeoff and the phone screen — so read it as the
reasoning behind what is there rather than as a plan. The sections below
describe all of it,
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

## The paddock layout — designed 2026-08-29, **BUILT: 2b.1 THROUGH 2b.5 AND 2b.3**

**Read this before touching the layout, the walk mode or the navigator.** It is
the design behind all of them, and it changes what the pack is FOR in a way
worth understanding before touching it. Everything below shipped between
2026-08-29 and 2026-08-30; two of its conclusions were corrected on contact with
real ground, and both corrections are marked in place rather than rewritten
over.

### The direction of causality flips, and that is the whole point

Everything built through 2b.0 treats the map as a **record of what exists**. You
trace what is there, and the drawing is checked against the ground. What the
founder asked for on 2026-08-29 is the opposite: **a plan you execute in the
field.** In his words — *"you click on the start of a paddock and using GPS it
directs you until you are standing right in the right spot to set the posts and
wire."*

**And he identified the reason it cannot be built on 2b.0's foundation:** *"It
is not accurate enough for me to just draw lines on a map and then go out in the
field and assume I am putting them in close to the right spot."*

That is correct, and it is the load-bearing fact of this whole design:

  - **NAIP imagery** is georeferenced to within a few metres of truth. A line
    traced perfectly off the photo can sit several metres from where it looks.
  - **Phone GPS** is roughly 3–5 m under open sky and worse under a tree line.

**Trace off imagery and navigate by GPS and those errors are INDEPENDENT, so
they add.** Five to ten metres is a visible dogleg in a fence run.

### The fix is his, and it is not the obvious one

*"I picture out in the field and standing in the areas where the path is and
setting location in the app."*

**Walked points are not more accurate in absolute terms — they are more
accurate RELATIVE TO EACH OTHER AND TO YOU LATER.** The same phone, in similar
sky, on similar satellites, is wrong in much the same direction twice. So
walking a line and later navigating back to it lands far closer than either
error figure suggests; plausibly 1–2 m where the absolute figure is 5.

Trace-then-navigate stacks two unrelated errors. Walk-then-navigate cancels most
of one. **That is why 2b.1 comes first**: it is the assumption everything else
rests on, and it should be proved by walking a tree line before anything is
built on top of it.

**THE STANDING RULE THIS PRODUCES: survey by walking, not by tracing, for
anything you intend to BUILD.** Tracing stays right for recording what is
already there, which is what 2b.0 is for.

### Enclosure detection is NOT needed, and that matters — **BUILT ANYWAY in 2b.5, and here is why the argument below was half right**

> **Read this heading before the section under it.** The claim that enclosure
> detection is off the critical path held for 2b.2 and stopped holding the
> moment somebody used it. The reasoning below is correct that *divide this
> polygon* needs no topology inference — and wrong that any polygon on offer
> was the right one. Every polygon a person could choose was the DEED line or a
> zone they had already drawn, so paddocks laid out on real ground ran through
> the fence and out the far side. The founder reported it as *"it cant leack
> out"* on 2026-08-29.
>
> **The hard part named below is real and was fixed rather than avoided.**
> Hand-traced fences do not meet — so 2b.5 made them meet (`core/snap.ts`)
> before asking what they enclose (`core/enclosure.ts`). No flood fill: the
> fences are a graph and the loops are cycles in it.


The founder originally wanted *"click on a fenced in area and say add 4 paddocks
to this"*, which reads as inferring a polygon from a ring of fence lines. That
is genuinely hard — hand-traced fences do not meet, so the ring does not close
and a flood fill escapes into the rest of the parcel.

**It is also not required for anything he described.** "Add 4 paddocks to this"
subdivides something that is ALREADY a polygon: a parcel, a zone, or an area
that was walked. The operation is *divide this polygon into n pieces*, which
needs no topology inference at all. Enclosure detection is a later convenience
for ground that exists only as loose lines, and it is off the critical path.

### The lane makes the layout EASIER, not harder

This looked like a complication and is the opposite. *"Divide a polygon into 4
efficient pieces"* is badly posed — efficient by area, by fence length, or by
shape? Those fight.

**Superseded in part on 2026-08-29: the lane is a CORRIDOR, not a line.** Its
own ground is clipped out before anything is divided, so no fence is ever drawn
across it — see *The lane is a corridor, not a line* in
[the build-log archive](./land-build-log). The rest of this section stands.

**"Every paddock must touch the lane" collapses the search space to one answer:
parallel strips perpendicular to the lane.** One parameter (the lane's
direction), n−1 cuts, equal area each. A sweep with a binary search on the
offset — deterministic, fast, and checkable by eye, which is the property that
matters most (see the rule below).

**Equal AREA, with drag to adjust.** Settled with the founder. Equal grazing
DAYS is what rotational grazing actually wants, and it depends on forage — which
is the plate-meter treadmill this dossier already refuses. Equal area is the
honest approximation and the drag handle is the escape.

**A BENT LANE IS WHERE THIS GETS FIDDLY, and the founder has said the lane's
shape follows the ground.** Cuts perpendicular to the lane's local direction fan
out around a dogleg and can CROSS each other on the inside of the bend,
producing a wedge that is not a paddock. **Detect the crossing and say so**
rather than silently emitting a bad shape. A cleverer algorithm exists; it does
not earn its keep against a drag handle.

**Lane position is the founder's, not the app's.** Down the middle serves both
sides and halves the lane fence per paddock; along an edge serves one. Show the
difference as fence-feet-per-paddock-served and let him choose. Planning
support, not a decision made for him.

### THE CORRECTION: the layout creates ZONES, not just fences

**The first version of this design said the layout should output proposed FENCES
and let a zone be created once the fence was built. The founder pushed back and
he was right.** Recorded here because the reasoning is what matters:

  - **It did not remove enclosure detection, it deferred it.** When the fence
    went up, something would have had to work out what polygon those fences
    enclosed — the exact problem this design avoids — and deferred it to the
    worst possible moment, standing in a field.
  - **The layout ALREADY KNOWS the polygons.** It computed them to cut the
    strips. Throwing that away and re-deriving it later is silly.

**And the better reason, which is a fact about farms rather than about code: a
paddock boundary is not always a fence.** A creek, a road, a hedge, a bluff.
Zone geometry and fence geometry coincide often and need not, so they are two
objects rather than one duplicated — which is what makes storing both correct
instead of merely convenient.

**So the layout is ONE ACT that creates n planned zones AND their dividing
fences and gates.** The paddocks are the point; the fences are what you go and
build.

### `planned` arrives on `land_zones`, and it changes five reads

`land_zones.status` is `active | retired`. `planned` goes on the front, which is
the same lifecycle the pack already models — but it changes what several
existing reads MEAN, and each is a decision rather than a filter to sprinkle on:

| Read | A planned zone | Why |
| --- | --- | --- |
| `zoneAtPoint` | **excluded** | You are not standing in a paddock that has no fence round it |
| `dimension_members` | **not synced** | A cost object for unfenced ground puts empty columns in every report. It syncs when it goes active |
| Occupancy | **refused** | With a message saying to build it first, not a constraint violation |
| Rest / rotation | **excluded** | It would dilute every paddock-count and rest figure |
| The map and the list | **shown, ghosted** | Same treatment a planned fence already gets |

Five call sites to audit. Not a rewrite, and cheaper than the alternative of
inventing a second table for proposed ground.

### Gates: draw them, never store their state

The founder's rotation is *"all paddocks gated closed until it is time to move
them; open that one and close the one they are coming from."*

A gate is a physical thing with a position, worth drawing, and the layout can
place one where each paddock meets the lane for free. **Its open/closed state
must not be stored.** Apply the pack's own test:

  - *"Which gate do I open next?"* — the rotation order answers it.
  - *"Where are the cows?"* — occupancy answers it, and is already written every
    time they move.

The paddock they are in has its gate open. That is DERIVABLE, and a stored copy
is a second source of truth that goes wrong the first time somebody forgets to
tap — leaving the app insisting a gate is shut while you are looking at it
hanging open.

### Walk-to-place is an INPUT MODE, not a feature

*"This ability to walk the field and click to set a point... should be available
for all of the items — tree line, underground electric etc."* Right, and framing
it as an input mode is what makes it small.

It is a second way to place a vertex in the tool that already exists:

  - **Tap the map** — where you are now
  - **Use my location** — a button that drops a vertex at the GPS position

Same geometry, same live measurement, same save path, every kind for free.

  - **TAP AT CORNERS, NOT A CONTINUOUS TRACK.** Settled with the founder. A
    recorded track eats battery, captures every wobble in a walk, and needs
    simplifying afterwards anyway. A fence has corners.
  - **SHOW THE ACCURACY FIGURE NEXT TO THE BUTTON.** `coords.accuracy` is
    reported by every browser and a vertex dropped at ±20 m is one to redo. A
    screen that shows a position without its accuracy is the screen that gets
    a post planted in the wrong place with total confidence.
  - This is also the machinery "what paddock am I in" was waiting for, which is
    why that slice was absorbed rather than kept.

### Navigating to a point, and the honest limit

Bearing and distance from here to there, live — `haversineM` and an azimuth,
both small. What is not small is the truth about the last few metres:

  - **Consumer GPS will not reliably close better than about 3 m.** Fine for
    polywire. Marginal for permanent corner posts.
  - **The accuracy figure is part of the instruction**, not decoration. "Within
    3 m" and "within 20 m" mean different things about whether to dig.
  - **Centimetres mean an external RTK receiver and a correction service** — a
    few hundred dollars of hardware, not code. Worth knowing it exists. Nothing
    here should be built assuming it.

### The optimizer rule needs a sharper edge, for the second time

The [build-log archive](./land-build-log) entry of 2026-08-28 corrected
*"never a planner"* to *"never an optimizer"*. Auto-layout is an optimizer, so either that was wrong or the rule
is still blunt. It is the rule.

What the ban protects against is **output you cannot check by looking** — pipe
sizing, friction loss, gravity analysis, where being wrong is somebody's stamped
design and the liability is not ours. Dividing a polygon into four equal strips
is not that. It is arithmetic with a visible answer, and if it is wrong you see
it and drag it.

**The rule, sharpened: an optimizer is banned when its output cannot be verified
by eye.** Layout you can see is a PROPOSAL, and the planned/built machinery
already exists to hold proposals. Water layout stays banned on the original
grounds, which were never about optimisation as such.

### What to resist

  - **Storing gate state.** Above, and it is the most tempting one.
  - **A continuous GPS track.** Corners, on a button. The 2b.0 rule stands: this
    is a button, not a background service, and nothing here needs to know where
    anybody was an hour ago.
  - **A cleverer algorithm for the bent lane.** Report the crossing, offer the
    handle.
  - **Equal grazing days.** It needs forage measurement, which this dossier
    refuses for good reasons that have not changed.
  - **Enclosure detection.** Off the critical path; revisit only when there are
    enough WALKED fences to know whether they close.
  - **Assuming RTK.** Everything here must be useful at 3 m.

## Build log

### 2026-08-30 — Slice 3: growing weather (`claude/weather-and-gdd`)

**No migration, no table, no cron.** A pure core, one `server-only` fetch and a
panel. **Nothing is stored, and that is the reason weather could be scheduled
last** — Open-Meteo serves history by latitude and longitude, so a season nobody
was watching is still there when somebody looks. Being late cost no data,
exactly as the roadmap said when it put this after the geometry.

**THE QUESTION IT ANSWERS IS "IS TWENTY-ONE DAYS OF REST ENOUGH".** Rest days
and grazing days are already free, computed from occupancy. What is missing is
how much the grass actually GREW in those days, and measuring that is the thing
nobody keeps up. Degree days are a free proxy: a season running behind is one
where the same twenty-one days bought less. It sits beside the Rotation panel
because that is where the decision gets made.

**IT REPORTS AND DOES NOT PREDICT, DELIBERATELY.** The brief's own line —
*"you return to Paddock 4 in 16 days, not 21"* — is the destination and is NOT
this slice. Turning degree days into a regrowth date is a correlation nobody
here has validated, on ground nobody here has measured. The brief says the same
in its own words: log from day one, insight in year three. So this shows what
the weather DID next to the same window in previous years, and the person draws
the line. Same rule as the rest of the pack: report, never assert.

**Three decisions worth the words:**

- **A DEGREE DAY IS NOT A TEMPERATURE AND DOES NOT CONVERT LIKE ONE.** The 32 in
  the Fahrenheit formula is an offset between two zero points; a degree day is
  already a difference. Adding it would put 32 extra degree days on every day of
  the season — a wrong number that looks entirely reasonable, so it has a test
  of its own.
- **THE GAPS ARE COUNTED, NOT FILLED.** A missing day is an unknown, not zero
  growth. Averaging it in as zero makes a patchy archive read as a cold season,
  which is the same trap `totalLength` avoids for an undrawn feature.
- **THE COMPARISON IS AGAINST THE SAME WINDOW, NOT THE WHOLE PREVIOUS YEAR**, or
  every season reads as behind until December.

**Fahrenheit is the default, which it is nowhere else in this pack.** Area and
length are set per profile with no US bias. A degree-day figure is different: it
is only useful if it matches the ones the person already reads, and every US
extension service publishes GDD in Fahrenheit days over a base of 50. A grower
comparing our 900 against their county's 1,600 would conclude the app is broken.
Both the unit and the base live in `packConfig` — the base because **which
threshold matters is a fact about your business, not about the ground** (ADR
0004). Cool-season grass over a base of 0C is a config line, not a code change.

**No upper cap on the daily high, and that is a decision rather than an
omission.** Corn is always computed with the high capped at 30C. Choosing a cap
now means choosing it on behalf of every business this pack serves; uncapped is
also a published convention. **What would trigger adding it:** somebody
comparing our number against a capped local one and finding a gap in a hot
month. It belongs beside `gddBaseC` when it comes.

**Driven on Hilltop Farm against the live archive, and the number checks out
against the outside world.** Home Farm read **2,609 °F-days since 1 January over
a base of 50°F, about level with the 5-year average for this date**, and
**0.04 in of rain in the last seven days, last worth the name eight days ago**.
Central Ohio runs roughly 2,400–2,700 base-50 degree days by the end of August,
so the figure is one an extension service would recognise — which is a better
check on the arithmetic than any assertion in the test file.

**The screenshot could not be taken.** The browser pane reported the right
scroll position and kept rendering the top of the page, the same flake this
session hit twice before. The panel's content was read out of the DOM instead,
so what is verified is the text and the numbers, not how it looks.

**Tested:** 25 pure cases — the floor that stops a cold snap undoing a season,
gaps counted rather than filled, the same-window comparison, a year with no data
left out of the average instead of dragging it down, rain never counted from the
future, the degree-day conversion that is not a temperature conversion, and
config readers that refuse nonsense. 2,358 pure pass; lint, `tsc` and the build
are green.

### 2026-08-30 — Fields are not rectangles (`claude/fields-are-not-rectangles`)

**No migration.** Two open items said the same thing from different ends —
*enclosure detection has only run on squares* and *the layout has only ever been
run on a rectangle* — so this went looking for what breaks on real ground: an
L-shaped field, fences that overshoot at the corners, a fence following a creek,
and two fields sharing a middle fence.

**ELEVEN OF TWELVE CASES PASSED FIRST TIME.** The graph walk handles a reflex
corner, keeps the notch out, follows a bend instead of straightening it, closes a
corner where two runs overshoot, and finds both halves of a cross-fenced field
rather than the outline of both. That is worth recording as plainly as a bug
would be.

**THE TWELFTH FOUND A REAL ONE, AND IT IS NOT ABOUT L-SHAPED FIELDS.**

`subdivide` shared the paddock count between the two sides of the lane as
`round(count / used.length)` — **two and two, whatever the two sides weighed.**
On a rectangle with the lane down the middle that is exactly right, and a
rectangle with the lane down the middle was the only thing this had ever been
run on, in every test and every drive including the browser ones.

Move the lane a quarter of the way across and the sides are 1:3, so four
paddocks come out as two small and two large — **a 1.95:1 spread under a dialog
that says "Equal areas" and shows a single "Each" figure.** Nothing crashes,
nothing leaks past the fence, the paddocks do not overlap. They are just not
equal, which is the kind of wrong that gets fenced before anybody notices. **A
lane goes where the gate and the water are, not down the middle**, so this would
have bitten on the first real field.

`shareOut` now apportions by AREA — largest-remainder, with a floor of one
paddock per side, because asking for both sides and getting none on one of them
is ground silently left out of the layout. Three paddocks on a side with three
times the ground are the same size as one paddock on the small side.

**WHERE EQUAL IS ARITHMETICALLY IMPOSSIBLE, IT NOW SAYS SO.** Both sides get at
least one paddock, so a 2:1 lane split four ways cannot be equal whatever you
choose. `EQUAL_ENOUGH` is a threshold for what to SAY, not what to build:
*"These cannot come out equal: the biggest is 1.5 times the smallest. Ask for
more paddocks, or put them all on one side of the lane."* It reaches the person
through `compareLayouts`, which is what the dialog costs the two placements
with — asserted, because a warning that exists in the outcome and not in the
option is one nobody sees until after they have built it.

**I TOOK THE WRONG MEASURE FIRST AND IT ARGUED FOR THE WORSE LAYOUT.** On the L,
two-and-two is 1.95:1 with every paddock 32% off the mean; three-and-one is
1.54:1 with three paddocks identical and one odd. **Mean-deviation prefers the
first; largest-over-smallest prefers the second**, and the second is plainly
better on a farm. I reported the fix as an improvement on a first read of the
numbers that was simply wrong, then went back and measured. The tests now
brute-force every split there is and assert the chosen one wins on ratio, which
is the measure the warning itself reports.

**Tested:** 16 new pure cases. The L-shaped field found as one enclosure with
the notch genuinely outside; its paddocks contained, non-overlapping and
optimally split; overshooting corners; a creek-following fence neither
straightened nor lost when divided; two fields sharing a fence found as two.
Four lane offsets and two counts brute-forced against every alternative split.
2,331 pure pass; lint, `tsc` and the build are green.

**Not driven in a browser**, deliberately: the bug is arithmetic, the fix is
arithmetic, and the assertions here are stronger than a screenshot of one field
would be. What a browser would add is whether the warning reads well, which is
the same open question every other warning in this pack has.

Newest first. One entry per session or PR that touched this pack. Every PR that
changes it MUST add an entry here (rule in AGENTS.md).

> **Older entries live in [`land-build-log.md`](./land-build-log).** This
> section keeps the most recent work only. Add new entries at the top here; when
> it grows past a few screens, sweep the oldest into the archive. The dossier is
> read at the START of every land session, so its length is a real cost — and
> this pack is worked on more than any other.

### 2026-08-30 — The dossier got swept (`claude/sweep-the-land-dossier`)

**Docs only.** `land.md` had reached **2,969 lines, two thirds of it build log**
across 38 entries. AGENTS.md names that exact situation: the dossier is read at
the START of every session that touches the area, so its length is a tax on
every future change, and `email.md` reached 3,894 lines at 78% before anybody
acted. Land is the most worked-on area in the repo, so it was paying that tax
more often than anything else.

**The four newest entries stay; the other 34 moved to
[`land-build-log.md`](./land-build-log).** 2,969 → 1,437 lines, with the build
log down to about four screens. Nothing is superseded and nothing is deleted:
`build-docs.ts` walks the whole tree, so the archive renders at
`/admin/docs/modules/land-build-log` with no code change — **checked, not
assumed**, along with all three links from the dossier into it.

**THE DESIGNS DID NOT MOVE, and that is the whole judgement call.** *The site
plan* and *The paddock layout* are read BEFORE work, not after it; they are the
reasoning a session needs in hand. The build log is the narrative of sessions
already shipped, and the durable conclusions from those sessions already live in
*Decisions & gotchas*, *Key files & seams* and *Open items*, which are
maintained per PR.

**Two stale headings the sweep surfaced**, which is the argument for doing this
by hand rather than by script:

- *The paddock layout* still said **NOT YET BUILT**. It is built — 2b.1 through
  2b.5 and 2b.3, all shipped over two days. A session reading that heading would
  have been told the opposite of the truth about the largest design section in
  the file.
- *The site plan* said "plans, the saved takeoff and the phone screen are not"
  live. All three are.

**Two cross-references now span the boundary** and were repointed at the
archive rather than left dangling: the lane-is-a-corridor correction, and the
2026-08-28 entry that sharpened *"never a planner"* into *"never an optimizer"*.

### 2026-08-30 — Slice 2b.3: navigate to the post (`claude/navigate-to-the-post`)

**No migration, no schema, no ops, no actions.** A pure core and a screen. That
is what the last five slices bought: everything this needed already existed.

**THIS IS THE ONE THE REST OF 2b WAS FOR.** The founder's words when he asked
for the layout, on 2026-08-29: *"out in the field, you click on the start of a
paddock and using GPS it directs you until you are standing right in the right
spot to set the posts and wire for the paddock."* Without it the layout is a
picture. It waited on a real field test of walk mode, which happened on
2026-08-29; nothing has blocked it since.

**THE DISTANCE IS THE INSTRUMENT. THE BEARING IS SUPPORT.** This is the design
decision the screen is built around and it went the other way at first. A
bearing of 271 degrees only helps if you know which way you are facing, and a
phone being carried does not reliably know — the compass wants a permission
prompt on iOS, is thrown by a truck door, and is wrong in a way nobody can see.
What always works is walking a few paces and watching the number: it drops, or
it climbs and you turned wrong. So the number is the hero at three times the
size of anything else, the trend sits beside it, and the compass point is there
to save the first guess.

**ARRIVAL IS MEASURED AGAINST THE ACCURACY, NOT AGAINST A DISTANCE SOMEBODY
PICKED.** This is the honest limit from the design section turned into the
interface rather than left as a footnote. You have arrived when **the target is
inside the circle the phone says it is unsure by**. Standing 4 m away on a
+/-6 m fix, the phone genuinely cannot tell you are not on it; on a +/-2 m fix
it can, and it says so. The consequence is deliberate: on a bad fix you arrive
EARLIER and the screen tells you the radius, because the alternative is a
countdown that never reaches zero and somebody in a field being told to keep
walking by an instrument that has lost them.

It never says "you are here". It says **"Within 20 ft — as close as the phone
can tell today"**, which is the sentence that decides whether to drive a corner
post or wait for a better sky. Underneath: *"Good enough for polywire. For a
permanent corner post, check it against something you can see."*

**THE VERTICES ARE THE POSTS.** `targetsOf` turns any geometry into an ordered
list of places to stand, because a planned fence's corners are exactly where
somebody has to dig and walking them in order is how the run gets built. A gate
is one target. **A ring's closing repeat is dropped** — walking to it would tell
somebody to go back to the corner they started at.

**The first fix chooses which corner to start at, and only the first.** Somebody
opening this is already somewhere, usually at one end of the run; being sent to
the far end because that vertex happens to be index 1 wastes a walk. Re-choosing
every fix would be worse than useless — the moment you arrived it would hand you
that same corner forever.

**Two things the drive caught, neither of which a test would have.**

- **A farm working in feet read "7 ft" in letters an inch tall and "Within 6 m"
  underneath it.** `arrivalNote` was writing the metres in itself. It has no
  business knowing what unit anybody uses — `length.ts` owns that — so the radius
  now arrives already formatted, with `arrivalRadiusM` exported so the sentence
  describes the circle the decision actually used rather than a second one that
  might disagree.
- **Every `setState` moved into the fix.** The starting corner and the trend
  were computed in effects, which React's own lint rule refuses, and rightly:
  both are reactions to a new POSITION, which is an event. In effects it is also
  a render that immediately schedules another one, twice per fix, for as long as
  somebody is walking.

**Driven on Hilltop Farm against a stubbed phone**, walked in along a real
fence: 517 ft → 374 → 204 → 58 → 7, "getting closer" the whole way, "Keep going"
then "Close. Slow down and watch the distance" then "Within 20 ft" with a
**you are on it** badge. Walked past it and the trend flipped to "further away"
with the bearing turning round to NW 305 degrees. Next corner and Back both move
the target and clear the trend, which they must — a distance measured to
somewhere else is not a comparison.

**Tested:** 24 pure cases, the ones worth writing down being a bearing that is a
real azimuth rather than an angle between coordinate differences (out by 15
degrees at 40N if you get it wrong), arrival opening under a bad sky and
tightening under a good one, the ring's closing repeat, and drift below the
noise floor not registering as movement. 2,317 pure pass; lint, `tsc` and the
build are green.

**NOT DRIVEN WITH A REAL PHONE, and this is the slice where that matters most.**
The sandbox denies geolocation, so every fix above was synthetic — which means
the arithmetic is proved and **the feel is not**. Whether five metres of
tolerance reads as "you are on it" or as "it lost me" is a question only a walk
answers, and the same is still true of walk-mode snapping from 2b.5.

### 2026-08-30 — Slice 2b.7: the paddock table gets it too (`claude/the-paddock-table`)

**No migration.** One line the same day the last slice landed: *"do the same for
the paddock table"*. Fair — 2b.6's own open item said the paddock table had none
of it, and it matters at the same scale for the same reason.

**BUT THE BULK ACT IS RETIRE, NOT DELETE, AND THAT ASYMMETRY IS THE WHOLE
DESIGN.** A fence you pull out is gone. A paddock you stop managing had cattle
on it, has a use history and has costs tagged to it, and every one of those
questions still has an answer that a delete would erase. Deleting ground is
`discardZones` and it only ever touches proposals — which is why it lives on the
Proposed panel above this table and not in it. The three acts now sit in one
place and mean three different things:

| Ground | Act | What survives |
| --- | --- | --- |
| Proposed | **Discard** | nothing — there was nothing to keep |
| In use | **Retire** | uses, costs, everything ever tagged to it |
| Retired | — | it is already history |

`retireZones` refuses a set containing anything already retired rather than
skipping it: retiring closes the open use as of `endedOn`, and running that over
ground retired last year would either do nothing or quietly move a date, while a
count reading "3 retired" when one already was is a count nobody can act on. It
also refuses a PROPOSAL, pointing at Discard — retiring one would archive ground
nobody ever fenced, the outcome `discardZones` exists to prevent. Nothing can
reach it with a planned zone today; it is a guard, not a fix.

**RETIRED PADDOCKS WERE NOT HIDDEN. THEY WERE NEVER READ.** The page loaded
`status: "active"` and nothing else, so a retired paddock was invisible here
whatever you clicked. They now come in as a **third separate read**, for exactly
the reason the second one is separate: every figure on this page — rest, the
paddock count, the rotation arithmetic, `zoneCoverage`, the acreage in paddocks
— is about ground you are USING, and folding retired rows into `zones` would put
ground you gave up into all of them at once. Verified on screen: with two of six
paddocks retired the table read "3 of 6" and **In paddocks** dropped to the
remaining acreage, which is the figure that would have been wrong.

**The controls mirror `feature-list.tsx` deliberately**, down to the rules that
were argued out there:

- **Filter** by use and by status. Use options are only the uses actually
  declared, and the effective one is DERIVED — retiring the last hay paddock
  takes "Hay" out of the options, and a filter naming something gone leaves an
  empty list with no clue why. Status defaults to **In use**, keeping retirement
  behind a deliberate ask.
- **Sort** on all four columns. **Rows with no number sink in both directions**:
  sorting by rest asks which ground has had the longest break, and a paddock
  with cattle on it or one never grazed answers neither. An undeclared use sorts
  last the same way — "nothing yet" is not a value on the scale.
- **Select and retire**, narrowed to what is on screen AND to what can still be
  retired. A retired row has no tick and no menu, so the count can never include
  one; switch the filter to Retired and the button goes away rather than lying.

**The table became a client component**, so what stays on the server is
everything that needs the database or the parcel: the current use, rest, the
history behind each row's menu, and whether a paddock is under this parcel's
rest target. The component is handed facts, not queries.

**Driven on Hilltop Farm** against six paddocks seeded for it: sorted by area
descending, filtered to Hay and got the one, filtered to Retired and saw a
paddock that had been unreachable on this page entirely, then selected two and
retired them. The database confirmed both flipped to `retired` **and that the
open hay use closed on today's date** — the courtesy the single retire does, now
done in bulk. Everything seeded was removed afterwards; the parcel is back to the
four paddocks and fifteen features it started with.

**Tested:** five new db-backed cases — bulk retire closes the open uses, refuses
a set containing one already retired without doing half of it, refuses a
proposal in `discardZones`' own words, is owner-only, and does nothing
successfully for an empty selection. 2,293 pure and 178 db-backed pass, the RLS
isolation suite included.

**Still no component tests.** The sort comparator and the narrowing of the
selection are the two pieces here most worth one, in both tables now.

### 2026-08-30 — Slice 2b.6: getting rid of things (`claude/get-rid-of-things`)

**No migration.** Reported from production: *"i had it auto create some paddocks
… I ended up deleting all of the paddock lines, but I can't seem to get rid of
the purple areas. Plus all of the proposed paddocks are still there and I don't
know how to delete. There should also be a way to sort all of the items in the
list … this list could grow where there are 100s of items. sort, bulk select and
delete and filter."*

**A PROPOSED PADDOCK COULD NEVER BE REMOVED. NOT BY ANY ROUTE.** That is the
whole of the first complaint and it was exactly true:

- `retireZone` archives; there was no delete, and the Proposed panel offered
  only **The fence is in**.
- Deleting every fence the layout drew does nothing, because **the fences are
  not the ground**. The zones are their own rows with their own polygons.
- `deletePlan` does not help either, and deliberately: a plan owns the FEATURES
  it proposed and lets them survive it. It never owned the zones.

So the purple stayed on the map with no control anywhere in the app that would
clear it.

**`discardZones` — PLANNED ONLY, AND HARD.** Retiring and discarding are
different acts and the difference is what is being kept. Retiring records that a
paddock existed and no longer does: the use history stays, and so does every
cost ever tagged to it. Ground that was never fenced has none of that — no uses,
no occupancy (`startOccupancy` refuses planned ground), and no dimension member,
because `layoutPaddocks` deliberately does not create one. There is nothing to
preserve, and a "retired" paddock nobody ever built would sit in the archive
forever answering a question nobody asked.

Anything not `planned` is **refused**, not quietly retired instead. Choosing one
of those for somebody is how a paddock's history disappears without them asking.
It is all-or-nothing over a set for the same reason: half a discard leaves you
re-reading a list to work out what happened.

**Discard is offered per row AND for the lot**, because changing your mind about
a layout is one decision about twelve paddocks, not twelve decisions. Both
confirm in place — the button becomes `Sure?` for one click — rather than in a
modal. The only thing being guarded against is a mis-tap.

**THE LIST MOVED OUT INTO `feature-list.tsx` AND GREW THREE CONTROLS.** He is
right that it will grow: one `layoutPaddocks` run on a twelve-paddock field
emits a fence and a gate per paddock plus the lane fences, so a single decision
can put thirty rows here. Before this, removing any of them meant clicking each
one, opening its panel, and deleting it.

- **Filter** by kind and by state. The kind options are only the kinds actually
  present — an option that matches nothing is a dead end. The state filter
  *replaces* the old `Show N removed` toggle rather than sitting beside it: two
  controls governing which rows appear is one too many. Its default is
  **Built and proposed**, which keeps the rule that was already documented here.
- **Sort** on any of the four columns. Two rules worth keeping: **unmeasured
  rows sink in both directions** (a gate and an untraced fence answer neither
  "what is longest" nor "what is shortest", and floating them to the top on the
  descending pass would bury the answer), and **the tiebreak is the name, not
  the id** — the first version put eight fences in insertion order, which reads
  as no order at all. The tiebreak does not flip with the direction: reversing
  "by kind" should reverse the kinds, not scramble the rows inside each.
- **Select and delete.** The count is **narrowed to what is on screen, always**.
  Tick four rows, change the filter, and the ticks for rows that are no longer
  listed must not still count — a delete button whose number includes things you
  cannot see is how somebody removes a fence they never looked at.

**THE BULK FEED GUARD ASKS A DIFFERENT QUESTION FROM THE SINGLE ONE**, which is
why `deleteFeatures` is not a loop over `deleteFeature`. Singly, "does anything
run off this?" is right. In bulk it is wrong: selecting a waterline and the three
troughs it feeds is a perfectly sensible thing to want gone, and a per-row check
refuses it depending on which order the loop happens to reach them in. What
matters is whether anything runs off it **from outside the selection** — a
dependant you are also deleting is not a dependant.

**Two things the drive caught.** Deleting the last waterline left the filter
pointing at a kind that no longer existed: the list went empty, the count read
"0 of 15", and the only clue was a filter naming something gone. The effective
kind is now DERIVED rather than reset in an effect — state that corrects itself
after a render is state that was briefly wrong. And the op now returns the rows
it deleted instead of a count, so the action needs no pre-read; the first version
listed every feature in the tenant to write one audit line.

**Driven on Hilltop Farm.** Filtered eighteen rows to three waterlines, selected
all three from the header, confirmed, and watched them go — 15 features left in
the database and the filter recovering by itself. Discarded a proposed paddock
per row and watched the purple leave the map. Sorted by length descending and
confirmed the four gates stayed at the bottom.

**Tested:** ten new db-backed cases — discard deletes planned ground, refuses
real ground, refuses a whole set containing one real paddock, is owner-only; and
bulk delete takes a feeder and what it feeds together, refuses a stranded
dependant, refuses the lot when one id is already gone. 2,293 pure pass.

**No component tests, as ever.** The sort comparator and the on-screen narrowing
of the selection are the two pieces here most worth one, and this repo has no
stack for it — the design-system dossier records the same gap.

### 2026-08-29 — Slice 2b.5: snap to the fence (`claude/snap-to-the-fence`)

**No migration.** Two things asked for in one sentence, and they turned out to
be one feature in the right order: *"we need to create snap so that when i build
a lane that goes from one end of a fence to the other it actually connects. Then
I want to make sure when we auto generate padocks it stays withing the border of
the fence. It cant leack out."*

**FIRST, WHAT WAS NOT WRONG.** `subdivide` never leaked. It clips every paddock
against the polygon it is handed, so a paddock cannot escape it by construction
— and a test now asserts that against the fence ring rather than by reading the
code. The leak was in what was being HANDED OVER. The only choices were **all of
<parcel>**, which is the deed line the county drew, or a zone somebody had
already outlined. A fence normally sits inside the deed line, sometimes by a
road width. Correct arithmetic on the wrong outline: paddocks running straight
through the wire and out the far side.

**AND THE TWO HALVES ARE THE SAME PROBLEM.** The design section above deferred
enclosure detection as fragile, for a stated reason — *"hand-traced fences do
not meet, so the ring does not close and a flood fill escapes into the rest of
the parcel"*. Snapping is what makes fences meet. So snapping is not a drawing
nicety that happens to be next on the list; it is the thing that turns a picture
of a farm into a graph of one, and the founder put the two asks in that order
without being told they were connected.

**SNAPPING** (`core/snap.ts`) — a point is moved onto the nearest thing already
drawn, and nothing else about it changes.

- **A CORNER OUTRANKS A RUN, even a nearer one.** Bringing a lane up to the top
  of a fence, the fence's last few metres are closer to you than its endpoint for
  most of the approach — so nearest-wins joins the lane a metre short of the
  corner every time and leaves exactly the stub this exists to remove.
- **Two tolerances, because they are different instruments.** Walking uses five
  metres, which is about one GPS fix in the open: somebody standing genuinely at
  the corner post reads as somewhere within five metres of it. Tapping uses
  fourteen PIXELS converted to metres at the current zoom — a fixed distance in
  metres is wrong in both directions, invisible zoomed out and half the screen
  zoomed in, while a finger is wrong by roughly the same pixels at any zoom.
- **It moves a point, it does not join two rows.** A snapped endpoint is a
  coordinate that happens to be identical to one on another feature. No
  shared-vertex table, no cascade when the fence is redrawn. The alternative is
  topology maintenance, which is a CAD suite, which is the thing this is not.
- **Announced, never silent.** A point that jumps four metres unexplained reads
  as the app losing the tap; *"Joined to the end of West Fence"* reads as the app
  working, and it is the only way to notice it joined the WRONG fence.
- **It can be turned off**, and that is a real answer — a waterline deliberately
  a few metres inside the fence is a thing people mean. Defaulted on.

**THE TRAP: `TerraDrawPointMode` TAKES NO `snapping` OPTION.** Lines and polygons
do; points do not. A gate is a point, and a gate is exactly what you want a lane
to arrive at — so a tapped point snaps on SAVE instead, where a single coordinate
can be moved exactly. A worse moment to learn it than watching a vertex jump, and
the only moment available. Terra Draw's own snapping is also no use on its own:
it sees only features in ITS store, which holds the one shape being drawn.
Everything already on the plan is in MapLibre sources, so `snapping.toCustom` is
the way in.

**THE GROUND INSIDE THE FENCES** (`core/enclosure.ts`) — the fence lines as a
graph, and every loop they make offered as ground to divide.

- **Fences are cut where another fence ARRIVES at them.** Without that a cross
  fence divides nothing: its ends land in the middle of the west and east runs,
  not at their corners, so it shares no endpoint with anything and sits in the
  graph as an island. The loop found is the outside of the whole field and the
  two halves it plainly makes are invisible. Cutting the west run in two at that
  point gives it a degree of three, which is what a junction is.
- **A run that closes on itself needs no graph at all** — four corners walked
  round a field with "close it" ticked, which is what the founder did in a field
  yesterday.
- **The tolerance is the same one snapping uses**, deliberately. Fences drawn
  from now on meet exactly, so any tolerance would do; the tolerance is what lets
  fences drawn BEFORE this slice still form loops. Without it this would find
  nothing on any farm that already has fences on the map, which is all of them.
- **A fence is not only a `fence` kind.** A hedge, a wall and a treeline all stop
  stock. The filter is by SHAPE and status — every drawn line not `removed` —
  rather than a list of kinds that would need keeping in step with the tenant's
  own taxonomy.

**THE IDS TRAVEL, NOT THE POLYGON.** The client works out the loops so it can
offer them with an acreage on the label; what it posts back is which FENCES, and
`layoutPaddocks` computes the ring again from stored geometry. A polygon posted
from a browser is client input, and the ground a paddock is cut from decides an
acreage that lands on a cost object. The op requires the set of bounding fences
to match exactly — anything else means the fences moved between the option being
offered and taken, and dividing different ground than the screen showed is the
worst available outcome.

**A refactor on the way:** the local equirectangular frame (`frameAt`/`toLocal`/
`fromLocal`) was private to `subdivide.ts` and is now in `geo.ts`. Snapping,
enclosure detection and subdivision all have to agree about what a metre is, and
a second nearly-identical projection is how they would stop agreeing.

**Tested:** 19 snap cases, 16 enclosure cases and 5 db-backed layout cases —
including the one that states the bug and the fix side by side: paddocks cut from
the deed line fall outside the fence, and paddocks cut from the enclosure do not.
2,293 pure pass, as do land-ops' 126 db-backed cases; lint, `tsc` and the build
are green.

**Two of my own assertions were wrong before the code was.** A "200 m" side
built from 111_320/110_540 is out by most of a metre against the sphere `geo.ts`
measures on, which is 0.7% of the acreage; and a 20 m inset off a ~400 m field
leaves 81% of it, not under 80%. Both were arguing with a correct implementation.

**DRIVEN IN A BROWSER, on Hilltop Farm — and it found three bugs the tests did
not.** The founder signed in and said to take it for a spin. Every one of these
was invisible to a green suite, and the first two made the feature do nothing at
all.

**1. The tolerance was 256x too small, so nothing ever snapped.** Metres per
pixel was computed as `156543.03392 * cos(lat) / 2^(zoom + 8)` — the Web
Mercator resolution for a **256-pixel tile**. MapLibre's zoom is defined against
**512-pixel** tiles. The pixel tolerance collapsed to nothing, the `max(5 m, …)`
floor took over, and five metres is about four pixels at the zoom somebody draws
a field at. Found by drawing a fence along an existing one and reading 1,351 ft
where the fence itself says 1,318 ft.

The fix is not a corrected constant. It asks the map: `project` the point,
`unproject` it fourteen pixels to the right, measure between them. **A formula
can be wrong about the tile size; `project` cannot, because it is what put the
pixel there.** The five-metre floor went too — that is the WALKING tolerance,
where the instrument is a GPS fix. Somebody who has zoomed right in is doing it
to place a vertex precisely, and a floor drags it onto a fence a hundred pixels
away.

**2. Snapping was not IDEMPOTENT, so a two-click fence came out with three
vertices.** Terra Draw snaps twice for one click — once for the provisional
vertex that follows the pointer, once when the click commits — and it feeds the
second pass the first pass's answer. `snap(snap(p))` has to equal `snap(p)`.

It did not, and the cause was the feature's own best idea: **a corner outranks a
run.** A point sitting exactly on a fence, re-snapped, jumps to that fence's
nearest corner. So the two passes landed in different places and BOTH ended up
in the line — the middle one nine metres from anywhere anybody clicked.
`ALREADY_JOINED_M` fixes it: a point within a centimetre of any candidate has
already joined, and is left alone. **It has to test the NEAREST hit, not the
preferred one** — a point on a fence four metres below its corner has the corner
as its preferred hit, and testing that would decide it had joined nothing.

**3. The op divided a DIFFERENT RING from the one the dialog offered.** The
label said 36.4825 acres. The op divided 36.6253, and two paddock corners came
out 1.43 m past the fence the founder had just been shown.

**An enclosure is not a function of its bounding fences alone.** The op loaded
only the four submitted fences and ran the detector over those — but
`splitAtTouches` cuts a run wherever another run ARRIVES at it, so the lane and
the cross fences landing mid-way along the north fence add vertices to the ring.
Drop those neighbours and the ring changes shape. The client had offered the loop
having seen every line on the parcel; the server has to see them too. The ids
still travel and the polygon still does not — **the ids say WHICH loop, and
everything they are computed from comes out of the database.**

**What the spin proved, on his own 40-acre parcel:** an east and a west fence
drawn with two clicks each, both ends landing exactly on the stored coordinates
of the fences already there — `[-82.47526, 40.40361]` to the digit. The loop
closed, `Inside Fence, South line — 36.4825 acres` appeared in Ground to divide,
four paddocks were laid out in it, and **every corner of all four is inside the
fence** with the paddocks totalling 35.9906 acres — the dialog's figure exactly,
the difference being the lane. Against a **40.1256-acre deed line**: three and a
half acres that the old behaviour would have divided into paddocks and fenced,
outside the wire.

Everything drawn for that was deleted afterwards; the parcel is back to the 15
features it started with.

**Still not exercised: the walk half.** Snapping a walked corner has only ever
run against a stubbed `navigator.geolocation`. A five-metre tolerance against an
instrument that is itself wrong by five metres is a judgement call nothing has
tested outdoors.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `land_parcels` | One row per deed or lease. **`geometry` jsonb since 2a.0**, nullable, unvalidated by the database — every reader goes through `asBoundary` | `tenant_id`, FORCE RLS (`land_parcels_superadmin_all`, `land_parcels_member_all`). CHECKs: `tenure` in `owned\|leased\|crop_share`; `status` in `active\|retired`; name non-blank; area null or **> 0** |
| `land_zones` | Management units inside a parcel. **`geometry` jsonb since 2a.0**, same rules as the parcel's | Composite FK `land_zones_parcel_fk` on `(tenant_id, parcel_id)` → `(tenant_id, id)`, **RESTRICT**, so cross-tenant nesting is unrepresentable and a parcel cannot be deleted out from under its zones |
| `land_zone_uses` | What a zone is for, over a date range | Composite FK to the zone, **CASCADE**. `ended_on` is **INCLUSIVE**; null means current. CHECK `ended_on >= started_on`; `use` matches `^[a-z][a-z0-9_]{0,62}$` (**format only**) |
| `land_occupancy` | What was actually ON a zone, in what structure, and when | Composite FK to the zone, **CASCADE**. `ended_on` inclusive; null means still there, which is what makes a zone read as occupied. `extension_slug` + `occupant_type` + `occupant_id` describe the occupant (P3); `occupant_label` is a **copy**. `area_acres` null means the whole zone |
| `land_zones` (2b.2) | `status` gained **`planned`** — ground a layout proposed and nobody has fenced. Syncs no `dimension_members` row until `activateZone`; refused by `startOccupancy`; excluded from `zoneAtPoint`, rest and every paddock count | Widening the CHECK changed no query: every read that must not see unfenced ground already filtered `active` explicitly. `startOccupancy` was the one guard that had to be added |
| `land_plans` (2b.4) | A named set of proposals and the materials list taken off them. **Laying out a field creates one.** `taken_off_at` null means the figures are still live | **No status column**: its features carry `planned`/`built`/`removed`, so "is it built" is derivable. Composite FK to the parcel |
| `land_plan_items` (2b.4) | One line of a saved list. `source_feature_id` NULL means hand-added — insulators and staples are not in the geometry | Quantities are a **SNAPSHOT**; the drawing may drift and nothing corrects either, the `area_acres` rule. CHECKs: `unit` in `each\|ft\|m`; quantity > 0; `unit_cost` null or ≥ 0. **`saveTakeoff` refuses a counted line with no source**, or it would survive every re-take and double the order |
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
  `geometryLengthM`. Since 2b.5 it also owns the **local equirectangular frame**
  (`frameAt`/`toLocal`/`fromLocal`), which was private to `subdivide.ts`:
  snapping, enclosure detection and subdivision all have to agree what a metre
  is, and a second nearly-identical projection is how they would stop agreeing.
  Nothing REPORTED comes from the frame — lengths are haversine and areas are
  spherical, so a shape cut in the frame and measured anywhere else agree
- `src/packs/land/core/length.ts` — pure. The sibling of `area.ts`, with one
  difference: **length has no canonical store.** Nothing writes a length, so
  there is no `toMetres` matching `toAcres`; it is computed from the geometry
  every time it is shown
- `src/packs/land/components/zone-table.tsx` — the paddocks on a parcel, with the
  same filter/sort/select as the plan list and one deliberate difference: **the
  bulk act is RETIRE, not delete.** A fence you pull out is gone; a paddock you
  stop managing has a history and costs tagged to it. Deleting ground is
  `discardZones`, on the Proposed panel, and it only ever touches proposals.
  Retired rows are shown by a filter and have neither a tick nor a menu
- `src/packs/land/components/feature-list.tsx` — the plan's inventory: filter by
  kind and state, sort on any column, tick rows and delete them together. Split
  out of `site-plan.tsx` in 2b.6 — the parent keeps only the thing genuinely
  shared with the map, which is which feature is selected. **The delete count is
  narrowed to what is currently listed**, so a filter change can never leave a
  tick counting towards something off screen
- `src/packs/land/core/weather.ts` — pure. Degree days, season accumulation, the
  comparison against the same window in previous years, and the rain figures.
  **Gaps are counted, never filled**, and a degree day is scaled but not
  offset when it changes unit. The base and the unit come from `packConfig`
- `src/packs/land/weather-service.ts` — the pack's SECOND fetch, and the same
  rules as `parcel-lookup-service.ts`: server-only, built URL, timeout, and a
  day-long revalidate because a day that has happened never changes. The
  centroid is rounded to about a hundred metres, which is what makes the cache
  work across parcels on one farm
- `src/packs/land/core/navigate.ts` — pure. Bearing, compass point, the trend,
  and **arrival judged against the live accuracy rather than a fixed distance**.
  `targetsOf` turns a geometry into the ordered list of places to stand: the
  vertices are the posts, and a ring's closing repeat is dropped. It knows
  nothing about units — the radius arrives already formatted
- `src/packs/land/components/navigate-panel.tsx` — the field screen, opened by
  **Take me there** on any drawn feature. Not owner-gated: the person setting
  the posts is often not the person who drew them. Watches only while it is
  open, the rule `walk-panel.tsx` set, and every `setState` happens inside the
  fix rather than in an effect
- `src/packs/land/core/snap.ts` — pure. Moving a placed point onto whatever is
  already drawn. **A corner outranks a run even when the run is nearer**, which
  is the difference between a lane that meets the fence and one that stops a
  metre short of the corner. Two tolerances: metres for walking (one GPS fix),
  pixels-at-the-current-zoom for tapping (a finger is wrong by pixels, not
  metres). It moves a coordinate and nothing else — there is no shared-vertex
  table and no cascade, deliberately
- `src/packs/land/core/enclosure.ts` — pure. The loops fence lines make, as
  ground you can divide. Fences are **cut where another fence arrives at them**,
  or a cross fence divides nothing; a run that closes on itself is a field
  without needing the graph at all. Reads any drawn LINE that is not `removed`,
  not a list of kinds — a hedge stops stock as well as wire does
- `src/packs/land/core/features.ts` — pure. Feature kinds, per-kind symbology,
  the status styles, and `featureKindsFrom` for a profile's own words.
  **Industry-neutral (ADR 0004): no `trough`, no `energizer`** — those come from
  `packConfig.land.featureKinds`, and an unknown kind draws with the fallback
  for its shape
- `src/packs/land/components/site-plan-map.tsx` — the site plan, and **the only
  map in the pack since 2026-08-29**. The kind picker is where everything
  drawable lives: the parcel's outline, **a new paddock**, any paddock with no
  shape yet, then the feature kinds. Drawn paddocks are CLICKED on the map;
  undrawn ones are listed, because there is nothing to click (`boundary-map.tsx` is deleted). It draws
  the parcel's outline AND any paddock's — a paddock is chosen by clicking it,
  because a farm at 10x has two hundred and they do not belong in a picker: it draws the parcel's own boundary
  too, at the top of the kind picker, owner-only and always an area. A basemap
  toggle, a shape picker, tap-or-walk input, and Terra Draw in
  point/line/polygon modes.
  **The map handlers read the draw mode from a REF**, because they are
  registered once and would otherwise close over the mode at creation
- `src/packs/land/components/plan-legend.tsx` — the key. Only the kinds
  actually on this parcel, drawn from the same `featureStyle` the map uses
- `src/packs/land/core/survey.ts` — pure, and deliberately free of `navigator`
  so every decision in it is testable without a browser: corners per shape,
  ring closing, accuracy bands, the mis-tap guard. **`walkToGeometry` is what
  makes walking an INPUT MODE rather than a second kind of feature**
- `src/packs/land/components/walk-panel.tsx` — the live fix, the accuracy
  figure and the drop button. It watches only while it is open, and it assumes
  geolocation exists because the button that opens it checked
- `src/packs/land/core/subdivide.ts` — pure. Equal-area strips cut across a
  lane, in a local flat frame because degrees are out by the cosine of the
  latitude. **The cuts are all parallel**, which makes the design's
  crossing-on-a-bend case impossible rather than detected; what replaces it is
  a reachability check, because a paddock the cows cannot walk to is the
  failure the layout exists to prevent. **THE LANE IS A CORRIDOR**: its own
  ground is clipped out first, so a divider starts at the lane fence and can
  never cross it. `compareLayouts` costs one-side against both-sides on the
  same geometry, and the deciding figure is fence per acre
- `src/packs/land/components/paddock-layout.tsx` ·
  `planned-zones.tsx` — the dialog, and the list of ground waiting for a fence.
  **There is no separate preview: the proposals ARE the preview**
- `src/packs/land/core/takeoff.ts` — pure. What a plan takes to build, counted
  off the shapes. **It never guesses a missing figure**: a fence with no
  `post_spacing` produces a note, not a post count off a default nobody chose.
  The generic point-is-one / line-is-its-length rules are what let a profile's
  own kind be counted without this file learning the word
- `src/packs/land/components/plan-takeoff.tsx` — the saved list against what the
  drawing says now, side by side and neither corrected
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

- **Weather predicts nothing yet, on purpose.** Slice 3 reports the season and
  the comparison; the brief's *"16 days, not 21"* needs a regrowth model, and
  that needs ground somebody has measured. The data now accumulates whether or
  not anybody is watching, which was the point of shipping the reporting half.
- **No upper cap on the daily high in the GDD sum.** Uncapped is a published
  convention and capped at 30C is the corn one. It will show as a gap against a
  local figure in a hot month; the fix is a config line beside `gddBaseC`.
- **Nothing uses weather except the parcel page.** Rest targets, the rotation
  finding and the crops pack all have an obvious use for it and none of them
  read it yet.
- ~~Nobody has watched a point snap~~ — **closed the same day.** Driven on
  Hilltop Farm and it found three bugs, all invisible to a green suite: a
  tolerance 256x too small so nothing snapped at all, a non-idempotent snap that
  left a stranded vertex in every line, and an op dividing a different ring from
  the one the dialog offered. See the build log.
- **NOTHING THAT READS A PHONE'S POSITION HAS BEEN DRIVEN BY A REAL PHONE SINCE
  2b.1**, and that now covers two slices. Walk-mode snapping (2b.5) and the whole
  of navigation (2b.3) have only run against a stubbed `navigator.geolocation`,
  so the arithmetic is proved and the FEEL is not. Two judgement calls are
  waiting on one walk: whether `SNAP_TOLERANCE_M` grabs corners nobody meant, and
  whether arriving inside the accuracy circle reads as "you are on it" or as "it
  lost me".
- **A point is snapped on SAVE, not while it is placed.** `TerraDrawPointMode`
  takes no `snapping` option, so a gate jumps after you commit it rather than
  under the cursor. It is the only moment available and it is the wrong one.
- ~~Enclosure detection has only run on squares~~ — **closed 2026-08-30.**
  `tests/land-real-fields.test.ts` runs it over an L-shaped field with a reflex
  corner, fences that overshoot at the corners, a fence following a creek, and
  two fields sharing a middle fence. All passed first time. **The graph walk
  still finds *a* loop per fence rather than a guaranteed-simple polygon**, so a
  deliberately self-crossing fence could still yield a ring nobody wants; it is
  visible on the map before anything is built, which is the mitigation.
- **A fenced area cannot be turned into a zone directly.** You can divide it;
  you cannot say "this loop is North Pasture" in one act. Drawing the paddock
  by hand still works, so this is a shortcut rather than a gap.
- **A retired paddock still cannot be un-retired, and now a discarded one is
  simply gone.** 2b.6 added the delete that proposals needed; it deliberately
  did not touch retirement, which stays one-way. The asymmetry is defensible —
  a proposal has no history to lose — but "discard" and "retire" sitting a
  centimetre apart on the same screen is worth watching somebody use.
- ~~Nothing bulk-acts on paddocks~~ — **closed the same day, in 2b.7.** The
  paddock table has the same filter, sort and multi-select; its bulk act is
  RETIRE rather than delete, for the reason that slice's entry gives.
- **No bulk entry, still.** Twenty paddocks is twenty dialogs. 2b.6 and 2b.7
  made it possible to get RID of things in bulk and left creating them one at a
  time — which is the half that a farm at 10x hits first.
- **The takeoff has never priced a real order.** 2b.4 was driven with a made-up
  42-cent insulator; nothing has been bought off one of these lists, so nobody
  has yet found the material it cannot count or the unit it does not have.
- **Nobody has looked at a proposed paddock on the map.** 2b.2's planned-ground
  layers were verified through the DOM and the data — the browser pane stopped
  painting WebGL partway through the session. The layer code is the same shape
  as the feature layers beside it, but that is an argument rather than a
  screenshot.
- ~~The layout has only ever been run on a rectangle~~ — **closed 2026-08-30,
  and it was hiding a real bug.** The count was split evenly between the sides
  of the lane whatever they weighed, so any lane that is not down the middle
  gave unequal paddocks under a dialog promising equal ones. Fixed by
  apportioning on area; see the build log.
- **A lane's two sides still cannot always be equal**, and now the layout says
  so instead of averaging it away. Both sides get at least one paddock, so a
  small count against lopsided ground has a floor on how equal it can be.
  `EQUAL_ENOUGH` decides when to mention it.
- ~~Nothing has been walked with a real phone~~ — **CLOSED 2026-08-29.** The
  founder walked a property's four corners in a field and reported it worked
  perfectly. That is the correlated-error assumption the whole of 2b.1–2b.4
  rests on, tested on real ground rather than argued for. **2b.3 is unblocked.**
  The same walk found that four corners made three sides, fixed the same day.
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
