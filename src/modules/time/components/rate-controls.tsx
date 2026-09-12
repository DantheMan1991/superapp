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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfirm } from "@/components/app/use-confirm";
import { deleteRateAction, setRateAction } from "../actions";
import { formatCents } from "../core/pay";

export interface RateWorkerOption {
  id: string;
  name: string;
}

/**
 * Dollars in the box, cents in the database.
 *
 * The conversion happens HERE and nowhere else, so no server code has to
 * wonder which unit it is holding. Returns null when the text is not a number
 * anybody meant — the caller refuses rather than saving a zero.
 */
function toCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/**
 * Set what somebody is paid from a given day.
 *
 * THE DATE IS THE POINT, not decoration. A rate does not replace the one before
 * it; it starts on a day, and everything worked before that day keeps the rate
 * that was in force then. The dialog says so, because "effective from" reads as
 * paperwork until somebody realises a backdated raise would otherwise restate
 * a month of payroll.
 */
export function SetRateButton({
  workers,
  defaultWorkerId,
  today,
  label = "Set a rate",
}: {
  workers: RateWorkerOption[];
  defaultWorkerId?: string;
  today: string;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [workerId, setWorkerId] = useState(defaultWorkerId ?? workers[0]?.id ?? "");

  function submit(formData: FormData) {
    const pay = toCents(String(formData.get("pay") ?? ""));
    if (pay === null) {
      toast.error("An hourly rate like 22.50.");
      return;
    }
    const billRaw = String(formData.get("bill") ?? "").trim();
    const bill = billRaw === "" ? null : toCents(billRaw);
    if (billRaw !== "" && bill === null) {
      toast.error("A charge-out rate like 60.00, or leave it empty.");
      return;
    }
    const burden = Number(String(formData.get("burden") ?? "0"));
    if (!Number.isInteger(burden) || burden < 0 || burden > 200) {
      toast.error("Burden is a whole percent between 0 and 200.");
      return;
    }

    startTransition(async () => {
      const result = await setRateAction({
        workerId,
        effectiveOn: String(formData.get("effectiveOn") ?? ""),
        payRateCents: pay,
        billRateCents: bill,
        burdenPercent: burden,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Rate saved");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={workers.length === 0}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Set a pay rate</DialogTitle>
            <DialogDescription>
              This starts on the day you give and applies from then on.
              Everything worked before it keeps the rate that was in force at
              the time.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="rate-worker">Who</Label>
              <Select value={workerId} onValueChange={setWorkerId}>
                <SelectTrigger id="rate-worker">
                  <SelectValue placeholder="Pick a person" />
                </SelectTrigger>
                <SelectContent>
                  {workers.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="pay">Hourly pay</Label>
                <Input id="pay" name="pay" required autoFocus placeholder="22.50" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="effectiveOn">From</Label>
                <Input
                  id="effectiveOn"
                  name="effectiveOn"
                  type="date"
                  required
                  defaultValue={today}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="bill">Charged out at</Label>
                <Input id="bill" name="bill" placeholder="Optional" />
                <p className="text-xs text-subtle-foreground">
                  What a customer pays for the hour, if you bill for time.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="burden">On-costs</Label>
                <Input
                  id="burden"
                  name="burden"
                  type="number"
                  min={0}
                  max={200}
                  defaultValue={0}
                />
                <p className="text-xs text-subtle-foreground">
                  Percent on top for your taxes and insurance. Never part of
                  what the person is paid.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Take one rate out of the history.
 *
 * ASKS FIRST, because the consequence is not local: removing a rate re-prices
 * every week after it that has not already been approved. Approved periods keep
 * the gross they were approved with, which is the whole reason that figure is
 * frozen on the sheet.
 */
export function DeleteRateButton({
  rateId,
  summary,
}: {
  rateId: string;
  /** "Jo Okafor, $22.50 from 2026-09-01". */
  summary: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();

  return (
    <>
      {confirmDialog}
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={async () => {
          const ok = await confirm({
            title: "Remove this rate?",
            description:
              `${summary}. Every week after this date that has not been ` +
              "approved will be worked out on whatever rate came before it. " +
              "Periods you have already approved keep the figure you approved.",
            confirmLabel: "Remove it",
            destructive: true,
          });
          if (!ok) return;
          startTransition(async () => {
            const result = await deleteRateAction({ rateId });
            if ("error" in result) {
              toast.error(result.error);
              return;
            }
            toast.success("Rate removed");
            router.refresh();
          });
        }}
      >
        Remove
      </Button>
    </>
  );
}

/** Money on a read-only line. One place formats it. */
export function Money({ cents }: { cents: number }) {
  return <span className="tabular-nums">{formatCents(cents)}</span>;
}
