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
  lastTreatmentOfProductAction,
  recordTreatmentAction,
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
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [route, setRoute] = useState<string>("water");
  const [source, setSource] = useState<string>("label");
  const [stockItem, setStockItem] = useState<string>(NO_STOCK);
  const [product, setProduct] = useState("");
  const [meatDays, setMeatDays] = useState("");
  const [milkDays, setMilkDays] = useState("");
  const [suggestion, setSuggestion] = useState<string | null>(null);

  /**
   * When the product loses focus, offer what this farm entered last time.
   *
   * **The only default anywhere in this app**, and it is the farm's own record
   * rather than a claim — never overwriting anything already typed, and always
   * labelled with the date it came from so nobody mistakes it for the app
   * knowing something about the drug.
   */
  function offerPrevious(name: string) {
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
    startTransition(async () => {
      const result = await recordTreatmentAction({
        livestockLotId,
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
          ? "Recorded — look the withdrawal up before these go anywhere"
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
          <Button variant="outline" size="sm">
            Treat
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Treat {lotCode}</DialogTitle>
            <DialogDescription>
              The withdrawal is the point of this record: until it clears, these
              cannot be processed and their milk cannot be sold. Read the periods
              off the label in front of you — this app does not know them and
              will not guess.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`product-${livestockLotId}`}>What was given</Label>
                <Input
                  id={`product-${livestockLotId}`}
                  name="product"
                  list={`products-${livestockLotId}`}
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
                <datalist id={`products-${livestockLotId}`}>
                  {products.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`treated-${livestockLotId}`}>When</Label>
                <Input
                  id={`treated-${livestockLotId}`}
                  name="treatedOn"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`dose-${livestockLotId}`}>Dose</Label>
                <Input
                  id={`dose-${livestockLotId}`}
                  name="dose"
                  maxLength={200}
                  placeholder="e.g. 1 cc per 100 lb"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`route-${livestockLotId}`}>How</Label>
                <Select value={route} onValueChange={setRoute}>
                  <SelectTrigger id={`route-${livestockLotId}`}>
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
                  <Label htmlFor={`meat-${livestockLotId}`}>
                    Meat withdrawal (days)
                  </Label>
                  <Input
                    id={`meat-${livestockLotId}`}
                    type="number"
                    min="0"
                    step="1"
                    value={meatDays}
                    onChange={(e) => setMeatDays(e.target.value)}
                    placeholder="off the label"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`milk-${livestockLotId}`}>
                    Milk withdrawal (days)
                  </Label>
                  <Input
                    id={`milk-${livestockLotId}`}
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
                <Label htmlFor={`source-${livestockLotId}`}>
                  Where those came from
                </Label>
                <Select value={source} onValueChange={setSource}>
                  <SelectTrigger id={`source-${livestockLotId}`}>
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
                <Label htmlFor={`headtreated-${livestockLotId}`}>
                  How many treated
                </Label>
                <Input
                  id={`headtreated-${livestockLotId}`}
                  name="headTreated"
                  type="number"
                  min="0"
                  step="1"
                  max={head > 0 ? head : undefined}
                  defaultValue={head > 0 ? head : undefined}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`by-${livestockLotId}`}>Given by</Label>
                <Input
                  id={`by-${livestockLotId}`}
                  name="administeredBy"
                  maxLength={200}
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

            {medicines.length > 0 && (
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
              <Label htmlFor={`tnotes-${livestockLotId}`}>Notes</Label>
              <Textarea
                id={`tnotes-${livestockLotId}`}
                name="notes"
                rows={2}
                maxLength={2000}
                placeholder="Two coughing at the shade end."
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
