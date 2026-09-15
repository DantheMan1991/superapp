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
import {
  createCommitmentChangeOrderAction,
  updateCommitmentChangeOrderAction,
} from "../actions";
import { CHANGE_ORDER_STATUSES, CHANGE_ORDER_STATUS_LABELS } from "../vocabulary";

const NONE = "__none__";

interface LineDraft {
  costCodeId: string;
  description: string;
  amount: string;
}

export interface EditableCommitmentChange {
  id: string;
  version: number;
  number: string;
  title: string;
  description: string;
  status: string;
  requestedOn: string | null;
  approvedOn: string | null;
  notes: string;
  changeOrderId: string | null;
  lines: Array<{ costCodeId: string | null; description: string; amountCents: number }>;
  /** A subcontractor has billed against it: the status and the lines are fixed. */
  billed: boolean;
}

/** Today as the `date` input wants it, in the person's own timezone. */
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatTyped(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Raise a change order against ONE order — a subcontract or a purchase order
 * (ADR 0065).
 *
 * **THE LINES ARE THE MONEY, AND THEY JOIN THE ORDER.** There is no price box:
 * what the order moves by is the lines added up, by cost code, and once the
 * change is approved those lines are the subcontract's lines — the next
 * application bills them beside the original ones. A line may be NEGATIVE:
 * scope taken back is `-2,000`, not a separate form. No lines at all is fine —
 * a time extension has none.
 *
 * **PASSES DOWN** names the client's change order this one is the
 * subcontractor's share of, when there is one; a change the business absorbs
 * itself has none.
 *
 * **BILLED MEANS FIXED.** Once the subcontractor has billed against it, the
 * status stays approved and the lines are shown but not editable; the words
 * still are. The action refuses either behind the form's back.
 */
export function CommitmentChangeForm({
  projectId,
  commitmentId,
  commitmentLabel,
  changeOrders,
  costCodes,
  existing,
  trigger,
}: {
  projectId: string;
  commitmentId: string;
  /** "SC-24109-1 · Rough carpentry" — what the dialog says it is against. */
  commitmentLabel: string;
  /** The job's client-side change orders, for `Passes down`. */
  changeOrders: Array<{ id: string; label: string }>;
  costCodes: Array<{ id: string; label: string }>;
  existing?: EditableCommitmentChange;
  trigger?: ReactNode;
}) {
  const editing = existing !== undefined;
  const billed = existing?.billed ?? false;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [number, setNumber] = useState(existing?.number ?? "");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [status, setStatus] = useState(existing?.status ?? "proposed");
  const [requestedOn, setRequestedOn] = useState(existing?.requestedOn ?? "");
  const [approvedOn, setApprovedOn] = useState(existing?.approvedOn ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [passesDown, setPassesDown] = useState(existing?.changeOrderId ?? NONE);
  const [lines, setLines] = useState<LineDraft[]>(
    existing && existing.lines.length > 0
      ? existing.lines.map((l) => ({
          costCodeId: l.costCodeId ?? NONE,
          description: l.description,
          amount: (l.amountCents / 100).toFixed(2),
        }))
      : [{ costCodeId: NONE, description: "", amount: "" }],
  );

  const ready = number.trim() !== "" && title.trim() !== "";

  const typed = lines.reduce((sum, l) => {
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
        commitmentId,
        number: number.trim(),
        title: title.trim(),
        description: description.trim(),
        requestedOn,
        notes: notes.trim(),
        changeOrderId: passesDown === NONE ? "" : passesDown,
        // A billed change keeps its status and its lines: neither is sent.
        ...(billed
          ? {}
          : {
              status,
              approvedOn: status === "approved" ? approvedOn : "",
              lines: lines.map((l) => ({
                costCodeId: l.costCodeId === NONE ? "" : l.costCodeId,
                description: l.description.trim(),
                amountCents: l.amount,
              })),
            }),
      };
      const result = editing
        ? await updateCommitmentChangeOrderAction({
            ...payload,
            id: existing.id,
            version: existing.version,
          })
        : await createCommitmentChangeOrderAction(payload);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Change order saved" : "Change order added");
      setOpen(false);
      if (!editing) {
        setNumber("");
        setTitle("");
        setDescription("");
        setStatus("proposed");
        setRequestedOn("");
        setApprovedOn("");
        setNotes("");
        setPassesDown(NONE);
        setLines([{ costCodeId: NONE, description: "", amount: "" }]);
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
            <DialogTitle>{editing ? "Edit change order" : "New change order"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Against</Label>
              <p className="text-sm">
                {commitmentLabel}
                <span className="block text-xs text-muted-foreground">
                  A change order stays on the order it was raised against.
                </span>
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="cco-number">Number</Label>
                <Input
                  id="cco-number"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="SCO-1"
                  maxLength={40}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cco-title">Title</Label>
                <Input
                  id="cco-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Extra blocking at the stair"
                  maxLength={200}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cco-description">What changes</Label>
              <Textarea
                id="cco-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="The scope, as it will read on the subcontractor's application"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cco-passes">Passes down</Label>
                <Select value={passesDown} onValueChange={setPassesDown}>
                  <SelectTrigger className="w-full" id="cco-passes">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None — a change of our own</SelectItem>
                    {changeOrders.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The client&apos;s change order this is the subcontractor&apos;s share of, if any.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cco-requested">Requested</Label>
                <Input
                  id="cco-requested"
                  type="date"
                  value={requestedOn}
                  onChange={(e) => setRequestedOn(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between">
                <Label>Lines</Label>
                {!billed && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setLines((prev) => [...prev, { costCodeId: NONE, description: "", amount: "" }])
                    }
                  >
                    <Plus className="mr-1.5 size-4" /> Add line
                  </Button>
                )}
              </div>
              {billed ? (
                /*
                  FIXED ONCE BILLED. The subcontractor's certificate points at
                  these lines and their money is on the job, so they are shown
                  as they are and not sent back.
                */
                <ul className="space-y-1 text-sm">
                  {lines.map((l, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="truncate">
                        {costCodes.find((c) => c.id === l.costCodeId)?.label ?? "No code"}
                        {l.description && (
                          <span className="text-muted-foreground"> · {l.description}</span>
                        )}
                      </span>
                      <span className="shrink-0 tabular-nums">{l.amount}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                lines.map((line, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_7rem_2rem]">
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
                    <Input
                      aria-label={`Description, line ${i + 1}`}
                      value={line.description}
                      onChange={(e) => setLine(i, { description: e.target.value })}
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
                      onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-4" />
                      <span className="sr-only">Remove line {i + 1}</span>
                    </Button>
                  </div>
                ))
              )}
              <div className="flex items-start justify-between gap-4 pt-1">
                <p className="text-xs text-muted-foreground">
                  {billed
                    ? "The subcontractor has billed against this change, so its lines are fixed. Raise another change to move the order again."
                    : "What the order moves by, by cost code — once approved, these are the order's lines and the next application bills them. A line with no amount is ignored. Negative takes scope back. No lines at all is fine."}
                </p>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {billed ? "" : `Typed ${formatTyped(typed)}`}
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cco-status">Status</Label>
                <Select value={status} onValueChange={changeStatus} disabled={billed}>
                  <SelectTrigger className="w-full" id="cco-status">
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
                  {billed
                    ? "Billed against, so it stays approved."
                    : "Only an approved change moves the order and reaches the subcontractor's next application."}
                </p>
              </div>
              {status === "approved" && (
                <div className="space-y-1.5">
                  <Label htmlFor="cco-approved">Approved on</Label>
                  <Input
                    id="cco-approved"
                    type="date"
                    value={approvedOn}
                    onChange={(e) => setApprovedOn(e.target.value)}
                    disabled={billed}
                  />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cco-notes">Notes</Label>
              <Textarea
                id="cco-notes"
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
