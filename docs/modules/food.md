# Food

> The second personal tool (ADR 0111): what the person eats, logged from USDA's
> food list, their own recipes or a photo of the plate and counted against
> their targets (D4a); and their own recipes, brought in from a link, a photo
> of a page, pasted text or typed in, checked before they are saved, and
> scaled to any number of servings; then the week's meals and the shopping
> list. The founder's goal for it (2026-10-01) is part of a larger one: to
> track his progress from what he does, workouts, eating, cold plunges and
> sleep among it, which [Health](health.md) shows. Lives in a personal space
> beside [fitness](fitness.md); the container is [personal-space](personal-space.md).
> Status: `coming_soon` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

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
- **Applied to dev only**: `0443`-`0445` and the seed (the food list, and
  Food's catalogue line, which mentions eating now). Production on his word.
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

### 2026-10-02 — D1c: hands-free (`claude/food-d1c`)

Reading aloud and voice commands together, as he asked when D1b was planned.
His calls, from a mockup (ADR 0124):

- **The listener runs on the phone**: an open-source keyword spotter, so
  nothing said in the kitchen leaves it. Over streaming to Deepgram (forgiving,
  but the kitchen heard off the phone, about $0.35 a cook) and Chrome's
  recognizer (Google hears it; none in the app).
- **Short phrases**: "next step", "go back", "repeat", "start timer", "stop
  timer", "ingredients".
- **The workout coach's recorded voice** reads (ADR 0115), not the phone's.
- **Shared code**, so Workouts' hands-free (F6) follows: the listener is a
  platform area, [voice-commands.md](voice-commands.md), which holds the
  spike's numbers and how a phrase is heard.

No migration: nothing new is stored.

- **Hands-free** (`components/hands-free.tsx`): a switch beside the recipe's
  name, `Hands-free` / `Hands-free on`. The first time on a phone it opens the
  mockup's explanation (how it listens, what you can say, the voice, the
  microphone asked once); after that it turns on at once. A box under the name
  says `Getting hands-free ready · 42%` (the model's share of the first
  download), then `Listening`, `Reading` while the voice speaks, `Paused`
  coming back from another app; `Say “next step”, …` with “stop timer” in
  place of “start timer” while one rings; and for six seconds what it heard
  and did (`Heard “start timer”: 25–30 min started.`). Failures say what to
  do, with Try again and Turn off hands-free.
- **The commands** (`core/hands-free.ts`, pure; `cook-mode.tsx`): each does
  what its button does. "start timer" starts the step's first time not
  already running (`nextStepTime`, said again for the next one); "stop timer"
  stops the one ringing longest (`firstRinging`) and says how long a range can
  take; "ingredients" opens the list and says what the step uses, or reads the
  whole list on the gather and finish screens; "next step" on the last screen
  and "go back" on the first say so. Timers keep one label from a tap or a
  voice (`timerLabel`).
- **What is read** (`stepSpeech`, `listSpeech`, `usesSpeech`, `SAY`): each
  screen as it comes up, by a phrase or a tap; a group's heading when it
  starts. `spokenText` writes out what the voice garbled when its own
  recordings were read back by Deepgram's recognizer: `1/4 cup` ("one four
  cup"), `1 1/2` ("one one two"), `1 ½` ("one half"), `½ tsp` ("one half T S
  P"), `9x13-inch`, `400F`; spoons get their plural from the amount. Lines are
  cut to the route's 300 characters at sentences, then commas
  (`speechLines`), and handed to the voice queue one at a time
  (`cook-voice.ts`), since the queue holds only three waiting. Every line the
  recipe might need is fetched ahead when hands-free turns on
  (`everyCookLine`), from `/api/food/voice`.
- **A timer ringing stops the voice** (`hushCook`), so "stop timer" is heard at
  once, and swaps the listener's words: "start timer" and "stop timer" are
  never listened for together (the spike confused them).
