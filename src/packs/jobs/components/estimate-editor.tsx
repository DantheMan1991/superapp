"use client";

import { Fragment, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EyeOff, FileText, FolderPlus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  estimateTotals,
  groupCostCents,
  groupPriceCents,
  lineCostCents,
  linePriceCents,
  rateStringToPpm,
} from "../estimate-math";
import {
  ESTIMATE_STATUSES,
  ESTIMATE_STATUS_LABELS,
  GROUP_PRICE_MODES,
  GROUP_PRICE_MODE_LABELS,
  PROPOSAL_PRESENTATIONS,
  PROPOSAL_PRESENTATION_LABELS,
  type GroupPriceMode,
} from "../vocabulary";

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

/**
 * A CLIENT-FACING ITEM being edited (ADR 0079). `key` is what this item's
 * lines hold: its id once it has one, a local key until then, which is what
 * lets a new item and its lines be saved in one go.
 */
interface GroupDraft {
  id: string | null;
  key: string;
  name: string;
  clientNote: string;
  priceMode: GroupPriceMode;
  fixedPrice: string;
}

let nextKey = 0;
const emptyGroup = (): GroupDraft => ({
  id: null,
  key: `new-item-${(nextKey += 1)}`,
  name: "",
  clientNote: "",
  priceMode: "rollup",
  fixedPrice: "",
});

interface LineDraft {
  id: string | null;
  /** The item this line sits in; "" leaves it loose. */
  groupKey: string;
  costCodeId: string;
  description: string;
  /** What the client reads instead (ADR 0080); blank uses the description. */
  clientDescription: string;
  /** Whether the line is a row on the proposal; only a line in an item may be hidden. */
  clientVisible: boolean;
  unit: string;
  quantity: string;
  unitCost: string;
  markup: string;
  unitPrice: string;
}

