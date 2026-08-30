# Land — build log archive

> Older build-log entries for the Land pack, moved out of [`land.md`](./land)
> so the dossier stays readable. **Nothing here is superseded** — it is the
> record of how the pack got built, from parcels and dated zone use through the
> map, the county parcel finder, occupancy and rest, and the whole 2b site-plan
> arc. The dossier itself carries the recent entries, the designs, the data
> model, the decisions and the open items.
> Status: `archive` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

Newest first, the same order as the dossier. Swept on 2026-08-30, when
`land.md` had reached 2,969 lines with two thirds of it build log — the
threshold AGENTS.md names, and land is the most actively worked area in the
repo, so it was paying that tax more often than anything else.

**The designs did not move.** *The site plan* and *The paddock layout* sections
stay in the dossier, because they are read before work rather than after it.
What moved is the narrative of sessions already shipped.

### 2026-08-29 — You could not draw a paddock (`claude/draw-a-paddock`)

**No migration.** The founder went looking for how to create a paddock on the
site plan and could not find it. He was right: there was no such option, and one
of the routes that should have substituted for it **was broken by "The last
map" earlier the same day.**

**WHAT THE THREE ROUTES ACTUALLY WERE**

1. **Divide into paddocks** — the subdivision dialog. Works, but lives in the
   Paddocks section rather than on the plan, and needs a LANE drawn first.
2. **Add paddock** — creates a zone with a name and no geometry.
3. Give that one a shape… and there was no way to. `groundCollection` skips a
   zone whose boundary it cannot read, so **an undrawn paddock never rendered on
   the site plan and could never be clicked** — and the zone page had just lost
   its own map on the promise that outlines are traced on the plan. The only
   remaining path was pasting GeoJSON.

That is a regression introduced by the map consolidation: it moved zone tracing
to the plan without checking that a zone with no shape is reachable there. It
is not.

**THE FIX, in two parts**

- **`A new paddock` in the kind picker.** Draw it or WALK it, exactly like the
  parcel's boundary, and it is created with that outline in one act. Owner-only,
  because a zone becomes a cost object. `createZone` now takes a `geometry`, and
  **the drawn acreage becomes the recorded acreage** — the rule
  `layoutPaddocks` already follows, and the one place this pack departs from
  declared-versus-computed. A typed figure still wins; the drawing only fills a
  gap.
- **Undrawn paddocks are LISTED in the picker.** Drawn ones are clicked on the
  map; ones with no shape have nothing to click, so they appear as
  `North Pasture — not drawn yet`. Listing only the undrawn ones is what keeps
  that list short — a farm with two hundred paddocks has them all on the map and
  none of them here.

**The name is asked for BEFORE drawing, not after.** Prefilled with the next
number and editable. The walk version of this ends with somebody standing in a
field having just walked four corners, and a modal asking for a name is the
worst possible moment for one.

**A React Compiler bail-out fixed on the way.** `save`'s dependency list had
grown to include a display name derived from the `zones` array, and the compiler
skipped optimising the whole component rather than trust it. The toast now
builds its text from primitives and the suggested name is memoised on the COUNT.
Worth knowing: `npx eslint` reports these as errors, and a green `tsc` and build
will not.

**AND `Divide into paddocks` MOVED ONTO THE PLAN**, asked for in the same
conversation. It had been sitting in the Paddocks list four sections below the
map, replaced by a grey sentence whenever no lane was drawn — so the founder
went looking for it on the site plan twice and could not find it. That is the
right instinct: everything else that makes a shape happens there. **Moved, not
duplicated**, so there is one place to look and one thing to keep working. What
stays in the list is `Add paddock`, for one whose shape comes later.

**Tested:** three new ops cases — created with an outline, a typed acreage
winning over the drawn one, and an unreadable outline refused in the parser's
own words. 121 db-backed and 2,258 pure pass.

