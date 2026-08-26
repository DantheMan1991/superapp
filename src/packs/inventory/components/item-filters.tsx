"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterPills } from "@/components/app/filter-pills";
import { slugLabel } from "../vocabulary";

export interface KindInUse {
  kind: string;
  count: number;
}

export interface EnterpriseInUse {
  id: string;
  name: string;
  count: number;
}

/** The pill key for "belongs to no line of business". */
const UNTAGGED = "none";

/**
 * Narrow the list: by kind, by name, and whether retired things show.
 *
 * **THE READ LAYER FOR THIS SHIPPED IN SLICE 0 AND THE CONTROL NEVER DID.**
 * `listItems` has taken a `kind` filter since the first commit, the page has
 * read `?kind=` and `?archived=1` since the first commit, and
 * `listKindsInUse` — which runs on every page load — carries the doc comment
 * *"for the filter bar"*. Its result went to the add-item form as autocomplete
 * suggestions and nowhere else. This is the bar it was written for.
 *
 * **THE FILTER LIVES IN THE URL, NOT IN STATE.** The list is server-rendered
 * from it, so a filtered view is a link somebody can bookmark, send, or come
 * back to with the back button — and a client-side filter over a list the
 * server already narrowed would be two filters disagreeing about the same page.
 *
 * **THE KIND CHIPS ARE LINKS AND THE SEARCH IS A FORM**, which is the split
 * between a closed choice and an open one. A tap is one round trip; typing is
 * not, so the box submits on Enter or on the button rather than on every
 * keystroke. A farm holds forty items — this does not need to be clever.
 */
