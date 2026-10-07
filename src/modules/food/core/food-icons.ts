/**
 * A FOOD'S PICTURE IS AN ICON FOR ITS KIND (his call, 2026-10-06): USDA's
 * foods have no photos, and a grey box is never shown, so a food on the list
 * is drawn as an icon picked from its WWEIA category ("Yogurt, Greek",
 * "Chicken, whole pieces"). Nothing to download or license. A recipe shows
 * its own photo, and a chef's hat without one.
 *
 * The rules run in order, the first match wins, so the narrow ones come
 * first: "Cheese sandwiches" is a sandwich before it is cheese, and "Egg
 * rolls, dumplings, sushi" is a dish, not an egg. Whole words where a short
 * one hides in a longer ("pie" in "pieces", "oil" in "boiled", "pea" in
 * "peaches"). `tests/food-today.test.ts` runs every category on the list
 * through them.
 */

export const FOOD_ICONS = [
  "baby",
  "water",
  "coffee",
  "beer",
  "wine",
  "cocktail",
  "drink",
  "milk",
  "bowl",
  "icecream",
  "popsicle",
  "sandwich",
  "burger",
  "pizza",
  "soup",
  "dish",
  "grain",
  "donut",
  "bread",
  "cookie",
  "cake",
  "candy",
  "snack",
  "nut",
  "bean",
  "jar",
  "egg",
  "ham",
  "poultry",
  "shellfish",
  "fish",
  "meat",
  "apple",
  "banana",
  "berries",
  "citrus",
  "grape",
  "greens",
  "salad",
  "vegetable",
  "food",
] as const;
export type FoodIcon = (typeof FOOD_ICONS)[number];

const RULES: readonly (readonly [RegExp, FoodIcon])[] = [
  [/^baby |^formula|^baby\b/i, "baby"],
  [/water/i, "water"],
  [/coffee|\btea\b/i, "coffee"],
  [/beer/i, "beer"],
  [/wine/i, "wine"],
  [/liquor|cocktail/i, "cocktail"],
  [/soft drink|sport and energy|diet drink|fruit drink|juice|smoothie|milk shake|nutritional beverage|protein and nutritional powder/i, "drink"],
  [/sandwich/i, "sandwich"],
  [/^burgers?$/i, "burger"],
  [/pizza/i, "pizza"],
  [/soup/i, "soup"],
  [/mixed dish|dishes|stir-fry|fried rice|egg rolls|burrito|nacho|macaroni and cheese/i, "dish"],
  [/sauces?\b|dressing|\boils?\b|grav|\bdips\b|mayonnaise|mustard|condiment|olive|pickle/i, "jar"],
  [/milk|cream and cream|cheese|butter and animal|margarine/i, "milk"],
  [/yogurt|pudding/i, "bowl"],
  [/ice cream|frozen dairy/i, "icecream"],
  [/gelatin|\bices\b|sorbet/i, "popsicle"],
  [/rice|pasta|noodle|cooked grains|cereal|oatmeal|grits/i, "grain"],
  [/doughnut|pastries/i, "donut"],
  [/bread|bagel|\brolls\b|\bbuns\b|biscuit|muffin|^tortillas$|pancake|waffle|turnover/i, "bread"],
  [/cookie|brownie|cracker/i, "cookie"],
  [/\bcakes?\b|\bpies?\b/i, "cake"],
  [/candy|sugar|honey|\bjams?\b|syrup|topping|nutrition bar/i, "candy"],
  [/chips|pretzel|snack mix|popcorn/i, "snack"],
  [/\bnuts?\b|\bseeds?\b/i, "nut"],
  [/string bean/i, "greens"],
  [/\bbeans?\b|\bpeas\b|legume|soy and meat-alternative/i, "bean"],
  [/\beggs?\b/i, "egg"],
  [/bacon|sausage|frankfurter|cold cut|cured meat/i, "ham"],
  [/chicken|poultry|turkey|duck/i, "poultry"],
  [/shellfish/i, "shellfish"],
  [/fish|seafood/i, "fish"],
  [/beef|pork|lamb|goat|\bgame\b|liver|organ meat/i, "meat"],
  [/banana/i, "banana"],
  [/berr/i, "berries"],
  [/citrus/i, "citrus"],
  [/grape/i, "grape"],
  [/apple|melon|mango|papaya|pineapple|peach|nectarine|\bpears?\b|fruit/i, "apple"],
  [/lettuce|salad/i, "salad"],
  [/spinach|dark green|broccoli|cabbage/i, "greens"],
  [/carrot|red and orange|tomato|corn|onion|potato|starchy|vegetable/i, "vegetable"],
];

/** The icon for a food's USDA category; a plate and fork for anything the rules do not know. */
export function foodIconFor(category: string | null | undefined): FoodIcon {
  if (!category) return "food";
  for (const [pattern, icon] of RULES) if (pattern.test(category)) return icon;
  return "food";
}