**Not driven in a browser.** The dev server lost its Clerk session again and
signing back in would mean handling the founder's credentials. The ops path is
covered; the picker entry and the name field are read-and-build-verified only,
the same limit the design-system dossier records for having no component-test
stack.

### 2026-08-29 — Four corners were three sides (`claude/close-the-loop`)

**No migration.**

**FIRST, THE OPEN ITEM THAT HAS BEEN AT THE TOP OF THIS FILE SINCE 2b.1 IS
CLOSED.** The founder took the boundary tool into a field on a real phone and
walked a property's four corners. In his words: *"it worked perfectly."*

That is the assumption the whole 2b.1–2b.4 direction rests on — that a line
WALKED and later navigated back to with the same phone is wrong in much the same
direction twice, where a traced line and a GPS position are wrong independently
and their errors add. It has now been tested on real ground rather than argued
for, and **2b.3 (navigate to a point) is no longer waiting on anything.**

**AND THE SAME WALK FOUND A GAP.** He also walked a fence round all four corners
and got **three sides**. A LineString of four positions has three segments; the
closing side is the one you cannot walk, because you would have to arrive back
at a corner you have already left and no two GPS readings of the same spot
agree.

His framing was exactly right — *"That might be right sometimes, but there
should be an option"* — so it is a choice and not a default:

  - `canClose(points, shape)` is true only for a LINE with **three or more**
    corners. An area closes itself already; a two-corner line "closed" is A→B→A,
    a fence walked out and back along its own length, which would double every
    figure counted off it.
  - `walkToGeometry(points, shape, closed)` appends the FIRST position rather
    than a second reading of it. A closed fence meets itself exactly, and a
    metre-wide gap in the drawing is a metre of wire nobody buys.
  - **It stays a LineString.** A ring of fence is a line that comes back. Making
    it a Polygon would give it an area nobody asked for and would make
    `geometryLengthM` report a perimeter — the same number here by luck, and not
    the same thing. The takeoff buys wire against that figure.
  - The checkbox appears in the walk panel once there are three corners, and
    says the real counts: `4 sides from 4 corners` against `3 sides from 4
    corners`, computed rather than worked as an example.

**Tested, and the gap in that.** Eight new cases in `tests/land-survey.test.ts`
cover the closing side being taken from the first corner, the length including
it, the refusal to close two corners, and the shape staying a LineString.
**The UI wiring — checkbox to state to geometry — is not tested**, because the
repo still has no component-testing stack; it is verified by reading and by a
green build, the same limit the design-system dossier records.

**Not driven in a browser either.** The dev server was restarted during the
session and the browser lost its Clerk session; signing back in would mean
handling the founder's credentials. The arithmetic is the part that matters here
and it is covered.

### 2026-08-29 — The last map (`claude/the-last-map`)

**No migration. `boundary-map.tsx` is deleted.** There is now exactly one map in
the pack, and it is the site plan.

**The founder asked why the zone page still had one.** The honest answer was
that the previous slice fixed the page carrying TWO and left alone the page
carrying one — which is not a reason, it is where the line happened to fall. A
paddock's outline is the same act on the same geometry as a parcel's, so it
belongs in the same tool.

**A paddock is chosen by CLICKING IT, not from a list.** The parcel is a
singleton and fits in the kind picker; paddocks are many, and a farm at 10x has
two hundred. So the zone id travels with the shape in the ground source, the
click handler falls through to the ground layers when nothing is on top, and
selecting one switches the picker to `North 4's boundary`. Clicking a paddock
and having the picker stay on "Fence" would make the click look like it did
nothing.

**What the zone page kept, and what it lost.** Gone: the map, the sibling-zone
query that only ever fed it, and `context`/`packConfig` props that existed for
no other reason. Kept: the READING — measured against recorded and the sentence
about why they may disagree — plus the paste box, and a line saying where the
outline is drawn now.

