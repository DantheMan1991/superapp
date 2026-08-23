"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/money";
import {
  addRunInputAction,
  addRunOutputAction,
  completeRunAction,
  removeRunOutputAction,
  startRunAction,
} from "../actions";
import { COST_BASIS_LABELS, slugLabel } from "../vocabulary";

const NONE = "__none__";
const CUSTOM = "__custom__";
const NEW_ITEM = "__new__";

/**
 * Units a run's output can be counted in. A SUBSET of `inventory`'s, and
 * deliberately short: this is a picker on a processing-day form, not the item
 * editor, and offering acres and fluid ounces here would bury the four answers
 * anybody actually gives. Anything else is created in Inventory.
 */
const OUTPUT_UNITS: { code: string; label: string; mass: boolean }[] = [
  { code: "lb", label: "Pounds", mass: true },
  { code: "each", label: "Each", mass: false },
  { code: "head", label: "Head", mass: false },
  { code: "dozen", label: "Dozen", mass: false },
  { code: "gal", label: "Gallons", mass: false },
];

/** Suggestions only - `item_kind` is an open taxonomy and the values are free. */
const OUTPUT_KINDS = ["meat", "produce", "egg", "supply"];

export interface ItemOption {
  id: string;
  name: string;
  /** The unit its balance is kept in. Decides whether a weight is asked for. */
  unit: string;
  /** True when the unit is a mass, so pounds are already the quantity. */
  weighed: boolean;
}

export interface LotOption {
  id: string;
  itemId: string;
  code: string;
  balanceLabel: string;
  /** Set when something refuses this batch today — a withdrawal, usually. */
  blockedBecause: string | null;
  blockedHeadline: string | null;
}

export interface PlaceOption {
  id: string;
  name: string;
}

