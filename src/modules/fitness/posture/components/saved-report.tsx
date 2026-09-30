"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCheck } from "../store/checks";
import type { StoredCheck } from "../store/db";
import { PostureReport } from "./posture-report";

/**
 * A CHECK'S REPORT, OPENED FROM THIS PHONE (docs/help/fitness/
 * posture-report.md). Until slice 3 saves checks to the account, a check
 * lives only on the phone that took it, so this reads it from there; on any
 * other phone or browser the page says so.
 */
export function SavedReport({ owner, checkId, backHref }: { owner: string; checkId: string; backHref: string }) {
  const [check, setCheck] = useState<StoredCheck | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getCheck(owner, checkId)
      .then((c) => live && setCheck(c))
      .catch((e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : String(e));
        setCheck(null);
      });
    return () => {
      live = false;
    };
  }, [owner, checkId]);

  if (check === undefined) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Opening the check
      </p>
    );
  }
  if (check === null) {
    return (
      <div className="space-y-3 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
        <h2 className="font-medium">This check is not on this phone</h2>
        <p className="text-sm text-muted-foreground">
          A check is kept only in the browser on the phone that took it. Open this page there. If it was deleted, or the
          site&apos;s data was cleared, it is gone.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button asChild variant="outline">
          <Link href={backHref}>Back to the posture check</Link>
        </Button>
      </div>
    );
  }
  return <PostureReport check={check} owner={owner} backHref={backHref} onPhone />;
}
