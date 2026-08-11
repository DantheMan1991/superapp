"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  /**
   * Rendered to the right of the sections, on the same hairline and outside the
   * scroller. For a control that belongs to the whole module rather than to one
   * section — Documents puts its search box here.
   */
  trailing?: ReactNode;
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
export function CategoryStrip({
  items,
  trailing,
  className,
}: CategoryStripProps) {
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
   * A plain ref object, and the first measurement in an effect.
   *
   * This was first written as a ref *callback* that both stored the element and
   * returned its own cleanup, to avoid an effect entirely. It measured
   * correctly and the buttons rendered — but `scroller.current` was null by the
   * time one was clicked, so they silently did nothing. Verified in the browser:
   * scrolling the element by hand moved it 200px, clicking the button moved it 0.
   * A plain ref object has none of that subtlety; React assigns it at commit and
   * leaves it alone until unmount.
   *
   * The effect satisfies `react-hooks/set-state-in-effect` the way
   * conventions.md §8 prescribes — the state change is *scheduled* rather than
   * called synchronously in the effect body.
   *
   * `setTimeout`, not `requestAnimationFrame`, and that distinction is not
   * cosmetic: rAF is paused in a background tab, so a strip rendered in one
   * never measured and its buttons never appeared until something else forced a
   * resize. Timers still fire when backgrounded. Found while testing this in an
   * unfocused window, which is exactly the condition that would have hidden it.
   */
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => measure(el);
    // A native listener rather than React's `onScroll` prop. `scroll` does not
    // bubble, so it is not delegated like most events, and a programmatic
    // `scrollBy` was reaching the DOM without the edge state ever updating —
    // the buttons stayed on the side you had already scrolled away from.
    // Listening on the element directly removes the question entirely.
    el.addEventListener("scroll", onScroll, { passive: true });
    const timer = setTimeout(() => measure(el), 0);
    const observer = new ResizeObserver(onScroll);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [measure]);

  const nudge = (direction: -1 | 1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    // The hairline lives on the WRAPPER, not the scroller, so that it runs the
    // full width including anything in `trailing`. The active item still sits on
    // it: the item's bottom edge coincides with the wrapper's content edge, so
    // `-mb-px` pulls its 2px underline down over the hairline.
    <div
      className={cn(
        "relative flex items-end gap-4 border-b border-divider",
        className,
      )}
    >
      <div
        ref={scroller}
        className="flex min-w-0 flex-1 gap-7 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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

      {/* Sits beside the sections on the same hairline — Documents puts its
          search box here so search stays reachable from every page in the
          cabinet, which is deliberate (see its dossier). Outside the scroller,
          so it never scrolls out of reach. */}
      {trailing && <div className="shrink-0 pb-2">{trailing}</div>}

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
