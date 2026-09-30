# 0120 — A posture check is kept as what the phone measured, and read again every time

- **Date:** 2026-09-30
- **Status:** Accepted
- **Affects:** The posture check's history ([modules/posture.md](../modules/posture.md),
  slice 3): the table `fitness_posture_checks`, `core/check-doc.ts`,
  `core/history.ts`, `check-ops.ts`, `actions.ts` and `store/sync.ts`.

## Context

Slice 2 kept each check on the phone that took it, in the browser's storage,
and rebuilt its report from the numbers every time it opened. Slice 3 moves the
history to the account (ADR 0118: "what the account keeps is numbers"), so a
check can be compared with earlier ones on any device, and a change called
real only past the noise (ADR 0119).

Two things had to be settled with it:

- **What the account keeps.** The dossier's plan was two tables: the check,
  and a row per measure with its value and noise. But the measures are young.
  Their noise figures, their words and even their arithmetic will change once
  the founder's own checks come in (ADR 0119: "revisit the noise figures once
  the founder has a month of checks"), and a stored value is frozen at the
  arithmetic of the day it was stored.
- **How the numbers get there.** A posture check is the most sensitive thing
  this product measures, and the phone also holds photos of the person when
  they chose to keep them. Nothing a phone sends may be able to carry one.

## Decision

**The account keeps a check as its captures: for each view held still, where
each sticker and each of the pose model's points sat, true up, where it came
from, and the scale; plus the check's notes. Every measure, comparison, trend
and noise figure is worked out from those whenever they are read. The phone
sends them once, through one door, as a document whose schema has no place for
anything but numbers and a few known words.**

- `fitness_posture_checks`: one row per check, keyed by the id the phone made
  when the check started, with `captures` and `notes` as JSON arrays, the
  person's own day and the time (believed backwards, two minutes forwards, as
  ADR 0113's sessions). A resend is the same row: the check never changes, so
  keeping it is an insert that does nothing the second time.
- `postureCheckDocSchema` (`core/check-doc.ts`) is `strict` at every level: a
  field it does not name is refused, not dropped; every value is a bounded
  finite number, a known view or sticker, or one of the notes. `store/sync.ts`
  is the only posture code that calls the server, and sends only what
  `toCheckDoc` makes. `tests/posture-privacy.test.ts` holds both.
- The phone sends a check when it ends, and again until the account has it
  (on the posture pages, and whenever the report of an unsent check opens); a
  check it cannot keep (a private window) goes straight to the account instead.
  Its own copy stays, so photos keep their check. Deleting deletes both; a
  check deleted on another device goes from the phone too, once the account
  has had it ten minutes by the phone's own clock.
- The noise a change must beat is the published figure until the person's
  own checks show a bigger one: the gap between each check's two rounds gives
  an SEM, and three checks' worth replaces the published figure only when
  larger. Rounds are minutes apart with the stickers left on, so they cannot
  show a person steadier than the published re-test across days.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| A row per measure with its value and noise (the dossier's first plan) | Freezes each check at the day's arithmetic: a fixed sign, a better definition, or new noise figures would leave old checks disagreeing with new ones, or need a backfill for every change. The results are cheap to work out again |
| Store both the captures and the results | Two sources of truth for one check, and the results still go stale |
| Keep the history on the phone only | Lost with the phone, invisible on the laptop, and ADR 0118 already chose the account for numbers |
| Send the phone's stored record as it is | It would carry whatever the phone's storage holds next to it; a strict document made for the purpose carries only what it names |
| Let the person's rounds lower the noise too | Rounds share the day and the stickers; the published re-test does not. Lowering it would call changes real that a re-stickered check the next day would not |

## Consequences

- A fix to the arithmetic reaches every check already taken, on every device,
  the moment it deploys; so does a new measure read from existing stickers.
- The account holds the pose model's points and the stickers' places, which
  describe a body's shape. They are the person's own, in their personal space,
  under RLS, and support never opens it (ADR 0111).
- Every report and trend is worked out on the server from every check: a
  year of fortnightly checks is a few hundred kilobytes of JSON to read, far
  inside a page's time. If it ever is not, a cache of results can be added
  without changing what is kept.
- A check sent from an old app version with an older capture shape needs
  `version` to tell them apart; version 1 is the only one.
- The person's own noise can only raise the bar. A lower, personal figure
  needs a proper re-test (a second check the same day with the stickers put
  back on), which is the next slice's question.

## Notes

Revisit if checks ever need querying by a measure's value across many people
(research, a trainer's dashboard): that would want results in columns, as a
derived table rebuilt from the captures, never instead of them.
