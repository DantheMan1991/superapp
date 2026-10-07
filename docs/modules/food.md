# Food

> The second personal tool (ADR 0111): what the person eats, logged from USDA's
> food list, their own recipes or a photo of the plate and counted against
> their targets (D4a); and their own recipes, brought in from a link, a photo
> of a page, pasted text or typed in, checked before they are saved, and
> scaled to any number of servings, a recipe's nutrition worked out from its
> ingredients on USDA's list when it states none (D4); and the week's meals, a
> recipe cooked once and eaten again (D2), and the shopping list made from it
> (D3). Drawn in its own "Fresh Market" skin since UI1 (ADR 0132). The
> founder's goal for it (2026-10-01) is part of a larger one: to track his
> progress from what he does, workouts, eating, cold plunges and sleep among
> it, which [Health](health.md) shows. Lives in a personal space beside
> [fitness](fitness.md); the container is [personal-space](personal-space.md).
> Status: `coming_soon` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

Older entries (D1c, D1b and D1) are in [food-build-log.md](food-build-log.md).

### 2026-10-06 — The Fresh Market redesign: Today and Log food (`claude/food-ui`)

He had Claude Design redraw Food and picked "Fresh Market" (option 1a), handed
over as a zip (`design_handoff_food_fresh_market`: a README build spec and a
`.dc.html` mockup; viewed from the scratchpad, never the repo). It designed
Today on a computer and a phone and Log food on a phone; the week, the
recipes, a recipe and the list are not drawn. **His calls (2026-10-06, each
the recommended option):** a USDA food's picture is an ICON FOR ITS KIND, from
its USDA category; KEEP THE MICROPHONE, as the tell box's dictation; the
undrawn screens get a MOCKUP FIRST, in the next PR. Mine, said in chat: keep
`MEALS`' order (the mockup put Snacks before Dinner). ADR 0132.

- **The skin** (`globals.css`): the design's values as `--food-*` on `:root`,
  `food-*` utilities in `@theme` (colours, eight shadows, `font-food-display`),
  drawn only in Food; `[data-app-main]:has([data-food-page])` paints the
  shell's pane `--food-bg`. Contrast measured (scratchpad
  `food-contrast.mjs`): every text pair 4.5:1 or better; the placeholder is
  muted, not subtle (4.42:1 on the field). Radii on the scale, none literal.
- **The face**: Bricolage Grotesque with its optical-size axis
  (`components/food-display.ts`, `next/font/google`), its variable on
  `FoodPage` and the sheet; only Food's pages preload it. The test stub
  (`tests/stubs/next-font-google.ts`) has it, since the module registry
  reaches it.
- **`FoodPage`** wraps every Food page: the face, `@container` (Food's layouts
  follow the width they are given: phone below `@2xl`, the hero in two
  columns from `@4xl`), and `data-food-page`.
- **The tabs** (`food-nav.tsx`): a pill segmented control in place of the
  shared strip, four equal items without icons on a phone. `List` carries
  what is left to buy: every page with the tabs reads `listInput` (the List
  page's own read, moved to `list-ops.ts`) and the tab works the list out on
  the phone, with its days and ticks, by `leftToBuy` (`core/list.ts`).
- **Today** (`FoodModule.tsx`, `components/food-today.tsx`): a greeting by the
  hour (`greetingFor`) with his first name from Clerk on a computer (the
  shell's own `currentUser` call, deduplicated), the date and
  `dinner's already planned.`; the day in a pill. `quick-log.tsx`, the search
  bar (computer): Log food's search in a popover that folds away when the bar
  loses the focus, the amount sheet, the microphone, the camera, `Again?`
  (the last four logged: + logs at once with an 8-second Undo toast, the chip
  opens the sheet). `day-card.tsx`: the double ring (CSS keyframes from empty,
  `motion-reduce:` off), calories and protein against their targets, the
  energy split (`energySplit`, fat 9 kcal a gram), the line under it
  (`cheerFor`), the targets' editor; with no targets the four numbers large.
  `up-next-card.tsx`: the next plan not eaten whose meal is not over
  (`upNext`: by when a meal ends, not `MEALS`' order), Ate it giving way to
  `Logged to dinner. Nice work.` and Undo until the page is next opened.
  `meal-list.tsx`: cards side by side on a computer, one card of rows on a
  phone (a row a meal, up to three pictures, opened with a tap), planned rows
  dashed with Ate it and, on a tap, Change first and Cook. `today-model.ts`
  holds the row's shape and the optimistic entries. `eaten-day.tsx` is gone.
- **The floating bar** (phone): `What did you eat?` to Log food, and the
  camera. A fixed element inside the `@container` page stays fixed to the
  viewport (checked: 24 px above the bottom at 375 px).
- **Log food** (`log-food.tsx`): the design's top, meal chips, search box
  with the microphone, the photo tile, `Recent · one tap adds it` (+ logs at
  once into the chosen meal; the row opens the sheet), the plate's review
  restyled. **`amount-sheet.tsx`**, shared with Today: a bottom sheet on a
  phone and a card in the middle from `sm`, steps of a serving, half a
  portion or 10 g (`core/choice.ts`, with the choice's numbers and words).
- **Pictures** (`components/food-thumb.tsx`, `core/food-icons.ts`): a recipe's
  photo, a chef's hat without one, a USDA food as the icon for its WWEIA
  category (ordered rules, whole words where a short one hides in a longer:
  "pie" in "pieces", "oil" in "boiled", "pea" in "peaches"). The day, the plan,
  recent and the recipe search now carry the recipe's photo URL and the
  food's category (`core/photo-url.ts`, pure, so `eating-ops.ts` does not
  import the blob store).
- **The microphone**: `/api/food/transcribe` (`resolvePersonalContext`, Food
  switched on) over the handler the tell box's route now shares
  (`src/lib/speech/transcribe-route.ts`); `DictateButton` gained `endpoint`
  and an `icon` look that hides where a browser cannot record. The tell box's
  route refuses a personal space (401, checked), which is why.
- **The camera's photo** reaches Log food in memory (`plate-handoff.ts`): Log
  food shows `Reading the photo` from its first frame and reads it in an
  effect that only waits for the answer (`readPlatePhoto`, a function outside
  the component, since the compiler's lint refuses an effect that calls one
  that sets state).
- **Guides**: `overview.md` and `log.md` rewritten for the screens; `list`,
  `recipes` and `week` name the tab's count; two button looks, `food` and
  `food-soft`, so a guide draws Food's buttons in its colours
  (`guides-core.ts`, `guide-control.tsx`, the template).
- **Tests**: `tests/food-today.test.ts` (19 pure: the greeting, up next, the
  rings and the split, the line under the numbers, every USDA category's
  icon, the choice's numbers, words and steps, the photo's address);
  `food-list.test.ts` gains the tab's count. The 36 Food db tests that call
  the changed reads pass on dev.
- **Driven** on a production build against dev (an invented day: three
  recipes, a breakfast, a lunch and a snack logged, dinner and a snack
  planned; removed after), at 1280 and 375 px: one-tap add and its Undo, the
  search, the sheet's steps and meal, Ate it and its Undo on Up next, an
  entry's amount and meal changed, a protein-only target, a planned row's
  Change first and Cook, an earlier day, a meal row opened on the phone, Log
  food's one-tap and sheet and Undo, a drawn plate photographed from Today's
  camera and read on Log food, both transcription doors, the Week, Recipes
  and List pages, and the tab's count (8 before Claude named the lines, 6
  after, the list's own six). **Fixed from it:** `Snacks gets you to…` (now
  `Your snack gets you…`, `Up next · Snack, planned`), the Undo toast gone
  in four seconds (eight now), the plate's portion box pushing its button
  down a line, a recipe with no photo showing the chef's hat twice, four
  `Again?` chips not fitting a line, the targets button squeezing the line on
  a phone. The pane drew no frames for part of the drive, so a closed sheet
  stayed mounted (Radix waits for an exit animation that never ran); a
  visible window closes it.
- **No migration, no seed.**

### 2026-10-06 — The three oldest entries move to an archive (`claude/food-build-log-archive`)

Nothing about the tool changed; this records why the file you are reading is
shorter. The dossier is read at the start of every Food session, and its build
log had reached 698 of its 1,024 lines, past AGENTS.md's "a few screens".

- **D1c, D1b and D1** (2026-10-01 and 2026-10-02) moved to
  [food-build-log.md](food-build-log.md), 364 lines cut by line range and none
  edited: 7 entries before, 4 here besides this one and 3 there, and the
  original rebuilt from the two files has the same MD5. The file went from 1,024
  to 677 lines.
- **D4, D3, D2 and D4a stay**, and new entries still go here, at the top.
  build-docs walks the whole `docs/` tree, so the archive renders at
  `/admin/docs` with no code change.

### 2026-10-03 — D4: a recipe's nutrition, worked out (`claude/food-d4`)

The holes in his numbers: a recipe that states no nutrition was logged with
none, and the week said `no numbers`. **His calls, from a mockup
(2026-10-03):** ADD THE INGREDIENT LIST (USDA's SR Legacy; he approved the
12.6 MB download), the RECIPE'S OWN NUMBERS FIRST, worked out WHEN ASKED,
past logs FILLED IN. My defaults, said with the mockup: a weight in the line
is used as written; cups, spoons and counts by USDA's portion weight, else
Claude's estimate, marked and editable; salt, pepper, water and lines with no
amount not counted; Check it again after an edit.

- **The ingredient list** (ADR 0131): `scripts/build-usda-ingredients.ts`
  reads FoodData Central's SR Legacy JSON (pinned URL and SHA-256, or a local
  zip) into `scripts/data/usda-ingredients.json`: 7,793 foods, 1.2 MB, the
  seven numbers per 100 g (fiber, sugar, sodium 0 where none is listed) and
  household portions (`1 clove`, `1 cup, chopped`; a plural beside its
  singular dropped). `food_usda_ingredients` (`0452`, RLS and `search_tsv`
  `0453`) is reference data like the food list; the seed loads both lists
  through one loader (`scripts/lib/usda-foods.ts`), verify-modules checks
  both. `searchUsda` in `eating-ops.ts` searches either list.
- **Matching** (`core/nutrition.ts`, `nutrition-model.ts`, `nutrition-ops.ts`):
  one forced `record_matches` call reads the recipe's lines (up to 150,
  headings left out) and gives each the food's name as SR Legacy writes it,
  search words, grams as bought (or null) and whether it counts; never what
  anything contains. Each food is the one named exactly so (`usdaByName`,
  USDA's notes in brackets aside), else the closest name among those found by
  the name, the words and the line (`closestByName`). `gramsOf` weighs a
  line by a weight it states (its amount; past it, `statedWeight`: a
  container's size, `(6 oz each)`, `2 (6-ounce) fillets`, `2 x 400g`, each
  times the count, or `(190 g)`, `(about 1 ½ lb total)` for the line; unless
  drained and estimated), USDA's portion (a unit word, a volume matched to the
  cut, a count by the size named, then medium, then large, an egg large
  first), Claude's
  estimate, or nothing; grams to a tenth. `amountAt` and `unitAt` are now
  exported from `core/amounts.ts` for it.
