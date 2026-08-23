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
  addCutAction,
  createProcessorAction,
  removeCutAction,
  removeHandleAction,
  removePriceItemAction,
  setHandleAction,
  setPriceItemAction,
  updateProcessorAction,
} from "../processor-actions";
import {
  INSPECTIONS,
  INSPECTION_LABELS,
  inspectionNote,
  LABELLING_LABELS,
  LABELLING_OPTIONS,
  PRICE_CATEGORIES,
  PRICE_CATEGORY_LABELS,
  PRICE_UNITS,
  PRICE_UNIT_LABELS,
  PRICE_UNIT_NOTES,
  RATING_LABELS,
  slugLabel,
} from "../vocabulary";

/**
 * The processor directory's forms.
 *
 * **THE INSPECTION FIELD EXPLAINS ITSELF UNDERNEATH, and that is the one piece
 * of copy on this screen that has to be there.** Everything else here is a
 * preference; this field decides where meat may legally be sold, and a farm
 * picking "Custom exempt" from a list of five words it half-recognises is
 * exactly how a lot ends up in the wrong channel. The note under it states the
 * SHAPE of each restriction and deliberately asserts no state's specifics —
 * those vary, and this app has no standing to declare them.
 */

interface ProcessorFields {
  name: string;
  inspection: string;
  establishmentNumber: string;
  customLabelling: string;
  labellingNotes: string;
  leadTimeDays: string;
  rating: string;
  goodAt: string;
  notes: string;
}

const EMPTY: ProcessorFields = {
  name: "",
  inspection: "unknown",
  establishmentNumber: "",
  customLabelling: "unknown",
  labellingNotes: "",
  leadTimeDays: "",
  rating: "",
  goodAt: "",
  notes: "",
};

