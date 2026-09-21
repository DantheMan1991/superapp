# 0100 — A measurement is a fact about the building, not an answer to a question

- **Date:** 2026-09-20
- **Status:** Accepted
- **Affects:** Layer 2a — the `jobs` pack, the estimate interview (X7). Extends [0098](0098-an-estimate-outline-is-the-tenants-and-a-question-is-a-row-so-an-answer-can-point-at-one.md) and [0099](0099-a-walk-is-finished-when-nothing-is-outstanding-not-when-the-questions-run-out.md); uses the takeoff of [0074](0074-a-measurement-is-a-markup-with-a-quantity-the-scale-is-the-sheets-and-a-takeoff-is-a-quantity-pushed-onto-an-estimate-line.md).

## Context

Three complaints, which turned out to be one.

**The founder, after walking a real bid:** *"I don't see where it allows you
to open the takeoff inline. Everything should be seamless and snappy and just
part of the flow. There are numerous times it asks for a square footage. I
need the takeoff tool to get that a lot of the time."*

**And then, unprompted:** *"What if before the questions it prompts you to
grab measurements. Full exterior elevation square footage, wall square
footage, wall perimeter etc. Then the questions can use this information as
it goes."*

**And a defect nobody had reported, because it does not look like one.** The
walk carries the last thirty answers into its prompt (`EARLIER_CONTEXT`). A
new build outline read off a real chart of cost runs to seventy-three steps
and well over a hundred questions, so **a walk told 2,400 square feet at
framing has forgotten it by drywall** — and asks again, or prices a phase
without it. The tool's whole promise is a bid in forty-five minutes; a
conversation that cannot remember the house cannot keep it.

The obvious fix for the first complaint is a *Measure it* button on any
question that wants a number. It would have been the wrong shape. Measuring
is a different MODE from talking: open the sheet, wait for the PDF, set the
scale, trace the polygon, read it back. Doing that fifteen times inside a
conversation breaks the rhythm fifteen times, and it does nothing at all for
the forgetting — a measured number recorded as an ANSWER falls out of the
prompt exactly as a typed one does.

## Decision

**A measurement is a fact about the BUILDING, kept apart from the
conversation that collected it.** `job_measurements` hangs off the project,
not the estimate and not the interview: the wall perimeter does not change
between revision one and revision four, and it does not change because
somebody started a second walk. Its identity is the reduced name, unique per
project, so re-measuring corrects one row rather than making a second.

There is a handful of them and they are short, so **they go into every turn's
prompt**, from the first phase to the last. That is the whole return on the
decision: the walk stops asking for numbers it was already given, and can do
arithmetic out loud from them — *"wall area is 2,232, so that is about 70
sheets, right?"* — which is the conversation the founder asked for in his
first brief and had not got.

**Arithmetic on a number you were given is not pricing.** The walk's rule 2
forbids it inventing a quantity; the prompt now says in the same breath that
working from a measurement it was HANDED is expected. A model that read rule 2
as "no arithmetic" would hold the numbers and do nothing with them.

**What to measure is the tenant's**, by the same argument that made the
outline theirs: `job_estimate_outline_measures` is a list beside the steps and
the questions, seeded from the profile, editable to nothing. A remodel wants
different numbers from a new build and a commercial shell wants different ones
again — the construction starters say so, and nothing in the pack names a
measurement. The test for belonging on the list is whether MORE THAN ONE phase
reads the number; one that only one phase needs is a question on that phase.

**It runs before the questions, once**, stamped with `measured_at` rather than
derived. Deriving it from "is every declared measurement answered" would drop
every walk in progress back into measuring the moment somebody added a
measurement to the outline — and the outline is theirs to edit while walks are
running.

**The drawings open over the walk, in the same viewer.** *Measure it on a
drawing* picks a sheet and puts `SheetViewer` in a dialog behind one new
optional prop. Not a cut-down copy: that component is a thousand lines of
pdf.js, scale and geometry, and a second one would be a second thing to keep
right. Only traces of the KIND being asked for are offered, because a length
handed back for an area is a number that means nothing and would multiply
through every line that read it. Several traces of the right kind offer their
total, since a roof is three planes and a perimeter is one run.

**The model is not in this path.** The rule [X6](../modules/jobs.md) set for
prices, and a harder reason: a wrong price is wrong once, a wrong measurement
multiplies. The question is written from the row, the answer is read by a
parser, and it is written to the row whose id was on the screen.

**But the parser reads what an estimator types.** `2,400 sf`, `38'-6"`,
`24 x 40`, `40 + 24 + 40 + 24`. Refusing those would be correct and useless.
Three limits keep it honest:

- **Two figures with no operator between them is not an answer.** `240 to 260`
  is asked again rather than averaged — X6's rule, unchanged.
- **Subtraction is not read at all**, because `38-6` is feet and inches to the
  person typing it and reading it as arithmetic would silently make it 32.
- **One figure among words it does not know is still that figure.** *"2,400 sf
  gross"* is 2,400; two numbers among words is still unclear.

**A pass is a real answer and it sticks.** `not on this job` or `I will get it
later` is recorded, so the walk stops asking. A row carries a value or a pass,
never neither, and the database refuses the third case.

**The trace is provenance, not the value.** A measurement keeps the sheet and
the markup it came from, and both `SET NULL` when those go — the number was
true when it was taken. Re-scaling a sheet does not silently move a
measurement already recorded, because a bid that changed underneath somebody
is worse than one that is out of date where they can see it.

## Consequences

- A measurement outlives the walk that collected it. A second estimate on the
  same job starts with the building already measured, and so does a walk
  somebody abandoned and restarted.
- `LoadedWalk` gained the project, the declared list and the measurements, so
  there is one place they are read and nothing downstream can render a number
  the turn did not see. Three indexed reads, issued in parallel with the two
  that were already there.
- **An outline that already exists does not gain the starter list.** The seed
  skips an outline whole when one by that name is there — [ADR 0098](0098-an-estimate-outline-is-the-tenants-and-a-question-is-a-row-so-an-answer-can-point-at-one.md)'s
  rule, so a re-install never puts back something somebody deleted. Every
  tenant walking today adds their own list on the outline page. That is the
  right trade and it is a real cost, so it is written down here.
- A walk already running when this shipped never measures: `startMeasuring` is
  called when a walk begins and nowhere else. It behaves exactly as it did.
- The takeoff now has two destinations — an estimate line (ADR 0074) and a
  measurement — and they mean different things. A line's quantity is what will
  be built and priced; a measurement is what the building is. Pushing at a line
  stays on the drawings page and is not offered from inside a walk.

## Alternatives considered

**A *Measure it* button on every quantity question.** The obvious reading of
the founder's ask, and the shape that does nothing about the forgetting. It is
also fifteen interruptions instead of one pass. The inline door still exists —
it is how the measure-up itself reaches the drawings — but it hangs off a
measurement rather than off an arbitrary question.

**A fixed list of measurements in the pack.** Faster, and it would have made
the software know one company's house. The standing rule is the founder's:
*"don't narrow the software to just me."*

**A formula engine, so wall area could be declared as perimeter × height.**
Tempting and premature. The walk can already do that arithmetic out loud from
the numbers in its prompt, and show its working in `quantity_note`; a rule
language a builder has to maintain is a cost with no user yet. `source` allows
`derived` so the machinery can start writing one without a migration.

**Keying a measurement by the outline measure it answers.** It would break the
moment a second outline asked for the same number, and the wall perimeter is
the wall perimeter whichever list asked for it. The name, reduced, is the
identity.
