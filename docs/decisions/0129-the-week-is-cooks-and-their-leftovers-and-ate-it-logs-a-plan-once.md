# 0129 — The week is cooks and their leftovers, and Ate it logs a plan once

- **Date:** 2026-10-03
- **Status:** Accepted
- **Affects:** Food (D2): `food_plan` and `food_eaten.plan_id` (`0448`, RLS
  `0449`), `src/modules/food/core/week.ts`, `plan-ops.ts`, the week and Put on
  the week pages, Today's planned meals, Log food's `?plan=`. The shopping list
  (D3) builds on it.

## Context

The founder asked on 2026-09-27 for a personal space with recipes, meal
planning and a shopping list. Recipes (D1) and what he eats (D4a, [ADR
0126](0126-food-counts-what-was-eaten-from-usdas-survey-foods-and-a-model-only-names-them.md))
were built first. On 2026-10-03 he chose the week and the shopping list next,
and from a mockup made four calls, two of them for the week:

- **Cook once, eat again.** Putting a recipe on a meal says how much to cook
  and how much he eats there; the rest goes on later meals as leftovers, and
  the shopping list buys once for the batch. Leave some off when someone else
  eats them.
- **Ate it, one tap.** Today shows each meal's plan, and one tap logs it as
  planned; Change first when it differed.

(The other two, staples at home and Claude naming the list's lines, are the
shopping list's, D3.)

Food is for one person, so a recipe that makes six is mostly eaten over
several meals. A plan that cannot say so either buys six servings for every
meal it is on, or buys none of the leftovers. And the eating log already
keeps what he ate with its own numbers (ADR 0126), so a plan must not become
a second log.

## Decision

**A planned meal is a row in `food_plan` of one of three kinds: a `cook`, a
recipe made at that meal (`make` servings, of which he eats `servings`, 0 for
a batch made ahead); a `leftover`, eating `servings` from a cook earlier on
(`cook_id`, its recipe read through the cook); or a `food` from the list by
its amount.** A leftover comes after its cook, what a batch feeds never
exceeds what it makes, and the days that can be planned are this week and the
next. Deleting a recipe takes its cooks off the week; deleting a cook takes
its leftovers (`ON DELETE CASCADE` on composite keys).

**No numbers are kept on a plan.** A planned meal is worked out from its
recipe or the food list whenever it is read, so a recipe corrected on Tuesday
corrects Thursday's plan.

**"Ate it" writes an eaten row the way Log food does, with `plan_id` naming
the planned meal, once** (`food_eaten_plan_once_idx`, unique on
`(tenant_id, plan_id)` where it is set, and every eaten insert's conflict
names no target). The eaten row keeps its own numbers as every eaten row does;
the plan only knows it was eaten. Change first is Log food opened on the plan
(`?plan=`), its first add carrying the same `plan_id`. Taking a plan off the
week keeps what was eaten (`ON DELETE SET NULL ("plan_id")`), and removing the
eaten row puts the plan back to waiting.

**A past week is repeated by copying its rows** onto this week or the next,
the same weekday, days already gone left out, leftovers relinked to their new
cooks and dropped with them.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Each planned meal cooked for its own servings | His second option on the mockup. A recipe for six on four meals buys for twenty-four, or he has to plan a 1-serving recipe four times and cook it once anyway; cook mode would open at one serving. |
| Leftovers derived, not stored: the first planned meal of a recipe is the cook, later ones within a few days its leftovers | Silent and wrong for a recipe cooked fresh twice in a week, or eaten by others; moving one meal would change which meal is the cook. An explicit `cook_id` says what he meant. |
| A leftover carrying its recipe as well as its cook | Two facts that can disagree. The recipe is read through the cook, one join. |
| Numbers stored on the plan when it is made | A plan is the future: a recipe's nutrition fixed after planning should count. What was eaten keeps its numbers (ADR 0126), so nothing about the past moves. |
| Ate it marking the plan eaten, with the numbers on the plan | Two logs, and Health's progress would have to read both. One log, with a pointer back, keeps the day's totals and progress where they were. |
| `food_plan.eaten_id` instead of `food_eaten.plan_id` | Either works; the pointer on the eaten row lets the unique index say "logged once" and lets clearing the week null it without touching the log's numbers. |
| Plans any number of weeks ahead | He plans a week at a time; this week and the next is the shopping horizon, and keeps a stale plan from piling up unseen. |
| Drag and drop between days | Clumsy on a phone, his main screen; `Move to` is two taps and says where. |

## Consequences

- One person's batch cooking reads as it is cooked: Cook opens at the whole
  batch, Today offers each leftover on its meal, and D3's list can buy once
  per cook.
- The week's numbers move when a recipe's nutrition changes; the log's never
  do. A day planned and eaten exactly can show slightly different totals if
  the recipe was edited between the two.
- A plan can be eaten once. Eating a planned meal twice is two things: the
  second is logged as usual, not as the plan.
- Two weeks of plan at a time; an earlier week is read-only, kept for
  repeating, with nothing deleting old plans (a few rows a week).
- Leftovers are offered for lunch and dinner in the four days after the cook
  (USDA's three to four days in the fridge), and can be moved anywhere after
  it; nothing enforces food safety beyond the offer.

## Notes

The migration orders `food_plan_tenant_id_id_idx` before the two composite
keys pointing at it (a leftover's cook, an eaten row's plan), as 0441 and 0446
did, and hand-edits `food_eaten_plan_fk` to the column-list `SET NULL`, as
0443's recipe key.
