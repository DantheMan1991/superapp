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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addOrderLineAction,
  createOrderAction,
  markOrderPrintedAction,
  removeOrderAction,
  removeOrderLineAction,
  updateOrderLineAction,
} from "../order-actions";
import {
  PRICE_CATEGORY_LABELS,
  PRICE_UNIT_LABELS,
  compareLabels,
  priceCategoryRank,
  priceWithUnit,
  slugLabel,
} from "../vocabulary";
import {
  BAND_REFUSALS,
  describeBand,
  isBanded,
  resolveBands,
  type BandRefusal,
} from "../core/band";

/**
 * The cut sheet's controls.
 *
 * **THE OPTIONS COME OFF THE PLANT'S OWN RATE SHEET AND NOTHING IS TYPED
 * TWICE.** Picking a price copies its label, price, unit and minimum onto the
 * line and then stops looking at it — a rate sheet updated in March must not
 * restate what an October order was quoted, which is the same stamping rule the
 * ledger follows for a movement's cost.
 *
 * **AN INSTRUCTION IS A FIRST-CLASS LINE.** *"Ribeyes at one inch, grind the
 * chuck"* is half of what a cut sheet is and it has no price at all. The second
 * button writes one, and it prints on the sheet the plant reads while
 * contributing nothing to the total.
 */

function numOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export interface PriceItemOption {
  id: string;
  kind: string;
  category: string;
  label: string;
  variant: string;
  headMin: number;
  headMax: number | null;
  priceCents: number | null;
  unit: string;
  minimumCents: number | null;
}

/**
 * Somewhere a sheet can hang off: a date that is still coming, or a run that is
 * still open. **The CHECK insists on one of the two**, because a sheet attached
 * to nothing is a sheet for a day that does not exist.
 */
export interface SheetTarget {
  id: string;
  what: "booking" | "run";
  processorId: string;
  processorName: string;
  /** How it reads in the picker — a date and a plant, or a run's own code. */
  label: string;
}

/**
 * Start a sheet from the list of them.
 *
 * **THE FOUNDER COULD NOT FIND THE CUT SHEET, WHICH IS THE BUG THIS CLOSES.**
 * Until now the only two ways to reach one were a row on Booked dates and a card
 * inside an open run, so writing a sheet meant already knowing which date or
 * which run it belonged to and navigating there first. Here the question is
 * asked the other way round: start one, then say what it is for.
 *
 * **THE PLANT IS NOT A FIELD.** It comes with whatever the sheet is attached to,
 * because a sheet quotes the rates of the place it is going to and a picker
 * offering the two independently would let somebody pair a date at Miller's with
 * Valley Poultry's prices — which `addOrderLine` refuses later, at the point
 * where it is a confusing error rather than an impossible choice.
 */
