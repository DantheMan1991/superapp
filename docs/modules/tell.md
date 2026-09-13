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
| **A1** | **The selection harness.** A golden set of real sentences, each with the action it must select, run against the live model by a script and reported as an accuracy figure. Plus a pure test that no two `about` texts can be told apart by a person reading them cold. | |
| **A2** | **`preview()` on the contract.** The card reads back the CONSEQUENCE above **Record**, not the words the model parsed ([0054](../decisions/0054-tell-may-draft-never-send.md) §2). Blocks all of Phase C. | |
| **A3** | **`find` wherever a list can grow.** `work.done` enumerates every open job into the model's prompt, which [0052](../decisions/0052-the-model-says-the-words-and-the-pack-goes-looking.md) says a list that can pass a few dozen must not do. Cheap now, a rewrite at two hundred jobs. | |
| **A4** | **The forbidden-verb scan.** `tests/tell-forbidden-verbs.test.ts` reads every `**/tell/source.ts` and fails on an import from a denied seam ([0054](../decisions/0054-tell-may-draft-never-send.md) §1). A rule that lives only in an ADR lasts as long as somebody's memory of it. | |

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
| **D1** | **Say it back.** The confirmation is SPOKEN, not shown — press, speak, hear `Clocked in at 7:42`. Never look at the phone | In a barn holding a bucket this is the entire win. The app already has a native TTS route, and it turns a two-look interaction into a no-look one |
| **D2** | **Say it with no signal.** A field has no bars. Queue the sentence and record it when there is signal, with the phone saying so | [0049](../decisions/0049-speech-is-a-fork-in-the-road-not-a-provider.md) makes this tractable: inside the app the TRANSCRIPT is produced on the handset, so what has to be queued is a short string, not audio. **Without this the feature fails exactly where it is needed most** |
| **D3** | **Correct it by voice.** *"No, pen three"* amends the card instead of starting the sentence again | The card is two feet away and your hands are full |
| **D4** | **The business's own words.** *"The girls"* means the laying flock on this farm and nothing on the next one. Learn it from corrections, per tenant | `speciesWords` already proves the shape, from the industry profile. This is the tenant-level version, and it is what makes it feel like it knows the place |
| **D5** | **"What can I say?"** A short, discoverable list per tool | The founder's own first attempt hit `Nothing to record from that` with no way to tell "you said it wrong" from "this is not set up for you". Half-fixed; finish it |
| **D6** | **Undo on the toast**, for verbs that can honestly offer it | |
| **D7** | **"Today, by voice."** Everything recorded by voice today, on one screen | Trust. Somebody who can audit their own morning will say more things to it |
| **D8** | **The round, in one breath.** *"Pen one fine, pen two fine, pen three water frozen"* → three cards | Multi-entry already works. It has never been shown off, and it is the most impressive thing the box does |
| **D9** | **It knows where you are.** A phone outdoors could weight "which paddock" toward the one being stood in | Genuinely magical for the farm case, and a privacy decision before it is an engineering one |
| **D10** | **Say both rather than guess.** When the model was torn between two ACTIONS, show both and let one tap settle it | Rule 2 already does this for choices within an action. It does not yet do it for the action itself |

## Build log

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
- **Nobody has measured selection accuracy**, because there is nothing to
  measure it with. Slice A1.