**A bug the change surfaced.** Tracing a paddock compared its acreage to the
PARCEL's recorded figure: `2.3318 acres · −37.6682 acres against the 40 acres
recorded`. The comparison had been wired to the page's parcel because until this
slice the only thing traced here WAS the parcel. It now measures against the
target's own figure — `−7.5224 acres against the 9.8542 acres recorded` — which
is the only version of that sentence that means anything.

**Driven on Hilltop Farm.**

  - Zone page: **zero maps**, reading intact, and it points at the site plan.
  - Parcel page: **one map**, and the boundary panel above it reads
    `measures 40.1256 acres` against `Recorded 40 acres`.
  - Clicking a proposed paddock switched the picker to `North 4's boundary` and
    offered Trace / Move the corners.
  - Walking four corners saved to **the zone** — North 4's drawn geometry
    became 2.3318 acres while its recorded figure stayed 9.8542 and the other
    three paddocks and the parcel were untouched. The declared-versus-drawn rule
    holds for a zone exactly as it does for a parcel.

**Demo data note:** Home Farm's `North 4` is left as the small square walked
during that test, rather than the strip the layout cut. It is the clearest
possible illustration of drawn disagreeing with recorded, so it stays.

**Open after this slice:** unchanged. Nothing has been walked with a REAL phone.

### 2026-08-29 — One map for the whole parcel (`claude/one-map-for-the-whole-parcel`)

**No migration.** The parcel's own boundary is drawn in the site plan now, and
the second map on that page is gone.

**THE FOUNDER'S ASK, and it was two things that turn out to be one.** He wanted
to walk the four corners of a property with GPS pins, and he wanted the boundary
tool folded into the site plan *"so there are not 2 maps being displayed"*.
Walking already worked for features (2b.1); it only ever needed the boundary to
be a thing this map could draw. Fold that in and the second map has no job left.

**Why this map and not the other.** The parcel page carried two. The site plan
was always the stronger — basemap toggle, symbology, shape picker, and since
2b.1 the ability to WALK a shape rather than trace it. Keeping a weaker map
beside it to do one job was asking somebody to learn two tools for one act.

**The boundary sits in the KIND PICKER**, at the top, as `Home Farm's boundary`
— because from the founder's side that is what it is: another thing you draw on
this map. Selecting it:

  - **hides the shape picker.** A boundary is an area, always. Offering the
    choice would be offering a parcel whose outline is a single point, and every
    acreage in the pack would then divide by zero.
  - **hides the built/proposed toggle.** A deed line is not a proposal.
  - **is owner-only** while features stay member-write. Drawing the fence you
    just built is a chore; the outline is what the deed says and what every
    per-acre figure divides by.
  - routes Save to `setParcelBoundaryAction`, which REPLACES rather than
    creating and has its own audit entry.

**The reading survived, which was the point of keeping it.** `BoundarySummary`
gained a `withMap` prop and the parcel page passes false. What stays is measured
against recorded, the sentence about why they may disagree, and the paste box —
a county GIS export is more accurate than anything traced by hand, and it is now
the side door to a front door that lives somewhere else. **The zone page is
untouched**: one map there, and it is the only one.

**And the live comparison moved with it.** Tracing or walking a boundary now
leads with ACRES rather than feet and shows the deed's figure beside it while
the corners are still moving — `40.1256 acres · +0.1256 acres against the 40
acres recorded`. That was the old map's best trick and it is more use before you
save than after. It reports and never corrects, the rule since 2a.0.

**Two bugs, both found by driving it**

- **Four walked corners came out as a single dot** saying "Placed where you are
  standing". `startDrawing` has two branches, and only the TAP one had been
  taught that the boundary is an area; the walk branch asked `shapeOfKind`
  about a value that is not a kind, got `point` back, and `walkToGeometry`
  faithfully built a Point from the first corner.
