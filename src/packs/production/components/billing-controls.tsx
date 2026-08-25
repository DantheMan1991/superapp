"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/money";
import {
  correctRunCostAction,
  matchBillLineAction,
  unmatchBillLineAction,
} from "../billing-actions";

/**
 * The controls for settling what a plant charged.
 *
 * **THE TICK BOXES ARE `Checkbox`, NOT `Switch`.** Picking which kill days a
 * bill covers is row selection, which is what a tick box means; the price list
 * learned that the expensive way one slice ago.
 */

export interface AccrualOption {
  runId: string;
  runCode: string;
  startedOn: string;
  processorName: string | null;
  openCents: number;
}

/**
 * Point a bill line at the processing it pays for.
 *
 * **THE AMOUNT IS NOT A FIELD, AND THAT IS THE DESIGN.** A processing day is
 * invoiced as a whole — there is no natural unit to settle part of one with, the
 * way a delivery has a quantity — so ticking a run settles its whole outstanding
 * accrual and whatever the invoice charges beyond that becomes the variance.
 * The dialog shows both figures before anything is pressed, because the gap
 * between them is the one thing this screen exists to make visible.
 */
export function MatchBillLineDialog({
  billLineId,
  description,
  amountCents,
  vendorName,
  entityId,
  options,
  currencySymbol,
  processorWord,
  runWord,
}: {
  billLineId: string;
  description: string;
  amountCents: number;
  vendorName: string;
  /** Only accruals from the same company can settle this bill — see `billing-ops`. */
  entityId: string;
  options: (AccrualOption & { entityId: string })[];
  currencySymbol: string | null;
  /** The tenant's own words. Found by driving: this copy said "plant". */
  processorWord: string;
  runWord: string;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  /**
   * **ANOTHER COMPANY'S PROCESSING IS NOT OFFERED**, rather than offered and
   * then refused. The accrual posted in whichever books the run's stock belonged
   * to; a bill clears in its own, and if they differ neither `2060` ever nets.
   * The `Test` tenant keeps two companies, which is where that class of bug
   * keeps being found.
   */
  const eligible = options.filter((o) => o.entityId === entityId);
  const chosen = eligible.filter((o) => picked.has(o.runId));
  const accrued = chosen.reduce((sum, o) => sum + o.openCents, 0);
  const variance = amountCents - accrued;

  const toggle = (runId: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });

  const submit = () => {
    if (chosen.length === 0) {
      toast.error("Tick which processing this bill is for.");
      return;
    }
    startTransition(async () => {
      const result = await matchBillLineAction({
        billLineId,
        runIds: chosen.map((o) => o.runId),
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        variance === 0
          ? "Matched"
          : `Matched — ${formatMoney(Math.abs(variance), currencySymbol)} ${
              variance > 0 ? "more" : "less"
            } than was accrued`,
      );
      setPicked(new Set());
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={eligible.length === 0}>
          Match
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>What is this bill for</DialogTitle>
          <DialogDescription>
            {vendorName} · {description} ·{" "}
            {formatMoney(amountCents, currencySymbol)}. Tick the processing it
            pays for. Each one settles what was put aside for it when it
            finished; anything the {processorWord.toLowerCase()} charged beyond
            that goes on the bill as its own line for somebody to code.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {eligible.map((o) => (
            <label
              key={o.runId}
              className="flex items-center gap-3 rounded-md border p-2 text-sm"
            >
              <Checkbox
                checked={picked.has(o.runId)}
                onCheckedChange={() => toggle(o.runId)}
                aria-label={`Settle ${o.runCode}`}
              />
              <span className="font-medium">{o.runCode}</span>
              <span className="text-muted-foreground">{o.startedOn}</span>
              {o.processorName && (
                <span className="text-muted-foreground">{o.processorName}</span>
              )}
              <span className="ml-auto tabular-nums">
                {formatMoney(o.openCents, currencySymbol)}
              </span>
            </label>
          ))}
        </div>

        {/*
          **BOTH FIGURES, BEFORE ANYTHING IS PRESSED.** The gap between what was
          put aside and what the plant charged is the number this screen exists
          for — "they charged more than they quoted", as an amount rather than a
          thing somebody remembers.
        */}
        <div className="space-y-1 border-t pt-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Put aside for these</span>
            <span className="tabular-nums">
              {formatMoney(accrued, currencySymbol)}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">What they charged</span>
            <span className="tabular-nums">
              {formatMoney(amountCents, currencySymbol)}
            </span>
          </div>
          {/*
            **NOT A DIFFERENCE UNTIL THERE IS SOMETHING TO DIFFER FROM.** Found
            by opening it: with nothing ticked the panel read "Difference
            $235.00" in red, which says the plant overcharged by the whole
            invoice. Before a selection there is no comparison to make.
          */}
          {chosen.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Tick a {runWord.toLowerCase()} above and the two figures can be
              compared.
            </p>
          ) : (
            <div className="flex justify-between gap-4 font-medium">
              <span>{variance === 0 ? "They agree" : "Difference"}</span>
              <span
                className={
                  variance === 0
                    ? "tabular-nums"
                    : "tabular-nums text-destructive"
                }
              >
                {formatMoney(variance, currencySymbol)}
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={pending || chosen.length === 0}>
            Match
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UnmatchBillLineButton({ billLineId }: { billLineId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await unmatchBillLineAction({ billLineId });
          if ("error" in result && result.error) {
            toast.error(result.error);
            return;
          }
          toast.success("Unpicked");
          router.refresh();
        })
      }
    >
      Unpick
    </Button>
  );
}

/**
 * Move the meat's cost to what the plant actually billed.
 *
 * **AN OFFER, NOT AN OBLIGATION, and the copy has to say so.** The books are
 * already right — matching put the difference on the P&L — and this is about
 * whether the BATCH should carry it too. By the time a plant invoices, the meat
 * is frequently sold, and a farm that never presses this is not wrong.
 */
export function CorrectRunCostButton({
  runId,
  runCode,
  movedCents,
  currencySymbol,
}: {
  runId: string;
  runCode: string;
  movedCents: number;
  currencySymbol: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    startTransition(async () => {
      const result = await correctRunCostAction({ runId });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      const moved = "movedCents" in result ? Number(result.movedCents) : 0;
      toast.success(
        `The meat now carries ${formatMoney(Math.abs(moved), currencySymbol)} ${
          moved > 0 ? "more" : "less"
        }`,
      );
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Move the cost
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move what this meat cost</DialogTitle>
          <DialogDescription>
            {runCode} was put aside at one figure and billed at another. The
            books already agree — the difference went to the profit and loss when
            the bill was matched. This is the other question: should the meat
            itself carry it?
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p>
            It would move what came out of {runCode} by{" "}
            <span className="font-medium tabular-nums">
              {formatMoney(movedCents, currencySymbol)}
            </span>
            , split across the batches in proportion to what each landed
            carrying.
          </p>
          {/*
            **THE HALF PEOPLE DO NOT EXPECT, SAID BEFORE IT HAPPENS.** A
            correction lands partly on stock still on the shelf, which raises its
            value, and partly on stock already sold, which is expensed — because
            capitalising it would put an asset back on the balance sheet for meat
            that has been eaten.
          */}
          <p className="text-muted-foreground">
            Anything already sold takes its share as an expense rather than a
            change in value, because it is not on a shelf to be worth more. What
            is still there is worth that much more.
          </p>
          <p className="text-muted-foreground">
            Nothing forces this. Leaving it alone keeps the books right and the
            batch at what it landed with.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            Move it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
