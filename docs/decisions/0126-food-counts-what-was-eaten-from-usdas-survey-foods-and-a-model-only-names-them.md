# 0126 — Food counts what was eaten from USDA's survey foods, and a model only names them

- **Date:** 2026-10-03
- **Status:** Accepted
- **Affects:** Food (D4a: the eating log), Health (through the progress slot, ADR 0125), the seed, `db:verify-modules`

## Context

The founder's health goal (2026-10-01) is to track progress from what he
does: his workouts, cold plunges and sleep are in Health (H1), and what he
eats was the one input missing. From a mockup on 2026-10-03 he chose: search a
food list, log from his own recipes, and take a photo of the plate; count
calories and all three macros; daily targets for calories and protein; meals
by breakfast, lunch, dinner and snacks. He did not choose typing the numbers in.

That needs a list of foods with their nutrition, and a rule for where a
photo's numbers come from. USDA FoodData Central publishes several lists, all
public domain (CC0 1.0), with a credit requested:

- **SR Legacy** (2018, final): 7,793 foods, named as a laboratory names them
  ("Chicken, broilers or fryers, breast, meat only, cooked, roasted").
- **Foundation Foods**: about 400 ingredients, analysed in depth, some without
  a plain energy figure.
- **Survey foods (FNDDS)**: the foods Americans report eating in the national
  survey, about 5,400, as eaten ("Chicken breast, grilled, skin not eaten",
  "Egg, whole, boiled or poached", pizzas and salads), every one with the same
  core nutrients and household portions with their weights ("1 banana", 126 g).
- **Branded foods**: 400,000 and more packaged foods with barcodes; 3 GB, or
  an API that needs a key and sees every search.

## Decision

**The list is FNDDS, kept inside the platform.** A script downloads one pinned
release (URL and SHA-256), spells out USDA's abbreviations ("NS as to cooking
method" becomes "cooking method not specified"), and writes the 5,431 foods,
with their seven numbers per 100 g and their portions, to a committed file;
`npm run db:seed` loads it into `food_usda_foods`, reference data with no
tenant that any member reads and only the seed writes. A search sends nothing
outside Yosher. `db:verify-modules` fails a database without the full release.

**The numbers always come from the list or the person's recipe, never from a
model.** On a photo of the plate, Claude names each food, gives words to find
it on the list and estimates its grams; it is told not to say what anything
contains. Each food is matched on the list, the person checks the match and
the amount, and only then is anything kept. The photo goes with the request
and is kept nowhere.

**What was eaten keeps its numbers as they were worked out when it was
logged**, so an edited or deleted recipe, or a later release of the list,
never rewrites a day already eaten.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| SR Legacy (with or instead of FNDDS) | Laboratory names a person has to translate, and raw ingredients more than meals; in a search beside FNDDS it doubles most foods |
| Branded foods through USDA's API | A key, a rate limit, every search sent to USDA, and 400,000 rows of near-duplicates in a search a person types into; a barcode scan is the way to reach brands, and it is not asked for yet |
| Open Food Facts | A share-alike licence (ODbL) on the data, and its numbers are crowd-entered; the same "not asked for yet" |
| Downloading the list at seed time | A network call in every seed, CI's included, and a release that could change under a pinned hash; the committed file is 966 KB, below a migration snapshot |
| Claude estimates calories and macros from the photo | A number that looks exact and is a guess, differently each time; the list's per-100 g figures for a checked amount are the same every time and can be corrected by changing the amount |
| Reading the list's numbers again when an amount changes | A recipe edited since, or a food dropped from a new release, would rewrite or break the past |
| Typing the numbers in | He did not pick it; the nearest food on the list, or a recipe with the nutrition it states, covers a meal out |

## Consequences

- **Bought:** a search that is instant, private and the same in every
  database; numbers anyone can check against USDA; a photo that speeds logging
  up without making the numbers up; a log that never changes behind the
  person's back.
- **Cost:** no brands and no barcodes; a packaged food is the nearest
  everyday food. The list is a 966 KB file in the repo and 5,431 rows in every
  database, and a new release is a deliberate rebuild, reviewed as a diff.
- **Cost:** a photo's grams are an estimate, and its matches are only as good
  as the search; the person has to check each one.
- **Cost:** reference data in a tenant database: one more table that is not
  tenant-scoped, under the `modules` table's policies, which the isolation
  suite proves no member can write.

## Notes

USDA asks for a credit: Log food carries it ("Foods and their nutrition from
USDA FoodData Central (FNDDS 2021-2023), per 100 g"). FNDDS is renewed every
two years with the survey; a new release is `scripts/build-usda-foods.ts` with
its new URL and hash, a seed, and the foods it dropped set to null on the rows
that pointed at them (their numbers stay).