export function StartSheetDialog({
  targets,
  kindOptions,
  sheetWord,
  runWord,
}: {
  targets: SheetTarget[];
  kindOptions: string[];
  sheetWord: string;
  runWord: string;
}) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("");
  const [headCount, setHeadCount] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const chosen = targets.find((t) => t.id === targetId);
  const bookings = targets.filter((t) => t.what === "booking");
  const runs = targets.filter((t) => t.what === "run");

  const submit = () => {
    if (!chosen) {
      toast.error("Say which day it is for.");
      return;
    }
    startTransition(async () => {
      const result = await createOrderAction({
        processorId: chosen.processorId,
        bookingId: chosen.what === "booking" ? chosen.id : null,
        runId: chosen.what === "run" ? chosen.id : null,
        title: title.trim(),
        kind,
        headCount: numOrNull(headCount),
        notes: notes.trim(),
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Started");
      setTitle("");
      setNotes("");
      setHeadCount("");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={targets.length === 0}>
          Start a {sheetWord.toLowerCase()}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start a {sheetWord.toLowerCase()}</DialogTitle>
          <DialogDescription>
            What you are asking them to do, and which day it goes with. One
            animal can carry two — a half sold to a customer is cut to their
            instructions, and the retained half to yours.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sheet-target">Which day</Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger id="sheet-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {bookings.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Booked dates</SelectLabel>
                    {bookings.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {runs.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>{runWord}</SelectLabel>
                    {runs.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
            {chosen && (
              <p className="text-xs text-muted-foreground">
                Going to {chosen.processorName}, so it quotes their prices.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="sheet-title">Whose</Label>
            <Input
              id="sheet-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Retained half"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sheet-kind">What</Label>
              <Select
                value={kind === "" ? "none" : kind}
                onValueChange={(v) => setKind(v === "none" ? "" : v)}
              >
                <SelectTrigger id="sheet-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not said</SelectItem>
                  {kindOptions.map((k) => (
                    <SelectItem key={k} value={k}>
                      {slugLabel(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sheet-head">How many head</Label>
              <Input
                id="sheet-head"
                type="number"
                min={1}
                value={headCount}
                onChange={(e) => setHeadCount(e.target.value)}
              />
              {/* The count the whole-bird remainder is a share of, so it is
                  worth saying here rather than leaving somebody to find out on
                  the sheet that it could not reconcile. */}
              <p className="text-xs text-muted-foreground">
                What the cutting is a share of — say it and the ones going back
                whole work themselves out.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sheet-notes">Anything else they should know</Label>
            <Textarea
              id="sheet-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || !chosen}>
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddOrderDialog({
  processorId,
  processorName,
  bookingId,
  runId,
  kindOptions,
  sheetWord,
}: {
  processorId: string;
  processorName: string;
  bookingId?: string | null;
  runId?: string | null;
  kindOptions: string[];
  sheetWord: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("");
  const [headCount, setHeadCount] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    startTransition(async () => {
      const result = await createOrderAction({
        processorId,
        bookingId: bookingId ?? null,
        runId: runId ?? null,
        title: title.trim(),
        kind,
        headCount: numOrNull(headCount),
        notes: notes.trim(),
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Started");
      setTitle("");
      setNotes("");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Start a {sheetWord.toLowerCase()}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            A {sheetWord.toLowerCase()} for {processorName}
          </DialogTitle>
          <DialogDescription>
            What you are asking them to do. One animal can carry two — a half
            sold to a customer is cut to their instructions, and the retained
            half to yours.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="order-title">Whose</Label>
            <Input
              id="order-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Retained half"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="order-kind">What</Label>
              <Select
                value={kind === "" ? "none" : kind}
                onValueChange={(v) => setKind(v === "none" ? "" : v)}
              >
                <SelectTrigger id="order-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not said</SelectItem>
                  {kindOptions.map((k) => (
                    <SelectItem key={k} value={k}>
                      {slugLabel(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="order-head">How many head</Label>
              <Input
                id="order-head"
                type="number"
                min={1}
                value={headCount}
                onChange={(e) => setHeadCount(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="order-notes">Anything else they should know</Label>
            <Textarea
              id="order-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Put a priced option on the sheet.
 *
 * **THE QUANTITY IS USUALLY LEFT EMPTY AND THE FORM SAYS WHY.** Nobody knows a
 * hanging weight when the sheet is written, so for anything charged per head or
 * per pound the run measures it later. For a package or a box, empty means
 * nobody has counted, and the fee reports the line rather than assuming one.
 */
export function AddOrderLineDialog({
  orderId,
  options,
  used,
  headCount,
  sheetWord,
}: {
  orderId: string;
  /** Every price this plant quotes for this sheet's animal. NOT yet de-duplicated. */
  options: PriceItemOption[];
  /** Price items already on the sheet. Applied AFTER the bands resolve — see below. */
  used: string[];
  /** How many head the sheet covers. Null is what makes a band unresolvable. */
  headCount: number | null;
  sheetWord: string;
}) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  /**
   * **THE APP DOES THE LOOKUP.** One real chicken sheet prices slaughter as a
   * 4-breed × 6-band grid, so picking a price meant finding one row among 24
   * siblings that all read "Slaughter". The breed and the band are fields now,
   * and for a sheet that says how many head it covers there is exactly one right
   * row — so the picker offers one entry per thing and says which band it used.
   *
   * **THE ALREADY-ADDED FILTER RUNS AFTER THE RESOLUTION, NOT BEFORE.** Taking
   * the covering band out of the input first would leave the group with only the
   * bands that do NOT cover this batch, and it would then report that no band
   * covers it — which is a different and untrue statement from "you already
   * added it".
   */
  const onSheet = new Set(used);
  const groups = resolveBands(options, headCount)
    .filter((g) => !(g.chosen !== null && onSheet.has(g.chosen.id)))
    .sort(
      (a, b) =>
        priceCategoryRank(a.category) - priceCategoryRank(b.category) ||
        a.category.localeCompare(b.category) ||
        compareLabels(a.label, b.label) ||
        a.variant.localeCompare(b.variant),
    );

  /**
   * What can actually be picked. A resolved group offers its one right row; a
   * group nothing could resolve because the sheet has no head count offers its
   * bands individually, since choosing one by hand is then the honest way to
   * write the line and `addOrderLine` has nothing to check it against.
   */
  const offered: Array<{ option: PriceItemOption; text: string; category: string }> =
    [];
  const blocked: Array<{ text: string; reason: BandRefusal }> = [];
  for (const group of groups) {
    const name = [group.label, group.variant].filter((p) => p !== "").join(" · ");
    if (group.chosen) {
      const band = describeBand(group.chosen);
      offered.push({
        option: group.chosen,
        category: group.category,
        text: `${name} — ${
          priceWithUnit(group.chosen.priceCents, group.chosen.unit) ?? "not quoted"
        }${band === "" ? "" : ` · ${band}`}`,
      });
      continue;
    }
    if (group.refusedBecause === "NO_HEAD_COUNT") {
      for (const band of group.bands) {
        if (onSheet.has(band.id)) continue;
        offered.push({
          option: band,
          category: group.category,
          text: `${name} · ${describeBand(band)} — ${
            priceWithUnit(band.priceCents, band.unit) ?? "not quoted"
          }`,
        });
      }
      continue;
    }
    // Reported, never rounded to the nearest band they did quote.
    blocked.push({
      text: name,
      reason: group.refusedBecause ?? "NO_BAND_COVERS",
    });
  }

  /**
   * **THE REASON ONCE, WITH THE NAMES UNDER IT.** Found by driving a 40-bird
   * sheet at a plant with a fifty-bird floor: twelve options were blocked and
   * the picker printed the same sixty-word sentence twelve times. It is the
   * founder's "45 rows in one run is a wall" complaint one screen along — the
   * useful half is WHICH options are unavailable, and the reason is the same
   * reason for all of them.
   */
  const blockedByReason = [...new Set(blocked.map((b) => b.reason))].map(
    (reason) => ({
      reason,
      names: blocked.filter((b) => b.reason === reason).map((b) => b.text),
    }),
  );

  const [priceItemId, setPriceItemId] = useState("");
  /**
   * **FALLS BACK TO THE FIRST OFFER RATHER THAN GOING BLANK.** What is offered
   * changes under this component — adding a line takes it out of the list, and
   * the state would otherwise go on naming a row the picker no longer shows,
   * which submits an id the server then refuses for a reason nothing on screen
   * explains.
   */
  const selected =
    offered.find((o) => o.option.id === priceItemId) ?? offered[0];
  const chosen = selected?.option;

  /** The base first, then the layers, then anything nobody anticipated. */
  const grouped = (() => {
    const by = new Map<string, typeof offered>();
    for (const entry of offered) {
      const list = by.get(entry.category);
      if (list) list.push(entry);
      else by.set(entry.category, [entry]);
    }
    return [...by.entries()].sort(
      ([a], [b]) => priceCategoryRank(a) - priceCategoryRank(b) || a.localeCompare(b),
    );
  })();

  const submit = () => {
    if (!chosen) {
      toast.error("Pick what you want.");
      return;
    }
    const picked = chosen.id;
    startTransition(async () => {
      const result = await addOrderLineAction({
        orderId,
        priceItemId: picked,
        quantity: numOrNull(quantity),
        notes: notes.trim(),
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Added");
      setQuantity("");
      setNotes("");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={offered.length === 0 && blocked.length === 0}
        >
          Add an option
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>What do you want done</DialogTitle>
          <DialogDescription>
            Off their own price list. What it is quoted at now is written onto
            the {sheetWord.toLowerCase()} and stays there, so a price change next
            year does not restate what this one cost.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="line-item">The option</Label>
            {/*
              **GROUPED THE WAY THE SHEET IS BUILT: the base first, then the
              layers on top of it.** Every bird gets slaughtered; cutting,
              packaging and giblets are choices made after that, and a picker
              that lists them all in one run of forty makes the base look like
              an option and the options look like a base.

              The animal is NOT repeated on each line — the whole picker is
              already scoped to this sheet's animal, so printing it forty times
              is the noise this grouping exists to remove.
            */}
            <Select value={chosen?.id ?? ""} onValueChange={setPriceItemId}>
              <SelectTrigger id="line-item">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {grouped.map(([category, rows]) => (
                  <SelectGroup key={category}>
                    <SelectLabel>
                      {PRICE_CATEGORY_LABELS[category] ?? slugLabel(category)}
                    </SelectLabel>
                    {rows.map((entry) => (
                      <SelectItem key={entry.option.id} value={entry.option.id}>
                        {entry.text}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            {/*
              **WHICH BAND IT USED, SAID OUT LOUD.** A resolved price is the app
              having made a decision on somebody's behalf, and a decision nobody
              can see is one nobody can check against the paper.
            */}
            {chosen && isBanded(chosen) && headCount !== null && (
              <p className="text-xs text-muted-foreground">
                {headCount} head falls in their {describeBand(chosen)} band.
              </p>
            )}
            {/*
              **REPORTED, NOT ROUNDED.** A batch no band covers is usually the
              plant saying it will not take one, which is a thing to know before
              loading a trailer.
            */}
            {blockedByReason.map(({ reason, names }) => (
              <p key={reason} className="text-xs text-muted-foreground">
                <span className="font-medium">
                  {names.slice(0, 3).join(", ")}
                  {names.length > 3 ? ` and ${names.length - 3} more` : ""}
                </span>{" "}
                — {BAND_REFUSALS[reason]}
              </p>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="line-quantity">How many</Label>
            <Input
              id="line-quantity"
              type="number"
              step="0.01"
              min={0}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Leave empty and it will be worked out"
            />
            {chosen && (
              <p className="text-xs text-muted-foreground">
                Charged {PRICE_UNIT_LABELS[chosen.unit] ?? chosen.unit}.{" "}
                {["head", "live_lb", "hanging_lb", "finished_lb"].includes(
                  chosen.unit,
                )
                  ? "Left empty, the run works it out from the kill sheet and the boxes."
                  : "Nothing can work this one out — somebody has to count them, now or when the bill comes."}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="line-notes">How you want it</Label>
            <Input
              id="line-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="One inch thick"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A line with no price — the half of a cut sheet that is an instruction. */
export function AddInstructionDialog({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    if (!label.trim()) {
      toast.error("Say what you are asking for.");
      return;
    }
    startTransition(async () => {
      const result = await addOrderLineAction({
        orderId,
        label: label.trim(),
        notes: notes.trim(),
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Added");
      setLabel("");
      setNotes("");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Add an instruction
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tell them how you want it</DialogTitle>
          <DialogDescription>
            Not a charge — a treatment. It prints on the sheet they read and adds
            nothing to the total.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="instruction-label">What</Label>
            <Input
              id="instruction-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Grind the chuck"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="instruction-notes">How</Label>
            <Input
              id="instruction-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="80/20, in one pound packs"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Count what came back — the quantity nothing can measure for you. */
export function CountLineDialog({
  lineId,
  label,
  unit,
  quantity,
}: {
  lineId: string;
  label: string;
  unit: string;
  quantity: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(quantity === null ? "" : String(quantity));
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    startTransition(async () => {
      const result = await updateOrderLineAction({
        id: lineId,
        quantity: numOrNull(value),
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Count
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            How many, {PRICE_UNIT_LABELS[unit] ?? unit}. Empty means nobody has
            counted — which is not nought, and the fee will say so rather than
            assume.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="count-value">How many</Label>
          <Input
            id="count-value"
            type="number"
            step="0.01"
            min={0}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveOrderLineButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await removeOrderLineAction({ id });
          if ("error" in result && result.error) {
            toast.error(result.error);
            return;
          }
          toast.success("Removed");
          router.refresh();
        })
      }
    >
      Remove
    </Button>
  );
}

export function RemoveOrderButton({
  id,
  sheetWord,
}: {
  id: string;
  sheetWord: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await removeOrderAction({ id });
          if ("error" in result && result.error) {
            toast.error(result.error);
            return;
          }
          toast.success(`${sheetWord} removed`);
          router.refresh();
        })
      }
    >
      Remove
    </Button>
  );
}

/**
 * Print it, and record that it was printed.
 *
 * **THE SHEET IS THE PAGE, NOT A SEPARATE ROUTE.** Same arrangement an invoice
 * uses: `print:` variants hide everything that is not the sheet and reveal a
 * header that only exists on paper. A second route would be a second copy of
 * the same content to keep in step, and the thing being handed over has to say
 * exactly what the screen says.
 *
 * **THE STAMP IS FIRED AND NOT WAITED ON.** `window.print()` blocks the tab
 * until the dialog is dismissed, so awaiting the action first would put a pause
 * between the press and the dialog for no benefit — and a sheet that printed but
 * whose stamp failed is a worse outcome than the other way round. A failure is
 * reported and the printing still happens.
 */
export function PrintOrderButton({
  id,
  sheetWord,
}: {
  id: string;
  sheetWord: string;
}) {
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        void markOrderPrintedAction({ id }).then((result) => {
          if ("error" in result && result.error) {
            toast.error(result.error);
            return;
          }
          router.refresh();
        });
        window.print();
      }}
    >
      Print the {sheetWord.toLowerCase()}
    </Button>
  );
}

/** Category label, for a client component that cannot import a server module. */
export function categoryLabel(category: string): string {
  return PRICE_CATEGORY_LABELS[category] ?? slugLabel(category);
}
