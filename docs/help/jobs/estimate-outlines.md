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
lists and you get **a step for every code, in the same order, each one already
asking who does the work**. Your chart of cost is already the phases of your
work in the order you build them, so this is far quicker than typing thirty
step names. Then prune the phases this kind of job never has and write the real
questions into the ones it does.

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

**The cost code** — written as the digits you use, `2000` or `03 30 00`,
matched against whichever cost code list the job is on when you walk it.
Spacing does not matter. Leave it blank if this step's money does not belong to
one code. A code the job's list does not have simply means no code on those
lines, never a guess at a near one.

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
