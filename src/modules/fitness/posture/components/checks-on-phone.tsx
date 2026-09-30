"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, ImageIcon } from "lucide-react";
import { buildReport } from "../core/report";
import { listChecks, sweepAbandoned } from "../store/checks";
import type { StoredCheck } from "../store/db";

/**
 * YOUR CHECKS ON THIS PHONE (docs/help/fitness/posture.md): newest first,
 * each opening its report. Kept in this browser only until slice 3 saves them
 * to the account; a check another phone took is not here.
 *
 * Opening the list also tidies up after a check that never finished (the tab
 * closed mid-check): its numbers and any photo it kept.
 */
export function ChecksOnPhone({ owner, reportHref }: { owner: string; reportHref: string }) {
  const [checks, setChecks] = useState<StoredCheck[] | null>(null);

  useEffect(() => {
    let live = true;
    sweepAbandoned(owner)
      .catch(() => 0)
      .then(() => listChecks(owner))
      .then((list) => live && setChecks(list))
      .catch(() => live && setChecks([]));
    return () => {
      live = false;
    };
  }, [owner]);

  if (checks === null) return null;
  if (checks.length === 0) {
    return <p className="text-sm text-muted-foreground">No checks on this phone yet.</p>;
  }
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-elevation-1">
      {checks.map((c) => {
        const report = buildReport(c.captures);
        const when = new Date(c.at);
        return (
          <li key={c.id}>
            <Link href={`${reportHref}/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {when.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {report.views.length === 4 ? "All four views" : `${report.views.length} of 4 views`} · {report.measures.length}{" "}
                  {report.measures.length === 1 ? "measure" : "measures"}
                </div>
              </div>
              {c.keepPhotos && <ImageIcon className="size-4 shrink-0 text-muted-foreground" aria-label="Has photos" />}
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
