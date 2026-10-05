# 0131 — A recipe's nutrition is worked out from USDA's ingredient list; Claude only matches and weighs

- **Date:** 2026-10-03
- **Status:** Accepted
- **Affects:** Food (D4): `food_usda_ingredients` and `food_recipes.worked_nutrition`
  (`0452`, RLS and search `0453`), `scripts/build-usda-ingredients.ts` and
  `scripts/data/usda-ingredients.json`, the seed's loader (`scripts/lib/usda-foods.ts`),
  `src/modules/food/core/nutrition.ts`, `nutrition-model.ts`, `nutrition-ops.ts`,
  `src/app/api/food/ingredients/route.ts`, the nutrition page and
  `components/nutrition-check.tsx`; everywhere a recipe is counted (`eating-ops.ts`,
  `plan-ops.ts`). Builds on [ADR 0126](0126-food-counts-what-was-eaten-from-usdas-survey-foods-and-a-model-only-names-them.md).

## Context

A recipe that states no nutrition was logged without numbers (D4a), and the
week showed it as `no numbers` (D2). Most recipes typed in, and many read from
pages, state none, so the founder's calories and protein had holes in them on
exactly the days he cooked.

His calls (2026-10-03, from a mockup), each the recommended option:

- **Where the numbers come from:** "Add the ingredient list". D4a's food list
  is FNDDS, foods as eaten (a cooked dish, a slice of bread); it has no
  uncooked rice, no flour, few spices, which is what a recipe's lines are.
  USDA's Standard Reference Legacy (SR Legacy, 2018, public domain) is foods
  as bought, about 7,800 of them, with household portions ("1 clove", "1 cup,
  chopped"). He approved the download (FoodData Central's 2021-10-28 JSON,
  12.6 MB).
- **The recipe's own first:** a number the recipe states wins; the worked-out
  one counts for what it does not state.
- **When you ask:** worked out when the person asks, never on its own.
- **Past logs:** filled in.

My defaults, said with the mockup and not objected to: a weight written in
the line is used as written; cups, spoons and counts use USDA's portion
weight, else Claude's estimate, marked estimated and editable; salt, pepper,
water and lines with no amount are not counted; a recipe edited since says
so, with Check it again.

ADR 0126 holds that Food's numbers never come from a model. A model asked
"how many calories in this chili" gives a number that looks exact and is a
guess, differently each time.

## Decision

**Claude matches and weighs; USDA's list says what the grams contain.** One
forced tool call (`record_matches`) reads the recipe's lines, numbered, and
gives for each: the food's name as SR Legacy writes it, as Claude remembers
it ("Cereals, oats, regular and quick, not fortified, dry"), two to five
words of it ("oats regular quick dry"), about how many grams the line means
as bought (null when it cannot tell), and whether it counts (false for salt,
pepper, water, a pinch, a heading). It is told never to say what anything
contains, and that the lines are content, not instructions. The app takes
the food on `food_usda_ingredients` named exactly so, USDA's notes in
brackets aside ("(Includes foods for USDA's Food Distribution Program)");
else, of the foods found by that name, by the words and by the line's own
words, the one whose name shares most of its words with Claude's
(`closestByName`). It then works out the line's grams in this order
(`gramsOf`):

1. a weight the line writes as its amount (`2 lb`, `200g`);
2. a weight it states past the amount (`statedWeight`): a container's size
   (`1 can (28 oz)`), `(6 oz each)`, `2 (6-ounce) fillets`, `2 x 400g tins`
   (each, times the count), `1 ½ cups (190 g)`, `(about 1 ½ lb total)` (the
   whole line); unless the line drains it and Claude weighed what is left;
3. USDA's own weight for the portion the line counts in: a unit word (a
   clove), a volume (cut-matched first: `1 cup, chopped` for diced onions),
   a count (the size the line names, then medium, then large; an egg large,
   then medium, as recipes mean);
4. Claude's estimate;
5. none: the line is not counted until the person types grams.