- **The save silently did nothing.** `setParcelBoundaryAction` takes
  `geojson` as a **JSON string**, not a geometry object — it was written for the
  paste box, where what arrives is text copied out of a county export, and
  `parseBoundary` reads either. Passing the object failed Zod and returned a
  generic "Check the details and try again" that is easy to miss in a toast.
  Worth remembering: **a silently-rejected action looks exactly like a
  successful one if nobody reads the toast.**

**Driven on Hilltop Farm.** Four corners walked with plausible phone accuracies
(±12 to ±18 ft), the readout tracking `4 corners walked · worst ±18 ft`, the
live figure `40.1256 acres`, and after saving the panel reads
`Boundary · measures 40.1256 acres` against `Recorded 40 acres` — the same
number that was on screen while walking. **One map on the page.**

**Housekeeping:** Hilltop Farm's `North Pasture` zone was deleted by an earlier
cleanup in this session whose `North %` pattern matched more than intended. Dev
branch only, and the parcel now carries the laid-out paddocks instead.

**Open after this slice:** unchanged. Nothing has been walked with a REAL phone,
which is the one that matters and the one 2b.3 waits on.

### 2026-08-29 — Slice 2b.4: what it will take (`claude/what-will-it-take`)

**Migrations `0237`** (`land_plans`, `land_plan_items`, `land_features.plan_id`)
**and `0238`** (their RLS), applied to dev and production before the merge.
2b.3 is skipped for now: navigating to a point still waits on somebody walking a
tree line with a real phone.

**A takeoff is arithmetic on a shape you drew**, which is the whole of the line
between it and the optimizer this pack refuses. Every number can be checked by
looking at the drawing and doing the division: 650.8 ft of fence ÷ 8 ft spacing
= 81 spans + 1 = 82 posts. Nothing decides anything.

**IT NEVER GUESSES A MISSING FIGURE, and that is the design.** A fence with no
`post_spacing` recorded produces a NOTE saying so, not a count off a default
nobody chose. "164 posts" from a spacing nobody set is a made-up number wearing
a decimal point, and it would be ordered from. This is also the first thing in
the pack that READS the attribute bag rather than displaying it — the bag is
only worth having if what comes out is what somebody put in.

**What shipped**

- **`core/takeoff.ts`**, pure and testable without a database. Per-feature
  lines, totals by material, drift, and per-line cost.
- **A plan is a named set of proposals**, and **laying out a field now creates
  one** with every fence and gate it drew attached. A plan is exactly "a set of
  proposals costed together", and making somebody create one and then attach
  twelve features would be asking them to restate what the app already knew.
  The lane is NOT attached: it was there first.
- **The generic rules are what make it work for a kind the pack has never heard
  of.** A point is one of the thing; a line is its length. Both restate the
  drawing rather than inventing anything, so a profile's `trough` or
  `energizer` is counted without this file learning the word (ADR 0004). An
  AREA gets nothing — there is no generic material in an acre.
- **Lengths come out in the tenant's own unit**, because this is a list to
  order from, and `post_spacing` is read in that same unit — it is a figure
  somebody typed on a screen labelled in it.

**Decisions worth knowing**

- **The saved list is a SNAPSHOT and the drawing may drift from it.** Not a new
  rule: `land_parcels.area_acres` has worked this way since 2a.0. You ordered
  from 3,906.9 ft of wire; somebody has since put a fourth strand on one run;
  the screen shows both and corrects neither. Recomputing on read would silently
  rewrite what you bought from.
- **`saveTakeoff` REQUIRES every line to name the feature it was counted off.**
  The replace-on-re-take finds counted lines by asking which have a source, so
  a counted line arriving WITHOUT one would survive every re-take and quietly
  double the order. Requiring it makes the two paths unambiguous: counted lines
  through `saveTakeoff`, hand-added ones through `addPlanItem`. **Found by a
  test that saved sourceless lines twice and got two of everything.**
- **A unit cost is what you typed, on that line, on that day — never a
  catalog.** The moment there is a price list there are vendors, quotes and
  effective dates, and this has quietly become purchasing.
