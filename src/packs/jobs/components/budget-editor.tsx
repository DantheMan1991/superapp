"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { setBudgetAction } from "../actions";

/**
 * Set what each cost code is meant to cost.
 *
 * **EVERY CODE IN THE LIST, NOT JUST THE BUDGETED ONES.** A budget is built by
 * going down the chart and filling in what you know, so the form is the chart —
 * with the amounts already set filled in, and the rest blank.
 *
 * **A BLANK BOX IS NOT ZERO.** Blank means "no plan for this code yet"; zero
 * means "carried at nil, so anything spent against it is a variance". Writing
 * one as the other would turn every untouched row into a fake overrun, so blanks
 * are dropped at the action rather than saved.
 *
 * **Omitted codes are left alone, never cleared.** A budget is built up over
 * weeks by different people; a save that replaced the whole thing would make "I
 * added the concrete number" quietly delete everything typed since this form was
 * opened. Removing a code is its own button on the report.
 */
export function BudgetEditor({
  projectId,
  codes,
  existing,
}: {
  projectId: string;
  codes: Array<{ id: string; code: string; name: string }>;
  /** costCodeId → amount in cents, for codes already budgeted. */
  existing: Record<string, number>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      codes.map((c) => [
        c.id,
        existing[c.id] !== undefined ? (existing[c.id] / 100).toFixed(2) : "",
      ]),
    ),
  );

  const typedTotal = Object.values(amounts).reduce((sum, v) => {
    const n = Number(String(v).replace(/[,\s$]/g, ""));
    return Number.isFinite(n) && v.trim() !== "" ? sum + n : sum;
  }, 0);

  function submit() {
    startTransition(async () => {
      const result = await setBudgetAction({
        projectId,
        lines: codes.map((c) => ({
          costCodeId: c.id,
          originalCents: amounts[c.id] ?? "",
        })),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Budget saved");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="mr-1.5 size-4" /> Set budget
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Budget by cost code</DialogTitle>
          </DialogHeader>
          {codes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This job has no cost code list attached, so there is nothing to
              budget against yet.
            </p>
          ) : (
            <div className="space-y-2">
              {codes.map((c) => (
                <div key={c.id} className="grid grid-cols-[1fr_8rem] items-center gap-2">
                  <label htmlFor={`b-${c.id}`} className="text-sm">
                    <span className="font-mono text-xs">{c.code}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c.name}
                    </span>
                  </label>
                  <Input
                    id={`b-${c.id}`}
                    value={amounts[c.id] ?? ""}
                    onChange={(e) =>
                      setAmounts((prev) => ({ ...prev, [c.id]: e.target.value }))
                    }
                    placeholder="—"
                    inputMode="decimal"
                    className="text-right"
                  />
                </div>
              ))}
              <p className="pt-1 text-xs text-muted-foreground">
                Leave a code blank if you have no plan for it yet. Zero is
                different: it means anything spent against that code is a
                variance.
              </p>
              <div className="flex justify-between border-t border-border/60 pt-2 text-sm font-medium">
                <span>Total typed</span>
                <span className="tabular-nums">
                  {typedTotal.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={submit} disabled={pending || codes.length === 0}>
              {pending ? "Saving…" : "Save budget"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
