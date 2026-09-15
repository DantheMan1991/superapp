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
import { RecordPhotos, type RecordFile, type RecordPhoto } from "@/modules/documents/components/record-photos";
import {
  attachSelectionDocumentAction,
  attachSelectionFileAction,
  attachSelectionPhotoAction,
  createSelectionAction,
  detachSelectionPhotoAction,
  raiseSelectionChangeOrderAction,
  remindSelectionAction,
  setSelectionPhotoPrimaryAction,
  updateSelectionAction,
} from "../actions";
import {
  quantityStringToThousandths,
  thousandthsToQuantityString,
  unitLineCents,
} from "../billing-math";
import {
  CHANGE_ORDER_STATUS_LABELS,
  SELECTION_STATUSES,
  SELECTION_STATUS_LABELS,
} from "../vocabulary";

const NONE = "__none__";

interface ChoiceDraft {
  id: string | null;
  description: string;
  partyId: string;
  reference: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  price: string;
  isSelected: boolean;
}

export interface EditableSelection {
  id: string;
  version: number;
  contractId: string | null;
  costCodeId: string | null;
  name: string;
  location: string;
  description: string;
  allowanceCents: number;
  neededBy: string | null;
  status: string;
  decidedOn: string | null;
  notes: string;
  choices: Array<{
    id: string;
    description: string;
    partyId: string | null;
    reference: string;
    unit: string;
    quantityThousandths: number | null;
    unitPriceCents: number | null;
    priceCents: number;
    isSelected: boolean;
  }>;
  /** The change order the difference was raised as, when it stands: the money is fixed. */
  raisedNumber: string | null;
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const toCents = (s: string): number => {
  const n = Number(s.replace(/[,\s$]/g, ""));
  return Number.isFinite(n) && s.trim() !== "" ? Math.round(n * 100) : 0;
};

function fmt(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A choice's extended price as the dialog shows it: quantity at the unit price when both are typed, else the price box. */
function draftPrice(c: ChoiceDraft): number {
  const qty = quantityStringToThousandths(c.quantity);
  if (c.quantity.trim() !== "" && c.unitPrice.trim() !== "" && qty !== null) {
    return unitLineCents(qty, toCents(c.unitPrice));
  }
  return toCents(c.price);
}

const emptyChoice = (): ChoiceDraft => ({
  id: null,
  description: "",
  partyId: NONE,
  reference: "",
  quantity: "",
  unit: "",
  unitPrice: "",
  price: "",
  isSelected: false,
});

/**
 * A selection: what the client still has to choose, what the contract set
 * aside for it, when it is needed, and what is on offer (ADR 0067).
 *
 * **THE CHOICES ARE THE OPTION BOOK AND THE SHOWROOM SAMPLES AT ONCE.** Each
 * row is one thing on offer with its price — by the unit (320 sf at 4.20) or
 * as a sum — and the radio marks the one the client picked. The difference
 * against the allowance is shown live and raised as a change order from the
 * page, never here.
 *
 * **ONCE RAISED, THE MONEY IS FIXED.** The allowance box and the choices are
 * shown but not sent, because the change order was priced from them.
 */
export function SelectionForm({
  projectId,
  contracts,
  costCodes,
  parties,
  documentsOn,
  tenantId,
  canPhoto,
  photos = [],
  files = [],
  existing,
  trigger,
}: {
  projectId: string;
  contracts: Array<{ id: string; label: string }>;
  costCodes: Array<{ id: string; label: string }>;
  parties: Array<{ id: string; name: string }>;
  documentsOn: boolean;
  tenantId: string;
  canPhoto: boolean;
  photos?: RecordPhoto[];
  files?: RecordFile[];
  existing?: EditableSelection;
  trigger?: ReactNode;
}) {
  const editing = existing !== undefined;
  const locked = existing?.raisedNumber != null;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(existing?.name ?? "");
  const [location, setLocation] = useState(existing?.location ?? "");
  const [contractId, setContractId] = useState(
    existing?.contractId ?? (contracts.length === 1 ? contracts[0].id : NONE),
  );
  const [costCodeId, setCostCodeId] = useState(existing?.costCodeId ?? NONE);
  const [allowance, setAllowance] = useState(
    existing && existing.allowanceCents !== 0 ? (existing.allowanceCents / 100).toFixed(2) : "",
  );
  const [neededBy, setNeededBy] = useState(existing?.neededBy ?? "");
  const [status, setStatus] = useState(existing?.status ?? "pending");
  const [decidedOn, setDecidedOn] = useState(existing?.decidedOn ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [choices, setChoices] = useState<ChoiceDraft[]>(
    existing && existing.choices.length > 0
      ? existing.choices.map((c) => ({
          id: c.id,
          description: c.description,
          partyId: c.partyId ?? NONE,
          reference: c.reference,
          quantity: c.quantityThousandths === null ? "" : thousandthsToQuantityString(c.quantityThousandths),
          unit: c.unit,
          unitPrice: c.unitPriceCents === null ? "" : (c.unitPriceCents / 100).toFixed(2),
          price: (c.priceCents / 100).toFixed(2),
          isSelected: c.isSelected,
        }))
      : [emptyChoice()],
  );

  const ready = name.trim() !== "";
  const chosen = choices.find((c) => c.isSelected && c.description.trim() !== "") ?? null;
  const allowanceCents = toCents(allowance);
  const difference = chosen ? draftPrice(chosen) - allowanceCents : null;

  function setChoice(i: number, patch: Partial<ChoiceDraft>) {
    setChoices((prev) => prev.map((c, j) => (i === j ? { ...c, ...patch } : c)));
  }
  function choose(i: number) {
    setChoices((prev) => prev.map((c, j) => ({ ...c, isSelected: i === j ? !c.isSelected : false })));
  }
  function changeStatus(next: string) {
    setStatus(next);
    if ((next === "selected" || next === "approved") && decidedOn === "") setDecidedOn(today());
  }

  function submit() {
    startTransition(async () => {
      const payload = {
        projectId,
        contractId: contractId === NONE ? "" : contractId,
        costCodeId: costCodeId === NONE ? "" : costCodeId,
        name: name.trim(),
        location: location.trim(),
        description: description.trim(),
        neededBy,
        status,
        decidedOn: status === "selected" || status === "approved" ? decidedOn : "",
        notes: notes.trim(),
        // Once raised, the allowance and the choices are not sent: the change order was priced from them.
        ...(locked
          ? {}
          : {
              allowanceCents: allowance,
              choices: choices
                .filter((c) => c.description.trim() !== "")
                .map((c) => ({
                  id: c.id ?? "",
                  description: c.description.trim(),
                  partyId: c.partyId === NONE ? "" : c.partyId,
                  reference: c.reference.trim(),
                  unit: c.unit.trim(),
                  quantity: c.quantity,
                  unitPriceCents: c.unitPrice,
                  priceCents: c.price,
                  isSelected: c.isSelected,
                })),
            }),
      };
      const result = editing
        ? await updateSelectionAction({ ...payload, id: existing.id, version: existing.version })
        : await createSelectionAction(payload);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Selection saved" : "Selection added");
      setOpen(false);
      if (!editing) {
        setName("");
        setLocation("");
        setCostCodeId(NONE);
        setAllowance("");
        setNeededBy("");
        setStatus("pending");
        setDecidedOn("");
        setDescription("");
        setNotes("");
        setChoices([emptyChoice()]);
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
          <Plus className="mr-1.5 size-4" /> Add selection
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit selection" : "New selection"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sel-name">Selection</Label>
                <Input
                  id="sel-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Master bath tile"
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sel-location">Where</Label>
                <Input
                  id="sel-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Master bath"
                  maxLength={200}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sel-contract">In the price of</Label>
                <Select value={contractId} onValueChange={setContractId}>
                  <SelectTrigger className="w-full" id="sel-contract">
                    <SelectValue placeholder="Which agreement holds the allowance" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No contract yet</SelectItem>
                    {contracts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The agreement the allowance sits inside; a difference is raised as a change order on it.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sel-code">Cost code</Label>
                <Select value={costCodeId} onValueChange={setCostCodeId}>
                  <SelectTrigger className="w-full" id="sel-code">
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
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="sel-allowance">Allowance</Label>
                <Input
                  id="sel-allowance"
                  value={allowance}
                  onChange={(e) => setAllowance(e.target.value)}
                  placeholder="12,000"
                  inputMode="decimal"
                  disabled={locked}
                />
                <p className="text-xs text-muted-foreground">
                  {locked
                    ? `Fixed: raised as ${existing?.raisedNumber}.`
                    : "What the contract set aside. Blank for a standard included item."}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sel-needed">Needed by</Label>
                <Input
                  id="sel-needed"
                  type="date"
                  value={neededBy}
                  onChange={(e) => setNeededBy(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sel-status">Status</Label>
                <Select value={status} onValueChange={changeStatus}>
                  <SelectTrigger className="w-full" id="sel-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SELECTION_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {SELECTION_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {(status === "selected" || status === "approved") && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sel-decided">Decided on</Label>
                  <Input
                    id="sel-decided"
                    type="date"
                    value={decidedOn}
                    onChange={(e) => setDecidedOn(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="sel-description">What it covers</Label>
              <Textarea
                id="sel-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Floor and shower walls, grout, trim pieces"
              />
            </div>

            <div className="space-y-2 rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between">
                <Label>Choices</Label>
                {!locked && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setChoices((prev) => [...prev, emptyChoice()])}
                  >
                    <Plus className="mr-1.5 size-4" /> Add choice
                  </Button>
                )}
              </div>
              {choices.map((c, i) => (
                <div key={c.id ?? `new-${i}`} className="space-y-2 rounded-md bg-muted/30 p-2">
                  <div className="grid gap-2 sm:grid-cols-[2rem_1fr_9rem_2rem]">
                    <label className="flex items-center justify-center" title="The client's pick">
                      <input
                        type="radio"
                        name="sel-chosen"
                        aria-label={`Chosen, choice ${i + 1}`}
                        checked={c.isSelected}
                        onClick={() => choose(i)}
                        onChange={() => undefined}
                        disabled={locked}
                      />
                    </label>
                    <Input
                      aria-label={`Description, choice ${i + 1}`}
                      value={c.description}
                      onChange={(e) => setChoice(i, { description: e.target.value })}
                      placeholder="Daltile Rittenhouse 3x6, white"
                      maxLength={300}
                      disabled={locked}
                    />
                    <Input
                      aria-label={`Reference, choice ${i + 1}`}
                      value={c.reference}
                      onChange={(e) => setChoice(i, { reference: e.target.value })}
                      placeholder="Model / SKU"
                      maxLength={120}
                      disabled={locked}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={locked || choices.length === 1}
                      onClick={() => setChoices((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-4" />
                      <span className="sr-only">Remove choice {i + 1}</span>
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_5rem_4rem_6rem_7rem]">
                    <Select
                      value={c.partyId}
                      onValueChange={(v) => setChoice(i, { partyId: v })}
                      disabled={locked}
                    >
                      <SelectTrigger aria-label={`Supplier, choice ${i + 1}`}>
                        <SelectValue placeholder="Supplier" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>No supplier</SelectItem>
                        {parties.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      aria-label={`Quantity, choice ${i + 1}`}
                      value={c.quantity}
                      onChange={(e) => setChoice(i, { quantity: e.target.value })}
                      placeholder="Qty"
                      inputMode="decimal"
                      className="text-right"
                      disabled={locked}
                    />
                    <Input
                      aria-label={`Unit, choice ${i + 1}`}
                      value={c.unit}
                      onChange={(e) => setChoice(i, { unit: e.target.value })}
                      placeholder="sf"
                      maxLength={20}
                      disabled={locked}
                    />
                    <Input
                      aria-label={`Unit price, choice ${i + 1}`}
                      value={c.unitPrice}
                      onChange={(e) => setChoice(i, { unitPrice: e.target.value })}
                      placeholder="per unit"
                      inputMode="decimal"
                      className="text-right"
                      disabled={locked}
                    />
                    {c.quantity.trim() !== "" && c.unitPrice.trim() !== "" ? (
                      <div
                        className="flex h-9 items-center justify-end rounded-md border border-input bg-muted/40 px-3 text-sm tabular-nums"
                        aria-label={`Price, choice ${i + 1}`}
                      >
                        {fmt(draftPrice(c))}
                      </div>
                    ) : (
                      <Input
                        aria-label={`Price, choice ${i + 1}`}
                        value={c.price}
                        onChange={(e) => setChoice(i, { price: e.target.value })}
                        placeholder="Price"
                        inputMode="decimal"
                        className="text-right"
                        disabled={locked}
                      />
                    )}
                  </div>
                </div>
              ))}
              <div className="flex items-start justify-between gap-4 pt-1">
                <p className="text-xs text-muted-foreground">
                  {locked
                    ? `The choices are fixed: the difference was raised as ${existing?.raisedNumber}. Void that change order to re-price.`
                    : "What is on offer, each with its price — by the unit, or as a sum. The radio marks the client's pick. A choice with no description is ignored."}
                </p>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {difference === null
                    ? "No choice marked"
                    : difference === 0
                      ? "On the allowance"
                      : difference > 0
                        ? `Over by ${fmt(difference)}`
                        : `Under by ${fmt(-difference)}`}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sel-notes">Notes</Label>
              <Textarea
                id="sel-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={2000}
              />
            </div>

            {editing && (
              <div className="space-y-1.5 rounded-lg border border-border/60 p-3">
                <Label>Samples and spec sheets</Label>
                {documentsOn ? (
                  <RecordPhotos
                    entityId={existing.id}
                    tenantId={tenantId}
                    photos={photos}
                    files={files}
                    canEdit={canPhoto}
                    subject="selection"
                    attachAction={attachSelectionPhotoAction}
                    setPrimaryAction={setSelectionPhotoPrimaryAction}
                    detachAction={detachSelectionPhotoAction}
                    attachFileAction={attachSelectionFileAction}
                    attachExistingAction={attachSelectionDocumentAction}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">Photos need Documents switched on.</p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || !ready}>
              {pending ? (editing ? "Saving…" : "Adding…") : editing ? "Save" : "Add selection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Raise the difference as a change order on the selection's contract — the
 * one owner's act here. Asks for the number the business gives it and the
 * status it starts in; the price and the line come from the selection.
 */
export function RaiseSelectionChangeOrder({
  projectId,
  selectionId,
  selectionName,
  differenceCents,
  symbol,
}: {
  projectId: string;
  selectionId: string;
  selectionName: string;
  differenceCents: number;
  symbol: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [number, setNumber] = useState("");
  const [title, setTitle] = useState(
    `${selectionName}: allowance ${differenceCents > 0 ? "overage" : "credit"}`,
  );
  const [status, setStatus] = useState<"proposed" | "approved">("proposed");
  const [approvedOn, setApprovedOn] = useState("");
  const over = differenceCents > 0;
  const money = `${symbol ?? ""}${fmt(Math.abs(differenceCents))}`;

  function submit() {
    startTransition(async () => {
      const result = await raiseSelectionChangeOrderAction({
        projectId,
        selectionId,
        number: number.trim(),
        title: title.trim(),
        status,
        approvedOn: status === "approved" ? approvedOn || today() : "",
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Change order raised");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Raise {over ? "overage" : "credit"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Raise a change order</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {over ? "Over" : "Under"} the allowance by <span className="font-medium text-foreground">{money}</span>.
              The change order carries {over ? "that as its price" : "that as a credit"}, and moves the
              selection&apos;s cost code by the same amount.
            </p>
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="rs-number">Number</Label>
                <Input
                  id="rs-number"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="CO-4"
                  maxLength={40}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rs-title">Title</Label>
                <Input id="rs-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rs-status">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as "proposed" | "approved")}>
                  <SelectTrigger className="w-full" id="rs-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="proposed">{CHANGE_ORDER_STATUS_LABELS.proposed}</SelectItem>
                    <SelectItem value="approved">{CHANGE_ORDER_STATUS_LABELS.approved}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Proposed until the client signs it; approved moves the contract value.
                </p>
              </div>
              {status === "approved" && (
                <div className="space-y-1.5">
                  <Label htmlFor="rs-approved">Approved on</Label>
                  <Input
                    id="rs-approved"
                    type="date"
                    value={approvedOn}
                    onChange={(e) => setApprovedOn(e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || number.trim() === ""}>
              {pending ? "Raising…" : "Raise change order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The reminder: one click raises a Work item linked to the selection. */
export function RemindSelectionButton({ projectId, selectionId }: { projectId: string; selectionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await remindSelectionAction({ projectId, selectionId });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success("Added to Work");
          router.refresh();
        })
      }
    >
      {pending ? "Adding…" : "Remind"}
    </Button>
  );
}
