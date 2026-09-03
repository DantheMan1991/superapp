# One {{parcel|lower}}

> A {{parcel|lower}}'s own page: its details and boundary, the weather and rotation panels, and the table of {{zone|plural|lower}} inside it. The site plan in the middle of the page has its own guide.
> **Route:** /dashboard/m/land/*
> **Order:** 20

Open **Land** in the sidebar and click a {{parcel|lower}}'s name. This page holds everything about one {{parcel|lower}}. The site plan in the middle, where the boundary and every {{zone|lower}}, fence, gate and lane are drawn, has its own guide. See [The site plan](site-plan.md).

## What you see

- **The top of the page.** `All land` takes you back to the list. The title is the {{parcel|lower}}'s name, and the line under it reads, for example, `Owned · 40.12 acres`. A retired {{parcel|lower}} carries {badge:retired|outline} and has no buttons. On an active one, owners see {button:Edit|outline} and {button:Retire|outline}.
- **`Boundary`.** What was measured off the map against what the deed says. When a boundary has been traced, the heading continues `· measures 39.8 acres`, and a box shows `Measured` and `Recorded` side by side. If the two are more than 5% apart, a badge such as {badge:8% apart|outline} appears and the text reads `Worth a look. A deed figure and a fence line disagree for real reasons — an easement, a creek, a boundary drawn casually — so neither number is corrected here.` If they agree: `Close enough to the recorded figure. Both are kept as they are.` With no recorded area: `Nothing to compare it against — no area is recorded here.` Nothing here ever changes the recorded area. The words `the site plan` in this section are a link that scrolls to the map. Owners also see {button:Add a boundary|outline}, or {button:Replace boundary|outline} once one exists.
- **`Site plan`.** `What is on the ground — and what is only proposed.` The aerial map. See [The site plan](site-plan.md), which also covers the `What it will take` panel that counts posts and wire off the drawing.
- **`Details`.** `Tenure`, `Deed or lease` and `Area`, as recorded. `In {{zone|plural|lower}}`, the total area of the active {{zone|plural|lower}}, with a note of how many have no area recorded. `Not divided up` or `Over by`, the difference between the {{parcel|lower}}'s area and its {{zone|plural|lower}}, shown only when every figure is known. `Notes`.
- **`Growing weather`.** `Free, from this parcel's middle. Nobody types it in.` Once the boundary is traced, the growing degree days since 1 January, for example `1,240 °F-days since 1 January, over 50°F`, and how that compares: `12% ahead of the 5-year average for this date`, `8% behind the same window last year`, or `About level with` it. Under a rule, the rain: how much fell in the last days, whether any of it was a wetting rain, and when the last one was. Without a boundary: `No boundary yet, so there is nowhere to look up.` The panel tells you how the season is running. It does not predict when grass will be ready.
- **`Rotation`.** Whether your {{zone|plural|lower}} can deliver the rest target set under {button:Edit|outline}. It stays quiet until it has a rest target, at least two {{zone|plural|lower}}, and at least three finished stays, and tells you what it is waiting for. With enough history it reads, for example, `12 paddocks at 1.2 days each delivers 13.2 days of rest.` followed by `That meets your 21-day target.` or `Your target is 21 days, which needs 19 at this pace — 7 more. Hitting it is arithmetic, not effort: more subdivisions, slower moves, or ground you cannot currently reach.`
- **`What changed`.** The twelve most recent declarations of what a {{zone|lower}} is for, newest first: the date, the {{zone|lower}}, the use, and `(to [date])` once that use was closed. Before any: `Nothing has been declared yet. Setting what a {{zone|lower}} is for, and from when, is what makes rotation reportable later.`
- **`{{zone|plural}}`.** The heading counts the active ones, such as `Paddocks (12)`, with {button:Add {{zone|lower}}|outline} at the right for owners. Proposed {{zone|plural|lower}} from the site plan sit in a dashed box above the table: `No fence round these yet. Nothing can graze them and they count towards nothing until you say they are in.`, each with {badge:Proposed|outline}, {button:The fence is in|outline|check} and {button:Discard|ghost|trash}, and {button:Discard all 4|outline} when there is more than one. Two filters sit above the table: `Use`, one declared use or `Not set`, and `Status`, which shows `In use` to begin with, or `Retired`, or both. A counter reads `12 shown` or `4 of 12`.
- **The table's columns**, each sortable by clicking its heading: `{{zone}}`, the name, which opens the {{zone|lower}}'s page, with {badge:retired|outline} on a retired one; `Currently`, what it is for now and since when, with {badge:not productive|outline} for ground not expected to earn, or a dash; `Rested`, which reads {badge:occupied|outline} while something is on it, a dash if it has never been used, or the days since the last stay ended, such as `18 days`, with `under target` when that is below the {{parcel|lower}}'s rest target; and `Area`. Owners also get a check box on each active row and {button:Retire|outline} for the checked ones, and a menu on each row with `Set what it is for`, `Edit {{zone|lower}}` and `Retire {{zone|lower}}`.

## How to edit the {{parcel|lower}}

1. Click {button:Edit|outline}. The dialog is `Edit parcel`.
2. Change `Name`, `Tenure` (`Owned`, `Leased` or `Crop share`), `Area in acres` (`Leave blank if unknown`), `Deed or lease reference` or `Notes`.
3. Set `Rest you are aiming for` in days, from 1 to 365: `Days — leave blank if you have no target`. The help text: `Only used to compare against what each area actually got. Nothing is scheduled or refused because of it, and a parcel you graze differently should have its own number.` This is the only place a rest target is set, and it belongs to the {{parcel|lower}}, not to each {{zone|lower}}.
4. Click {button:Save|primary}. You see `Parcel updated`.

## How to retire the {{parcel|lower}}

1. Click {button:Retire|outline}. The dialog is `Retire [name]?` and reads `Ground that has been sold, or a lease that has ended. Nothing is deleted — every cost recorded against it keeps reporting, and it stops being offered anywhere new.` If it has active {{zone|plural|lower}}, a line says how many will be retired with it.
2. Click {button:Retire parcel|primary}. It reads `Retiring…`. Retiring is one way.

## How to paste a boundary you already have

1. Click {button:Add a boundary|outline}, or {button:Replace boundary|outline}. The box reads `Paste the GeoJSON for this parcel. A county GIS export, a farm mapping app, or geojson.io all produce it — a Feature or a whole FeatureCollection is fine as long as it holds one shape.`
2. Paste into `GeoJSON`. It opens showing the current boundary, if there is one. As you paste, the box checks the shape and either says what is wrong, such as `That is not valid JSON.` or `That file has 3 shapes in it. Paste just the one for this boundary.`, or reports `That boundary measures 39.8 acres.` and how that compares with the recorded figure.
3. Click {button:Save boundary|primary}. {button:Remove the boundary|ghost} takes it off.

The box cannot edit a shape. To move a corner, use {button:Move the corners|outline} on the site plan. The usual way to trace a boundary is on the site plan.

## How to add a {{zone|lower}} by name

1. Click {button:Add {{zone|lower}}|outline}. The dialog is `Add a {{zone|lower}}` and reads `A management unit inside this parcel. What it is for is set separately, because that changes with the season.`
2. Fill in `Name`. Required. Add `Area in acres` (`Leave blank if unknown`) and `Notes` if you want them. There is no use field here on purpose, because a use is dated.
3. Click {button:Add {{zone|lower}}|primary}. Its shape comes later, on the site plan. To create several {{zone|plural|lower}} with their shapes at once, use {button:Divide into {{zone|plural|lower}}|outline} on the site plan.

## How to accept or discard a proposed {{zone|lower}}

1. When the fence is in, click {button:The fence is in|outline|check} on the proposal. You see `[name] is in`, and it becomes a real {{zone|lower}}.
2. To drop one, click {button:Discard|ghost|trash}. The label changes to `Sure?`, and a second click deletes it for good. You see `[name] discarded`. {button:Discard all 4|outline} does the same for every proposal at once, after asking once.

## How to set what a {{zone|lower}} is for

1. Open the menu on the row and choose `Set what it is for`. The dialog is `What is [name] for?` and reads `From a date. Whatever it was for before is closed the day before, so the history stays readable.`
2. Pick `Use`: Pasture, Hay, Crop, Garden, Orchard, Woodlot, Yard, Lane, Building site, Water, Wetland, Idle, any use you have already invented, or `Something else…`, which opens a box to type a new one.
3. Set `From`, the date it starts. Today to begin with.
4. Leave `Expected to earn` on for pasture, hay, crops, a garden, an orchard or a woodlot, and off for a yard, a lane, a building site, water, wetland or idle ground: `Turn this off for a yard, a lane or a house site. Ground that earns nothing still carries tax and upkeep, and counting it as productive flatters every per-acre figure.` Add `Notes` if you want them. A `History` block lists earlier uses with their dates.
5. Click {button:Record use|primary}. You see `Use recorded`. Starting a new use closes the previous one the day before the new start date.

## How to edit or retire a {{zone|lower}}

1. Open the menu on the row. `Edit {{zone|lower}}` changes the name, area and notes.
2. `Retire {{zone|lower}}` asks `Retire [name]?`: `Its history stays, and so does every cost recorded against it. It stops being offered anywhere new, and whatever it is currently for is closed today.`
3. To retire several, check their rows and click {button:Retire|outline}. It asks once more, `Retire 3? Their history is kept`.

## Messages

| Message | What it means |
| --- | --- |
| `No {{zone|lower}} on this parcel yet` and `Divide the ground into {{zone|plural|lower}} and everything that happens on it has somewhere to land.` | The {{parcel|lower}} has no {{zone|plural|lower}} yet. Divide it on the site plan, or add one by name. |
| `No boundary yet, so there is nowhere to look up.` | The weather panel needs a traced boundary to know where to look. |

## Not on this page

Nothing here changes the recorded area from a measurement. A measurement stays a measurement. Retiring is one way.

## Who can do what

Owners edit and retire the {{parcel|lower}}, add or replace the boundary, add, retire and set the use of {{zone|plural|lower}}, and accept or discard proposals. Staff see everything without those buttons. Anyone can draw on the site plan.