function numberOrNull(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Start a run. Owner-only, because completing it will create cost objects. */
export function StartRunForm({
  runWord,
  kindOptions,
  locations,
  today,
}: {
  runWord: string;
  kindOptions: string[];
  locations: PlaceOption[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<string>(kindOptions[0] ?? CUSTOM);

  function submit(formData: FormData) {
    const chosen =
      kind === CUSTOM ? String(formData.get("customKind") ?? "") : kind;
    const location = String(formData.get("locationAssetId") ?? NONE);
    startTransition(async () => {
      const result = await startRunAction({
        code: String(formData.get("code") ?? ""),
        runKind: chosen.trim().toLowerCase().replace(/\s+/g, "_") || undefined,
        startedOn: String(formData.get("startedOn") ?? today),
        locationAssetId: location === NONE ? null : location,
        performedBy: String(formData.get("performedBy") ?? ""),
        crewSize: numberOrNull(formData.get("crewSize")),
        labourHours: numberOrNull(formData.get("labourHours")),
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${runWord} started`);
      setOpen(false);
      // PUSH, AND NOT ALSO REFRESH. Calling both raced: the refresh landed and
      // the push did not, so starting a run dropped you back on the list —
      // still showing the empty state, as though nothing had been created.
      // `revalidatePath` has already invalidated the list on the server.
      if (result.runId) {
        router.push(`/dashboard/m/production/${result.runId}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Start a {runWord.toLowerCase()}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Start a {runWord.toLowerCase()}</DialogTitle>
            <DialogDescription>
              Record it on the day it happens. What goes in leaves stock and
              takes its cost with it; what comes out lands in Inventory when you
              finish.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="code">Name</Label>
              <Input
                id="code"
                name="code"
                required
                maxLength={120}
                autoFocus
                placeholder="e.g. Kill day 2026-08-22, Batch 12"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="kind">Kind</Label>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger id="kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {kindOptions.map((k) => (
                      <SelectItem key={k} value={k}>
                        {slugLabel(k)}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM}>Something else…</SelectItem>
                  </SelectContent>
                </Select>
                {kind === CUSTOM && (
                  <Input
                    name="customKind"
                    maxLength={63}
                    placeholder="e.g. pressing"
                  />
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="startedOn">Started</Label>
                <Input
                  id="startedOn"
                  name="startedOn"
                  type="date"
                  defaultValue={today}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="locationAssetId">Where</Label>
              <Select name="locationAssetId" defaultValue={NONE}>
                <SelectTrigger id="locationAssetId">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not said</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2 col-span-1">
                <Label htmlFor="performedBy">Who</Label>
                <Input
                  id="performedBy"
                  name="performedBy"
                  maxLength={200}
                  placeholder="e.g. Dan, Sarah"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="crewSize">Crew</Label>
                <Input
                  id="crewSize"
                  name="crewSize"
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="labourHours">Hours</Label>
                <Input
                  id="labourHours"
                  name="labourHours"
                  type="number"
                  min="0"
                  step="0.25"
                  inputMode="decimal"
                />
              </div>
            </div>
            {/* Recorded, not costed. Saying so here stops somebody expecting the
                cost per bird to move when they fill it in. */}
            <p className="text-xs text-muted-foreground">
              Crew and hours are recorded per day rather than per bird. Nothing
              turns them into money yet — that needs a decision about what an
              hour is worth.
            </p>
            <div className="grid gap-2">
              <Label htmlFor="run-notes">Notes</Label>
              <Textarea id="run-notes" name="notes" rows={2} maxLength={5000} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Starting…" : "Start"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Put something into the run.
 *
 * **THE BLOCKED BATCH IS SHOWN BEFORE IT IS PICKED, not after it is refused.**
 * The refusal is enforced in ops and always will be, but a form that lets
 * somebody choose a pen under withdrawal and then rejects them has told them
 * the same thing a step too late — and on a processing morning that step is a
 * trailer already hooked up.
 */
export function AddInputForm({
  runId,
  items,
  lots,
  today,
}: {
  runId: string;
  items: ItemOption[];
  lots: LotOption[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [itemId, setItemId] = useState<string>(items[0]?.id ?? "");
  const [lotId, setLotId] = useState<string>("");

  const item = items.find((i) => i.id === itemId);
  const itemLots = useMemo(
    () => lots.filter((l) => l.itemId === itemId),
    [lots, itemId],
  );
  const lot = itemLots.find((l) => l.id === lotId);
  /**
   * **THE REASON HAS TO SHOW WITHOUT BEING SELECTED.** Found by clicking: a
   * blocked pen is disabled in the picker, which is right — and it meant the
   * sentence explaining WHY was unreachable, because it only rendered for the
   * selected lot and a disabled option cannot be selected. All somebody saw was
   * a greyed row saying "Not looked up", with nothing anywhere to say that an
   * unknown is not a zero or what to do about it.
   */
  const blocked = itemLots.filter((l) => l.blockedBecause !== null);

  function submit(formData: FormData) {
    if (!itemId || !lotId) {
      toast.error("Pick what went in, and which batch it came from.");
      return;
    }
    startTransition(async () => {
      const result = await addRunInputAction({
        runId,
        itemId,
        lotId,
        quantity: Number(formData.get("quantity")),
        weightLb: item?.weighed ? null : numberOrNull(formData.get("weightLb")),
        occurredOn: String(formData.get("occurredOn") ?? today),
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Recorded in — it has left stock");
      setOpen(false);
      setLotId("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          What went in
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>What went in</DialogTitle>
            <DialogDescription>
              This takes it out of stock straight away and carries its cost onto
              the run. A batch is required — the cost and the clock are both
              properties of a batch, not of a stock line.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="in-item">What</Label>
              <Select
                value={itemId}
                onValueChange={(value) => {
                  setItemId(value);
                  setLotId("");
                }}
              >
                <SelectTrigger id="in-item">
                  <SelectValue placeholder="Pick an item" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="in-lot">Which batch</Label>
              <Select value={lotId} onValueChange={setLotId}>
                <SelectTrigger id="in-lot">
                  <SelectValue placeholder="Pick a batch" />
                </SelectTrigger>
                <SelectContent>
                  {itemLots.map((l) => (
                    <SelectItem
                      key={l.id}
                      value={l.id}
                      disabled={l.blockedBecause !== null}
                    >
                      {l.code} · {l.balanceLabel}
                      {l.blockedHeadline && ` · ${l.blockedHeadline}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {itemLots.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nothing has a batch under this item yet.
                </p>
              )}
              {blocked.map((l) => (
                <p key={l.id} className="text-xs text-destructive">
                  <span className="font-medium">{l.code}</span> — {l.blockedBecause}
                </p>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="quantity">
                  How much{item ? ` (${item.unit})` : ""}
                </Label>
                <Input
                  id="quantity"
                  name="quantity"
                  type="number"
                  min="0"
                  step="0.0001"
                  inputMode="decimal"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="occurredOn">When</Label>
                <Input
                  id="occurredOn"
                  name="occurredOn"
                  type="date"
                  defaultValue={today}
                />
              </div>
            </div>

            {/* Only asked for when the quantity is not already a weight. 400 lb
                of flour needs no second number; 210 head does. */}
            {item && !item.weighed && (
              <div className="grid gap-2">
                <Label htmlFor="weightLb">Live weight (lb)</Label>
                <Input
                  id="weightLb"
                  name="weightLb"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="Total for everything on this line"
                />
                <p className="text-xs text-muted-foreground">
                  Optional, and the yield is refused without it. Head is a count,
                  not a weight, so there is no ratio to state until somebody puts
                  them on a scale.
                </p>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="in-notes">Notes</Label>
              <Textarea id="in-notes" name="notes" rows={2} maxLength={2000} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending || !!lot?.blockedBecause}>
              {pending ? "Recording…" : "Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Record something the run produced. It lands in stock when the run finishes.
 *
 * **IT CAN CREATE THE STOCK LINE, and that is not a convenience.** Found by
 * driving: a farm's first kill day produces whole birds, and a farm that has
 * never sold meat has no meat item - so this picker offered feed, chicks, pigs
 * and penicillin, and the only way to land a bird was to leave for Inventory,
 * add an item, and come back in the middle of a processing day. Livestock's lot
 * form grew the same escape hatch for the same reason.
 */
export function AddOutputForm({
  runId,
  runCode,
  items,
  locations,
  canCreateItem,
}: {
  runId: string;
  runCode: string;
  items: ItemOption[];
  locations: PlaceOption[];
  canCreateItem: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [itemId, setItemId] = useState<string>(
    items[0]?.id ?? (canCreateItem ? NEW_ITEM : ""),
  );
  const [newUnit, setNewUnit] = useState<string>("lb");
  const isNew = itemId === NEW_ITEM;
  const item = items.find((i) => i.id === itemId);
  // A new line's unit decides the same thing an existing one's does: whether the
  // quantity already IS the weight.
  const unit = isNew ? newUnit : item?.unit;
  const weighed = isNew
    ? OUTPUT_UNITS.find((u) => u.code === newUnit)?.mass === true
    : item?.weighed === true;

  function submit(formData: FormData) {
    if (!itemId) {
      toast.error("Pick what came out.");
      return;
    }
    const location = String(formData.get("locationAssetId") ?? NONE);
    startTransition(async () => {
      const result = await addRunOutputAction({
        runId,
        itemId: isNew ? undefined : itemId,
        newItemName: isNew
          ? String(formData.get("newItemName") ?? "").trim() || undefined
          : undefined,
        newItemUnit: isNew ? newUnit : undefined,
        newItemKind: isNew
          ? String(formData.get("newItemKind") ?? "meat")
          : undefined,
        quantity: Number(formData.get("quantity")),
        weightLb: weighed ? null : numberOrNull(formData.get("weightLb")),
        lotCode: String(formData.get("lotCode") ?? ""),
        locationAssetId: location === NONE ? null : location,
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Recorded out — it lands in stock when the run finishes");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          What came out
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>What came out</DialogTitle>
            <DialogDescription>
              Nothing lands in stock yet. The cost split across the outputs
              cannot be worked out until they have all come off the line, so the
              boxes land together when you finish the run.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="out-item">What</Label>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger id="out-item">
                  <SelectValue placeholder="Pick an item" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                  {canCreateItem && (
                    <SelectItem value={NEW_ITEM}>Something new...</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {isNew && (
              <div className="grid gap-4 rounded-md border p-3">
                <div className="grid gap-2">
                  <Label htmlFor="newItemName">What to call it</Label>
                  <Input
                    id="newItemName"
                    name="newItemName"
                    required
                    maxLength={200}
                    placeholder="e.g. Whole broilers, Ground beef"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="newItemUnit">Counted in</Label>
                    <Select value={newUnit} onValueChange={setNewUnit}>
                      <SelectTrigger id="newItemUnit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OUTPUT_UNITS.map((u) => (
                          <SelectItem key={u.code} value={u.code}>
                            {u.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="newItemKind">Kind</Label>
                    <Select name="newItemKind" defaultValue="meat">
                      <SelectTrigger id="newItemKind">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OUTPUT_KINDS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {slugLabel(k)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {/* The one rule somebody setting up a stock line has to
                    understand, said where they hit it rather than in a help
                    page they will not open. */}
                <p className="text-xs text-muted-foreground">
                  What it is counted in decides how every number about it reads,
                  and it locks once anything moves - so it is worth a moment.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="out-quantity">
                  How much{unit ? ` (${unit})` : ""}
                </Label>
                <Input
                  id="out-quantity"
                  name="quantity"
                  type="number"
                  min="0"
                  step="0.0001"
                  inputMode="decimal"
                  required
                />
              </div>
              {unit && !weighed && (
                <div className="grid gap-2">
                  <Label htmlFor="out-weight">Weight (lb)</Label>
                  <Input
                    id="out-weight"
                    name="weightLb"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                  />
                </div>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="lotCode">Batch name</Label>
              <Input
                id="lotCode"
                name="lotCode"
                maxLength={120}
                defaultValue={runCode}
              />
              <p className="text-xs text-muted-foreground">
                What this becomes in Inventory. It is a made-here batch, so
                traceability follows it back to this run.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="out-location">Where it goes</Label>
              <Select name="locationAssetId" defaultValue={NONE}>
                <SelectTrigger id="out-location">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not said</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="out-notes">Notes</Label>
              <Textarea id="out-notes" name="notes" rows={2} maxLength={2000} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Recording…" : "Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Take an output off an open run. Nothing has landed, so nothing is reversed. */
export function RemoveOutputButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await removeRunOutputAction({ id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Removed");
      router.refresh();
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={remove}
      disabled={pending}
      className="text-muted-foreground"
    >
      Remove
    </Button>
  );
}

/**
 * Finish the run.
 *
 * **THE TOAST SAYS WHAT HAPPENED TO THE MONEY**, because this is the act that
 * decides what a pound of pork chop cost. "Saved" is the mistake `inventory`
 * corrected on the page that owned the money and never mentioned it.
 */
export function CompleteRunButton({
  runId,
  runWord,
  outputCount,
  potCents,
  currencySymbol,
  today,
  processorName,
  quotedFeeCents,
  quotedFeeUnpriced,
}: {
  runId: string;
  runWord: string;
  outputCount: number;
  potCents: number;
  currencySymbol: string | null;
  today: string;
  /** Null for an on-farm run, where there is nobody to have charged. */
  processorName?: string | null;
  /** What the cut sheets add up to, offered as a starting figure. */
  quotedFeeCents?: number | null;
  /** How many priced lines the sheets could not total. Shown, never hidden. */
  quotedFeeUnpriced?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  /**
   * **THE BOX STARTS AT THE QUOTE AND IS EMPTY WHEN THERE IS NOT ONE.** Empty
   * records NULL — nobody said what the plant charged — which is a different
   * fact from zero, and zero would say they did it for nothing. A pre-filled
   * `0.00` is the single easiest way to get a fee of nothing onto a box of meat.
   */
  const [fee, setFee] = useState(
    quotedFeeCents != null ? (quotedFeeCents / 100).toFixed(2) : "",
  );

  function submit(formData: FormData) {
    startTransition(async () => {
      const typed = fee.trim();
      const result = await completeRunAction({
        runId,
        completedOn: String(formData.get("completedOn") ?? today),
        processingFee: typed === "" ? null : Number(typed),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const basis = COST_BASIS_LABELS[result.basis ?? "none"] ?? "Not split";
      const landed = result.landed ?? 0;
      const feeCents = result.processingFeeCents ?? null;
      toast.success(
        `${landed} ${landed === 1 ? "batch" : "batches"} landed in stock · ${formatMoney(
          result.potCents ?? 0,
          currencySymbol,
        )} carried across${
          feeCents !== null
            ? `, ${formatMoney(feeCents, currencySymbol)} of it processing`
            : ""
        } · ${basis.toLowerCase()}`,
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={outputCount === 0}>Finish</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Finish this {runWord.toLowerCase()}</DialogTitle>
            <DialogDescription>
              {outputCount === 1
                ? "One output lands in Inventory as a made-here batch"
                : `All ${outputCount} outputs land in Inventory as made-here batches`}
              , sharing the {formatMoney(potCents, currencySymbol)} that went in.
              Their cost is stamped as they land and is never recalculated
              afterwards, so buying dearer feed next month will not change what
              this run cost.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="completedOn">Finished</Label>
              <Input
                id="completedOn"
                name="completedOn"
                type="date"
                defaultValue={today}
              />
            </div>

            {/*
              WHAT THE PLANT CHARGED, and it goes in the pot with the feed.
              Offered only when somebody else did the work: an on-farm run has
              nobody to have charged, and this farm's own labour is deliberately
              recorded and not costed.
            */}
            {processorName != null && (
              <div className="grid gap-2">
                <Label htmlFor="processingFee">
                  What {processorName} charged
                </Label>
                <Input
                  id="processingFee"
                  type="number"
                  step="0.01"
                  min={0}
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  placeholder="Leave empty if nobody has said"
                />
                <p className="text-xs text-muted-foreground">
                  {quotedFeeCents != null ? (
                    <>
                      The cut sheet quotes{" "}
                      {formatMoney(quotedFeeCents, currencySymbol)}
                      {quotedFeeUnpriced ? (
                        <>
                          {" "}
                          — and could not price {quotedFeeUnpriced}{" "}
                          {quotedFeeUnpriced === 1 ? "line" : "lines"}, so the
                          real figure is higher
                        </>
                      ) : null}
                      . Change it to what they actually billed.
                    </>
                  ) : (
                    <>
                      Goes into the cost of the meat with the feed. Empty means
                      nobody has said yet, which is not the same as nothing.
                    </>
                  )}
                </p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Once finished, the outputs cannot be edited here — the receipt in
              Inventory becomes the record.
            </p>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Landing…" : "Finish and land"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
