import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  /**
   * The line under the title. Takes a node, not a string, because most callers
   * put a live figure in it — "$12,480 outstanding · $2,140 overdue" — and the
   * overdue half needs its own colour.
   */
  description?: ReactNode;
  /** Right-aligned. Primary action last, so it sits nearest the content. */
  actions?: ReactNode;
  /**
   * A glyph on an accent chip, left of the title. Reads as the module's mark:
   * the chip is tinted with `--module-accent`, which the module's route sets,
   * so this component never learns which module it is inside.
   */
  icon?: ReactNode;
  className?: string;
}

/**
 * The one page title in the product.
 *
 * `text-2xl font-semibold tracking-tight` was hand-written in 73 files before
 * this existed, which is why headings had quietly drifted apart — some pages
 * carried a description, some did not, the gap above the actions row varied,
 * and two of them used a different size. Nothing here is novel; it is the same
 * heading, in one place.
 *
 * `tracking-heading` rather than Tailwind's `tracking-tight`: -0.02em, matching
 * the optical tightness Airbnb sets on its section headings, where
 * `tracking-tight` at this size is slightly too loose.
 */
export function PageHeader({
  title,
  description,
  actions,
  icon,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-module-accent/10 text-module-accent [&_svg]:size-5">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold tracking-heading">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
