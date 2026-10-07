"use client";

import type { ReactNode } from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { foodDisplay } from "./food-display";

export const FoodSheetTitle = SheetPrimitive.Title;
export const FoodSheetDescription = SheetPrimitive.Description;

/**
 * FOOD'S SHEET (the Fresh Market skin, ADR 0132): up from the bottom on a
 * phone, a card in the middle on a wide screen, with the grabber drawn on a
 * phone. Portalled out of the page, so it carries Food's face itself. The
 * caller puts a `FoodSheetTitle` inside, for screen readers.
 */
export function FoodSheet({
  open,
  onClose,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <SheetPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetPrimitive.Portal>
        <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/25 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <SheetPrimitive.Content
          className={cn(
            foodDisplay.variable,
            "fixed inset-x-0 bottom-0 z-50 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-t-3xl bg-card px-4 pt-2.5 pb-[calc(1rem+env(safe-area-inset-bottom))] text-foreground shadow-food-sheet outline-none",
            "data-open:animate-in data-open:slide-in-from-bottom-10 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-10",
            "sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:p-6 sm:shadow-elevation-3",
            className,
          )}
        >
          <div className="mx-auto mb-3 h-[5px] w-10 rounded-full bg-food-chip-ring sm:hidden" aria-hidden />
          {children}
        </SheetPrimitive.Content>
      </SheetPrimitive.Portal>
    </SheetPrimitive.Root>
  );
}
