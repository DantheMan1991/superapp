# Typing in and editing a recipe

> One screen for three jobs: checking a recipe that was read from a link, text or photos, typing one in, and changing one you saved. Nothing is saved until you click Save recipe.
> **Route:** /personal/m/food/new, /personal/m/food/drafts/*, /personal/m/food/recipes/*/edit
> **Order:** 20

You reach this screen three ways. After {button:Read it|primary} on Add a recipe, or {button:Check it|primary} on a draft, it opens on what was read, titled `Check the recipe`, with a yellow note such as `Read from recipes.example. Check it, then Save recipe. Nothing is saved yet.` From **Type it in**, it opens empty, titled `Type a recipe in`. From {button:Edit|outline|pencil} on a recipe, it opens on that recipe, titled `Edit the recipe` with the recipe's name under it. Whichever way you came, change what you need and click {button:Save recipe|primary}.

## What you see

- **Photo.** The recipe's photo, when it has one. A recipe read from a link brings the page's own photo. Then:
  - {button:Add a photo|outline|image-plus} or {button:Change photo|outline|image-plus}. On a phone you can take a photo or pick one. It is made smaller on your phone first, and what the camera wrote into the file, such as where and when it was taken, is left behind.
  - {button:Remove photo|ghost|x}. Takes the photo off. The recipe keeps no photo once you save.
- **Name.** What the recipe is called. It is the one thing a recipe must have.
- **Makes.** How many one batch makes: a number, and the word for what it counts, such as `4` `servings`, `24` `cookies` or `1` `loaf`. With a number and no word, it is servings. The number is what the recipe's page scales from when you change the servings. Leave both empty when the recipe does not say; the recipe then shows as written and does not scale.
- **Prep (min)**, **Cook (min)** and **Total (min).** Whole minutes, each one optional. When Total is empty, the list shows prep and cook added together.
- **Tags.** Each tag shows with {button:×|ghost|x} to take it off. Type a new one in **Add a tag** and press Enter, or type a comma; a few at once can be typed with commas between them. Under the box, suggestions to add with one click, such as `+ Dinner`: the tags your recipes already use, or, before you have any, Breakfast, Lunch, Dinner, Snack, Dessert, High protein and Quick. The Food page lets you see one tag's recipes at a time.
- **Ingredients.** One per line. A line that ends with a colon, like `For the sauce:`, starts a group and shows as a heading.
  - When the lines are filled in, they show as the app reads them: the amount at the start of each line and its unit in colour, and `does not scale` beside a line with no amount at its start. Click {button:Edit the lines|ghost|pencil} to change them in a box, then {button:Done|outline} to see them read again.
  - An empty recipe opens straight on the box.
- **Steps.** One step per line, in order. A line that ends with a colon starts a group. A number in front of a step, such as `1.` or `Step 2:`, is taken off: the recipe's page numbers the steps itself.
- **Notes.** Anything else: swaps, what you changed, how long it keeps.
- **Nutrition per serving.** Calories (kcal), Protein (g), Carbs (g), Fat (g), Fiber (g), Sugar (g) and Sodium (mg), with the line `As the recipe states it. Leave these empty if it doesn't say.` A recipe read from a page that lists its nutrition arrives with these filled in.
- **Source link.** Where the recipe came from. A recipe read from a link has it already. The recipe's page shows the site's name, and clicking it opens the page.
- **`Fix these before saving:`** with a list, in red, when something stops the save. Each line is one of the messages below.
- **The bar at the bottom**, which stays in view as you scroll:
  - {button:Cancel|ghost}, when typing a recipe in or editing one. It leaves without saving: to the Food page, or back to the recipe.
  - {button:Discard draft|ghost}, when checking a draft. It asks `Discard this draft?` first. See [Food](overview.md).
  - {button:Save recipe|primary}. Reads `Saving…` while it works, then says `Recipe saved` and opens the recipe.

## How amounts are read

What scales is read from the start of each ingredient line, every time the recipe is shown. The line itself is kept exactly as you wrote it.

