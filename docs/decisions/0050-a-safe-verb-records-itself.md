# 0050 — A safe verb records itself, and the box stops asking for taps it does not need

- **Date:** 2026-09-12
- **Status:** Accepted
- **Amends:** [0039](0039-a-pack-declares-what-it-can-be-told-in-one-sentence.md) — which stands in every other respect
- **Affects:** `TellAction.unattended`, `readyToRecordUnasked`, the tell box, `dictate-button.tsx`

## Context

The founder used the microphone the day it was built and said:

> *"I don't like how many clicks it takes. I have to hit say it, then stop it,
> then read it. Definitely not going to work."*

He was counting, and the count was right. To start a clock:

1. **Say it**
2. speak
3. **Stop**
4. **Read it**
5. **Record**

Five interactions, four of them taps, to do a thing whose entire justification
was that finding the screen took too many. ADR 0039 opens by describing the
cost it exists to remove — *"the cost is not any single screen; it is knowing
which one, while holding a bucket"* — and this had quietly reintroduced it in a
different shape. A feature that is slower than the thing it replaces is not a
feature with a rough edge; it is one that will not be used.

Three of those four taps carry no information.

- **Stop** — the recorder knows when somebody stopped talking better than they
  can tell it.
- **Read it** — somebody who has just spoken a sentence has already committed
  to it. Asking them to confirm they meant to say what they said is not a
  safety step.
- **Record** — this one is the safety step, and it is the one ADR 0039 exists
  to defend. It cannot simply be deleted.

## Decision

### 1. The recorder stops itself when the talking stops

Adaptive, not a fixed threshold. The first 400 ms measure the room, and
everything after is relative to that floor: speech must clear it by a wide
margin and silence is a return towards it. A fixed *"below 0.01 is silence"*
works at a desk and fails beside an idling tractor, which is where this
product is used — it would never auto-stop for exactly the people who most need
it to. The button stays, relabelled `Listening…`, because a room this cannot
read is a room somebody still has to finish in.

### 2. Dictation reads itself

The transcript goes straight into `proposeTold`. No tap between speaking and
seeing the cards.

### 3. A verb may declare that a COMPLETE card of it records itself

`TellAction.unattended`, default **false**, and the default is the rule.
ADR 0039's *"the model never writes"* holds everywhere it is not explicitly
lifted.

A verb may say yes only when all three hold:

1. **A wrong one is visible** — to this person, on a screen they already look
   at. Not "discoverable in an audit".
2. **A wrong one is undoable in one step**, by them, without a correcting entry
   that itself needs explaining.
3. **It moves no quantity.** No head, no stock, no money.

`time.clock_in` and `time.clock_out` pass all three: a clock is a timestamp on
your own name, it is on the Time panel the moment you look, and **Cancel**
removes the punch outright. **Nothing in livestock passes**, and nothing is
expected to — a loss is three chicks that no longer exist.

**And `unattended` alone is never enough.** `readyToRecordUnasked` also
requires that the batch is non-empty, that no card carries a HINT (a word that
matched nothing — "never nearest" means somebody has to look), and that every
card passes `checkEntry`. One dissenting card stops the whole batch, because
ADR 0039's all-or-none is unchanged: two things said in one sentence happened
together.

The rule lives in `shape.ts` and is tested, not inside the component. It
decides the one condition under which a model's output reaches a tenant's data
with no person in between, and a rule like that does not belong somewhere it is
read once by whoever is changing the layout.

### 4. "Nothing to record from that" now says what it CAN do

The founder's first attempt returned that message because no `time_workers` row
was linked to his sign-in, so the time source contributed zero actions and
"clock me in" matched nothing. The message described the model's result and hid
the cause. It now lists the actions actually on offer, which makes an absent
one visible in the one moment somebody is looking for it.

## What the count is now

**Clock me in: one tap.** Press **Say it**, speak, and it is recorded — the
toast says `Clocked in at 7:42 AM`.

**Three chicks dead in pen two: two taps.** Press **Say it**, speak, read the
card, press **Record**. The confirm step is intact exactly where it was
earning its keep.

## Alternatives considered

- **Leave it and let people type.** What the founder said about this is quoted
  at the top.
- **A confirm with a countdown** ("recording in 3… cancel?"). It replaces a tap
  with a wait, which is worse in a barn: you cannot cancel what you are not
  looking at, and now nobody can walk away.
- **Record everything unasked with an Undo.** Undo is the wrong primitive for
  head and stock. Undoing a wrong pen means finding it first, which is the
  reasoning ADR 0039 and CRM slice 11 already settled.
- **`unattended: "never" | "confirm" | "always"`**, as
  [ADR 0048](0048-a-phone-holds-a-grant-that-may-only-tell.md) sketched. Three
  values where two are needed; `confirm` and `never` differ in nothing this
  code does.
- **Judging safety centrally** from the action's fields. Safety is a fact about
  what the verb DOES, which only the pack knows. Inferring it from a schema is
  how a pack quietly acquires a property it never agreed to.

## Consequences

- No migration. `unattended` is optional on a contract, so every existing
  filler keeps the old behaviour by saying nothing.
- **A phone gets this for free**, and that was not the reason for it: the
  device endpoint's two-call propose/confirm still applies, but
  `/api/device/tell` can adopt the same rule and answer a clock-in in one call.
  Deliberately NOT done here — this change is already the box's, and the
  endpoint has its own idempotency to think about.
- The silence detector needs Web Audio. An old WebView without it records
  normally and must be stopped by hand; degrading is right, refusing to record
  would not be.
- A noisy room can still defeat the detector, in which case the 30-second cap
  and the button are what end the recording. Both stay.
- The `Stop` button is now labelled `Listening…`, which is a statement rather
  than an instruction. Pressing it finishes early; it is no longer the way to
  finish.
