"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RAIL_CONTEXT_COOKIE, type RailContext } from "@/lib/packs/rail-context";

const EVERYTHING = "__all__";

/**
 * WHICH SIDE OF THE BUSINESS THE RAIL IS SHOWING (ADR 0090).
 *
 * A builder who also farms had seven farm rows in the rail all day. This puts
 * the ones that side does not use away — and **that is all it does**. Nothing
 * is scoped, nothing is filtered, every page still opens by its URL, and
 * accounting's own company picker is untouched, because a link to a list has to
 * mean the same thing to everybody who opens it.
 *
 * **A COOKIE, NOT `localStorage`**, for the reason the documents browser gives
 * for its own view mode: the rail is rendered on the SERVER, so the preference
 * has to be readable there or the first paint shows every row and then drops
 * half of them. Same weight as that one — a display preference, readable by
 * script, `Lax`, scoped to the app.
 *
 * It renders nothing below two industries. One side of the business is not a
 * choice, and `railContexts` returns an empty list rather than making the
 * single-industry client learn the idea exists.
 */
export function RailContextSwitcher({
  contexts,
  active,
}: {
  contexts: RailContext[];
  active: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  if (contexts.length < 2) return null;

  function choose(value: string) {
    const slug = value === EVERYTHING ? "" : value;
    // A year, and cleared by writing an empty value rather than by deleting a
    // key somebody else may own.
    document.cookie = `${RAIL_CONTEXT_COOKIE}=${encodeURIComponent(slug)}; path=/; max-age=31536000; SameSite=Lax`;
    // The rail is server-rendered, so the new choice arrives with the refresh.
    startTransition(() => router.refresh());
  }

  const current = contexts.find((c) => c.slug === active);

  return (
    <div className="px-3 pb-3">
      <p className="px-2.5 pb-1 text-[11px] font-medium text-sidebar-foreground/45">
        Working on
      </p>
      <Select value={active ?? EVERYTHING} onValueChange={choose}>
        <SelectTrigger
          aria-label="Which side of the business the menu shows"
          className="h-9 w-full border-0 bg-sidebar-accent/70 text-sidebar-foreground hover:bg-sidebar-accent [&_svg]:text-sidebar-foreground/60"
        >
          <SelectValue>{current ? current.label : "Everything"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={EVERYTHING}>
            <span className="flex flex-col items-start">
              <span>Everything</span>
              <span className="text-xs text-muted-foreground">Every tool you have</span>
            </span>
          </SelectItem>
          {contexts.map((c) => (
            <SelectItem key={c.slug} value={c.slug}>
              <span className="flex flex-col items-start">
                <span>{c.label}</span>
                {/* The companies, so the industry word is grounded in a name
                    somebody recognises — without the control calling itself a
                    company picker, which is what accounting's already is. */}
                <span className="text-xs text-muted-foreground">{c.companies.join(", ")}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
