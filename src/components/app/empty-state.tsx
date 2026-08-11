import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Names the space rather than apologising for it: "Start your first invoice". */
  title: string;
  description?: ReactNode;
  /** A glyph, rendered in an accent-tinted circle. */
  icon?: ReactNode;
  /** One action. Two competing calls to action in an empty state is a menu. */
  action?: ReactNode;
  /**
   * Wraps itself in a card. Off by default because most call sites are already
   * inside one — `DataTable` renders its own empty state bare, inside the panel
   * the table would have filled.
   */
  panel?: boolean;
  className?: string;
}

/**
 * What a surface says when it has nothing to show.
 *
 * Replaces roughly 49 hand-rolled variants, most of them a bare
 * `<p className="text-center text-sm text-muted-foreground">No X here yet.</p>`.
 * The copy rule matters as much as the markup: a title that names what the
 * space is for, one sentence explaining it, one action. "Nothing here yet" is
 * a dead end and is not what this renders.
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  panel = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center px-6 py-12 text-center",
        panel && "rounded-2xl bg-card shadow-elevation-1",
        className,
      )}
    >
      {icon && (
        <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-module-accent/10 text-module-accent [&_svg]:size-5">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
