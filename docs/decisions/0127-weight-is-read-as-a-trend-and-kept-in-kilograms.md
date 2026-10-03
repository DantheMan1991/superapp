# 0127 — Weight is read as a trend, and kept in kilograms

- **Date:** 2026-10-03
- **Status:** Accepted
- **Affects:** Health (H2), the progress slot (`src/lib/progress-sources/types.ts`), Today's earlier days

## Context

Health's Progress (H1, [ADR 0125](0125-health-reads-progress-from-the-tools-through-a-slot-a-week-at-a-time.md))
shows what the founder does: sleep, plunges, habits, workouts and, since D4a,
what he eats. Nothing showed what it does to him. On 2026-10-03, from a mockup,
he chose weight and the body as the next slice:

- **Weight, typed in**, on Health's Today (his scale does not sync to an app).
- **The waist and other tape measures**, the ones he picks.
- **A goal weight and a pace**: Body says when he gets there at his real pace,
  and Progress colours the better way.
- **Progress photos** as a slice of their own, after this one, kept on the
  phone only; **the calorie check** (what his eating and his weight say he
  burns) as a slice of its own once a few weeks are logged.

The same slice fills a gap H1 left: a night, a plunge or a habit forgotten
could not be put on its day afterwards, while Food's log reaches two weeks
back.

Four questions followed that the mockup did not settle:

- **What is "your weight" on a day?** A morning's reading moves a pound or two
  with water and food alone. A line through raw weigh-ins says more about
  yesterday's dinner than about the diet.
- **Which unit is kept?** He reads pounds and inches. The plunge keeps its
  water in °F as read (`water_f`).
- **How does a level sit in Progress?** Its bars are drawn from zero: 184 lb
  and 186 lb are two bars the same height.
- **How far back can a day be filled in, and what stops a Today left open
  overnight from filing this morning under yesterday,** which is now a day that
  may be filled in?

## Decision

**A weigh-in is read through a trend, worked out on every read.** Each
weigh-in moves the trend a tenth of the way towards it, a day after the last;
after a gap of `n` days, `1 - 0.9^n` of the way (about half after a week), so
daily and weekly weigh-ins both work. The first weigh-in starts it. Nothing is
stored but the weigh-ins: a changed or removed weigh-in moves the trend at once,
and Today and Progress read two months before the first day they show, after
which the oldest counts for under two in a thousand. The pace is the slope of the
least-squares line through the last 28 days of weigh-ins, read once there are
four of them at least ten days apart; the goal's date is when the trend reaches
the goal at that pace, given up to three years out. Whether a goal is to lose or
to gain is never kept: it is wherever the goal is from the trend, and within half
a pound the goal is reached. Progress's better way for the weight is towards the
goal; with no goal, neither.

**Kept in kilograms and centimetres, read in pounds and inches.** A weigh-in
is `kg` (one a day, `(tenant, weighed_on)` unique), a tape measure `cm`, a goal
`goal_kg` and `pace_kg`; `core/body.ts` turns them both ways at the edge, to a
tenth of a pound and a hundredth of an inch as typed. A setting for kilograms
changes words, not rows, and the calorie check and a scale's import, when they
come, work in the units their sources use.

**A level is its own format in the slot.** `ProgressFormat` gains `measure`: a
level read to a tenth in its unit (a tape to a hundredth), whose bars span the
four weeks' own range, at least 5 lb or 2 in of it, rather than starting at
zero. The weight row's week is the trend at that week's last weigh-in; a tape
measure's week is the mean of the times it was taken. A change under 0.3 lb or
0.2 in reads "about the same".

**Tape measures are the person's own list.** Waist, chest, hips, arm, thigh,
neck and calf are offered; any other can be named. Each says which way is
better (smaller, bigger, or neither), and that only colours the words. A day's
measurements are saved together and all or nothing; a measure from another
space refuses the lot.

**Today reaches two weeks back, and says when it was drawn as today.** A
`?day=` within 14 days of the space's today (Food's reach) shows that day's
night, weigh-in, plunges and habits to fill in; the slot's cards, which speak
of today, are left off. Every action that writes a day takes `asToday`, true
when the page showed the day as today: once the space's day has moved on, such
a write is refused (`NEW_DAY`), so a page left open overnight cannot file this
morning under yesterday. A day out of reach is refused (`DAY`). A weigh-in or a
day's tape measures already kept can be changed or removed whenever they were
kept; only adding stops at two weeks.

## Alternatives considered

- **Raw weigh-ins as the line and the number.** Rejected: the noise is the
  size of a fortnight's progress, so a good week reads as a bad one.
- **A seven-day moving average.** Smoother than raw and less behind, but a
  weigh-in leaving the window jumps it as much as one entering, and it has
  nothing to say across a gap of a week.
- **Double exponential smoothing (a trend with its own slope).** Less behind a
  steady loss, but it overshoots every turn, and a number that keeps going after
  the person stopped is worse than one that is a pound late.
- **Storing the trend.** Every edit of an old weigh-in would mean rewriting
  every trend after it; working it out on read costs two months of rows.
- **Keeping pounds as typed, as `water_f` keeps °F.** Equally exact at a tenth
  of a pound, but it puts a unit in the column name of a table a kilogram user
  will share, and the calorie check and Health Connect speak kilograms.
- **A fixed set of tape measures.** Simpler, but an arm that is meant to grow
  and a waist that is meant to shrink cannot share one notion of better.
- **Bars from zero for a level.** Rejected on sight: four bars the same height.
  Bars across the bare range were tried first and drew a 0.9 lb fall as one bar
  a fifth of the other (the drive, 2026-10-03), hence the minimum span.
- **Filling in any day back.** A paper log or a scale's memory would want it,
  but a day picker for years is an import, not a correction; two weeks matches
  Food.

## Consequences

- The trend runs behind a steady change: losing a pound a week, it sits about a
  pound above the latest weigh-ins. Body's guide says so.
- The first weigh-in anchors the trend: an odd first morning takes a week or two
  to wash out.
- The goal's date assumes the last four weeks' line goes on; it moves as the
  pace does, and says "your recent pace" for that reason.
- Weigh-ins older than two weeks can be changed or removed, never added; an
  import is its own slice when someone has a history to bring.
- Photos and the calorie check are slices of their own (the founder's calls),
  and kilograms are a setting not yet built.
