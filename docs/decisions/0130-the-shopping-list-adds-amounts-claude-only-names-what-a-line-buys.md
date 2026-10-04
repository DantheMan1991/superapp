# 0130 — The shopping list adds the amounts; Claude only names what a line buys

- **Date:** 2026-10-03
- **Status:** Accepted
- **Affects:** Food (D3): `food_line_names` and `food_staples` (`0450`, RLS
  `0451`), `src/modules/food/core/list.ts` and `core/list-names.ts`,
  `list-model.ts`, `list-ops.ts`, the list page and `components/shopping-list.tsx`
  with its phone store (`list-store.ts`); `after()` in the week's actions.
  Builds on [ADR 0129](0129-the-week-is-cooks-and-their-leftovers-and-ate-it-logs-a-plan-once.md).

## Context

With the week built (D2), the founder's other two calls from the same mockup
(2026-10-03) were the shopping list's:

- **The same food across recipes:** "Claude names each line" over "exact words
  only". `2 cups long-grain white rice, rinsed` and `1 cup rice` should be one
  line to buy, sorted into an aisle, which rules on the words cannot do well.
- **Things at home:** salt, oil and spices asked about once ("Have these at
  home?"), "Always have" remembered.

My defaults, said in chat and not objected to: the list covers the next seven
days, changeable; it is kept on the phone, so ticks work with no signal in the
shop; his own items can be added.

ADR 0126 already holds that Food's numbers never come from a model. A
shopping list's amounts are numbers too: half a can more or less is the
difference between enough chili and not.

## Decision

**Claude names; the app counts.** For each ingredient line (and each planned
food's name), Claude gives the thing a shopper looks for (`item`), its aisle,
and whether most kitchens keep it (`staple`), through one forced tool call for
a list's new lines together, told the names the space already uses so one
thing keeps one name. The answer is kept per space and line in
`food_line_names`, a row a thing (a line may buy two: "Salt and pepper to
taste"), so each line is named once; a line Claude does not answer stays
unnamed and is asked again; one row with `item` null is a line that buys
nothing. A line that buys two things counts its amount for each.

**The amounts are read from the lines, every time, by `core/amounts.ts`**, at
each cook's batch (`make` of what the recipe makes; leftovers add nothing),
and added in `core/list.ts`: weights across ounces, pounds and grams, volumes
across spoons, cups and milliliters, never one into the other; a unit of its
own (cloves, cans of a size) by its kind; a range by its larger end; a line
with no amount listed without one.

**The trip is the phone's.** The days the list covers (held from the first
tick until their last day has gone, so tomorrow's default never unticks
today's shop), its ticks (kept by the list's first day, so other days start
unticked; a ticked thing stays in its place, struck through) and the person's
own items live in the browser's storage for the space. Only "Always have"
(`food_staples`) is kept on the server, because it should follow him to
every phone.

**Lines are named ahead**: the week's actions name a plan's new lines with
`after()`, once the answer has gone, so the list is usually sorted when it is
opened; the list page names whatever is left when it opens, and shows those
lines as written until then.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Exact words only: merge lines whose food words match | His second option. "Rice" and "long-grain white rice" stay two lines, and an aisle from a word list misplaces anything it has not listed. |
| Claude adds the amounts too | Arithmetic is the one thing a model may get quietly wrong, and ADR 0126 keeps every Food number out of a model's hands. |
| Naming the whole list on every open, nothing kept | Seconds of waiting in the shop, every time, and a list that could rename the same line differently from one trip to the next. |
| Naming each line alone, as recipes are saved | One thing would get as many names as there are lines for it; named together, with the names in use, it keeps one. Recipes from a page's own data are never sent to Claude at all (ADR 0123), so a save-time name would be missing for most. |
| Ticks on the server, with a queue for no signal | More to build and to go wrong for one person on one phone in a shop; the plan and his staples, which do need to follow him, are on the server already. |
| A list stored as rows when it is made | It would go stale as the week changes; worked out from the week every time, it follows it, and a tick that the week has outgrown says so. |
| Converting volumes to weights | Needs every ingredient's density; a cup of flour and a cup of honey differ by a factor of two. |

## Consequences

- One call to Claude a week's worth of new recipes, a few seconds, usually
  before the list is opened; nothing at all for lines named before.
- A wrong name sticks for that line until the line changes: a renamed or
  re-aisled item is not editable yet (an open item), and an item Claude says
  buys nothing (`null`) is left off.
- Ticks, his items and the days are per phone and per browser; a cleared
  browser forgets them. What he always has does not.
- A tick remembers the amount it was made at, so a meal added after the shop
  brings the item back with "the week now needs more".

## Notes

`food_line_names` keeps the line exactly as the list reads it (spaces
collapsed, at most 500 characters), unique per space, line and item with
`NULLS NOT DISTINCT` (so "buys nothing" is kept once too); two runs naming at
once keep the first answer (`ON CONFLICT DO NOTHING`). The first draft keyed
it by line alone, and the drive found "Salt and pepper to taste" named only
"salt": pepper would never have been asked about.
