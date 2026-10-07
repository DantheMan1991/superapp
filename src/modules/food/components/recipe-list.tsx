"use client";

import Link from "next/link";
import { useState } from "react";
import { Clock, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { gramWords } from "../core/eating";
import { minutesWords, yieldWords } from "../core/recipe";
import type { RecipeSummary } from "../recipe-ops";
import { foodChip } from "./food-styles";
import { FoodThumb, recipeTone } from "./food-thumb";

/** "480 kcal · 38 g protein", either alone, or null with neither. */
function servingWords(perServing: RecipeSummary["perServing"]): { kcal: string | null; protein: string | null } | null {
  if (!perServing) return null;
  return {
    kcal: perServing.calories === null ? null : Math.round(perServing.calories).toLocaleString("en-US"),
    protein: perServing.proteinG === null ? null : `${gramWords(perServing.proteinG)} protein`,
  };
}

/**
 * THE RECIPES (docs/help/food/recipes.md; photo cards in the "Fresh Market"
 * skin, his call 2026-10-07): a search box that looks in the names, the tags
 * and the ingredient lines, the tags to narrow by, and a card per recipe with
 * its photo, its time, what it makes, how often it was made, and a serving's
 * calories and protein. Everything filters on the phone as you type; one
 * person's recipe box is small enough to hold whole.
 */
export function RecipeList({ recipes }: { recipes: RecipeSummary[] }) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);

  const tags = [...new Set(recipes.flatMap((recipe) => recipe.tags))].sort((a, b) => a.localeCompare(b));
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = recipes.filter(
    (recipe) => (tag === null || recipe.tags.includes(tag)) && words.every((word) => recipe.search.includes(word)),
  );

  return (
    <section className="space-y-4" aria-label="Your recipes">
      <div className="relative rounded-xl bg-card ring-1 ring-food-chip-ring focus-within:shadow-food-focus focus-within:ring-2 focus-within:ring-food-accent">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-food-accent" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search recipes or ingredients"
          aria-label="Search recipes or ingredients"
          className="h-[50px] w-full rounded-xl bg-transparent pr-11 pl-12 text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {query !== "" && (
          <button
            type="button"
            aria-label="Clear the search"
            onClick={() => setQuery("")}
            className="absolute top-1/2 right-2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tags">
          {[null, ...tags].map((value) => (
            <button key={value ?? "all"} type="button" aria-pressed={tag === value} onClick={() => setTag(value)} className={foodChip(tag === value)}>
              {value ?? "All"}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="rounded-2xl bg-card px-4 py-6 text-center text-sm text-muted-foreground shadow-food-card">No recipe matches.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @2xl:gap-4 @5xl:grid-cols-4">
          {shown.map((recipe) => {
            const serving = servingWords(recipe.perServing);
            return (
              <li key={recipe.id}>
                <Link
                  href={`/personal/m/food/recipes/${recipe.id}`}
                  className="block h-full overflow-hidden rounded-2xl bg-card shadow-food-card transition-shadow hover:shadow-elevation-3"
                >
                  <span className="relative block aspect-[4/3]">
                    <FoodThumb photoUrl={recipe.photoUrl} recipe tone={recipeTone(recipe.id)} className="size-full [&_svg]:size-10" />
                    {recipe.minutes !== null && (
                      <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-[11px] font-semibold text-foreground">
                        <Clock className="size-3" aria-hidden /> {minutesWords(recipe.minutes)}
                      </span>
                    )}
                  </span>
                  <span className="block space-y-0.5 px-3 pt-2.5 pb-3">
                    <span className="line-clamp-2 block font-food-display text-[15px] leading-tight font-bold tracking-[-0.02em] @2xl:text-[17px]">
                      {recipe.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {[recipe.yieldAmount !== null ? yieldWords(recipe.yieldAmount, recipe.yieldUnit) : null, recipe.made > 0 ? `made ${recipe.made}×` : null]
                        .filter(Boolean)
                        .join(" · ") || " "}
                    </span>
                    <span className={cn("block text-xs tabular-nums", !serving && "font-semibold text-food-accent-ink")}>
                      {serving ? (
                        <>
                          {serving.kcal && (
                            <>
                              <b className="font-semibold">{serving.kcal}</b> kcal
                            </>
                          )}
                          {serving.kcal && serving.protein && " · "}
                          {serving.protein}
                        </>
                      ) : (
                        "No nutrition yet"
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