- **Null cost, not zero.** Zero is a thing that is free.
- **Deleting a plan leaves its features standing.** Deciding not to proceed with
  a proposal is not deciding that the fence you already built as part of it
  never happened; the link is cleared and the features stay.
- **Owner-only throughout**, the line `layoutPaddocks` already drew. The one act
  in this area a person in a field performs is marking a feature built, and that
  stayed member-write where it was.

**A bug found by driving it.** A hand-added line of insulators showed **"Now: 0
each"** next to its saved 300 — because drift compares the saved list against
the COMPUTED one, and nothing computes insulators. That reads as "you do not
need any of these any more" rather than "this one is not counted off anything".
Hand-added materials are now excluded from the drift and the column says
**"typed in"**.

**Driven on Hilltop Farm.** Four paddocks laid out, which created the plan:

  - `Fence 3,939.2 ft` — **exactly the figure the layout dialog predicted**
    before anything was written — and `Gate 4 each`
  - every fence noted as needing a `post_spacing` and a `wire_count`
  - giving the two divisions 8 ft and 3 strands turned those notes into
    `Posts 164 each` and `Wire 3,906.9 ft`, both checkable by hand
  - saved; every row then read `same`
  - a fourth strand on one division moved wire to `4,558.05 ft` with the saved
    figure untouched and the button changed to "Take it off again"
  - 300 insulators at $0.42 added by hand: `$126.00`, and the total line

**Open after this slice:** unchanged and now three deep — nothing walked with a
real phone (which is what 2b.3 waits on), nobody has looked at a proposed
paddock on the map, and the layout has only ever run on a rectangle. None of
these is code; all three need somebody in a field.

### 2026-08-29 — The lane is a corridor, not a line (`claude/the-lane-is-a-corridor`)

**No migration.** A bug fix and a choice, both in `core/subdivide.ts`.

**THE BUG, FOUND BY THE FOUNDER ASKING A DIFFERENT QUESTION.** He asked whether
the layout reuses the existing perimeter and only runs divider wire — it does,
`n − 1` cuts and no boundary. Checking his data to answer that turned up
something worse beside it. On Home Farm:

```
Centre lane        lon -82.47763 → -82.47763
North division 1   lon -82.48000 → -82.47526
North division 2   lon -82.48000 → -82.47526
North division 3   lon -82.48000 → -82.47526
```

**Every divider ran straight through the lane.** Three fences built across the
walkway the cows use to reach water — the exact opposite of the rotation the
whole design was for. And a strip that spanned the lane was recorded as ONE
paddock when it is physically two, with its gate dropped in its own interior
opening onto nothing.

**The cause was a modelling error, not an arithmetic one.** 2b.2 used the lane
only for its DIRECTION. A lane occupies ground and has to stay passable, and
nothing in the algorithm knew that.

**The fix: the lane's corridor is clipped OUT of the ground first**, in every
layout. What is left is one side of it or two, and that is the whole of the
difference between the two placements. Dividers are then cut from each side's
own ring, so they start at the lane fence and cannot reach across it. Gates go
ON the lane fence at the middle of each paddock's frontage.

**Both placements, costed side by side — the founder chose "both".**

  - **`edge`** — paddocks on the larger side only, one run of lane fence
    (the far side is the perimeter already there), and a warning naming the
    acres left out of the rotation.
  - **`split`** — paddocks both sides, two runs of lane fence.

**BOTH GIVE THE PADDOCK COUNT YOU ASKED FOR**, which is what makes them
comparable: the difference is how much GROUND those paddocks cover and how much
fence it takes. **The deciding number is FENCE PER ACRE** — total fence always
favours whichever layout does less and acres always favour whichever does more,
so only the ratio says which is the better deal. `compareLayouts` runs both from
the real geometry and the dialog recomputes as the numbers are typed, using the
same function the server will run.

