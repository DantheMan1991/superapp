"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createChangeOrderAction, updateChangeOrderAction } from "../actions";
import {
  CHANGE_ORDER_STATUSES,
  CHANGE_ORDER_STATUS_LABELS,
  VALUED_CONTRACT_STATUSES,
} from "../vocabulary";

interface LineDraft {
  costCodeId: string;
  description: string;
  amount: string;
}

export interface EditableChangeOrder {
  id: string;
  version: number;
  contractId: string;
  number: string;
  title: string;
  description: string;
  status: string;
  valueCents: number;
  requestedOn: string | null;
  approvedOn: string | null;
  notes: string;
  lines: Array<{
    costCodeId: string;
    description: string;
    amountCents: number;
  }>;
}

/** Today as the `date` input wants it, in the person's own timezone. */
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Raise a change order against one of the project's contracts.
 *
 * **THE PRICE AND THE COST ARE TWO DIFFERENT NUMBERS, AND THE FORM SAYS SO.**
 * The value box is what the client pays for the change; the lines are what it
 * is expected to cost, by cost code. A form that derived one from the other
 * would be wrong on every job where the markup is not flat — which is all of
 * them — so both are typed, and the panel shows them side by side.
 *
 * **NEGATIVE IS ALLOWED, AND IT IS THE ONLY MONEY BOX IN THIS PACK WHERE IT
 * IS.** A deductive change order — the owner drops the pool — is `-18,500`,
 * not a separate "credit" form.
 *
 * **APPROVED NEEDS A DATE.** Picking `Approved` fills today into the date box
 * if it is empty; it can be changed to the day the signature actually landed.
 * The action refuses an approved change order with no date, and the database
 * refuses one behind the action's back.
 */
