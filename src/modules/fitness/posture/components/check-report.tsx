"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CheckSummary, HistoryCheck } from "../core/history";
import type { MarkLabel } from "../core/marks";
import { getCheck } from "../store/checks";
import type { StoredCheck } from "../store/db";
import { sendPendingChecks } from "../store/sync";
import { PostureReport } from "./posture-report";

/**
 * A CHECK'S REPORT, WHEREVER THE CHECK IS (docs/help/fitness/posture-report.md;
 * docs/modules/posture.md, slice 3). From the account on any device; from this
 * phone when the account does not have it yet, which also sends it. The
 * photos, if any, only ever come from this phone.
 */
export function CheckReport({
  owner,
  checkId,
  fromAccount,
  history,
  labels = {},
  backHref,
}: {
  owner: string;
  checkId: string;
  fromAccount: (HistoryCheck & { notes: string[] }) | null;
  history: CheckSummary[];
  /** What each check marked in a workout program, by check id (slice 3c). */
  labels?: Record<string, MarkLabel[]>;
  backHref: string;
}) {
  const router = useRouter();
  // undefined while this phone's storage is read; null when it does not have the check.
  const [phone, setPhone] = useState<StoredCheck | null | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getCheck(owner, checkId)
      .then((c) => {
        if (!live) return;
        setPhone(c);
        // Here but not in the account yet: send it, and read the account again once it has it.
        if (c && !c.sentAt && !fromAccount) {
          setSending(true);
          void sendPendingChecks(owner).then((r) => {
            if (!live) return;
            setSending(false);
            if (r === "sent") router.refresh();
          });
        }
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhone(null);
      });
    return () => {
      live = false;
    };
  }, [owner, checkId, fromAccount, router]);

  if (fromAccount) {
    return (
      <PostureReport
        check={{
          id: fromAccount.id,
          at: fromAccount.takenAt,
          captures: fromAccount.captures,
          notes: fromAccount.notes,
          keepPhotos: phone?.keepPhotos === true,
          repeatOf: fromAccount.repeatOf ?? null,
        }}
        owner={owner}
        backHref={backHref}
        history={history}
        labels={labels}
        canDelete
      />
    );
  }
  if (phone === undefined) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Opening the check
      </p>
    );
  }
  if (phone === null) {
    return (
      <div className="space-y-3 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
        <h2 className="font-medium">This check is not here</h2>
        <p className="text-sm text-muted-foreground">
          It is not in your account, and this phone does not have it. A check reaches your account from the phone that
          took it once that phone is online. If it was deleted, it is gone.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button asChild variant="outline">
          <Link href={backHref}>Back to the posture check</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className={sending ? "flex items-center gap-2 rounded-xl bg-muted p-3 text-sm" : "rounded-xl bg-warning/15 p-3 text-sm"}>
        {sending && <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />}
        {sending
          ? "Sending this check's numbers to your account."
          : (phone.refused ?? "This check is on this phone only for now. It goes to your account when the phone is online.")}
      </p>
      <PostureReport
        check={{ id: phone.id, at: phone.at, captures: phone.captures, notes: phone.notes, keepPhotos: phone.keepPhotos, repeatOf: phone.repeatOf ?? null }}
        owner={owner}
        backHref={backHref}
        history={history}
        labels={labels}
        canDelete
      />
    </div>
  );
}
