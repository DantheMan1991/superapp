"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/app/use-confirm";
import {
  approveSheetAction,
  returnSheetAction,
  setPeriodLockAction,
  submitSheetAction,
} from "../actions";

/** Send one person's period for approval. */
export function SubmitSheetButton({
  workerId,
  on,
  name,
}: {
  workerId: string;
  /** Any day inside the period. */
  on: string;
  name: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await submitSheetAction({ workerId, on });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success(`${name}'s hours sent for approval`);
          router.refresh();
        })
      }
    >
      Send for approval
    </Button>
  );
}

/**
 * Agree one person's period, or send it back.
 *
 * The approve button says what it is agreeing to, because the figure is the
 * decision: an owner pressing this is fixing what somebody is paid, and the
 * totals are frozen at that moment.
 */
export function ApproveSheetButtons({
  sheetId,
  version,
  name,
  summary,
}: {
  sheetId: string;
  version: number;
  name: string;
  /** "40h regular · 10h overtime", already formatted. */
  summary: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size="sm"
        disabled={pending}
        onClick={() => setOpen(true)}
      >
        Approve
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await returnSheetAction({ sheetId });
            if ("error" in result) {
              toast.error(result.error);
              return;
            }
            toast.success(`Sent back to ${name}`);
            router.refresh();
          })
        }
      >
        Send back
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve {name}&apos;s hours?</DialogTitle>
            <DialogDescription>
              {summary}. These figures are saved as they stand now, and are what
              a pay run will quote. The hours can still be changed until you lock
              the period.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await approveSheetAction({
                    sheetId,
                    expectedVersion: version,
                  });
                  if ("error" in result) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success("Approved");
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending ? "Approving…" : "Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Stop the hours in a period from moving, or let them move again.
 *
 * LOCKING ASKS FIRST and unlocking does not. Locking is the act with the
 * consequence — from that moment nobody can correct an entry, only amend it in
 * the open period — while unlocking merely restores what was already true.
 */
export function PeriodLockButton({
  on,
  locked,
  label,
  postsLabor,
}: {
  on: string;
  locked: boolean;
  /** "Aug 30 – Sep 12, 2026". */
  label: string;
  /** Whether locking this period also writes a journal entry. */
  postsLabor: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();

  function set(next: boolean) {
    startTransition(async () => {
      const result = await setPeriodLockAction({ on, locked: next });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      /*
       * SAY WHETHER THE BOOKS MOVED. "Period locked" on a business that posts
       * wages is ambiguous in the one direction that matters — an owner who
       * assumes it posted and finds nothing in the ledger a month later has no
       * way back to this moment.
       */
      const posted = result.data?.posted ?? false;
      const left = result.data?.unapprovedWorkers ?? 0;
      if (next) {
        toast.success(
          posted ? "Period locked and wages posted" : "Period locked",
          left > 0
            ? {
                description: `${left} ${left === 1 ? "timesheet was" : "timesheets were"} never approved, so ${left === 1 ? "it is" : "they are"} not in this figure.`,
              }
            : undefined,
        );
      } else {
        toast.success(
          posted ? "Period unlocked and wages reversed" : "Period unlocked",
        );
      }
      router.refresh();
    });
  }

  return (
    <>
      {confirmDialog}
      <Button
        variant={locked ? "outline" : "default"}
        size="sm"
        disabled={pending}
        onClick={async () => {
          if (locked) {
            set(false);
            return;
          }
          const ok = await confirm({
            title: `Lock ${label}?`,
            description:
              "Nobody will be able to change or delete an hour in these dates. " +
              "A mistake found later is put right by adding a correction in the " +
              "open period, which leaves the original as your pay run saw it. " +
              "You can unlock it again." +
              (postsLabor
                ? " This will also put the approved wages in your books, as a " +
                  "payroll accrual dated the last day of the period. Unlocking " +
                  "reverses it."
                : ""),
            confirmLabel: postsLabor
              ? "Lock it and post the wages"
              : "Lock the period",
          });
          if (ok) set(true);
        }}
      >
        {locked ? "Unlock period" : "Lock period"}
      </Button>
    </>
  );
}