- **An amount at the start of the line scales:** `2`, `1/2`, `½`, `1 1/2`, `1½`, `1.5`, and ranges such as `2-3` and `2 to 3`.
- **The unit after it follows the number** when it is written in full: `1 cup` becomes `2 cups`. Short units, such as `tbsp`, `oz` and `g`, stay as written. A few foods counted whole follow the number too: `1 egg` becomes `2 eggs`.
- **An amount in brackets after the unit scales with it:** `1 ½ cups (190 g) flour` doubles to `3 cups (380 g) flour`.
- **A can's size does not:** `1 (14 oz) can tomatoes` doubles to `2 (14 oz) cans tomatoes`.
- **A size is not an amount:** `2-inch piece ginger` does not scale.
- **A line with its amount in the middle does not scale,** such as `juice of 1 lemon`. Write `1 lemon, juiced` if you want it to.

## How to check a draft

1. Read the name, what it makes and the times against the original.
2. Check every ingredient line, its amount and its unit above all. A line marked `does not scale` will stay as it is whatever the servings.
3. Read the steps in order.
4. Add or change the photo and the tags if you like.
5. Click {button:Save recipe|primary}. The draft becomes your recipe and leaves the Food page's Drafts.

## A draft that is still being read, or that failed

- While Claude is still reading, the page says `Still reading. This page looks again by itself.` It turns into the editor when the reading is done.
- When the reading failed, the page shows why, in red, with {button:Try again|outline}, which opens Add a recipe, and {button:Discard draft|outline}.

## Messages

| Message | What it means |
| --- | --- |
| `Give the recipe a name.` | **Name** is empty. |
| `Keep the name under 200 characters.` | The name is too long. |
| `Write how many it makes as a number, like 4.` | **Makes** has something that is not a number above 0, or a number over 10,000. |
| `Write how many it makes, like 4, or clear the word after it.` | There is a word, such as servings, but no number before it. |
| `Keep what it makes under 40 characters, like servings or cookies.` | The word after the number is too long. |
| `Write the prep time as whole minutes, like 20.` | **Prep (min)** is not a whole number of minutes from 0 to a week (10,080). The same message names the cook time or the total time for those boxes. |
| `Keep the tags to 12 or fewer.` | A recipe can have up to 12 tags. |
| `Keep each tag under 40 characters.` | A tag is too long. |
| `A recipe can have up to 150 ingredient lines.` | Too many lines in **Ingredients**. |
| `Keep each ingredient line under 500 characters.` | One ingredient line is too long. |
| `A recipe can have up to 100 steps.` | Too many lines in **Steps**. |
| `Keep each step under 3,000 characters.` | One step is too long. |
| `Keep the notes under 10,000 characters.` | **Notes** is too long. |
| `Write calories as a number, like 12.` | A nutrition box has something that is not a number, or a number below 0. The same message names protein, carbs, fat, fiber, sugar or sodium for those boxes. |
| `Write the source as a web address that starts with https://.` | **Source link** is not a web address. |
| `That photo could not be used. Try another one, a JPEG or PNG.` | The photo could not be opened as a picture, on your phone or on the server. |
| `Photos cannot be kept right now. Save the recipe without one, and add it later.` | Yosher's photo storage is not answering. Remove the photo, save, and add the photo again later. |
| `Recipe saved` | The recipe is saved, and its page opens. |
| `The recipe could not be saved. Try again.` | Something went wrong on the way. Nothing was saved, and a new photo was not kept. Try again. |
| `That recipe is not here any more.` | The recipe was deleted while you were editing it. |
| `That draft is not here any more.` | The draft was saved or discarded already, maybe in another tab. Your recipes are on the Food page. |
| `That draft is still being read. Wait for it to finish.` | You tried to discard or save a draft Claude is still reading. |
| `Something in that was not right. Check it and try again.` | What was sent could not be read as a recipe. Reload the page and try again. |

## Who can do what

Only you. Food is in your personal space, which nobody else can open.
