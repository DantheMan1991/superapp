# Cooking from a recipe

> A saved recipe: its photo, the ingredients scaled to the servings you want with a box to tick each one off, the steps, and the nutrition it states.
> **Route:** /personal/m/food/recipes/*
> **Order:** 30

Open **Food** and click a recipe. Change the servings with {button:−|outline|minus} and {button:+|outline|plus}, and the amounts follow.

## What you see

- **The recipe's name**, the title, with its times under it, such as `35 min · Prep 15 min · Cook 20 min`.
- **{button:Edit|outline|pencil}.** Opens the recipe in the editor. See [Typing in and editing a recipe](editor.md).
- **{button:Delete|outline|trash}.** Asks `Delete` and the recipe's name, with `The recipe and its photo are deleted. This cannot be undone.` Click {button:Delete recipe|destructive} to delete it, or {button:Keep it|ghost}. After a delete it says `Recipe deleted` and opens the Food page.
- **`From` and the site's name**, with {icon:external-link}, when the recipe has a source link. Click it to open the page it came from, in a new tab.
- **The tags**, after the source.
- **The photo**, when the recipe has one.
- **Ingredients**, with the servings beside the heading when the recipe says how many it makes:
  - {button:−|outline|minus}, what it makes now, such as `4 servings`, and {button:+|outline|plus}. Each press changes it by one, down to one. A recipe that makes less than one changes by its own amount.
  - Every amount on a line follows, and so does a unit written in full: `1 cup` becomes `2 cups`. A few foods counted whole follow too: `1 egg` becomes `2 eggs`.
  - Once you change the servings, `Made for 4 servings.` and **Reset**, which puts them back.
  - A box before each ingredient. Tick it as you gather or add the ingredient, and the line is crossed out. Ticks are only for now: they clear when you leave the page.
  - `as written` beside a line that has a number but did not change, such as `juice of 1 lemon`, once you change the servings. Its amount is not at the start of the line, so it is not read. See [How amounts are read](editor.md).
  - A heading in the list, such as `For the sauce`, starts a group.
  - `Amounts in the steps are as written, for 4 servings.` under the list once you change the servings. Only the ingredients scale.
  - With no number for what it makes, there is no {button:−|outline|minus} and {button:+|outline|plus}, and the recipe shows as written.
  - `No ingredients written down.` when the recipe has none.
- **Steps**, numbered in order, with any headings between them. `No steps written down.` when it has none.
- **Nutrition**, when the recipe states it: `Per serving, as the recipe states it.`, then calories, protein, carbs and fat, and under them fiber, sugar and sodium when given. It is per serving, so changing the servings does not change it.
- **Notes**, when the recipe has some.

## How to cook for a different number

1. Press {button:+|outline|plus} or {button:−|outline|minus} until it shows how many you are cooking for.
2. Gather the ingredients, ticking each one off.
3. Follow the steps. Where a step names an amount, it is the amount for the recipe's own servings.
4. Click **Reset** to go back to the recipe as written.

## Messages

| Message | What it means |
| --- | --- |
| `Recipe deleted` | The recipe and its photo are gone. |
| `The recipe could not be deleted. Try again.` | Something went wrong on the way, and the recipe is still there. Try again. |
| `That recipe is not here any more.` | It was deleted already, maybe in another tab. |

## Not on this page

- **Cook mode**, with the screen staying on, one step at a time, and the timers a step names. It comes next.
- **Converting units**, such as cups to grams. Not built.
- **Scaling the amounts inside the steps.** Not built; the note under the ingredients says so when the servings are changed.

## Who can do what

Only you. Food is in your personal space, which nobody else can open.
