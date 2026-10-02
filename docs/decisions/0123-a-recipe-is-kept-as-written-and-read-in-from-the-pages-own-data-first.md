# 0123 — A recipe is kept as written, and read in from the page's own data first

- **Date:** 2026-10-01
- **Status:** Accepted
- **Affects:** Food, the second personal tool ([modules/food.md](../modules/food.md), D1):
  `core/amounts.ts` (what scales), `core/recipe-page.ts` and `src/lib/net/fetch-page.ts`
  (a link), `core/draft.ts` and `read-model.ts` (Claude), `import-ops.ts` (drafts),
  `photo-ops.ts` (photos), the tables `food_recipes` and `food_imports` (0437/0438).

## Context

The founder asked for recipes in his personal space (D1), fed from wherever
recipes are: a link, a photo of a cookbook page or a card, text pasted from a
message or a caption, or typed in (his call, 2026-10-01, from a mockup). A
recipe has to scale to a number of servings, and it is the input the rest of
the food plan builds on: the week's meals, a shopping list that adds the same
food up across recipes, and nutrition. His stated goal is to track progress
from what he does, eating included.

Three questions had to be closed before any of it could be built:

1. What is stored for an ingredient: the line, or an amount, a unit and a food?
2. How a link becomes a recipe, when the page is somebody else's, sometimes
   behind a bot check, and the recipe sits among a story, ads and comments.
3. What happens to a photo of a page, which is a picture of somebody's book or
   of a family card.

## Decision

**An ingredient is kept as the line the recipe gave, and what scales is read
from that line every time it is shown** (`readLine` / `showLine`): the amount at
its start, the unit after it, and an amount in brackets after the unit. At the
recipe's own size the line shows exactly as written; scaled, only the amounts
are written again, and a unit (or one of a few foods counted whole) written in
full follows the number. A line with no amount at its start is shown as
written and marked as not scaling.

**A link is read from the page's own recipe data first.** Most recipe pages
carry a schema.org `Recipe` for search engines; when one is there it becomes
the draft exactly, with no model. Only a page without it goes to Claude, as its
words. The page is fetched by the server through the guarded resolver the mail
image proxy uses, and **a bot check is reported, never got around**: the
person is told to copy the recipe and paste it.

**A photo of a page is read and never kept.** It is made smaller on the phone,
sent to Claude with the request, and dropped: no row, no store, no log holds
it. The recipe's own photo is a different thing, kept as one derivative.

Every read lands as a draft on `food_imports` that the person checks in the
editor; nothing reaches `food_recipes` until they press Save recipe.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Amount, unit and food in columns, typed into three boxes per ingredient | Slow on a phone, and every pasted or read recipe would be forced through a parser before the person sees it, losing whatever the parser misread. Keeping the line keeps the cook's words, and a reader that gets better improves every saved recipe without a migration. D3 and D4 read the same lines through the same reader |
| Parse once at save time and store the parts beside the line | Two truths that drift the day the reader changes; the parse is cheap enough to do on every view of one person's recipe |
| Claude for every link | Slower (a minute against a second), costs a call, and can paraphrase what the page's own data gives exactly |
| Fetching the page from the person's browser | A browser cannot read another site's page (CORS); the server has to, and the guarded fetch already exists |
| Presenting as a browser, or retrying through a proxy, when a site checks for bots | Getting around a site's bot check is not something Yosher does. The person has the page in front of them and can copy it |
| Keeping the photos of a page with the recipe | They are pictures of somebody's book or of a family card, kept for no reason the person asked for; the recipe is what was wanted |

## Consequences

- A link from a site with recipe data is read in a second or two, exactly as
  the site wrote it, with its photo and its nutrition per serving.
- Sites that check for bots, and links to video and social posts (which carry
  no recipe data and usually check for bots), go through Paste the text. That
  is a manual step the person sees named in the message.
- A line written with its amount in the middle (`juice of 1 lemon`) does not
  scale, and the editor and the recipe page say so rather than guessing.
- Amounts inside the steps are not scaled; the recipe page says so when the
  servings change.
- The recipe text a page gives is copied into a private space, as recipe apps
  do. Sharing a recipe outside the space would raise the page's copyright,
  and is a decision of its own.
- One Claude read at a time per space (`IMPORT_BUSY`); a page with recipe
  data is not held up by it.

## Notes

The reader is pure and import-free (`core/amounts.ts`), and every case it takes
or refuses is in `tests/food-amounts.test.ts`. Revisit storing parts only if a
later slice (nutrition matched to a food database) needs a person's correction
of a match to stick to a line, and then store the correction, not the parse.