- **The alarm plays through the page's one audio context**
  (`@/lib/audio-context`, the voice's): a timer started by voice has no tap
  of its own, and turning hands-free on was the tap.
- **Shared, moved out of Workouts**: whose voice (`src/lib/speech/voice-choice.ts`,
  the same phone key) and the voice route's handler
  (`src/lib/speech/record-route.ts`, `recordLinesHandler("food")`).
- Guide `cook.md`: a Hands-free section (turning it on, the box, every phrase
  and what it does, what is read, the voice, turning it off, every message);
  guide icon `mic-off`.

**Driven** on a production build against dev, on an invented cornbread (8
wedges; its step 2 toasts the cornmeal for `1 minute`, so an alarm could ring
for real). The microphone was a stand-in: `getUserMedia` answered with a stream
the spike's recordings were played into, and the page's own sound went through
a gain of 0, so nothing played aloud and nothing about its timing changed.

- **Turning it on**: the explanation (the mockup's), the microphone asked once
  (`channelCount 1`, echo cancellation off, noise suppression and gain on), the
  model at 100% in 0.3 s from the local server, listening in 1.5 s.
- **Every phrase, in the voice it was said in**: "next step" (Arcas, Helena,
  Orion) moved on and the step was read; "start timer" (Orion, Vesta) started
  `Step 1 · 15 min` and `Step 2 · 1 min` with `Timer started: …` read back;
  "show ingredients" (Helena) opened the list and read what step 2 uses; the
  1-minute timer rang (6 tones in 3 s), the box swapped to “stop timer”, and
  "stop timer" (Arcas) silenced it at once (0 tones after) with the other
  timer still running; "go back" (Orion, Helena), "previous step" (Vesta, to
  the ingredients), "repeat" (Helena) and, on the ingredients, "start timer"
  (`There is no timer on this screen.`), "go back" (`This is the start.`) and
  "ingredients" (Orion, the whole list) all did what their buttons do.
- **Nothing fired** on two sentences of kitchen talk ("Let's go out to the back
  porch.", "What's next on the list for dinner?"), nor on "start timer" played
  while a step was being read (by accident: a mistimed drive script, which is
  the half duplex working).
- **Off**: the microphone released (its track `ended`), a "next step" after it
  did nothing. **On again**: no explanation, the engine from the phone's cache,
  ready in 1.4 s. **Leaving cook mode** released the microphone; the recipe page
  said Back to cooking with the timer kept. **The page hidden** (simulated):
  `Paused`, the microphone let go; shown again: taken again without a prompt,
  `Listening`, and "repeat" heard at once.
- **A refused microphone**: `The microphone is blocked for this site. …` with
  Try again, which, once allowed, went straight to listening.
- **The files**: the model, the engine and its WebAssembly served `public,
  max-age=31536000, immutable`, with no proxy header (a page has
  `x-middleware-rewrite`; these have none). At 375 px nothing is wider than
  the phone.
- 16 lines were played in the recorded voice; the recordings came from
  `/api/food/voice` (Deepgram), every one 200.

**Found by the drive, and fixed:**

- **The first line was always the phone's own voice** on a recipe's first
  use: the first batch of four recordings took 4.4 s, past the queue's 2-second
  wait. Now the screen's own lines go in a request of their own, and the
  reading starts when the listener is ready rather than when hands-free is
  switched on (hands-free is not on until it can hear). Re-driven with the
  phone's recordings cleared, mid-recipe: the step's recording took 3.3 s, the
  listener was ready at 1.5 s, and the step was read in the recorded voice.
- **The recipe's name was cut off at 375 px** beside the switch, which hid
  `· 8 wedges`. It wraps now.
- **The explanation's chips, and the amounts in cook mode's Ingredients box,
  were the brand's green**: a dialog is drawn outside the page, where the
  route's `--module-accent` does not reach. Both boxes now carry Food's accent
  (`FOOD_ACCENT`). Re-checked: the same orange as the page.

Tests: `tests/food-hands-free.test.ts` (new, pure, 33: what cook mode
listens for in each state and that the engine would accept it, the shorthand
written out, lines cut to the route's size, what each screen says, timers by
voice, and every line fetched ahead fitting the route's batches),
`tests/voice-commands.test.ts` (new, pure, 9: the engine pinned to the
installed package, the model's commit, hash and layout, every phrase in the
model's sounds and none twice, the proxy's matcher skipping the folder, the
worklet parsing). The whole `pure` project passed (5,359), and `tsc`, eslint
and `npm run build`.

### 2026-10-02 — D1b: cook mode (`claude/food-d1b`)

The slice he asked for right after D1. His calls, from an interactive mockup
(the cornbread recipe tapped through, timers running fast):

- **Gather the ingredients first**, a checklist at the chosen servings, then
  the steps; an Ingredients button on every step brings the list back.
- **`Uses:` under each step**: the ingredient lines the step's words name, at
  the servings being cooked.
- **Reading steps aloud waits**, to come in one slice with saying "next" (voice
  commands), since reading aloud is half of hands-free.
- **Log that you made it** at the end: a count and the last day on the recipe.

**Migrations `0439`** (`food_cooks`) **and `0440`** (its RLS): on dev, and on
production on his word before the merge (its ledger read first: exactly these
two were pending). `verify-rls` passed on both (259 tables), and the table's
forced RLS, its two policies and its composite key were read back on both. No
seed: the catalogue row is D1's.

- **Cook mode** (`/personal/m/food/recipes/[id]/cook?servings=`): the screen
  kept on (`useWakeLock`), the gather list, then one step at a time in big
  type with its group's heading, Back and Next, Done cooking, and the finish
  screen. The recipe page's **Cook** button carries the servings chosen there.
- **Timers** (`core/times.ts`, pure): every time in a step's words is a button
  (`findTimes`: a number and a unit of time, ranges, `1 hr 15 min`, `1½
  hours`, `half an hour`; never `400°F`, `2-inch` or `overnight`). A timer is an
  END TIME (`core/cook.ts`), so a slept phone comes back to the right time
  left, or to a timer already ringing; several run at once and keep running
  between steps; a range rings at the shorter with "Check it now. It can take
  up to 30 min."; `+1 min` and Stop. The alarm (`alarm.ts`): three Web Audio
  chimes and a buzz every 1.5 s until stopped, unlocked by the first tap.
- **`Uses:`** (`core/uses.ts`, pure): a line's food words (after its amount and
  unit, brackets out, before a comma, descriptive words dropped) matched to
  the step's words, plural or not; a word two lines share only counts when the
  step names the whole food. Errs toward missing.
- **The phone's store** (`cook-store.ts`): the session per recipe in the
  browser's storage (place, ticks, timers, the log), read with
  `useSyncExternalStore` and a cached snapshot, so a reload or another app in
  between loses nothing; stale after 12 hours. Time and new ids come from the
  store (`changeCookSession`), never the component: the React compiler's
  purity rule refused `Date.now()` in a handler defined in the component.
- **Log that you made it** (`cook-ops.ts`, `logCookAction`): one
  `food_cooks` row, its id the phone's (made when the session starts), so a
  second press or a resend is one log; the day is the space's
  (`todayInTimezone`); Undo deletes it. The recipe page says `Made 3 times,
  last on Sep 30.`, the list `made 3×`.
- **Shared, and guarded**: `useWakeLock` moved from Workouts to
  `src/lib/use-wake-lock.ts` (a module may not import another), and `fitness`
  and `food` joined the lint's module-isolation list, which neither was on
  (the third time a module shipped unlisted; both were clean).
- Guides: `cook.md` (new), `recipe.md` (Cook, how often it was made),
  `overview.md` (`made 3×`); guide icons `chef-hat`, `timer`, `bell-ring`.

**Driven** on a production build against dev, on the invented cornbread typed
in (8 wedges), with the page's chimes, buzzes and screen-on requests counted:

- The recipe page's **Cook** linked `?servings=8`, then `?servings=12` after
  four +. Cook mode asked to keep the screen on, and gathered at 12 wedges
  (`1 ⅞ cups cornmeal`, `3 large eggs`); two ticks crossed out and were kept on
  the phone with the cook's id.
- **Steps**: step 1's `15 minutes` was a timer and `400F` was not, with no
  `Uses:`; step 2's `Uses:` listed all seven lines at 12 wedges; step 3 none
  (`buttered`); step 4 had `25 to 30 minutes` and `5 minutes`, and Done cooking.
- **Timers**: both started and counted down together (`25:00` → `24:58`). The
  5-minute one, brought forward in the phone's store, rang: `Step 4 · 5 min:
  time's up`, `Done.`, 3 chimes (9 tones) and 3 buzzes in 3.5 s; Stop silenced
  it at once (no tone in the next 4 s) and the other kept running. The range
  rang with `Check it now. It can take up to 30 min.`; `1 min` re-armed it at
  `1:00`; later it rang on the finish screen too.
- **Leaving and coming back** resumed at Step 4 of 4 with the timer still
  running (`21:47`). The Ingredients button showed the same ticks.
- **The finish**: `Log that you made it` → `Logged: made today, for 8 wedges.`
  (the space's day); Undo, and the button again; logged again. Back to the
  recipe cleared the cook (no timer left), and the page said `Made once,
  today.`, the list `8 wedges · made 1×`.

**Found by the drive, and fixed:** coming back through the recipe page
switched the cook in progress to the page's servings: the page's own stepper
starts again at the recipe's size, and its Cook link (`?servings=8`) won over
the 12 being cooked. A cook under way now keeps its own servings, and the
recipe page says **Back to cooking** with where it is (`Step 4 of 4 · 1 timer
running · 12 wedges`), with **Start over** beside it. Re-checked after the
rebuild: Back to cooking resumed at Step 4 of 4, at 12 wedges, with its timer
still counting; Start over gave Cook back; at 375 px no screen was wider than
the phone, and the step, its timer buttons and Back and Done cooking fit.

Tests: `tests/food-cook.test.ts` (new, pure, 29: the times in a step and what
is not one, the step's pieces, the words for durations and the countdown,
what a step uses, the session's transitions, how often it was made),
`tests/food-ops.test.ts` (db: a cook logged once however often it is sent, on
the space's day, undone, counted on the list, deleted with its recipe; a
cook for a missing recipe or under another recipe's id refused),
`tests/isolation/food.test.ts` (`food_cooks`, and a cook that cannot point at
another space's recipe), `tests/guides.test.ts` (cook mode finds its guide).

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
test.ts` (db, 12: recipes saved, listed, edited and deleted; a link with data
read with no model, one without sent to Claude, every reason a link fails with
no row left, a paste, photos kept nowhere, a failed answer, one read at a time,
an interrupted read, a draft's photo handed back), `tests/isolation/food.test.
ts` (5), and `tests/guides.test.ts` (every Food screen finds its guide).

## The slices

| # | Slice | Done when |
| --- | --- | --- |
| D1 | **Recipes** | A recipe by hand, from a link, from pasted text or from a photo of a page, checked before it is saved, scaled to a number of servings, with its photo and the nutrition it states. **Built** |
| D1b | **Cook mode** | "Cook" on a recipe: the screen stays on, the ingredients gathered first, one step at a time in big type with what it uses, a timer for each time a step names, several at once, ringing until stopped, and "Log that you made it". **Built** |
| D1c | **Hands-free** | Each step read aloud in the coach's recorded voice, and "next step", "go back", "repeat", "start timer", "stop timer" and "ingredients" heard on the phone (his calls: reading aloud comes with the voice commands; the listener on the phone; short phrases). **Built** |
| D2 | **The week** | Recipes on days and meals, moved about, a past week repeated |
| D3 | **The shopping list** | Built from the week, the same food added up across recipes (`core/amounts.ts` reads every line), ticked off in the shop on a phone |
| D4a | **Eating, logged** | What was eaten, from USDA's food list, a saved recipe or a photo of the plate, in breakfast, lunch, dinner or snacks; calories and the three macros a day against calorie and protein targets; in Health's progress (his calls, 2026-10-03; ADR 0126). **Built** |
| D4 | **Nutrition of a recipe** | Per recipe, worked out from its ingredients against the food list (D4a's) and labelled as worked out, beside the recipe's own numbers, so a recipe that states none can be counted |

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
| `food_recipes` | A person's recipe: title, what it makes (`yield_amount` double, `yield_unit`), prep, cook and total minutes, `tags` text[], `ingredients` and `steps` jsonb (`{ text, heading? }[]`, kept as written), `notes`, `nutrition` jsonb (per serving, as the recipe states it: calories, protein, carbs, fat, fiber, sugar g; sodium mg), `source_url`, the photo (`photo_pathname`, width, height), `created_by_clerk_user_id` | D1, `0437`. RLS member + superadmin (`0438`). `food_recipes_tenant_id_id_idx` is the composite key later slices point at. CHECKs: a title, yield > 0, minutes 0–10,080, a photo all or nothing |
| `food_cooks` | A time a recipe was cooked (D1b): `made_on` (the space's day), `servings` (what it was made for), the phone's id | `0439`/`0440`. Composite key to `food_recipes` (`(tenant_id, recipe_id)`, ON DELETE CASCADE). The recipe's count and last day are read from it |
| `food_eaten` | What was eaten (D4a): `eaten_on` (the space's day), `meal` (enum `food_meal`: breakfast, lunch, dinner, snack), `source` (enum `food_eaten_source`: food, recipe, photo), `fdc_id` or `recipe_id`, `name` as it was, `amount` of `portion` ("1 banana", "g", "oz", or "serving"), `grams` (a food's; null for a recipe), and the seven numbers as worked out when logged (null where a recipe states none) | `0443`, RLS member + superadmin (`0444`). The id is the phone's (`ON CONFLICT DO NOTHING`). `fdc_id` → `food_usda_foods` ON DELETE SET NULL; composite `(tenant_id, recipe_id)` → `food_recipes` ON DELETE SET NULL ("recipe_id"), hand-edited to the column-list form, so a deleted recipe leaves the row and its numbers. CHECKs: amount 0–100,000, grams for foods and none for recipes, numbers not negative. `created_at` defaults to `clock_timestamp()` (`0445`), so a plate's rows keep their order. Index `(tenant_id, eaten_on)` |
| `food_targets` | The daily targets: `calories` (500–10,000) and `protein_g` (10–500), either null | `0443`/`0444`. One row a space (`tenant_id` the key). A day is judged against the targets as they are now |
| `food_usda_foods` | The food list (D4a, ADR 0126): FNDDS 2021-2023, 5,431 foods, `name`, `category` (WWEIA), the seven numbers per 100 g, `portions` jsonb (`{ label, grams }[]`), `release` | `0443`; REFERENCE DATA with no tenant: `modules`' two policies (superadmin all, any member reads) in `0444`, with `search_tsv`, a generated tsvector (name A, category B) not modelled in the schema, GIN-indexed. Written only by the seed from `scripts/data/usda-foods.json` |
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
  (the slot's filler); `components/eaten-day.tsx` (Today's day),
  `log-food.tsx` (Log food), `food-nav.tsx` (the Today / Recipes strip),
  `new-id.ts`; `src/app/api/food/search/route.ts`; the pages
  `src/app/personal/(space)/m/food/log` and `.../recipes` (the list's page).
- The food list: `scripts/build-usda-foods.ts` (pinned download, readable
  names), `scripts/data/usda-foods.json` (the committed list),
  `scripts/lib/usda-foods.ts` (the seed's loader); `scripts/seed.ts` loads it,
  `scripts/verify-modules.ts` checks it.

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
  changing its nutrition would make that nutrition wrong; the editor does not
  try to tell.
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
- **A recipe with no stated nutrition is logged without numbers**, and the day
  says how many such things it has, rather than guessing or blocking. D4
  works a recipe's numbers out from its ingredients.
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
- **Show what was just done.** Today keeps its own copy of the day and the
  targets and adopts the server's when it differs, as Health's cards do
  (health.md): an action answers before its re-rendered page streams in.

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
- **D4a: production.** `0443`-`0445` and the seed (the food list, and the
  catalogue line) are on dev only; on his word, before the merge: read the
  prod ledger, migrate, `db:verify-rls`, `db:seed`, `db:verify-modules`.
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
- **Unit conversion** (cups to grams, Fahrenheit to Celsius) is not built.
- **Amounts in steps** do not scale; the recipe page says so.
- **Recipe photos are not cropped.** The list shows them square and the page
  as they are, at most 28rem high.
- **No per-space budget for Claude reads**, as Workouts' recorded voice has
  none: one read at a time bounds a runaway client, not a day's total. Before
  Food opens to everyone, a daily read budget per space.
- **Sharing a recipe** (a link, a household) is not built, and would raise the
  copyright of a page's text and photo (ADR 0123).
