# 0108 — A phase the estimate already has is stated at the gate, and ends in the money it has

- **Date:** 2026-09-22
- **Status:** Accepted
- **Affects:** Layer 2a — the `jobs` pack, the estimate interview (X17). Extends [0105](0105-a-question-can-carry-the-answer-this-business-always-gives-and-the-walk-states-them-all-before-it-takes-any.md)'s gate and [0099](0099-a-walk-is-finished-when-nothing-is-outstanding-not-when-the-questions-run-out.md)'s reckoning; the walk's side of [0107](0107-a-takeoff-off-the-model-is-a-join-through-the-assembly-keyed-by-what-the-model-calls-it.md).

## Context

The takeoff off the model ([0107](0107-a-takeoff-off-the-model-is-a-join-through-the-assembly-keyed-by-what-the-model-calls-it.md))
puts drywall, framing and roofing on the estimate before the walk starts.
The walk could not see any of it. It knew its own lines — X9 lands a phase
in the item it already made — and nothing else: it opened the drywall
phase, asked who was doing it, proposed drywall lines, and the estimate
carried the drywall twice. The same was true of an item typed by hand
before the walk, and of a previous walk's lines on the same estimate. The
founder's flow is exactly the one that breaks: takeoff first, then the walk
for everything the model does not hold.

## Decision

**A phase's lines are the ones on its cost code, or in the item its
assembly makes.** Both are facts the business stated on the outline step —
the code, the pin ([0103](0103-a-step-names-the-item-it-always-makes-and-the-item-says-whether-it-is-one-line-or-a-line-per-room.md))
— and neither is a guess about words. Lines this walk wrote are found
through the proposed rows that remember them and left out: the walk knows
those already. A line that matches no phase belongs to none, and the walk
says nothing about it; the estimate is the estimator's to fill.

**It is stated at the gate, with the usual.** The gate of
[0105](0105-a-question-can-carry-the-answer-this-business-always-gives-and-the-walk-states-them-all-before-it-takes-any.md)
already asks the one question this is — *what may I take as read?* — so the
covered phases are a second section of the same statement: *"And these
phases are already on the estimate, so I will move past them: Drywall —
$6,952.50 in 2 lines, off the model"*, and the same two buttons. A second
gate for the second kind of thing would be a second tap for the same
question. An outline with no standards and an estimate with nothing on it
stamps through as before.

**Agreed, a covered phase's questions are settled as it opens** — every one
still outstanding except a must-ask — skipped with the reason on them,
*already on the estimate — $6,952.50 in 2 lines, off the model*, so the
transcript says why nobody was asked. Settled by the same machinery as a
standard, idempotently, off the answers as they stand after the standards,
so nothing is answered twice. *"Is there asbestos?"* is asked whatever the
estimate holds; the drywall being priced does not answer it.

**Whether the gate agreed or not, a covered phase ends in the money it
has.** When such a phase finishes, the walk does not propose lines for it;
it moves on, and the reckoning counts the phase as priced at what the
estimate carries, with the words *N lines already on the estimate, off the
model* beside it. A refusal at the gate means *ask me*, never *price the
drywall twice*. Lines that are all unpriced — a thing brought in off the
model as a line nobody has priced — are a hole with a different cause, and
the reckoning says so.

**The estimate is read fresh at the moment it matters.** The gate reads it
when it is put; each phase reads it as it opens; the pricing loop reads it
again as the phase finishes, because a takeoff can land while a walk is in
progress and the walk's copy from an hour ago is not the estimate.

## Consequences

- `LoadedWalk` carries `onEstimate` (the lines this walk did not write,
  each with its code number and its item's name) and the library's names
  by id, read with the walk so the gate, the settling and the pricing loop
  cannot disagree. The reckoning reads the same through `reckoningFor`.
- `StepFacts` gained the on-estimate figures, optional, so a caller with
  none says nothing. The walk's own applied lines still speak first.
- No migration. `usual_accepted` means what it always did — *take these as
  read* — and now covers both kinds of thing.
- Driving it found two more doors that opened a phase with a bare turn
  rather than `openPhase` — the rail's *Work on this* and *Ask again*. A
  phase the standards or the estimate cover is finished the moment it opens,
  so those doors left the walk standing with nothing asked and nothing
  priced: X13a's bug, on two doors nobody had used on such a phase. Both now
  open the phase.
- A walk already past the gate when a takeoff lands is not re-asked; with
  the gate agreed, the covered phases settle as they open; with it refused
  or stamped through, their questions are asked and their money is still
  the estimate's. The one thing lost in that case is a price said out loud
  for a phase the estimate already priced, which the estimator edits on the
  sheet.

## Alternatives considered

**Match a phase to lines by the words in their descriptions.** The room
check ([0101](0101-a-room-is-a-name-a-floor-and-an-area-and-one-answer-is-shared-out-across-them.md))
does that and is deliberately eager because it only nags. This decides
whether a phase gets priced, and a wrong match in either direction is
either a double or a hole. The code and the pin are what the business
actually said.

**A gate of its own.** Cleaner state, and one more tap per walk for a
question the person has just answered. The founder's target is a bid in
forty-five minutes.

**Ask, per covered phase, "anything to add?"** Fifteen covered phases is
fifteen interruptions in a walk that was supposed to be shorter because the
model did the work. The phase's panel on the rail still says what is on it,
and *Ask again* re-opens any question the gate settled.

**Skip the phase without saying.** Refused — it is the quiet unread
assumption this whole layer exists to refuse, and the reason the gate
exists at all.
