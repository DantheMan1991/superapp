# Tell it (talk-to-command)

> Say one sentence and the business records it. *"Three chicks dead in pen two"*,
> *"clock me in"*, *"add a job to fix the top gate"* — the model picks which verb
> the sentence is, the platform draws a card per thing it found, and a person
> confirms. **The model never writes.** The seventh declared extension point:
> a module or pack contributes a `tell/source.ts` and the box can be told about
> it.
> Status: `available` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->

**Read this before touching anything in `src/lib/tell-sources/`.** The founder's
standing ask, 2026-09-13: *"I really want the talk-to-command feature to be
exceptional and used all of the time with great success."* That is the bar this
file plans against, and it is why the plan starts with the machinery rather than
with more sources.

## The five rules, and none of them is negotiable

They are spread over four ADRs, so they are gathered here once. Every one was
paid for.

1. **The model never writes.** Proposing and recording are two acts; the second
   takes only what a person confirmed ([0039](../decisions/0039-a-pack-declares-what-it-can-be-told-in-one-sentence.md)).
   Lifted in exactly one place, by name — see rule 4.
2. **Never the nearest one.** A word that matches nothing is kept as a HINT
   beside an empty field. "Pen" does not pick "Pen 2" when "Pen 3" exists.
   [0052](../decisions/0052-the-model-says-the-words-and-the-pack-goes-looking.md)
   replaced the mechanism — a choice is now SEARCHED, not enumerated — and kept
   the reason.
3. **All the cards or none.** Two things said in one sentence happened together;
   half of them landing is worse than none. One transaction.
4. **A verb may record itself only if it passes all three tests** —
   [0050](../decisions/0050-a-safe-verb-records-itself.md): a wrong one is
   visible on a screen this person already looks at, it is undoable in one step
   by them, and **it moves no quantity — no head, no stock, no money.**
   `unattended` defaults to false and the default is the rule.
5. **Draft, never send.** A tell action may RECORD money and may never MOVE it or
   reach a third party, and anything touching the ledger reads back its
   CONSEQUENCE before it writes
   ([0054](../decisions/0054-tell-may-draft-never-send.md)).

**The pack's refusals are the refusals.** `record` calls the verb the pack's own
screens call, and its role check is the only one — there is deliberately no
second opinion in the slot.

## Where it is today

Three sources of a possible sixteen, eight actions between them.

| Source | Actions | `unattended` |
| --- | --- | --- |
| `time` | `clock_in`, `clock_out` | both — a punch on your own name, visible on the Time panel, cancelled in one press |
| `work` | `add`, `done` | `add` only — a job ticked by mistake LEAVES the open list, so the mistake gets harder to see, not easier |
| `livestock` | `loss`, `check`, `move`, `feed` | none, and none is expected — a loss is three chicks that no longer exist |

Ways in: the shell's floating launcher on every dashboard page
([0051](../decisions/0051-the-way-in-is-the-shell-not-a-page.md)), `?tell=1` on
any dashboard URL, the app's `yosher://tell`, an Android home-screen shortcut,
and `/api/device/tell` for a phone holding a tell-only grant
([0048](../decisions/0048-a-phone-holds-a-grant-that-may-only-tell.md)).
Speech forks by where it runs, never by vendor
([0049](../decisions/0049-speech-is-a-fork-in-the-road-not-a-provider.md)): the
handset's own engine inside the app, a server vendor in a browser.

## The plan

Four phases, and the order is deliberate: **the machinery that keeps quality
measurable comes before the breadth that will strain it.**

### Phase A — what the platform owes before it grows