On Home Farm, four paddocks off the centre lane: one side gives 19.7 acres at
4.93 each for 3,272 ft of new fence; both sides give 39.4 acres at 9.85 each for
3,939 ft. **Twenty per cent more fence for twice the ground.**

**One more thing the corridor broke and had to fix.** `clipHalfplane` cuts with
an INFINITE line, so the corridor spans the whole field however short the lane
is — which meant a lane covering the bottom fifth handed every paddock a gate
onto a stretch of "lane fence" with no lane behind it. The reachability check
now also tests that the gate falls within the lane's actual extent along its own
axis. That is what restored the warning the test was written for.

**Driven on Hilltop Farm.** The old layout was deleted first, because the fences
in it ran through the lane. The new one:

```
North lane fence 1   lon -82.47760          (east side of the corridor)
North lane fence 2   lon -82.47766          (west side)
North division 1     lon -82.47760 → -82.47526   (all east)
North division 2     lon -82.48000 → -82.47766   (all west)
North 1..4 gate      on the lane fences, not in any paddock's interior
```

Four paddocks at 9.8545 / 9.8542 / 9.8545 / 9.8542 acres, 39.4174 in total —
the field's 39.9016 less the corridor, and exactly the figure the dialog
predicted before anything was written.

**Open after this slice:** unchanged from 2b.2 — nothing walked with a real
phone, and the layout has still only been run on a rectangle. A real field with
a bent lane is where the corridor's single mean offset will first show its
limits: a lane that wanders is being straightened by that average.

### 2026-08-29 — Slice 2b.2: four paddocks off a lane (`claude/four-paddocks-off-a-lane`)

**Migration `0236`** — `planned` joins `land_zones.status`. One CHECK, applied to
dev and production before the merge.

**`core/subdivide.ts`** is the whole of the geometry and is pure. Everything
below is a decision recorded there.

**The lane is what makes the problem well posed.** "Divide a polygon into n
efficient pieces" is badly posed — efficient by area, by fence length, or by
shape? Those fight, and an answer to one is a bad answer to the others. **Every
paddock has to touch the lane**, because that is how the cows reach water, and
that single constraint collapses the search to parallel strips cut across it:
one direction, n−1 cuts, equal area each, found by bisection on the offset.

**THE DESIGN'S FIDDLY CASE WAS DISSOLVED RATHER THAN SOLVED.** It said to cut
perpendicular to the lane's LOCAL direction and to detect two cuts crossing on
the inside of a bend. Cutting perpendicular to the lane's OVERALL direction
makes crossing impossible — parallel lines do not cross — so there is nothing to
detect. What is given up is a fence meeting a bent lane at an angle rather than
square, which is visible and draggable. What replaced the crossing check is a
REACHABILITY check: every strip is tested for whether the lane actually runs
through it, because a bent lane can strand one, and a paddock the cows cannot
walk to is the failure this layout exists to prevent. It warns; it never
refuses.

**All the arithmetic is in a local flat frame.** Clipping and area-splitting in
degrees would be out by the cosine of the latitude — about 24% at 40°N — so a
"square" paddock would come out a quarter wider than it is tall and the
equal-area search would divide the wrong quantity. Equirectangular about the
shape's own centre is accurate to millimetres across a farm. **The REPORTED
acreage still comes from `boundaryAreaAcres`**, the spherical one the rest of
the pack uses, so a paddock cut here and measured anywhere else agree.

**The founder's correction, built as he asked for it.** The layout creates the
PADDOCKS and their fences and gates in one act. An earlier design had it emit
fences only, with zones created once a fence was built — which did not remove
the problem of inferring what a ring of fences encloses, it deferred it to the
worst possible moment. The layout already knows the polygons; it computed them.
And a paddock boundary is not always a fence — a creek, a road, a bluff — so
zone geometry and fence geometry are two objects that often coincide and need
not.

**`planned` on `land_zones`, and what it cost**