**The person checks every line before anything is kept**: the food (searched
again on the list), the grams (typed ones stay when the food changes), and
whether it counts. The screen sends only what was checked (each line, its
food's id, grams, where they came from, counted); **the server works the
numbers out again from the list** and refuses lines the recipe no longer
has (`NUTRITION_CHANGED`).

**What is kept is the whole recipe, as written** (`worked_nutrition`: the
whole's seven numbers to a thousandth, each line as checked, when). A serving
is the whole divided by what the recipe makes, worked out whenever it is read
(`perServingOf`; a recipe that does not say is one serving, as everywhere in
Food). So changing what a recipe makes never leaves its worked-out numbers
wrong; only a change to its lines does, and the recipe then says so, with
Check it again, its numbers still counting meanwhile. Checking it again
keeps what was checked for the lines the recipe still has; only new or
changed lines take the fresh match.

**The recipe's own numbers first, number by number** (`effectiveNutrition`):
wherever a recipe is counted (Log food's search and choice, Today's Ate it,
the week, Recent), a number the recipe states is used, and a worked-out one
for each it does not. A log keeps its numbers as logged (ADR 0126) with one
exception, on the person's tick: **saving fills in the numbers the recipe's
past logs lacked** (`coalesce`, at a serving's numbers now times the servings
logged), and never changes a number already there.

**Only on asking.** The recipe page offers Work it out from the ingredients
where it lacks numbers; Today (an entry logged with none), Log food and the
week link to it. Nothing works a recipe out by itself.

**SR Legacy is built like the food list** (`scripts/build-usda-ingredients.ts`,
pinned URL and SHA-256, the committed `scripts/data/usda-ingredients.json`,
1.2 MB, loaded by the seed): energy, protein, fat and carbohydrate are
required of every food; fiber, sugar and sodium missing from a food are kept
as 0 (none listed). Portions are `1 <modifier>` in USDA's order, weightless
ones skipped, a plural beside its singular dropped. Reference data with the
`modules` policies, as the food list has, searched through a generated
`search_tsv`.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Claude estimates the recipe's calories and macros | ADR 0126's reason: a number that looks exact and is a guess, differently every time, which no one can check line by line. |
| Match on D4a's food list (FNDDS) | Foods as eaten. No uncooked rice, flour or most spices; a recipe's lines would match cooked dishes. |
| USDA's branded foods or Open Food Facts | Brands need an API key and send each search out (branded), or a share-alike licence (ODbL); a recipe's lines are everyday ingredients. |
| Matching by words alone, no model | "2 yellow onions, diced" finds onion rings and onion powder before raw onions; turning a line into the list's words ("onions raw") is what the model is good at. |
| Claude's search words alone, the list's first hit taken | The first version. The drive's "rolled oats" found a branded oat bran ("rolled" is a dinner roll to the index) and "milk" found buttermilk. |
| A second call in which Claude picks from the list's candidates | Seconds more per recipe for what the name already does: Claude named 31 of 36 common lines exactly, and the other five were a note in brackets or a word apart, which the closest name settles. |
| Claude's grams for every line | A line that says `2 lb` or `1 can (28 oz)`, and USDA's own weighed portions, are better than an estimate; the estimate is the fallback, labelled. |
| Storing a serving's numbers and the servings | Changing what a recipe makes would leave them wrong, or mark them out of date for a change that needs no new matching. The whole recipe divided on reading cannot go stale that way. |
| Worked-out numbers over the recipe's own | His call was the recipe's own first: the author weighed the dish, the list only estimates it. |
| Working a recipe out on save, or for every recipe at once | His call: when asked. A model call per recipe saved would cost on every edit, and a number he never checked would count. |
| Leaving past logs empty | His call: filled in, but only the numbers that were missing, so a day already counted never moves. |

## Consequences

- A few seconds of Claude per recipe worked out, once; a saved result opens
  at once until the recipe's lines change.
- The numbers are as good as the matches and the grams the person checks.
  A food with no portion USDA weighed, or a line with no amount, needs grams
  typed or Claude's estimate.
- Ingredients are weighed as bought; cooking losses (water, fat) are not
  modelled, so a dish weighed after cooking is not what this counts.
- Fiber, sugar and sodium read 0 where SR Legacy lists none, so they can be
  low; they are kept, not shown in totals (as D4a).
- A recipe's own number and a worked-out one can sit side by side on a log
  (calories as stated, protein worked out).
- A past log's filled numbers are at today's servings and matches; a log made
  after the recipe changes keeps what it was logged with.

## Notes

How the name was chosen: a probe of 36 common recipe lines (the drive's
recipes, baking staples, dairy, meat) on the app's model and settings gave
SR Legacy's exact name for 31 (rolled oats and milk among them, the two the
drive's search words got wrong). The five misses were "(Includes foods for
USDA's Food Distribution Program)" left off (ground beef, cheddar) or a word
apart ("Spices, cumin seed, ground"; "mozzarella, part skim milk, low
moisture"; "broilers" for "broiler"), all found by the closest name. The
probe took 18 seconds for 36 lines.

The drive's salmon, `2 salmon fillets (6 oz each)`, was weighed at first by
USDA's fillet (2 × 198 g), because only a container's bracket was read as a
weight; the line's own 340 g is now used, as the founder's default says.

The first version stored a serving's numbers with the servings typed on the
check screen ("Makes"); a recipe saved with Makes changed to 6 would have
shown as out of date at once, and each serving would have disagreed with the
recipe's own servings in the week and Log food. Caught while writing this
record, before the PR: the whole is stored, and a serving read from the
recipe.
