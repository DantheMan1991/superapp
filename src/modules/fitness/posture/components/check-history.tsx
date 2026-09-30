"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Download, ImageIcon } from "lucide-react";
import { MEASURE_ORDER } from "../core/measures";
import { localDayOf } from "../core/check-doc";
import { summarize, trends, type CheckSummary } from "../core/history";
import type { MarkLabel } from "../core/marks";
import { listChecks, sweepAbandoned } from "../store/checks";
import type { StoredCheck } from "../store/db";
import { forgetDeletedElsewhere, sendPendingChecks } from "../store/sync";
import { TrendCard } from "./trend-card";

/**
 * YOUR CHECKS (docs/help/fitness/posture.md; docs/modules/posture.md, slice 3):
 * every check in your account, and any this phone has not sent yet, newest
 * first, each opening its report; above them, each measure across the checks.
 *
 * Opening it also does this phone's housekeeping: sends a check the account
 * does not have yet, forgets one deleted on another device, and clears away a
 * check that never finished.
 *
 * A check that marked a workout program's start or a phase's end says so
 * (slice 3c).
 */

type Row = CheckSummary & { phone: StoredCheck | null };

export function CheckHistory({
  owner,
  account,
  labels = {},
  reportHref,
  exportHref,
}: {
  owner: string;
  /** The account's checks, newest first, summarized on the server. */
  account: CheckSummary[];
  /** What each check marked in a workout program, by check id (slice 3c, core/marks.ts). */
  labels?: Record<string, MarkLabel[]>;
  reportHref: string;
  exportHref: string;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState<StoredCheck[] | null>(null);

  useEffect(() => {
    let live = true;
    const ids = account.map((c) => c.id);
    void (async () => {
      await sweepAbandoned(owner).catch(() => 0);
      await forgetDeletedElsewhere(owner, ids).catch(() => 0);
      const before = await listChecks(owner).catch(() => [] as StoredCheck[]);
      if (live) setPhone(before);
      const unsent = before.filter((c) => !c.sentAt).length;
      if (unsent === 0) return;
      const result = await sendPendingChecks(owner).catch(() => "offline" as const);
      if (!live) return;
      setPhone(await listChecks(owner).catch(() => before));
      // The account has them now: read its list again.
      if (result === "sent") router.refresh();
    })();
    return () => {
      live = false;
    };
  }, [owner, account, router]);

  const rows = useMemo<Row[]>(() => {
    const byId = new Map((phone ?? []).map((c) => [c.id, c]));
    const fromAccount = account.map((c) => ({ ...c, phone: byId.get(c.id) ?? null }));
    const inAccount = new Set(account.map((c) => c.id));
    const onlyHere = (phone ?? [])
      .filter((c) => !inAccount.has(c.id))
      .map((c) => ({
        ...summarize({
          id: c.id,
          takenAt: new Date(c.at).toISOString(),
          localDay: localDayOf(new Date(c.at)),
          captures: c.captures,
          repeatOf: c.repeatOf ?? null,
        }),
        phone: c,
      }));
    return [...fromAccount, ...onlyHere].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  }, [account, phone]);

  const all = useMemo(() => trends(rows), [rows]);
  const reliable = all.filter((t) => t.tier === "reliable");
  const trendOnly = all.filter((t) => t.tier === "trend");

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No checks yet.</p>;
  }

  return (
    <div className="space-y-4">
      {all.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Each measure across your checks. The shaded band is your first check, as wide as a real change must be.
          </p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {reliable.map((t) => (
              <TrendCard key={t.key} trend={t} />
            ))}
          </ul>
          {trendOnly.length > 0 && (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {trendOnly.map((t) => (
                <TrendCard key={t.key} trend={t} />
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Your measures show here across your checks from your second check.</p>
      )}

      <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-elevation-1">
        {rows.map((r) => {
          const when = new Date(r.takenAt);
          const measures = MEASURE_ORDER.filter((k) => r.measures[k]).length;
          const unsent = r.phone !== null && !r.phone.sentAt && !account.some((c) => c.id === r.id);
          return (
            <li key={r.id}>
              <Link href={`${reportHref}/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {when.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {labels[r.id] && (
                      <span className="font-medium text-foreground">{`${labels[r.id].map((l) => l.label).join(" · ")} · `}</span>
                    )}
                    {r.repeatOf ? "Repeat, stickers put back on · " : ""}
                    {r.views === 4 ? "All four views" : `${r.views} of 4 views`} · {measures} {measures === 1 ? "measure" : "measures"}
                  </div>
                  {unsent && (
                    <div className="text-xs text-warning-foreground">
                      {r.phone?.refused ?? "On this phone only: it goes to your account when the phone is online."}
                    </div>
                  )}
                </div>
                {r.phone?.keepPhotos && <ImageIcon className="size-4 shrink-0 text-muted-foreground" aria-label="Photos on this phone" />}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>

      {account.length > 0 && (
        <a href={exportHref} download className="inline-flex items-center gap-1.5 text-sm text-module-accent underline-offset-4 hover:underline">
          <Download className="size-4" aria-hidden /> Download the numbers
        </a>
      )}
    </div>
  );
}
