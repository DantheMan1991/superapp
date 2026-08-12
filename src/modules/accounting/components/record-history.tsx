import { History } from "lucide-react";
import type { HistoryEvent } from "../history/list";

/**
 * "What has happened to this record", on the record's own page.
 *
 * Server component, no interactivity: it is a read of something already
 * written, and there is nothing here to click.
 *
 * RENDERS NOTHING WHEN THERE IS NOTHING TO SAY. A record created before this
 * panel existed has no rows, and a permanently empty "History" card on every
 * invoice in the product would be furniture rather than a feature — the same
 * rule `EntityThreads` follows for the same reason.
 */
export function RecordHistory({ events }: { events: HistoryEvent[] }) {
  if (events.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-elevation-1 print:hidden">
      <div className="flex items-center gap-2 border-b border-divider px-5 py-3">
        <History className="size-4 text-module-accent" />
        <p className="text-sm font-medium">History</p>
      </div>
      <ol className="divide-y divide-divider">
        {events.map((e) => (
          <li key={e.id} className="flex items-baseline gap-3 px-5 py-2.5">
            <time
              className="w-32 shrink-0 font-mono text-xs tabular-nums text-subtle-foreground"
              dateTime={e.at.toISOString()}
            >
              {e.at.toISOString().slice(0, 16).replace("T", " ")}
            </time>
            <div className="min-w-0 flex-1">
              {/* The raw action stays reachable on hover: the label is derived,
                  and somebody reconciling against the audit log needs the slug
                  the log actually holds. */}
              <p className="text-sm" title={e.action}>
                {e.label}
                {e.detail && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {e.detail}
                  </span>
                )}
              </p>
            </div>
            <p className="shrink-0 text-xs text-muted-foreground">{e.actor}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