| # | Slice | State |
| --- | --- | --- |
| **A1** | **The selection harness.** A golden set of real sentences, each with the action it must select, run against the live model by a script and reported as an accuracy figure. Plus the free half — what the model is GIVEN, checked on every push, inside a budget. | **shipped 2026-09-13** ([#542](https://github.com/DantheMan1991/superapp/pull/542)) · baseline **66/66** |
| **A2** | **`preview()` on the contract.** The card reads back the CONSEQUENCE above **Record**, not the words the model parsed ([0054](../decisions/0054-tell-may-draft-never-send.md) §2). Blocks all of Phase C. | **shipped 2026-09-13** · `livestock.loss` is its first consumer |
| **A3** | **`find` wherever a list can grow.** `work.done` enumerated every open job into the model's prompt, which [0052](../decisions/0052-the-model-says-the-words-and-the-pack-goes-looking.md) forbids for a list that can pass a few dozen. | **shipped 2026-09-13** · no saving today, a ceiling removed |
| **A4** | **The forbidden-verb scan.** `tests/tell-forbidden-verbs.test.ts` reads every `**/tell/source.ts` and fails on an import from a denied seam ([0054](../decisions/0054-tell-may-draft-never-send.md) §1). | **shipped 2026-09-13** · **Phase A is closed** |

**Why A1 is first and not last.** Every action a tenant has goes into ONE tool
description (`tellToolFor`). Eight actions today; all sixteen sources filled is
sixty-plus, and many are near-synonyms *across module boundaries* — "log a cost"
in inventory, "record a bill" in accounting, "record an expense"; "add a job" in
work against "book it" in scheduling. **The model picking the wrong MODULE is a
likelier failure than it misreading a number, and it is the one that will make
this feel broken.** `moduleSlug` gating helps — a tenant only ever sees its own
enabled tools — and the array order already does a little work. Neither is a
measurement. Adding ten sources without one is how a feature quietly stops
working and nobody can say when it started.

### Phase B — every tool, and no money yet

Each is a file and a line in the registry; the platform does not change.

| # | Slice | Why it is where it is |
| --- | --- | --- |
| **B1** | **`inventory`** — stock used, stock counted, a delivery arrived, stock moved | Highest daily volume of any pack, and it is the spine every other pack hangs off |
| **B2** | **`crm`** — a call or note logged against a name, a contact added, a deal moved on | The second proof the slot is not a farm feature; it is also where "log it while walking to the truck" is worth most |
| **B3** | **`land`** — a paddock rested, topped, sprayed or shut up | Small, and it completes the farm's daily round |
| **B4** | **`scheduling`** — book something in | Nobody has ever clicked this module; a voice door may be the thing that gets it used |
| **B5** | **`production`, `retail`, `assets`** — a run's yield, a market day's takings, a service done | As each earns it |
| **B6** | **`email` and `marketing`, DRAFT ONLY** — *"draft a reply to Sarah saying yes"* makes a draft and says so. Sending and publishing stay buttons | [0054](../decisions/0054-tell-may-draft-never-send.md) §1 is the whole design of this slice |

### Phase C — money, recording only

Gated on A2 and A4. Never `unattended`. Every action previews its posting.

| # | Slice |
| --- | --- |
| **C1** | **An expense paid** — *"paid the feed store two hundred forty cash"*. The simplest money verb, and the one that proves the preview |
| **C2** | **A bill that arrived** — *"got a bill from the vet for three eighty, due the fifteenth"* |
| **C3** | **A draft invoice** — *"invoice Acme for twelve hours"*. Creates a draft, says so, and stops |

### Phase D — the difference between "it works" and "it is used all the time"

Unbuilt, unordered, and the point of the whole exercise. Sorted by what the
product is actually for: somebody outdoors, holding something, not looking at a
screen.

| # | Idea | Why it might be the best one here |
| --- | --- | --- |
| **D1** ✅ | **Say it back — shipped 2026-09-13** ([#543](https://github.com/DantheMan1991/superapp/pull/543)). The confirmation is SPOKEN, not shown — press, speak, hear `Clocked in at 7:42`. Never look at the phone | In a barn holding a bucket this is the entire win — it turns a two-look interaction into a no-look one. Nothing needs installing (`speechSynthesis` is a browser API and both native shells are WebViews) and nothing is built either: **there is no text-to-speech anywhere in this repo today**, and whether it works inside the app's WebView is the first thing to check rather than the first thing to assume |
| **D2** ✅ | **Say it with no signal — shipped 2026-09-13.** A field has no bars. The sentence is kept and read again when there is signal, with the time it was SAID. **Its prerequisite shipped the same day** — [ADR 0055](../decisions/0055-a-queued-sentence-is-old-not-wrong.md), without which every queued sentence would be stamped at the moment it uploaded | [0049](../decisions/0049-speech-is-a-fork-in-the-road-not-a-provider.md) makes this tractable: inside the app the TRANSCRIPT is produced on the handset, so what has to be queued is a short string, not audio. **Without this the feature fails exactly where it is needed most** |
| **D3** | **Correct it by voice.** *"No, pen three"* amends the card instead of starting the sentence again | The card is two feet away and your hands are full |
| **D4** | **The business's own words.** *"The girls"* means the laying flock on this farm and nothing on the next one. Learn it from corrections, per tenant | `speciesWords` already proves the shape, from the industry profile. This is the tenant-level version, and it is what makes it feel like it knows the place |
| **D5** | **"What can I say?"** A short, discoverable list per tool | The founder's own first attempt hit `Nothing to record from that` with no way to tell "you said it wrong" from "this is not set up for you". Half-fixed; finish it |
| **D6** | **Undo on the toast**, for verbs that can honestly offer it | |
| **D7** | **"Today, by voice."** Everything recorded by voice today, on one screen | Trust. Somebody who can audit their own morning will say more things to it |
| **D8** | **The round, in one breath.** *"Pen one fine, pen two fine, pen three water frozen"* → three cards | Multi-entry already works. It has never been shown off, and it is the most impressive thing the box does |
| **D9** | **It knows where you are.** A phone outdoors could weight "which paddock" toward the one being stood in | Genuinely magical for the farm case, and a privacy decision before it is an engineering one |
| **D10** | **Say both rather than guess.** When the model was torn between two ACTIONS, show both and let one tap settle it | Rule 2 already does this for choices within an action. It does not yet do it for the action itself |

## Build log

### 2026-09-13 — The phone would not speak (`claude/the-phone-would-not-speak`)

**The founder, after driving D1:** *"I get voice feedback on the computer, but
the phone app does not."*

**MEASURED, NOT GUESSED.** Loading yosherapp.com in an embedded Chromium and
asking it:

```
  hasEngine: true
  voicesImmediately: 0      ← the whole bug, most likely
```

`speechSynthesis.getVoices()` answers `[]` on the first call and fills in when
`voiceschanged` fires. A desktop browser has voices warm long before anybody
presses anything; **a freshly launched app does not**, and an engine asked to
speak with no voices loaded drops the utterance SILENTLY — no error, no sound.
Seconds later the same tab reported three voices, which is exactly the shape of
"works on the computer, not in the app".

Three known WebView failures are fixed together, since they are indistinguishable
from outside and all three are cheap:

- **Wait for the voice list**, with a one-second cap because some engines never
  fire `voiceschanged` at all and going ahead with the default beats silence.
- **A tick between `cancel()` and `speak()`.** Doing both in one turn is a
  documented Android WebView race in which the new utterance is discarded with
  the old one — and cancelling first is not optional, because two answers said
  quickly must not queue up: the second is the one that is true.
- **`resume()` before speaking.** A queue stuck `paused` speaks nothing and
  reports nothing until something calls it.

**AND ONE THE AUTHOR PUT THERE.** `warmUpSpeech` ran on EVERY press of the
microphone, so a barn morning queued a dozen silent utterances behind each other;
on an engine where a whitespace utterance never reports finishing, that is a
queue that never drains and nothing after it is ever heard. Once per page is all
the unlocking ever needed.

**THE VOICE IS CHOSEN FIRST AND THE LANGUAGE FOLLOWS IT**, which the measurement
forced: the page declares `lang="en"` and every installed voice is `en-US`, so an
exact match finds **nothing** and only the two-letter fallback picks one. Setting
`lang` from the page and the voice from the fallback would hand the engine a pair
that disagree.

#### A feature that fails silently is one nobody can report

That is the real lesson, and it cost a round trip. `canSpeak()` only asked
whether the API existed — which it does, on the phone that made no sound — so the
app showed a speaker button that did nothing and said nothing about it.

An utterance that errors, or that neither starts nor fails within three seconds,
now proves the device silent: the button goes away (a control that does nothing
is worse than an absent one) and the box says *"This device would not read it
out. Everything it says is still on the screen."* once. **Whether there is a
voice is therefore no longer constant for a page's life**, so both facts moved
onto one subscription that can report the change.

**STILL NOT WATCHED WORKING ON A PHONE.** This is a fix believed in, with one of
its three causes reproduced in an embedded browser, not a fix verified on the
device that reported it. If it still makes no sound, the new message is the thing
to report — it says whether the engine was asked and refused, or never asked at
all.

### 2026-09-13 — Slices A3 and A4: Phase A closes (`claude/phase-a-closes`)

Both are housekeeping, and both exist so that Phase B can add ten sources
without anybody having to remember anything.

#### A3 — `work.done` stops enumerating

Every open job was written into the model's prompt. That is the shape
[ADR 0052](../decisions/0052-the-model-says-the-words-and-the-pack-goes-looking.md)
forbids for a list that can pass a few dozen, and **a to-do list is the list in
this product most certain to**: a job is added by anybody, closed by anybody, and
never archived for being numerous. It made the catalogue's size a function of how
busy the business is.

**AND MEASURING IT ON THE PILOT FARM PROVED NOTHING.** Hilltop Farm has two open
jobs, so enumerating them was cheap and the change read as **105 characters
worse** — the new hint is longer than the two choices it replaced. Selection
accuracy was unmoved at 66/66. The win is not a saving, it is a slope.

So the slope is what is asserted: `tell-catalogue-db.test.ts` adds sixty jobs and
requires the catalogue to grow by under fifty characters. The old shape would
have added roughly eighteen hundred.

The search is three passes, loosest last, the way livestock's is — the title
whole or contained, then a word in common (*"sorted the gate"* is not the title
*"Fix the top gate"*, and a sentence almost never is), then everything open,
because a shortlist is a question and an empty result is the dead end 0052 ended.
**Whole words only, never edit distance**: ticking the wrong job is the failure
that matters, because it LEAVES the open list and somebody believes a gate is
shut when it is open.

**One normaliser now, not two.** `saidWords` moved to `shape.ts` and livestock
uses it. Two sources each carrying their own idea of what a word is, is how
"Pen 2" and "pen-2" come to match in one pack and not the other, and neither
author ever finds out.

#### A4 — the line is enforced, not remembered

[ADR 0054](../decisions/0054-tell-may-draft-never-send.md) §1 says a tell action
may record money and may never move it or reach a third party. **A rule that
lives only in an ADR lasts exactly as long as the next person's recollection of
it**, and the sources it guards are meant to go from three to sixteen.

`tests/tell-forbidden-verbs.test.ts` reads every `**/tell/source.ts` and fails on
an import from a denied seam — by PATH (`/payments/`, `/stripe`, `email/compose`,
`invoicing/send-invoice`) and by NAME (`/^send[A-Z]/`, `/^issue(Invoice|AndSend|CreditMemo)/`,
`/^(charge|refund|capture|payout)[A-Z]/`). The name patterns are the half that
catches the verb nobody has written yet. It also enforces §2: a source importing
a ledger seam must declare `preview`.

**PROVEN BY POISONING IT.** A `sendInvoiceEmail` import was added to `work`'s
source and both halves fired with the messages they were written with — the send
denial and the missing preview — then it was taken out again. A scan test that
has never failed is a scan test nobody has checked.

**Its honest limit, stated in the file:** it reads the FILE, not the module
graph. A source reaching a denied verb through three helpers is not caught.
This stops the obvious thing, done the obvious way, by somebody who had not read
the ADR — which is the case that will actually happen.

**Phase A is closed.** Nothing in Phase B has to be trusted to remember a rule.

### 2026-09-13 — Slice A2: the card says what it will do (`claude/the-card-says-what-it-will-do`)

**The gate on everything financial** ([ADR 0054](../decisions/0054-tell-may-draft-never-send.md) §2),
and useful on its own the day it ships.

A card shows the FIELDS the model parsed, and for anything consequential that is
the wrong thing to check. `Feed store · $240 · today` looks exactly as correct
whether it is about to hit `5010 Feed` or `6200 Supplies`, and the wrong account
is the commonest error in bookkeeping. `summary` already existed and composes
AFTER the write, which makes it a receipt rather than a verification.

`TellAction.preview(tx, ctx, values)` returns lines — a label and an optional
figure — plus an optional `warning`. Not a table: a preview needing columns is a
report, and a report above a button is a report nobody reads.

**IT IS ASKED AGAIN EVERY TIME THE CARD CHANGES, AND THAT IS THE WHOLE DESIGN.**
Computing it once at proposal time would have been cheaper and wrong: a person
EDITS a card, and a preview worked out before the edit is a confident statement
about a number that has since moved. **A stale preview is worse than none**,
because the point is to be the thing somebody trusts INSTEAD of re-reading the
fields — so every preview is stamped with `previewKey(values)` and shown only
while the stamp matches, with a 350 ms pause so typing does not send one per
keystroke.

**Three states that must look different**, and the third is the one that would
have been got wrong: not worked out yet, worked out, and *could not be worked
out*. A blank space says "nothing will happen", which for a card that moves a
quantity is the opposite of the truth — so it says so in words and notes that the
card will still record.

**`livestock.loss` is the first consumer, and it earns its keep today.** The
card says *3* and *Pen 2* and never said *leaves 22*, which is the number
somebody actually wants and the one that catches the commonest mistake here: the
right count against the wrong pen. A misread pen is invisible in the fields and
obvious in the arithmetic. The figures are live — `previewTold` reloads the
source's actions, which refolds the head ledger — not remembered from proposal
time.

**A warning, never a refusal.** `inventory` lets a lot go negative on purpose,
because head counted wrong last week is a real thing and the ledger is what makes
it visible. So the preview says *"that is 3 more than Pen 2 is counted as
having"* and lets somebody who means it carry on. The pack's own verb is still
the only thing that says no.

**The test caught a typography bug nobody would have reported.** A pen going
negative read `−5` on one line and `-3 head` on the next — a real minus against
the ASCII hyphen JavaScript gives a stringified number, in the same four-line
table.

**`previewTellAction` writes nothing and never raises.** A preview that throws
comes back as `null`: the card is still correct, the button still works, and the
pack's verb is still what refuses. Interrupting somebody because the arithmetic
above the button could not be done would be the tail wagging the dog.

Next for Phase C: nothing may post without one of these.

### 2026-09-13 — Slice D2: say it with no signal (`claude/say-it-with-no-signal`)

**The feature failed exactly where its whole justification lives.** A field has
no bars, the server action's fetch rejected, nothing caught it, and the words
somebody said into a phone with cold hands were gone — no toast, no queue, no
trace. The box had no offline story at all, and neither did anything else in the
repo: `navigator.onLine` appears nowhere before this.

- **What is kept is the SENTENCE, never a record.**
  [ADR 0039](../decisions/0039-a-pack-declares-what-it-can-be-told-in-one-sentence.md)'s
  first rule is that the model never writes, and nothing here bends it. A queued
  item replays down the same path a fresh one takes — propose, cards, confirm —
  and an `unattended` verb still records itself only because
  `readyToRecordUnasked` said so about the proposal it got back.
- **And the time it was said travels with it.** `spokenAt` now reaches both
  server actions and is clamped by the rule
  [ADR 0055](../decisions/0055-a-queued-sentence-is-old-not-wrong.md) settled
  this morning. `today` follows the EFFECTIVE time rather than the request's,
  which matters more than it sounds: a sentence said at dusk and sent the next
  morning would otherwise default its date field to the wrong day.
- **Only a request that never ARRIVED is kept.** A server action that reached
  the server answers `{ error }` — a refusal, a sentence too long, a pack saying
  no — and replaying one of those repeats a sentence destined to fail
  identically forever. A rejected promise is the other case. The judgement
  cannot be exact (`TypeError` in Chrome, "Load failed" in Safari,
  "NetworkError" in Firefox), so it errs toward keeping: a false positive
  replays once and is dropped with the real error shown, a false negative loses
  the sentence.
- **Past the point where sending it would be a lie, it stops.** The server
  believes a claim for 48 hours and silently uses its own clock beyond that, so
  an older sentence would still record — dated now, which is the wrong answer
  said confidently. Those read *"too long ago to record at the time you said
  it"* and offer **Put it back**, which returns the words to the box so somebody
  can record them today on purpose.

**WHAT IS DELIBERATELY NOT QUEUED: THE CARDS.** They are a confirmed decision,
and a queue of decisions waiting to fire is a second way to write to the herd
with no idempotency to stop it firing twice — the device endpoint has an
idempotency key for exactly this and the box has none. So a record that fails
for want of signal leaves the cards on screen, where the person who confirmed
them is, and says to press Record again. Named as an open item rather than left
to be discovered.

**A LINT RULE CAUGHT A REAL HAZARD, NOT A STYLE.** `read` is reached from a
button, from the online listener AND during render (the `said` prop), so the
refs D1 introduced were being written during render. Everything that must
survive the async gap now travels as an ARGUMENT — whether to speak, and which
queued item is in flight — because the state those callbacks would have read was
captured before the render-phase update that set it. The functions also had to
be declared in dependency order; they hoist, so it worked either way, but
reading top to bottom did not.

**No migration.** `tests/tell-queue.test.ts` covers the decisions; the sound and
the signal loss both still need a real phone.

### 2026-09-13 — A queued sentence is old, not wrong ([ADR 0055](../decisions/0055-a-queued-sentence-is-old-not-wrong.md)) (`claude/a-queued-sentence-is-old-not-wrong`)

**Slice D2's prerequisite, and it turned out to be a defect rather than a gap.**

[ADR 0048](../decisions/0048-a-phone-holds-a-grant-that-may-only-tell.md) decided
a claimed time is *"clamped to ±15 minutes of the server's"*, and justified it
with *"a sentence queued in a barn with no signal may not reach us for hours."*
**Those two sentences cannot both be true.** A sentence spoken at 07:00 and
uploaded at 10:00 is three hours out, so `Math.abs(claimed − now) > 15 minutes`
threw the claim away and recorded the clock-in at 10:00 — three hours of wages,
silently, EVERY time rather than only when somebody is cheating. The test beside
it was titled *"is believed inside the tolerance, because a queued sentence is
old on purpose"* and then tested ten minutes.

**One number was answering two questions.** How WRONG might this clock be is
symmetric and measured in minutes; how OLD might this sentence be is
one-directional and measured in hours. Age was being read as evidence of drift.

Now: **believe the past, bound the future.** Forty-eight hours backwards, two
minutes forwards — because back-dating a clock-in pays and post-dating one does
not, so the two directions do not deserve the same generosity. `clampSpokenAt`
also returns `delayedMs`, so a caller can SAY a sentence is three hours old
rather than leaving the difference to be found in two columns of a table.

**It moved to `src/lib/tell-sources/spoken-at.ts`**, out of `device-grants`.
The thing being timestamped is a told sentence, not a grant: the web box has no
grant at all and needs the same answer for its queue, and a second copy of this
rule is how two paths come to disagree about somebody's wages. Its tests moved
with it and stopped queueing behind a database for no reason.

**The honest cost, recorded in the ADR rather than buried:** back-dating inside
forty-eight hours is now believable where it was not. Both times are still
stored, the delay is now returned so it can be put in front of somebody, and the
alternative fails the ordinary case continuously in order to inconvenience a
dishonest one occasionally.

No migration — `device_grant_uses` already keeps both times. What changed is
which of them becomes `effectiveAt`.

### 2026-09-13 — Slice D1: it says the answer back (`claude/tell-says-it-back`)

[ADR 0050](../decisions/0050-a-safe-verb-records-itself.md) got a clock-in down
to one tap and then put the ANSWER on a screen somebody still has to take out
and look at. **A confirmation you have to look at is a second interaction
wearing a toast's clothes**, and the justification for this whole feature is a
person outdoors with their hands full.

- **It only speaks when it was spoken to.** Somebody who TYPED is looking at the
  screen, and talking at them is the noise that gets a feature switched off. The
  box tracks how the words arrived — a ref, since nothing renders from it — set
  by the dictate button and by the `said` prop (the shell launcher, `yosher://tell`
  and the home-screen shortcut are all microphones), cleared on the first
  keystroke.
- **It speaks the FAILURES**, and that is the half worth defending. Somebody not
  looking can afford to miss a success and cannot afford to miss a refusal. A
  silent failure to a person already walking away is the one outcome this must
  never produce.
- **A line written for the eye is punctuated for the ear.** Every summary here is
  built for a toast, where `3 head — died — from Pen 2` reads cleanly; an engine
  makes that a run-on, or pauses wrong, or says the character aloud. `forSpeech`
  turns a SPACED dash or middle dot into a comma and does nothing else —
  punctuation, never rewriting, because a second voice paraphrasing the pack's
  words is how a confirmation stops being one. `South-West` and `2026-09-20`
  survive, which is exactly why the rule wants spaces on both sides.
- **It says ALL of a handful.** The toast counts past one because a stack of them
  is unreadable; a voice has no such problem, and *"pen one fine, pen two fine,
  pen three the water was frozen"* deserves three answers. Past three it is a
  monologue at somebody holding a bucket, and a count is kinder.

**THE GESTURE TRICK, AND IT IS NOT OPTIONAL ON iOS.** Mobile Safari starts speech
only inside a user gesture, and everything here is said AFTER an await — the
model call, the server action. By then the gesture is gone and `speak()` is
**silently ignored**: nothing throws, the phone simply never talks, on the
platform where not looking at it matters most. A silent utterance on the press
that starts listening unlocks the engine for the rest of the page.

**Both browser facts are read with `useSyncExternalStore`, not an effect.**
Neither has a server answer, and the effect version is two paints plus a
`react-hooks/set-state-in-effect` error. A `storage` listener keeps two tabs
agreeing about the mute.

**Everything degrades to silence.** No `speechSynthesis` means no button and
nothing lost, because every word spoken is also on the screen.

**`volume-2` and `volume-x` had to be registered in `guide-icons.ts`** — the
guide test refuses an icon nobody registered, and it caught this.

**HEARD, AND IT WORKS.** The founder drove it on a real device on 2026-09-13:
*“I took it for a test drive and the voice feedback worked.”* Recorded here
because this entry said the opposite when it was written — the shaping was
tested and the build was green, and neither of those is a feature whose whole
point is audible actually making a sound. It took a phone, and a person.

**Still unheard: the failures.** What was driven is a confirmation. Nobody has
yet had a refusal read out to them, which is the half this slice argued was the
more important one.

### 2026-09-13 — Slice A1: the box gets a score, and it is 66/66 (`claude/tell-selection-harness`)

**Written up here rather than where it happened.** [#542](https://github.com/DantheMan1991/superapp/pull/542)
merged before this dossier existed, so its entry lands in the file it belongs to
rather than in a file it would have to be moved out of.

**The failure this measures cannot be caught any other way.** Every action a
tenant has goes into ONE tool description; eight today, sixty-plus if the plan
fills sixteen sources, many of them near-synonyms across module boundaries. The
model picking the wrong MODULE throws nothing, refuses nothing, and draws a
perfectly convincing card against the wrong verb.

```
  Hilltop Farm · dev branch · 22 sentences × 3
  ████████████████████████  66/66 runs picked the right verb
  catalogue: 8 actions, 5889 characters in every sentence's prompt
```

- **`tests/fixtures/tell-sentences.ts`** — 22 sentences, each with the verb it
  must become and one line saying why it is HARD. A sentence already written into
  an action's `about` earns no place: those are the answers printed on the back
  of the paper. Two cases expect NOTHING, because a box that reaches for the
  nearest verb when nothing happened is worse than one that shrugs. One is marked
  genuinely ambiguous and tolerates either answer — ambiguity is a fact about
  English, and scoring it as failure would push the catalogue towards fixing the
  model instead of fixing the words.
- **`npm run tell:eval`** — the live run. Reports accuracy, what it picked
  INSTEAD, and which PAIRS were confused for one another: a pair appearing twice
  is two `about` texts that do not separate, which is a writing job with an
  address. `--repeat` matters more than it looks; a case that passes two runs in
  three is unsettled, which is invisible at 1. Read-only — `recordTold` is never
  called.
- **`tests/tell-catalogue-db.test.ts`** — the free half, on every push: unique
  slugs, an action living in the source its slug names, every `about` carrying a
  quoted example, every field fillable, and **a budget** per action and in total.

**IT CAUGHT ITS OWN AUTHOR ON THE FIRST RUN.** The score read 18/18 — by silently
skipping four of twenty-two, whose `needs` named `land` and `inventory`: real
modules, but not tell SOURCES. A skipped case is neither pass nor fail, so
dropping the hardest ones made the number go UP. That is the exact failure the
fixture's own header warns about, committed inside the fixture. Both halves now
guard it, and 22/22 is the honest figure.

**A trap for the next script.** `npm run tell:eval` cannot run under
`tsx --conditions react-server`, which is what every other model-touching script
uses: the chain reaches `@/packs/index`, which imports every pack's React
Component, and React's server build has no `createContext`. It runs through
`scripts/tsconfig.eval.json` instead, which maps `server-only` to the stub the
tests already use.

Newest first. **From 2026-09-13 the platform's own entries live here**; a
module's or pack's `tell/source.ts` is that area's own work and its entry stays
in that area's dossier. Before this file existed the platform entries went to
[onboarding.md](onboarding.md), where the slot was slice 6, and the fillers'
went to both — which is how *"It shows its working"* and *"The cows finds the
cattle"* came to be written twice.

Where the history is: [onboarding.md](onboarding.md) (slice 6 and the platform
entries, 2026-09-09 to 2026-09-13), [livestock.md](livestock.md) (the first
filler, and the shortlist that could not tell a cow from a pen),
[time.md](time.md) (*"Clock me in"*), [work.md](work.md) (*"Add a job to fix the
top gate"*).

### 2026-09-13 — The tool gets a dossier and a line it may not cross (`claude/tell-may-draft-never-send`)

**The founder asked for the box to work with every tool and said he was
comfortable with it doing financial things, given good feedback verification —
and invited a firm objection.** There was one, and it is not about money:
[ADR 0054](../decisions/0054-tell-may-draft-never-send.md). A tell action may
record money and may never move it or reach a third party, because the test is
not *is this financial* but **can the confirm card undo what this does** — and a
card cannot un-send an email or un-charge a card. Draft, never send.

**And "good feedback verification" was not yet what was there.** The card shows
the FIELDS the model parsed, which for money is the wrong thing to check: the
common accounting error is the wrong account, and `Feed store · $240 · today`
looks identical whether it posts to `5010` or `6200`. Hence `preview()`, slice
A2, and hence Phase C waiting on it.

**This file exists because the feature outgrew being somebody's slice 6.** Five
ADRs, a shell launcher, a device endpoint, transcription, an Android shortcut and
three fillers, with its build log split across four dossiers and two entries
written twice. The five rules were spread over four ADRs and are now in one
place, because a rule that has to be assembled from four files before it can be
obeyed will eventually not be.

No code changed.

## Key files & seams

- `src/lib/tell-sources/types.ts` — **the contract. Read its header first**;
  `TellCandidate.detail` in particular is the field the whole search design
  turns on
- `src/lib/tell-sources/shape.ts` — pure: the one tool description built from
  every action (`tellToolFor`), and `readyToRecordUnasked`, which decides the
  single condition under which a model's output reaches data with nobody in
  between
- `src/lib/tell-sources/{model,registry,resolve,find,actions}.ts` — the one
  network call, the composition root, the transaction, the search, the server
  actions
- `src/components/app/tell-box.tsx`, `tell-launcher.tsx`, `dictate-button.tsx`
- `src/modules/{time,work}/tell/source.ts`, `src/packs/livestock/tell/source.ts`
  — **`work`'s is the one to copy.** It is the shortest, it is not about a farm,
  and its header explains why its two actions are not the same kind of safe
- `src/app/api/tell/transcribe/route.ts`, `src/app/api/device/tell/route.ts`
- `tests/tell-sources.test.ts`, `tests/tell-sources-db.test.ts`,
  `tests/tell-find.test.ts`, `tests/tell-unattended.test.ts`,
  `tests/tell-shortcut.test.ts`

## Decisions & gotchas

- **Nothing in a proposal may be a function.** The box is a client component,
  and handing React a function across that boundary is a RUNTIME error that
  `tsc`, the linter, the build and the whole suite waved through. Asserted over
  the whole proposal in `tell-sources-db.test.ts`, not over `find` by name.
- **The cooldown is per PERSON, not per tenant, and it is not a rate limit.** It
  is in-process, so it holds on one serverless instance and no further. Five
  farmhands saying "clock me in" at seven in the morning are five independent
  callers.
- **An action whose every choice is empty must not be offered.** The model can
  pick it and then fail to fill it, costing somebody a readback that could never
  have gone anywhere. Livestock offers only records with animals still in them;
  work offers `done` only when something is open.
- **A source's order in the registry is the order the model reads it in.**
  Most-said first.
- **The detail line is read by a person AND by the model**, and it is the only
  thing either has to choose on. A named animal read as `Cattle · 1 head` for
  three days because nobody had asked what the line was for.

## Open items

- **Everything in Phases A–D.**
- **No durable rate limit on `/api/tell/transcribe`.** A signed-in session can
  call it repeatedly; the in-process cooldown does not bound it.
- **`work.done` enumerates.** Slice A3.
- **The device endpoint does not adopt `unattended`.** A clock-in through
  `/api/device/tell` still takes two calls, deliberately — the endpoint has its
  own idempotency to think about ([0050](../decisions/0050-a-safe-verb-records-itself.md)).
- **Selection accuracy is measured but not watched.** `npm run tell:eval` is
  run by hand, against one tenant, whenever somebody remembers. It should be run
  before and after every source added in Phase B, and the figure recorded in the
  build log; nothing enforces that but this sentence.
