"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
import { Combobox } from "@/components/app/combobox";
import { useConfirm } from "@/components/app/use-confirm";
import {
  postCountAction,
  recordCountLineAction,
  removeCountLineAction,
  startCountAction,
} from "../actions";
import { existingLineFor, type CountedLine } from "../core/counts";
import { formatQuantity, getUnit } from "../core/units";
import { slugLabel } from "../vocabulary";

const NO_LOCATION = "__none__";
const NO_LOT = "__none__";
/** The item picker's id, so "count another" can put the focus back on it. */
const ITEM_PICKER_ID = "count-item";

export interface CountItemOption {
  id: string;
  name: string;
  unit: string;
  /** The item's kind, shown beside the name so two similar names tell apart. */
  kind: string;
}

export interface CountLotOption {
  id: string;
  itemId: string;
  code: string;
}

export interface CountPlaceOption {
  id: string;
  name: string;
}

/** Start walking the shelves. `member` — this is the definition of a chore. */
export function StartCountForm({
  locations,
  today,
  defaultLocationId = null,
  trigger = "Count stock",
  variant = "default",
}: {
  locations: CountPlaceOption[];
  today: string;
  /**
   * Pre-picks `Where`. A posted count offers `Count again` with its own place
   * already chosen: the honest remedy for a count that went wrong is the same
   * walk again, and until 2026-09-09 nothing on the screen said so.
   */
  defaultLocationId?: string | null;
  trigger?: string;
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // A place retired since the last count is not on offer any more, so the
  // picker falls back to Everywhere rather than showing a blank.
  const startAt =
    defaultLocationId && locations.some((l) => l.id === defaultLocationId)
      ? defaultLocationId
      : NO_LOCATION;

  function submit(formData: FormData) {
    const location = String(formData.get("locationAssetId") ?? NO_LOCATION);
    startTransition(async () => {
      const result = await startCountAction({
        countedOn: String(formData.get("countedOn") ?? today),
        locationAssetId: location === NO_LOCATION ? null : location,
        countedBy: String(formData.get("countedBy") ?? ""),
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Count started");
      setOpen(false);
      // PUSH, not push-and-refresh. Calling both races and the refresh wins,
      // which is how production slice 0 dropped people back on a stale list.
      if (result.countId) {
        router.push(`/dashboard/m/inventory/counts/${result.countId}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant}>{trigger}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Count stock</DialogTitle>
            <DialogDescription>
              Record what is actually on the shelf. Nothing changes until you
              post it, so you can walk the whole place first and reconcile at the
              end.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="countedOn">When</Label>
                <Input
                  id="countedOn"
                  name="countedOn"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="countedBy">Who</Label>
                <Input
                  id="countedBy"
                  name="countedBy"
                  maxLength={200}
                  placeholder="e.g. Sarah"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="count-location">Where</Label>
              <Select name="locationAssetId" defaultValue={startAt}>
                <SelectTrigger id="count-location">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LOCATION}>Everywhere</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {/* Different from counting a named freezer and finding it
                    empty, which is why the default is not a location. */}
                Everywhere is the honest answer for counting the whole barn in
                one go.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="count-notes">Notes</Label>
              <Textarea id="count-notes" name="notes" rows={2} maxLength={5000} />
              <p className="text-xs text-muted-foreground">
                Shown at the top of the count, for whoever walks it.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Starting…" : "Start counting"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Record one shelf — and then the next, without leaving the dialog.
 *
 * **THE FORM DOES NOT SHOW WHAT THE LEDGER EXPECTS, and that is deliberate.**
 * A count is worth nothing if the number on the screen anchors the person
 * holding the clipboard — they will see 92, find 88, and write 92. The
 * comparison belongs after the count, not during it.
 *
 * **BUILT FOR THE WALK.** A freezer is twenty shelves and this used to close
 * on every one of them, and its item picker was a closed list to scroll. Now
 * `What` is a type-ahead, `Save and count another` (Enter, too) writes the
 * shelf and resets for the next with the picker focused, and a shelf already
 * on this count is named before it is replaced — `recordCountLine` upserts on
 * item + batch, which was right and was silent.
 */
export function AddCountLineForm({
  countId,
  items,
  lots,
  lines,
}: {
  countId: string;
  /** Active items only — a retired thing is not counted. */
  items: CountItemOption[];
  lots: CountLotOption[];
  /** What is already written down on this walk. */
  lines: CountedLine[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [itemId, setItemId] = useState<string | undefined>(undefined);
  const [lotId, setLotId] = useState<string>(NO_LOT);
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  /** Bumped after a "count another" save; the effect below focuses the picker. */
  const [refocus, setRefocus] = useState(0);

  const item = items.find((i) => i.id === itemId);
  const unitWord = item ? (getUnit(item.unit)?.plural ?? item.unit) : null;
  const itemLots = useMemo(
    () => lots.filter((l) => l.itemId === itemId),
    [lots, itemId],
  );
  const options = useMemo(
    () =>
      items.map((i) => ({
        value: i.id,
        label: i.name,
        hint: slugLabel(i.kind),
      })),
    [items],
  );
  const existing = itemId
    ? existingLineFor(lines, itemId, lotId === NO_LOT ? null : lotId)
    : null;

  /**
   * The notes box shows the note already on this shelf, so what is in the
   * box is what will be stored. The server replaces the note with whatever is
   * sent, which is right — keeping the old text behind an empty box would
   * make a note impossible to clear — so the box has to start with it.
   */
  function pickItem(next: string) {
    setItemId(next);
    setLotId(NO_LOT);
    setNotes(existingLineFor(lines, next, null)?.notes ?? "");
  }

  function pickLot(next: string) {
    setLotId(next);
    if (itemId) {
      setNotes(
        existingLineFor(lines, itemId, next === NO_LOT ? null : next)?.notes ??
          "",
      );
    }
  }

  function reset() {
    setItemId(undefined);
    setLotId(NO_LOT);
    setQuantity("");
    setNotes("");
  }

  function onOpenChange(next: boolean) {
    if (!next) reset();
    setOpen(next);
  }

  function save(another: boolean) {
    if (!itemId || !item) {
      toast.error("Pick what you counted.");
      return;
    }
    const counted = Number(quantity);
    if (quantity.trim() === "" || !Number.isFinite(counted) || counted < 0) {
      toast.error("Type how much is there. Zero is a real answer.");
      return;
    }
    const chosen = item;
    startTransition(async () => {
      const result = await recordCountLineAction({
        countId,
        itemId,
        lotId: lotId === NO_LOT ? null : lotId,
        countedQuantity: counted,
        notes,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      // The shelf is named, because on a walk the toast is the only
      // confirmation of WHICH shelf just went in.
      toast.success(
        `Counted · ${chosen.name} · ${formatQuantity(counted, chosen.unit)}`,
      );
      router.refresh();
      reset();
      if (another) {
        // Focus goes back to the picker for the next shelf — from the effect
        // below, AFTER the reset has committed. A frame callback fired here
        // runs before React commits a transition's state, so it would focus a
        // button that is about to re-render under it.
        setRefocus((n) => n + 1);
      } else {
        setOpen(false);
      }
    });
  }

  useEffect(() => {
    if (refocus > 0) document.getElementById(ITEM_PICKER_ID)?.focus();
  }, [refocus]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Count something
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(event) => {
            // Enter is the walk: save this shelf and stay for the next one.
            event.preventDefault();
            save(true);
          }}
        >
          <DialogHeader>
            <DialogTitle>What is actually there</DialogTitle>
            <DialogDescription>
              What the record thinks is deliberately not shown — a number on the
              screen is the fastest way to make a count agree with a record that
              is wrong.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor={ITEM_PICKER_ID}>What</Label>
              <Combobox
                id={ITEM_PICKER_ID}
                aria-label="What you counted"
                options={options}
                value={itemId}
                onValueChange={pickItem}
                placeholder="Pick an item"
                searchPlaceholder="Type part of the name…"
                emptyText="Nothing you hold is called that."
              />
            </div>

            {itemLots.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="count-lot">Batch</Label>
                <Select value={lotId} onValueChange={pickLot}>
                  <SelectTrigger id="count-lot">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_LOT}>All of it, no batch</SelectItem>
                    {itemLots.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  A batch is counted against that batch. Without one, the count
                  is against everything of this item there is.
                </p>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="countedQuantity">
                How much is there{unitWord ? ` (${unitWord})` : ""}
              </Label>
              <Input
                id="countedQuantity"
                name="countedQuantity"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.0001"
                required
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
              {existing ? (
                /* THE SHELF COUNTED TWICE, said before it is replaced rather
                   than found afterwards from a row that quietly changed. */
                <p className="text-xs font-medium">
                  Already on this count as{" "}
                  {formatQuantity(existing.countedQuantity, item?.unit ?? "each")}
                  . Saving replaces that figure.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {/* Zero is a count; a shelf nobody got to is simply not a
                      line. That difference is why the column is NOT NULL. */}
                  Zero is a real answer — a shelf you walked and found empty.
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="line-notes">Notes</Label>
              <Textarea
                id="line-notes"
                name="notes"
                rows={2}
                maxLength={2000}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => save(false)}
            >
              Save
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save and count another"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Take a shelf off the walk. Asks first: on a card this is a thumb-sized
 * target, and the row it removes was typed in a freezer.
 */
export function RemoveCountLineButton({
  id,
  label,
}: {
  id: string;
  /** What the line is for, so the question names it. */
  label: string;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [pending, startTransition] = useTransition();

  // The guard is OUTSIDE the transition — see `useConfirm`.
  async function remove() {
    const asked = await confirm({
      title: `Take ${label} off this count?`,
      description:
        "The line comes off the walk. Nothing in the record changes until the count is posted, so it can be counted again.",
      confirmLabel: "Remove",
    });
    if (!asked) return;
    startTransition(async () => {
      const result = await removeCountLineAction({ id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Removed");
      router.refresh();
    });
  }

  return (
    <>
      {confirmDialog}
      <Button
        variant="ghost"
        size="sm"
        onClick={remove}
        disabled={pending}
        className="text-muted-foreground"
      >
        Remove
      </Button>
    </>
  );
}

/**
 * Post the count.
 *
 * **THE TOAST SAYS WHAT HAPPENED TO THE LEDGER.** How many shelves agreed is
 * the reassuring half and how many did not is the actionable one; "Saved" says
 * neither.
 */
export function PostCountButton({
  countId,
  lineCount,
  today,
  countedOn,
}: {
  countId: string;
  lineCount: number;
  today: string;
  /** The day it was walked — the earliest day it can be posted. */
  countedOn: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await postCountAction({
        countId,
        postedOn: String(formData.get("postedOn") ?? today),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const agreed = result.agreed ?? 0;
      const adjusted = result.adjusted ?? 0;
      toast.success(
        adjusted === 0
          ? `Posted · all ${agreed} agreed with the record`
          : `Posted · ${adjusted} put right, ${agreed} already agreed`,
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={lineCount === 0}>Post</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Post this count</DialogTitle>
            <DialogDescription>
              Every line that disagrees with the record becomes an adjustment,
              all at once. Lines that agree write nothing — there is no event in
              &ldquo;nothing happened&rdquo;.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="postedOn">Posted</Label>
              <Input
                id="postedOn"
                name="postedOn"
                type="date"
                defaultValue={today < countedOn ? countedOn : today}
                min={countedOn}
                required
              />
              <p className="text-xs text-muted-foreground">
                On or after the day it was counted, {countedOn}. The corrections
                are dated this day.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Once posted the lines cannot be changed. Nothing is overwritten —
              a count never edits an old entry, it writes new ones.
            </p>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Posting…" : "Post and reconcile"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