export function ChangeOrderForm({
  projectId,
  contracts,
  costCodes,
  existing,
  trigger,
}: {
  projectId: string;
  contracts: Array<{ id: string; label: string; status: string }>;
  costCodes: Array<{ id: string; label: string }>;
  existing?: EditableChangeOrder;
  trigger?: ReactNode;
}) {
  const editing = existing !== undefined;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  /*
   * Which agreement, chosen for the person when there is only one that
   * counts — the common case on a home is one signed build contract — and left
   * for them when there is not.
   */
  const counted = contracts.filter((c) =>
    (VALUED_CONTRACT_STATUSES as readonly string[]).includes(c.status),
  );
  const [contractId, setContractId] = useState(
    existing?.contractId ??
      (contracts.length === 1
        ? contracts[0].id
        : counted.length === 1
          ? counted[0].id
          : ""),
  );
  const [number, setNumber] = useState(existing?.number ?? "");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [status, setStatus] = useState(existing?.status ?? "proposed");
  const [value, setValue] = useState(
    existing ? (existing.valueCents / 100).toFixed(2) : "",
  );
  const [requestedOn, setRequestedOn] = useState(existing?.requestedOn ?? "");
  const [approvedOn, setApprovedOn] = useState(existing?.approvedOn ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(
    existing && existing.lines.length > 0
      ? existing.lines.map((l) => ({
          costCodeId: l.costCodeId,
          description: l.description,
          amount: (l.amountCents / 100).toFixed(2),
        }))
      : [{ costCodeId: "", description: "", amount: "" }],
  );

  const ready =
    contractId !== "" && number.trim() !== "" && title.trim() !== "";

  const costTyped = lines.reduce((sum, l) => {
    const n = Number(l.amount.replace(/[,\s$]/g, ""));
    return Number.isFinite(n) && l.amount.trim() !== "" ? sum + n : sum;
  }, 0);

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, j) => (i === j ? { ...l, ...patch } : l)));
  }

  function changeStatus(next: string) {
    setStatus(next);
    if (next === "approved" && approvedOn === "") setApprovedOn(today());
  }

  function submit() {
    startTransition(async () => {
      const payload = {
        projectId,
        contractId,
        number: number.trim(),
        title: title.trim(),
        description: description.trim(),
        status,
        valueCents: value,
        requestedOn,
        approvedOn: status === "approved" ? approvedOn : "",
        notes: notes.trim(),
        // Nothing to cost against means nothing is sent, whatever a hidden
        // row might still hold.
        lines:
          costCodes.length === 0
            ? []
            : lines.map((l) => ({
                costCodeId: l.costCodeId,
                description: l.description.trim(),
                amountCents: l.amount,
              })),
      };
      const result = editing
        ? await updateChangeOrderAction({
            ...payload,
            id: existing.id,
            version: existing.version,
          })
        : await createChangeOrderAction(payload);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Change order saved" : "Change order added");
      setOpen(false);
      if (!editing) {
        // The contract stays: several change orders on one agreement in a row
        // is the ordinary way these get entered. Everything that is money or
        // status resets, for the reason ContractForm gives.
        setNumber("");
        setTitle("");
        setDescription("");
        setStatus("proposed");
        setValue("");
        setRequestedOn("");
        setApprovedOn("");
        setNotes("");
        setLines([{ costCodeId: "", description: "", amount: "" }]);
      }
      router.refresh();
    });
  }

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-4" /> Add change order
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit change order" : "New change order"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="co-contract">Against</Label>
              {editing ? (
                <p className="text-sm">
                  {contracts.find((c) => c.id === existing.contractId)?.label ??
                    "This contract"}
                  <span className="block text-xs text-muted-foreground">
                    A change order stays on the agreement it was raised against.
                  </span>
                </p>
              ) : (
                <Select value={contractId} onValueChange={setContractId}>
                  <SelectTrigger className="w-full" id="co-contract">
                    <SelectValue placeholder="Which agreement this changes" />
                  </SelectTrigger>
                  <SelectContent>
                    {contracts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="co-number">Number</Label>
                <Input
                  id="co-number"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="CO-3"
                  maxLength={40}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="co-title">Title</Label>
                <Input
                  id="co-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Add covered porch"
                  maxLength={200}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="co-description">What changes</Label>
              <Textarea
                id="co-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="The scope, as it will read on the pay application"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="co-value">Price to the client</Label>
                <Input
                  id="co-value"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="12,500"
                  inputMode="decimal"
                />
                <p className="text-xs text-muted-foreground">
                  What the contract value moves by. Negative for a deduction.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="co-requested">Requested</Label>
                <Input
                  id="co-requested"
                  type="date"
                  value={requestedOn}
                  onChange={(e) => setRequestedOn(e.target.value)}
                />
              </div>
            </div>

            {costCodes.length === 0 ? (
              /*
                FOUND BY DRIVING IT: the job's only code was retired, so the
                line's dropdown opened on nothing and the form said nothing
                about why. An empty listbox is a form lying about a choice it
                cannot offer. The price still moves the contract value, and a
                change order with no lines is a legitimate thing to be.
              */
              <p className="rounded-lg border border-border/60 p-3 text-xs text-muted-foreground">
                No active cost codes on this job&apos;s list, so the change
                cannot be costed by code yet. Its price still moves the contract
                value; add or restore a code under Cost codes to move the
                budget.
              </p>
            ) : (
              <div className="space-y-2 rounded-lg border border-border/60 p-3">
                <div className="flex items-center justify-between">
                  <Label>Cost, by code</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setLines((prev) => [
                        ...prev,
                        { costCodeId: "", description: "", amount: "" },
                      ])
                    }
                  >
                    <Plus className="mr-1.5 size-4" /> Add line
                  </Button>
                </div>
                {lines.map((line, i) => (
                  <div
                    key={i}
                    className="grid gap-2 sm:grid-cols-[1fr_1fr_7rem_2rem]"
                  >
                    <Select
                      value={line.costCodeId}
                      onValueChange={(v) => setLine(i, { costCodeId: v })}
                    >
                      <SelectTrigger aria-label={`Cost code, line ${i + 1}`}>
                        <SelectValue placeholder="Cost code" />
                      </SelectTrigger>
                      <SelectContent>
                        {/* No "no code" choice: a line's only job is to move a code's budget. */}
                        {costCodes.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      aria-label={`Description, line ${i + 1}`}
                      value={line.description}
                      onChange={(e) =>
                        setLine(i, { description: e.target.value })
                      }
                      placeholder="Optional"
                      maxLength={200}
                    />
                    <Input
                      aria-label={`Amount, line ${i + 1}`}
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
                      disabled={lines.length === 1}
                      onClick={() =>
                        setLines((prev) => prev.filter((_, j) => j !== i))
                      }
                    >
                      <Trash2 className="size-4" />
                      <span className="sr-only">Remove line {i + 1}</span>
                    </Button>
                  </div>
                ))}
                <div className="flex items-start justify-between gap-4 pt-1">
                  <p className="text-xs text-muted-foreground">
                    What the change is expected to cost you, by cost code — the
                    budget moves by these, not by the price. A line with no
                    amount is ignored. Negative moves a code down.
                  </p>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    Cost typed{" "}
                    {costTyped.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="co-status">Status</Label>
                <Select value={status} onValueChange={changeStatus}>
                  <SelectTrigger className="w-full" id="co-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANGE_ORDER_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {CHANGE_ORDER_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Only an approved change order moves the contract value and the
                  budget.
                </p>
              </div>
              {status === "approved" && (
                <div className="space-y-1.5">
                  <Label htmlFor="co-approved">Approved on</Label>
                  <Input
                    id="co-approved"
                    type="date"
                    value={approvedOn}
                    onChange={(e) => setApprovedOn(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="co-notes">Notes</Label>
              <Textarea
                id="co-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={2000}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || !ready}>
              {pending
                ? editing
                  ? "Saving…"
                  : "Adding…"
                : editing
                  ? "Save"
                  : "Add change order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
