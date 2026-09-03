# The site plan

> The map on a {{parcel|lower}}'s page: drawing the boundary and the {{zone|plural|lower}}, fences, gates, lanes and water, walking a shape with the phone, dividing ground into {{zone|plural|lower}}, and the materials list counted off the drawing.
> **Route:** /dashboard/m/land/*
> **Order:** 30

## The map

The map opens on the {{parcel|lower}}'s boundary if one is traced, otherwise on whatever has been drawn, otherwise on the whole country. There is no address search. If nothing is drawn yet, **Find my location** is the way in: it flies the map to where your phone or computer says you are. It moves the map and records nothing.

Two buttons at the top left switch the view. **Aerial** shows the drawing over public aerial photography. **Site plan** hides the photo and shows the drawing on plain paper, which is easier to read for a plan. Pan and zoom stay where they were when you switch.

What is drawn on the map:

- The {{parcel|lower}}'s boundary and every real {{zone|lower}}, filled grey with a dashed outline.
- Proposed {{zone|plural|lower}} in purple with a finer dash. A proposal never looks like a fact.
- Every feature, in its own colour: fences in slate, lanes in grey, waterlines and buried electric dashed, tree lines and woods in green, ponds and wells in blue, buildings in amber. A proposed feature is faded with a dotted line; a removed one is fainter still.
- The names of named features, sitting on the first corner of a line.

Under the map, **Key** shows a swatch for each kind of thing actually drawn on this {{parcel|lower}}, and, when there is more than one, the three states **Built**, **Planned** and **Removed**.

**Clicking the map.** Click a fence, gate or other feature and it is selected: its panel opens under the map and its row lights up in the list. Click a {{zone|lower}} and it is selected for drawing, ready for its boundary. Click empty ground to clear the selection. A badge at the right of the toolbar counts what is drawn, `14 drawn`.

## The toolbar

Everything here is available to any member while the {{parcel|lower}} is active, except the two boundary entries in the first picker, which are for owners.

**The kind picker** decides what you are about to draw:

- `[parcel name]'s boundary`. Owners. The {{parcel|lower}}'s own outline.
- `A new {{zone|lower}}`. Owners. Draw a {{zone|lower}} and it is created with the drawn area as its recorded area. A box appears for its name, suggested as `{{zone}} 7` or whatever comes next, so the name is settled before you are standing in a field.
- One entry for each {{zone|lower}} that exists but is not drawn yet, `North Pasture — not drawn yet`. Owners. A {{zone|lower}} that is already drawn is clicked on the map instead.
- Then every kind of feature: Fence, Gate, Building, Lane or drive, Waterline, Buried electric, Overhead electric, Tree line, Woods, Tree, Well, Hydrant, Tank, Culvert, Pond, Marker.

**Shape.** Three buttons, **Draw an area**, **Draw a line** and **Drop a point**. Each kind starts on its natural shape, a fence as a line, a building as an area, a gate as a point. Boundaries are always areas, so the buttons disappear for them.

**State.** **It is there** for something built, **Proposed** for something planned. Not shown for a boundary.

**Input.** **Tap the map** to draw by clicking, or **Walk it** to drop corners with the phone's position.

**The draw button** is labelled for what you chose: **Trace the boundary** or **Walk the boundary**, **Draw the {{zone|lower}}** or **Walk the {{zone|lower}}**, **Draw it** or **Walk it**.

**Move the corners** appears for a boundary that already exists, in tap mode. It loads the outline with draggable corners and midpoints so you can adjust it rather than redraw it.

## Drawing by tapping

The instruction at the top of the map tells you what to do: `Click each corner. Click the first one again to close it.` for an area or a boundary, `Click along it. Double-click to finish.` for a line, `Click where it is.` for a point. As you draw, the readout shows the length so far, and for an area the acreage. For a boundary or a {{zone|lower}}, the acreage leads and is compared to the recorded figure, for example `+1.2 acres against the 40 acres recorded`.

While drawing the toolbar offers **Save it**, **Cancel**, **Start over**, and **Snapping on**. Snapping pulls a corner onto a nearby fence or boundary as you place it, so lines meet. A corner outranks a run: it prefers to join the end of a fence over the middle of one. When a corner snaps, a message names what it joined, `Joined to the end of West fence`. Switch snapping off for something that is deliberately offset, such as a waterline running beside a fence. A point snaps when you save it, not while you place it.

What **Save it** does depends on what you chose. A new {{zone|lower}} is created and you see `[name] added`. A {{zone|lower}}'s outline is saved: `Boundary saved`. The {{parcel|lower}}'s outline: `[name]'s boundary saved`. A feature is added, `Fence added`, or `Fence added as a proposal` when the state was Proposed. A feature you were redrawing: `Redrawn`.

## Walking a shape

Choose **Walk it** and press the draw button. A panel appears under the map and the phone starts reading its position. The map cannot be tapped in this mode; corners come from where you stand.

The panel shows the current accuracy, `±10 ft`, coloured by how good it is, with a note when it is not: `usable — better in the open` or `poor — wait, or move clear of trees`. Before the first fix it reads `Getting a fix…`.

Stand on a corner and press **Drop a point here**. Walk to the next corner and drop again. **Undo last** removes the last one. Pressing drop twice in the same place is refused: `That is the corner you just placed. Walk to the next one.` The line at the bottom counts, `4 corners walked · worst ±12 ft`, and says how many more are needed before you can save: one for a point, two for a line, three for an area, where the shape closes itself.

For a line with three or more corners, a tick box **Close it back to the first corner** joins the last corner to the first, and the count beside it changes from `3 sides from 4 corners` to `4 sides from 4 corners`. Use it for a fence you walked all the way round.

Walked corners snap as they are dropped, with the same `Joined to…` messages. Nothing is recorded about where you were; the reading is used for the corner and then forgotten.

## A feature's panel

Select a feature and its panel opens under the key: its name or kind, a **Built**, **Planned** or **Removed** badge, and its length. Its details are listed, then its notes.

- **Take me there** starts the phone guiding you to it. See below. Anyone can use it.
- **It is built** marks a proposal as built. **Mark as removed** marks a built feature as gone. **It is back** restores a removed one.
- **Edit details** opens the form.
- **Delete** removes it at once, with no confirmation.
- Under the map, **Move the points — [name]** redraws it, or **Draw — [name]** for one that has no shape yet.

**Edit details** has:

- **Name.**
- **Kind.**
- **Fed by.** Which other feature supplies this one, for a waterline or an electric run. Nothing reads this yet.
- **Thickness.** How thick the line is drawn: the kind's default, or Hairline, Thin, Medium, Thick, Heavy. Drawing only; it says nothing about the real fence.
- **Details.** Free pairs of a name and a value, `Anything worth recording — strands, whether it is hot, how deep it is buried. Lowercase names with underscores.` Add a row with **Add a detail** and remove one with its X. Two names matter: `post_spacing` and `wire_count` are what the materials list counts posts and wire from.
- **Notes.**

Click **Save**. You see `Saved`.

## Take me there

The panel turns into a compass for reaching the feature's corners in order, starting with the nearest. It shows the distance in large type, `240 ft`, whether you are `getting closer` or `further away`, the bearing as a compass point and degrees `from true north`, and the phone's accuracy. **Back** and **Next corner** step through the corners. **Stop** ends it.

You have arrived when the corner is within the phone's own accuracy circle: the distance turns green, the note reads `Within ±10 ft — as close as the phone can tell today`, and a badge says `you are on it`. A permanent footnote applies: `Good enough for polywire. For a permanent corner post, check it against something you can see — a fence you can touch beats a reading you cannot.`

## The list of features

Under the map is a table of everything drawn. Two filters: **Every kind** or one kind, and a state filter that starts on **Built and proposed** and can show only **Built**, **Proposed**, **Removed** or **Every state**. Columns, each sortable: **What**, **Kind**, **State**, **Length**. Clicking a row selects it on the map. Tick boxes let you delete several at once; the button asks once more, `Delete 3? This cannot be undone`. The footer totals the length, `3,400 ft in all`, noting anything not drawn yet. Points have no length and are left out of the total.

Before anything is drawn: **Nothing on the plan yet** and `Pick what you are adding, then trace it off the aerial. Switch to Site plan to see it as a drawing.`

## Divide into {{zone|plural|lower}}

Owners see **Divide into {{zone|plural|lower}}** at the top right of the site plan once a lane has been drawn. Until then the corner reads `Draw or walk a lane to divide this ground into {{zone|plural|lower}}.`

The dialog explains: `Equal areas, cut across the lane so every one of them has frontage onto it. The lane keeps its own ground — nothing is fenced across it. They arrive as proposals; mark them built once the fence is in.`

- **Ground to divide.** `All of [parcel]`, or a fenced area found from the fences you have drawn, `Inside West Fence, North Fence — 12.4 acres`, or an existing {{zone|lower}}. A fenced area is usually what you mean, because the deed line sits outside the wire.
- **Lane.** Which lane the {{zone|plural|lower}} front onto.
- **How many.** From 2 to 60.
- **Lane width.** In your length unit.
- **Called.** The name prefix. `Paddock` unless you type another.

Under the fields, the layout is worked out live. Two cards offer **One side of the lane** and **Both sides of the lane**, each showing **Ground used**, **Each** and **New fence**, with `least fence per acre` marked on the cheaper one. Warnings appear in amber, for example `These cannot come out equal: the biggest is 1.4 times the smallest. Ask for more paddocks, or put them all on one side of the lane.` Ground in more than one piece, or with a hole in it, cannot be divided and the dialog says so.

Click **Lay out 4**. You see `Laid out as proposals`. What arrives on the plan, all as proposals: one {{zone|lower}} per paddock named `Paddock 1`, `Paddock 2` and so on with its area, a gate where each one meets the lane, a fence for each dividing cut, and the lane's own side fences. There is no separate preview; the proposals are the preview, ghosted on the plan. Drag a fence to adjust rather than running the dialog again. When the fence goes in, mark each {{zone|lower}} **The fence is in** in the Proposed box further down the page.

## What it will take

Once a {{parcel|lower}} has a plan, a panel headed **What it will take**, `Counted off the drawing. Nothing here is guessed.`, lists the materials for it.

The table shows **Material**, the quantity **From the drawing**, and **Price**. A point counts as one of its kind. A line counts as its length. A fence also yields **Posts** and **Wire**, but only when the fence's details carry `post_spacing` and `wire_count`; otherwise an amber note says which fence `needs a post_spacing before posts can be counted`. A feature not drawn yet is noted too. Areas count nothing.

Owners can **Save this list**, which keeps today's figures as the order. After that the columns read **Saved** and **Now**, so if the drawing changes the difference shows in amber, with the note `The drawing has changed since this list was saved. Both figures are kept as they are — take it off again when you are ready to reorder.` **Take it off again** saves the new figures.

**Add a line** adds something the drawing cannot count, such as insulators: **Material**, **Called**, **How many**, **Unit**, and **Each costs**. A saved line can be removed with its bin icon. When any line has a price, a total reads `$412.00 for the lines that have a price`. Prices are what you typed on that day; there is no catalogue.

**Remove plan** removes the plan and its list; what it proposed stays on the drawing.