/** "" → null. A blank optional number is unanswered, and unanswered is not 0. */
function numOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function ProcessorFormBody({
  fields,
  setFields,
  word,
}: {
  fields: ProcessorFields;
  setFields: (next: ProcessorFields) => void;
  word: string;
}) {
  const set = <K extends keyof ProcessorFields>(
    key: K,
    value: ProcessorFields[K],
  ) => setFields({ ...fields, [key]: value });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="processor-name">Name</Label>
        <Input
          id="processor-name"
          value={fields.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder={`What everyone calls this ${word.toLowerCase()}`}
        />
      </div>

      <div className="space-y-2">
        <Label>Inspection</Label>
        <Select
          value={fields.inspection}
          onValueChange={(v) => set("inspection", v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INSPECTIONS.map((value) => (
              <SelectItem key={value} value={value}>
                {INSPECTION_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {inspectionNote(fields.inspection, word)}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="processor-est">Establishment number</Label>
        <Input
          id="processor-est"
          value={fields.establishmentNumber}
          onChange={(e) => set("establishmentNumber", e.target.value)}
          placeholder="EST 38"
        />
        <p className="text-xs text-muted-foreground">
          It goes on the label and it is what a traceback follows. Leave it empty
          if there is not one.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Labelling</Label>
          <Select
            value={fields.customLabelling}
            onValueChange={(v) => set("customLabelling", v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LABELLING_OPTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {LABELLING_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="processor-lead">Books ahead (days)</Label>
          <Input
            id="processor-lead"
            type="number"
            min={1}
            value={fields.leadTimeDays}
            onChange={(e) => set("leadTimeDays", e.target.value)}
            placeholder="270"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="processor-label-notes">What they said about labels</Label>
        <Input
          id="processor-label-notes"
          value={fields.labellingNotes}
          onChange={(e) => set("labellingNotes", e.target.value)}
          placeholder="Own label if we supply the artwork, 500 minimum"
        />
      </div>

      <div className="space-y-2">
        <Label>Your rating</Label>
        <Select
          value={fields.rating === "" ? "none" : fields.rating}
          onValueChange={(v) => set("rating", v === "none" ? "" : v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="No view yet" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No view yet</SelectItem>
            {[5, 4, 3, 2, 1].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} — {RATING_LABELS[n]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Yours, not the app&apos;s. What can be measured — yield, condemnations,
          turnaround — is worked out from the runs themselves and shown beside
          this, never merged into it.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="processor-goodat">What they are good at</Label>
        <Textarea
          id="processor-goodat"
          value={fields.goodAt}
          onChange={(e) => set("goodAt", e.target.value)}
          placeholder="Best sausage around. Slow on paperwork."
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="processor-notes">Notes</Label>
        <Textarea
          id="processor-notes"
          value={fields.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>
    </div>
  );
}

function toPayload(fields: ProcessorFields) {
  return {
    name: fields.name.trim(),
    inspection: fields.inspection,
    establishmentNumber: fields.establishmentNumber.trim(),
    customLabelling: fields.customLabelling,
    labellingNotes: fields.labellingNotes.trim(),
    leadTimeDays: numOrNull(fields.leadTimeDays),
    rating: numOrNull(fields.rating),
    goodAt: fields.goodAt.trim(),
    notes: fields.notes.trim(),
  };
}

export function AddProcessorDialog({ word }: { word: string }) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<ProcessorFields>(EMPTY);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    if (!fields.name.trim()) {
      toast.error(`Give the ${word.toLowerCase()} a name.`);
      return;
    }
    startTransition(async () => {
      const result = await createProcessorAction(toPayload(fields));
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${word} added`);
      setFields(EMPTY);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add a {word.toLowerCase()}</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a {word.toLowerCase()}</DialogTitle>
          <DialogDescription>
            What they will take, and what they charge, comes next — this is who
            they are.
          </DialogDescription>
        </DialogHeader>
        <ProcessorFormBody
          fields={fields}
          setFields={setFields}
          word={word}
        />
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditProcessorDialog({
  id,
  word,
  initial,
}: {
  id: string;
  word: string;
  initial: ProcessorFields;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<ProcessorFields>(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    startTransition(async () => {
      const result = await updateProcessorAction({ id, ...toPayload(fields) });
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
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {initial.name}</DialogTitle>
        </DialogHeader>
        <ProcessorFormBody fields={fields} setFields={setFields} word={word} />
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What one processor will take.
 *
 * **THE FEES LEFT THIS DIALOG when the price list was itemised**, and their
 * absence is the point rather than an omission. A plant does not have *a*
 * cutting fee — it has a menu — so three fee boxes here could only ever hold
 * three of the twelve prices on the sheet, and the twelve now live in their own
 * rows with their own units. What stays is what a fee cannot say: whether they
 * take this animal at all, how many a day, and the prose that is not a price.
 */
export function HandleDialog({
  processorId,
  kindOptions,
  existing,
}: {
  processorId: string;
  kindOptions: string[];
  existing?: {
    id: string;
    kind: string;
    capacityPerDay: number | null;
    priceNotes: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(existing?.kind ?? kindOptions[0] ?? "");
  const [capacity, setCapacity] = useState(
    existing?.capacityPerDay?.toString() ?? "",
  );
  const [priceNotes, setPriceNotes] = useState(existing?.priceNotes ?? "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    if (!kind.trim()) {
      toast.error("Say what they take.");
      return;
    }
    startTransition(async () => {
      const result = await setHandleAction({
        processorId,
        kind: kind.trim(),
        capacityPerDay: numOrNull(capacity),
        priceNotes: priceNotes.trim(),
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
        <Button variant={existing ? "ghost" : "outline"} size="sm">
          {existing ? "Edit" : "Add what they take"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? "Edit" : "What they take"}</DialogTitle>
          <DialogDescription>
            One row per kind. What they charge is a separate list, because a
            plant quotes a menu rather than a price.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="handle-kind">What</Label>
            {kindOptions.length > 0 && !existing ? (
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="handle-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kindOptions.map((k) => (
                    <SelectItem key={k} value={k}>
                      {slugLabel(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="handle-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                disabled={Boolean(existing)}
              />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="handle-capacity">Head per day</Label>
            <Input
              id="handle-capacity"
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="handle-notes">Anything that is not a price</Label>
            <Input
              id="handle-notes"
              value={priceNotes}
              onChange={(e) => setPriceNotes(e.target.value)}
              placeholder="Book ducks and geese by age, not by weight"
            />
          </div>
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

/**
 * One priced line off a rate sheet, typed rather than extracted.
 *
 * **THE UNIT IS THE FIELD THAT MATTERS AND THE FORM SAYS SO.** $1.05 is a
 * different amount of money per bird and per pound, and the pack has already
 * paid once for a column that could only hold one of them. The note under the
 * picker explains what each unit is measured against, because "per lb hanging"
 * and "per lb packaged" are the same words to somebody who has not butchered.
 *
 * Prices are DOLLARS here and cents in the database — the conversion is in the
 * action, in one place, so a form can never be the thing that decides what a
 * price means. A blank price is not zero: it is a plant that said to ring them.
 */
export function PriceItemDialog({
  processorId,
  kindOptions,
  existing,
}: {
  processorId: string;
  kindOptions: string[];
  existing?: {
    id: string;
    kind: string;
    category: string;
    label: string;
    priceCents: number | null;
    unit: string;
    minimumCents: number | null;
    notes: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(existing?.kind ?? "");
  const [category, setCategory] = useState(existing?.category ?? "cutting");
  const [label, setLabel] = useState(existing?.label ?? "");
  const [price, setPrice] = useState(
    existing?.priceCents != null ? (existing.priceCents / 100).toFixed(2) : "",
  );
  const [unit, setUnit] = useState(existing?.unit ?? "head");
  const [minimum, setMinimum] = useState(
    existing?.minimumCents != null
      ? (existing.minimumCents / 100).toFixed(2)
      : "",
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    if (!label.trim()) {
      toast.error("Say what they charge for.");
      return;
    }
    startTransition(async () => {
      const result = await setPriceItemAction({
        processorId,
        kind,
        category,
        label: label.trim(),
        price: numOrNull(price),
        unit,
        minimum: numOrNull(minimum),
        notes: notes.trim(),
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
        <Button variant={existing ? "ghost" : "outline"} size="sm">
          {existing ? "Edit" : "Add a price"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? "Edit a price" : "Add a price"}</DialogTitle>
          <DialogDescription>
            One row per priced thing on their sheet. Quartered and eight-piece
            are two prices, not one cutting fee, and picking between them is a
            decision for an order.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="price-label">What they charge for</Label>
            <Input
              id="price-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Cut, wrap and freeze"
              disabled={Boolean(existing)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="price-kind">For</Label>
              <Select
                value={kind === "" ? "none" : kind}
                onValueChange={(v) => setKind(v === "none" ? "" : v)}
              >
                <SelectTrigger id="price-kind" disabled={Boolean(existing)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Anything they take</SelectItem>
                  {kindOptions.map((k) => (
                    <SelectItem key={k} value={k}>
                      {slugLabel(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="price-category">Group</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="price-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRICE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {PRICE_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                  {!(PRICE_CATEGORIES as readonly string[]).includes(
                    category,
                  ) && (
                    <SelectItem value={category}>
                      {slugLabel(category)}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="price-amount">Price</Label>
              <Input
                id="price-amount"
                type="number"
                step="0.01"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price-unit">Per</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger id="price-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRICE_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {PRICE_UNIT_LABELS[u]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {PRICE_UNIT_NOTES[unit]}
          </p>
          <div className="space-y-2">
            <Label htmlFor="price-minimum">Minimum</Label>
            <Input
              id="price-minimum"
              type="number"
              step="0.01"
              min={0}
              value={minimum}
              onChange={(e) => setMinimum(e.target.value)}
              placeholder="A floor, not a price"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="price-notes">Conditions</Label>
            <Input
              id="price-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Quoted as a range: $0.65 to $0.90"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            What they quoted, not what they billed. The bill is a bill, against
            the same name, and keeping the two apart is what makes &ldquo;they
            charged more than they said&rdquo; a question the data can answer.
          </p>
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
export function AddCutDialog({
  processorId,
  kindOptions,
}: {
  processorId: string;
  kindOptions: string[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    if (!name.trim()) {
      toast.error("Name the cut.");
      return;
    }
    startTransition(async () => {
      const result = await addCutAction({
        processorId,
        name: name.trim(),
        kind: kind === "any" ? "" : kind,
        notes: notes.trim(),
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Added");
      setName("");
      setNotes("");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Add a cut
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>A cut they will do</DialogTitle>
          <DialogDescription>
            What this place CAN produce. What you actually asked for on one
            animal is the cut sheet, and that is a different record.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cut-name">Cut</Label>
            <Input
              id="cut-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bone-in ribeye"
            />
          </div>
          <div className="space-y-2">
            <Label>Only for</Label>
            <Select
              value={kind === "" ? "any" : kind}
              onValueChange={(v) => setKind(v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Anything they take</SelectItem>
                {kindOptions.map((k) => (
                  <SelectItem key={k} value={k}>
                    {slugLabel(k)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cut-notes">Notes</Label>
            <Input
              id="cut-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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

export function RemoveHandleButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await removeHandleAction({ id });
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

export function RemoveCutButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await removeCutAction({ id });
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

export function RemovePriceItemButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await removePriceItemAction({ id });
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
