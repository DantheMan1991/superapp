"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";
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
import { formatWeight, weightOf } from "@/packs/inventory/core/weight";
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
  /**
   * Pounds per stocking unit for THIS batch, or null when nobody weighed one.
   *
   * Per batch rather than per item because that is where the figure is true: a
   * run packed in 1 lb bags and a run packed in 2 lb bags are different lots.
   * See `weightRatesForItems` in the inventory pack.
   */
  weightRate?: number | null;
}

export interface LoadableItem {
  id: string;
  name: string;
  unit: string;
  /** The item's average, used only for a line with no batch chosen. */
  weightRate?: number | null;
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
export interface OnTruckLine {
  itemId: string;
  lotId: string | null;
  onHand: number;
}

interface MoveRow {
  /** Stable across re-renders so removing a row does not re-key the others. */
  key: string;
  itemId: string;
  /** `NO_LOT` when the item has no batches, or none was chosen. */
  lotId: string;
  /** Kept as text: an empty box is not a zero. */
  quantity: string;
}

let rowSeq = 0;
function blankRow(itemId = ""): MoveRow {
  rowSeq += 1;
  return { key: `row-${rowSeq}`, itemId, lotId: NO_LOT, quantity: "" };
}

/**
 * Load the truck, or bring back what did not sell.
 *
 * **A TRUCK IS LOADED WITH MANY THINGS AT ONCE**, and the first version of this
 * form asked for them one at a time. Five cuts of beef, four of chicken and a
 * crate of produce meant opening the same dialog ten times, which is a form
 * nobody finishes — so the truck stayed empty and the till had nothing to sell.
 *
 * **BRINGING BACK STARTS FULL.** At the end of a market you take home whatever
 * is left, so the unload dialog opens with a row per batch still on the truck at
 * its full remaining quantity. The common case is one click; adjusting is for
 * the pound somebody gave away.
 *
 * The DAY and the OTHER END stay per move rather than per row, because that is
 * what actually happens — one morning, one place.
 */
export function TruckMoveForm({
  truckAssetId,
  items,
  lots,
  locations,
  onTruck,
  today,
  direction,
}: {
  truckAssetId: string;
  items: LoadableItem[];
  lots: LoadableLot[];
  locations: PlaceOption[];
  /** What is on the truck now, by item and batch. Only used when unloading. */
  onTruck?: OnTruckLine[];
  today: string;
  direction: "load" | "unload";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const loading = direction === "load";

  const [rows, setRows] = useState<MoveRow[]>([blankRow()]);

  /** How much of each (item, batch) is on the truck — the cap when unloading. */
  const onHandByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of onTruck ?? []) {
      map.set(`${line.itemId}:${line.lotId ?? NO_LOT}`, line.onHand);
    }
    return map;
  }, [onTruck]);

  function openRows() {
    if (loading || !onTruck?.length) {
      setRows([blankRow(items[0]?.id ?? "")]);
      return;
    }
    rowSeq += 1;
    setRows(
      onTruck.map((line, i) => ({
        key: `row-${rowSeq}-${i}`,
        itemId: line.itemId,
        lotId: line.lotId ?? NO_LOT,
        quantity: String(line.onHand),
      })),
    );
  }

  function patch(key: string, change: Partial<MoveRow>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...change } : row)),
    );
  }

  function submit(formData: FormData) {
    // A row somebody added and never filled in should not block the load; a
    // form where EVERY row is blank is a different mistake and gets said out loud.
    const lines = rows
      .filter((row) => row.itemId && Number(row.quantity) > 0)
      .map((row) => ({
        itemId: row.itemId,
        lotId: row.lotId === NO_LOT ? null : row.lotId,
        quantity: Number(row.quantity),
      }));
    if (lines.length === 0) {
      toast.error(
        loading
          ? "Add at least one thing to put on the truck."
          : "Say how much is coming back.",
      );
      return;
    }

    const other = String(formData.get("otherLocation") ?? NO_LOCATION);
    startTransition(async () => {
      const shared = {
        truckAssetId,
        occurredOn: String(formData.get("occurredOn") ?? today),
        lines,
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
      const n = lines.length;
      toast.success(
        loading
          ? `${n} ${n === 1 ? "thing" : "things"} on the truck`
          : `${n} ${n === 1 ? "thing" : "things"} back off the truck`,
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Rebuilt on every open, because the truck's stock changes as things
        // sell — a prefill captured at mount would offer this morning's load.
        if (next) openRows();
        setOpen(next);
      }}
    >
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
      <DialogContent className="sm:max-w-2xl">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>
              {loading ? "Load the truck" : "Bring it back"}
            </DialogTitle>
            <DialogDescription>
              {loading
                ? "A transfer, not a guess — the app knows exactly what left, and the till sells from the truck's own stock. Add a line for each thing going on."
                : "What did not sell goes back. Unsold stock is not lost stock — this starts with everything still on the truck, so change what you need and leave the rest."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              {rows.map((row) => {
                const item = items.find((i) => i.id === row.itemId);
                const rowLots = lots.filter((l) => l.itemId === row.itemId);
                const onHand = onHandByKey.get(`${row.itemId}:${row.lotId}`);
                /**
                 * **WHAT THIS LINE WEIGHS, WHILE SOMEBODY TYPES IT.** A truck
                 * is loaded in packages — that is the whole point of the unit —
                 * and the one thing a count of packages cannot answer is
                 * whether the van will take it. The batch's own rate wins over
                 * the item's, and an item nobody has weighed says nothing at
                 * all rather than "0 lb".
                 */
                const rowRate =
                  rowLots.find((l) => l.id === row.lotId)?.weightRate ??
                  item?.weightRate ??
                  null;
                const typed = Number(row.quantity);
                const reading =
                  item && Number.isFinite(typed) && typed > 0
                    ? weightOf({ unit: item.unit, quantity: typed, rate: rowRate })
                    : null;
                const rowWeight =
                  reading && reading.approximate ? formatWeight(reading) : null;
                return (
                  <div key={row.key} className="flex flex-wrap items-end gap-2">
                    <div className="grid min-w-40 flex-1 gap-1">
                      <Label className="text-xs text-muted-foreground">
                        What
                      </Label>
                      <Select
                        value={row.itemId}
                        onValueChange={(value) =>
                          // The batch belongs to the old item; keeping it would
                          // move stock from a lot that is not this thing's.
                          patch(row.key, { itemId: value, lotId: NO_LOT })
                        }
                      >
                        <SelectTrigger>
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

                    {rowLots.length > 0 && (
                      <div className="grid min-w-32 gap-1">
                        <Label className="text-xs text-muted-foreground">
                          Batch
                        </Label>
                        <Select
                          value={row.lotId}
                          onValueChange={(value) =>
                            patch(row.key, { lotId: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_LOT}>No batch</SelectItem>
                            {rowLots.map((l) => (
                              <SelectItem key={l.id} value={l.id}>
                                {l.code}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="grid w-32 gap-1">
                      <Label className="text-xs text-muted-foreground">
                        How much{item ? ` (${item.unit})` : ""}
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={row.quantity}
                        onChange={(e) =>
                          patch(row.key, { quantity: e.target.value })
                        }
                        aria-label={`How much${item ? ` of ${item.name}` : ""}`}
                      />
                      {!loading && onHand !== undefined && (
                        <p className="text-xs text-muted-foreground">
                          {onHand} on the truck
                        </p>
                      )}
                      {rowWeight && (
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {rowWeight}
                        </p>
                      )}
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      // Never below one row: an empty list is a dialog with
                      // nothing to do and no way back to doing it.
                      disabled={rows.length === 1}
                      onClick={() =>
                        setRows((current) =>
                          current.filter((r) => r.key !== row.key),
                        )
                      }
                      aria-label="Remove this line"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                );
              })}
            </div>

            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRows((current) => [...current, blankRow()])}
              >
                <Plus className="mr-1 size-4" />
                Add another
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
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
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {/* Null is honest for a farm that has never recorded where
                  anything is, and the transfer still balances. */}
              The day and the place are for the whole load. Leaving the place
              blank still records the move; only one end of it is placed.
            </p>
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