- **Keeping it**: the screen sends each line, its food's id, its grams, where
  they came from and whether it counts; `saveWorked` refuses a line the
  recipe no longer has (`NUTRITION_CHANGED`) and works the numbers out again
  from the list. `food_recipes.worked_nutrition` (`0452`) keeps the WHOLE
  recipe and the lines as checked; a serving is the whole divided by what the
  recipe makes when read (`perServingOf`), so changing what it makes leaves
  nothing out of date. With the box ticked, the recipe's past logs get the
  numbers they lacked (`coalesce`), never a number already there.
- **Counted everywhere**: `effectiveNutrition(own, worked, yield)` (the
  recipe's own first, number by number) in Log food's search and choice,
  Recent, Today's Ate it and the week.
- **The screens**: the recipe's Nutrition card (its own numbers, worked-out
  ones for what it does not state, Work it out from the ingredients or Check
  it again, and a note when its lines changed);
  `/personal/m/food/recipes/[id]/nutrition` (`maxDuration` 60), each line
  with its food, grams and where they came from, Change food (a GET search of
  the list, `/api/food/ingredients`), Leave out or Count it, the totals as
  they change, the past-logs box, Save as worked out and Match again; links
  from Today (Work out its nutrition on an entry with none, and the day's
  note), Log food and the week's card.
- Tests: `food-nutrition` (19 pure), `food-nutrition-ops` (8 db, with a
  stand-in for Claude, on the seeded list), `isolation/food-nutrition` (4).
  Guide `recipe-nutrition.md`; `recipe.md`, `overview.md`, `log.md`,
  `week.md` and `week-add.md` updated.
- **Fixed before the PR**: the first version kept a serving's numbers with
  the servings typed on the check screen; a recipe saved with "Makes" changed
  would have read as out of date at once and disagreed with its own servings
  elsewhere. Now the whole is kept and "Makes" is read from the recipe.
- **Driven on dev** (a production build, Claude for real, five invented
  recipes in dev's personal space, removed after): a chili stating nothing
  matched in about ten seconds, every line sensible (2 lb of turkey from the
  line, onions and garlic by USDA's portions, drained beans estimated, salt
  left out), a food changed and grams typed, saved with its two earlier logs
  filled (2 servings: 782 kcal, 1: 391); a salmon dish stating only calories
  kept its 690 kcal with protein, carbs and fat worked out; overnight oats
  with no yield counted as one serving; Log food's link, Today's note and
  Work out its nutrition on an entry (the log filled on save), the week's
  card link; a line edited on the chili showed the out-of-date note and Check
  it again kept the earlier checks; a saved result reopened at once; the help
  panel, the empty search, and 375 px with no sideways scroll.
- **Fixed from the drive**:
  "2 salmon fillets (6 oz each)" was weighed by USDA's fillet (2 × 198 g), as
  only a can's bracket was read as a weight (now any weight the line states,
  `statedWeight`); "rolled oats" matched a branded oat bran and "milk"
  buttermilk, since the first hit for Claude's search words was taken (now
  Claude names the food as SR Legacy does, matched exactly or by the closest
  name: 31 of 36 common lines named exactly in a probe, the rest a note in
  brackets or a word apart); the recipe card showed 37.9 g where the check
  screen said 38 g (now rounded the same); "1 egg" took USDA's medium egg
  (now an egg is large unless the line says otherwise); the week's note said
  a recipe "states none" with nothing to do about it (now it says to tap the
  meal and work it out); Check it again after an edit dropped the grams and
  foods checked on lines that had not changed (now `keepChecked` keeps them,
  and only new or changed lines take the fresh match).
