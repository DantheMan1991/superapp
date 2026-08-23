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
  removeOrderAction,
  removeOrderLineAction,
  updateOrderLineAction,
} from "../order-actions";
import {
  PRICE_CATEGORY_LABELS,
  PRICE_UNIT_LABELS,
  priceCategoryRank,
  priceWithUnit,
  slugLabel,
} from "../vocabulary";

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
  priceCents: number | null;
  unit: string;
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
  sheetWord,
}: {
  orderId: string;
  options: PriceItemOption[];
  sheetWord: string;
}) {
  const [open, setOpen] = useState(false);
  const [priceItemId, setPriceItemId] = useState(options[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const chosen = options.find((o) => o.id === priceItemId);

  /** The base first, then the layers, then anything nobody anticipated. */
  const grouped = (() => {
    const by = new Map<string, PriceItemOption[]>();
    for (const option of options) {
      const list = by.get(option.category);
      if (list) list.push(option);
      else by.set(option.category, [option]);
    }
    for (const list of by.values()) list.sort((a, b) => a.label.localeCompare(b.label));
    return [...by.entries()].sort(
      ([a], [b]) => priceCategoryRank(a) - priceCategoryRank(b) || a.localeCompare(b),
    );
  })();

  const submit = () => {
    if (!priceItemId) {
      toast.error("Pick what you want.");
      return;
    }
    startTransition(async () => {
      const result = await addOrderLineAction({
        orderId,
        priceItemId,
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
        <Button variant="outline" size="sm" disabled={options.length === 0}>
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
            <Select value={priceItemId} onValueChange={setPriceItemId}>
              <SelectTrigger id="line-item">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {grouped.map(([category, rows]) => (
                  <SelectGroup key={category}>
                    <SelectLabel>
                      {PRICE_CATEGORY_LABELS[category] ?? slugLabel(category)}
                    </SelectLabel>
                    {rows.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label} —{" "}
                        {priceWithUnit(option.priceCents, option.unit) ??
                          "not quoted"}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
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
 * Print it.
 *
 * **THE SHEET IS THE PAGE, NOT A SEPARATE ROUTE.** Same arrangement an invoice
 * uses: `print:` variants hide everything that is not the sheet and reveal a
 * header that only exists on paper. A second route would be a second copy of
 * the same content to keep in step, and the thing being handed over has to say
 * exactly what the screen says.
 */
export function PrintOrderButton({ sheetWord }: { sheetWord: string }) {
  return (
    <Button size="sm" variant="outline" onClick={() => window.print()}>
      Print the {sheetWord.toLowerCase()}
    </Button>
  );
}

/** Category label, for a client component that cannot import a server module. */
export function categoryLabel(category: string): string {
  return PRICE_CATEGORY_LABELS[category] ?? slugLabel(category);
}
