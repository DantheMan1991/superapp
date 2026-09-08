"use client";

import Link from "next/link";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterPills } from "@/components/app/filter-pills";

/**
 * Narrow the lot list: by name, tag or species, and whether closed ones show.
 *
 * **THE FILTER LIVES IN THE URL, NOT IN STATE**, matching `inventory`'s item
 * filters exactly. The list is server-rendered from it, so a filtered view is a
 * link somebody can bookmark or come back to with the back button — and a
 * client-side filter over a list the server already narrowed would be two
 * filters disagreeing about one page.
 *
 * **THE SEARCH IS A FORM AND THE TOGGLES ARE LINKS**, which is the split
 * between an open question and a closed one. Typing is not one round trip, so
 * the box submits on Enter or the button rather than on every keystroke.
 *
 * **EVERY HREF CARRIES THE OTHER TWO FILTERS.** The search survives a species
 * pill, the pill survives a search, and both survive the closed toggle — three
 * filters that reset each other are one filter with extra steps. `href` is the
 * one place a URL is built, so that stays true when a fourth arrives.
 *
 * **THE SERVER FILTERS BEFORE IT DOES THE EXPENSIVE READS**, so this narrows
 * the work and not only the render — see `LivestockModule`'s two phases.
 */
export function LotFilters({
  base,
  search,
  showClosed,
  species,
  speciesPills,
  shown,
  matched,
  word,
}: {
  /** The list route, so this component invents no URLs of its own. */
  base: string;
  search: string;
  showClosed: boolean;
  /** The species slug in force, or empty for all of them. */
  species: string;
  /**
   * Every species on the farm, resolved to words on the server. Two or more
   * earn a row of pills; one species is not a choice and gets none.
   */
  speciesPills: { key: string; label: string }[];
  /** How many rows are on the page. */
  shown: number;
  /** How many matched before the cap. */
  matched: number;
  /** The tenant's word for a group of animals. */
  word: string;
}) {
  const lower = word.toLowerCase();

  const href = (overrides: { q?: string; closed?: boolean; species?: string }) => {
    const params = new URLSearchParams();
    const q = overrides.q ?? search;
    const closed = overrides.closed ?? showClosed;
    const sp = overrides.species ?? species;
    if (q) params.set("q", q);
    if (closed) params.set("closed", "1");
    if (sp) params.set("species", sp);
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  };

  return (
    <div className="space-y-2">
      <form action={base} className="flex flex-wrap items-center gap-2">
        {showClosed && <input type="hidden" name="closed" value="1" />}
        {species && <input type="hidden" name="species" value={species} />}
        {/* The box takes the phone's whole row and a fixed width on a desk:
            a 224px box beside its button was the widest thing that fitted a
            375px screen, and a tag number is the thing typed here with cold
            fingers. */}
        <div className="relative min-w-0 flex-1 sm:flex-none">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={search}
            placeholder={`Find a ${lower}, an animal or a tag`}
            aria-label={`Find a ${lower}`}
            className="w-full pl-8 sm:w-64"
          />
        </div>
        <Button type="submit" variant="outline" size="sm">
          Find
        </Button>
        {search && (
          <Button asChild variant="ghost" size="sm">
            <Link href={href({ q: "" })}>
              <X className="h-4 w-4" />
              Clear
            </Link>
          </Button>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-2">
        {/* `?species=` was read by the page since slice 0 and reachable from
            nowhere. Pills, because "which subset of this list" is what pills
            are for; links, because the filter is a URL. */}
        {speciesPills.length > 1 && (
          <FilterPills
            activeKey={species || "all"}
            items={[
              { key: "all", label: "All", href: href({ species: "" }) },
              ...speciesPills.map((pill) => ({
                key: pill.key,
                label: pill.label,
                href: href({ species: pill.key }),
              })),
            ]}
          />
        )}

        <Button asChild variant={showClosed ? "default" : "outline"} size="sm">
          <Link href={href({ closed: !showClosed })}>
            {showClosed ? "Hiding nothing" : "Show closed"}
          </Link>
        </Button>

        {/* **WHAT IT LEFT OUT, SAID OUT LOUD.** A list that quietly stops is
            one somebody trusts to be complete. */}
        {matched > shown && (
          <span className="text-xs text-muted-foreground">
            Showing {shown} of {matched} — narrow it to see the rest
          </span>
        )}
      </div>
    </div>
  );
}
