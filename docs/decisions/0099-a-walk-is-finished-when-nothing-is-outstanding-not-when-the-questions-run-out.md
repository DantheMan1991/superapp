# 0099 — A walk is finished when nothing is outstanding, not when the questions run out

- **Date:** 2026-09-20
- **Status:** Accepted
- **Affects:** Layer 2a — the `jobs` pack, the estimate interview (X4). Extends [0098](0098-an-estimate-outline-is-the-tenants-and-a-question-is-a-row-so-an-answer-can-point-at-one.md).

## Context

X2a shipped the walk, X2b turned its answers into lines and X3 sent scopes out
to subcontractors. Each worked. None of them touched the others, and the seam
between them was where the whole promise lived.

The walk closed itself when it ran out of questions, said *"That is the whole
walk"*, and pushed straight back to the estimate. It said that over a bid with
phases answered and never priced, subcontractors who had not replied, and
allowances nobody filled in. **A tool whose entire promise is a finished bid
in forty-five minutes could not tell you whether the bid was finished**, and
the one moment somebody most needed to see what was missing was the moment the
screen navigated away.

The founder's own verdict, after using it: *"We are heading in the right
direction, but we have a ways to go to actually make this right and useful."*

There was a second, smaller hole with the same root. The starter outline's
masonry step carries the note *"a no here is worth going back to the
foundation step for"* — and the tool could not go back. `moveToStep` was only
ever called with the step AFTER this one.

## Decision

**Running out of questions closes the conversation; it does not finish the
bid.** A walk now carries a RECKONING — every step of the outline in one of
six standings, derived on demand from the answers, the lines that reached the
estimate and the bids that went out. The screen stays put when the questions
run out and shows what is left; the estimate says the same thing on the way
back in.

**Money out for bid is not in the total.** A phase with subcontractors' prices
on it and nobody chosen contributes nothing — not the lowest, not the average.

**Going back means superseding an answer, not deleting one.** One nullable
`superseded_at` on `job_estimate_interview_answers`. A superseded row stops
counting everywhere, which re-opens its step, which is what `currentStep`
already follows — so there is no "a person is revisiting" mode anywhere in the
code.

**The must-ask guard polices the walk, not the person.** `moveToStep` gains a
`byPerson` flag, the same split `recordAnswers` already makes.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| A `finish_gate` table, or a `standing` column per step | The pack's habit since the lien waiver (0066) is record the fact, derive the standing. A stored standing is a second copy of the truth that somebody has to keep in step with lines, answers and bids all at once — three writers, one of them a subcontractor on a public link. |
| Carry the lowest bid, or an average, into the total | The plausible wrong number this whole program exists to refuse, at the single worst place to put one: the figure somebody reads just before deciding the bid is ready. Which bid a business is going with is their decision and not an arithmetic (0098, X3). |
| Delete the answer when a question is asked again | A transcript is a record of what happened. An answer that vanished because somebody revisited a step would be a record that lies about what was said at the time. |
| A `revisiting` or `parked` flag on the interview | A second concept for something the existing one already expresses. Superseding makes the step genuinely un-covered, so coverage, the rail, the reckoning and `currentStep` all fall out with no special case. |
| Honour the bookmark even on a covered step | Would have wedged the walk on a step with nothing to ask, and broken the outline-edited-mid-walk behaviour `currentStep`'s fallback was written for. |
| Compute the reckoning inside every turn | Five indexed reads on the critical path of a conversation forty-five minutes long. The founder had already said the first version felt slow. It is a door of its own, called after the turn has landed and never waited on. |
| Restate the bid total (with markup) in the panel | Two arithmetics for one figure is how they drift, and a line inside a fixed-price item does not contribute its own price at all — so the panel would disagree with the estimate on exactly the jobs where it matters. The reckoning answers *"is anything missing"*; the estimate answers *"what do we charge"*. |

## Consequences

**A standing is always true of the data as it stands.** Delete a phase's lines
off the estimate and the hole re-opens by itself. Type over a generated price
and the reckoning follows your number, because it reads the estimate line
rather than the proposal that made it.

**A misreading can only make it more cautious.** Two standings are read from
the words of an answer — the starter outlines' own *Bidding it out* and *By
others*. A business that rewrites those choices loses the classification and
gets `unpriced`, which blocks. Never the other way round.

**A line at zero is not a price**, and this is the rule that nearly did not
get written. X2b puts a line on the estimate at nothing when it worked out
WHAT to price and could not work out the cost. The first draft counted those
phases as priced; driving it against the dev tenant's own first walk showed
`Cast-in-place concrete` green with three zero lines under it. Green on the
rail, nothing in the total, and a bid short by whatever the concrete cost.

**The cost:** two doors that take a turn without anybody typing (`goToStep`,
`askAgain`), so a determined clicker can spend model calls faster than a
conversation would. The exchange cap and the per-walk cooldown still apply to
`takeWalkTurn`; these two waive the cooldown deliberately, because one click
is not a conversation. If that turns out to matter, the cap is the lever.

**Also a cost:** the reckoning is recomputed on every turn, on the estimate
page when a finished walk exists, and on demand. Nothing caches it. That is
five indexed reads a few times a minute and it buys never being stale, but it
is a read pattern to watch if an outline ever runs to hundreds of steps.

## Notes

The lesson is the one X2a already taught in a different shape: **every bug in
this layer so far has been code treating one of its own artefacts as the whole
truth.** The outline as a ceiling on what may be asked, the conversation's end
as the bid's end, a proposed line as the line. The fix each time was to derive
from what is actually there.

What would make us revisit: a walk where the reckoning is genuinely expensive
(an outline of hundreds of steps, or a job with dozens of bid packages), or a
business that wants a bid to be issuable with known holes in it and an
explicit override. Today the panel states the holes and stops short of
refusing anything — nothing is blocked, only said.
