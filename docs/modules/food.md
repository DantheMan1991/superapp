# Food

> The second personal tool (ADR 0111): the person's own recipes, brought in from
> a link, a photo of a page, pasted text or typed in, checked before they are
> saved, and scaled to any number of servings; then the week's meals, the
> shopping list and nutrition. The founder's goal for it (2026-10-01) is part of
> a larger one: to track his progress from what he does, workouts, eating, cold
> plunges and sleep among it. Lives in a personal space beside
> [fitness](fitness.md); the container is [personal-space](personal-space.md).
> Status: `coming_soon` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### 2026-10-01 — D1: recipes (`claude/food-d1`)

The first slice. After Workouts' F1–F4 he chose to switch to the food side and
start with recipes. His calls, from a mockup (the list, Add a recipe, checking a
draft, a recipe scaled, and cook mode):

- **The tool is called Food** (slug `food`, `/personal/m/food`), over Meals,
  Recipes and Kitchen: it will hold the week, the shopping list and what he
  eats too.
- **Four ways in: a link, pasted text, typed in, and a photo of a page** (a
  cookbook page or a card, read by Claude). The plan had the first three; he
  added the photo.
- **Cook mode right after D1**, as its own slice (screen on, one step at a
  time, timers from the steps).
- **A page's nutrition per serving is kept**, shown as the recipe's own
  numbers, not worked out.

**Migrations `0437`** (`food_recipes`, `food_imports`, two enums) **and `0438`**
(their RLS): on dev, and **on production on his word before the merge** (its
ledger read first: exactly these two were pending). `verify-rls` passed on both
(258 tables), and the tables, their forced RLS, two policies each and the enums
were read back by name. **A catalogue row** (`food`, `personal`,
`coming_soon`, sort 310): `db:seed` on dev, and on production on his word
once asked for it separately; `verify-modules` matched on both (21 modules).

- **What scales** (`core/amounts.ts`, pure, ADR 0123): an ingredient is kept as
  the line it was given. `readLine` finds the amount at its start (whole,
  fraction, `½`, mixed, decimal, comma decimal, range), the unit after it (US,
  metric and counted units), an amount in brackets after the unit (scales) and
  a can's size before it (does not); a size (`2-inch`, `14-ounce`) is not an
  amount. `showLine` writes it again for a factor: at 1 exactly as written;
  otherwise fractions to eighths and thirds for cups and counts, decimals for
  metric, a unit or one of a few foods counted whole following the number
  (`1 egg` → `2 eggs`).
- **A link** (`readLink`): fetched by the server through `src/lib/net/
  fetch-page.ts`, the mail image proxy's twin on the same guarded resolver
  (moved to `guarded-lookup.ts`): http/https on 80/443, each redirect checked
  again, 3 MB after decompression, 10 s a hop, 20 s in all, an honest user
  agent, no cookies. `core/recipe-page.ts` finds a schema.org `Recipe` in the
  page's JSON-LD (`@graph`, `mainEntity`, lists, a type URL, comment-wrapped
  or broken-line blocks) and maps it exactly: yield, ISO durations, instruction
  strings, steps and sections, category and cuisine as tags, nutrition strings
  (sodium in grams made milligrams), the image. With no recipe data, the
  page's words (scripts, styles, navigation and footer out, 60,000 characters)
  go to Claude. A bot check (403, 429, challenge and captcha markers) is
  reported (`BLOCKED`) and never got around.
- **Pasted text and photos of a page** (`readText`, `readPhotos`): to Claude
  (`read-model.ts`, the `record_recipe` tool, Workouts' draft call as the
  model: adaptive thinking, forced tool, streamed, eager input, stop reason
  checked, refusal fallback). Photos are made smaller on the phone (1,568 px,
  up to four, 3.2 MB of base64 together) and kept nowhere.
- **Drafts** (`food_imports`): every read that goes to Claude makes its row
  first (`reading`), so leaving the page loses nothing; a page with recipe data
  makes it straight away as `draft`. One Claude read at a time per space
  (`IMPORT_BUSY`); a reading row older than five minutes reads as interrupted.
  Saving or discarding deletes the row. A read that fails while the person is
  still on Add a recipe shows why there, and the page discards the failed
  draft; one that fails after they left waits on the Food page with its reason.
