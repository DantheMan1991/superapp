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
{button:Start the walk|primary}. It asks its first question straight away.

**If the panel says there is no outline to walk yet**, that is all that is
missing. {button:Set one up|outline} takes you to
[Estimate outlines](estimate-outlines.md), where starting one from a cost code
list gives you a step per phase in a couple of clicks.

If you leave and come back, that panel says **A walk is part way through** and
how far you got. {button:Pick it up|primary} carries on exactly where you were,
down to the question you were on — nothing is lost by closing the laptop.

## The screen

Across the top: the phase you are on, what number it is out of how many, and
what your business wrote as guidance for that phase. The bar underneath fills
as phases are covered, and the line beside it counts what you have answered,
what got passed over, and how many questions **it thought of** — ones your
outline did not contain.

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

**Nothing is written until you press the button**, and answering anything else clears the working-out, because it was about the answers as they stood.

## When it finishes

When there is nothing left and it has nothing more to ask, the walk closes and
you land back on the estimate. Everything you said is kept against it.

## If it will not answer

The message *It could not answer just then* means the model did not come back.
Send the same thing again. *Give it a moment* means two goes arrived at once.

## See also

- [Estimate outlines](estimate-outlines.md) — the questions a walk asks, and how to change them.
- [Jobs](overview.md) — what a {{project|lower}} is, and everything else on one.