Widening the CHECK changed no existing query, which is worth knowing because it
easily could have: every read that must not see unfenced ground —
`zoneAtPoint`, `zoneCountsByParcel`, `mappedZoneCount`, `retireParcel`,
`combineParcels` — already filtered `status = 'active'` explicitly rather than
"not retired". **The one guard that had to be ADDED is `startOccupancy`'s**,
which never looked at zone status at all and would have put animals on a paddock
whose fence nobody has built, feeding the rest clock and every per-acre figure
downstream from ground that does not exist.

A planned zone syncs **no** `dimension_members` row. `activateZone` is what
creates it, and it is owner-gated because `upsertDimensionMember` requires it —
the same constraint that makes `createZone` owner-only, arriving later because a
planned zone deliberately skipped it.

**Decisions worth knowing**

- **THE DRAWN ACREAGE IS THE RECORDED ACREAGE, and this is the one place that
  differs from a parcel.** A parcel has a deed and a county record to disagree
  with, so `area_acres` is DECLARED there and the drawing may differ. A paddock
  has no external source — you decided where the fence goes — so the drawing IS
  the record, and a declared-versus-computed split would invent a disagreement
  with nothing on the other side of it.
- **Laying out is OWNER-ONLY**, unlike the rest of the feature surface. Drawing
  a fence is a chore; deciding that this field is four paddocks is not, and they
  become cost objects the moment they are activated.
- **There is no separate preview, and that is the point of `planned`.** What the
  dialog produces is proposed paddocks and proposed fences, ghosted on the plan
  like any other proposal — so the preview IS the result, and adjusting it means
  dragging a fence rather than re-running a dialog with different numbers.
- **Activation is per paddock**, because fences go in one at a time and marking
  four built because you finished the first is how the map stops matching the
  ground. Idempotent, because two people can walk a fence in together.
- **Proposed paddocks get their own list, not a row in the paddock table.** That
  table's columns are about ground you are using — what is on it, how long it
  has rested — and every one of them is meaningless for unfenced ground. A
  planned row there would show four dashes and read as a broken paddock rather
  than an unbuilt one.
- **The page reads planned zones separately rather than widening the existing
  read.** Rest, the paddock count, the rotation arithmetic and `zoneCoverage`
  are all about ground that exists; folding planned rows into `zones` would put
  unfenced acres into all of them at once.

**A bug this slice surfaced in 2b.0's own screen.** The length total counted a
POINT as "not drawn" — so four gates dropped exactly where they belonged were
announced as "4 not drawn". A gate HAS no length; a fence that has not been
traced is MISSING one, and only the second belongs in that count. Points are now
left out of the total rather than counted as unknown.

**Driven on Hilltop Farm's Home Farm.** Four paddocks off a centre lane came out
at 9.9756, 9.9755, 9.9753 and 9.9752 acres — **summing to 39.9016, which is
exactly the parcel's own measured area** — with three dividing fences at the
field's full 1,318 ft width and four gates on the lane, everything `planned`.
The paddock table and the coverage figures did not move. Activating one moved it
into the table with its acreage and dropped the proposed count to three.

**The map's screenshots could not be captured this session** — the browser pane
stopped painting WebGL after many reloads — so the planned-ground layers were
verified through the DOM and the data rather than by eye. The layer code is the
same shape as the feature layers beside it, but **nobody has looked at a
proposed paddock on the map**.

**Open after this slice:** still nothing walked with a real phone (2b.1's open
item, and 2b.3 depends on it more than this did), and the layout has only been
run on a rectangle — a real field with a bent lane will be the first honest test
of the reachability warning.

### 2026-08-29 — Slice 2b.1: walk it, do not trace it (`claude/walk-the-fence-line`)

**No migration.** Walking a shape onto the map produces the same geometry the
tap path already produced, which is the whole claim of the slice and the reason
it needed no schema.

**`core/survey.ts`** is where the decisions live, and it is deliberately free of
`navigator` so every one of them is testable without a browser: how many corners
a shape needs, what closes a ring, which accuracy band a fix falls in, and what
counts as a mis-tap.

