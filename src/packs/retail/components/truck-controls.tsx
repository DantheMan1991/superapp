"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  loadTruckAction,
  unloadTruckAction,
  updateMarketDayAction,
} from "../actions";

const NO_LOCATION = "__none__";
const NO_LOT = "__none__";

export interface LoadableLot {
  id: string;
  itemId: string;
  code: string;
}

export interface LoadableItem {
  id: string;
  name: string;
  unit: string;
}

export interface PlaceOption {
  id: string;
  name: string;
}

function toCents(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

/**
 * Load the truck, or bring it back.
 *
 * **THIS IS WHERE THE OFFLINE PROBLEM WENT.** The design's insight is that the
 * market truck is a mobile inventory location, so loading it is an ordinary
 * transfer: the app knows exactly what left, the till draws down the truck's own
 * stock, and what did not sell comes back. Nothing is shared between devices, so
 * there is nothing to conflict over — the hard part of taking a shop offline
 * simply is not present.
 */
export function TruckMoveForm({
  truckAssetId,
  items,
  lots,
  locations,
  today,
  direction,
}: {
  truckAssetId: string;
  items: LoadableItem[];
  lots: LoadableLot[];
  locations: PlaceOption[];
  today: string;
  direction: "load" | "unload";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [itemId, setItemId] = useState<string>(items[0]?.id ?? "");
  const [lotId, setLotId] = useState<string>(NO_LOT);

  const item = items.find((i) => i.id === itemId);
  const itemLots = useMemo(
    () => lots.filter((l) => l.itemId === itemId),
    [lots, itemId],
  );
  const loading = direction === "load";

  function submit(formData: FormData) {
    if (!itemId) {
      toast.error("Pick what is going on the truck.");
      return;
    }
    const other = String(formData.get("otherLocation") ?? NO_LOCATION);
    startTransition(async () => {
      const shared = {
        itemId,
        lotId: lotId === NO_LOT ? null : lotId,
        quantity: Number(formData.get("quantity")),
        truckAssetId,
        occurredOn: String(formData.get("occurredOn") ?? today),
        notes: String(formData.get("notes") ?? ""),
      };
      const result = loading
        ? await loadTruckAction({
            ...shared,
            fromLocationAssetId: other === NO_LOCATION ? null : other,
          })
        : await unloadTruckAction({
            ...shared,
            toLocationAssetId: other === NO_LOCATION ? null : other,
          });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(loading ? "On the truck" : "Back off the truck");
      setOpen(false);
      setLotId(NO_LOT);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {loading ? "Load the truck" : "Bring it back"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>
              {loading ? "Load the truck" : "Bring it back"}
            </DialogTitle>
            <DialogDescription>
              {loading
                ? "A transfer, not a guess — the app knows exactly what left, and the till sells from the truck's own stock."
                : "What did not sell goes back. Unsold stock is not lost stock."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="truck-item">What</Label>
              <Select
                value={itemId}
                onValueChange={(value) => {
                  setItemId(value);
                  setLotId(NO_LOT);
                }}
              >
                <SelectTrigger id="truck-item">
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

            {itemLots.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="truck-lot">Batch</Label>
                <Select value={lotId} onValueChange={setLotId}>
                  <SelectTrigger id="truck-lot">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_LOT}>No batch</SelectItem>
                    {itemLots.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

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
                  required
                  autoFocus
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="occurredOn">When</Label>
                <Input
                  id="occurredOn"
                  name="occurredOn"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="otherLocation">
                {loading ? "From" : "Back to"}
              </Label>
              <Select name="otherLocation" defaultValue={NO_LOCATION}>
                <SelectTrigger id="otherLocation">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LOCATION}>Not recorded</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {/* Null is honest for a farm that has never recorded where
                    anything is, and the transfer still balances. */}
                Leaving this blank still records the move; only one end of it is
                placed.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Moving…" : loading ? "Load" : "Bring back"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The float at the start and the count at the end.
 *
 * **A BLANK COUNT IS NOT A ZERO COUNT**, which is why this can be left alone and
 * the panel says "not counted" rather than reporting the whole day's takings as
 * a shortfall.
 */
export function CashCountForm({
  marketDayId,
  openingFloatCents,
  cashCountedCents,
  currencySymbol,
}: {
  marketDayId: string;
  openingFloatCents: number | null;
  cashCountedCents: number | null;
  currencySymbol: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await updateMarketDayAction({
        id: marketDayId,
        openingFloatCents: toCents(formData.get("float")),
        cashCountedCents: toCents(formData.get("counted")),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Counted");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {cashCountedCents === null ? "Count the tin" : "Recount"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>The cash tin</DialogTitle>
            <DialogDescription>
              What went out as change and what came back. Only cash sales are
              checked against it — counting card takings as a shortfall is the
              fastest way to teach somebody to ignore the number.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="float">
                Float out {currencySymbol ? `(${currencySymbol})` : ""}
              </Label>
              <Input
                id="float"
                name="float"
                type="number"
                min="0"
                step="0.01"
                defaultValue={
                  openingFloatCents === null
                    ? ""
                    : (openingFloatCents / 100).toFixed(2)
                }
                placeholder="50.00"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="counted">
                Counted in {currencySymbol ? `(${currencySymbol})` : ""}
              </Label>
              <Input
                id="counted"
                name="counted"
                type="number"
                min="0"
                step="0.01"
                defaultValue={
                  cashCountedCents === null
                    ? ""
                    : (cashCountedCents / 100).toFixed(2)
                }
                autoFocus
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
