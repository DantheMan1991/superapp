# 0103 — A step names the item it always makes, and the item says whether it is one line or a line per room

- **Date:** 2026-09-21
- **Status:** Accepted
- **Affects:** Layer 2a — the `jobs` pack, the estimate interview (X11). Extends [0098](0098-an-estimate-outline-is-the-tenants-and-a-question-is-a-row-so-an-answer-can-point-at-one.md) and [0101](0101-a-room-is-a-name-a-floor-and-an-area-and-one-answer-is-shared-out-across-them.md); uses the assemblies of [0086](0086-an-assembly-is-an-item-saved-at-the-size-it-was-priced-and-only-the-quantity-scales.md).

## Context

The founder, after walking a real bid end to end:

> *"I think there is real power to what we are doing and i am exited about
> it, but right now i'm struggling to see that we are going to get the
> consisten items being put on the estimate in the way i want with the
> verbiage i want. how do we cross this bridge?"*

And, asked how his sheet should actually read:

> *"with LVP flooring i typically just have one litem for lvp that lists all
> of the rooms that includes. But for Showers i typically list each one
> seperatly. not always though."*

An assembly (ADR 0086) was already the answer to the first question and had
been since E6. Two things stopped it being one in practice. X10 gave the
library a screen, so a business can now own thirty of them. This is the other
half: **until now the MODEL decided whether to reach for one**, from a list of
names in a prompt, on every bid — and whether four rooms were one line or four
was rule 2b of that same prompt, re-decided from scratch every time.

Both are facts about the business, not judgements about a conversation.

## Decision

**A step may name the assembly it always makes.** `assembly_id` on
`job_estimate_outline_steps`, nullable, with a composite
`(tenant_id, assembly_id)` foreign key. *Drywall* is always *Drywall, hung and
finished*, and the conversation is left with the only thing it is good at,
which is how much of it there is and where.

**Null is the normal case and stays comfortable.** He builds luxury custom
homes — *"a Fully custom wood door... maybe a client wants a safe room"* — and
a step with no pin behaves exactly as every step did before the column
existed. The picker is not even rendered on an outline whose business has no
assemblies yet.

**An assembly carries how it is bid.** `line_shape` on `job_assemblies`, one
of `one_line` or `per_room`, defaulting to `one_line` — which is what the walk
always did. Set it once on *LVP flooring* and every bid rolls it up; set it
once on *Tiled shower* and every bid lists them one by one.

**The rooms a line covers are a FIELD, not a phrase.** The propose tool gained
`rooms`, and the software composes the description from it in the building's
own spelling. X8b asked the model to name the rooms in the words of the line
and got them; a field is what makes them *usable* — you cannot turn *"Tiled
shower — master bath, hall bath"* into two lines without knowing where the
name ends and the list begins, and one spelling per room across every bid was
the original complaint.

**What `per_room` promises, exactly:** one line per room, sized by that room's
floor area **when the item is priced in the unit the rooms are measured in**,
and one of it otherwise. A tiled shower is priced `ea` and comes out one per
room; carpet is priced `sf` and comes out at each room's own area with the
room named in `derivedFrom`. That is a contract an estimator opts into per
assembly, not a guess the software makes.

**Nothing computes a quantity for `one_line`.** A rolled-up line needs one
number, the walk already hands the model every room's area and requires the
working (rule 2b), and a second invisible way to arrive at the same figure is
how two answers to one question get shipped. Rolling up ADDS the quantities,
and **only when both are known** — an unknown is not a zero, and a roll-up
that quietly dropped half would read as a measured number for a floor it
covers part of.

**The prompt still says both, and the code does not rely on it.** `applyPin`
puts the pinned assembly on the first line that has not claimed one, whatever
comes back; `shapeLines` rolls up or splits from the stored value. Telling the
model anyway is what makes the rest of its answer fit — the quantity, the
rooms and the cost code come out addressed to the right item instead of to a
line it invented and then had replaced underneath it.

## Consequences

- A pinned step's first unclaimed line loses its own description, because an
  assembly supplies its own. That is what pinning means. It is visible on the
  line — the basis chip reads *assembly*, and the detail names which.
- **A line that already names another of their assemblies is never
  overwritten.** Driving this found the case: taking that line would throw
  away a decision the estimator's own library supports in order to honour a
  default. When every line has claimed one, the pin steps aside.
- *"Not always though"* stays true and stays his. This decides what the WALK
  produces; the estimate is his to restructure afterwards, and saving the
  result back over the assembly (X10) is how an exception becomes the rule.
- An assembly taken out of the library unpins its steps and never deletes
  one — `ON DELETE SET NULL ("assembly_id")`, the PG 15 column-list form,
  because a bare SET NULL on a composite key can never fire. Proved in
  `pg_constraint` on both databases and by deleting a real assembly in
  `tests/jobs-outline-ops.test.ts`, not by reading the migration.
- `assemblyId` absent leaves a pin alone; `null` clears it. The outline editor
  posts the whole form and always sends it, which is how a step is unpinned;
  a seed or a chart read into an outline leaves it out and cannot silently
  undo one.

## Alternatives considered

- **Leave it to the prompt, and write a better rule 2b.** What shipped in
  X8b, and it works most of the time — which is the problem. The founder's
  question was about consistency, and "most of the time" is the answer he was
  already unhappy with.
- **Split a `per_room` line by dividing its quantity between the rooms.**
  Refused. It would give every room a number nobody stated and nothing
  supports, which is the plausible wrong number this whole layer exists to
  refuse. A room with no measured area gets one of the item, and says so.
- **Compute a `one_line` quantity from the rooms' floor areas.** Refused for
  the same family of reasons: floor area is right for flooring and wrong for
  paint, and the software cannot tell which an assembly is without asking the
  estimator a question nobody wants. The model derives it and shows the
  working; that working is on the line.
- **Let the pin replace every line in the phase.** Refused. Eighty per cent
  of his work is standard and twenty is not; a phase that is always drywall
  can still have a one-off in it, and a pin that deleted it would make the
  feature something to switch off.
