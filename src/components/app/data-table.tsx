import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DataTableProps {
  /** The caller's own `<Table>` from `components/ui/table`, unchanged. */
  children: ReactNode;
  /** Rendered in place of `children`. Pass an `<EmptyState>`. */
  empty?: ReactNode;
  /** When true, `empty` is rendered instead of the table. */
  isEmpty?: boolean;
  /**
   * Keeps the header row visible while the body scrolls. Off by default: it
   * only helps on a genuinely long list, and it interacts badly with a page
   * that is already scrolling inside a short container.
   */
  stickyHeader?: boolean;
  className?: string;
}

/**
 * The panel a list of rows sits in.
 *
 * Deliberately a *container* rather than a column-configured table component.
 * Every list in the product already builds its own `<Table>` markup by hand,
 * and there are around sixty of them; a column-config API would mean rewriting
 * the body of each one, whereas this restyles them from the outside. The sweep
 * is therefore "swap the `<Card><CardContent className='p-0'>` wrapper for
 * `<DataTable>`" and nothing inside it changes.
 *
 * That is why the styling is a wall of descendant selectors. `ui/table` renders
 * real `thead`/`tbody`/`tr`/`th`/`td` elements, so those are what we reach for —
 * more legible and less brittle than chaining `data-slot` attributes, and it
 * means a caller who adds a row later gets the styling for free.
 *
 * Two things it changes versus the old `Card`-wrapped table:
 *
 * - Rows are separated by `--divider`, not `--border`. A table's internal
 *   hairlines used to carry the same weight as the panel edge around them,
 *   which is most of why dense lists read as heavy.
 * - The panel is lifted (`--elevation-1`) instead of outlined
 *   (`ring-1 ring-foreground/10`). Same job, no hard line at the boundary.
 */
export function DataTable({
  children,
  empty,
  isEmpty = false,
  stickyHeader = false,
  className,
}: DataTableProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl bg-card shadow-elevation-1",
        className,
      )}
    >
      {isEmpty && empty ? (
        empty
      ) : (
        <div
          className={cn(
            "w-full overflow-x-auto",
            // Header: quieter and shorter than the body it labels.
            "[&_thead_th]:h-9 [&_thead_th]:px-3 [&_thead_th]:text-xs [&_thead_th]:font-medium [&_thead_th]:text-subtle-foreground",
            "[&_thead_tr]:border-divider",
            // Body rows.
            "[&_tbody_tr]:border-divider [&_tbody_tr]:transition-colors",
            "[&_tbody_tr:last-child]:border-0",
            "[&_tbody_tr:hover]:bg-muted/60",
            "[&_td]:px-3 [&_td]:py-2.5",
            // Money and dates line up column-wise without each call site
            // remembering to ask for it.
            "[&_td.tabular-nums]:tabular-nums",
            // Row actions stay hidden until the row is hovered or a control
            // inside it is focused — Notion's pattern. Focus-within is what
            // keeps it reachable by keyboard.
            "[&_[data-slot=row-actions]]:opacity-0 [&_[data-slot=row-actions]]:transition-opacity",
            "[&_tbody_tr:hover_[data-slot=row-actions]]:opacity-100",
            "[&_[data-slot=row-actions]:focus-within]:opacity-100",
            stickyHeader &&
              "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-card",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Wrap a row's trailing controls in this to get the hover-reveal behaviour.
 * A plain `<div>` with the attribute would work; this exists so call sites read
 * as intent rather than as a magic string.
 */
export function RowActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="row-actions"
      className={cn("flex items-center justify-end gap-1", className)}
    >
      {children}
    </div>
  );
}