- **Photos** (`photo-ops.ts`): one derivative per recipe, made by the site
  photos' `preparePhoto` (1,600 px JPEG, orientation baked in, every tag
  dropped), in the private store under `food/<tenant>/photos/`, served only by
  the recipe's (or draft's) own route after an RLS read of its row, with a
  version in the URL. A photo picked in the editor is made smaller on the phone
  and sent with Save; the page's photo, for a link, is fetched through
  `fetchRemoteImage` when the draft is made. A photo stored for a save that
  fails is deleted; one replaced or removed is deleted after the save commits.
- **Screens**: the Food page (Drafts, search over names, tags and ingredient
  lines, tag filter, rows), Add a recipe (the four ways, `maxDuration` 300),
  the editor (`/new`, `/drafts/[id]`, `/recipes/[id]/edit`: photo, name, makes,
  times, tags with suggestions, ingredients read back with amounts marked and
  `does not scale`, steps, notes, nutrition, source, every message), and the
  recipe page (servings − and +, ingredients scaled with ticks, `as written`,
  the steps note, nutrition labelled as the recipe's own, notes, Edit, Delete).
- Registry entry, icon `utensils`, accent `--accent-food` (hue 45), the
  personal home's and the door's words, guides `docs/help/food/` (overview,
  add, editor, recipe) and the personal overview guide.

**Driven** on a production build against dev, in his own personal space
(Food beside Workouts in the sidebar, its own orange):

- **A link with recipe data** (an Allrecipes pancake page): a draft in 1.5 s
  with no model: name, 8 servings, the times, tags Breakfast and American, 7
  lines as the page's data writes them (`1.5 cups`), 5 steps, nutrition per
  serving (158 kcal … 504 mg sodium), and the page's photo, fetched, prepared,
  stored and shown through the draft's route, then the recipe's. Saved.
- **Scaling** 8 → 4: `¾ cup`, `1 ¾ teaspoons`, `½ tablespoon`, `⅛ teaspoon`,
  `⅝ cup`, `1 ½ tablespoons`, `½ egg`, with `Made for 8 servings. Reset` and
  the steps note. A tick crossed a line out; Reset gave the lines as written.
- **Pasted text** (an invented caption): Claude gave the name, 2 servings, 7
  lines as written (`Juice of 1 lemon`, a handful of parsley and salt and pepper
  marked `does not scale`), 3 steps, tags from its hashtags, 380 kcal and 14 g
  protein as stated, and no times (none were stated). Doubled, the lemon line
  said `as written`.
- **A photo of a page** (an invented card drawn for the drive): Claude in 6.6
  s: name, `8 wedges`, prep 10, cook 25, all 7 lines and 4 steps, their numbers
  off; the card kept nowhere. A dish photo added in the editor was made smaller
  on the phone and stored (1600×1200). 12 wedges: `1 ⅞ cups cornmeal`,
  `1 ⅛ cups flour`, `3 large eggs`.
- **Typed in**: an empty save said `Give the recipe a name.`; `ten` minutes
  said `Write the prep time as whole minutes, like 20.`; Done read the lines
  back with amounts marked; saved with no photo and no servings buttons, and
  `No steps written down.`
- **The Food page**: rows with photo, time, yield and tags; `buttermilk`
  found the cornbread, `olive lemon` (both words) the salad, `tofu` said
  `No recipe matches.`; the Breakfast tag left the pancakes.
- **Edit**: Remove photo and save left no photo; the old photo's address 404.
- **A link with no recipe** (example.com): Claude, 4 s, `No recipe was found
  there…` on Add a recipe, and the failed draft discarded by the page.
- **Leaving mid-read**: the Food page said `Pasted text · Reading, started
  just now`, then the recipe's name and `Ready to check`; the discard dialog's
  words; `Draft discarded`.
- **NYT Cooking** answered without a bot check: a draft in 9 s (11 lines, 4
  steps, a photo), discarded unsaved. No site in the drive answered with one;
  `BLOCKED` is proven by the tests only.
- **Delete**: `Delete Toast with honey butter?` and its words; gone, its page 404.
- **375 px**: no Food screen wider than the phone; no server error in the log.

**Found by the drive, and fixed:**

1. **`1 can (15 oz) cannellini beans` doubled to `2 cans (30 oz)`.** A size in
   brackets after a container read as an equivalent amount. A container (can,
   tin, jar, bottle, package, packet, bag, box, carton, container, envelope)
   now keeps its size; after a measure the brackets still scale (`1 stick
   (½ cup)` → `2 sticks (1 cup)`). Tests added.
2. **A comma typed in Add a tag stayed in the box.** The editor watched the
   key, which an Android keyboard often does not send for a character. It now
   reads the text, so a comma (typed or pasted) ends a tag; Enter still does.
3. **Before it, the guarded resolver itself** (see [email.md](email.md)):
   every fetch failed until it answered Node's `all: true` with a list.

**Found by CI:** `tests/module-accents.test.ts` put every accent on one
wheel, and hue 45 sat 10° from `work`. Personal tools never share a rail with
business modules, so the test now spaces each rail on its own
([design-system.md](design-system.md)); Food keeps 45.

Tests: `tests/food-amounts.test.ts` (37: reading and writing amounts),
`tests/food-core.test.ts` (43: page data in every shape, durations, yields,
instructions, nutrition, entities, page words, bot checks, Claude's answer read
back, photo limits, the editor both ways and every message), `tests/food-ops.
test.ts` (db, 13: recipes saved, listed, edited and deleted; a link with data
read with no model, one without sent to Claude, every reason a link fails with
no row left, a paste, photos kept nowhere, a failed answer, one read at a time,
an interrupted read, a draft's photo handed back), `tests/isolation/food.test.
ts` (5), and `tests/guides.test.ts` (every Food screen finds its guide).

## The slices

| # | Slice | Done when |
| --- | --- | --- |
| D1 | **Recipes** | A recipe by hand, from a link, from pasted text or from a photo of a page, checked before it is saved, scaled to a number of servings, with its photo and the nutrition it states. **Built** |
| D1b | **Cook mode** | "Cook" on a recipe: the screen stays on, one step at a time in big type, the ingredients ticked off, a timer for each time a step names, several at once, sounding when done (his call: right after D1) |
| D2 | **The week** | Recipes on days and meals, moved about, a past week repeated |
| D3 | **The shopping list** | Built from the week, the same food added up across recipes (`core/amounts.ts` reads every line), ticked off in the shop on a phone |
| D4 | **Nutrition** | Per recipe and per day, worked out from the ingredients and labelled as worked out, beside the recipe's own numbers. Moved up by his health goal; it needs a food database (USDA FoodData Central is public domain) |

**His health goal (2026-10-01)**, in his words: "track progress based on things
i am doing with the workout, eating/diet, cold plunge, sleep etc." That is a
layer over the personal tools, not a part of Food: habits logged (a cold
plunge, a night's sleep), next to what Workouts already logs and what Food will
know was eaten, and progress shown across them. Not designed; ask him before
any of it, after D1. What D1 leaves for it: recipes as structured lines a
food log can point at (`(tenant_id, recipe_id)`), and nutrition per serving.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `food_recipes` | A person's recipe: title, what it makes (`yield_amount` double, `yield_unit`), prep, cook and total minutes, `tags` text[], `ingredients` and `steps` jsonb (`{ text, heading? }[]`, kept as written), `notes`, `nutrition` jsonb (per serving, as the recipe states it: calories, protein, carbs, fat, fiber, sugar g; sodium mg), `source_url`, the photo (`photo_pathname`, width, height), `created_by_clerk_user_id` | D1, `0437`. RLS member + superadmin (`0438`). `food_recipes_tenant_id_id_idx` is the composite key later slices point at. CHECKs: a title, yield > 0, minutes 0–10,080, a photo all or nothing |
| `food_imports` | A recipe on its way in: `kind` (`link`, `text`, `photo`), `source_url` (a link's), `status` (`reading`, `draft`, `failed`), the `draft` (a recipe input, its name allowed empty), `error`, the page's photo for a link | D1, `0437`/`0438`. Deleted on save or discard. CHECKs: a link has its URL; a photo all or nothing. Nothing points at it |

## Key files & seams

- `src/modules/food/core/amounts.ts` — what scales: `readLine`, `showLine`,
  `scaleLine`, `formatAmount`. Pure and import-free; D3 adds lines up with it.
- `src/modules/food/core/recipe.ts` — the saved shape (`recipeInputSchema`,
  `RECIPE_LIMITS`, `NUTRITION_KEYS`), line and tag cleaning, the small words
  (`minutesWords`, `yieldWords`, `hostOf`, `timeOf`).
- `src/modules/food/core/editor.ts` — the form both ways and every message.
- `src/modules/food/core/draft.ts` — what goes to Claude (`RECIPE_SYSTEM`,
  `recordRecipeTool`, `buildReadPrompt`), the one reader of a draft
  (`normalizeDraft`), the read requests' schemas and the photo limits.
- `src/modules/food/core/recipe-page.ts` — a page read: JSON-LD, the Recipe,
  its fields, the page's words, title and photo, `looksBlocked`.
- `src/modules/food/core/errors.ts` — every code and its sentence.
- `src/modules/food/read-model.ts` — the Claude call. `import-ops.ts` — reads
  and drafts (`readLink`, `readText`, `readPhotos`, `takeImport`,
  `discardImport`, `settleImport`); its `ReadDeps` replace the fetch, the photo
  and the model in tests. `recipe-ops.ts` — recipes. `photo-ops.ts` — photos.
  `actions.ts` — the five actions.
- `src/lib/net/fetch-page.ts` and `guarded-lookup.ts` — the server's guarded
  page fetch; `fetch-image.ts` (the mail image proxy's) fetches a page's photo.
- `src/lib/blob.ts` — `foodPhotoPathPrefix`.
- `src/app/personal/(space)/m/food/` — `add`, `new`, `drafts/[id]` (and its
  `photo` route), `recipes/[id]` (and `edit`, `photo`). The front page is the
  registry's `FoodModule` through `m/[slug]`.
- `src/modules/food/components/` — `recipe-list`, `add-recipe`,
  `recipe-editor`, `recipe-view`, the delete and discard buttons,
  `refresh-while-reading`, `shrink-photo` (the phone's resize).

## Decisions & gotchas

- **The line is the truth** (ADR 0123). Nothing parsed is stored; a better
  reader improves every recipe. At the recipe's own size a line is shown
  exactly as written, so a misread can only misscale, never misquote. The
  editor shows how each line is read (`does not scale` included), so the
  person sees a misread before they need it.
- **A page's own recipe data before Claude** (ADR 0123): exact, a second, no
  call. Only a page without it costs a model read.
- **A bot check is never got around.** The fetch says who it is; a 403, a 429
  or a challenge page is `BLOCKED`, with the way round named for the person:
  Paste the text. Video and social links usually end there.
- **A photo of a page is never kept** (ADR 0123). No row, store or log: the
  pictures go with the request and nowhere else. `tests/food-ops.test.ts`
  checks the draft holds none of their bytes.
- **The page's text is untrusted content.** It only fills the one forced
  tool's fields, which the person checks before anything is saved, and the
  prompt says that anything in it reading like an instruction is content.
- **A read that fails fast leaves nothing behind**: a link is fetched before
  any row exists, so a bad link, a bot check or a missing page is a message
  on Add a recipe and no draft.
- **A late answer to a discarded draft is dropped**, and the photo kept for it
  deleted: only a row still `reading` takes Claude's answer.
- **Per serving stays per serving.** The recipe page's servings change the
  ingredients, never the nutrition. Changing a saved recipe's "Makes" without
  changing its nutrition would make that nutrition wrong; the editor does not
  try to tell.
- **The photo route is the authorization.** The store is private; a photo is
  served only after the recipe's (or draft's) row is read under the person's
  RLS, and its URL changes with the photo, so the browser may keep it.
- **Typing a recipe in sends the photo with Save** (made smaller on the phone
  first), so a recipe that is never saved leaves no photo behind. A page's
  photo, for a link, is stored when its draft is made and handed over or
  deleted with the draft.

## Open items

- **No bot check has been met in a drive.** `BLOCKED` is proven by the tests;
  the sites tried (Allrecipes, NYT Cooking) answered the reader.
- **Nobody has added a recipe on a phone yet.** The drive ran in a desktop
  pane at 375 px; a phone's camera, its photo picker and a real Android
  keyboard are unwatched.
- **Cook mode (D1b)** is next, his call.
- **A pasted list of several recipes** reads as the first (or the main) one.
- **A recipe in another language** is copied in its language; nothing
  translates.
- **Unit conversion** (cups to grams, Fahrenheit to Celsius) is not built.
- **Amounts in steps** do not scale; the recipe page says so.
- **Recipe photos are not cropped.** The list shows them square and the page
  as they are, at most 28rem high.
- **No per-space budget for Claude reads**, as Workouts' recorded voice has
  none: one read at a time bounds a runaway client, not a day's total. Before
  Food opens to everyone, a daily read budget per space.
- **Sharing a recipe** (a link, a household) is not built, and would raise the
  copyright of a page's text and photo (ADR 0123).
