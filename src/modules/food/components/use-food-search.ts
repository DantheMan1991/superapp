"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import type { FoodHit, RecipeHit } from "../core/eating";

export interface FoodSearchResults {
  q: string;
  foods: FoodHit[];
  recipes: RecipeHit[];
}

/**
 * THE FOOD SEARCH as a person types (D4a's Log food, and D2's Put on the
 * week): a GET the box can drop (`/api/food/search`). Each keystroke cancels
 * the request before it, so an old answer never lands over a newer one, and
 * the box waits 200 ms for the typing to pause.
 */
export function useFoodSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<FoodSearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<number | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  function search(text: string) {
    setQ(text);
    if (timer.current !== null) window.clearTimeout(timer.current);
    inFlight.current?.abort();
    if (text.trim() === "") {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = window.setTimeout(async () => {
      const controller = new AbortController();
      inFlight.current = controller;
      try {
        const response = await fetch(`/api/food/search?q=${encodeURIComponent(text)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { foods: FoodHit[]; recipes: RecipeHit[] };
        setResults({ q: text, foods: body.foods, recipes: body.recipes });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        toast.error("The search did not work this time. Try again.");
      }
      setSearching(false);
    }, 200);
  }

  return { q, results, searching, search };
}
