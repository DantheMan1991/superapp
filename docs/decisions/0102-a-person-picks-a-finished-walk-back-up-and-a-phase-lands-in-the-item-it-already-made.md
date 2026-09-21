# 0102 — A person picks a finished walk back up, and a phase lands in the item it already made

- **Date:** 2026-09-21
- **Status:** Accepted
- **Affects:** Layer 2a — the `jobs` pack, the estimate interview (X9). Extends [0099](0099-a-walk-is-finished-when-nothing-is-outstanding-not-when-the-questions-run-out.md).

## Context

[0099](0099-a-walk-is-finished-when-nothing-is-outstanding-not-when-the-questions-run-out.md)
named the rule in its own title — *a walk is finished when nothing is
outstanding, not when the questions run out* — and gave the screen a reckoning
that says what a bid is still missing and a rail you click into to fix it. The
code then broke the rule in two places at once, and walk EST-6 on the dev
branch is both of them in one artefact.

**It closed over phases nobody had been asked about.** `applyAndMoveOn` went to
`nextStep`, which looks FORWARD, and that was the whole truth while a walk could
only go forwards. X4 made it possible to jump about from the rail. So a walk
taken to Painting (ninth of ten), answered there and at Landscaping (tenth),
ran out of steps AFTER the tenth and closed itself — over eight phases,
including the foundation, that nobody had ever been asked about. The screen
then said *"That is every question in New build"* over that bid.

**And a finished walk had no way back in.** `goToStep` and `reopenQuestion`
both refused a walk that was not running, `claimTurn` and `recordAnswers`
refused every write, and the step card hid both buttons on the reasonable
ground that a control which can only produce an error toast is worse than
none. The reckoning named the holes on a screen where none of them could be
acted on — and `runTurn` returned before its pricing block whenever the
interview was not running, so even a turn that did land would have banked the
scope and skipped the money.

Under that, a third fault nobody could reach yet: **applying a phase always
appended a new item.** Ask a phase again, answer it, price it, and the estimate
grows a second `Landscaping` beside the first, both in the total.

## Decision

**A PERSON may pick a finished walk back up; the walk itself may not.**
`goToStep` and `reopenQuestion` — the two doors only a click reaches — put a
`finished` interview back to `running` and clear `finished_at`. Every other
write still refuses a closed walk. An `abandoned` walk is never resumed:
somebody stopped that one on purpose.

**The walk closes when nothing is outstanding ANYWHERE.** `onwardStep` is
`nextStep` falling back to `currentStep(steps, answers, null)`, so a phase that
lands last on the list sends the walk back up to the earliest phase with work
in it, and null — the one thing that ends a walk — means the whole outline is
covered.

**A phase walked twice is one item.** `applyProposal` finds the item this step
already made, through the `estimate_line_id` the proposed rows kept and never
through the name, replaces the lines it put there and leaves anything else in
that item alone.

**And pricing is guarded by what it needs, not by whether the walk is open.**
`runTurn` prices a phase that finished whatever the interview's status has
become, and `applyAndMoveOn` puts the money on and then leaves a closed walk
closed rather than moving its bookmark or closing it twice.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Leave a resumed walk CLOSED and let it work one phase "in place" | This is a `revisiting` mode by another name, and 0099 turned that down when the alternative looked cheaper than it does now: every write path would need a "by a person, on a closed walk" exception, and the screen would need a third state between conversation and reckoning. Status already says whether a conversation is live. Somebody is walking the estimate, so the walk is running, and it closes itself again by the same rule that closed it the first time. |
| A `resumed_at` or `revisiting` column | A second copy of a fact the existing one states. It would also have to be kept in step with coverage, the rail and the reckoning, which is exactly the class of bug this layer keeps paying for. |
| Keep the buttons hidden and offer a "re-price this phase" door instead | It answers one standing (`unpriced`) and none of the others. A phase that is open, out for bid or answered wrongly needs the conversation, not a re-run of the pricer. |
| Let `Work on this` appear on a covered phase too | The bookmark would not stick: `currentStep` honours one only while its step has work, and 0099 rejected honouring it anyway because that wedges a walk on a step with nothing to say. The button would lie. **Ask again** is the door into a covered phase, and it is the one X4 built for it. |
| Match the phase's existing item by NAME when applying again | Two items may share a name, and a person may rename the one the walk made — the founder's own price sheet has `DRYWALL, INCL. LABOR` over a step called `Drywall`. Matching on words would miss the rename or, worse, land this phase's money in somebody else's item. |
| Leave applying as an append and let people tidy up | The duplicate is in the total. This is the plausible wrong number the whole estimate program exists to refuse, at the place it does the most damage. |

## Consequences

**The reckoning is finally actionable.** Every standing it names has a door,
and the door works. That is what 0099 promised and could not deliver.

**A resumed walk carries on until nothing is outstanding**, which on a walk
closed early means it moves to the next hole after the phase you clicked
rather than stopping there. That is the close rule doing its job — there IS
more to ask — and the rail and the reckoning are on screen the whole time.

**The exchange cap is now the only backstop on a walk that is picked up over
and over.** `claimTurn` still counts every turn against `WALK_EXCHANGE_CAP`,
and a resumed walk keeps its count. 0099 already named the cap as the lever if
clicking turns out to cost more than expected.

**`finished_at` is not a permanent record of the first time a walk ended.**
Picking one back up clears it and closing it again re-stamps it. The
transcript — which is the record anybody actually reads — is unaffected,
because superseding never deletes.

**Replacing a phase's lines discards what was typed over them.** A price
edited by hand on a line the walk made is gone when that phase is walked
again. The alternative is a second item that double-counts, which is worse,
and the person re-answering the phase is the one asking for the new numbers.
Lines added to the item by hand are untouched, and the old proposal rows keep
pointing at lines that no longer exist — which the reckoning already ignores,
having read through to the estimate since 0099.

## Notes

**Every bug in this layer so far has been code treating one of its own
artefacts as the whole truth** — 0099's own note, and this is two more of
them: the END OF THE LIST read as the end of the work, and the WALK'S STATUS
read as whether there is anything left to do. Both fixes are the same move the
note prescribes: derive it from what is actually there.

The founder's diagnosis arrived as *"a phase you go back and answer on a
finished walk is never worked out into lines"*, which named the `runTurn`
guard. That guard is real and is fixed here, but it was the third lock on a
door with three: the button was not offered, the server refused the click, and
the pricing was skipped. A fix to any one of them alone would have changed
nothing you could see.

What would make us revisit: a business that wants a finished bid frozen —
walked, checked, sent, and not silently re-openable by anybody with the link
to the walk screen. Today the estimate's own `accepted` status is the only
freeze, and it refuses the walk outright.
