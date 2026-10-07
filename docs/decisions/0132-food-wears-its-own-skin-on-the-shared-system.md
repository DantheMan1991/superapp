# 0132 — Food wears its own skin on the shared system

- **Date:** 2026-10-06
- **Status:** Accepted
- **Affects:** Food: Today (`FoodModule.tsx`, `components/food-today.tsx`, `day-card.tsx`,
  `up-next-card.tsx`, `meal-list.tsx`, `quick-log.tsx`), Log food (`components/log-food.tsx`,
  `amount-sheet.tsx`), the tabs on every Food page (`components/food-nav.tsx`, `food-page.tsx`),
  `core/today.ts`, `core/food-icons.ts`, `core/choice.ts`; `src/app/globals.css` (the `--food-*`
  tokens); the speech seam (`src/lib/speech/transcribe-route.ts`, `/api/food/transcribe`,
  `components/app/dictate-button.tsx`); the guides' button looks (`guides-core.ts`,
  `guide-control.tsx`). Builds on [ADR 0008](0008-warm-neutrals-and-layered-elevation.md) and
  [ADR 0049](0049-speech-is-a-fork-in-the-road-not-a-provider.md).

## Context

The founder had Claude Design redraw Food and picked one direction, "Fresh
Market" (2026-10-06): warm, rounded, photo-led, a search bar at the top of
Today, a double ring for calories and protein, the next planned meal as a card,
the meals as cards of photo rows, Log food as a phone sheet. The handoff fixed
colours, type, spacing, radii and copy, and designed Today (computer and phone)
and Log food (phone) only.

It does not fit the shared system as it stands. The product is one look on
purpose (ADR 0008, `docs/modules/design-system.md`): warm neutrals, the module's
accent as its only colour, elevation not outline, one face, a radius scale
derived from one value, and "never a literal radius". The design adds a warmer
page, a dozen colours of its own (a protein red, a carbs green, a fat yellow, a
tint per meal), a second face (Bricolage Grotesque), warmer shadows and radii
that are not on the scale.

Three of its assumptions were wrong for this codebase and were his to decide
(2026-10-06, each the recommended option):

- **USDA's foods have no photos**, and the design never leaves an empty box. He
  chose an icon for the kind of food, from its USDA category, over the meal's
  icon and over sourcing a photo for each of 171 categories.
- **The microphone** pointed at `/api/food/voice`, which reads recipes aloud and
  hears nothing. He chose the tell box's dictation over no microphone, knowing a
  short clip goes to the speech service and is not kept.
- **The screens not drawn** (the week, the recipes, a recipe, the list) get a
  mockup in the same style first, in the next PR.

## Decision

Food draws with its own tokens, on the shared system's machinery: the design's
values are `--food-*` properties on `:root`, registered in `@theme` as
`food-*` utilities, used only inside Food, and nothing shared changes. Its face
is loaded by Food's pages alone. Its radii are the existing scale's nearest
steps. Everything it adds that a person can do runs through what is already
built.

- **The skin.** `--food-bg` paints the shell's pane when a Food page is in it
  (`[data-app-main]:has([data-food-page])`); the cards, fields, buttons, tabs,
  meal tints, rings and shadows are the design's values, on `:root` so a
  portalled sheet wears them too. Light only, as designed: nothing in the
  product switches to the dark theme today.
- **The face.** `next/font/google` in `components/food-display.ts`, its
  variable on `FoodPage` and on Food's sheet, so only a Food page preloads it.
  `font-food-display` falls back to Geist anywhere else.
- **No literal radius.** 24 px cards are `rounded-3xl` (26.4), 22 px phone
  cards `rounded-2xl` (21.6), 14 to 16 px fields and buttons `rounded-xl`
  (16.8), 12 px thumbnails `rounded-lg`, 10 px tiles `rounded-md`, the sheet's
  28 px top `rounded-t-3xl`.
