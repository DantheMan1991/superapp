# Cooking from a recipe

> A saved recipe: its photo, the ingredients scaled to the servings you want with a circle to tick each one off, the steps, and its nutrition, as it states it or worked out from its ingredients.
> **Route:** /personal/m/food/recipes/*
> **Order:** 30

Open **Food**, click `Recipes`, and click a recipe. Click {button:Cook|food|chef-hat} to cook it one step at a time. Change the servings with {button:|ghost|minus} and {button:|ghost|plus} beside `Ingredients`, and the amounts follow.

On a phone everything is in one column: the photo, the name, Cook, the nutrition, the ingredients, the steps and the notes. On a computer the photo sits beside the name, Cook and the nutrition, and the ingredients sit beside the steps.

## What you see

### Along the top

- **{icon:arrow-left} `Recipes`**, which goes back to your recipes.
- **The {icon:circle-question-mark}**, which opens this guide beside the page.
- **{button:|outline|pencil}**, Edit. Opens the recipe in the editor. See [Typing in and editing a recipe](editor.md).
- **{button:|outline|trash}**, Delete. It asks `Delete` and the recipe's name, with `The recipe and its photo are deleted. This cannot be undone.` Click {button:Delete recipe|destructive} to delete it, or {button:Keep it|ghost}. After a delete it says `Recipe deleted` and opens your recipes.

### The recipe

- **The photo**, when the recipe has one. Without one, a band with a chef's hat on the same color as its card on Recipes.
- **The recipe's name**, the title.
- **Its times and what it makes**, each in a pill, when the recipe gives them: {icon:clock} and the total time, such as `35 min`, then `Prep 15 min`, `Cook 20 min` and `Makes 6 servings`.
- **A line under them**, with what the recipe has:
  - How often you have made it, once you have logged it from cook mode, such as `Made 3 times, last on Sep 30`.
  - `From` and the site's name, with {icon:external-link}, when the recipe has a source link. Click it to open the page it came from, in a new tab.
  - Its tags, such as `Dinner, Batch`.
- **{button:Cook|food|chef-hat}**, with `The screen stays on, one step at a time, with timers from the steps.` It opens cook mode at the servings set under `Ingredients`. See [Cooking with cook mode](cook.md). It is not there when the recipe has no ingredients and no steps.
  - With a cook under way on this phone, it says {button:Back to cooking|food|chef-hat} instead, with where you are under it, such as `Step 4 of 4 · 1 timer running · 12 wedges`. It goes back to that place, at the servings you were cooking. {button:Start over|ghost} beside that line clears the cook, its ticks and its timers, and the button says Cook again.
- **{button:Add to the week|food-soft|calendar-plus}.** Opens Put on the week with this recipe chosen, to cook it on a day and plan its leftovers. See [Putting a meal on the week](week-add.md).
- **{button:Log it|food-soft|plus}.** Opens Log food with this recipe chosen, to log the servings you ate on a meal. See [Logging what you ate](log.md).

### Nutrition

A serving's numbers, so changing the servings does not change them.

- **Four tiles**: calories (`kcal`, on orange), `protein`, `carbs` and `fat`. Under the heading, whose numbers they are:
  - `Per serving, as the recipe states it.` when the recipe states all four.
  - `Per serving, worked out from the ingredients and USDA's list.` when they were all worked out.
  - `Per serving. The dashed ones are worked out from the ingredients, as the recipe does not state them.` when the recipe states some and the rest were worked out. The worked-out tiles have a dashed edge. The recipe's own numbers always come first.
  - A tile the recipe does not state, when nothing was worked out for it, shows `?`.
- **Under the tiles**, fiber, sugar and sodium, when the recipe states them, such as `Fiber 9 g · Sugar 7 g · Sodium 820 mg`.
- **When it states none**, no tiles: `This recipe states none, so it counts as no numbers on Today and the week.`, with {button:Work it out from the ingredients|food-soft|calculator}.
- **When it states some and nothing was worked out**: `It does not state them all, so the rest count as no numbers on Today and the week.`, with {button:Work it out from the ingredients|food-soft|calculator}. See [Working out a recipe's nutrition](recipe-nutrition.md).
- **Once worked out**, {button:Check it again|food-soft}, which opens the lines as they were checked.
- **After the ingredients change**: `Worked out from an earlier version of the ingredients. Check it again to bring it up to date.` Its numbers still count until you do. Changing what the recipe makes needs no check: a serving is worked out from the whole recipe.

### Ingredients

- **The servings**, beside the heading, when the recipe says how many it makes: {button:|ghost|minus}, what it makes now, such as `6 servings`, and {button:|ghost|plus}. Each press changes it by one, down to one. A recipe that makes less than one changes by its own amount.
  - Every amount on a line follows, and so does a unit written in full: `1 cup` becomes `2 cups`. A few foods counted whole follow too: `1 egg` becomes `2 eggs`. The amounts are in bold.
  - Under the heading, `Made for 6 servings.`: what the recipe is written for. Once you change the servings, `Reset` follows it, which puts them back. The line is always there, so the rows under your finger never move when you press {button:|ghost|minus} or {button:|ghost|plus}.
  - `as written` beside a line that has a number but did not change, such as `Juice of 1 lime`, once you change the servings. Its amount is not at the start of the line, so it is not read. See [How amounts are read](editor.md).
  - `Amounts in the steps are as written, for 6 servings.` under the list once you change the servings. Only the ingredients scale.
  - With no number for what it makes, there is no {button:|ghost|minus} and {button:|ghost|plus}, and the recipe shows as written.
- **A circle before each ingredient.** Tap the line to tick it as you gather or add the ingredient: the circle fills orange and the line is crossed out. Tap it again to untick it. Ticks are only for now: they clear when you leave the page.
- **A heading in the list**, such as `To serve`, starts a group.
- `No ingredients written down.` when the recipe has none.

### Steps and notes

- **Steps**, each with its number in a circle, with any headings between them. `No steps written down.` when it has none.
- **Notes**, when the recipe has some.

## How to cook for a different number

1. Press {button:|ghost|plus} or {button:|ghost|minus} beside `Ingredients` until it shows how many you are cooking for.
2. Click {button:Cook|food|chef-hat} to cook at that number, or gather the ingredients here, ticking each one off.
3. Follow the steps. Where a step names an amount, it is the amount for the recipe's own servings.
4. Click `Reset` to go back to the recipe as written.

## Messages

| Message | What it means |
| --- | --- |
| `Recipe deleted` | The recipe and its photo are gone. |
| `The recipe could not be deleted. Try again.` | Something went wrong on the way, and the recipe is still there. Try again. |
| `That recipe is not here any more.` | It was deleted already, maybe in another tab. |

## Not on this page

- **Converting units**, such as cups to grams. Not built. (Working out the nutrition weighs each line, but the recipe still shows it as written.)
- **Scaling the amounts inside the steps.** Not built; the note under the ingredients says so when the servings are changed.

## Who can do what

Only you. Food is in your personal space, which nobody else can open.
