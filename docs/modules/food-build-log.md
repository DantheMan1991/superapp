# Food — build log archive

> The oldest entries of [food.md](food.md)'s build log, moved here on
> 2026-10-06 so the dossier stays readable: D1c (hands-free), D1b (cook mode)
> and D1 (recipes), from 2026-10-01 and 2026-10-02. Nothing was edited: they
> are exactly as written, newest first, and their links point at files beside
> this one. Later slices changed some of what they describe (D1 keeps a
> recipe's nutrition only as the recipe states it; D4 works it out from USDA's
> ingredient list when asked), so [food.md](food.md) is still the file to read
> first.
> Status: `archive` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

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
