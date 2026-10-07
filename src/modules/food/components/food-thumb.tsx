import {
  Amphora,
  Apple,
  Baby,
  Banana,
  Bean,
  Beef,
  Beer,
  CakeSlice,
  Candy,
  Carrot,
  ChefHat,
  Cherry,
  Citrus,
  Coffee,
  Cookie,
  CookingPot,
  Croissant,
  CupSoda,
  Donut,
  Drumstick,
  Egg,
  Fish,
  GlassWater,
  Grape,
  Ham,
  Hamburger,
  IceCreamBowl,
  IceCreamCone,
  LeafyGreen,
  Martini,
  Milk,
  Nut,
  Pizza,
  Popcorn,
  Popsicle,
  Salad,
  Sandwich,
  Shrimp,
  Soup,
  Sunrise,
  UtensilsCrossed,
  Wheat,
  Wine,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Meal } from "../core/eating";
import { foodIconFor, type FoodIcon } from "../core/food-icons";

const FOOD_ICON: Record<FoodIcon, LucideIcon> = {
  baby: Baby,
  water: GlassWater,
  coffee: Coffee,
  beer: Beer,
  wine: Wine,
  cocktail: Martini,
  drink: CupSoda,
  milk: Milk,
  bowl: IceCreamBowl,
  icecream: IceCreamCone,
  popsicle: Popsicle,
  sandwich: Sandwich,
  burger: Hamburger,
  pizza: Pizza,
  soup: Soup,
  dish: CookingPot,
  grain: Wheat,
  donut: Donut,
  bread: Croissant,
  cookie: Cookie,
  cake: CakeSlice,
  candy: Candy,
  snack: Popcorn,
  nut: Nut,
  bean: Bean,
  jar: Amphora,
  egg: Egg,
  ham: Ham,
  poultry: Drumstick,
  shellfish: Shrimp,
  fish: Fish,
  meat: Beef,
  apple: Apple,
  banana: Banana,
  berries: Cherry,
  citrus: Citrus,
  grape: Grape,
  greens: LeafyGreen,
  salad: Salad,
  vegetable: Carrot,
  food: UtensilsCrossed,
};

/** Each meal's icon on its tint, as the design draws the meal tiles. */
export const MEAL_ICON: Record<Meal, LucideIcon> = {
  breakfast: Sunrise,
  lunch: Salad,
  dinner: Soup,
  snack: Cookie,
};

export type ThumbTone = Meal | "neutral";

/** Full class strings, so Tailwind sees every one of them. */
export const TONE_CLASS: Record<ThumbTone, string> = {
  breakfast: "bg-food-breakfast text-food-breakfast-ink",
  lunch: "bg-food-lunch text-food-lunch-ink",
  dinner: "bg-food-dinner text-food-dinner-ink",
  snack: "bg-food-snack text-food-snack-ink",
  neutral: "bg-food-tint text-food-accent-ink",
};

/**
 * THE PICTURE BESIDE A FOOD OR A RECIPE (ADR 0132): a recipe's own photo, a
 * chef's hat without one, and a food on USDA's list as the icon for its kind
 * (`foodIconFor`, his call), on a meal's tint. Never an empty grey box. Sized
 * and shaped by the caller (`size-12 rounded-lg`, `size-[26px] rounded-full`).
 */
export function FoodThumb({
  photoUrl = null,
  recipe = false,
  category = null,
  tone = "neutral",
  className,
}: {
  photoUrl?: string | null;
  recipe?: boolean;
  category?: string | null;
  tone?: ThumbTone;
  className?: string;
}) {
  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- a private photo streamed through its own route
    return <img src={photoUrl} alt="" className={cn("shrink-0 object-cover", className)} loading="lazy" />;
  }
  const Icon = recipe ? ChefHat : FOOD_ICON[foodIconFor(category)];
  return (
    <span className={cn("flex shrink-0 items-center justify-center", TONE_CLASS[tone], className)} aria-hidden>
      <Icon className="size-[45%]" />
    </span>
  );
}

/** A meal's tile: its icon on its tint. */
export function MealTile({ meal, className }: { meal: Meal; className?: string }) {
  const Icon = MEAL_ICON[meal];
  return (
    <span className={cn("flex shrink-0 items-center justify-center", TONE_CLASS[meal], className)} aria-hidden>
      <Icon className="size-1/2" />
    </span>
  );
}