**What was built**

- **An input mode, not a second kind of feature.** `Tap the map` / `Walk it`
  sits beside the kind and shape pickers. `walkToGeometry` turns walked corners
  into the same `FeatureGeometry` the draw tool emits, so the validator, the
  action, the audit entry and the symbology are all reached by exactly one path.
  The test that matters asserts precisely this: every shape a walk can produce
  passes `validateFeatureGeometry`.
- **Three corners make a paddock, not four.** The closing repeat is added by
  `closeRing`. Asking somebody to walk back to their first corner and tap it a
  second time is asking them not to bother.
- **The accuracy figure is part of the instruction.** `formatAccuracy` rounds
  UP — the one length in the pack where erring generous is the wrong direction,
  because "±3 m" for a 3.4 m fix claims more than the instrument gave. Bands at
  5 m and 20 m colour the readout and **nothing is ever refused for being
  inaccurate**: under a tree line ±15 m may be the best the phone will give, and
  refusing it leaves the fence unrecorded rather than recorded imprecisely. The
  same rule `compareArea` follows for a disagreeing acreage.
- **The worst corner describes the shape**, not the average. Averaging flatters
  a run where three corners were clean and the fourth was taken under a tree.
- **A mis-tap is refused at one metre** — deliberately below the instrument's own
  error, because a larger guard would start refusing real corners on a tight jog
  round a gatepost. Measured against the LAST corner only: a fence that doglegs
  back past an earlier one is a real fence.

**Decisions worth knowing**

- **WALK MODE NEVER STARTS TERRA DRAW.** Terra Draw turns map clicks into
  vertices; in a walk the vertices come from the ground under your feet. Loading
  it anyway would let a stray tap on the map silently add a corner nobody stood
  on — the one thing this input mode exists to prevent.
- **It watches while the panel is open, and that is not the background tracking
  2b.0 refused.** Nothing records where anybody was, nothing runs when the panel
  is shut, and the watch stops when the walk ends. What it buys is the reason
  the accuracy figure is worth showing at all: you can see the fix SETTLE before
  committing a corner instead of tapping blind. `maximumAge: 0`, because a
  cached fix from the last corner is the one answer this panel must never give.
- **The geometry is DERIVED for a walk and stateful for a tap**, and the lint
  rule that forced this was right. A walked shape is a pure function of the
  corners walked, so a copy in state would be a second thing that can disagree
  with them. The tap path genuinely needs state, because its vertices live
  inside Terra Draw and only an event says they moved.
- **The panel assumes geolocation exists.** The button that opens it checks
  first and refuses with a toast — the shape `locate()` already used. Reporting
  the capability from inside the panel meant setting state in an effect body on
  mount, which is the cascading render React's own guidance warns about.
- **The map preview rebuilds the shape inside its effect** rather than depending
  on the derived geometry, which is a new object every render and would push the
  same data to MapLibre continuously.

**Driven on Hilltop Farm's Home Farm**, with the browser's real geolocation
denied and a stubbed fix standing in for a phone — the sandboxed browser has no
location, and the alternative was shipping the slice unclicked:

  - the **denied** path renders its own message and leaves Drop disabled
  - ±14 ft at 4.2 m and ±42 ft at 12.5 m, the second amber with *"usable —
    better in the open"*, and neither refused
  - `worst ±42 ft` after the third corner, tracking the bad one rather than the
    average
  - the mis-tap guard fired on a double tap and the count stayed at 3
  - **four corners measured 1,318 ft live and saved as 1,318 ft** — which is
    also the parcel's known width, so the walked geometry checks out against a
    figure derived a completely different way

**Open after this slice:** nothing has been walked with a REAL phone on REAL
ground, which is the only test that can confirm the correlated-error argument
this whole direction rests on. A stub proves the plumbing; it cannot prove that
walking beats tracing. Walk a tree line before 2b.2 is built on top of it.

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
