# 0105 — A question can carry the answer this business always gives, and the walk states them all before it takes any

- **Date:** 2026-09-21
- **Status:** Accepted
- **Affects:** Layer 2a — the `jobs` pack, the estimate interview (X13). Extends [0098](0098-an-estimate-outline-is-the-tenants-and-a-question-is-a-row-so-an-answer-can-point-at-one.md); the third pre-phase gate beside [0100](0100-a-measurement-is-a-fact-about-the-building-not-an-answer-to-a-question.md)'s measure-up and [0101](0101-a-room-is-a-name-a-floor-and-an-area-and-one-answer-is-shared-out-across-them.md)'s room list.

## Context

The founder, on the shape of his work:

> *"i'd say 80/20 standard vs custom."*

And on what the walk felt like, with a screenshot of it asking for the ninth
time:

> *"I'm getting questions like this one: who is doing this one. it doesn't
> give any context."*

A thirty-three phase outline that asks who is doing each one is thirty-three
questions with a single answer, against a target of **a bid in forty-five
minutes**. The 20 is what a conversation is for. The 80 was costing most of
the time.

## Decision

**A question can carry the answer this business always gives.**
`standard_answer` on `job_estimate_outline_questions`, blank by default,
blank meaning ask.

**It is set per QUESTION, and that is the whole safety of it.** The same
prompt on the roofing step stays blank, so the walk still asks the phases that
really are decided job by job. Filling one in is a statement — *we never sub
framing* — and the difference between skipping what never varies and assuming
what does is exactly which boxes a business chose to fill.

**Nothing is taken until it has been read.** Before the first phase the walk
states every standard it holds and waits: *"here is what I will take as read —
3 questions across 3 phases"*, with **That's right** and **Ask me everything**.
Only then is anything settled. An answer nobody has seen is an answer nobody
gave, which is the rule this layer keeps everywhere else.

**They are grouped by what they SAY, not listed per phase.** *"Who is doing
this one? In-house — every phase"* is one line; thirty-three lines saying the
same thing is a rubber stamp, and a rubber stamp is worse than no
confirmation. An odd one out gets its own line, which is where it can be seen.

**Each standard is settled as its phase opens**, not all at once, and only
what is still OUTSTANDING — so a phase somebody has already been through is
not re-answered underneath them, and a question re-opened with *Ask again*
gets its standard back, because that is where the walk was before.

**Every answer says where it came from.** `from_standard` on the row, *"your
usual"* beside it on the screen and in the reckoning, and `Ask again` re-opens
it exactly as it re-opens one somebody typed.

**`always_ask` wins, at both ends.** `writeSteps` refuses to store a standard
against a must-ask question and `standardsIn` refuses to read one. *"Is there
asbestos?"* is the reason that flag exists, and a default answer is precisely
the quiet judgement it was written to refuse.

**Three states, two columns.** `usual_asked_at` (null = not stated yet) and
`usual_accepted` (null = on the screen, true = agreed, false = ask me
everything). A `false` has to be as durable as a `true`, or a walk that asked
to be asked everything meets the same offer on its next turn.

## Consequences

- **A walk already past measuring when this shipped never sees the gate**, so
  it takes no standards. That is the safe direction and it is deliberate: the
  alternative is a walk in progress suddenly answering its own questions.
- An outline with no standards stamps the gate through without showing
  anything, so nothing changes for a business that has filled none in — and a
  standard added next week does not interrupt a walk already half way down the
  house.
- **There are three ways out of measuring and this needed adding to all of
  them.** `startMeasuring` when there is nothing to measure, `afterMeasuring`
  when the last number lands, and the rooms answer — which is the way every
  walk with a measuring outline actually leaves. Only driving it found the
  third; the gate read `usual_asked: false` on a walk that had finished
  measuring, so nothing would ever have been taken as read.
- The walk's own line breaks now render. Every question a model asks is one
  line, so nothing needed them until this put a LIST on that screen.

## Alternatives considered

- **Apply the standards silently and let somebody find them later.**
  Refused — it is the plausible unread answer that this whole layer exists to
  refuse, and it would put one in a bid.
- **Confirm per phase rather than once.** Most phases carry one standard, so a
  per-phase block is a tap per phase: the same cost as asking, with more
  machinery. Once, up front, is the only shape that actually buys the time.
- **Make the standard a pre-selected quick reply.** Cheaper to build and
  genuinely faster to answer, but it still asks — and *"don't ask what never
  varies"* was the request.
- **Keep the standard on the BUSINESS rather than on the question.** It would
  save filling the same answer in on ten steps, and it would lose the thing
  that makes this safe: that a business can say *in-house on framing, ask me
  on roofing*.
