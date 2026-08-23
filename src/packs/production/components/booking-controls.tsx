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
  createBookingAction,
  removeBookingAction,
  startRunFromBookingAction,
  updateBookingAction,
} from "../booking-actions";
import {
  BOOKING_STATUSES,
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_NOTES,
  slugLabel,
} from "../vocabulary";

/**
 * The booking forms.
 *
 * **THE CAPACITY WARNING IS A SENTENCE, NEVER A REFUSAL.** Promising twenty
 * hogs to a plant that told you eight a day is often correct — it is two days,
 * or the figure is stale, or they made an exception. This app has no standing to
 * overrule a farm about what another business agreed to, so the form says the
 * two numbers disagree and lets a person decide. Same call `land` makes between
 * declared and measured acreage.
 */

interface ProcessorOption {
  id: string;
  name: string;
  kinds: { kind: string; capacityPerDay: number | null }[];
}

interface Fields {
  processorId: string;
  bookedFor: string;
  kind: string;
  headCount: string;
  status: string;
  reference: string;
  deposit: string;
  depositPaidOn: string;
  notes: string;
}

function numOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function payload(fields: Fields) {
  return {
    bookedFor: fields.bookedFor,
    kind: fields.kind === "any" ? "" : fields.kind,
    headCount: numOrNull(fields.headCount),
    status: fields.status as (typeof BOOKING_STATUSES)[number],
    reference: fields.reference.trim(),
    deposit: numOrNull(fields.deposit),
    depositPaidOn: fields.depositPaidOn === "" ? null : fields.depositPaidOn,
    notes: fields.notes.trim(),
  };
}

function FormBody({
  fields,
  setFields,
  processors,
  word,
  lockProcessor,
}: {
  fields: Fields;
  setFields: (next: Fields) => void;
  processors: ProcessorOption[];
  word: string;
  lockProcessor?: boolean;
}) {
  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields({ ...fields, [key]: value });

  const chosen = processors.find((p) => p.id === fields.processorId);
  const capacity =
    chosen?.kinds.find((k) => k.kind === fields.kind)?.capacityPerDay ?? null;
  const head = numOrNull(fields.headCount);
  const overCapacity = capacity !== null && head !== null && head > capacity;

  return (
    <div className="space-y-4">
      {!lockProcessor && (
        <div className="space-y-2">
          <Label>Who</Label>
          <Select
            value={fields.processorId}
            onValueChange={(v) => set("processorId", v)}
          >
            <SelectTrigger>
              <SelectValue placeholder={`Pick a ${word.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {processors.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="booking-date">The day</Label>
          <Input
            id="booking-date"
            type="date"
            value={fields.bookedFor}
            onChange={(e) => set("bookedFor", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Standing</Label>
          <Select value={fields.status} onValueChange={(v) => set("status", v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOOKING_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {BOOKING_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {BOOKING_STATUS_NOTES[fields.status]}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>What is going</Label>
          <Select value={fields.kind} onValueChange={(v) => set("kind", v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Not said yet</SelectItem>
              {(chosen?.kinds ?? []).map((k) => (
                <SelectItem key={k.kind} value={k.kind}>
                  {slugLabel(k.kind)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="booking-head">How many head</Label>
          <Input
            id="booking-head"
            type="number"
            min={1}
            value={fields.headCount}
            onChange={(e) => set("headCount", e.target.value)}
          />
        </div>
      </div>
      {overCapacity && (
        <p className="text-xs text-muted-foreground">
          They told you {capacity} a day, and this is {head}. That may be right —
          two days, a stale figure, or an exception they agreed to — so nothing
          is stopping you. It is only worth a second look before the trailer is
          loaded.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="booking-deposit">Deposit</Label>
          <Input
            id="booking-deposit"
            type="number"
            step="0.01"
            min={0}
            value={fields.deposit}
            onChange={(e) => set("deposit", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="booking-paid">Paid on</Label>
          <Input
            id="booking-paid"
            type="date"
            value={fields.depositPaidOn}
            onChange={(e) => set("depositPaidOn", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="booking-ref">Their reference</Label>
          <Input
            id="booking-ref"
            value={fields.reference}
            onChange={(e) => set("reference", e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="booking-notes">Notes</Label>
        <Textarea
          id="booking-notes"
          value={fields.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>
    </div>
  );
}

export function AddBookingDialog({
  processors,
  word,
  today,
}: {
  processors: ProcessorOption[];
  word: string;
  today: string;
}) {
  const empty: Fields = {
    processorId: processors[0]?.id ?? "",
    bookedFor: today,
    kind: "any",
    headCount: "",
    status: "held",
    reference: "",
    deposit: "",
    depositPaidOn: "",
    notes: "",
  };
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Fields>(empty);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    if (!fields.processorId) {
      toast.error(`Pick a ${word.toLowerCase()}.`);
      return;
    }
    startTransition(async () => {
      const result = await createBookingAction({
        processorId: fields.processorId,
        ...payload(fields),
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Date booked");
      setFields(empty);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={processors.length === 0}>Book a date</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Book a date</DialogTitle>
          <DialogDescription>
            The scarce thing. Good places are booked six to twelve months out, so
            this is worth doing before the animals exist.
          </DialogDescription>
        </DialogHeader>
        <FormBody
          fields={fields}
          setFields={setFields}
          processors={processors}
          word={word}
        />
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            Book it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditBookingDialog({
  id,
  initial,
  processors,
  word,
}: {
  id: string;
  initial: Fields;
  processors: ProcessorOption[];
  word: string;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Fields>(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    startTransition(async () => {
      const result = await updateBookingAction({ id, ...payload(fields) });
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
          <DialogTitle>Edit this date</DialogTitle>
        </DialogHeader>
        <FormBody
          fields={fields}
          setFields={setFields}
          processors={processors}
          word={word}
          lockProcessor
        />
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
 * The day arrived. Starts the run and records what the booking became — the
 * write that finally lets anything be measured about a processor.
 */
export function StartRunFromBookingButton({
  bookingId,
  defaultCode,
  runWord,
  kindOptions,
  bookedFor,
}: {
  bookingId: string;
  defaultCode: string;
  runWord: string;
  kindOptions: string[];
  /**
   * THE BOOKED DAY, not today — this is usually being filled in after the fact.
   * Defaulting to today put 23 August on a kill that happened on the 18th, on
   * the very screen whose whole purpose is catching up with a date that already
   * went by. Found by driving it.
   */
  bookedFor: string;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(defaultCode);
  const [runKind, setRunKind] = useState(kindOptions[0] ?? "");
  const [startedOn, setStartedOn] = useState(bookedFor);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    if (!code.trim()) {
      toast.error(`Give the ${runWord.toLowerCase()} a name.`);
      return;
    }
    startTransition(async () => {
      const result = await startRunFromBookingAction({
        bookingId,
        code: code.trim(),
        runKind: runKind || undefined,
        startedOn,
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${runWord} started`);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Start the {runWord.toLowerCase()}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start the {runWord.toLowerCase()}</DialogTitle>
          <DialogDescription>
            This records that the date went ahead. It starts empty — what
            actually went in gets added on the day, because a booking made months
            ago cannot know which pen turned out to be ready.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="from-booking-code">Name</Label>
            <Input
              id="from-booking-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Kind</Label>
              <Select value={runKind} onValueChange={setRunKind}>
                <SelectTrigger>
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="from-booking-date">Started</Label>
              <Input
                id="from-booking-date"
                type="date"
                value={startedOn}
                onChange={(e) => setStartedOn(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            Start it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveBookingButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await removeBookingAction({ id });
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
