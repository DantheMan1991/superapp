"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * A tick box, for picking rows out of a list.
 *
 * **ADDED BECAUSE `Switch` WAS DOING THIS JOB AND SAYING THE WRONG THING.** A
 * switch turns a thing on; beside a row that reads "Cattle 2" it reads as
 * switching cattle on rather than as picking that row to act on. The price list
 * had one on every row of a 108-row sheet.
 *
 * **NOTE THE VARIANT: `data-[state=checked]`, NOT `data-checked`.** Radix emits
 * `data-state="checked" | "unchecked"`, and Tailwind v4's `data-checked:`
 * shorthand compiles to `[data-checked]` — an attribute nothing here sets. See
 * the design-system dossier: `switch.tsx` has that mistake in it and its checked
 * fill has never applied.
 *
 * Tokens only — `--primary` for the fill, `--primary-foreground` for the tick,
 * `--input` for the resting edge, matching every other control in the kit.
 */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-sm border border-input bg-background shadow-none transition-colors outline-none",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        "aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <Check className="size-3.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
