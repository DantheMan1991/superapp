/**
 * FOOD'S CONTROLS, AS CLASSES (the Fresh Market skin, ADR 0132): the filled
 * button, the soft one, the quiet one, their sizes, the field and the chip,
 * written once so every Food screen draws them alike. Full strings, so
 * Tailwind sees each class; put together with `cn`.
 */

const BUTTON = "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl whitespace-nowrap transition-colors disabled:opacity-50";

/** The one main action on a screen: Food's orange. */
export const FOOD_PRIMARY = `${BUTTON} bg-food-accent font-semibold text-white hover:bg-food-accent-hover active:translate-y-px`;
/** Everything beside it: cream. */
export const FOOD_SOFT = `${BUTTON} bg-food-soft font-medium text-foreground hover:bg-food-tabs-track`;
/** A way out or a small extra: words only. */
export const FOOD_QUIET = `${BUTTON} font-medium text-muted-foreground hover:text-foreground`;

export const FOOD_SIZE = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-[15px]",
  lg: "h-[52px] px-5 text-base",
} as const;

/** A round button with an icon alone (the help, an arrow, edit). */
export const FOOD_ROUND = "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-card ring-1 ring-black/[0.06] hover:bg-food-field";

/** A text box or a select, in the field's fill. */
export const FOOD_FIELD = "h-12 rounded-xl bg-food-field px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-food-accent";

/** A card: white, the warm shadow, rounder on a wide screen. */
export const FOOD_CARD = "rounded-2xl bg-card shadow-food-card @2xl:rounded-3xl";

/** A pill to choose with (a meal, a tag, a day): filled when chosen. */
export function foodChip(on: boolean): string {
  return on
    ? "inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-full bg-food-accent px-3.5 text-sm font-semibold whitespace-nowrap text-white"
    : "inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-full bg-card px-3.5 text-sm whitespace-nowrap ring-1 ring-food-chip-ring hover:bg-food-field";
}
