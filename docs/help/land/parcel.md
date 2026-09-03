# One {{parcel|lower}}

> A {{parcel|lower}}'s own page: its details and boundary, the weather and rotation panels, and the table of {{zone|plural|lower}} inside it. The site plan in the middle of the page has its own guide.
> **Route:** /dashboard/m/land/*
> **Order:** 20

## The top of the page

**All land** at the top takes you back to the list. The title is the {{parcel|lower}}'s name, and the line under it reads, for example, `Owned · 40.12 acres`. A retired {{parcel|lower}} carries a `retired` badge and has no buttons.

Owners see two buttons on an active {{parcel|lower}}.

**Edit** opens **Edit parcel**:

- **Name.** Required.
- **Tenure.** `Owned`, `Leased` or `Crop share`.
- **Area in acres** (or hectares). `Leave blank if unknown`.
- **Deed or lease reference.**
- **Rest you are aiming for.** Days, from 1 to 365. `Days — leave blank if you have no target`. The help text: `Only used to compare against what each area actually got. Nothing is scheduled or refused because of it, and a parcel you graze differently should have its own number.` This is the only place a rest target is set, and it belongs to the {{parcel|lower}}, not to each {{zone|lower}}.
- **Notes.**

Click **Save**. You see `Parcel updated`.

**Retire** opens `Retire [name]?`: `Ground that has been sold, or a lease that has ended. Nothing is deleted — every cost recorded against it keeps reporting, and it stops being offered anywhere new.` If it has active {{zone|plural|lower}}, a line says how many will be retired with it. Click **Retire parcel**. Retiring is one way.

## Boundary

The **Boundary** section compares what was measured off the map with what the deed says. When a boundary has been traced, the heading continues `· measures 39.8 acres`, and a box shows **Measured** and **Recorded** side by side. If the two are more than 5% apart, a badge says by how much, and the text reads `Worth a look. A deed figure and a fence line disagree for real reasons — an easement, a creek, a boundary drawn casually — so neither number is corrected here.` If they agree: `Close enough to the recorded figure. Both are kept as they are.` With no recorded area: `Nothing to compare it against — no area is recorded here.`

Nothing here ever changes the recorded area. A measurement stays a measurement.

The usual way to trace a boundary is on the site plan below, and the words **the site plan** in this section are a link that scrolls there. Owners also have a paste box: the button reads **Add a boundary**, or **Replace boundary** once one exists.

The paste box is for a boundary that already exists as a file: `Paste the GeoJSON for this parcel. A county GIS export, a farm mapping app, or geojson.io all produce it — a Feature or a whole FeatureCollection is fine as long as it holds one shape.` Paste into the **GeoJSON** box. It opens showing the current boundary, if there is one. As you paste, the box checks the shape and either tells you what is wrong, for example `That is not valid JSON.` or `That file has 3 shapes in it. Paste just the one for this boundary.`, or reports `That boundary measures 39.8 acres.` together with how that compares to the recorded figure. Click **Save boundary**. **Remove the boundary** takes it off. The box cannot edit a shape; to move a corner, use **Move the corners** on the site plan.

## Site plan

The panel headed **Site plan**, `What is on the ground — and what is only proposed.`, is the aerial map where the boundary, every {{zone|lower}}, and every fence, gate, lane, waterline, building and tree is drawn, and where ground is divided into {{zone|plural|lower}}. It is covered in its own guide, **The site plan**, along with the **What it will take** panel that counts posts and wire off the drawing.

## Details

- **Tenure**, **Deed or lease** and **Area**, as recorded.
- **In {{zone|plural|lower}}.** The total area of the active {{zone|plural|lower}}, with a note of how many have no area recorded.
- **Not divided up** or **Over by**, with the difference between the {{parcel|lower}}'s area and its {{zone|plural|lower}}. Shown only when every figure is known, because otherwise the subtraction would be a guess.
- **Notes.**

## Growing weather

`Free, from this parcel's middle. Nobody types it in.` Once the boundary is traced, this panel looks up the weather record for the middle of the {{parcel|lower}} and shows the growing degree days since 1 January, for example `1,240 °F-days since 1 January, over 50°F`, and how that compares: `12% ahead of the 5-year average for this date`, `8% behind the same window last year`, or `About level with` it. Under a rule is the rain: how much fell in the last days, whether any of it was a wetting rain, and when the last one was.

Without a boundary it reads `No boundary yet, so there is nowhere to look up.` The panel tells you how the season is running. It does not predict when grass will be ready.

## Rotation

This panel works out whether your {{zone|plural|lower}} can deliver the rest target set under **Edit**. It stays quiet until it has enough to go on: a rest target, at least two {{zone|plural|lower}}, and at least three finished stays. Before that it tells you what it is waiting for.

With enough history it reads, for example, `12 paddocks at 1.2 days each delivers 13.2 days of rest.` followed by either `That meets your 21-day target.` or `Your target is 21 days, which needs 19 at this pace — 7 more. Hitting it is arithmetic, not effort: more subdivisions, slower moves, or ground you cannot currently reach.`

## What changed

The twelve most recent declarations of what a {{zone|lower}} is for, newest first: the date, the {{zone|lower}}, the use, and `(to [date])` once that use was closed. Before any: `Nothing has been declared yet. Setting what a {{zone|lower}} is for, and from when, is what makes rotation reportable later.`

## {{zone|plural}}

The section heading counts the active {{zone|plural|lower}}, for example `Paddocks (12)`.

**Add {{zone|lower}}**, owners only, adds one by name whose shape comes later. The dialog, `Add a {{zone|lower}}`, explains: `A management unit inside this parcel. What it is for is set separately, because that changes with the season.` Fields: **Name**, required; **Area in acres** (or hectares), `Leave blank if unknown`; **Notes**. There is no use field here on purpose, because a use is dated. To create several {{zone|plural|lower}} with their shapes at once, use **Divide into {{zone|plural|lower}}** on the site plan.

**Proposed {{zone|plural|lower}}.** When ground has been divided on the site plan, the new {{zone|plural|lower}} arrive as proposals and are listed in a dashed box above the table: `No fence round these yet. Nothing can graze them and they count towards nothing until you say they are in.` Each row has two owner buttons. **The fence is in** makes it a real {{zone|lower}}; you see `[name] is in`. **Discard** asks `Sure?` and then deletes it for good. **Discard all** does the same for every proposal at once.

**The table.** Two filters sit above it. **Use** narrows to one declared use, or `Not set`. **Status** shows `In use` by default, or `Retired`, or both. A counter reads `12 shown` or `4 of 12`.

Columns, each sortable by clicking its heading:

- **{{zone}}.** The name, which opens the {{zone|lower}}'s page. A retired one carries a `retired` badge.
- **Currently.** What it is for now and since when, with a `not productive` badge for ground that is not expected to earn. A dash when nothing has been declared.
- **Rested.** `occupied` while something is on it, a dash if it has never been used, otherwise the days since the last stay ended, for example `18 days`, with `under target` when that is below the {{parcel|lower}}'s rest target.
- **Area.**

Owners also get a tick box on each active row and a **Retire** button for the ticked ones, which asks once more, `Retire 3? Their history is kept`, before retiring them.

**The menu on each row**, owners only, has three items.

**Set what it is for** opens `What is [name] for?`: `From a date. Whatever it was for before is closed the day before, so the history stays readable.`

- **Use.** Pasture, Hay, Crop, Garden, Orchard, Woodlot, Yard, Lane, Building site, Water, Wetland, Idle, any use you have already invented, or `Something else…`, which opens a box to type a new one.
- **From.** The date it starts. Today to begin with.
- **Expected to earn.** A switch. On for pasture, hay, crops, a garden, an orchard or a woodlot; off for a yard, a lane, a building site, water, wetland or idle ground. `Turn this off for a yard, a lane or a house site. Ground that earns nothing still carries tax and upkeep, and counting it as productive flatters every per-acre figure.`
- **Notes.**

A **History** block lists earlier uses with their dates. Click **Record use**. You see `Use recorded`. Starting a new use closes the previous one the day before the new start date.

**Edit {{zone|lower}}** changes the name, area and notes. **Retire {{zone|lower}}** asks `Retire [name]?`: `Its history stays, and so does every cost recorded against it. It stops being offered anywhere new, and whatever it is currently for is closed today.`

Before any {{zone|plural|lower}} exist, the table reads **No {{zone|lower}} on this parcel yet** and `Divide the ground into {{zone|plural|lower}} and everything that happens on it has somewhere to land.`
