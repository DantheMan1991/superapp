import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PanelProps {
  children: ReactNode;
  /** Rendered in place of `children`. Pass an `<EmptyState>`. */
  empty?: ReactNode;
  /** When true, `empty` is rendered instead of the children. */
  isEmpty?: boolean;
  className?: string;
}

/**
 * The lifted surface a list of things sits on.
 *
 * One card, no border: `--elevation-1` opens with a 1px ring of its own, so
 * adding a border on top of it draws the boundary twice. This replaces the
 * `<Card><CardContent className="p-0">` pairing that every list page used, which
 * also carried `ring-1 ring-foreground/10` and a hard line at each edge.
 *
 * `DataTable` is this plus the styling a `<table>` inside it needs. Reach for
 * `Panel` when the content is a `<ul>` or a stack of rows, and `DataTable` when
 * it is a real table — the difference is only whether those extra selectors have
 * anything to match.
 *
 * A divided list supplies its own `divide-y divide-divider`: `--divider`, not
 * `--border`, because these hairlines sit *inside* the panel.
 */
export function Panel({ children, empty, isEmpty = false, className }: PanelProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl bg-card shadow-elevation-1",
        className,
      )}
    >
      {isEmpty && empty ? empty : children}
    </div>
  );
}
