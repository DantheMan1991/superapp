import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { foodDisplay } from "./food-display";

/**
 * A FOOD PAGE'S OUTERMOST BOX (ADR 0132): it carries the display face, makes
 * the page a container (Food's layouts follow the width they are given, not
 * the window, since the rail takes some of it), and says the page is Food's,
 * which paints the shell's pane warm (`globals.css`).
 */
export function FoodPage({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div data-food-page="" className={cn(foodDisplay.variable, "@container mx-auto w-full", className)}>
      {children}
    </div>
  );
}
