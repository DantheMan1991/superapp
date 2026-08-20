"use client";

import { useState, useTransition } from "react";
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
import {
  deleteTreatmentAction,
  lastTreatmentOfProductAction,
  recordTreatmentAction,
  updateTreatmentAction,
} from "../actions";
import { TREATMENT_ROUTES, treatmentRouteLabel } from "../vocabulary";
import { WITHDRAWAL_SOURCE_LABELS } from "../core/withdrawal";

const NO_STOCK = "__none__";

export interface MedicineOption {
  id: string;
  name: string;
  unit: string;
}

/**
 * Remove a treatment entered by mistake — a duplicate, or one against the wrong
 * pen.
 *
 * **THE STOCK ISSUE STAYS, AND THE DIALOG SAYS SO.** The medicine really did
 * leave the shelf: that is an event in `inventory`'s ledger, and unwriting it
 * would rewrite what happened. Telling somebody afterwards, via a cost on the
 * pen they cannot explain, is the version of this that loses trust.
 */
export function RemoveTreatmentButton({
  treatmentId,
  product,
  treatedOn,
  fromStock,
}: {
  treatmentId: string;
  product: string;
  treatedOn: string;
  /** Whether this treatment took the product out of stock. */
  fromStock: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await deleteTreatmentAction({ id: treatmentId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.keptStockIssue
          ? "Removed — the stock that went out is still on the pen"
          : "Removed",
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Remove
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Remove the {product} from {treatedOn}?
          </DialogTitle>
          <DialogDescription>
            For a treatment that never happened — a duplicate, or one recorded
            against the wrong pen. If a date or a period was simply typed wrong,
            correct it instead. This changes the withdrawal clock, which is what
            decides whether these can be processed.
          </DialogDescription>
        </DialogHeader>
        {fromStock && (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            {/* Said before, not after. */}
            <span className="font-medium text-foreground">
              The stock that went out stays on the pen.
            </span>{" "}
            The medicine really did leave the shelf, so removing this record does
            not put it back — correct that side with an adjustment in Inventory.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button variant="destructive" onClick={submit} disabled={pending}>
            {pending ? "Removing…" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface ExistingTreatment {
  id: string;
  treatedOn: string;
  product: string;
  dose: string;
  route: string;
  headTreated: number | null;
  meatWithdrawalDays: number | null;
  milkWithdrawalDays: number | null;
  withdrawalSource: string;
  administeredBy: string;
  notes: string;
}

/**
 * Record a treatment.
 *
 * **THE FORM'S JOB IS TO REFUSE TO GUESS.** The design's rule is that the app
 * must never present a withdrawal number as authoritative, and being confidently
 * wrong here can put uninspectable meat in somebody's freezer. So:
 *
 *   - the two period boxes start EMPTY, always;
 *   - the only figure ever filled in for you is one THIS farm typed before for
 *     the same product, and it says so when it does;
 *   - leaving them empty is a real answer, and it makes the lot read as *not*
 *     clear rather than clear — because an unknown is not a zero.
 *
 * Two boxes rather than one with a toggle, because meat and milk genuinely
 * differ for the same bottle and a single field would force whoever is standing
 * there to pick which truth to keep.
 */
export function RecordTreatmentForm({
  livestockLotId,
  lotCode,
  head,
  today,
  medicines,
  products,
  existing,
  trigger,
}: {
  livestockLotId: string;
  lotCode: string;
  head: number;
  today: string;
  /** Stock this treatment could have come out of, so the pen carries the cost. */
  medicines: MedicineOption[];
  /** Products this farm has used before — a datalist, not a closed list. */
  products: string[];
  /**
   * The treatment being CORRECTED, if this is a correction.
   *
   * One form for both, as the weight form does. The stock picker disappears in
   * correction mode: the medicine already left the shelf, and that is
   * `inventory`'s event to adjust rather than a field this form may rewrite.
   */
  existing?: ExistingTreatment;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [route, setRoute] = useState<string>(existing?.route ?? "water");
  const [source, setSource] = useState<string>(
    existing?.withdrawalSource ?? "label",
  );
  const [stockItem, setStockItem] = useState<string>(NO_STOCK);
  const [product, setProduct] = useState(existing?.product ?? "");
  const [meatDays, setMeatDays] = useState(
    existing?.meatWithdrawalDays === null ||
      existing?.meatWithdrawalDays === undefined
      ? ""
      : String(existing.meatWithdrawalDays),
  );
  const [milkDays, setMilkDays] = useState(
    existing?.milkWithdrawalDays === null ||
      existing?.milkWithdrawalDays === undefined
      ? ""
      : String(existing.milkWithdrawalDays),
  );
  const [suggestion, setSuggestion] = useState<string | null>(null);
  // Unique per dialog: the lot page carries the header's form and one correction
  // form per row, and duplicate ids would point every label at the first.
  const fieldId = existing ? existing.id : livestockLotId;

  /**
   * When the product loses focus, offer what this farm entered last time.
   *
   * **The only default anywhere in this app**, and it is the farm's own record
   * rather than a claim — never overwriting anything already typed, and always
   * labelled with the date it came from so nobody mistakes it for the app
   * knowing something about the drug.
   */
  function offerPrevious(name: string) {
    // Not while correcting. The figures on screen ARE this farm's record, and
    // quietly replacing them with an older entry for the same product is the
    // opposite of what somebody opening a correction wants.
    if (existing) return;
    const wanted = name.trim();
    if (!wanted) return;
    startTransition(async () => {
      const result = await lastTreatmentOfProductAction({ product: wanted });
      if ("error" in result || !result.previous) {
        setSuggestion(null);
        return;
      }
      const previous = result.previous;
      let filled = false;
      if (!meatDays && previous.meatWithdrawalDays !== null) {
        setMeatDays(String(previous.meatWithdrawalDays));
        filled = true;
      }
      if (!milkDays && previous.milkWithdrawalDays !== null) {
        setMilkDays(String(previous.milkWithdrawalDays));
        filled = true;
      }
      setSuggestion(
        filled
          ? `Filled in from what you recorded for ${wanted} on ${previous.treatedOn}. Check it against the label — the period changes with the dose and the route.`
          : `You last recorded ${wanted} on ${previous.treatedOn}.`,
      );
    });
  }

  function submit(formData: FormData) {
    const name = String(formData.get("product") ?? "").trim();
    if (!name) {
      toast.error("Say what was given.");
      return;
    }
    const parseDays = (raw: string): number | null => {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      const value = Number(trimmed);
      return Number.isInteger(value) && value >= 0 ? value : null;
    };
    const meat = parseDays(meatDays);
    const milk = parseDays(milkDays);
    if (source !== "none_stated" && meat === null && milk === null) {
      toast.error(
        "Give a meat or milk withdrawal, or say the period was not looked up.",
      );
      return;
    }

    const quantity = Number(String(formData.get("stockQuantity") ?? "0"));
    const fields = {
      treatedOn: String(formData.get("treatedOn") ?? today),
      product: name,
      dose: String(formData.get("dose") ?? ""),
      route,
      headTreated: Number(formData.get("headTreated") ?? 0) || null,
      meatWithdrawalDays: meat,
      milkWithdrawalDays: milk,
      withdrawalSource: source,
      administeredBy: String(formData.get("administeredBy") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    };

    startTransition(async () => {
      const result = existing
        ? await updateTreatmentAction({ id: existing.id, ...fields })
        : await recordTreatmentAction({
            livestockLotId,
            ...fields,
            fromStock:
              stockItem === NO_STOCK || !quantity || quantity <= 0
                ? null
                : { itemId: stockItem, quantity },
          });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        source === "none_stated"
          ? `${existing ? "Corrected" : "Recorded"} — look the withdrawal up before these go anywhere`
          : existing
            ? "Corrected"
            : "Recorded",
      );
      setOpen(false);
      router.refresh();
    });
  }

  const stockUnit = medicines.find((m) => m.id === stockItem)?.unit;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant={existing ? "ghost" : "outline"} size="sm">
            {existing ? "Correct" : "Treat"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>
              {existing ? "Correct this treatment" : `Treat ${lotCode}`}
            </DialogTitle>
            <DialogDescription>
              {existing
                ? "A treatment record is an observation, not a ledger entry: if a date or a period was typed wrong, no such record ever happened. Changing one moves the withdrawal clock, which is what decides whether these can be processed."
                : "The withdrawal is the point of this record: until it clears, these cannot be processed and their milk cannot be sold. Read the periods off the label in front of you — this app does not know them and will not guess."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`product-${fieldId}`}>What was given</Label>
                <Input
                  id={`product-${fieldId}`}
                  name="product"
                  list={`products-${fieldId}`}
                  required
                  maxLength={200}
                  autoFocus
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                  onBlur={(e) => offerPrevious(e.target.value)}
                  placeholder="e.g. Penicillin G"
                />
                {/* Suggestions, not a closed list — the next bottle this farm
                    buys will not be on it. */}
                <datalist id={`products-${fieldId}`}>
                  {products.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`treated-${fieldId}`}>When</Label>
                <Input
                  id={`treated-${fieldId}`}
                  name="treatedOn"
                  type="date"
                  defaultValue={existing?.treatedOn ?? today}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`dose-${fieldId}`}>Dose</Label>
                <Input
                  id={`dose-${fieldId}`}
                  name="dose"
                  maxLength={200}
                  defaultValue={existing?.dose}
                  placeholder="e.g. 1 cc per 100 lb"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`route-${fieldId}`}>How</Label>
                <Select value={route} onValueChange={setRoute}>
                  <SelectTrigger id={`route-${fieldId}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TREATMENT_ROUTES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {treatmentRouteLabel(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-md border p-3">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor={`meat-${fieldId}`}>
                    Meat withdrawal (days)
                  </Label>
                  <Input
                    id={`meat-${fieldId}`}
                    type="number"
                    min="0"
                    step="1"
                    value={meatDays}
                    onChange={(e) => setMeatDays(e.target.value)}
                    placeholder="off the label"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`milk-${fieldId}`}>
                    Milk withdrawal (days)
                  </Label>
                  <Input
                    id={`milk-${fieldId}`}
                    type="number"
                    min="0"
                    step="1"
                    value={milkDays}
                    onChange={(e) => setMilkDays(e.target.value)}
                    placeholder="off the label"
                  />
                </div>
              </div>
              <div className="mt-3 grid gap-2">
                <Label htmlFor={`source-${fieldId}`}>
                  Where those came from
                </Label>
                <Select value={source} onValueChange={setSource}>
                  <SelectTrigger id={`source-${fieldId}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(WITHDRAWAL_SOURCE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {/* The line that makes leaving them empty safe rather than
                    convenient. */}
                {source === "none_stated"
                  ? "This lot will read as NOT clear until somebody looks the period up. An unknown is not a zero."
                  : source === "vet"
                    ? "Extra-label use extends withdrawal, and only a vet can say by how much."
                    : "Periods change with the dose, the route and the species. Zero is a real answer for plenty of products."}
              </p>
              {suggestion && (
                <p className="mt-2 text-xs text-muted-foreground">{suggestion}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`headtreated-${fieldId}`}>
                  How many treated
                </Label>
                <Input
                  id={`headtreated-${fieldId}`}
                  name="headTreated"
                  type="number"
                  min="0"
                  step="1"
                  max={head > 0 ? head : undefined}
                  defaultValue={existing?.headTreated ?? (head > 0 ? head : undefined)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`by-${fieldId}`}>Given by</Label>
                <Input
                  id={`by-${fieldId}`}
                  name="administeredBy"
                  maxLength={200}
                  defaultValue={existing?.administeredBy}
                  placeholder="e.g. Dr Ames"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {/* Said out loud because it surprises people, and because it is
                  the safe reading. */}
              The withdrawal applies to the whole lot however many were treated —
              nothing here can tell the three that were injected from the
              thirty-seven that were not.
            </p>

            {!existing && medicines.length > 0 && (
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor={`stock-${livestockLotId}`}>Out of stock</Label>
                  <Select value={stockItem} onValueChange={setStockItem}>
                    <SelectTrigger id={`stock-${livestockLotId}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_STOCK}>
                        Not from stock
                      </SelectItem>
                      {medicines.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {stockItem !== NO_STOCK && (
                  <div className="grid gap-2">
                    <Label htmlFor={`stockqty-${livestockLotId}`}>
                      How much{stockUnit ? ` (${stockUnit})` : ""}
                    </Label>
                    <Input
                      id={`stockqty-${livestockLotId}`}
                      name="stockQuantity"
                      type="number"
                      min="0"
                      step="0.0001"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor={`tnotes-${fieldId}`}>Notes</Label>
              <Textarea
                id={`tnotes-${fieldId}`}
                name="notes"
                rows={2}
                maxLength={2000}
                defaultValue={existing?.notes}
                placeholder="Two coughing at the shade end."
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : existing ? "Correct" : "Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
