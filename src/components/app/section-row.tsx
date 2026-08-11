import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionRowProps {
  title: string;
  description?: ReactNode;
  /** Renders the arrow affordance beside the heading and links the whole title. */
  href?: string;
  children: ReactNode;
  /**
   * Lays the children out as a horizontal scroller instead of wrapping them.
   * Use for a "recent" strip; leave off for a grid that should reflow.
   */
  scroll?: boolean;
  className?: string;
}

/**
 * A titled band of content on a hub page.
 *
 * The heading is 20px rather than the page title's 24px, and the arrow is part
 * of the heading rather than a "See all" link parked on the right — both taken
 * from Airbnb, where the effect is that a long page reads as a stack of shelves
 * instead of a stack of cards.
 *
 * The scrolling variant uses scroll snap and no chevron buttons. On a trackpad
 * or a phone the gesture is enough; `CategoryStrip` has buttons because
 * navigation must be reachable without a horizontal-scroll gesture, and this is
 * content, not navigation.
 */
export function SectionRow({
  title,
  description,
  href,
  children,
  scroll = false,
  className,
}: SectionRowProps) {
  const heading = (
    <span className="inline-flex items-center gap-2">
      <span className="font-heading text-xl font-semibold tracking-heading">
        {title}
      </span>
      {href && (
        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover/section:bg-secondary group-hover/section:text-foreground">
          <ArrowRight className="size-3.5" />
        </span>
      )}
    </span>
  );

  return (
    <section className={cn("group/section", className)}>
      <div className="mb-3">
        {href ? (
          <Link
            href={href}
            className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {heading}
          </Link>
        ) : (
          heading
        )}
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {scroll ? (
        <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 [&>*]:w-44 [&>*]:shrink-0 [&>*]:snap-start">
          {children}
        </div>
      ) : (
        children
      )}
    </section>
  );
}
