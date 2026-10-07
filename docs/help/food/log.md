# Logging what you ate

> Find a food on USDA's list or one of your recipes, say how much, and add it to a meal. Add something you had lately again with one tap. Or take a photo of the plate, check what was found, and add it all at once.
> **Route:** /personal/m/food/log
> **Order:** 2

Get here from Food's `Today`: tap `What did you eat?` at the bottom of a phone, or {button:|food-soft|plus} beside a meal. Type what you ate, choose it, set how much in the sheet, and click {button:Add to lunch|food}. Or tap the + beside something you had lately to add it again at once. You stay on this page to add the next thing; click {button:Done|outline} when the meal is in.

You also get here from {button:Log it|outline|plus} on a recipe, and from {button:Log what you ate|outline} at the end of cook mode. Both open with that recipe already chosen, in the sheet. From {button:Change first|food-soft} on a planned meal on Today, it opens on that day and meal, with the recipe or food chosen and the planned amount filled in, and the sheet says `Planned for this meal. Change how much, then add it.` The first thing you add then is logged as that planned meal, and it stops waiting on Today. And from the camera on Today, it opens reading your photo: see [A photo of the plate](#a-photo-of-the-plate) below.

## What you see

- **{button:Food|ghost|arrow-left}** and **{button:Done|outline}.** Both go back to the day on Food's `Today`.
- **`Log food`**, the title, with {icon:circle-question-mark} beside it, which opens this guide beside the page. Under it, the day and `goes into`: `Today · goes into`, `Yesterday · goes into`, or a date such as `Thursday, Oct 1 · goes into`. Everything you add goes on that day.
- **The meal buttons**: `Breakfast`, `Lunch`, `Dinner` and `Snacks`. The one filled in orange is where the next thing goes. It starts on the meal you came from, or the one the time of day suggests: breakfast from 4 in the morning, lunch from 11, snacks from 3 in the afternoon, dinner from 5, and snacks again from 10 at night. Click another to change it.
- **What you added**, once you add something: a green line for each, such as `Added to lunch: Banana, raw, 1 banana`, with {button:Undo|outline|undo} to take it off again.
- **The search box**, `Search foods or your recipes`, ready to type in. Type a word or two, such as `chicken breast` or `greek yogurt`. Each word can be the start of one, so `chick` finds chicken. {button:|ghost|x} clears it.
- **{button:|ghost|mic}**, at the end of the empty box, lets you say it instead of typing. Click it, say what you ate, and the words go into the box to search, for you to check. It stops on its own when you stop talking, after 30 seconds at the most, or when you click it again. The short recording goes to a speech service to be turned into words and is not kept. Where a browser cannot record, it is not there.
- **Before you type:**
  - **`Photo of the plate`**, `Snap it, check what was found, add it all`. Takes a photo, or picks one, and reads it. See [A photo of the plate](#a-photo-of-the-plate) below.
  - **`Recent · one tap adds it`**: the foods and recipes you logged most lately, each once, with its picture, the amount you last had and what it comes to, such as `Banana, raw` and `1 banana · 122 kcal`.
    - **The + beside one** adds it at once, at that amount, to the meal chosen above. It appears in what you added, with Undo.
    - **The row itself** opens the sheet with that amount filled in, to change it first.
  - **`Your recipes`**: the ones you cooked most lately first. Tap one to open the sheet.
- **While you type:** `Searching…`, then:
  - **`Your recipes`** whose names have every word you typed.
  - **`Foods`** from the food list, the plain food first: `Rice, white, cooked` before fried rice. When no food has every word you typed, the ones with the most of them come first, so `butter on toast` finds butter. Each shows its picture, its group and what its first portion comes to, such as `Bananas · 1 banana · 122 kcal`. Tap one to open the sheet.
  - `Nothing found for "…". Try fewer words, or other ones.` when nothing matches.
- **The pictures.** A recipe shows its own photo, or a chef's hat without one. A food from USDA's list shows a picture for its kind, such as an egg, an apple or a cup of coffee, picked from its group on the list.
- **At the bottom**: `Foods and their nutrition from USDA FoodData Central (FNDDS 2021-2023), per 100 g, for the amount you choose.`

## The sheet

It comes up from the bottom on a phone, and opens in the middle on a computer.

- **Its picture, its name and its group** on the list, such as `Yogurt, Greek`, or `Your recipe`. **`Back`** closes it, to choose something else.
- **How much.** The number, which you can type over, with − and + beside it: a recipe goes a serving at a time, a food half a portion at a time, or 10 at a time in grams. Next to it, what the number counts: for a food, its own portions, such as `1 banana`, `1 cup` or `1 cup, mashed`, then `g` and `oz`; for a recipe, servings, as the recipe makes them.
- **The four numbers** for that amount: `kcal`, `protein`, `carbs` and `fat`. They change as you change the amount.
- A recipe with no nutrition yet says `This recipe has no nutrition yet, so it is logged without numbers. Work it out from its ingredients first to count it.`, where `Work it out from its ingredients` opens [Working out a recipe's nutrition](recipe-nutrition.md). A recipe whose nutrition was worked out counts with it, after its own numbers.
- A number that is not one shows `Type how much, a number above 0.`, and a portion the food cannot be counted in shows `That amount is not one this food can be logged in.` The add button stays grayed out for both.
- **{button:Add to lunch|food}**, named for the meal chosen. It reads `Adding…` while it works. Then the sheet closes, the search box is empty for the next thing, and the line `Added to lunch:` appears above.

## How the numbers are worked out

Every food on the list has its calories, protein, carbs and fat per 100 grams, from USDA FoodData Central. Its portions are USDA's weights for them: `1 banana` is 126 g. So `1 banana` of `Banana, raw`, at 97 kcal per 100 g, is 122 kcal. An ounce is 28.35 g. A recipe counts with the numbers it states per serving, times the servings. Nothing is guessed: what you see is what is kept.

## A photo of the plate

1. Tap `Photo of the plate` here, or the camera on Food's `Today`. On a phone it opens the camera; take the photo from above, with the whole plate in it.
2. The page says `Reading the photo. It takes up to half a minute.` Claude looks at the photo and names each food on the plate, with about how much of it there is in grams. It does not say what anything contains: the numbers come from the food list.
3. `On the plate` lists what was found. For each:
   - Its picture, `Seen:` and what Claude saw, such as `Seen: grilled chicken breast`.
   - The food on the list it was matched to, such as `Chicken breast, grilled, skin not eaten`. When nothing matched, it says `No match on the list. Choose a food.` in red.
   - The amount, in grams to start, and what it counts. Change either to what you know, such as `1 breast`.
   - {button:Change food|food-soft}, or {button:Choose a food|food-soft} when nothing matched. It searches the list for what Claude saw, with `Choose the food for:` and its name above, and **Cancel** to stop. Tap a food to use it; the amount stays.
   - {button:|ghost|x} takes it off the plate.
   - Its numbers, for the amount.
4. `All of it` adds the plate up. Check every amount: they are estimates from a photo.
5. Click {button:Add all to dinner|food}, named for the meal chosen. It stays grayed out until every food has a match. You see `Logged 3 foods to dinner.` and land back on the day. {button:Discard|food-soft} throws the reading away.

The photo is sent to Claude to be read and is kept nowhere: not on the page, not in your log, not on Yosher's servers.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing found for "…". Try fewer words, or other ones.` | No food or recipe has all those words. Try one word, or another name for it. |
| `The search did not work this time. Try again.` | The search could not reach Yosher. Check your signal and type again. |
| `It could not be logged. Try again.` | Adding it did not work, and nothing was added. Click the add button, or the +, again. |
| `That food is not on the list any more. Search for it again.` | The food list changed since you chose it. Search for the food again. |
| `That amount is not one this food can be logged in. Choose another.` | The portion is not one of this food's. Choose another, or use `g` or `oz`. |
| `That recipe is not here any more.` | The recipe was deleted. Search for something else. |
| `That meal is not on the week any more. Reload the page.` | You came from {button:Change first|food-soft}, and the planned meal was taken off the week since. Go back to Food and log it there. |
| `You can log today and the two weeks before it.` | The day is more than two weeks back, or a page left open has fallen behind. Go back to Food and open the day again. |
| `Reading the photo. It takes up to half a minute.` | Claude is reading the photo. Wait on this page. |
| `No food was found in that photo. Try another one, or search for the foods.` | The photo showed no food Claude could name. Take it again closer, or search. |
| `The photo could not be read this time. Try again, or search for the foods.` | The reading did not work. Try again in a moment, or search for each food. |
| `That photo could not be used. Try another one, a JPEG or PNG.` | The phone could not open the file as a picture. Take the photo again, or choose another. |
| `Nothing came through. Try saying it again.` | The recording had no words in it. Click {button:|ghost|mic} and say it again. |
| `Nothing was recorded. Hold the button while you speak.` | The recording was empty. Click {button:|ghost|mic} and speak before it stops. |
| `That is too long. Say one thing at a time.` | The recording was too long. Say less at a time. |
| `Yosher could not listen just now. Type it instead.` | The speech service did not answer. Type what you ate. |
| `Something in that was not right. Check it and try again.` | What was sent was not something Food keeps. Reload the page and try again. |

## Not on this page

- **Typing in the numbers yourself**, for a meal out. Not built: choose the nearest food on the list, or a recipe.
- **Brands and barcodes.** The list is USDA's everyday foods; packaged foods by brand, and scanning a barcode, are not built.
- **A food that is not on the list.** Choose the nearest one, or make it a recipe with the nutrition it states.

## Who can do what

Only you. Food is in your personal space, which nobody else can open. Yosher staff cannot open it from the product either.
