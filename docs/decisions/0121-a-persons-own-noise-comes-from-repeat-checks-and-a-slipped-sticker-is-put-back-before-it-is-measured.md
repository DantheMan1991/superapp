# 0121 — A person's own noise comes from repeat checks, and a slipped sticker is put back before it is measured

- **Date:** 2026-09-30
- **Status:** Accepted
- **Affects:** The posture check ([modules/posture.md](../modules/posture.md),
  slice 3b): `core/placement.ts`, `core/history.ts` (`noiseFor`),
  `client/check-session.ts` (`fixStickers`), the report, and
  `fitness_posture_checks.repeat_of` (0436). Builds on
  [ADR 0120](0120-a-posture-check-is-kept-as-what-the-phone-measured-and-read-again-every-time.md),
  which left a lower personal noise to "a proper re-test".

## Context

Two things decide whether a change between checks is real (ADR 0119): how
much the measuring wobbles, and whether the stickers went on in the same
places. Both were borrowed from the studies so far. The published smallest
real changes come from other people, re-stickered on another day by trained
hands; a check's two rounds are minutes apart with the stickers left on, so
they can only show a person is LESS steady than that (ADR 0120). And sticker
placement is the largest error a check has, with nobody having studied
self-placed stickers.

The founder chose, from a mockup (2026-09-30):

- when a sticker looks moved since the last check, the coach **stops and says
  so**, and he fixes it before it is measured;
- the report **offers a repeat check**: every sticker off and back on, the
  same day, checked again; after three repeats his own figure replaces the
  published one, **higher or lower**.

## Decision

**A sticker's place is read against the body the pose model found; one that
moved more than 3 cm since the last check stops the check, by name, once a
view, and the person puts it back or says it is right. A repeat check is a
check that points at the one it repeats; the difference between the two is the
person's own full re-test, and three of them replace the published figure for
every measure, up or down.**

- `core/placement.ts`: each sticker's offset from where its bone's landmark
  says it belongs, in torso lengths and the level frame, view by view. A body
  standing differently moves sticker and landmark together, so the offset
  holds; a sticker put on elsewhere moves it. Two checks' offsets give how far
  a sticker moved on the skin, in millimetres from the plumb line's scale.
- During the check (round one only): past `SLIPPED_MM` (30), the coach names up
  to two stickers ("Your left shoulder tip sticker isn't where it was last
  time.") and asks for the fix; the check waits for the person to move to it,
  reads the view again, and says whether it now matches. "It's where it should
  be" keeps it, as does nobody moving in half a minute; the report notes which.
  For a repeat, "last time" is the check being repeated.
- In the report: every sticker against the compared check, those past
  `LISTED_MM` (20) listed, and a measure read from one of them says its change
  may be the sticker rather than the person.
- `repeat_of` on the check (a composite key to the same space's checks,
  `ON DELETE SET NULL ("repeat_of")`): a repeat is left out of trends and of
  the checks compared by default, and compared with its original.
- `noiseFor`: three repeat pairs, and SEM = √(Σd²/2n) from them sets the bar
  (1.96 × √2 × SEM), lower or higher than published; before that, rounds may
  still raise it, never lower it.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Only list slipped stickers in the report (offered) | The founder's call: fix it before it is measured, rather than learn afterwards that a change may be a sticker |
| Keep the published figures (offered) | His call the other way; the published figures are other people's, re-stickered by trained hands |
| Lower the bar from rounds | Rounds share the stickers and the minute; they would call changes real that a re-stickered check would not |
| Keep a floor under the repeats' figure | He chose "higher or lower". Three pairs is a rough figure, which the report says ("from 3 repeat checks") and each further repeat steadies |
| Compare sticker places in image pixels | The person stands a little differently each time; only an offset from the body's own landmarks separates a moved sticker from a moved body |
| Ask about every small difference | The pose model's points wander a centimetre or two between sessions; below 3 cm the check would cry wolf |

## Consequences

- A slipped sticker costs the person a minute and saves a false change.
- The placement check can only see a slip of two or three centimetres or more,
  and the report says so; smaller placement error stays in the noise, where
  the repeats measure it.
- With three repeats, a steady person with careful stickers sees smaller real
  changes than the published figures allow; a careless one sees fewer.
- Deleting a check a repeat pointed at keeps the repeat as an ordinary check.
- One more column and a self-referencing key (0436) on a table under RLS; the
  isolation suite covers a repeat pointing across the wall.

## Notes

Revisit `SLIPPED_MM` and `LISTED_MM` from the founder's first month of checks:
the readout and the report's notes carry every sticker's distance.
