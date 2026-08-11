import Link from "next/link";
import { cn } from "@/lib/utils";

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
 * Links, not buttons, and therefore a server component: every filter in the
 * product is already a `?f=` search param, so each pill is a real navigable URL
 * that survives a refresh and can be shared. Nothing here needs JavaScript.
 *
 * These replace a row of underlined tabs. The distinction is worth keeping
 * straight, because the two were doing the same job in different shapes on the
 * same page: a `CategoryStrip` moves you between *sections* of a module, pills
 * narrow the *rows* of the list you are already on. Underline for navigation,
 * fill for filtering.
 */
export function FilterPills({
  items,
  activeKey,
  variant = "solid",
  className,
}: FilterPillsProps) {
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
