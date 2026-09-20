"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useIsDenied } from "@/components/app/access-provider";

export interface FilterPill {
  /** Matched against `activeKey`. */
  key: string;
  label: string;
  href: string;
  /** Omitted or 0 renders nothing — a zero count is noise, as in the sidebar. */
  count?: number;
}

interface FilterPillsProps {
  items: readonly FilterPill[];
  activeKey: string;
  /**
   * `solid` (default) is a filter: which subset of this list am I seeing.
   * `accent` is a sub-navigation: which list am I on.
   *
   * The two exist because accounting renders both on one row — Invoices /
   * Customers / Recurring beside Open / Drafts / Paid — and two identical pill
   * groups side by side would read as one confusing eight-item control.
   */
  variant?: "solid" | "accent";
  className?: string;
}

/**
 * Which subset of a list you are looking at.
 *
 * Links, not buttons: every filter in the product is already a `?f=` search
 * param, so each pill is a real navigable URL that survives a refresh and can
 * be shared. Nothing here needs JavaScript to NAVIGATE.
 *
 * **IT IS A CLIENT COMPONENT ANYWAY, AND HAS BEEN SINCE #626 — WHICH IS WHAT
 * TOOK PRODUCTION DOWN ON 2026-09-19.** This file said "and therefore a server
 * component" for a day after `useIsDenied()` was added to it, and a hook cannot
 * be called from a server module: every page that rendered pills WITHOUT being
 * a client component itself threw *"Attempted to call useIsDenied() from the
 * server"*. That was nine screens, `/dashboard/m/jobs` among them. The four
 * callers that happened to be client components carried on working, which is
 * why the accounting sub-navigation the change was driven on looked fine.
 *
 * So the directive above is load-bearing, and removing it does not make this a
 * server component again — it makes nine screens 500. Drop the hook first if the
 * cost of the boundary ever matters; the props are all serialisable either way.
 *
 * These replace a row of underlined tabs. The distinction is worth keeping
 * straight, because the two were doing the same job in different shapes on the
 * same page: a `CategoryStrip` moves you between *sections* of a module, pills
 * narrow the *rows* of the list you are already on. Underline for navigation,
 * fill for filtering.
 */
export function FilterPills({
  items: allItems,
  activeKey,
  variant = "solid",
  className,
}: FilterPillsProps) {
  /**
   * A PILL ONTO A PAGE THIS PERSON MAY NOT OPEN IS NOT DRAWN (ADR 0095).
   *
   * `accent` pills are sub-navigation — Invoices / Customers / Reminders in
   * accounting's Sales — so they are exactly as much a menu as the strip above
   * them, and leaving one in place while its page refuses is the failure that
   * makes a permission screen worthless.
   *
   * Applied to `solid` filters too, and harmlessly: a filter's href is the page
   * you are already on with a query on the end, so it is never denied. Testing
   * the variant would be a second rule to keep in step with the first.
   *
   * **NEVER THE ONE YOU ARE ON**, the rule the rail and the strip both keep: a
   * link from an email must not leave somebody on a page with no way back. It
   * cannot leak, because the page has already refused or allowed the request
   * server-side by the time a pill renders.
   */
  const isDenied = useIsDenied();
  const items = allItems.filter(
    (item) => item.key === activeKey || !isDenied(item.href.split("?")[0]),
  );
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? variant === "accent"
                  ? "bg-module-accent/12 text-module-accent"
                  : "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {item.label}
            {item.count !== undefined && item.count > 0 && (
              <span
                className={cn(
                  "tabular-nums",
                  active
                    ? variant === "accent"
                      ? "opacity-70"
                      : "text-background/70"
                    : "text-subtle-foreground",
                )}
              >
                {item.count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
