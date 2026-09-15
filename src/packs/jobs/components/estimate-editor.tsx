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
  acceptEstimateAction,
  applyEstimateToBudgetAction,
  applyEstimateToScheduleAction,
  createEstimateAction,
  updateEstimateAction,
} from "../actions";
import { quantityStringToThousandths, thousandthsToQuantityString } from "../billing-math";
import { estimateTotals, lineCostCents, linePriceCents, rateStringToPpm } from "../estimate-math";
import { ESTIMATE_STATUSES, ESTIMATE_STATUS_LABELS } from "../vocabulary";

const NONE = "__none__";

function fmt(cents: number, symbol: string | null): string {
  const abs = `${symbol ?? ""}${(Math.abs(cents) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return cents < 0 ? `−${abs}` : abs;
}

const toCents = (s: string): number => {
  const n = Number(s.replace(/[,\s$]/g, ""));
  return Number.isFinite(n) && s.trim() !== "" ? Math.round(n * 100) : 0;
};

const ppmToRate = (ppm: number | null): string => (ppm === null ? "" : String(ppm / 10_000));

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface LineDraft {
  id: string | null;
  costCodeId: string;
  description: string;
  unit: string;
  quantity: string;
  unitCost: string;
  markup: string;
  unitPrice: string;
}

const emptyLine = (): LineDraft => ({
  id: null,
  costCodeId: NONE,
  description: "",
  unit: "",
  quantity: "",
  unitCost: "",
  markup: "",
  unitPrice: "",
});

/** A draft row as the arithmetic reads it. */
function figuresOf(l: LineDraft) {
  return {
    quantityThousandths: l.quantity.trim() === "" ? 1000 : (quantityStringToThousandths(l.quantity) ?? 0),
    unitCostCents: toCents(l.unitCost),
    markupPpm: l.markup.trim() === "" ? null : rateStringToPpm(l.markup),
    unitPriceCents: l.unitPrice.trim() === "" ? null : toCents(l.unitPrice),
  };
}

export interface EditableEstimate {
  id: string;
  version: number;
  number: string;
  title: string;
  status: string;
  sentOn: string | null;
  decidedOn: string | null;
  validUntil: string | null;
  markupPpm: number;
  overheadPpm: number;
  profitPpm: number;
  notes: string;
  contractId: string | null;
  lines: Array<{
    id: string;
    costCodeId: string | null;
    description: string;
    unit: string;
    quantityThousandths: number;
    unitCostCents: number;
    markupPpm: number | null;
    unitPriceCents: number | null;
  }>;
}

/**
 * Start an estimate: a number and a title, then the page for its lines. The
 * pack's other dialogs take everything at once; an estimate is too long for
 * one, and the lines are the work.
 */
export function NewEstimateDialog({ projectId, trigger }: { projectId: string; trigger?: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [number, setNumber] = useState("");
  const [title, setTitle] = useState("");
  function submit() {
    startTransition(async () => {
      const result = await createEstimateAction({ projectId, number: number.trim(), title: title.trim() });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Estimate started");
      setOpen(false);
      router.push(`/dashboard/m/jobs/${projectId}/estimates/${result.estimateId}`);
    });
  }
  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-4" /> New estimate
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New estimate</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ne-number">Number</Label>
              <Input
                id="ne-number"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="EST-1"
                maxLength={40}
              />
              <p className="text-xs text-muted-foreground">However you number them. Different from the job&apos;s other estimates.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ne-title">Title</Label>
              <Input
                id="ne-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="New home, as drawn"
                maxLength={200}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || number.trim() === ""}>
              {pending ? "Starting…" : "Start estimate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The estimate, whole: the header and its rates, the lines with cost and
 * price computed as they are typed, the totals, and — for an owner — the
 * three acts that make it money: accept it onto a contract, make it the
 * budget, make it a contract's schedule of values (ADR 0069).
 *
 * **COST AND PRICE ARE TWO NUMBERS ON EVERY LINE.** A line sells at a markup
 * on its cost — the line's own or the estimate's default — unless a price
 * per unit is typed, which is how a unit-price bid is written. The extended
 * figures are never typed; the same rule the change order and the schedule
 * of values keep.
 *
 * **AN ACCEPTED ESTIMATE IS FIXED.** Its money became a contract's value, a
 * budget or a schedule; the rates and lines are shown and not sent. Revise
 * by starting a new one and marking this one superseded.
 */
export function EstimateEditor({
  projectId,
  estimate,
  codes,
  contracts,
  canEdit,
  isOwner,
  symbol,
}: {
  projectId: string;
  estimate: EditableEstimate;
  codes: Array<{ id: string; label: string }>;
  contracts: Array<{ id: string; label: string; status: string }>;
  canEdit: boolean;
  isOwner: boolean;
  symbol: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const locked = estimate.status === "accepted";
  const editable = canEdit && !locked;
  const [number, setNumber] = useState(estimate.number);
  const [title, setTitle] = useState(estimate.title);
  const [status, setStatus] = useState(estimate.status);
  const [sentOn, setSentOn] = useState(estimate.sentOn ?? "");
  const [decidedOn, setDecidedOn] = useState(estimate.decidedOn ?? "");
  const [validUntil, setValidUntil] = useState(estimate.validUntil ?? "");
  const [markup, setMarkup] = useState(ppmToRate(estimate.markupPpm));
  const [overhead, setOverhead] = useState(ppmToRate(estimate.overheadPpm));
  const [profit, setProfit] = useState(ppmToRate(estimate.profitPpm));
  const [notes, setNotes] = useState(estimate.notes);
  const [lines, setLines] = useState<LineDraft[]>(
    estimate.lines.length > 0
      ? estimate.lines.map((l) => ({
          id: l.id,
          costCodeId: l.costCodeId ?? NONE,
          description: l.description,
          unit: l.unit,
          quantity: l.quantityThousandths === 1000 ? "" : thousandthsToQuantityString(l.quantityThousandths),
          unitCost: l.unitCostCents === 0 ? "" : (l.unitCostCents / 100).toFixed(2),
          markup: ppmToRate(l.markupPpm),
          unitPrice: l.unitPriceCents === null ? "" : (l.unitPriceCents / 100).toFixed(2),
        }))
      : [emptyLine()],
  );

  const terms = {
    markupPpm: rateStringToPpm(markup) ?? 0,
    overheadPpm: rateStringToPpm(overhead) ?? 0,
    profitPpm: rateStringToPpm(profit) ?? 0,
  };
  const figures = lines.filter((l) => l.description.trim() !== "").map(figuresOf);
  const totals = estimateTotals(figures, terms);

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, j) => (i === j ? { ...l, ...patch } : l)));
  }
  function changeStatus(next: string) {
    setStatus(next);
    if (next === "sent" && sentOn === "") setSentOn(today());
    if ((next === "declined" || next === "accepted") && decidedOn === "") setDecidedOn(today());
  }

  function save() {
    startTransition(async () => {
      const payload = {
        projectId,
        id: estimate.id,
        version: estimate.version,
        number: number.trim(),
        title: title.trim(),
        status,
        sentOn,
        decidedOn,
        validUntil,
        notes: notes.trim(),
        // An accepted estimate's money is not sent: the rates and the lines stay as they were.
        ...(locked
          ? {}
          : {
              markupPercent: markup,
              overheadPercent: overhead,
              profitPercent: profit,
              lines: lines
                .filter((l) => l.description.trim() !== "")
                .map((l) => ({
                  id: l.id ?? "",
                  costCodeId: l.costCodeId === NONE ? "" : l.costCodeId,
                  description: l.description.trim(),
                  unit: l.unit.trim(),
                  quantity: l.quantity,
                  unitCostCents: l.unitCost,
                  markupPercent: l.markup,
                  unitPriceCents: l.unitPrice,
                })),
            }),
      };
      const result = await updateEstimateAction(payload);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Estimate saved");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/60 p-4">
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr_10rem]">
          <div className="space-y-1.5">
            <Label htmlFor="est-number">Number</Label>
            <Input id="est-number" value={number} onChange={(e) => setNumber(e.target.value)} maxLength={40} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="est-title">Title</Label>
            <Input id="est-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="est-status">Status</Label>
            <Select value={status} onValueChange={changeStatus} disabled={!canEdit || locked}>
              <SelectTrigger className="w-full" id="est-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ESTIMATE_STATUSES.filter((s) => s !== "accepted" || locked).map((s) => (
                  <SelectItem key={s} value={s}>
                    {ESTIMATE_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="est-sent">Sent</Label>
            <Input id="est-sent" type="date" value={sentOn} onChange={(e) => setSentOn(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="est-valid">Valid until</Label>
            <Input id="est-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="est-decided">Decided</Label>
            <Input id="est-decided" type="date" value={decidedOn} onChange={(e) => setDecidedOn(e.target.value)} disabled={!canEdit} />
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="est-markup">Markup on cost, %</Label>
            <Input id="est-markup" value={markup} onChange={(e) => setMarkup(e.target.value)} placeholder="0" inputMode="decimal" disabled={!editable} />
            <p className="text-xs text-muted-foreground">Every line takes this unless it says otherwise.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="est-overhead">Overhead, %</Label>
            <Input id="est-overhead" value={overhead} onChange={(e) => setOverhead(e.target.value)} placeholder="0" inputMode="decimal" disabled={!editable} />
            <p className="text-xs text-muted-foreground">On the lines&apos; price.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="est-profit">Profit, %</Label>
            <Input id="est-profit" value={profit} onChange={(e) => setProfit(e.target.value)} placeholder="0" inputMode="decimal" disabled={!editable} />
            <p className="text-xs text-muted-foreground">On the price plus overhead.</p>
          </div>
        </div>
        {locked && (
          <p className="mt-3 text-xs text-muted-foreground">
            Accepted, so the rates and the lines are fixed. To revise, start a new estimate and mark this one superseded.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border/60 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-heading text-sm font-medium tracking-heading">Lines</h2>
          {editable && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
              <Plus className="mr-1.5 size-4" /> Add line
            </Button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="px-1 py-1.5 text-left">Cost code</th>
                <th className="px-1 py-1.5 text-left">Description</th>
                <th className="px-1 py-1.5 text-right">Qty</th>
                <th className="px-1 py-1.5 text-left">Unit</th>
                <th className="px-1 py-1.5 text-right">Unit cost</th>
                <th className="px-1 py-1.5 text-right">Markup %</th>
                <th className="px-1 py-1.5 text-right">Unit price</th>
                <th className="px-1 py-1.5 text-right">Cost</th>
                <th className="px-1 py-1.5 text-right">Price</th>
                {editable && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const f = figuresOf(l);
                const blank = l.description.trim() === "";
                return (
                  <tr key={l.id ?? `new-${i}`} className="border-t border-border/50 align-top">
                    <td className="px-1 py-1">
                      <Select value={l.costCodeId} onValueChange={(v) => setLine(i, { costCodeId: v })} disabled={!editable}>
                        <SelectTrigger aria-label={`Cost code, line ${i + 1}`} className="h-8 w-40">
                          <SelectValue placeholder="Code" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>No code</SelectItem>
                          {codes.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        aria-label={`Description, line ${i + 1}`}
                        value={l.description}
                        onChange={(e) => setLine(i, { description: e.target.value })}
                        placeholder="Tile, master bath floor"
                        maxLength={300}
                        className="h-8 min-w-48"
                        disabled={!editable}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        aria-label={`Quantity, line ${i + 1}`}
                        value={l.quantity}
                        onChange={(e) => setLine(i, { quantity: e.target.value })}
                        placeholder="1"
                        inputMode="decimal"
                        className="h-8 w-20 text-right"
                        disabled={!editable}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        aria-label={`Unit, line ${i + 1}`}
                        value={l.unit}
                        onChange={(e) => setLine(i, { unit: e.target.value })}
                        placeholder="ls"
                        maxLength={20}
                        className="h-8 w-16"
                        disabled={!editable}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        aria-label={`Unit cost, line ${i + 1}`}
                        value={l.unitCost}
                        onChange={(e) => setLine(i, { unitCost: e.target.value })}
                        placeholder="0.00"
                        inputMode="decimal"
                        className="h-8 w-24 text-right"
                        disabled={!editable}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        aria-label={`Markup, line ${i + 1}`}
                        value={l.markup}
                        onChange={(e) => setLine(i, { markup: e.target.value })}
                        placeholder={markup.trim() === "" ? "0" : markup}
                        inputMode="decimal"
                        className="h-8 w-20 text-right"
                        disabled={!editable || l.unitPrice.trim() !== ""}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        aria-label={`Unit price, line ${i + 1}`}
                        value={l.unitPrice}
                        onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                        placeholder="by markup"
                        inputMode="decimal"
                        className="h-8 w-24 text-right"
                        disabled={!editable}
                      />
                    </td>
                    <td className="px-1 py-2 text-right tabular-nums text-muted-foreground">
                      {blank ? "—" : fmt(lineCostCents(f), symbol)}
                    </td>
                    <td className="px-1 py-2 text-right tabular-nums">
                      {blank ? "—" : fmt(linePriceCents(f, terms.markupPpm), symbol)}
                    </td>
                    {editable && (
                      <td className="px-1 py-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={lines.length === 1}
                          onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="size-4" />
                          <span className="sr-only">Remove line {i + 1}</span>
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          A line is a quantity of a unit at a cost — a blank quantity is one, a lump sum. It sells at the markup on its
          cost, this line&apos;s or the estimate&apos;s, unless a price per unit is typed, which wins. A line with no
          description is ignored.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-6">
        {(
          [
            ["Cost", totals.costCents],
            ["Price", totals.subtotalCents],
            ["Overhead", totals.overheadCents],
            ["Profit", totals.profitCents],
            ["Total", totals.totalCents],
            ["Margin", totals.marginCents],
          ] as const
        ).map(([label, cents]) => (
          <div key={label} className="rounded-lg bg-muted/40 px-3 py-2">
            <dt className="text-xs text-muted-foreground">
              {label}
              {label === "Margin" && totals.marginPpm !== null && ` · ${(totals.marginPpm / 10_000).toFixed(1)}%`}
            </dt>
            <dd className="text-base font-medium tabular-nums">{fmt(cents, symbol)}</dd>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="est-notes">Notes</Label>
        <Textarea id="est-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={4000} disabled={!canEdit} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {isOwner && (
            <>
              <ApplyToBudgetButton projectId={projectId} estimateId={estimate.id} costCents={totals.costCents} symbol={symbol} />
              <ApplyToScheduleDialog projectId={projectId} estimateId={estimate.id} contracts={contracts} totalCents={totals.totalCents} symbol={symbol} />
              {!locked && (
                <AcceptEstimateDialog
                  projectId={projectId}
                  estimateId={estimate.id}
                  version={estimate.version}
                  contracts={contracts}
                  totalCents={totals.totalCents}
                  symbol={symbol}
                />
              )}
            </>
          )}
        </div>
        {canEdit && (
          <Button onClick={save} disabled={pending || number.trim() === ""}>
            {pending ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
    </div>
  );
}

function ApplyToBudgetButton({
  projectId,
  estimateId,
  costCents,
  symbol,
}: {
  projectId: string;
  estimateId: string;
  costCents: number;
  symbol: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Use as budget
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Make this the budget</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Each cost code&apos;s cost on this estimate — {fmt(costCents, symbol)}{" "}in all, as saved — becomes that
            code&apos;s original budget on the job, replacing what the code had. Lines with no cost code have
            nowhere to land and are left out. Change orders keep revising the budget from there.
          </p>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await applyEstimateToBudgetAction({ projectId, id: estimateId });
                  if ("error" in result) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success(
                    `Budget set on ${result.codes} ${result.codes === 1 ? "code" : "codes"}${
                      result.uncodedCents > 0 ? ` — ${fmt(result.uncodedCents, symbol)} on lines with no code left out` : ""
                    }`,
                  );
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending ? "Writing…" : "Make it the budget"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ApplyToScheduleDialog({
  projectId,
  estimateId,
  contracts,
  totalCents,
  symbol,
}: {
  projectId: string;
  estimateId: string;
  contracts: Array<{ id: string; label: string; status: string }>;
  totalCents: number;
  symbol: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [contractId, setContractId] = useState(contracts.length === 1 ? contracts[0].id : "");
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={contracts.length === 0}>
        Use as schedule of values
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Make this the schedule of values</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              One schedule line per estimate line at its price, with overhead and profit spread across them in
              proportion, so the schedule adds up to the estimate&apos;s total — {fmt(totalCents, symbol)}{" "}as saved —
              replacing the contract&apos;s schedule. A line sold at a price per unit keeps billing by the quantity,
              its unit price raised by the same share. A line an application has billed against cannot be removed.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="ats-contract">Contract</Label>
              <Select value={contractId} onValueChange={setContractId}>
                <SelectTrigger className="w-full" id="ats-contract">
                  <SelectValue placeholder="Which agreement" />
                </SelectTrigger>
                <SelectContent>
                  {contracts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={pending || contractId === ""}
              onClick={() =>
                startTransition(async () => {
                  const result = await applyEstimateToScheduleAction({ projectId, id: estimateId, contractId });
                  if ("error" in result) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success(`Schedule written: ${result.lines} ${result.lines === 1 ? "line" : "lines"}, ${fmt(result.scheduledCents, symbol)}`);
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending ? "Writing…" : "Make it the schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AcceptEstimateDialog({
  projectId,
  estimateId,
  version,
  contracts,
  totalCents,
  symbol,
}: {
  projectId: string;
  estimateId: string;
  version: number;
  contracts: Array<{ id: string; label: string; status: string }>;
  totalCents: number;
  symbol: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [contractId, setContractId] = useState(contracts.length === 1 ? contracts[0].id : "");
  const [decidedOn, setDecidedOn] = useState(today());
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={contracts.length === 0}>
        Accept
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Accept this estimate</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The client said yes. The estimate becomes the contract&apos;s value — {fmt(totalCents, symbol)}, as saved —
              and is fixed from here; a signed contract&apos;s value is refused, and moves by change order.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="acc-contract">Contract</Label>
              <Select value={contractId} onValueChange={setContractId}>
                <SelectTrigger className="w-full" id="acc-contract">
                  <SelectValue placeholder="Which agreement it priced" />
                </SelectTrigger>
                <SelectContent>
                  {contracts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-decided">Accepted on</Label>
              <Input id="acc-decided" type="date" value={decidedOn} onChange={(e) => setDecidedOn(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={pending || contractId === "" || decidedOn === ""}
              onClick={() =>
                startTransition(async () => {
                  const result = await acceptEstimateAction({ projectId, id: estimateId, contractId, decidedOn, version });
                  if ("error" in result) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success("Estimate accepted");
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending ? "Accepting…" : "Accept"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