const emptyLine = (groupKey = ""): LineDraft => ({
  id: null,
  groupKey,
  costCodeId: NONE,
  description: "",
  clientDescription: "",
  clientVisible: true,
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
  presentation: string;
  scope: string;
  exclusions: string;
  terms: string;
  contractId: string | null;
  /** Whether the by-code proposal prints a code's number (ADR 0080). */
  showCodeNumbers: boolean;
  /** The client-facing items, in their order (ADR 0079). */
  groups: Array<{
    id: string;
    name: string;
    clientNote: string;
    priceMode: string;
    fixedPriceCents: number | null;
  }>;
  lines: Array<{
    id: string;
    groupId: string | null;
    costCodeId: string | null;
    description: string;
    clientDescription: string;
    clientVisible: boolean;
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
  const [presentation, setPresentation] = useState(estimate.presentation);
  const [showCodeNumbers, setShowCodeNumbers] = useState(estimate.showCodeNumbers);
  /**
   * Writing the client's words is a pass of its own, so the two controls that do
   * it are behind one switch and off by default: the table is already wider than
   * its box, and a second input on every row would slow down typing a takeoff.
   */
  const [clientWording, setClientWording] = useState(
    estimate.lines.some((l) => l.clientDescription.trim() !== "" || !l.clientVisible),
  );
  const [scope, setScope] = useState(estimate.scope);
  const [exclusions, setExclusions] = useState(estimate.exclusions);
  const [termsText, setTermsText] = useState(estimate.terms);
  const [lines, setLines] = useState<LineDraft[]>(
    estimate.lines.length > 0
      ? estimate.lines.map((l) => ({
          id: l.id,
          groupKey: l.groupId ?? "",
          clientDescription: l.clientDescription,
          clientVisible: l.clientVisible,
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
  const [groups, setGroups] = useState<GroupDraft[]>(
    estimate.groups.map((g) => ({
      id: g.id,
      key: g.id,
      name: g.name,
      clientNote: g.clientNote,
      priceMode: g.priceMode === "fixed" ? "fixed" : "rollup",
      fixedPrice: g.fixedPriceCents === null ? "" : (g.fixedPriceCents / 100).toFixed(2),
    })),
  );
  const named = groups.filter((g) => g.name.trim() !== "");
  const groupFigures = named.map((g) => ({
    id: g.key,
    priceMode: g.priceMode,
    fixedPriceCents: g.priceMode === "fixed" ? toCents(g.fixedPrice) : null,
  }));
  /** Only a named item can hold a line: a blank row is ignored, so its lines are loose. */
  const keyOf = (l: LineDraft): string | null =>
    named.some((g) => g.key === l.groupKey) ? l.groupKey : null;
  const figures = lines
    .filter((l) => l.description.trim() !== "")
    .map((l) => ({ ...figuresOf(l), groupId: keyOf(l) }));
  const totals = estimateTotals(figures, terms, groupFigures);
  const hasGroups = named.length > 0;
  /** Every item priced by hand leaves the rates nothing to spread over; the page says so. */
  const ratesIdle =
    totals.spreadableCents === 0 &&
    totals.fixedCents > 0 &&
    terms.overheadPpm + terms.profitPpm > 0;

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, j) => (i === j ? { ...l, ...patch } : l)));
  }
  function setGroup(i: number, patch: Partial<GroupDraft>) {
    setGroups((prev) => prev.map((g, j) => (i === j ? { ...g, ...patch } : g)));
  }
  /** Removing an item leaves its lines loose, never deletes what was priced. */
  function removeGroup(key: string) {
    setLines((prev) => prev.map((l) => (l.groupKey === key ? { ...l, groupKey: "" } : l)));
    setGroups((prev) => prev.filter((g) => g.key !== key));
  }
  function addLine(groupKey: string) {
    setLines((prev) => [...prev, emptyLine(groupKey)]);
  }
  /** An item's cost and price as the editor shows them, from the same pure arithmetic. */
  function groupMoney(g: GroupDraft) {
    const children = lines
      .filter((l) => l.groupKey === g.key && l.description.trim() !== "")
      .map(figuresOf);
    const fixed = g.priceMode === "fixed" ? toCents(g.fixedPrice) : null;
    const costCents = groupCostCents(children);
    const priceCents = groupPriceCents(
      { id: g.key, priceMode: g.priceMode, fixedPriceCents: fixed },
      children,
      terms.markupPpm,
    );
    return { costCents, priceCents, marginCents: priceCents - costCents, lineCount: children.length };
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
        presentation,
        showCodeNumbers,
        // An accepted estimate's money is not sent, nor the proposal's words: they are the agreement.
        ...(locked
          ? {}
          : {
              markupPercent: markup,
              overheadPercent: overhead,
              profitPercent: profit,
              scope: scope.trim(),
              exclusions: exclusions.trim(),
              terms: termsText.trim(),
              groups: named.map((g) => ({
                id: g.id ?? "",
                key: g.key,
                name: g.name.trim(),
                clientNote: g.clientNote.trim(),
                priceMode: g.priceMode,
                fixedPriceCents: g.priceMode === "fixed" ? g.fixedPrice : "",
              })),
              // In the order shown: each item's lines beneath it, the loose ones last,
              // so what comes back from the database is already grouped.
              lines: [...named.map((g) => g.key), ""]
                .flatMap((key) =>
                  lines.filter((l) => (keyOf(l) ?? "") === key && l.description.trim() !== ""),
                )
                .map((l) => ({
                  id: l.id ?? "",
                  groupRef: keyOf(l) ?? "",
                  costCodeId: l.costCodeId === NONE ? "" : l.costCodeId,
                  description: l.description.trim(),
                  clientDescription: l.clientDescription.trim(),
                  // A loose line is always shown: hidden money needs an item to hide in.
                  clientVisible: keyOf(l) === null ? true : l.clientVisible,
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

  /**
   * The rows an item holds, and the rows no item holds — by the item's local
   * key, so a line under an item whose name is still blank shows where it was
   * put even though the arithmetic counts it loose (a blank row is ignored).
   */
  const rowsOf = (key: string) => lines.map((l, i) => ({ l, i })).filter(({ l }) => l.groupKey === key);
  const loose = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !groups.some((g) => g.key === l.groupKey));
  const colCount = (hasGroups ? 1 : 0) + 9 + (editable ? 1 : 0);

  /** One line's row. Its first cell is the item it sits in, once the estimate has any. */
  function lineRow(l: LineDraft, i: number) {
    const f = figuresOf(l);
    const blank = l.description.trim() === "";
    return (
      <tr key={l.id ?? `new-${i}`} className="border-t border-border/50 align-top">
        {hasGroups && (
          <td className="px-1 py-1">
            <Select
              value={l.groupKey === "" ? NONE : l.groupKey}
              onValueChange={(v) => setLine(i, { groupKey: v === NONE ? "" : v })}
              disabled={!editable}
            >
              <SelectTrigger aria-label={`Item, line ${i + 1}`} className="h-8 w-36">
                <SelectValue placeholder="Item" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not in an item</SelectItem>
                {named.map((g) => (
                  <SelectItem key={g.key} value={g.key}>
                    {g.name.trim()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Only a line IN an item may be kept off the proposal: hidden money needs
                somewhere to hide, or the printed rows stop adding up (ADR 0080). */}
            {clientWording && keyOf(l) !== null && (
              <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={l.clientVisible}
                  onCheckedChange={(v) => setLine(i, { clientVisible: v === true })}
                  aria-label={`Show line ${i + 1} on the proposal`}
                  disabled={!editable}
                />
                Show it
              </label>
            )}
          </td>
        )}
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
          {clientWording && (
            <Input
              aria-label={`What the client reads, line ${i + 1}`}
              value={l.clientDescription}
              onChange={(e) => setLine(i, { clientDescription: e.target.value })}
              placeholder="What the client reads. Blank uses the line above."
              maxLength={300}
              className="mt-1 h-7 min-w-48 text-xs"
              disabled={!editable}
            />
          )}
          {/* A line you cannot see is a line you will forget, so it says so with the switch off too. */}
          {!l.clientVisible && keyOf(l) !== null && (
            <p className="mt-1 flex items-center gap-1 px-0.5 text-xs text-muted-foreground">
              <EyeOff className="size-3" /> Not on the proposal
            </p>
          )}
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
            Accepted, so the rates, the lines and the proposal&apos;s words are fixed. To revise, start a new estimate and mark this one superseded.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border/60 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-heading text-sm font-medium tracking-heading">Lines</h2>
          {editable && (
            <div className="flex items-center gap-1">
              <label className="mr-2 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={clientWording}
                  onCheckedChange={(v) => setClientWording(v === true)}
                  aria-label="Show the client wording on every line"
                />
                Client wording
              </label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setGroups((prev) => [...prev, emptyGroup()])}>
                <FolderPlus className="mr-1.5 size-4" /> Add item
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => addLine("")}>
                <Plus className="mr-1.5 size-4" /> Add line
              </Button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {hasGroups && <th className="px-1 py-1.5 text-left">Item</th>}
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
              {groups.map((g, gi) => {
                const money = groupMoney(g);
                const own = rowsOf(g.key);
                return (
                  <Fragment key={g.key}>
                    <tr className="border-t-2 border-border bg-muted/30 align-top">
                      <td className="px-1 py-1.5" colSpan={3}>
                        <Input
                          aria-label={`Item name, item ${gi + 1}`}
                          value={g.name}
                          onChange={(e) => setGroup(gi, { name: e.target.value })}
                          placeholder="Tile flooring, master and hall baths"
                          maxLength={200}
                          className="h-8 min-w-48 font-medium"
                          disabled={!editable}
                        />
                        {/*
                          The item's money lives UNDER ITS NAME, not in the Cost and Price
                          columns where it would line up with its lines: the table is wider
                          than the page and those columns are the first thing to go off the
                          right edge — and an item's margin is the number that says whether
                          a round price was a safe one. It has to be readable without
                          scrolling anything.
                        */}
                        {/* The price and the margin FIRST: on a phone this line is cut off at the
                            right edge, and the last thing to lose is what the client pays and
                            what it leaves. */}
                        <p className="mt-1 px-0.5 text-xs text-muted-foreground tabular-nums">
                          {fmt(money.priceCents, symbol)} to the client
                          {money.priceCents > 0 && (
                            <>
                              {" · "}
                              <span className="font-medium text-foreground">
                                {fmt(money.marginCents, symbol)} margin
                              </span>{" "}
                              · {((money.marginCents / money.priceCents) * 100).toFixed(1)}%
                            </>
                          )}
                          {" · "}
                          {fmt(money.costCents, symbol)} cost
                          {money.lineCount === 0 && " · no lines under it yet"}
                        </p>
                      </td>
                      <td className="px-1 py-1.5" colSpan={3}>
                        <Select
                          value={g.priceMode}
                          onValueChange={(v) => setGroup(gi, { priceMode: v as GroupPriceMode })}
                          disabled={!editable}
                        >
                          <SelectTrigger aria-label={`How item ${gi + 1} is priced`} className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {GROUP_PRICE_MODES.map((m) => (
                              <SelectItem key={m} value={m}>
                                {GROUP_PRICE_MODE_LABELS[m]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-1 py-1.5" colSpan={2}>
                        {g.priceMode === "fixed" ? (
                          <Input
                            aria-label={`Price the client pays, item ${gi + 1}`}
                            value={g.fixedPrice}
                            onChange={(e) => setGroup(gi, { fixedPrice: e.target.value })}
                            placeholder="0.00"
                            inputMode="decimal"
                            className="ml-auto h-8 w-28 text-right"
                            disabled={!editable}
                          />
                        ) : (
                          <span className="block text-right text-xs text-muted-foreground">Its lines add up</span>
                        )}
                      </td>
                      <td colSpan={2} />
                      {editable && (
                        <td className="px-1 py-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => removeGroup(g.key)}
                          >
                            <Trash2 className="size-4" />
                            <span className="sr-only">Remove item {gi + 1}; its lines stay, on their own</span>
                          </Button>
                        </td>
                      )}
                    </tr>
                    <tr>
                      <td colSpan={colCount} className="px-1 pb-1">
                        <Input
                          aria-label={`What the client reads under item ${gi + 1}`}
                          value={g.clientNote}
                          onChange={(e) => setGroup(gi, { clientNote: e.target.value })}
                          placeholder="One sentence the client reads under this item on the proposal. Optional."
                          maxLength={4000}
                          className="h-8 w-full"
                          disabled={!editable}
                        />
                      </td>
                    </tr>
                    {own.map(({ l, i }) => lineRow(l, i))}
                    {editable && (
                      <tr>
                        <td colSpan={colCount} className="px-1 pb-2">
                          <Button type="button" variant="ghost" size="sm" onClick={() => addLine(g.key)}>
                            <Plus className="mr-1.5 size-4" /> Add line to {g.name.trim() || `item ${gi + 1}`}
                          </Button>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {hasGroups && loose.length > 0 && (
                <tr>
                  <td
                    colSpan={colCount}
                    className="px-1 pt-3 text-xs uppercase tracking-wide text-muted-foreground"
                  >
                    Not in an item
                  </td>
                </tr>
              )}
              {loose.map(({ l, i }) => lineRow(l, i))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          A line is a quantity of a unit at a cost — a blank quantity is one, a lump sum. It sells at the markup on its
          cost, this line&apos;s or the estimate&apos;s, unless a price per unit is typed, which wins. A line with no
          description is ignored.
          {" "}
          An <strong>item</strong> is what the client buys: name it in their words, put the lines that build it up
          underneath, and the proposal shows the item and its price with the build-up nowhere. Let its lines add up, or
          price it yourself — <strong>a price you type is the price that prints</strong>, so overhead and profit are not
          added to it again. Removing an item leaves its lines; an item with no name is ignored, as a line with no
          description is.
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
              {label === "Price" && totals.fixedCents > 0 && ` · ${fmt(totals.fixedCents, symbol)} priced by hand`}
            </dt>
            <dd className="text-base font-medium tabular-nums">{fmt(cents, symbol)}</dd>
          </div>
        ))}
      </div>

      {ratesIdle && (
        <p className="text-xs text-muted-foreground">
          Every item is priced by hand, so overhead and profit have nothing left to be taken on and the total is the
          sum of the prices you typed. That is how a typed price works — it is the price that prints — but if you meant
          the rates to apply, let an item&apos;s lines add up instead.
        </p>
      )}

      <div className="rounded-lg border border-border/60 p-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">Proposal</h2>
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/jobs/estimates/${estimate.id}/pdf`} target="_blank" rel="noopener noreferrer">
              <FileText className="mr-1.5 size-4" /> Print proposal
            </a>
          </Button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          What the client is sent: the price as saved, shown the way you choose, with the words below around it.
          Cost, markup, overhead and profit never print — they are in the prices.
        </p>
        <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="est-presentation">Show the price</Label>
            <Select value={presentation} onValueChange={setPresentation} disabled={!canEdit}>
              <SelectTrigger className="w-full" id="est-presentation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROPOSAL_PRESENTATIONS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PROPOSAL_PRESENTATION_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Each item&apos;s price, every line, each cost code&apos;s sum, or one figure.
            </p>
            {presentation === "codes" && (
              <label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={showCodeNumbers}
                  onCheckedChange={(v) => setShowCodeNumbers(v === true)}
                  aria-label="Print the cost code numbers on the proposal"
                  disabled={!canEdit}
                  className="mt-0.5"
                />
                <span>
                  Print the code numbers too — <span className="tabular-nums">09 30 00 · Tiling</span> rather than{" "}
                  Tiling. Leave it off unless the client is reading a trade breakdown.
                </span>
              </label>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="est-scope">Scope of work</Label>
            <Textarea
              id="est-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              rows={3}
              maxLength={8000}
              disabled={!editable}
              placeholder="What the price covers, in the client's words."
            />
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="est-exclusions">Not included</Label>
            <Textarea
              id="est-exclusions"
              value={exclusions}
              onChange={(e) => setExclusions(e.target.value)}
              rows={4}
              maxLength={8000}
              disabled={!editable}
              placeholder="Permits and utility fees. Landscaping. Anything not listed above."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="est-terms">Terms</Label>
            <Textarea
              id="est-terms"
              value={termsText}
              onChange={(e) => setTermsText(e.target.value)}
              rows={4}
              maxLength={8000}
              disabled={!editable}
              placeholder="The payment schedule, what a change costs, how long the price holds."
            />
            <p className="text-xs text-muted-foreground">A new estimate starts with the terms of the last one you wrote.</p>
          </div>
        </div>
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
              <ApplyToScheduleDialog
                projectId={projectId}
                estimateId={estimate.id}
                contracts={contracts}
                totalCents={totals.totalCents}
                itemCount={estimate.groups.length}
                symbol={symbol}
              />
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
  itemCount,
  symbol,
}: {
  projectId: string;
  estimateId: string;
  contracts: Array<{ id: string; label: string; status: string }>;
  totalCents: number;
  /** How many client-facing items the estimate has, as SAVED: none means there is no choice to offer. */
  itemCount: number;
  symbol: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [contractId, setContractId] = useState(contracts.length === 1 ? contracts[0].id : "");
  // By item once there are items: the schedule the owner certifies against should
  // read like the proposal they signed, not like the takeoff behind it (ADR 0079).
  const [shape, setShape] = useState<"group" | "line">(itemCount > 0 ? "group" : "line");
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
              {shape === "group"
                ? "One schedule line per item, and one for every line in no item, each at its price"
                : "One schedule line per estimate line at its price"}
              , with overhead and profit spread across them in proportion, so the schedule adds up to the
              estimate&apos;s total — {fmt(totalCents, symbol)}{" "}as saved — replacing the contract&apos;s schedule. A
              line sold at a price per unit keeps billing by the quantity, its unit price raised by the same share. A
              line an application has billed against cannot be removed.
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
            {itemCount > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="ats-shape">Written</Label>
                <Select value={shape} onValueChange={(v) => setShape(v as "group" | "line")}>
                  <SelectTrigger className="w-full" id="ats-shape">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="group">
                      By item — {itemCount} {itemCount === 1 ? "item" : "items"}, as the proposal shows them
                    </SelectItem>
                    <SelectItem value="line">Line by line — the whole takeoff</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={pending || contractId === ""}
              onClick={() =>
                startTransition(async () => {
                  const result = await applyEstimateToScheduleAction({
                    projectId,
                    id: estimateId,
                    contractId,
                    shape,
                  });
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
