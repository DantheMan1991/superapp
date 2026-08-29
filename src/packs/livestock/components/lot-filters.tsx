"use client";

import Link from "next/link";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Narrow the lot list: by name or species, and whether closed ones show.
 *
 * **THE FILTER LIVES IN THE URL, NOT IN STATE**, matching `inventory`'s item
 * filters exactly. The list is server-rendered from it, so a filtered view is a
 * link somebody can bookmark or come back to with the back button — and a
 * client-side filter over a list the server already narrowed would be two
 * filters disagreeing about one page.
 *
 * **THE SEARCH IS A FORM AND THE TOGGLE IS A LINK**, which is the split between
 * an open question and a closed one. Typing is not one round trip, so the box
 * submits on Enter or the button rather than on every keystroke.
 *
 * **THE SERVER FILTERS BEFORE IT DOES THE EXPENSIVE READS**, so this narrows
 * the work and not only the render — see `LivestockModule`'s two phases.
 */
export function LotFilters({
  base,
  search,
  showClosed,
  shown,
  matched,
  word,
}: {
  /** The list route, so this component invents no URLs of its own. */
  base: string;
  search: string;
  showClosed: boolean;
  /** How many rows are on the page. */
  shown: number;
  /** How many matched before the cap. */
  matched: number;
  /** The tenant's word for a group of animals. */
  word: string;
}) {
  const lower = word.toLowerCase();
  const closedHref = showClosed ? base : `${base}?closed=1`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={base} className="flex items-center gap-2">
        {/* The toggle survives a search and the search survives the toggle —
            two filters that reset each other are one filter with extra steps. */}
        {showClosed && <input type="hidden" name="closed" value="1" />}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={search}
            placeholder={`Find a ${lower} or a name`}
            aria-label={`Find a ${lower}`}
            className="w-56 pl-8"
          />
        </div>
        <Button type="submit" variant="outline" size="sm">
          Find
        </Button>
        {search && (
          <Button asChild variant="ghost" size="sm">
            <Link href={showClosed ? `${base}?closed=1` : base}>
              <X className="h-4 w-4" />
              Clear
            </Link>
          </Button>
        )}
      </form>

      <Button asChild variant={showClosed ? "default" : "outline"} size="sm">
        <Link
          href={
            search
              ? `${closedHref}${showClosed ? "?" : "&"}q=${encodeURIComponent(search)}`
              : closedHref
          }
        >
          {showClosed ? "Hiding nothing" : "Show closed"}
        </Link>
      </Button>

      {/* **WHAT IT LEFT OUT, SAID OUT LOUD.** A list that quietly stops is one
          somebody trusts to be complete. */}
      {matched > shown && (
        <span className="text-xs text-muted-foreground">
          Showing {shown} of {matched} — narrow it to see the rest
        </span>
      )}
    </div>
  );
}
