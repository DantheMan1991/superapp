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
import { createCommitmentAction, updateCommitmentAction } from "../actions";
import {
  COMMITMENT_KINDS,
  COMMITMENT_KIND_LABELS,
  COMMITMENT_STATUSES,
  COMMITMENT_STATUS_LABELS,
} from "../vocabulary";

const NONE = "__none__";

interface LineDraft {
  costCodeId: string;
  description: string;
  amount: string;
}

export interface EditableCommitment {
  id: string;
  version: number;
  partyId: string;
  kind: string;
  number: string;
  description: string;
  status: string;
  issuedOn: string | null;
  notes: string;
  lines: Array<{ costCodeId: string | null; description: string; amountCents: number }>;
}

/**
 * Order something on a job: a purchase order, or a subcontract.
 *
 * **ONE LINE BY DEFAULT, MORE ON DEMAND.** One line is the common case — a PO
 * for lumber is one code — and a framing subcontract covering labour and
 * materials is two or three. The rows are the money; the header is who and which
 * number.
 *
 * **THE COST CODE IS WHAT MAKES IT WORTH RECORDING.** A committed total with no
 * code says the job is over; a committed total by code says which trade, which
 * is the difference between a number and an answer. It is still optional,
 * because a business that has not built its chart yet has to be able to record
 * what it ordered.
 */
export function CommitmentForm({
  projectId,
  parties,
  costCodes,
  existing,
  trigger,
}: {
  projectId: string;
  parties: Array<{ id: string; name: string }>;
  costCodes: Array<{ id: string; label: string }>;
  existing?: EditableCommitment;
  trigger?: ReactNode;
}) {
  const editing = existing !== undefined;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [partyId, setPartyId] = useState(existing?.partyId ?? "");
  const [kind, setKind] = useState(existing?.kind ?? "purchase_order");
  const [number, setNumber] = useState(existing?.number ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [status, setStatus] = useState(existing?.status ?? "draft");
  const [issuedOn, setIssuedOn] = useState(existing?.issuedOn ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(
    existing && existing.lines.length > 0
      ? existing.lines.map((l) => ({
          costCodeId: l.costCodeId ?? NONE,
          description: l.description,
          amount: (l.amountCents / 100).toFixed(2),
        }))
      : [{ costCodeId: NONE, description: "", amount: "" }],
  );

  const ready = partyId !== "" && number.trim() !== "" && lines.some((l) => l.amount.trim() !== "");

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, j) => (i === j ? { ...l, ...patch } : l)));
  }

  function submit() {
    startTransition(async () => {
      const payload = {
        projectId,
        partyId,
        kind,
        number: number.trim(),
        description: description.trim(),
        status,
        issuedOn,
        notes: notes.trim(),
        lines: lines.map((l) => ({
          costCodeId: l.costCodeId === NONE ? "" : l.costCodeId,
          description: l.description.trim(),
          amountCents: l.amount,
        })),
      };
      const result = editing
        ? await updateCommitmentAction({
            ...payload,
            id: existing.id,
            version: existing.version,
          })
        : await createCommitmentAction(payload);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Order saved" : "Order added");
      setOpen(false);
      if (!editing) {
        setPartyId("");
        setNumber("");
        setDescription("");
        setStatus("draft");
        setKind("purchase_order");
        setIssuedOn("");
        setNotes("");
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
          <Plus className="mr-1.5 size-4" /> Order something
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit order" : "New order"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="c-kind">Kind</Label>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger className="w-full" id="c-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMITMENT_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {COMMITMENT_KIND_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-number">Number</Label>
                <Input
                  id="c-number"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="PO-1042"
                  maxLength={40}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="c-party">Who is being paid</Label>
              <Select value={partyId} onValueChange={setPartyId}>
                <SelectTrigger className="w-full" id="c-party">
                  <SelectValue placeholder="Pick a supplier or subcontractor" />
                </SelectTrigger>
                <SelectContent>
                  {parties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {parties.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nobody on file yet. Add them in Accounting first — an order has
                  to be to somebody.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="c-description">What it is for</Label>
              <Input
                id="c-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Framing labour and materials"
                maxLength={300}
              />
            </div>

            <div className="space-y-2 rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between">
                <Label>Lines</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setLines((prev) => [
                      ...prev,
                      { costCodeId: NONE, description: "", amount: "" },
                    ])
                  }
                >
                  <Plus className="mr-1.5 size-4" /> Add line
                </Button>
              </div>
              {lines.map((line, i) => (
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
              ))}
              <p className="text-xs text-muted-foreground">
                A line with no amount is ignored, so the empty last row costs
                nothing.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="c-status">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-full" id="c-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMITMENT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {COMMITMENT_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  A draft is not committed. Issued and closed both count.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-issued">Issued</Label>
                <Input
                  id="c-issued"
                  type="date"
                  value={issuedOn}
                  onChange={(e) => setIssuedOn(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="c-notes">Notes</Label>
              <Textarea
                id="c-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={2000}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || !ready}>
              {pending ? (editing ? "Saving…" : "Adding…") : editing ? "Save" : "Add order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
