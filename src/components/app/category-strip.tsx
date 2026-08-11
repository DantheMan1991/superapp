"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CategoryItem {
  href: string;
  label: string;
  icon?: LucideIcon;
  /** Highlight only on an exact path match, for a module's index route. */
  exact?: boolean;
}

interface CategoryStripProps {
  items: readonly CategoryItem[];
  className?: string;
}

/**
 * A module's sections, as one horizontal band.
 *
 * This replaces the wrapping tab rows the modules grew. Accounting was the
 * worst case: its ten tabs wrapped onto two lines, and a page inside Sales then
 * rendered a *second* row beneath it and a filter row beneath that, so three
 * rows of navigation stood between the page title and the first invoice.
 *
 * The fix is Airbnb's category strip, which solves exactly this problem on
 * their search page: one row, never wrapping, scrolling sideways when it
 * overflows, with an icon above each label so the row stays scannable at a
 * glance rather than reading as a wall of words. The active item takes the
 * module's own accent, so the colour tells you where you are as well.
 *
 * Buttons, not just a scroll gesture, because this is navigation — it has to be
 * reachable on a trackpad-less desktop. They appear only on the side that has
 * something left to reveal.
 */
export function CategoryStrip({ items, className }: CategoryStripProps) {
  const pathname = usePathname();
  const scroller = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback((el: HTMLDivElement) => {
    // 4px of slack: sub-pixel layout means scrollLeft rarely reaches an exact 0
    // or an exact scrollWidth - clientWidth, which would leave a button showing
    // with nothing left to scroll to.
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdges((prev) =>
      prev.left === left && prev.right === right ? prev : { left, right },
    );
  }, []);

  /**
   * Measured from a ref callback rather than an effect. As an effect this would
   * be a `setState` on mount, which is what `react-hooks/set-state-in-effect`
   * flags — and it would also measure a frame later than it needs to. React 19
   * lets a ref callback return its own cleanup, so the observer is torn down
   * here too. `useCallback` is load-bearing: an inline function would be a new
   * ref every render, and React would detach, re-attach and re-measure in a
   * loop.
   */
  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      scroller.current = el;
      if (!el) return;
      measure(el);
      const observer = new ResizeObserver(() => measure(el));
      observer.observe(el);
      return () => {
        observer.disconnect();
        scroller.current = null;
      };
    },
    [measure],
  );

  const nudge = (direction: -1 | 1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <div className={cn("relative", className)}>
      <div
        ref={attach}
        onScroll={(event) => measure(event.currentTarget)}
        className="flex gap-7 overflow-x-auto border-b border-divider [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px flex shrink-0 flex-col items-center gap-1 border-b-2 pb-2 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                active
                  ? "border-module-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {Icon && <Icon className="size-[18px]" />}
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* Overlaid on the strip's own edges, with a fade so labels slide under
          the button rather than colliding with it. */}
      {edges.left && (
        <StripButton side="left" onClick={() => nudge(-1)} />
      )}
      {edges.right && (
        <StripButton side="right" onClick={() => nudge(1)} />
      )}
    </div>
  );
}

function StripButton({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-0 bottom-px flex items-center",
        side === "left"
          ? "left-0 bg-gradient-to-r pr-6"
          : "right-0 bg-gradient-to-l pl-6",
        "from-background via-background to-transparent",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={side === "left" ? "Scroll left" : "Scroll right"}
        className="pointer-events-auto flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Icon className="size-4" />
      </button>
    </div>
  );
}
