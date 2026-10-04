# Food

> What you ate today, with its calories, protein, carbs and fat, against your targets, and what you planned for each meal; the week ahead and your recipes are one tab over.
> **Route:** /personal/m/food/**
> **Order:** 0

Open **Food** {icon:utensils} in the sidebar of your personal space. This page is the day: what you ate, meal by meal, and how the day adds up. To add something, click {button:Log food|primary|plus}, or {button:Add|ghost|plus} beside a meal. What you planned for a meal waits under it: click {button:Ate it|primary|check} once you have eaten it. The week ahead is under `Week`, and your recipes are under `Recipes`.

## What you see

- **`Food`**, the title, with the line `What you ate, the week ahead, and your recipes.`
- **The {icon:circle-question-mark}**, which opens this guide beside the page.
- **{button:Log food|primary|plus}.** Opens Log food for this day, on the meal the time of day suggests: breakfast from 4 in the morning, lunch from 11, snacks from 3 in the afternoon, dinner from 5, and snacks again from 10 at night. On an earlier day it starts on dinner. See [Logging what you ate](log.md).
- **`Today`, `Week` and `Recipes`**, Food's sections. You are on `Today`. `Week` is the week ahead: see [Planning the week](week.md). `Recipes` is your recipes: see [Your recipes](recipes.md).
- **The day**, between two arrows: `Today`, `Yesterday`, or a date such as `Thursday, Oct 1`. {button:|ghost|chevron-left} goes to the day before, back to two weeks ago, so you can log a meal you forgot. {button:|ghost|chevron-right} goes to the day after, up to today.
- **The day's numbers**, four of them, the same size: `Calories`, `Protein`, `Carbs` and `Fat`, everything logged on the day added up.
  - **Your targets**, when you set them: a bar under `Calories` and under `Protein`, and how far along, such as `1,640 of 2,200 kcal` and `128 of 150 g`. The bar stops at full when you go over.
  - **Something with no nutrition**: a recipe that states none is logged without numbers, and the card says so, such as `1 thing has no nutrition: its recipe states none. Add it in the recipe's editor, and log it again.`
  - **{button:Set targets|ghost|target}**, or {button:Change targets|ghost|target} once you have some. It opens two boxes in the card:
    - `Calories a day`, a whole number from 500 to 10,000.
    - `Protein a day, g`, a whole number from 10 to 500.
    - `Leave a box empty for no target. A day is on its calorie target within a tenth of it, either way, and on its protein target at or above it.`
    - {button:Save targets|primary} keeps them, and {button:Cancel|ghost} closes the boxes unchanged. A number out of range shows `Calories between 500 and 10,000.` or `Protein between 10 and 500 g.` in red, and Save targets stays grayed out.
- **A card for each meal**: `Breakfast`, `Lunch`, `Dinner` and `Snacks`, each with its calories beside the name and {button:Add|ghost|plus}, which opens Log food for that meal and this day. A meal with nothing in it, logged or planned, says `Nothing yet`.
  - **Each thing you logged**, in the order you logged it: its name ({icon:chef-hat} before a recipe of yours), how much, such as `1 banana`, `150 g` or `1.5 servings`, its protein, carbs and fat, and its calories on the right. A recipe that states no nutrition says `no nutrition` instead of calories.
  - **Tap a thing** to change it. Its card opens:
    - `How much`, a number above 0.
    - Beside it, what the number counts. For a food: its own portions from the food list, such as `1 banana` or `1 cup`, then `g` and `oz`. For a recipe: `servings`.
    - The meal buttons, `Breakfast`, `Lunch`, `Dinner` and `Snacks`, to move it to another meal.
    - Its numbers for the new amount, as you type. They are worked out from the numbers it was logged with, so a recipe you changed since keeps counting as it was when you ate it.
    - {button:Save|primary} keeps the change. {button:Cancel|ghost} closes it unchanged. {button:Remove|ghost} asks `Remove it?`: click {button:Remove|destructive} to take it off the day, or {button:Keep it|ghost}.
    - A number that is not one shows `Type how much, a number above 0.`, and a portion the food cannot be counted in shows `That amount is not one this food can be logged in.` Save stays grayed out for both.
  - **What you planned and have not logged yet**, under what you logged, in a box marked `Planned`: its name, what it is, such as `Cook 4 servings, eat 1`, `Leftovers · 1 serving` or `1 cup`, and its calories on the right. See [Planning the week](week.md).
    - {button:Ate it|primary|check} logs it as planned, in this meal, at its servings or amount. The box goes, and it shows with what you logged.
    - {button:Change first|ghost} opens Log food with it chosen and its amount filled in, when you ate more, less or something a little different. Adding it there logs it as this planned meal. See [Logging what you ate](log.md).
    - {button:Cook|outline|chef-hat}, on a recipe you cook at this meal, opens cook mode at the whole batch.
    - A batch made ahead, which you eat none of here, says `for later` and `Made for later meals: cook 4 servings, and eat it as its leftovers.`, with only {button:Cook|outline|chef-hat}.
    - Something you logged and then removed from the day is waiting under its meal again.

Every change shows at once, {button:Ate it|primary|check} too. If it could not be kept, it goes back as it was and a message says why. The page keeps up with the day: if you leave it open overnight, it fetches the new day the next time you look at it.

## How to log what you ate

1. Click {button:Log food|primary|plus}, or {button:Add|ghost|plus} beside the meal.
2. Find the food or your recipe, say how much, and add it. See [Logging what you ate](log.md).
3. Click {button:Done|outline} to come back here. The meal shows what you added, and the day's numbers include it.

## How to log a meal you planned

1. Under the meal, find the `Planned` box.
2. If you ate it as planned, click {button:Ate it|primary|check}. If not, click {button:Change first|ghost}, set how much you ate, and add it.

## How to log a meal you forgot

1. Click {button:|ghost|chevron-left} until the day shows, up to two weeks back.
2. Click {button:Add|ghost|plus} beside the meal, and log it as usual. It goes on that day.

## How to set your targets

1. Click {button:Set targets|ghost|target}.
2. Type the calories and the protein you aim for each day. Leave one empty to have no target for it.
3. Click {button:Save targets|primary}. The bars appear under `Calories` and `Protein`, and Health's Progress counts the days you hit them.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing yet` | Nothing is logged in that meal on this day. Click {button:Add|ghost|plus} to log something. |
| `You can log today and the two weeks before it.` | The day is more than two weeks back, or a page left open has fallen behind. Reload the page. |
| `That amount is not one this food can be logged in. Choose another.` | The portion is not one of this food's. Choose another, or use `g` or `oz`. |
| `That is not in your log any more. Reload the page.` | It was removed, perhaps in another tab. Reload to see the day as it is. |
| `It could not be changed. Try again.` | Saving the change did not work. It went back as it was. Try again. |
| `It could not be logged. Try again.` | {button:Ate it|primary|check} did not work. The planned meal is waiting again. Try again. |
| `Nothing is eaten at that meal: the batch is made ahead. Log its leftovers when you eat them.` | The plan eats none of the batch at this meal. Log its leftovers on their meals. |
| `That meal is not on the week any more. Reload the page.` | The planned meal was taken off the week, perhaps in another tab. |
| `That recipe is not here any more.` | The planned recipe was deleted. |
| `That food is not on the list any more. Search for it again.` | The planned food has left the food list. Log it with {button:Add|ghost|plus}. |
| `It could not be removed. Try again.` | Removing it did not work. It is back on the day. Try again. |
| `The targets could not be saved. Try again.` | Saving the targets did not work. They went back as they were. Try again. |
| `Something in that was not right. Check it and try again.` | What was sent was not something Food keeps. Reload the page and try again. |

## Not on this page

- **Fiber, sugar and sodium.** They are kept for every food on the list, but not shown yet.
- **Brands and barcodes.** The food list is USDA's everyday foods. Packaged foods by brand, and scanning a barcode, are not built.
- **The shopping list.** It comes next, in Food, made from the week.
- **Nutrition worked out from a recipe's ingredients.** Not built. A recipe counts with the nutrition it states.
- **Progress over weeks.** It is in Health, with your workouts, sleep and plunges.

## Who can do what

Only you. Food is in your personal space, which nobody else can open. Yosher staff cannot open it from the product either.
