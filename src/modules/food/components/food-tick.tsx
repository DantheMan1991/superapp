import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A TICK CIRCLE (a recipe's ingredients, the shopping list; ADR 0132): round,
 * filled in Food's orange once ticked. Drawn only: the row around it is the
 * checkbox, so the whole row is the thing to tap.
 */
export function FoodTick({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-[30px] shrink-0 items-center justify-center rounded-full border-2 transition-colors",
        on ? "border-food-accent bg-food-accent text-white" : "border-input bg-card text-transparent",
        className,
      )}
    >
      <Check className="size-4" strokeWidth={3} />
    </span>
  );
}
