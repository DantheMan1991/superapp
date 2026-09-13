# 0052 — The model says the words and the pack goes looking; a shortlist is a question

- **Date:** 2026-09-13
- **Status:** Accepted
- **Amends:** [0039](0039-a-pack-declares-what-it-can-be-told-in-one-sentence.md)'s second rule — "choices resolve by label, never nearest". The REASON is kept; the mechanism is replaced.
- **Affects:** `TellField.find`, `TellCandidate`, `src/lib/tell-sources/find.ts`, `TellCard.options`, livestock's lot field, the homestead-farm profile

## Context

A `choice` field was a MENU with an exact-match rule. Every lot, paddock and
job name was written into the model's prompt, and the model had to pick one
word-for-word. One design, and it failed two different ways — both found by the
founder, on his own farm, within a day of each other.

**It could not scale.** Hilltop has 28 lots and 16 people, so nothing showed.
A business with two thousand customers cannot have them all written into every
sentence it says, which meant CRM, accounting and documents — the modules with
long lists — could never be told anything at all. That was the whole distance
between "three tools" and his actual ask, *"it should work with every tool"*.

**And it could not think.** His first real sentence was *"checked the cows"*.
No lot is called "the cows", so it matched nothing, and the box said *"It heard
'the cows' — pick or type the right one"* over an empty field.

> *"I also want this to be intelligent. I didn't want to have to say the
> exactly right things. It should be intelligent and conversational."*

Two complaints, one cause. A menu that demands an exact pick is both unable to
grow and unable to understand.

## Decision

**The model reports what was SAID, and the pack goes and looks.**

`TellField.find(tx, ctx, said)` replaces `choices` for anything whose list is
not short enough to enumerate. Nothing goes into the prompt, so a farm with
three hundred pens costs the same as one with three. The pack searches its own
records however suits them, which is what lets "the cows" reach the cattle.

**A shortlist is a question, not a failure.** `find` returns candidates, each
with a `detail` line — "Meadow — Cattle · 12 head". One resolves. Several
become `TellCard.options`, shown as real things to choose between rather than
an amber warning over a blank. None leaves the words as a hint, as before.

`detail` is the part that makes this work: two NAMES are not a choice, and two
THINGS are.

### What did not move

ADR 0039 refused to guess the nearest match so a misheard sentence could not
reach the herd. **That protection is kept and moved, not dropped.**

- `decide()` settles only what nobody could argue with: a single candidate, or
  one whose name is exactly what was said. Ranking by string similarity was the
  obvious alternative and is how "never nearest" comes back by accident —
  "Pen 3" is one character from "Pen 2", and the wrong one would win silently.
- Everything that moves animals, stock or money is still read back before it
  happens. [ADR 0050](0050-a-safe-verb-records-itself.md)'s three tests are
  untouched.

**Generous about understanding, strict about confirming.** Inference plus a
readback is safe. Inference plus a silent write is not, and the founder agreed
that balance before a line was written.

### The vocabulary belongs to the industry

"the cows" → cattle is not a fact a pack may know: a pack that knew a cow was
cattle would know it was on a farm, which
[extension-model.md §2](../extension-model.md) forbids in as many words. So
`speciesWords` is data the **homestead-farm profile** contributes, alongside
the species list it already supplied. `TellCtx` gained `industry` so a source
can reach its own `packConfig` — a tenant fact, like the timezone, and carried
for the same reason: both gates already know it.

## Alternatives considered

- **Fuzzy match the menu.** Cheaper, and it is precisely the thing ADR 0039
  forbade. Edit distance cannot tell Pen 2 from Pen 3 and would not know it
  could not.
- **A second model call to pick from the shortlist.** More intelligent still,
  and the right next step when a shortlist is often long. Not yet: it is
  latency and cost on every sentence, and asking a two-word question is better
  than guessing well.
- **Cap the menu at fifty and warn.** A ceiling with a sign on it. The right
  customer is the one not in the first fifty.
- **Let the model return an id.** It has no ids, and inventing one is the worst
  possible failure — silent and unverifiable.

## Consequences

- No migration.
- **`checkEntry` no longer validates a searched field against a list**, because
  there is none. What replaces it is not nothing: the value came from the
  pack's own `find` and goes to the pack's own verb, which refuses an
  unrecognised id in its own words. A second opinion here would be the weaker
  one and the one that drifts. Missed on the first pass — every card was
  rejected with "Which animals is not one of the choices."
- **A proposal may not contain a function.** `find` is one, and the box is a
  client component: handing React a function across that boundary is a RUNTIME
  error that `tsc`, the linter, the build and 3,377 tests all waved through.
  `forTheBox()` picks the serialisable fields by name rather than deleting the
  known offender, and `tests/tell-sources-db.test.ts` now walks the whole
  proposal for functions. **Found by driving the app**, which is the second
  time today that was the only thing that could have found it.
- Livestock's lot field is searched; its FEED field is still a list, on purpose
  — an item's name carries its unit ("Grower crumble (lb)"), which is the
  difference between two bags and two pounds, and the list is short.
- Work's job field is still a list too. Open work is short by nature, and
  changing it would be change for its own sake.
- The next sources — CRM, accounting, documents — are now possible at all.
  That was the point.
