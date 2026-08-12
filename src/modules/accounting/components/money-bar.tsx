import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatCentsSigned } from "../lib/money";

/**
 * The MoneyBar: four questions about a ledger, each with a figure and each
 * clickable.
 *
 * Server component — every bucket is a link, so there is nothing to hydrate.
 * That also means the active bucket survives a reload and can be sent to
 * somebody, which a client-side filter would not.
 *
 * A bucket showing zero is still rendered rather than hidden. "Nothing is
 * overdue" is an answer somebody wants, and a bar whose columns move around as
 * the numbers change is one nobody learns the shape of.
 */

export interface MoneyBucketTile {
  key: string;
  label: string;
  cents: number;
  count: number;
  href: string;
  /** Drawn in the alarming colour. Only the genuinely alarming one is. */
  alarm?: boolean;
}

export function MoneyBar({
  buckets,
  activeKey,
  clearHref,
  noun,
}: {
  buckets: MoneyBucketTile[];
  activeKey: string | null;
  /** Where "showing X — show all" points. */
  clearHref: string;
  /** Singular; the bar is shared by the invoice and bill lists. */
  noun: string;
}) {
  return (
    <div className="space-y-2 print:hidden">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {buckets.map((b) => {
          const active = b.key === activeKey;
          return (
            <Link
              key={b.key}
              href={b.href}
              aria-current={active ? "true" : undefined}
              className={cn(
                "rounded-2xl bg-card px-4 py-3 shadow-elevation-1 transition-shadow",
                "hover:shadow-elevation-3 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                // The active tile is marked with the module accent rather than
                // a fill, so it reads as "selected" without competing with the
                // overdue figure for attention.
                active && "ring-2 ring-module-accent",
              )}
            >
              <p className="text-xs text-muted-foreground">{b.label}</p>
              <p
                className={cn(
                  "mt-1 font-mono text-lg tabular-nums",
                  // `--destructive` only where it is earned: an overdue total
                  // above zero. A red zero is a false alarm.
                  b.alarm && b.cents > 0 ? "text-destructive" : "text-foreground",
                )}
              >
                {formatCentsSigned(b.cents)}
              </p>
              <p className="text-xs text-subtle-foreground">
                {b.count === 1 ? `1 ${noun}` : `${b.count} ${noun}s`}
              </p>
            </Link>
          );
        })}
      </div>

      {activeKey && (
        <p className="text-xs text-muted-foreground">
          Filtered to{" "}
          <strong className="font-medium">
            {buckets.find((b) => b.key === activeKey)?.label ?? activeKey}
          </strong>{" "}
          ·{" "}
          <Link href={clearHref} className="underline hover:no-underline">
            show all
          </Link>
        </p>
      )}
    </div>
  );
}
