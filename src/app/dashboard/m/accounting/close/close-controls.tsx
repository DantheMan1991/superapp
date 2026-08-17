"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  completeCloseAction,
  reopenCloseAction,
} from "@/modules/accounting/close/actions";

interface BlockerRow {
  label: string;
  count: number;
}

export function CloseControls({
  entityId,
  entityName,
  periodEnd,
  periodOptions,
  blockers,
}: {
  /** Whose books are being closed (ADR 0010 slice 4). */
  entityId: string;
  /**
   * Undefined on a single-company tenant, and then the dialog reads exactly as
   * it always did. The moment there are two, every sentence here names the
   * company — closing the wrong one is the mistake this screen can make.
   */
  entityName: string | undefined;
  periodEnd: string;
  periodOptions: string[];
  blockers: BlockerRow[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex items-center gap-2">
      <Select
        value={periodEnd}
        onValueChange={(v) =>
          router.push(`/dashboard/m/accounting/close?periodEnd=${v}`)
        }
      >
        <SelectTrigger className="h-9 w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {periodOptions.map((p) => (
            <SelectItem key={p} value={p}>
              Through {p}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm">
            <Lock className="mr-1.5 h-4 w-4" />
            Close the books
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Close {entityName ? `${entityName}'s` : "the"} books through{" "}
              {periodEnd}?
            </DialogTitle>
            <DialogDescription>
              {entityName ? `${entityName}'s entries` : "Entries"} dated on or
              before this day become locked — corrections go through reversals.
              You can reopen the latest close if needed.
              {entityName
                ? " Your other companies are unaffected; each one closes on its own."
                : ""}
            </DialogDescription>
          </DialogHeader>
          {blockers.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium">
                Still outstanding — you can close anyway; these will be
                recorded in the close snapshot:
              </p>
              <ul className="mt-1.5 list-disc pl-5 text-muted-foreground">
                {blockers.map((b) => (
                  <li key={b.label}>
                    {b.label}
                    {b.count > 0 ? ` (${b.count})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await completeCloseAction({ entityId, periodEnd });
                  if ("error" in res) {
                    toast.error(res.error);
                    return;
                  }
                  setOpen(false);
                  toast.success(
                    entityName
                      ? `${entityName} closed through ${periodEnd}.`
                      : `Books closed through ${periodEnd}.`,
                  );
                  if (res.data)
                    router.push(
                      `/dashboard/m/accounting/close/${res.data.closeId}`,
                    );
                  router.refresh();
                })
              }
            >
              {pending ? "Closing…" : "Close books"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ReopenCloseButton({
  closeId,
  periodEnd,
  version,
}: {
  closeId: string;
  periodEnd: string;
  version: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <LockOpen className="mr-1.5 h-4 w-4" />
          Reopen
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reopen the close through {periodEnd}?</DialogTitle>
          <DialogDescription>
            The period lock rolls back to where it stood before this close.
            The close stays in the history as reopened, and its sign-off and
            narrative are kept for the record.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await reopenCloseAction({
                  closeId,
                  expectedVersion: version,
                });
                if ("error" in res) {
                  toast.error(res.error);
                  return;
                }
                setOpen(false);
                toast.success("Close reopened.");
                router.refresh();
              })
            }
          >
            {pending ? "Reopening…" : "Reopen close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
