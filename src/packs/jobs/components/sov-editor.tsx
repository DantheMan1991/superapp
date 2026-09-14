"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ListOrdered, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { saveSovAction } from "../actions";

const NONE = "__none__";

interface LineDraft {
  id?: string;
  description: string;
  amount: string;
  costCodeId: string;
  changeOrderId: string;
  billed: boolean;
}

/**
 * Write a contract's schedule of values.
 *
 * **THE LINES ARE THE DOCUMENT.** A schedule is edited whole — rows added,
 * removed and reordered in front of you — so saving replaces it, the way a
 * commitment's lines are replaced. The one row that will not go is one an
 * application has billed against: its remove button is disabled and says so,
 * and the action refuses too.
 *
 * **THE TOTAL IS SHOWN AGAINST THE CONTRACT** as you type, because the one
 * question a schedule has to answer is whether it adds up to the sum — a
 * schedule that is short leaves value nobody can bill, and one that is over
 * bills value nobody agreed. Neither is refused; both are said.
 *
 * **"ONE LINE FOR THE WHOLE CONTRACT"** is the monthly progress draw: a
 * fixed-price home billed on percent complete of the whole sum needs no
 * breakdown, and the button gives it one line worth the contract.
 */
export function SovEditor({
  projectId,
  contractId,
  contractValueCents,
  existing,
  costCodes,
  changeOrders,
  symbol,
}: {
  projectId: string;
  contractId: string;
  contractValueCents: number | null;
  existing: Array<{
    id: string;
    description: string;
    scheduledCents: number;
    costCodeId: string | null;
    changeOrderId: string | null;
    billed: boolean;
  }>;
  costCodes: Array<{ id: string; label: string }>;
  changeOrders: Array<{ id: string; label: string }>;
  symbol: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const blank = (): LineDraft => ({
    description: "",
    amount: "",
    costCodeId: NONE,
    changeOrderId: NONE,
    billed: false,
  });
  const [lines, setLines] = useState<LineDraft[]>(() =>
    existing.length > 0
      ? existing.map((l) => ({
          id: l.id,
          description: l.description,
          amount: (l.scheduledCents / 100).toFixed(2),
          costCodeId: l.costCodeId ?? NONE,
          changeOrderId: l.changeOrderId ?? NONE,
          billed: l.billed,
        }))
      : [blank()],
  );

  const total = lines.reduce((sum, l) => {
    const n = Number(l.amount.replace(/[,\s$]/g, ""));
    return Number.isFinite(n) && l.amount.trim() !== "" ? sum + Math.round(n * 100) : sum;
  }, 0);
  const gap = contractValueCents === null ? null : contractValueCents - total;
  const money = (c: number) =>
    `${symbol ?? ""}${(c / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, j) => (i === j ? { ...l, ...patch } : l)));
  }

  function submit() {
    startTransition(async () => {
      const result = await saveSovAction({
        projectId,
        contractId,
        lines: lines.map((l) => ({
          id: l.id ?? "",
          description: l.description.trim(),
          scheduledCents: l.amount,
          costCodeId: l.costCodeId === NONE ? "" : l.costCodeId,
          changeOrderId: l.changeOrderId === NONE ? "" : l.changeOrderId,
        })),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Schedule saved");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ListOrdered className="mr-1.5 size-4" />{" "}
        {existing.length === 0 ? "Set up the schedule" : "Edit schedule"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Schedule of values</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              How the contract sum breaks down — by trade, by phase, or as
              milestones. Each application says how much of each line is done.
            </p>
            {lines.length === 1 &&
              lines[0].description === "" &&
              lines[0].amount === "" &&
              contractValueCents !== null && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setLines([
                      {
                        ...blank(),
                        description: "Contract sum",
                        amount: (contractValueCents / 100).toFixed(2),
                      },
                    ])
                  }
                >
                  One line for the whole contract
                </Button>
              )}
            <div className="space-y-2 rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between">
                <Label>Lines</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setLines((prev) => [...prev, blank()])}
                >
                  <Plus className="mr-1.5 size-4" /> Add line
                </Button>
              </div>
              {lines.map((line, i) => (
                <div
                  key={line.id ?? `new-${i}`}
                  className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_7rem_2rem]"
                >
                  <Input
                    aria-label={`Description, line ${i + 1}`}
                    value={line.description}
                    onChange={(e) => setLine(i, { description: e.target.value })}
                    placeholder="Foundation"
                    maxLength={300}
                  />
                  <Select
                    value={line.costCodeId}
                    onValueChange={(v) => setLine(i, { costCodeId: v })}
                  >
                    <SelectTrigger aria-label={`Cost code, line ${i + 1}`}>
                      <SelectValue placeholder="Cost code" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No code</SelectItem>
                      {costCodes.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={line.changeOrderId}
                    onValueChange={(v) => setLine(i, { changeOrderId: v })}
                  >
                    <SelectTrigger aria-label={`Change order, line ${i + 1}`}>
                      <SelectValue placeholder="Change order" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Original contract</SelectItem>
                      {changeOrders.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    aria-label={`Scheduled value, line ${i + 1}`}
                    value={line.amount}
                    onChange={(e) => setLine(i, { amount: e.target.value })}
                    placeholder="0.00"
                    inputMode="decimal"
                    className="text-right"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={line.billed}
                    title={line.billed ? "Billed on an application; cannot be removed" : undefined}
                    onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" />
                    <span className="sr-only">Remove line {i + 1}</span>
                  </Button>
                </div>
              ))}
              <div className="flex items-start justify-between gap-4 border-t border-border/60 pt-2 text-sm">
                <span className="text-xs text-muted-foreground">
                  A row with no description is ignored. A line that has been
                  billed can change its value but cannot be removed.
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span className="font-medium">{money(total)}</span>
                  {gap !== null && (
                    <span
                      className={
                        "block text-xs " +
                        (gap === 0 ? "text-muted-foreground" : "text-destructive")
                      }
                    >
                      {gap === 0
                        ? "Matches the contract"
                        : gap > 0
                          ? `${money(gap)} of the contract is not on the schedule`
                          : `${money(-gap)} over the contract`}
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Saving…" : "Save schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
