"use client";

import Link from "next/link";
import { useState } from "react";
import { ImageIcon, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { minutesWords, yieldWords } from "../core/recipe";
import type { RecipeSummary } from "../recipe-ops";

/**
 * THE RECIPES (docs/help/food/overview.md): a search box that looks in the
 * names, the tags and the ingredient lines, a row of tags to narrow by, and a
 * row per recipe. Everything filters on the phone as you type; one person's
 * recipe box is small enough to hold whole.
 */
export function RecipeList({ recipes }: { recipes: RecipeSummary[] }) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);

  const tags = [...new Set(recipes.flatMap((recipe) => recipe.tags))].sort((a, b) => a.localeCompare(b));
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = recipes.filter(
    (recipe) =>
      (tag === null || recipe.tags.includes(tag)) && words.every((word) => recipe.search.includes(word)),
  );

  return (
    <section className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search recipes or ingredients"
          aria-label="Search recipes or ingredients"
          className="pl-9"
        />
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tags">
          {[null, ...tags].map((value) => (
            <button
              key={value ?? "all"}
              type="button"
              aria-pressed={tag === value}
              onClick={() => setTag(value)}
              className={cn(
                "rounded-full border px-3 py-0.5 text-sm",
                tag === value
                  ? "border-module-accent bg-module-accent/10 text-module-accent"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {value ?? "All"}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="rounded-2xl bg-card px-4 py-6 text-center text-sm text-muted-foreground shadow-elevation-1">
          No recipe matches.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-elevation-1">
          {shown.map((recipe) => (
            <li key={recipe.id}>
              <Link href={`/personal/m/food/recipes/${recipe.id}`} className="flex gap-3 px-4 py-3 hover:bg-muted/50">
                {recipe.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a private photo streamed through its own route
                  <img src={recipe.photoUrl} alt="" className="size-14 shrink-0 rounded-lg object-cover" loading="lazy" />
                ) : (
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <ImageIcon className="size-5" aria-hidden />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{recipe.title}</span>
                  <span className="block text-sm text-muted-foreground">
                    {[
                      recipe.minutes !== null ? minutesWords(recipe.minutes) : null,
                      recipe.yieldAmount !== null ? yieldWords(recipe.yieldAmount, recipe.yieldUnit) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {recipe.tags.length > 0 && (
                    <span className="block truncate text-sm text-muted-foreground">{recipe.tags.join(" · ")}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