export function ItemFilters({
  base,
  kinds,
  activeKind,
  enterprises,
  untaggedCount,
  activeEnterprise,
  enterpriseWord,
  search,
  showArchived,
  shown,
  itemWord,
}: {
  /** The list route, so this component invents no URLs of its own. */
  base: string;
  /** Kinds this tenant actually holds, with counts. Never a global taxonomy. */
  kinds: KindInUse[];
  activeKind?: string;
  /** Active lines of business with their item counts. Empty hides the row. */
  enterprises: EnterpriseInUse[];
  /** How many items belong to none — the "what have I not done yet" pill. */
  untaggedCount: number;
  activeEnterprise?: string;
  /** What the installed profile calls one. Never hard-coded here. */
  enterpriseWord: string;
  search: string;
  showArchived: boolean;
  /** How many rows the current filter produced, for the summary line. */
  shown: number;
  /** "Item" or whatever the installed profile calls one. */
  itemWord: string;
}) {
  const router = useRouter();

  /** Every link on this bar keeps the other two choices. */
  function urlWith(change: {
    kind?: string | null;
    enterprise?: string | null;
    q?: string | null;
    archived?: boolean;
  }): string {
    const params = new URLSearchParams();
    const kind = change.kind === undefined ? activeKind : change.kind;
    const ent =
      change.enterprise === undefined ? activeEnterprise : change.enterprise;
    const q = change.q === undefined ? search : change.q;
    const archived =
      change.archived === undefined ? showArchived : change.archived;
    if (kind) params.set("kind", kind);
    if (ent) params.set("enterprise", ent);
    if (q) params.set("q", q);
    if (archived) params.set("archived", "1");
    const query = params.toString();
    return query ? `${base}?${query}` : base;
  }

  /** One path for the button and the key, so the two cannot diverge. */
  function submit(form: HTMLFormElement) {
    const typed = String(new FormData(form).get("q") ?? "").trim();
    router.push(urlWith({ q: typed || null }));
  }

  const filtering =
    Boolean(activeKind) ||
    Boolean(activeEnterprise) ||
    Boolean(search) ||
    showArchived;
  /**
   * **HIDDEN UNTIL THERE IS SOMETHING TO PICK.** A business with no list, or one
   * that has built a list and tagged nothing, gets no row — a pill group where
   * every count is zero is furniture that teaches people to ignore the bar.
   */
  const showEnterprises =
    enterprises.length > 0 && enterprises.some((e) => e.count > 0);

  return (
    <div className="space-y-3">
      {/**
        * **`FilterPills` RATHER THAN A HAND-ROLLED CHIP, and the first version
        * of this file should have used it.** It already existed, already
        * rendered links with counts and an active key, and already carried the
        * house decision that a filter is a fill and navigation is an underline.
        * A second implementation beside it was two components drifting apart
        * for no reason.
        */}
      <FilterPills
        activeKey={activeKind ?? ""}
        items={[
          // ALL IS A PILL, not the absence of one. A bar whose unfiltered state
          // has nothing selected gives somebody no way to see that they ARE
          // filtered except by noticing what is missing.
          { key: "", label: "All", href: urlWith({ kind: null }) },
          ...kinds.map((k) => ({
            key: k.kind,
            label: slugLabel(k.kind),
            href: urlWith({ kind: k.kind }),
            // Free — `listKindsInUse` already groups — and it turns "is there
            // anything under Medicine" into a question the bar has answered.
            count: k.count,
          })),
        ]}
      />

      {showEnterprises && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {enterpriseWord}
          </span>
          <FilterPills
            activeKey={activeEnterprise ?? ""}
            items={[
              { key: "", label: "All", href: urlWith({ enterprise: null }) },
              ...enterprises.map((e) => ({
                key: e.id,
                label: e.name,
                href: urlWith({ enterprise: e.id }),
                count: e.count,
              })),
              /**
               * **"NOT SET" IS A FILTER SOMEBODY NEEDS, not a gap in the list.**
               * The question after tagging anything is *what have I not tagged
               * yet*, and it is unaskable without this pill. Hidden when there
               * is nothing untagged, because then it answers nothing.
               */
              ...(untaggedCount > 0
                ? [
                    {
                      key: UNTAGGED,
                      label: "Not set",
                      href: urlWith({ enterprise: UNTAGGED }),
                      count: untaggedCount,
                    },
                  ]
                : []),
            ]}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/**
          * **UNCONTROLLED, AND KEYED ON THE SEARCH ITSELF.** The box has to
          * re-sync when the URL changes under it — "Clear filters", a kind chip,
          * the back button — and a box still reading "broiler" over an
          * unfiltered list is a screen lying about what it is showing. `key`
          * remounts it with the new `defaultValue`, which is React's own answer
          * to resetting state on a prop change and needs neither an effect nor
          * a second copy of the term in state.
          */}
        <form
          key={search}
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(e.currentTarget);
          }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              defaultValue={search}
              /**
               * **ENTER IS HANDLED, NOT ASSUMED.** A form with one text field
               * and a submit button submits on Enter by default in most
               * browsers — "most" being the problem. This is a box somebody
               * uses one-handed at a stall, and a search that silently ignores
               * the key you just pressed reads as a broken app rather than as a
               * browser default not firing.
               *
               * No article in the label, deliberately: `itemWord` comes from
               * the installed profile, so "a {word}" is a grammar bug waiting
               * for a profile whose word starts with a vowel. It produced
               * "Find a item by name" on the farm profile.
               */
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (e.currentTarget.form) submit(e.currentTarget.form);
              }}
              placeholder="Find by name"
              aria-label={`Find by name among the ${itemWord.toLowerCase()}s this business holds`}
              className="h-9 w-56 pl-8"
              maxLength={200}
            />
          </div>
          <Button type="submit" variant="outline" size="sm">
            Find
          </Button>
        </form>

        {/* A LINK RATHER THAN A SWITCH, so it round-trips like the chips and
            costs no extra state. Retired things are hidden by default because
            they are the rare case. */}
        <Button asChild variant="ghost" size="sm">
          <Link href={urlWith({ archived: !showArchived })}>
            {showArchived ? "Hide retired" : "Show retired"}
          </Link>
        </Button>

        {filtering && (
          <>
            <span className="text-xs text-muted-foreground tabular-nums">
              {shown} {shown === 1 ? "row" : "rows"}
            </span>
            <Button asChild variant="ghost" size="sm">
              <Link href={base}>
                <X className="mr-1 h-3.5 w-3.5" />
                Clear filters
              </Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
