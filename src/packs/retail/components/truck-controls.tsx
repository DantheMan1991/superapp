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

/** Blank stays blank: "not recorded" and "recorded as none" are different. */
function numberOrNull(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
  /**
   * The unload list is the truck's own stock, so it changes as things sell. If
   * the selected item leaves the truck entirely, fall back to the first thing
   * still on it rather than holding a value the picker no longer offers.
   */
  const selectable = items.some((i) => i.id === itemId)
    ? itemId
    : (items[0]?.id ?? "");
  const [lotId, setLotId] = useState<string>(NO_LOT);

  const item = items.find((i) => i.id === selectable);
  const itemLots = useMemo(
    () => lots.filter((l) => l.itemId === selectable),
    [lots, selectable],
  );
  const loading = direction === "load";

  function submit(formData: FormData) {
    if (!selectable) {
      toast.error(
        loading
          ? "Pick what is going on the truck."
          : "Nothing on the truck to bring back.",
      );
      return;
    }
    const other = String(formData.get("otherLocation") ?? NO_LOCATION);
    startTransition(async () => {
      const shared = {
        itemId: selectable,
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
        <Button
          variant="outline"
          size="sm"
          /* An empty truck has nothing to bring back, and a dialog with an
             empty picker is a worse way to say so than a dead button. */
          disabled={!loading && items.length === 0}
        >
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
                value={selectable}
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
export function CloseDayForm({
  marketDayId,
  openingFloatCents,
  cashCountedCents,
  stallFeeCents,
  travelCents,
  crewSize,
  hours,
  weather,
  notes,
  currencySymbol,
}: {
  marketDayId: string;
  openingFloatCents: number | null;
  cashCountedCents: number | null;
  stallFeeCents: number | null;
  travelCents: number | null;
  crewSize: number | null;
  hours: number | null;
  weather: string;
  notes: string;
  currencySymbol: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  /**
   * **THE END OF THE DAY, AND EVERYTHING ONLY KNOWABLE THEN.**
   *
   * This used to be "Count the tin" and collected two numbers. The rest — how
   * long you stood there, what the weather did, what getting there cost — lived
   * in the dialog that CREATED the day, which you open before any of it has
   * happened. Meanwhile the float, the one thing you know at seven in the
   * morning, was collected here. Both halves were in the wrong place; opening
   * and closing are two moments now.
   */
  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await updateMarketDayAction({
        id: marketDayId,
        stallFeeCents: toCents(formData.get("stallFee")),
        travelCents: toCents(formData.get("travel")),
        crewSize: numberOrNull(formData.get("crewSize")),
        hours: numberOrNull(formData.get("hours")),
        openingFloatCents: toCents(formData.get("float")),
        cashCountedCents: toCents(formData.get("counted")),
        weather: String(formData.get("weather") ?? ""),
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Day closed");
      setOpen(false);
      router.refresh();
    });
  }

  /**
   * No `closed_at` column, deliberately — nothing reads a closed state, and a
   * column with no reader is exactly what this repo refuses. The label leans on
   * whether the end-of-day facts exist yet.
   */
  const closed = cashCountedCents !== null || hours !== null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {closed ? "Edit the day" : "Close the day"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Close the day</DialogTitle>
            <DialogDescription>
              What it cost to stand there and how it went. Two seasons of this
              is what settles which market is worth going to and which one is
              habit.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
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
            <p className="text-xs text-muted-foreground">
              {/* Leaving the count blank must stay meaningful: not counted and
                  counted-and-right are different facts. */}
              Only cash sales are checked against the tin — counting card
              takings as a shortfall is the fastest way to teach somebody to
              ignore the number. Leave it blank if nobody counted.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="stallFee">
                  Stall fee {currencySymbol ? `(${currencySymbol})` : ""}
                </Label>
                <Input
                  id="stallFee"
                  name="stallFee"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={
                    stallFeeCents === null
                      ? ""
                      : (stallFeeCents / 100).toFixed(2)
                  }
                  placeholder="35.00"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="travel">
                  Getting there {currencySymbol ? `(${currencySymbol})` : ""}
                </Label>
                <Input
                  id="travel"
                  name="travel"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={
                    travelCents === null ? "" : (travelCents / 100).toFixed(2)
                  }
                  placeholder="18.00"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="crewSize">Crew</Label>
                <Input
                  id="crewSize"
                  name="crewSize"
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  defaultValue={crewSize ?? ""}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="hours">Hours stood there</Label>
                <Input
                  id="hours"
                  name="hours"
                  type="number"
                  min="0"
                  step="0.25"
                  inputMode="decimal"
                  defaultValue={hours ?? ""}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {/* The whole argument for the table: own hours at zero make every
                  market look profitable and the dud invisible. */}
              Hours are recorded beside the money, never inside it. If your own
              time counts as nothing, every market looks worth going to.
            </p>

            <div className="grid gap-2">
              <Label htmlFor="weather">Weather</Label>
              <Input
                id="weather"
                name="weather"
                maxLength={300}
                defaultValue={weather}
                placeholder="e.g. rained until eleven"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="day-notes">Notes</Label>
              <Textarea
                id="day-notes"
                name="notes"
                rows={2}
                maxLength={5000}
                defaultValue={notes}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : closed ? "Save" : "Close the day"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
