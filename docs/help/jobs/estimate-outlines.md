# Estimate outlines

> The order you price a job in, and what you ask yourself at each stop. Set one up here and you can walk an estimate instead of typing it, going through the job step by step and answering questions.
> **Route:** /dashboard/m/jobs/estimate-outlines, /dashboard/m/jobs/estimate-outlines/*
> **Order:** 260

## What an outline is

An outline is your own list of the phases of a job, in the order you price
them, with the questions you ask yourself at each one. Foundation, then
framing, then roofing — and under Foundation, *who is doing this one*, *block
or poured*, *how many linear feet of footing*, *any rebar*.

It is a checklist, and its whole job is that **nothing gets missed**. You write
it once, you edit it whenever something bites you on a job, and every estimate
you walk from then on asks what you decided it should ask.

**You need one per kind of job.** A remodel is not a small new build: it starts
with what comes out, what gets protected and what is behind the wall that
nobody can price until it is open. Half those steps have no place on a bare
lot. Keep a `New build` and a `Remodel` and they stay out of each other's way.

If you do not see this screen, your business has not been given this feature
yet, or an owner has turned it off under
[What you use](/dashboard/m/jobs/setup).

## The list

Every outline you keep, the default first. Each one shows its name, what it is
for, and a count underneath: how many steps, how many questions, and two things
worth knowing —

- **`asking nothing`** — steps with no questions on them. That is allowed; a
  walk will simply pass straight through them. It is here because a step you
  meant to write questions for and never did looks exactly like one you meant
  to leave empty.
- **`with no cost code`** — steps whose lines would not land anywhere in your
  budget. Also allowed, also worth a look.

{badge:Default} marks the one a walk uses when nobody picks another. There is
always one, or none — never two.

### The buttons on a row

{button:Make default|ghost|star} — moves the default here. The old one loses it
in the same moment, so you never have to clear it first. A retired outline
becomes active again when you make it the default.

{button:Duplicate|ghost|copy} — copies every step and question into a new
outline under a name you type. **This is how a second outline actually gets
made**: nobody writes a remodel walk from nothing, they take the new-build one,
delete the phases a remodel does not have and add demolition. The copy is its
own rows, so editing it can never reach the original.

{button:Delete|ghost|trash} — removes the outline and everything under it. It
tells you how many steps go with it first. **Estimates you have already written
are not touched** — an outline is a script, not part of the money.

Only an owner sees these. Anyone on the team can read an outline, because
anyone being walked through one needs to be able to.

## Starting a new one

{button:New outline|primary|plus} opens a small form.

`Name` — what you call this kind of job. `Remodel`, `Garage package`,
`Commercial fit-out`.

`Start from` — and this is the one worth reading. Pick one of your cost code
lists and you get **a step for every piece of work in it, in the same order,
each one already asking who does the work**. Your chart of cost is already the
phases of your work in the order you build them, so this is far quicker than
typing thirty step names. Then prune the phases this kind of job never has and
write the real questions into the ones it does.

**A step is a piece of work, not a code.** Charts often carry several codes
for one phase — labour, material, a subcontractor, mileage. You do not want to
be asked about each of those in turn, so codes whose names begin the same way
are folded into one step named after what they share: `Excavation Labor`,
`Excavation Trucking` and `Excavation Material` become one step, **Excavation**.
A 291-code chart comes out as about seventy steps.

It reads your names, so it occasionally joins two things or splits one. It
leans towards splitting, because merging two phases into one loses the
questions you never got asked. Fix either in a moment by renaming a step or
deleting one.

**If your codes are grouped**, that grouping comes across as each step's
section — see below.

Pick `Nothing — start empty` if your codes are not in build order, or if you
would rather write the walk yourself.

The first outline you make becomes the default, so you are never asked which
one to use when you only keep one.

## Editing an outline

Opening one puts the whole thing on a single page. Change anything you like and
press {button:Save outline|primary} once — nothing is written until you do, and
the button reads `Saved` and goes quiet when there is nothing left to save.

At the top, `Name` and `What it is for`. The line underneath counts your steps
and questions, and repeats the two gaps from the list.

If something is wrong, a red sentence appears beside the button and saving is
held until you fix it. It says one thing at a time, in the order you would read
the form: a step with no name, two steps called the same thing, an empty
question, a `Pick one` with fewer than two options, or the same question asked
twice in one step.

### A step

Each step is a panel with four things.

**The number**, in the small box on the left. **Type over it to move the step**
— if a step is 12 and you want it right after 2, change the 12 to 3 and it goes
there. The same as moving a row on an estimate.

**The name** — what the walk says out loud. `Foundation`, `Demolition`,
`Rough framing`.

## Measure first

At the top of an open outline is **Measure first** — the numbers the walk
collects about the building *before* it asks anything.

The walk asks for each of these one at a time, with
{button:Measure it on a drawing|outline} beside the box, and then keeps them
in front of it for the whole walk. That is the point of the list: give it the
wall area once and it works from it at insulation, at drywall and at paint
instead of asking you three times.

**What belongs here is a number more than one phase needs.** A perimeter is
your footing, your foundation wall, your backfill and your siding. A number
only one phase ever reads is better as a question on that phase — putting it
here only makes the walk longer before it starts.

{button:Add one|outline} opens a short form:

| Field | What it is |
| --- | --- |
| **What it is** | The name, as you would say it: *Wall perimeter*, *Roof area*. It is also how the number is stored, so two outlines asking for *Wall perimeter* are asking for the same one number. |
| **In what** | The unit the answer is in — `lf`, `sf`, `ea`. It goes into the question, because the answer is a bare figure. |
| **How it is taken** | A length, an area or a count. This is which drawing tool gets offered, and **only traces of that kind are offered back** — ask for an area and nobody can hand you a length. |
| **What to include, in your own words** | Shown in brackets after the question. *"Outside face of the foundation, all the way round"* is the difference between two estimators getting the same number and getting different ones. |
| **Always ask for this one** | On, and the walk asks for it every time. Off, and it still asks, but it is fair game to wave past. |

{button:Change|ghost} edits a row in place; the bin takes it off the list and
asks once before it does.

**Taking one off does not unmeasure a job.** The numbers belong to the jobs
they were taken on; this list only decides what future walks ask for.

**An outline that already existed does not get the starter list.** Nothing
ever puts rows back into an outline you have — that is the same rule that
stops a deleted step reappearing. Add the ones you want; it takes a minute and
they are yours from then on.

## Bringing questions in from another outline

An outline read off your chart has the right steps and one question on each.
If you have already written good questions into an older outline,
{button:Bring questions in|outline} at the top of the page copies them across
instead of you typing them again.

Pick the outline to take them from and you get **one row per step that has
questions**, with the step it matched to already chosen and the reason it
matched. Then:

- **Check every row.** It matches on the names, which is guesswork. On a real
  pair of outlines it placed about three quarters of them, and a few of those
  were nearly right rather than right — the sort of thing only you can see.
- **Point a row somewhere else** with its dropdown, which lists every step in
  this outline under its section.
- **Leave a row alone** if nothing here should take it. Anything it could not
  place is already set that way.

{button:Copy onto N steps|primary} writes them. Nothing happens until you
press it.

Three things worth knowing:

- **Questions are added, never replace.** They go after whatever the step
  already asks, so the `Who is doing this one?` a generated outline carries
  stays where it is.
- **A question the step already asks is skipped**, so doing this twice changes
  nothing the second time. The message afterwards says how many were already
  there.
- **The outline you took them from is not altered.** This is a copy.

Everything about a question comes across — its buttons, its unit, its notes,
and whether it is always asked.

**The section** — the part of the bid this step belongs to.
`Infrastructure`, `Structural`, `Mechanical`, `Finishes`, `Labour`, whatever
you head your own price sheet with. It arrives filled in when the outline was
read off a chart that groups its codes, and as you type it offers the sections
already in use so they stay spelled the same.

**It is not the same thing as the cost code's group, and it is yours to
change.** A code can be accounted under one heading and printed under another:
siding labour might be charged to `Structural` and shown to the client under
`Labour`. The code says where the money goes; the section says where the row
is read. Leave it blank and the step simply has no heading.

**The cost code** — written as the digits you use, `2000` or `03 30 00`,
matched against whichever cost code list the job is on when you walk it.
Spacing does not matter. Leave it blank if this step's money does not belong to
one code. A code the job's list does not have simply means no code on those
lines, never a guess at a near one.

On a step read off a chart that had several codes for the phase, **this is the
first of them, as a starting point rather than an answer** — a step covering
eight codes has no single one. The lines a walk produces carry their own codes;
this one is what a bid request is matched on, and it is meant to be edited.

**Beside the box, the screen tells you where that code lives.** If every one of
your cost code lists has it, you just see what it is called — `Foundation`. If
only some do, it says which do not: `Foundation · not in CSI divisions`, which
matters because a job running on that list would come out uncoded at this step
and nothing else would ever tell you. If no list has it at all you get
`not in any of your cost code lists`, and a line at the top of the outline
counts how many steps are in that state. That line is how you catch a typo
before a bid goes out with a hole in its budget.

**The guidance box** underneath — what has to be established at this step, in
your own words. This is where you write the thing that is true of *your* work:
that you never sub framing, that a walkout needs the engineer's number before
anything is priced, that the footing quantity comes off the foundation plan.
The walk reads it. Your client never sees it.

{button:|ghost|trash} at the right removes the step and its questions.

### A question

{button:Add a question|outline|plus} puts a new one at the bottom of the step.
Each has:

**The question itself**, as you would ask it. `Block or poured?`

**The answer kind**, which is what decides the buttons a walk shows:

- `Pick one` — a set of buttons. Type the options into the box that appears,
  **one per line**. You need at least two; blanks and repeats are dropped.
- `Yes or no` — two buttons.
- `A number` — a quantity. Name the unit beside it (`lf`, `sf`, `ea`) so the
  answer comes back as something an estimate can use.
- `An amount` — money: a quote, a price, an allowance.
- `Anything` — typed or said.

**The notes line** — when to ask it, what to watch for. *"Only when they are
pouring."* *"A no here is worth going back to the foundation step for."* The
walk reads this; the client never does.

**`Always ask`** — the tick at the bottom. Normally the walk uses its judgement
and skips a question your earlier answers made pointless: it will not ask about
rebar after you said block, and it tells you it did not. Tick this and it may
never make that call. Keep it for the handful where **being asked is the whole
point** — asbestos on an old house, whether a permit is needed, who carries the
risk on what is behind the wall. It means always *asked*, not always
*answered*: you can say you do not know yet, and it comes back at you before
the bid goes out.

Tick everything and the mark stops meaning anything, so the starters mark about
one question in ten.

{icon:chevron-up} and {icon:chevron-down} move a question within its step, and
{button:|ghost|trash} removes it.

## What does not branch, and why

There is no way to say "only ask this if the answer to that was poured", and
that is deliberate. **The outline's job is coverage — that nothing is missed.
The walk's job is judgement.** It skips *any rebar?* when you said block, and
it tells you it skipped it. Writing branching rules yourself would mean
maintaining a second, invisible thing that goes wrong quietly.

So write every question you would ever want asked for that phase, and put the
"when" in its notes. The walk also asks things your outline never contained,
when an answer opens a door — say walkout basement and it will want to know
about the retaining wall and the egress windows whether you wrote them down or
not. The outline is the floor, not the ceiling.

Tick `Always ask` on the few that must survive its judgement.

## Turning it off

An owner can switch the whole thing off under
[What you use](/dashboard/m/jobs/setup). Your outlines are kept, this screen
goes away, and **every estimate you have written stays exactly as it is** —
walking an estimate produces an ordinary estimate, so there is nothing to
unwind.

## See also

- [Jobs](overview.md) — what a {{project|lower}} is, and everything else on one.
