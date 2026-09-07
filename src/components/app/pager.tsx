import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { PageWindow } from "@/lib/list-query";

/**
 * "Showing 51–100 of 312 invoices", with Newer and Older.
 *
 * Renders nothing while the whole list fits on one page — a pager on a
 * twelve-row list is a control with nothing to do. The words are Newer and
 * Older rather than Previous and Next because the lists this sits under are
 * newest-first, and "next page" of a newest-first list is a direction only a
 * programmer finds obvious. A list in name order passes `labels` — Newer
 * means nothing on an alphabet.
 *
 * Links, not buttons, for the same reason the filter pills are links: a page
 * is a URL that survives a refresh and can be sent. `hrefFor` is the page's
 * own URL builder, which keeps the search term, the scope and the filter the
 * reader already chose.
 */
export function Pager({
  window: w,
  noun,
  hrefFor,
  labels = { prev: "Newer", next: "Older" },
}: {
  window: PageWindow;
  /** "invoice" / "invoices". */
  noun: { one: string; many: string };
  hrefFor: (page: number) => string;
  /** The two links' words. The default suits a newest-first list. */
  labels?: { prev: string; next: string };
}) {
  if (w.total <= w.pageSize && w.page === 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground print:hidden">
      <p>
        Showing <span className="tabular-nums">{w.from}–{w.to}</span> of{" "}
        <span className="tabular-nums">{w.total}</span>{" "}
        {w.total === 1 ? noun.one : noun.many}
      </p>
      <div className="flex gap-2">
        {w.hasPrev ? (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefFor(w.page - 1)}>{labels.prev}</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            {labels.prev}
          </Button>
        )}
        {w.hasNext ? (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefFor(w.page + 1)}>{labels.next}</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            {labels.next}
          </Button>
        )}
      </div>
    </div>
  );
}
