"use client";

import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * WHICH TOOLS THIS SIDE OF THE BUSINESS WORKS WITH (ADR 0091, 0092).
 *
 * One control, two screens: a division picks its tools on the settings list
 * (`enterprises.packs`) and a company overrides its trade's on the companies
 * list (`entities.packs`). They are the same question one rung apart, and a
 * client who has met one should recognise the other — which is the whole reason
 * this is a shared component rather than the same grid written twice.
 *
 * **ONLY THE LAYER 2A PACKS ARE EVER LISTED.** The core tools are not offered,
 * because everything in one workspace posts to the same books, raises the same
 * documents and sends the same mail. There is nothing to decide about them.
 *
 * **TICKING NOTHING IS THE DEFAULT AND IT IS NOT "NO TOOLS".** An empty list
 * means "not said", and what happens then differs per screen — so the sentence
 * that says so is the caller's, in `hint`, rather than copy this file guesses.
 */

/** A pack that can be picked: the slug the rail matches, and its own name. */
export interface PackChoice {
  slug: string;
  name: string;
}

export function PackField({
  id,
  label = "Tools it works with",
  choices,
  picked,
  onPicked,
  hint,
}: {
  id: string;
  label?: string;
  choices: PackChoice[];
  picked: string[];
  onPicked: (next: string[]) => void;
  /** What ticking nothing means HERE. Never optional — it is the whole field. */
  hint: ReactNode;
}) {
  // A client with no packs switched on has nothing to pick from, and an empty
  // grid under a label is furniture.
  if (choices.length === 0) return null;
  const toggle = (slug: string) =>
    onPicked(
      picked.includes(slug) ? picked.filter((s) => s !== slug) : [...picked, slug],
    );
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div id={id} className="grid grid-cols-2 gap-1.5">
        {choices.map((choice) => (
          <label
            key={choice.slug}
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <Checkbox
              checked={picked.includes(choice.slug)}
              onCheckedChange={() => toggle(choice.slug)}
            />
            {choice.name}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