- **On DEV AND PROD before the merge** (his word, "Run the migrations and
  then the pr and commit and push", 2026-10-05): the prod ledger read first
  (it ended at 0451, exactly 0452/0453 pending), `0452`/`0453` applied (prod
  ledger ids 458/459), verify-rls 274 on both; the seed on both (prod loaded
  the 7,793 ingredients), verify-modules green on both with both lists
  checked; read back on prod: `food_usda_ingredients` with RLS enabled and
  forced and its two policies, `food_recipes.worked_nutrition` jsonb, Food
  still `coming_soon`. Nothing to run after the merge.

### 2026-10-03 — D3: the shopping list (`claude/food-d3`)

The other half of what he picked with the week (D2, #698 merged). **His calls,
from the same mockup (2026-10-03):** CLAUDE NAMES EACH LINE (over exact words
only), the app adds the amounts; staples ASKED ONCE ("Have these at home?":
Have it, Always have) and remembered. My defaults, said in chat: the next
seven days, changeable; kept on the phone so ticks work with no signal; his
own items; a cooked batch bought once, at its size.

- **Naming** (ADR 0130, `core/list-names.ts`, `list-model.ts`): one forced
  `record_items` call for a list's new lines together (up to 120), told the
  names the space already uses, gives each line's item, aisle (produce, meat,
  dairy, bakery, pantry, frozen, drinks, other) and staple flag; kept in
  `food_line_names` per space and line, a row a thing (`0450`, RLS `0451`), so
  each line is named once and "Salt and pepper to taste" is salt and black
  pepper. A line unanswered stays unnamed and is asked again; `item` null
  buys nothing (water). Lines are content, never instructions. The week's
  actions (Put on the week, a food, Repeat a week) name new lines with
  `after()` once their answer has gone; the List page names what is left on
  opening ("Sorting 12 ingredients into aisles") and refreshes, with Try again
  if Claude cannot be reached, those lines listed as written meanwhile.
- **Adding up** (`core/list.ts`): every line read again by `core/amounts.ts`
  at its cook's batch (`make / yieldAmount`; leftovers add nothing; a recipe
  with no yield as written), gathered by item: weights across oz, lb, g, kg;
  volumes across tsp, tbsp, cups, fl oz, ml, l (never one into the other:
  `4 cloves + 1 tsp`); units of their own by kind with a container's size
  (`2 cans (15 oz)`); counts; a range by its larger end; no amount listed
  without one; a planned food by its portion (`5 × banana`) or weight. Shown
  in the recipe's system (US when any line used US units).
- **The trip, on the phone** (`components/list-store.ts`, the cook store's
  idiom): the days (today and six after to start, held from the first tick
  until the last day has gone, ending by next Sunday), ticks kept by the
  list's first day (a new first day starts unticked) with the amount ticked
  (more needed later brings it back: "the week now needs more"), Have it, his
  own items (a ticked one gone from the next trip). Only Always have
  (`food_staples`) is on the server, with Put back.
- **The screen** (`/personal/m/food/list`, a `List` tab, and Shopping list on
  the week): the days and Change days, the aisles, each item with what needs
  it, Not sorted yet, Have these at home? (with At home), Your items, what is
  left off as always had. A ticked thing stays where it is, struck through.
- Tests: `food-list` (19 pure), `food-list-ops` (5 db, with a stand-in for
  Claude), `isolation/food-list` (5). Guide `list.md`; `overview.md`,
  `week.md`, `recipes.md` and the space's overview updated; `shopping-cart`
  registered for guides. Food's catalogue line and the space's home name the
  list (a seed on both databases), and the home no longer says what comes next.
- **Driven on dev** (a production build, three invented recipes, Claude for
  real): planning a recipe named its lines in the background within seconds
  (`after()`); the list opened with them sorted, a batch bought once, olive
  oil gathered across two recipes with each one's share, staples asked
  separately; with the names wiped, the list said "Sorting 14 ingredients
  into aisles" and sorted itself. Ticks, Have it, Always have and Put back,
  his own items, a new first day starting a fresh trip, the help panel, 375
  px. **Fixed from it:** "Salt and pepper to taste" was named salt alone (a
  line held one thing: now a row a thing, and the table was rewritten before
  any production run); a ticked item jumped down to a cart and the next tap
  hit the row that moved under the finger (now it stays in place, struck
  through, and the cart is gone); the default days moved with today, which
  would have unticked a Saturday shop on Sunday (now held from the first
  tick); "Bananas, banana" (one of a portion now reads "1 banana").
- **On DEV AND PROD before the merge** (his word, "Go for it"): the prod
  ledger read first (it ended at 0449, exactly 0450/0451 pending), `0450`/
  `0451` applied (prod ledger ids 456/457), verify-rls 273 on both, the key
  read back from `pg_constraint` (`UNIQUE NULLS NOT DISTINCT (tenant_id, line,
  item)`); the catalogue seed on both, verify-modules green on both, Food
  still `coming_soon`.

### 2026-10-03 — D2: the week (`claude/food-d2`)

He chose the week and the shopping list after Health H2b merged (#697), over a
recipe's nutrition worked out, reminders to log, and Workouts' F5: the last
part of what he first asked for (recipes, meal planning, a shopping list).
**His calls, from a mockup of both (2026-10-03):** COOK ONCE, EAT AGAIN (say
how much to cook and how much he eats; the rest goes on later meals as
leftovers, and the list buys once for the batch; leave some off if someone
else eats them); ATE IT with one tap on Today (Change first when it
differed). The list's two calls (staples asked once, then remembered; Claude
names each line and the app adds the amounts) are D3's, which follows this
one's merge. My defaults, said in chat: recipes AND foods on the week; Monday
to Sunday; this week and the next, earlier weeks to repeat; a Move to menu,
no dragging on a phone; Add to the week on a recipe; seven columns on a wide
screen.

- **`food_plan`** (ADR 0129, `0448`, RLS `0449`): a `cook` (a recipe made at a
  meal: `make` servings, `servings` of them eaten there, 0 for a batch made
  ahead), a `leftover` (eats `servings` from a cook earlier on; its recipe is
  read through the cook) or a `food` from the list by its amount. One CHECK
  keeps each kind's columns; composite keys cascade a recipe's deletion to its
  cooks and a cook's to its leftovers. No numbers kept: a plan is worked out
  from the recipe or the list whenever it is read.
