# Working out a recipe's nutrition

> A recipe's nutrition worked out from its ingredients, for what the recipe does not state: each line matched to a food on USDA's list and weighed, every line for you to check, then saved for the whole recipe and counted by the serving.
> **Route:** /personal/m/food/recipes/*/nutrition
> **Order:** 35

Open a recipe and click {button:Work it out from the ingredients|primary|calculator}, or {button:Work out its nutrition|outline} on a meal that shows `no nutrition` on Today or `no numbers` on the week. Check each line, then click {button:Save as worked out|primary}.

Claude only finds each line's food on USDA's list and estimates a weight where neither the line nor USDA gives one. The numbers are USDA's, for the grams you check.

## What you see

- **The recipe's name**, with {icon:arrow-left}, back to the recipe with nothing saved.
- **`Working out the nutrition`**, the title, with {icon:circle-question-mark} beside it, which opens this guide beside the page, and under it `Each line is matched to a USDA food and weighed. Change a match or a weight, or leave a line out, then save.`
- **`Matching the ingredients to USDA's list. It takes a few seconds.`** while Claude reads the lines, when you open it for the first time, or after the recipe's ingredients changed. Once it was saved and still fits the recipe, it opens with what you saved, at once. After the recipe's ingredients changed, the lines it still has keep the foods and grams you checked before; only the new or changed lines are matched afresh.
- **Each ingredient line**, as the recipe writes it, and under it the USDA food it was matched to, such as `Onions, raw`. With none, `No match on USDA's list. Choose a food.` in red. On the right, what it comes to, such as `88 kcal`, `not counted` when it is left out, or `–` while it has no grams.
  - **The grams**, in a box you can change, then `g`, and where they came from:
    - `from the line`: the line gives a weight: its amount (`2 lb`), a can's size (`1 can (28 oz)`), or a weight in brackets (`2 salmon fillets (6 oz each)`, `1 ½ cups (190 g) flour`).
    - `USDA's weight`: USDA's own weight for the portion the line counts in: a cup of it, a clove, a medium one.
    - `estimated`: Claude's estimate, such as the beans in `2 cans (15 oz) black beans, drained` without their liquid.
    - `typed`: you typed them.
    - `no weight`: nothing gives one. Type grams to count it.
  - {button:Change food|outline}, or {button:Choose a food|outline} for a line with no match, opens a search of USDA's ingredient list. The box starts with the line's words greyed in it: type a few words of your own and click the food. Each shows its group and its calories per 100 g, such as `Vegetables and Vegetable Products · 40 kcal per 100 g`. The grams are found again for the new food, unless you typed them, and the line counts once it has grams. The {icon:x} closes the search with nothing changed.
  - {button:Leave out|ghost} takes a line out of the count, and {button:Count it|ghost} puts it back. {button:Count it|ghost} is grayed out until the line has a food and grams. Salt, pepper, water and lines with no amount start left out: next to nothing in calories.
- **The totals**, as you change things, divided by what the recipe makes:
  - Per serving, such as `Per serving: 512 kcal · protein 43 g · carbs 36 g · fat 21 g`, and under it `The whole recipe, which makes 6 servings: 3,072 kcal, from 8 lines of 9.` A serving is what you log the recipe in: for a recipe that makes 2 loaves, a loaf. With nothing counted yet, `Per serving: nothing counted yet`.
  - A recipe that does not say what it makes shows `The whole recipe:` and its numbers, then `From 8 lines of 9. The recipe does not say what it makes, so all of it counts as one serving. Say what it makes in its editor to count it by the serving.`
- **`Also count it for the 2 times you logged it with no numbers. Numbers already logged stay as they are.`**, ticked to start, when you logged the recipe before it had numbers. Saving fills in what those logs lacked, at the servings you logged.
- {button:Save as worked out|primary} keeps it, saying `Saving…` while it does, and goes back to the recipe with `Nutrition saved.`, or `Nutrition saved. Filled in 2 past logs.` It is grayed out until at least one line counts.
- {button:Match again|ghost|refresh} asks Claude to match every line again, from the start. What you changed is lost.
- At the bottom: `Foods and their nutrition from USDA FoodData Central (SR Legacy), per 100 g, for the grams you check. Claude found the foods and estimated the weights marked estimated; it says nothing about what they contain.`

## Which numbers count

- **The recipe's own first.** A recipe that states its calories or protein keeps them; the worked-out numbers count for what it does not state.
- **Everywhere a recipe counts**: Log food, Today's Ate it, and the week's numbers.
- **What the recipe makes** divides it. Change it in the recipe's editor and a serving follows, with nothing to check again: the whole recipe is kept, not a serving.
- **Change the recipe's ingredients** later, and the recipe says it was worked out from an earlier version, with {button:Check it again|outline}. Its numbers still count until you do.

## How to work out a recipe

1. Open the recipe and click {button:Work it out from the ingredients|primary|calculator}.
2. Wait a few seconds while the lines are matched.
3. Read down the lines. Where a food is wrong, click {button:Change food|outline} and choose the right one. Where a weight is off, type the grams.
4. Check the totals per serving. If the recipe makes more or fewer than it says, change that in its editor: the totals follow.
5. Click {button:Save as worked out|primary}.

## Messages

| Message | What it means |
| --- | --- |
| `Matching the ingredients to USDA's list. It takes a few seconds.` | Claude is reading the lines. Wait on the page. |
| `The ingredients could not be matched this time. Try again.` | Claude could not be reached. Click {button:Try again|outline}. |
| `This recipe has no ingredients to work out. Add them in the editor first.` | The recipe has no ingredient lines yet. |
| `No match on USDA's list. Choose a food.` | Nothing on the list fitted the line. Choose a food, or leave the line out. |
| `The recipe's ingredients changed while you checked them. Work it out again.` | The recipe was edited, perhaps in another tab. Click {button:Match again|ghost|refresh}. |
| `The nutrition could not be saved. Try again.` | Saving did not work. Nothing changed. Try again. |
| `The search did not work this time. Try again.` | The ingredient search could not reach Yosher. Type again. |
| `Nothing found for “quinoa bake”. Try fewer words, or other ones.` | No ingredient on the list has those words. |
| `That recipe is not here any more.` | It was deleted, perhaps in another tab. |
| `Something in that was not right. Check it and try again.` | What was sent was not something Food keeps. Reload the page and try again. |

## Not on this page

- **Cooked weights.** Ingredients are weighed as bought: uncooked rice, raw meat.
- **Brands.** USDA's list is everyday ingredients, not packaged foods by brand.
- **Changing a past log's numbers.** Logs that already have numbers are never changed; only what they lacked is filled in.

## Who can do what

Only you. Food is in your personal space, which nobody else can open. Yosher staff cannot open it from the product either.