- **Contrast measured.** Every text pair clears 4.5:1 (white on the accent
  4.93:1); the search placeholder is `--muted-foreground`, since the design's
  subtle tier measured 4.42:1 on the field. The fat segment of the energy bar
  (2.16:1) is not the only telling: its grams are written under it.
- **A food's picture is an icon for its kind** (`core/food-icons.ts`): ordered
  rules over the WWEIA category, first match wins, every category on the list
  checked by a test. A recipe shows its photo, or a chef's hat.
- **The microphone is the tell box's dictation** behind a personal space's door:
  `/api/food/transcribe` (`resolvePersonalContext`, Food switched on) calls the
  handler the tell box's route now shares (`transcribe-route.ts`), and
  `DictateButton` gained an endpoint and an icon look. The tell box's route
  refuses a personal space, which is why a second door exists.
- **The List tab's count is the list's own**: every Food page with the tabs
  reads what the list is made from (`listInput`) and the tab works the list out
  on the phone, with the phone's days and ticks, by the list's rule
  (`leftToBuy`).
- **Today's camera hands its photo to Log food in memory**
  (`plate-handoff.ts`): a client navigation keeps the module, so Log food reads
  it on arrival; nothing is stored.
- **Up next is by when a meal ends** (breakfast 11, lunch 3 pm, dinner 10 pm, a
  snack until the day ends), not by `MEALS`' order, which puts the snack after
  dinner and would hide dinner at half past three.
- **The guides draw Food's buttons in Food's colours**: two looks, `food` and
  `food-soft`, beside the Button's own.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Change the shared tokens to the design's | Every module would change colour, face and radius for a redesign of one tool he chose for Food. |
| A CSS module or stylesheet of Food's own | Tailwind's utilities could not read it, and a portalled sheet would not inherit it; a second styling system for one tool. |
| Tokens on Food's wrapper only | A dialog is portalled out of the route (D1c's `FOOD_ACCENT` lesson); the sheet would lose every colour. |
| The face in the root layout | It would be preloaded on every page of the product for the screens of one tool. |
| The design's literal radii | The repo's one rule about radius; the nearest steps are within 2.4 px. |
| A photo per category | 171 categories to source and license, and a download; he chose the icon. |
| The meal's icon for every food | Every food in a meal looks the same. |
| No microphone | His call: keep it. |
| The tell box's own route | It answers a business workspace only; letting a personal space in would widen a business door. |
| A count kept from the last visit to the list | It goes stale the moment the week changes, and a wrong count is worse than none. |
| The count for the default seven days, on the server | The days and the ticks are on the phone (ADR 0130); it would disagree with the list. |
| The plate's photo through storage | It would keep a photo of his plate on the phone; the plate read keeps nothing (ADR 0126). |
| Up next by `MEALS`' order from `mealAt(now)` | At 3:30 pm `mealAt` says snack, and dinner, later in the day, would never be up next. |

## Consequences

- Food reads as its own place: warmer, rounder, with a face of its own, while
  the shell, the rail and every business module are unchanged.
- Two looks now live in one product. The design-system dossier says which
  rules Food keeps (elevation, three text tiers, the radius scale, measured
  contrast) and which it does not (one face, the module accent as the only
  colour).
- Every Food page with the tabs reads the list's inputs: three more queries a
  page, small for one person's space.
- A photo taken on Today is lost if the page reloads before Log food opens; Log
  food then opens as usual.
- The dark theme is not drawn for Food.
- The week, the recipes, a recipe and the list keep their old look under the new
  tabs until their mockup is approved.

## Notes

The handoff's claims were checked against the code, not trusted: the voice
route, the up-next rule and the meal order were wrong or stale, as the Jobs
handoff's tab list was. The drive on a production build caught three more:
"Snacks gets you to…", a toast gone before its Undo could be reached (8 seconds
now), and the plate's portion box pushing its button off the line.
