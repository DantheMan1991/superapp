# 0039 — A pack declares what it can be told in one sentence, and its own verb records it

- **Date:** 2026-09-09
- **Status:** Accepted, amended by [0050](0050-a-safe-verb-records-itself.md) (a verb may declare that a complete card of it records itself) and [0051](0051-the-way-in-is-the-shell-not-a-page.md) (the box lives in the shell, not on a page — superseding the placement consequence below); everything else here stands
- **Affects:** `src/lib/tell-sources/` (a declared extension point), the livestock pack as its first filler, the daily round page

## Context

The onboarding plan's third problem is the daily habit, and the founder named
it first: *"we need to explore how to super simply enter data in on a day to
day basis so it is not overwhelming."* The money side is largely solved — the
bank feed brings transactions in and rules code them. The farm side is not.

"Three chicks dead in pen two" is one sentence and, today, four screens: open
Livestock, find the pen, open the daily round, open a dialog, type a number,
pick a reason. Every one of those screens is good, and the daily round in
particular is already built for a phone in a barn. The cost is not any single
screen; it is knowing which one, while holding a bucket.

The product already has the machinery this needs. `paste-targets` (ADR 0036)
established that a module declares FIELDS as data plus its own verb, and the
platform runs the model, draws the review and writes nothing itself. What a
paste cannot do is choose between KINDS of thing: it loads many rows of one
shape, and a sentence describes one or two events of different shapes.

## Decision

**A pack declares the ACTIONS it can be told, and the platform runs one
model call over all of them.** `src/lib/tell-sources/types.ts` is the
seventh declared extension point: a source contributes `actions`, each with a
slug, a title, an `about` telling the model when to choose it, FIELDS (text,
number, date, or a choice among labels read live from the tenant), and
`record`, which calls the pack's own verb. The model picks the action and
fills the fields; the platform resolves them, draws a card each, and records
only what a person confirmed.

**The three rules of ADR 0036 carry over unchanged**, because the same things
are true:

- **The model never writes.** Proposing and recording are two actions, and
  the second takes only the confirmed cards.
- **Choices resolve by label, never nearest.** A word matching no paddock is
  kept as a HINT beside the empty field. "Pen" does not pick "Pen 2" when
  "Pen 3" exists.
- **The pack's refusals are the refusals.** `record` calls the verb the
  pack's own screens call.

**All the cards or none.** Two things said in one sentence happened together,
and half of them landing is a worse state than none. One transaction, every
card checked before any is recorded.

**The date defaults to the tenant's today, and only the date.** A field
marked `defaultToday` fills in when the sentence says nothing about when —
because it is being typed where it happened, on the day. Every other blank
stays blank.

**No role check in the slot.** Each action records through its pack's verb,
and that verb's level is the rule: `allowsWrite` clears `expert` at `member`
deliberately, because in a pack the outside accountant is a member and
walking the round is a chore. A second rule in the slot would be a second
opinion.

## What livestock declares, and what it does not

Losses, a check with a note, a move onto a paddock, and a feed — the three
sentences the plan opens with, plus the one that says nothing happened.

**Not treatments.** A treatment sets the withdrawal clock that decides
whether meat may be sold, and its route and dose change that clock. It would
be the one place in this pack where a misread word has a food-safety
consequence, and the form asks four questions for that reason. **Not
weights**, for a duller reason: nobody says a weight out loud without a scale
in the other hand, and the scale screen is already open.

## Alternatives considered

- **A dialog per verb, reachable from a command palette.** Faster to build and
  it solves nothing: the problem is not opening the dialog, it is knowing
  which dialog and which pen.
- **Free-form notes, parsed later.** A note that nobody parses is a note, and
  the head count still disagrees with the pen. The value is that the count
  moves.
- **Let the model write, with an undo.** The pack's verbs move stock and
  head; undoing a wrong pen means finding it first. The CRM decided this in
  slice 11 and nothing has changed.
- **A schema branch per action in the tool.** A `oneOf` over a dozen shapes,
  long to send and no more accurate. The fields are described in the tool's
  text and judged per action afterwards, where the tenant's own choices live.
- **Ride the livestock Ask thread**, as the plan first sketched. Ask is a
  conversation that answers; this records. Sharing a thread would mean one
  box where half the sentences change the herd and half do not, which is the
  ambiguity the confirm step exists to remove.

## Consequences

- No migration. Every action writes through a verb that already existed.
- ~~The box lives on the livestock daily round, because livestock is the only
  filler. When a second pack fills the slot the box belongs somewhere both
  can be reached from — What needs you — and moving it is a page change, not
  a change to any source.~~ **Both halves happened exactly as written, and
  then ADR 0051 superseded the whole line**: the question it answers is "where
  can it be reached from", which turns out not to be "where should the way in
  live". The control is in the shell now, on every page.
- A pack that composes another must wrap that one's refusals too: livestock's
  feed issues stock, so `InventoryError` and `LandError` arrive as legitimate
  refusals and are surfaced in their own words. The first version wrapped only
  `LivestockError`, and a feed of nothing came back as "something went wrong".
- The per-tenant cooldown is in-process, like the paste dialog's. It stops a
  double submit from two tabs on one server; the disabled button is the real
  guard.
- The model is shown the sentence and the labels of the choices — this farm's
  pens, paddocks and feeds. Nothing about what is in them (S9).
