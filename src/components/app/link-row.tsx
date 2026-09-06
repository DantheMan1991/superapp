"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * A table row that opens a record when clicked anywhere on it.
 *
 * The lists had exactly one link per row — the number, or the vendor's name —
 * and on a phone that is a target sixty pixels wide in a row that is the whole
 * screen. The row is now the target. The real `<Link>` stays inside it for
 * the keyboard, middle-click and the right-click menu, which a click handler
 * cannot give; this only adds the surface around it.
 *
 * Three things a click on a row must NOT do, each checked in order:
 *
 * - Open the record when a control in the row was what got clicked — a
 *   button that records a payment, the number's own link, a checkbox. Any
 *   ancestor that is a control keeps the click.
 * - Open the record when the click came from something PORTALLED out of the
 *   row: a dialog a row button opened, the select list inside that dialog. Those
 *   bubble through React's tree to this handler but are not inside the row's
 *   DOM, so `currentTarget.contains(target)` is the test that tells them apart.
 * - Open the record on the mouse-up that ends a text selection, which fires
 *   `click` too. A non-empty selection means the reader was reading, not
 *   navigating.
 */
export function LinkRow({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();

  function onClick(event: MouseEvent<HTMLTableRowElement>) {
    const target = event.target as HTMLElement;
    if (!event.currentTarget.contains(target)) return;
    if (target.closest("a, button, input, select, textarea, label, [role=combobox]")) return;
    if (window.getSelection()?.toString()) return;
    // A modified click means "in a new tab", which a handler cannot honour;
    // leaving it alone is better than opening the record here instead.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    router.push(href);
  }

  return (
    <TableRow onClick={onClick} className={cn("cursor-pointer", className)}>
      {children}
    </TableRow>
  );
}
