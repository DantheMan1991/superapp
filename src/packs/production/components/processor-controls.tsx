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
  setHandleAction,
  updateProcessorAction,
} from "../processor-actions";
import {
  INSPECTIONS,
  INSPECTION_LABELS,
  INSPECTION_NOTES,
  LABELLING_LABELS,
  LABELLING_OPTIONS,
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
          {INSPECTION_NOTES[fields.inspection]}
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
 * What one processor will take, and what it quoted.
 *
 * The fee fields are in DOLLARS here and cents in the database — the conversion
 * is in the action, in one place, so a form can never be the thing that decides
 * what a price means.
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
    killFeeCents: number | null;
    cutWrapCentsPerLb: number | null;
    priceNotes: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(existing?.kind ?? kindOptions[0] ?? "");
  const [capacity, setCapacity] = useState(
    existing?.capacityPerDay?.toString() ?? "",
  );
  const [killFee, setKillFee] = useState(
    existing?.killFeeCents != null ? (existing.killFeeCents / 100).toFixed(2) : "",
  );
  const [cutWrap, setCutWrap] = useState(
    existing?.cutWrapCentsPerLb != null
      ? (existing.cutWrapCentsPerLb / 100).toFixed(2)
      : "",
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
        killFee: numOrNull(killFee),
        cutWrapPerLb: numOrNull(cutWrap),
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
            One row per kind, because a plant quotes a different price for a beef
            than for a hog.
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
          <div className="grid gap-4 sm:grid-cols-3">
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
              <Label htmlFor="handle-kill">Kill fee, per head</Label>
              <Input
                id="handle-kill"
                type="number"
                step="0.01"
                min={0}
                value={killFee}
                onChange={(e) => setKillFee(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="handle-cut">Cut and wrap, per lb</Label>
              <Input
                id="handle-cut"
                type="number"
                step="0.01"
                min={0}
                value={cutWrap}
                onChange={(e) => setCutWrap(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            What they quoted, not what they billed. The bill is a bill, against
            the same name, and keeping the two apart is what makes &ldquo;they
            charged more than they said&rdquo; a question the data can answer.
          </p>
          <div className="space-y-2">
            <Label htmlFor="handle-notes">Minimums, extras</Label>
            <Input
              id="handle-notes"
              value={priceNotes}
              onChange={(e) => setPriceNotes(e.target.value)}
              placeholder="$75 minimum, smoking 90c/lb extra"
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
