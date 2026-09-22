# Walking an estimate

> Price a job by going through it and answering questions, instead of typing the lines yourself. It asks one thing at a time, turns each phase into lines you check before they are written, and asks things your list does not have.
> **Route:** /dashboard/m/jobs/*/estimates/*/walk
> **Order:** 265

## What this is

A walk goes through your job phase by phase, asking what it needs to know.
*Who is doing the foundation? Block or poured? How many linear feet of
footing?* You answer with a tap or a sentence, and it keeps a record of
everything you said.

The questions come from an [estimate outline](estimate-outlines.md) — your own
list, which you can edit any time, including in the middle of a walk. If you
realise halfway through that it never asks about the sump, go and add it and
it will turn up in the walk you are in.

**It is a layer over the ordinary estimate, not a replacement.** The estimate
exists before you start and is untouched while you walk. You can stop at any
point and carry on typing.

## Starting one

On any estimate that is not yet accepted you will see a panel above the lines:
*Walk it instead of typing it*. Pick which outline to use and press
{button:Start the walk|primary}.

If your outline has a [measure-first list](estimate-outlines.md#measure-first),
that is what it opens with — see below. Otherwise it asks its first question
straight away.

**If the panel says there is no outline to walk yet**, that is all that is
missing. {button:Set one up|outline} takes you to
[Estimate outlines](estimate-outlines.md), where starting one from a cost code
list gives you a step per phase in a couple of clicks.

If you leave and come back, that panel says **A walk is part way through** and
how far you got. {button:Pick it up|primary} carries on exactly where you were,
down to the question you were on — nothing is lost by closing the laptop.

## It measures the building first

**Before a single question**, the walk asks for the numbers your outline says
it needs: the perimeter, the wall height, the roof area — whatever your
business put on its
[Measure first](estimate-outlines.md#measure-first) list. The header reads
**Measuring the building** and counts down how many are left.

There are two reasons it does this up front rather than asking as it goes.
Measuring is a different job from talking — you want the drawings open and
your head in them, not fifteen interruptions. And **every question after this
point can use these numbers**: give it the wall area once and it works from
it at insulation, at drywall and at paint instead of asking you three times.

### Answering one

Type the figure. It reads what you would actually write:

| You type | It reads |
| --- | --- |
| `2400` or `2,400 sf` | 2,400 |
| `38'-6"` | 38.5 |
| `24 x 40` (or `24 by 40`) | 960 |
| `40 + 24 + 40 + 24` | 128 |
| `40x9 + 24x9` | 576 |

**It will not choose between two figures.** *"240 to 260"* gets asked again
rather than averaged, because a measurement you did not mean multiplies
through every line that reads it. One number, and it takes it.

{button:Skip this one|ghost} is a real answer and it sticks — the walk will
not ask again. Use it for what is not on this job and for what you will go
and find out later.

### Measuring it on a drawing

{button:Measure it on a drawing|outline} opens your sheets without leaving the
walk. Pick the sheet, and the full drawing viewer opens over the
conversation — the same one the **Drawings** tab uses, with the same tools and
the same scale.

- Draw the length, area or count, and press {button:Use this|primary} beside
  it in the list.
- **Anything already drawn on that sheet is offered too**, so a takeoff
  somebody did last week is one click.
- If there are several of the right kind — a roof in three planes — there is a
  **Use the total** button that adds them up and says how many it added.
- Only traces of the kind being asked for are offered. Asked for an area, you
  will not be handed a length.

A number taken this way carries a small ruler beside it afterwards, and
remembers the sheet it came from. **Re-scaling that sheet later does not
change it** — the number was right when you took it, and a bid that moved
underneath you is worse than one that is out of date where you can see it.

If the job has no drawings, the picker says so. Type the number instead;
nothing about the walk depends on there being a PDF.

### Reading it off the model

If the building is drawn in Revit — or any modelling tool that exports a
schedule — the numbers are already in the model. {button:From the model|outline}
sits beside the drawings button whenever the walk is asking for a
measurement, again beside the room list, and after the measure-up as a small
button in the side panel under the building's numbers, so a re-drawn model or
a figure typed wrong is one file away from right.

**Getting the file out of Revit.** Open the schedule that holds the number —
the roof schedule, the wall schedule, the room schedule — then **File → Export
→ Reports → Schedule**. Keep *Export title* and *Export column headers* ticked;
the delimiter and the text qualifier can stay as they are, and *Export group
headers, footers, and blank lines* does no harm. Revit writes a `.txt` file.
**Filter the schedule first** if you want a subset — exterior walls only, say
— because the walk adds up every row it is given.

**In the dialog.** Press {button:Choose the file|outline} and pick the export,
or paste the text into the box and press {button:Read it|primary}. It reads
the file and shows:

- **The schedule's name and how many rows it holds**, with any total rows
  left out. Revit's *Grand total* line and the footer under each group are
  never counted twice.
- **Add the rooms**, when the schedule is a room list: how many, on how many
  floors, how many with an area, and the list itself grouped by floor with
  each area beside it. A room marked *Not Placed* or *Redundant* in the model
  is left out and named under *rows not taken*. A room already on the job is
  greyed with *already there* — its area is updated, nothing is doubled.
  Untick the box to bring in the numbers only.
- **The building's numbers** — one line per column of figures: the column's
  name, its total (*across 12 rows*), and a drop-down of the measurements on
  your outline's [Measure first](estimate-outlines.md#measure-first) list that
  it could answer. Where the words agree — an *Area* column in a *Roof
  Schedule* against *Roof area* — the choice is already made for you; check
  it. Where they do not, pick one, or leave it on *— leave it*. A measurement
  the building already has shows its current figure in the list, and picking
  it replaces that figure. A column whose every row carries the same figure —
  a wall height — offers *the same on every row* as well as the total. The
  **Rows** line offers the number of rows, for a measurement that is a count.

A length column is never offered for an area measurement, nor the other way
round, and a column with no unit in the file says *no unit in the file*. If a
column fits nothing on your list it says so in italics. If your outline has no
Measure first list at all, the dialog says that too, and the rooms still come
in.

Press {button:Bring it in|primary}. The rooms and the figures land on the
job, each marked as read off the model — a small table icon beside the
number in the side panel, where a traced figure shows a ruler — and the walk
carries on from wherever it stood: it asks for the next number the file did
not hold, or moves to the rooms, or opens the first phase. A message names
what came in: `Wall perimeter 128 lf · Wall height 9 lf · 11 rooms added`.
Anything it could not write is named in a second message with the reason —
*Roof area wants an area and Length holds a length* — so nothing goes
quietly missing.

**Units.** Feet and inches with fractions (`63' - 4 1/2"`), `SF`, `ft²`,
`m²`, millimetres, cubic feet and cubic yards all read. A metric schedule
against an imperial list is converted; a room's area stays in the unit the
schedule gave it.

## Then it asks what rooms are in it

The last thing before the questions start. **Paste the list** — one room a
line — press {button:From the model|outline} to read the room schedule out of
the model (see [Reading it off the model](#reading-it-off-the-model)), or
press {button:Skip the rooms|ghost} if you would rather not.

This is what lets the questions be specific. Without rooms the walk asks
*"how much flooring?"*; with them it asks what is going where, and the
answer it works out covers the whole list at once.

### Pasting the list

One a line. A **floor on its own line ending in a colon** groups everything
under it until the next one:

```
Main floor:
Kitchen        310
Great room, 420
Dining         280
Powder room     24
Mud room
Upstairs:
Master bedroom 14 x 16
Master bath     62
Bedroom 3
```

An area can follow the name after **a tab, a comma or a wide gap** — two or
more spaces. A single space is not a separator, so `Master bedroom` stays one
room rather than becoming a room called *Master*. The area reads the same way
the measurements do, so `14 x 16` is 224 and `18'-6"` is 18.5.

**A room with no area is fine.** The name is most of what matters: it is what
lets a question say *"what tile in the master bath?"*, and what lets the bid
be checked for a room nobody priced. Fill the numbers in for the rooms whose
cost depends on one — which is mostly floors.

If a line cannot be read it says so and names it, rather than quietly
dropping it.

### The rooms panel

{button:The rooms|outline} is on the screen for the rest of the walk. Inside:

- Every room, grouped by floor, with its area.
- A box beside any room with no area — type it, or press
  {button:Measure|outline} to trace it on a drawing exactly as above.
- {button:Re-measure|outline} on one that already has a number.
- A bin to take a room off the list. **Taking a room off does not touch the
  rest of the job** — only that room and its area go.

The panel adds up what the floors come to, so you can check it against the
plan's own figure.

### Two rooms with the same name

A `Bathroom` upstairs and a `Bathroom` on the main floor are two rooms, and
both are allowed as long as they are on different floors. Two by the same
name on the SAME floor are one room — paste the list twice and nothing is
duplicated.

### Seeing them afterwards

Once measuring is done the walk starts its questions, and the numbers stay on
the right under **The building** and **The rooms** for the rest of the walk.
They belong to the job, not to this walk: start a second estimate on the same
job and they are already there — it will still ask whether any rooms are
missing, but nothing has to be measured twice.

## Then it agrees the usual

The last thing before the first phase, and only when there is something to
take as read: standards on your outline (*Usually*, on a question — see
[Estimate outlines](estimate-outlines.md)), or phases the estimate already
has lines for.

It lists what it is about to take as read, grouped so it is short enough to
actually read:

> Before we start, here is what I will take as read — 3 questions across 3 phases:
>
> - Who is doing this one? In-house — Cast-in-place concrete, Site work and excavation, Drywall
>
> And these phases are already on the estimate, so I will move past them:
>
> - Drywall — $6,952.50 in 2 lines, off the model
> - Roofing — $4,100.00 in 1 line
>
> Right for this one? Anything you say no to, I will ask you about as we go.

{button:That's right|outline} takes them, phase by phase, as the walk reaches
each one. {button:Ask me everything|outline} takes none of them on this bid
and asks every question as usual.

**A phase the estimate already has.** When you brought the takeoff in off
the model, typed an item by hand, or walked this estimate before, some phases
already have lines. A phase's lines are the ones on its cost code, or in the
item made by the assembly the phase is pinned to — never a guess from the
words. The gate names each such phase with what is on it, how many lines and
where they came from (*off the model* when the takeoff made them). With
{button:That's right|outline}, a covered phase's questions are settled as it
opens — every one except a question marked *always ask*, which is asked
whatever the estimate holds — each marked *passed — already on the estimate*
in *What you have said*, and the walk moves past the phase without pricing it
again. With {button:Ask me everything|outline} the questions are asked, but
the phase still ends in the money it already has rather than a second set of
lines: no button here ever prices the drywall twice. On the rail the phase
reads *2 lines already on the estimate, off the model* with its amount; lines
nobody has priced yet read *no prices* instead, and the phase stays a hole
until they are.

**It never takes one quietly.** Each answer it settles this way is marked
{badge:your usual} where you can see it — in *What you have said* and in the
phase's panel on the rail — and {button:Ask again|ghost|rotate-ccw} re-opens
it exactly like an answer you typed.

## The screen

Across the top: the phase you are on, what number it is out of how many, and
what your business wrote as guidance for that phase. The line beside it counts
what you have answered, what got passed over, and how many questions **it
thought of** — ones your outline did not contain.

While it is asking you for prices the header adds **what it costs** beside the
phase name, and keeps naming **the phase the money belongs to** — the one whose
questions you have just finished, not the one you are about to start. The panel
on the right stays on that phase too, so what you said about it is still beside
you while you price it.

### The rail

Under that is a row of small squares, one for every phase in your outline, in
the order they are walked. Hover over one to see which phase it is and where
it stands. The colours are the same everywhere in this screen:

- **Green** — priced. Lines from this phase are on the estimate.
- **Amber** — out for bid. Subcontractors have the scope and nobody has been
  chosen yet.
- **Red** — answered, and nothing came of it. This is the one to look at.
- **Grey** — not walked yet.
- **Outline only** — by others, so it belongs in your exclusions.

The phase you are standing on has a ring around it. **Click any square** to
open that phase, which you can do at any time without losing your place.

### Opening a phase

The card that opens shows the phase, its cost code, where it stands and what
it comes to. Under that is every question asked on it and what you said.

- {button:Work on this|secondary} takes the walk to that phase and asks its
  next question. It appears on a phase you are not already on **that still
  has a question nobody has answered** — if everything on it is answered
  there is nothing for it to ask, and *Ask again* is the way in instead.
- {button:Ask again|ghost}, beside any answer, asks you that one question
  again. The walk goes there and puts the question back on the screen.
- {button:Close|ghost} shuts the card. Clicking the same square again does
  the same thing.

**Asking again does not erase what you said.** The old answer stops counting
and stays in the record, so the transcript still shows what you said at the
time and what you changed it to.

**Both buttons work on a finished walk**, and the card says so. Using either
one picks the walk back up on that phase; when the phase is answered, its
lines are worked out and priced as usual, and the walk finishes again as soon
as nothing anywhere is outstanding. You are never stuck reading a bid you
cannot fix.

### Answering

The question sits on the left. Under it:

- **Buttons**, when the question has set answers. Tap one and it moves on.
- **A box** for anything else. Type as you would talk — *"poured, nine foot,
  and there's a brick ledge on the front"* — and it will take three answers out
  of one sentence if they are in there.

You can always type instead of tapping, even when there are buttons.

### What you have said

The panel on the right keeps this phase's answers as you give them. A question
it asked that was not on your list is tagged {badge:it asked}, which is worth
watching: those are the questions worth adding to your outline.

Underneath, **Still to come on this step** lists what the phase has left.
{badge:always ask} marks one it is not allowed to pass over.

### The two links at the bottom

{icon:player-skip-forward} **Come back to this** passes over the question in
front of you. It is recorded as passed, with you named as the reason, so it is
not mistaken later for a question nobody got to. You can do this even on an
`always ask` question — that mark stops the *walk* deciding it does not apply,
not you.

**Stop the walk** ends it. Your answers are kept and your estimate is exactly
as you left it. Starting again later begins a fresh walk.

## What it does on its own

**It asks past your list.** This is the point of it. Say walkout basement and
it will want to know about the retaining wall and the egress windows whether
you wrote those down or not. On a conversion it will ask how much of the
existing frame you are keeping. Your outline is the floor, not the ceiling.

**It passes over what your answers made pointless**, and tells you why — no
question about rebar after you said the wall is block. Anything it passes over
is recorded with its reason, so you can see later what it decided and why.

**It will not pass over an `always ask` question**, however the conversation
goes. That is what the tick on those questions is for.

**It does not price anything.** It gathers; the numbers are a separate step.
If you ask it what something costs it will say so and carry on.

## What a phase costs

**A phase ends in money.** When its questions are done the walk works out
the lines — the material, the labour, the subcontract — and then **asks you
for every price it cannot find**:

> Roofing labor — what are you getting for that?
>
> Footing concrete, 240 lf — what are you getting per lf?

Type a figure. It goes on that line with the basis reading *you said it*, and
the walk asks for the next one. When they are all in, the item goes on the
estimate and it tells you what the phase came to.

Four things worth knowing:

- **The header says whose money it is.** While the prices are being asked it
  reads the phase they belong to with **what it costs** beside it —
  *Gutters · what it costs · step 5 of 10* — and the square for that phase
  keeps its ring on the rail. The walk has not moved on yet, and neither has
  the header.
- **The question says which number it wants.** *Per lf* when there is a
  quantity, the amount outright when the line is a lump. That is not fussiness:
  `$3,400` read as a rate against 240 lf is **$816,000**.
- **One figure at a time.** *"About twelve, maybe fourteen"* gets asked again
  rather than averaged. Picking for you is how a wrong price reaches a client.
- **{button:Skip this one|ghost} is a real answer.** The line stays unpriced
  and shows red in *The whole bid* at the bottom, which is what that panel is
  for. Nothing is lost and nothing is guessed.

**It only asks about prices it has not got.** A price is found without asking
when the work is a [saved assembly](#assemblies), when a subcontractor's bid
has been awarded for that phase, or when **you priced the same thing on an
earlier job**. That last one is the important one: every figure you give here
is remembered, so the first bid you walk is where your price book comes from
and the next one barely asks.

## Turning a phase into lines

Once you have told it something about a phase, {button:What does this come to?|outline|receipt} appears under the conversation. It works out the lines that phase adds up to and shows them before anything is written.

Each line carries a chip saying **where its number came from**:

- `assembly` — built from one of your saved items, at the size you gave.
- `your last price` — what you charged for that same line last time, with how long ago so you know how much to trust it.
- `you said it` — a figure you gave in this conversation.
- {badge:needs a price|warning} — it knows what the line IS and has nothing to price it with.

**It will not make a price up.** If you have not priced that line before, have no assembly for it, and did not say a figure, you get the line at zero with `needs a price` on it. That is the tool working, not failing — a number that looks right and is not would go out in a proposal.

Quantities work the same way. A figure you said is used as you said it. A figure it worked out shows its arithmetic beside the line — *"2 baths at 3 fixtures each"* — so you can check it at a glance. A figure it can neither quote nor explain becomes a quantity of one for you to fill in.

{button:Put it on the estimate|primary} adds them as one item named after the phase, with the lines inside it — the same shape as anything you build by hand, so the proposal prints it normally. {button:Not yet|ghost} leaves it alone.

**A line that covers rooms says which.** The rooms are written into the
description in the spelling your room list uses, so the same room reads the
same on every bid and you can see at a glance that nothing was missed —
*"LVP flooring — Great room, Kitchen, Dining"*.

**Whether that is one line or several is the item's own setting, not a
judgement.** An assembly set to *A line for each room* comes out as a line per
room, each named after its room and sized by that room's floor area when it is
priced in the unit the rooms are measured in. One set to *One line, naming the
rooms* comes out as a single line. You set that once on the assembly
(*Assemblies* on the projects page), and a step can name the assembly it
always makes (*Always makes*, on the outline), which is how a phase comes out
the same on every bid.

**A phase built from an allowance is an allowance.** If the assembly a phase
used is one you have marked as an allowance — plumbing fixtures, light
fittings — the item it lands in is marked as one too, so it prints as an
allowance and becomes a selection when the client accepts. Change your mind on
any bid with the chip on the item.

**A phase you walk twice is still one item.** Go back into a phase, answer it
again and price it, and the new lines replace the ones that phase put on
before — in the same item, keeping the name if you renamed it, and leaving
alone any line you added to it yourself. You never end up with the same phase
on the bid twice.

**Nothing is written until you press the button**, and answering anything else clears the working-out, because it was about the answers as they stood.

## The whole bid

At the bottom of the screen, always, is what the whole bid stands at. It has
one job: **tell you whether this bid is finished.**

The line at the top counts the phases that are priced and what they come to in
cost. Under it, either:

- **Every phase is priced, excluded or asks nothing** — there is nothing
  outstanding, and the bid is ready as far as this tool can tell.
- **N phases are not finished** — followed by each one and why.

### Rooms with nothing on the bid

If the job has [rooms](#then-it-asks-what-rooms-are-in-it), an amber note names
any the bid never mentions: *"Powder room, mud room and garage have nothing on
this bid."*

This is the thing a price sheet cannot do for you. A blank row on a spreadsheet
looks exactly like a row that does not apply, and the one you meant to come
back to is the one that costs you. Here it has a name.

**It reads the lines' own words.** A line that says *"LVP — great room, kitchen
and dining"* covers three rooms; a line that just says *"Flooring"* covers none
as far as this can tell, so it will name rooms you have actually priced. That
is deliberate — it would rather point at something you have done than stay
quiet about something you have not.

**It is not a problem to fix.** It is amber, not red, and it is never counted
in *N phases are not finished* — a garage with nothing against it is usually
exactly right. It is there to be looked at once before the bid goes out.

The reasons you will see:

| What it says | What happened |
| --- | --- |
| answered, nothing priced | You went through the phase and no lines ever reached the estimate. |
| bidding it out, nobody asked | You said you were subbing it and no bid request went out on that cost code. |
| allowance never set | A money question was passed over, or answered without a figure. |
| N lines on the estimate, no prices | The walk worked out what to price and could not work out what it costs, so the lines went on at nothing. |
| a bid chosen, not on the estimate yet | You went with a subcontractor's price and it has not been put on. |
| N still to ask | The phase has questions nobody has answered. |
| N asked · N back | Subcontractors have it. Nobody has been chosen. |

Click any of them to open that phase.

**What is out for bid is not in the figure.** A price nobody has chosen is not
a number yet, so the total counts only what is actually on the estimate. The
line under those rows says so.

**A line you deliberately carry at nothing is not a hole.** *Supplied by the
owner*, *by others*, *included in the plumbing quote* — price it at zero
yourself and the phase stays priced. Only a line the walk could not put a
number on counts against you.

**A phase you priced and then deleted the lines for goes back to red.** The
figure follows the estimate, not the walk, so if you typed over a generated
price it is your number that counts.

## When it finishes

**A walk closes when there is no phase left with a question nobody has
answered** — not when it reaches the bottom of the list. Answer the last phase
on your outline while an earlier one is still untouched and the walk goes back
up to it rather than ending over it.

When there really is nothing left to ask, the walk closes and says so — and
**the screen stays where it is** so you can read what is left. Running out of
questions is not the same as having a finished bid: a phase can be answered
and unpriced, out for bid, or waiting on an allowance.

{button:Back to the estimate|primary} takes you back whenever you are ready.

**A finished walk is not a closed door.** Click a phase on the rail and work
on it or ask a question again, and the walk starts up again on that phase —
prices it, puts it on the estimate, and finishes again when nothing is
outstanding. Walks finished before this worked that way may say *This walk
stopped with N phases still to ask*; those phases are exactly where to start.

If you leave and come back later, the estimate itself will tell you: the panel
above the lines reads *The last walk left N phases unfinished*, with
{button:See what is left|outline} to come back to this screen.

## If it will not answer

**The walk carries on without it.** If the part that reads your sentences is
slow or unavailable, it tries again and then simply asks the next question on
your outline, in the words you wrote. You will not see an error, and what you
just said is banked against the question you were asked.

What you lose while that is happening is its judgement: it asks one question
at a time, takes one answer at a time, and will not notice a gap your list
does not cover. The walk still works, and everything is still recorded.

*Give it a moment* means two goes arrived at once. Send it again.

**If the screen and the walk ever disagree** — you answer and it says *That
had already moved on* — then the question you were looking at had already
been dealt with, and the walk has put the real one up. **Nothing is recorded
against a question you could not see.** Answer the one now on screen.

## See also

- [Estimate outlines](estimate-outlines.md) — the questions a walk asks, and how to change them.
- [Jobs](overview.md) — what a {{project|lower}} is, and everything else on one.