- **The rules, in `core/week.ts` and again in `plan-ops.ts`:** this week and
  the next can be planned (`canPlan`); a leftover comes after its cook
  (`isAfter`, breakfast, lunch, dinner, snacks); a batch never feeds more than
  it makes (`batchFits`). Leftovers are offered for lunch and dinner on the
  four days after the cook (USDA's three to four days), the next free lunches
  lit up first, then dinners (`firstLeftovers`), each as much as he eats at
  the cook.
- **The week** (`/personal/m/food/week`, `?week=` a Monday back twelve weeks):
  the days' average calories and protein against the targets (only days with
  something planned, as a week of eating averages the days logged), seven
  day cards (one column on a phone, two at `@2xl`, seven at `@6xl`, container
  queries), each planned meal with what it is ("Cook 4 servings, eat 1", "3
  more: Tue lunch, Wed lunch, Thu dinner", "From Mon dinner") and its
  calories. Tap one: how much, Move to (day and meal), Plan leftovers while
  the batch has some, Cook (cook mode at the whole batch), Recipe, Take off (a
  cook says its leftovers go too). Repeat a week copies an earlier week onto
  this one or the next, same weekdays, days gone left out, leftovers relinked.
- **Put on the week** (`/personal/m/food/week/add`, from the week, a meal's
  plus, or a recipe's new Add to the week): day, meal, then a recipe or a
  food (the search is Log food's, now `use-food-search.ts`); for a recipe,
  Cook and You eat steppers and the leftover meals; for a food, its amount.
- **Today**: each meal shows what is planned and not yet eaten in a
  `Planned` box: Ate it (one tap, logged as planned, shown at once), Change
  first (Log food on `?plan=`, its first add logged as the plan), Cook. An
  eaten row now has `plan_id` (one a plan, `food_eaten_plan_once_idx`); every
  eaten insert's conflict names no target, so a resend with a new id is still
  one. Taking a plan off keeps the log (`SET NULL ("plan_id")`); removing the
  eaten row puts the plan back to waiting.
- `RecipeHit` gained `yieldAmount` (Cook starts at what the recipe makes).
- Tests: `food-week` (18 pure), `food-week-ops` (11 db), `isolation/food-week`
  (8). Guides: `week.md`, `week-add.md`; `overview.md`, `log.md`, `recipe.md`,
  `recipes.md` updated. `calendar-plus` registered for guides. Food's catalogue
  line and the space's home name the week (a seed on both databases).
- **On DEV AND PROD before the merge** (his word, "Run the migrations and then
  the pr"): the prod ledger read first (it ended at 0447, exactly 0448/0449
  pending), `0448`/`0449` applied (prod ledger ids 454/455), verify-rls 271 on
  both, the keys read back from `pg_constraint` (plan key `SET NULL
  (plan_id)`, cook and recipe keys CASCADE, the partial unique index); the
  catalogue seed on both, verify-modules green on both, Food still
  `coming_soon`.
- **Driven on dev** (a production build, dev's personal space with three
  invented recipes): tonight's chili with leftovers (Cook 6 down to 4, the
  lunches offered again), the batch changed and a leftover added, next week's
  leftovers, Repeat a week onto next week, a food on a breakfast, a refused and
  an allowed move, Ate it, the log entry removed (the plan waits again),
  Change first at 1.5 servings, `Eaten` on the week. Fixed from it: a target
  bar drawn under `–` with nothing planned; days gone by with nothing planned
  are now one line, so today is not at the bottom of a phone's page; Put on
  the week and Log food had no "?" (Log food never had); Repeat a week said
  "this week" while showing next week.

### 2026-10-03 — D4a: eating, logged (`claude/food-d4a`)

He chose it after Health H1 merged (#693, #694), over the week and the
shopping list, Workouts' F5 and the consumer door: the one input his health
goal still lacked. **His calls, from a mockup (2026-10-03):** ways in are a
search of a food list, his own recipes, and a photo of the plate (he did not
pick typing the numbers in); count calories AND all three macros, shown
alike; daily targets for calories and protein; breakfast, lunch, dinner and
snacks.

- **The food list** (ADR 0126): USDA FoodData Central's survey foods (FNDDS
  2021-2023, the 2024-10-31 release), the foods people report eating, 5,431
  of them, each with its seven numbers per 100 g and its household portions
  ("1 banana", 126 g). Chosen over SR Legacy (lab names: "Chicken, broilers or
  fryers, breast, meat only") and branded foods (400,000 and more, a key, the
  search sent to USDA). Built by `scripts/build-usda-foods.ts` from a file
  pinned by URL and SHA-256, "NS as to" and "NFS" spelled out, committed as
  `scripts/data/usda-foods.json` (966 KB, a food a line), and loaded by
  `npm run db:seed` into `food_usda_foods`, so every database gets the same
  list with no network. `db:verify-modules` now fails a database without it.
- **Search as you type**, each word a prefix, through a generated tsvector
  (as documents' 0026) and a GET (`/api/food/search`) the box can cancel. A
  food with more of the words first, so the nearest is found when none has
  them all; then the plain food first: a name that is the words before its first comma ("Rice,
  white, cooked" for rice), then one whose second part is them ("Fish, salmon,
  raw" for salmon), then a category of that name, then a name starting with
  the first word; rank and a shorter name break ties. Tuned on dev against
  banana, rice, salmon, egg, steak, almonds, avocado and more.
- **Today** is Food's front page now (`FoodModule.tsx`): the day's calories,
  protein, carbs and fat as four tiles alike, a bar under calories and protein
  for the targets, and each meal with what is in it; tap a thing to change
  its amount, portion or meal, or remove it. Arrows step back two weeks, to
  log a forgotten meal. The recipes moved one tab over, to
  `/personal/m/food/recipes`, under a `Today` / `Recipes` strip (`food-nav.tsx`).
- **Log food** (`/personal/m/food/log`, `components/log-food.tsx`): the meal,
  the search, what was logged lately and the recipes cooked lately under the
  box, a card to say how much with the numbers live, and Add; you stay to add
  the next thing, with Undo on each. **A photo of the plate**: Claude names
  each food and estimates its grams (`plate-model.ts`, forced tool, adaptive
  thinking); each is matched on the list by its words (`plate-ops.ts`); the
  person checks, changes or removes each, and Add all logs them in one
  transaction. Claude never says what a food contains; the photo is kept
  nowhere. Opened with a recipe chosen from the recipe page (Log it) and from
  cook mode's last screen (Log what you ate).
- **The numbers are kept as worked out when logged**, so an edited or deleted
  recipe, or a new release of the list, never rewrites a day already eaten.
  A change of amount scales those numbers; it never reads the list again.
- **Health** shows Food through the progress slot (`progress-source.ts`,
  `core/progress-rows.ts`): calories, protein, carbs and fat a day, averaged
  over the days logged, the days on each target set, and an Eating card on
  Health's Today. Health's Progress now writes an amount of ten or more
  whole, with thousands marked ("2,010 kcal"), and calls under 50 kcal, 5 g or
  100 mg "about the same".
- Three tables (`0443`, RLS and the search column in `0444`), and `0445`:
  `food_eaten.created_at` defaults to `clock_timestamp()`, because a plate's
  rows share one transaction, where `now()` gave them one instant and "most
  recent" became a coin toss (the db test found it).
- Guides: `overview.md` is Today's manual now; the recipe list's moved to
  `recipes.md`; new `log.md`; `recipe.md`, `cook.md`, `add.md` and
  `editor.md` say "your recipes" for what was "the Food page"; Health's
  overview and progress gain Eating. Tests: `tests/food-eating.test.ts`
  (pure), `tests/food-eating-ops.test.ts` (the database), and
  `tests/isolation/food-eating.test.ts`.
- `DayWatch` moved to `src/components/app/day-watch.tsx`, shared with Health:
  Today refreshes itself when the day has moved on.
- **On dev and production, before the merge.** Production's ledger was read
  first (it ended at `0442`, with exactly `0443`-`0445` pending); they went on
  at the founder's word, `db:verify-rls` is green on both databases (266
  tables), and the recipe key reads `ON DELETE SET NULL (recipe_id)` in
  `pg_constraint`. The seed loaded the 5,431 foods and Food's catalogue line
  on both, and `db:verify-modules` is green on both.
- **Driven on dev (a production build, his space).** Targets set (a number
  out of range refused, "2,200" with its comma taken); a banana, Greek yogurt
  by the cup and coffee logged to breakfast, the coffee undone; a drawn
  breakfast plate read in 7 s as a fried egg, bacon, toast and "butter on
  toast"; one item corrected by hand and the plate added to lunch in its
  order; an entry moved to breakfast at two slices, another to a tablespoon,
  one removed, each at once; Health's Eating card and Food's six rows on its
  Progress; 375 px with no sideways scroll. It found:
  - **"Butter on toast" was matched to a peanut butter and jelly sandwich,**
    and "bacon strips cooked" or "butter on toast" typed in found nothing,
    because a food had to have every word. A food with more of the words now
    comes first and a search no food has every word of finds the nearest
    (`searchFoods`); and the plate prompt asks for words the way the list
    names a food, with no shape words and a spread as a food of its own.
  - Progress wrote "35.5 g" where Today wrote "35 g": an amount of ten or
    more is whole in both now.
  - A script that clicked Undo while the last Add was still finishing hit a
    disabled button: the page is right (one transition at a time), the
    script was early.

## The slices

| # | Slice | Done when |
| --- | --- | --- |
| D1 | **Recipes** | A recipe by hand, from a link, from pasted text or from a photo of a page, checked before it is saved, scaled to a number of servings, with its photo and the nutrition it states. **Built** |
| D1b | **Cook mode** | "Cook" on a recipe: the screen stays on, the ingredients gathered first, one step at a time in big type with what it uses, a timer for each time a step names, several at once, ringing until stopped, and "Log that you made it". **Built** |
| D1c | **Hands-free** | Each step read aloud in the coach's recorded voice, and "next step", "go back", "repeat", "start timer", "stop timer" and "ingredients" heard on the phone (his calls: reading aloud comes with the voice commands; the listener on the phone; short phrases). **Built** |
| D2 | **The week** | Recipes and foods on days and meals, a recipe cooked once and its leftovers on later meals, moved about, a past week repeated, and a planned meal logged from Today with one tap (his calls 2026-10-03; ADR 0129). **Built** |
| D3 | **The shopping list** | Built from the week, buying once per cook's batch, the same food added up across recipes (`core/amounts.ts` reads every line; Claude names each line's item and aisle, the app adds the amounts: his call), staples asked about once and then remembered (his call), ticked off in the shop on a phone (ADR 0130). **Built** |
| D4a | **Eating, logged** | What was eaten, from USDA's food list, a saved recipe or a photo of the plate, in breakfast, lunch, dinner or snacks; calories and the three macros a day against calorie and protein targets; in Health's progress (his calls, 2026-10-03; ADR 0126). **Built** |
| UI1 | **The Fresh Market look, Today and Log food** | His pick from a Claude Design handoff: Food's own skin and face, the tabs as pills with the list's count, Today's search bar, rings, Up next and meal cards, the phone's floating bar, Log food's sheet and one-tap recent; a food's picture an icon for its kind (his call), the tell box's dictation in the search (his call) (ADR 0132). **Built** |
| UI2 | **The rest of Food in the same look** | The week, the recipes, a recipe and the list, from a mockup he approves first (his call). Not started |
| D4 | **Nutrition of a recipe** | Worked out from its ingredients when asked: each line matched on USDA's ingredient list (SR Legacy, his call) and weighed, every line checked, the whole recipe kept and a serving read from what it makes; the recipe's own numbers first (his call), counted wherever a recipe is, past logs filled in (his call) (ADR 0131). **Built** |

**His health goal (2026-10-01)**, in his words: "track progress based on things
i am doing with the workout, eating/diet, cold plunge, sleep etc." That is a
layer over the personal tools, not a part of Food: habits logged (a cold
plunge, a night's sleep), next to what Workouts already logs and what Food will
know was eaten, and progress shown across them. Built as [Health](health.md)
(H1, 2026-10-02), which reads what Food knows through the progress slot
(ADR 0125); what was eaten is D4a's.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `food_recipes` | A person's recipe: title, what it makes (`yield_amount` double, `yield_unit`), prep, cook and total minutes, `tags` text[], `ingredients` and `steps` jsonb (`{ text, heading? }[]`, kept as written), `notes`, `nutrition` jsonb (per serving, as the recipe states it: calories, protein, carbs, fat, fiber, sugar g; sodium mg), `worked_nutrition` jsonb (D4, `0452`: the WHOLE recipe's seven numbers worked out from its lines on the ingredient list, each line as checked, `workedAt`; null until asked), `source_url`, the photo (`photo_pathname`, width, height), `created_by_clerk_user_id` | D1, `0437`. RLS member + superadmin (`0438`). `food_recipes_tenant_id_id_idx` is the composite key later slices point at. CHECKs: a title, yield > 0, minutes 0–10,080, a photo all or nothing |
| `food_cooks` | A time a recipe was cooked (D1b): `made_on` (the space's day), `servings` (what it was made for), the phone's id | `0439`/`0440`. Composite key to `food_recipes` (`(tenant_id, recipe_id)`, ON DELETE CASCADE). The recipe's count and last day are read from it |
| `food_eaten` | What was eaten (D4a): `eaten_on` (the space's day), `meal` (enum `food_meal`: breakfast, lunch, dinner, snack), `source` (enum `food_eaten_source`: food, recipe, photo), `fdc_id` or `recipe_id`, `name` as it was, `amount` of `portion` ("1 banana", "g", "oz", or "serving"), `grams` (a food's; null for a recipe), and the seven numbers as worked out when logged (null where a recipe states none) | `0443`, RLS member + superadmin (`0444`). The id is the phone's (`ON CONFLICT DO NOTHING`). `fdc_id` → `food_usda_foods` ON DELETE SET NULL; composite `(tenant_id, recipe_id)` → `food_recipes` ON DELETE SET NULL ("recipe_id"), hand-edited to the column-list form, so a deleted recipe leaves the row and its numbers. CHECKs: amount 0–100,000, grams for foods and none for recipes, numbers not negative. `created_at` defaults to `clock_timestamp()` (`0445`), so a plate's rows keep their order. Index `(tenant_id, eaten_on)`. `plan_id` (D2, `0448`): the planned meal it was, composite `(tenant_id, plan_id)` → `food_plan` ON DELETE SET NULL ("plan_id") (hand-edited); `food_eaten_plan_once_idx` unique on `(tenant_id, plan_id)` where it is set, so a plan is eaten once |
| `food_plan` | The week (D2, ADR 0129): `planned_on` (the space's day), `meal`, `kind` (enum `food_plan_kind`: cook, leftover, food); a cook's `recipe_id`, `make` and `servings` (eaten there, 0 for a batch made ahead); a leftover's `cook_id` and `servings`; a food's `fdc_id`, `name`, `amount`, `portion` and `grams`. No numbers: worked out from the recipe or the list when read | `0448`, RLS member + superadmin (`0449`). The id is the phone's (`ON CONFLICT DO NOTHING`). `food_plan_shape` CHECK keeps each kind's columns (a cook's `servings` between 0 and `make`, at most 999). Composite keys: `(tenant_id, recipe_id)` → `food_recipes` CASCADE, `(tenant_id, cook_id)` → `food_plan` CASCADE (its unique index `food_plan_tenant_id_id_idx` created before the keys, hand-ordered). `fdc_id` SET NULL. `created_at` `clock_timestamp()`. Indexes `(tenant_id, planned_on)`, `(tenant_id, cook_id)` |
| `food_line_names` | What a line buys (D3, ADR 0130), a row a thing: `line` (an ingredient line or a planned food's name, spaces collapsed, at most 500), `item` (the thing to buy, lower case, at most 80; one row with null buys nothing), `aisle` (enum `food_aisle`), `staple`. Named by Claude once per space and line; "Salt and pepper to taste" is two rows | `0450`, RLS member + superadmin (`0451`). Unique `(tenant_id, line, item)` `NULLS NOT DISTINCT`; inserts `ON CONFLICT DO NOTHING`. No amount: the list reads those from the line |
| `food_staples` | What the person always has (D3): `item`, left off every list until put back | `0450`/`0451`. Primary key `(tenant_id, item)`, item lower case, at most 80 |
| `food_targets` | The daily targets: `calories` (500–10,000) and `protein_g` (10–500), either null | `0443`/`0444`. One row a space (`tenant_id` the key). A day is judged against the targets as they are now |
| `food_usda_foods` | The food list (D4a, ADR 0126): FNDDS 2021-2023, 5,431 foods, `name`, `category` (WWEIA), the seven numbers per 100 g, `portions` jsonb (`{ label, grams }[]`), `release` | `0443`; REFERENCE DATA with no tenant: `modules`' two policies (superadmin all, any member reads) in `0444`, with `search_tsv`, a generated tsvector (name A, category B) not modelled in the schema, GIN-indexed. Written only by the seed from `scripts/data/usda-foods.json` |
| `food_usda_ingredients` | The ingredient list (D4, ADR 0131): SR Legacy, 7,793 foods as bought, the same columns as `food_usda_foods` (`category` is USDA's food group), portions as `1 <modifier>` | `0452`; REFERENCE DATA, `modules`' two policies and `search_tsv` (GIN) in `0453`. Written only by the seed from `scripts/data/usda-ingredients.json`; fiber, sugar and sodium 0 where SR Legacy lists none |
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
- Cook mode (D1b): `core/times.ts` (the times in a step), `core/uses.ts` (what
  a step uses), `core/cook.ts` (the session, timers as end times, the words),
  `components/cook-mode.tsx`, `cook-store.ts` (the phone's store),
  `use-now.ts` (the countdown's clock), `alarm.ts`; `cook-ops.ts` (the log).
  The screen-on hook is `src/lib/use-wake-lock.ts`, shared with Workouts.
- Hands-free (D1c): `core/hands-free.ts` (the commands, what is said, the
  shorthand written out, timers by voice), `components/hands-free.tsx` (the
  switch, the explanation, the box), `cook-voice.ts` (the script fed to the
  voice queue). The listener is `src/lib/voice-commands/`
  ([voice-commands.md](voice-commands.md)); the voice is `src/lib/speech/`
  (`clips.ts`, `voice-queue.ts`, `voice-choice.ts`); the route is
  `src/app/api/food/voice/route.ts` over `record-route.ts`.
- `src/lib/net/fetch-page.ts` and `guarded-lookup.ts` — the server's guarded
  page fetch; `fetch-image.ts` (the mail image proxy's) fetches a page's photo.
- `src/lib/blob.ts` — `foodPhotoPathPrefix`.
- `src/app/personal/(space)/m/food/` — `add`, `new`, `drafts/[id]` (and its
  `photo` route), `recipes/[id]` (and `edit`, `photo`). The front page is the
  registry's `FoodModule` through `m/[slug]`.
- `src/modules/food/components/` — `recipe-list`, `add-recipe`,
  `recipe-editor`, `recipe-view`, the delete and discard buttons,
  `refresh-while-reading`, `shrink-photo` (the phone's resize).

- Eating (D4a): `core/eating.ts` (meals by the time of day, a food's numbers
  for its grams and a recipe's for its servings, the day added up, the
  targets, the inputs' schemas), `core/plate.ts` (the plate's prompt, tool and
  reader), `core/progress-rows.ts` (what Health is told); `eating-ops.ts` (the
  list's search, the log, its changes, recent, targets), `plate-model.ts` (the
  Claude call), `plate-ops.ts` (a plate read and matched), `progress-source.ts`
  (the slot's filler); Today's day is UI1's files (below; `eaten-day.tsx`
  is gone), `log-food.tsx` (Log food), `food-nav.tsx` (the tabs),
  `new-id.ts`; `src/app/api/food/search/route.ts`; the pages
  `src/app/personal/(space)/m/food/log` and `.../recipes` (the list's page).
- The week (D2): `core/week.ts` (weeks, what can be planned, meals in order,
  the leftovers a cook offers, the numbers, a week repeated, the inputs),
  `plan-ops.ts` (read, put on, move, change, take off, Ate it, repeat),
  `components/week-plan.tsx` (the week), `plan-add.tsx` (Put on the week),
  `use-food-search.ts` (the search, shared with Log food); pages
  `src/app/personal/(space)/m/food/week` and `.../week/add`. Today's planned
  meals are in `meal-list.tsx` and `up-next-card.tsx`; Log food's `?plan=` in
  its page.
- The shopping list (D3): `core/list.ts` (what a line asks for, the sums and
  their words, the list for a run of days, the trip on the phone),
  `core/list-names.ts` (Claude's prompt, tool and reader), `list-model.ts`
  (the call), `list-ops.ts` (the days' plan, names, naming, always have),
  `components/shopping-list.tsx`, `list-store.ts`; the page
  `src/app/personal/(space)/m/food/list`.
- A recipe's nutrition (D4): `core/nutrition.ts` (which numbers count, a
  line's grams, the whole and a serving, whether a result still fits,
  Claude's prompt, tool and reader, the inputs), `nutrition-model.ts` (the
  call), `nutrition-ops.ts` (a recipe matched, kept, past logs filled),
  `components/nutrition-check.tsx`; the page
  `src/app/personal/(space)/m/food/recipes/[id]/nutrition` and
  `src/app/api/food/ingredients/route.ts`.
- The Fresh Market look (UI1, ADR 0132): the tokens in `src/app/globals.css`
  (`--food-*`), `components/food-display.ts` (the face), `food-page.tsx` (every
  page's box), `food-nav.tsx` (the tabs and the list's count), `food-thumb.tsx`
  (a picture: photo, chef's hat or the icon for a food's kind),
  `food-today.tsx` (Today's state), `day-card.tsx`, `up-next-card.tsx`,
  `meal-list.tsx`, `today-model.ts`, `quick-log.tsx` (the search bar and the
  camera hook), `amount-sheet.tsx` (shared with Log food), `plate-handoff.ts`;
  `core/today.ts` (greeting, up next, the line, the split), `core/food-icons.ts`,
  `core/choice.ts`, `core/photo-url.ts`; `src/app/api/food/transcribe/route.ts`
  over `src/lib/speech/transcribe-route.ts`.
- The food lists: `scripts/build-usda-foods.ts` (FNDDS, pinned download,
  readable names) and `scripts/build-usda-ingredients.ts` (SR Legacy, D4),
  `scripts/data/usda-foods.json` and `usda-ingredients.json` (committed),
  `scripts/lib/usda-foods.ts` (the seed's loader for both);
  `scripts/seed.ts` loads them, `scripts/verify-modules.ts` checks them.

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
- **A timer is an end time, and lives on the phone** (D1b). A count would
  drift while a phone sleeps; an end time is right whenever cook mode looks.
  Kept per recipe in the browser's storage for 12 hours, so leaving and
  coming back resumes it.
- **The alarm rings only while cook mode is on the screen.** The screen is
  kept on for it; a phone locked or another app in front hears nothing, and
  a timer that ended meanwhile is ringing on return. A page has no other way
  to sound (no notifications here).
- **Hands-free hears only on the phone, and never while it speaks** (ADR
  0124). The recipe's words go to the voice vendor to be recorded once;
  nothing the person says leaves the phone. While a line is being read the
  listener drops the sound, so a step that says "repeat with the rest" does
  not repeat itself; the cost is that nobody can talk over the voice.
- **A dialog does not inherit the module's colour.** It is portalled out of
  the route's wrapper, so `text-module-accent` in it is the brand's green
  unless the dialog sets `--module-accent` itself (`FOOD_ACCENT`, D1c).
- **The voice waits for the listener** (D1c): a screen is read once the
  listener is ready, so the first line has its recording (fetched in a
  request of its own) instead of the phone's voice.
- **The voice is fed one line at a time** (`cook-voice.ts`). The queue holds
  three lines waiting and drops the rest, and a long step is several lines;
  every line carries the key `cook`, so a new screen cuts the old one off.
- **A cook's id is the phone's**, so "Log that you made it" pressed twice, or
  sent again, is one log; the day it is logged for is the space's.
- **Per serving stays per serving.** The recipe page's servings change the
  ingredients, never the nutrition. Changing a saved recipe's "Makes" without
  changing its nutrition would make the nutrition it STATES wrong; the editor
  does not try to tell. Worked-out numbers follow "Makes" (D4): the whole is
  kept and divided when read.
- **The photo route is the authorization.** The store is private; a photo is
  served only after the recipe's (or draft's) row is read under the person's
  RLS, and its URL changes with the photo, so the browser may keep it.
- **Typing a recipe in sends the photo with Save** (made smaller on the phone
  first), so a recipe that is never saved leaves no photo behind. A page's
  photo, for a link, is stored when its draft is made and handed over or
  deleted with the draft.

- **The numbers come from the list or the recipe, never from a model**
  (ADR 0126). On a plate, Claude names each food and estimates its grams; the
  list says what those grams contain, and the person checks the amounts.
- **What was eaten keeps its numbers as logged.** A recipe edited or deleted,
  or a new release of the list, never rewrites a day already eaten. Changing
  an amount scales the kept numbers by grams (a food) or servings (a recipe);
  it never reads the list again, so a food no longer on it can still change.
  The one exception is D4's, on the person's tick: a recipe worked out fills
  in the numbers its logs LACKED, never one they have.
- **A recipe with no nutrition is logged without numbers**, and the day says
  how many such things it has, rather than guessing or blocking, with Work out
  its nutrition on the entry (D4).
- **Calories on target means within a tenth either way; protein, at or
  above.** Calories are neither better nor worse in Health's colours, since
  one person's goal is less and another's more.
- **A week averages the days logged.** A day with nothing logged is not a day
  of zero calories; it is left out, as Health leaves out a week with no night.
- **The search is a GET, not a server action.** Actions run one behind
  another; a search box must drop the answer to an old keystroke. The words
  are reduced to letters and digits before they reach the tsquery, the LIKE
  patterns and the regex, so nothing typed changes the query's shape.
- **`clock_timestamp()` on `food_eaten.created_at`.** `now()` is the
  transaction's start, so a plate's foods, written in one transaction, shared
  one instant, and their order (and "most recent") was arbitrary.
- **Today is the front page; the list moved.** `FOOD_HOME` still names
  `/personal/m/food`, which is Today; `FOOD_RECIPES` is the list. Every action
  revalidates both (`refreshFood`), since an action re-renders the page it was
  called from only when that page is named.
- **A cook and its leftovers, not a meal per serving** (D2, ADR 0129). A
  recipe planned on four meals is one cook and three leftovers, so the list
  buys once and Cook opens at the batch. A leftover reads its recipe through
  its cook, and the order (leftovers after their cook) is checked on every
  write, in `plan-ops.ts` as well as the screen.
- **A plan keeps no numbers; what was eaten keeps its own** (D2). The week
  reads the recipe and the list as they are; "Ate it" writes an ordinary eaten
  row with `plan_id`, once. Every eaten insert's `ON CONFLICT DO NOTHING`
  names no target, so the second Ate it, with a new id, meets the plan's
  unique index and is dropped instead of failing.
- **Claude names, the app counts** (D3, ADR 0130). Claude only says what a
  line buys, its aisle and whether it is a staple; every amount on the list is
  read from the line and added here. A name is kept per line, so a list is
  sorted at once the next time, and a line changed in its recipe is a new line
  to name.
- **Claude matches and weighs; the list says what the grams contain** (D4,
  ADR 0131). The model gives the food's SR Legacy name, search words, an
  estimate in grams and whether a line counts; it never says what anything
  contains, and the server works the numbers out again from the list for what
  the person checked. A weight in the line, a container's size or USDA's own
  portion beats the estimate.
- **Match by the name, not the first hit** (D4). The list's search stems
  words ("rolled" is a dinner roll), so its first hit for a few words can be
  wrong; Claude's remembered name, matched exactly or by the most words in
  common, is not. `usdaByName` and `foodNameKey` normalise names the same way
  (USDA's notes in brackets dropped); its regex patterns are bound as
  parameters, since a backslash in drizzle's `sql` template is lost.
- **The whole recipe is kept, a serving is read** (D4). `worked_nutrition`
  holds the whole; `effectiveNutrition` divides by `yield_amount` wherever a
  recipe is counted, so every caller must select it. A result goes out of
  date only when the lines change (`workedStillFits` compares them cleaned
  and sorted), and still counts until checked again.
- **The ingredient list is not the food list.** SR Legacy is foods as bought
  (uncooked rice, flour, spices), FNDDS foods as eaten; a recipe matches on
  the first, a meal is logged from the second. `searchUsda` takes the table
  by name from a fixed pair (`sql.identifier`), never from input.
- **The trip is the phone's** (D3). Ticks, the days and his own items are in
  the browser's storage, kept by the list's first day; Always have is on the
  server. Another phone, or a cleared browser, starts without ticks.
- **The week is container-queried**, not window-queried: the personal space's
  rail takes width, so `@container` with `@2xl:`/`@6xl:` columns
  (breakpoints-cannot-see-the-layout).
- **Show what was just done.** Today keeps its own copy of the day and the
  targets and adopts the server's when it differs, as Health's cards do
  (health.md): an action answers before its re-rendered page streams in.
- **Food wears its own skin, and nothing shared changes** (UI1, ADR 0132). Its
  values are `--food-*` on `:root`, drawn only by Food's components; on
  `:root` and not on Food's wrapper because the amount sheet is portalled out
  of the page and would lose them. Its radii are the scale's nearest steps,
  never literal; its face is loaded by its pages alone. A new Food screen
  draws with `food-*` utilities, `FoodPage` around it.
- **A fixed element inside the `@container` page stays on the viewport**:
  `container-type: inline-size` is not layout containment (the phone's
  floating bar was measured 24 px above the bottom at 375 px).
- **Up next is by when a meal ends** (`core/today.ts`): breakfast 11, lunch
  3 pm, dinner 10 pm, a snack until the day ends. `MEALS` puts the snack last,
  and `mealAt` says snack at half past three, so "at or after the current
  meal" (the handoff's rule) would have hidden dinner all afternoon.
- **The List tab counts with the list's own rule, on the phone** (`leftToBuy`):
  the days and the ticks are the phone's (ADR 0130), so no server count can
  agree with the list. It repeats the screen's tests (a staple asked about is
  a question, `have` is at home, `got` at the item's amount); change both
  together.
- **An effect may only wait for a read** (the React compiler's
  `set-state-in-effect`): Log food's handed-over photo is read by
  `readPlatePhoto`, outside the component, and the effect sets state in its
  `then`. With no clean-up, so React's practice remount in development cannot
  drop the answer (the photo is taken once).
- **Two transcription doors, one handler** (`transcribe-route.ts`): the tell
  box's answers a business workspace, Food's a personal space with Food on.
  Neither keeps the audio or the words.
- **A guide draws Food's buttons with `food` and `food-soft`**, not `primary`,
  which is navy.

## Open items

- **No bot check has been met in a drive.** `BLOCKED` is proven by the tests;
  the sites tried (Allrecipes, NYT Cooking) answered the reader.
- **Nobody has added a recipe on a phone yet.** The drive ran in a desktop
  pane at 375 px; a phone's camera, its photo picker and a real Android
  keyboard are unwatched.
- **Hands-free has not met a kitchen.** The phrases were measured on
  synthetic speech in silence, and the drive played those recordings into a
  stand-in microphone. His voice, a fan, a sizzling pan, and the voice's and
  alarm's loudness while the microphone is open on Android are unwatched.
- **Hands-free cannot be talked over.** It does not listen while it reads;
  a long step must finish, or a tap cut it, before "next step" works.
- **A timer cannot sound with cook mode off the screen.** Notifications (the
  app's, or the browser's) would let it; not built.
- **The cook history is a count and a day.** Undo works right after logging;
  older logs cannot be seen or changed. What was EATEN is D4a's log, which
  cook mode's last screen opens (Log what you ate).
- **The week has not met a phone.** Driven in a desktop pane at 375 px and
  wide; the steppers, the leftover buttons and the Move to menu on a real
  Android screen are unwatched.
- **Nothing reminds him to plan**, and nothing clears old plans: an earlier
  week stays as it was (a few rows a week), read-only and repeatable.
- **A leftover's servings follow the cook's** when it is offered; a different
  amount is a change afterwards.
- **The list has not met a shop.** Driven in a desktop pane at 375 px; a real
  phone with no signal, and Claude's names on his own recipes, are unwatched.
- **A name or an aisle cannot be changed** on the list, and a line Claude
  says buys nothing is left off; sharing or sending the list is not built.
- **Ticks are per phone**: the app and Chrome on the same phone keep their own.
- **No brands or barcodes.** FNDDS is everyday foods. USDA's branded list
  (an API key, the search sent to USDA) or Open Food Facts (ODbL) would add
  packaged foods and a barcode scan; neither is chosen.
- **No numbers typed in.** He did not pick it; a meal out is the nearest food
  or a recipe with the nutrition it states.
- **Fiber, sugar and sodium are kept, not shown.**
- **No per-space budget for plate reads**, as for recipe reads (above):
  before Food opens to everyone.
- **Nobody has photographed a plate on a phone.** The drive fed a photo to
  the pane; a real plate, a phone's camera and the estimate's quality are
  unwatched.
- **A pasted list of several recipes** reads as the first (or the main) one.
- **A recipe in another language** is copied in its language; nothing
  translates.
- **Unit conversion** (cups to grams, Fahrenheit to Celsius) is not built for
  the recipe; D4 weighs lines for the nutrition only, and the page still shows
  them as written.
- **A recipe's nutrition has not met his recipes.** The drive used invented
  ones; how often Claude's words find the right food on SR Legacy, and how
  often a line needs grams typed, is unwatched on real ones.
- **Cooking losses are not modelled** (D4): ingredients are weighed as bought.
- **No per-space budget for matching**, as for recipe and plate reads, before
  Food opens to everyone.
- **Only the four main numbers are shown** worked out; fiber, sugar and sodium
  are kept, and are 0 where SR Legacy lists none, so they can read low.
- **Amounts in steps** do not scale; the recipe page says so.
- **Recipe photos are not cropped.** The list shows them square and the page
  as they are, at most 28rem high.
- **No per-space budget for Claude reads**, as Workouts' recorded voice has
  none: one read at a time bounds a runaway client, not a day's total. Before
  Food opens to everyone, a daily read budget per space.
- **Sharing a recipe** (a link, a household) is not built, and would raise the
  copyright of a page's text and photo (ADR 0123).
- **UI2: the week, the recipes, a recipe and the list** keep their old look
  under the new tabs until he approves a mockup of them (his call,
  2026-10-06).
- **The redesign has not met his phone.** Driven in a pane at 375 px: the
  floating bar over Android's gesture bar, the sheet sliding up, the
  microphone inside the app (the WebView's recording permission) and the
  camera from Today on a real phone are unwatched.
- **A photo taken on Today is lost on a reload** before Log food opens; Log
  food then opens as usual.
- **No dark theme for Food**: the design has none and the product does not
  switch to one today.
- **The sheet cannot be swiped down**; its grabber is drawn, Back or a tap
  outside closes it.
- **The greeting's name is Clerk's first name**; an account with none (dev's)
  gets `Good evening.`
- **`Nothing was recorded. Hold the button while you speak.`** is the speech
  seam's shared message; the button is tap to start, not hold.
