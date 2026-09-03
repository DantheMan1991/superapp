# The site plan

> The map on a {{parcel|lower}}'s page: drawing the boundary and the {{zone|plural|lower}}, fences, gates, lanes and water, walking a shape with the phone, dividing ground into {{zone|plural|lower}}, and the materials list counted off the drawing.
> **Route:** /dashboard/m/land/*
> **Order:** 30

Open a {{parcel|lower}} from the Land list and scroll to `Site plan`. This is the aerial map where everything on the ground is drawn: the boundary, every {{zone|lower}}, and every fence, gate, lane, waterline, building and tree. Anyone can draw on it while the {{parcel|lower}} is active. Drawing a fence is a chore, not an owner's decision.

## What you see

- **The map.** It opens on the {{parcel|lower}}'s boundary if one is traced, otherwise on whatever has been drawn, otherwise on the whole country. There is no address search. If nothing is drawn yet, {button:Find my location|ghost} flies the map to where your phone or computer says you are. It moves the map and records nothing.
- **`Aerial` and `Site plan`.** Two buttons at the top left. `Aerial` shows the drawing over public aerial photography. `Site plan` hides the photo and shows the drawing on plain paper, which is easier to read for a plan. Pan and zoom stay where they were when you switch.
- **What is drawn.** The {{parcel|lower}}'s boundary and every real {{zone|lower}}, filled gray with a dashed outline. Proposed {{zone|plural|lower}} in purple with a finer dash. Every feature in its own color: fences in slate, lanes in gray, waterlines and buried electric dashed, tree lines and woods in green, ponds and wells in blue, buildings in amber. A proposed feature is faded with a dotted line; a removed one is fainter still. The names of named features sit on the first corner of a line. A badge at the right of the toolbar counts what is drawn, {badge:14 drawn|outline}.
- **`Key`.** Under the map, a swatch for each kind of thing drawn on this {{parcel|lower}}, and, when there is more than one, the three states `Built`, `Planned` and `Removed`.
- **The toolbar.** The kind picker, then `Draw an area`, `Draw a line` or `Drop a point`; `It is there` or `Proposed`; `Tap the map` or `Walk it`; and the draw button, labeled for what you chose: {button:Trace the boundary|primary|pencil} or {button:Walk the boundary|primary|pencil}, {button:Draw the {{zone|lower}}|primary|pencil} or {button:Walk the {{zone|lower}}|primary|pencil}, {button:Draw it|primary|pencil} or {button:Walk it|primary|pencil}. {button:Move the corners|outline} appears for a boundary that already exists, in tap mode.
- **The kind picker.** `[parcel name]'s boundary`, owners only; `A new {{zone|lower}}`, owners only, which creates the {{zone|lower}} with the drawn area as its recorded area and suggests a name such as `{{zone}} 7`; one entry for each {{zone|lower}} that exists but is not drawn yet, `North Pasture — not drawn yet`, owners only; then every kind of feature: Fence, Gate, Building, Lane or drive, Waterline, Buried electric, Overhead electric, Tree line, Woods, Tree, Well, Hydrant, Tank, Culvert, Pond, Marker. Each kind starts on its natural shape, a fence as a line, a building as an area, a gate as a point. Boundaries are always areas.
- **A feature's panel.** Click a fence, gate or other feature on the map and its panel opens under the key: its name or kind, {badge:Built|primary}, {badge:Planned|outline} or {badge:Removed|secondary}, its length, its details and its notes, with {button:Take me there|outline}, {button:It is built|outline|check} or {button:Mark as removed|outline} or {button:It is back|outline}, {button:Edit details|outline} and {button:Delete|destructive|trash}. Under the map, {button:Move the points — [name]|outline} redraws it, or {button:Draw — [name]|outline} for one that has no shape yet. Click a {{zone|lower}} and it is selected for drawing. Click empty ground to clear the selection.
- **The list of features.** Under the map, everything drawn. Two filters: `Every kind` or one kind, and a state filter that starts on `Built and proposed` and can show `Built`, `Proposed`, `Removed` or `Every state`. Columns, each sortable: `What`, `Kind`, `State`, `Length`. Clicking a row selects it on the map. Check boxes let you delete several at once, after `Delete 3? This cannot be undone`. The footer totals the length, `3,400 ft in all`, noting anything not drawn yet. Points have no length and are left out.
- **`Divide into {{zone|plural|lower}}`.** Owners see {button:Divide into {{zone|plural|lower}}|outline} at the top right of the map once a lane has been drawn. Until then the corner reads `Draw or walk a lane to divide this ground into {{zone|plural|lower}}.`
- **`What it will take`.** Once the {{parcel|lower}} has a plan: `Counted off the drawing. Nothing here is guessed.` A table of `Material`, the quantity `From the drawing`, and `Price`, with {badge:List saved|secondary} or {badge:Not taken off yet|outline} on each plan. See how to use it, below.

## How to draw by tapping

1. Pick what you are adding in the kind picker, its shape, its state, and `Tap the map`.
2. Click the draw button. The instruction at the top of the map tells you what to do: `Click each corner. Click the first one again to close it.` for an area or a boundary, `Click along it. Double-click to finish.` for a line, `Click where it is.` for a point. As you draw, the readout shows the length so far, and for an area the acreage. For a boundary or a {{zone|lower}}, the acreage leads and is compared with the recorded figure, such as `+1.2 acres against the 40 acres recorded`.
3. Leave `Snapping on` unless you are drawing something deliberately offset, such as a waterline beside a fence. Snapping pulls a corner onto a nearby fence or boundary as you place it, so lines meet, and prefers the end of a fence over the middle of one. When a corner snaps, a message names what it joined, `Joined to the end of West fence`. A point snaps when you save it.
4. Click {button:Save it|primary}. {button:Cancel|outline} drops the drawing. {button:Start over|ghost|trash} clears it and reopens the same mode.

What {button:Save it|primary} does depends on what you chose. A new {{zone|lower}} is created: `[name] added`. A {{zone|lower}}'s outline is saved: `Boundary saved`. The {{parcel|lower}}'s outline: `[name]'s boundary saved`. A feature is added: `Fence added`, or `Fence added as a proposal` when its state was `Proposed`. A feature you were redrawing: `Redrawn`.

## How to walk a shape with the phone

1. Choose `Walk it` and click the draw button. A panel appears under the map and the phone starts reading its position. The map cannot be tapped in this mode. The panel shows the accuracy, `±10 ft`, colored by how good it is, with a note when it is not: `usable — better in the open` or `poor — wait, or move clear of trees`. Before the first fix it reads `Getting a fix…`.
2. Stand on a corner and click {button:Drop a point here|primary}. Walk to the next corner and drop again. {button:Undo last|outline} removes the last one. The line at the bottom counts, `4 corners walked · worst ±12 ft`, and says how many more are needed before you can save: one for a point, two for a line, three for an area, where the shape closes itself.
3. For a fence you walked all the way round, check `Close it back to the first corner`. The count beside it changes from `3 sides from 4 corners` to `4 sides from 4 corners`.
4. Click {button:Save it|primary}.

Walked corners snap as they are dropped, with the same `Joined to…` messages. Nothing is recorded about where you were.

## How to edit a feature

1. Click the feature on the map, then {button:Edit details|outline}.
2. Change `Name`, `Kind`, `Fed by` (which other feature supplies this one, for a waterline or an electric run; nothing reads this yet), `Thickness` (how thick the line is drawn: the kind's default, or Hairline, Thin, Medium, Thick, Heavy; drawing only), `Details` and `Notes`.
3. `Details` are free pairs of a name and a value: `Anything worth recording — strands, whether it is hot, how deep it is buried. Lowercase names with underscores.` Add a row with {button:Add a detail|outline|plus} and remove one with its {icon:x}. Two names matter: `post_spacing` and `wire_count` are what the materials list counts posts and wire from.
4. Click {button:Save|primary}. You see `Saved`.

{button:It is built|outline|check} marks a proposal as built. {button:Mark as removed|outline} marks a built feature as gone. {button:It is back|outline} restores a removed one. {button:Delete|destructive|trash} removes the feature at once, with no confirmation.

## How to walk to a corner with the phone

1. Click the feature, then {button:Take me there|outline}. Anyone can use it. The panel becomes a compass for reaching the feature's corners in order, starting with the nearest: the distance in large type, `240 ft`, whether you are `getting closer` or `further away`, the bearing as a compass point and degrees `from true north`, and the phone's accuracy.
2. Walk. {button:Back|outline} and {button:Next corner|outline} step through the corners. {button:Stop|outline} ends it.
3. You have arrived when the corner is within the phone's own accuracy circle: the distance turns green, the note reads `Within ±10 ft — as close as the phone can tell today`, and {badge:you are on it|outline} appears.

The footnote applies: `Good enough for polywire. For a permanent corner post, check it against something you can see — a fence you can touch beats a reading you cannot.`

## How to divide ground into {{zone|plural|lower}}

1. Draw or walk a lane first. Then click {button:Divide into {{zone|plural|lower}}|outline}. The dialog reads `Equal areas, cut across the lane so every one of them has frontage onto it. The lane keeps its own ground — nothing is fenced across it. They arrive as proposals; mark them built once the fence is in.`
2. Pick `Ground to divide`: `All of [parcel]`, a fenced area found from the fences you have drawn, such as `Inside West Fence, North Fence — 12.4 acres`, or an existing {{zone|lower}}. A fenced area is usually what you mean, because the deed line sits outside the wire.
3. Pick the `Lane` the {{zone|plural|lower}} front onto, `How many` from 2 to 60, the `Lane width` in your length unit, and `Called`, the name prefix, `Paddock` unless you type another.
4. Read the layout, worked out live. Two cards offer `One side of the lane` and `Both sides of the lane`, each showing `Ground used`, `Each` and `New fence`, with `least fence per acre` marked on the cheaper one. Warnings appear in amber, for example `These cannot come out equal: the biggest is 1.4 times the smallest. Ask for more paddocks, or put them all on one side of the lane.` Ground in more than one piece, or with a hole in it, cannot be divided and the dialog says so.
5. Click {button:Lay out 4|primary}. It reads `Laying out…`, then you see `Laid out as proposals`.

What arrives on the plan, all as proposals: one {{zone|lower}} per paddock named `Paddock 1`, `Paddock 2` and so on with its area, a gate where each meets the lane, a fence for each dividing cut, and the lane's own side fences. The proposals are the preview, ghosted on the plan. Drag a fence to adjust rather than running the dialog again. When the fence goes in, click {button:The fence is in|outline|check} on each {{zone|lower}} in the proposed box further down the page.

## How to use the materials list

1. Read `What it will take`. A point counts as one of its kind. A line counts as its length. A fence also yields `Posts` and `Wire`, but only when its details carry `post_spacing` and `wire_count`; otherwise an amber note says which fence `needs a post_spacing before posts can be counted`. A feature not drawn yet is noted too. Areas count nothing.
2. Owners click {button:Save this list|primary} to keep today's figures as the order. You see `List saved`. After that the columns read `Saved` and `Now`, so if the drawing changes the difference shows in amber, with the note `The drawing has changed since this list was saved. Both figures are kept as they are — take it off again when you are ready to reorder.` {button:Take it off again|primary} saves the new figures.
3. Click {button:Add a line|outline|plus} for something the drawing cannot count, such as insulators: `Material`, `Called`, `How many`, `Unit` and `Each costs`. A saved line can be removed with its {button:Remove [line]|ghost|trash}. When any line has a price, a total reads `$412.00 for the lines that have a price`. Prices are what you typed on that day. There is no catalog.
4. {button:Remove plan|ghost} removes the plan and its list. You see `Plan removed — what it proposed is still on the plan`.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing on the plan yet` and `Pick what you are adding, then trace it off the aerial. Switch to Site plan to see it as a drawing.` | Nothing has been drawn on this {{parcel|lower}} yet. |
| `That is the corner you just placed. Walk to the next one.` | You dropped a point twice in the same place while walking. |
| `Could not get a location. Check the browser's permission.` | The phone would not share its position. Allow it in the browser. |
| `Draw or walk a lane to divide this ground into {{zone|plural|lower}}.` | Dividing needs a lane drawn first. |

## Not on this page

There is no address search on the map, and the map cannot be tapped while walking a shape. Nothing here tracks your position in the background.

## Who can do what

Anyone can draw features, mark them built or removed, edit and delete them, walk to a corner, and use the materials list. Owners alone trace or move the {{parcel|lower}}'s boundary, draw a new {{zone|lower}} or an undrawn one, divide ground, and save the materials list.
