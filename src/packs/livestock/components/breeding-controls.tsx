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
import { useConfirm } from "@/components/app/use-confirm";
import {
  recordBreedingAction,
  recordBreedingCheckAction,
  removeBreedingAction,
  removeBreedingCheckAction,
  updateBreedingAction,
} from "../actions";
import { SEX_LABELS } from "../vocabulary";
import {
  BREEDING_RESULTS,
  BREEDING_RESULT_LABELS,
  type BreedingResult,
} from "../core/breeding";

const NONE = "__none__";

/** An animal the sire picker may offer. */
export interface SireOption {
  id: string;
  code: string;
  sex: string | null;
}

function SireSelect({
  id,
  value,
  onChange,
  sires,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  sires: SireOption[];
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Sire</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Not recorded" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Not recorded</SelectItem>
          {sires.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.code}
              {s.sex ? ` · ${SEX_LABELS[s.sex] ?? s.sex}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        The bull, boar or ram. Leave it if nobody made a record for him, or for
        AI.
      </p>
    </div>
  );
}

/**
 * **THE SIRE WENT IN.** The day he went in and the day he came out are the
 * whole record; the due window is worked out from them and moves if either
 * is corrected. `Out` stays blank while he is still in there.
 *
 * `idPrefix` because the lot page renders its controls once and the pen's
 * member list may render this beside each cow; two dialogs with one field
 * id would label the wrong box.
 */
export function RecordBreedingForm({
  livestockLotId,
  subject,
  sires,
  defaultGestation,
  today,
  idPrefix = "breeding",
  trigger,
}: {
  livestockLotId: string;
  /** "Rosie", or "the pen" — what the dialog is about. */
  subject: string;
  sires: SireOption[];
  /** From the profile for this species; null means the form asks. */
  defaultGestation: number | null;
  today: string;
  idPrefix?: string;
  trigger?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [sire, setSire] = useState(NONE);

  function submit(formData: FormData) {
    const out = String(formData.get("exposedTo") ?? "").trim();
    startTransition(async () => {
      const result = await recordBreedingAction({
        livestockLotId,
        sireLotId: sire === NONE ? null : sire,
        exposedFrom: String(formData.get("exposedFrom") ?? today),
        exposedTo: out === "" ? null : out,
        gestationDays: Number(String(formData.get("gestationDays") ?? "")),
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(out === "" ? "Breeding recorded — say when he comes out" : "Breeding recorded");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {trigger ?? "Record breeding"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Who was in with {subject}?</DialogTitle>
            <DialogDescription>
              The day he went in and the day he came out give the due window.
              Leave <strong>Out</strong> blank while he is still in, and fill it
              in when he comes out. For AI or a hand service, put the same day
              in both.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <SireSelect id={`${idPrefix}-sire`} value={sire} onChange={setSire} sires={sires} />

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`${idPrefix}-from`}>In</Label>
                <Input
                  id={`${idPrefix}-from`}
                  name="exposedFrom"
                  type="date"
                  defaultValue={today}
                  max={today}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${idPrefix}-to`}>Out</Label>
                <Input id={`${idPrefix}-to`} name="exposedTo" type="date" max={today} />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`${idPrefix}-gestation`}>Gestation (days)</Label>
              <Input
                id={`${idPrefix}-gestation`}
                name="gestationDays"
                type="number"
                min="1"
                max="730"
                step="1"
                defaultValue={defaultGestation ?? ""}
                required
              />
              <p className="text-xs text-muted-foreground">
                {defaultGestation
                  ? "Set for the species. Change it if your breed runs long or short; the figure stays on this record."
                  : "Days from conception to birth. Nothing is set for this species, so say what it is."}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`${idPrefix}-notes`}>Notes</Label>
              <Textarea id={`${idPrefix}-notes`} name="notes" rows={2} maxLength={5000} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Record breeding"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * **HE CAME OUT.** The one correction an exposure nearly always needs, as a
 * single box — the window's far end has been today until now, and this is
 * what fixes it.
 */
export function SireOutForm({
  breedingId,
  sireCode,
  exposedFrom,
  today,
  idPrefix,
}: {
  breedingId: string;
  sireCode: string | null;
  exposedFrom: string;
  today: string;
  idPrefix: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await updateBreedingAction({
        id: breedingId,
        exposedTo: String(formData.get("exposedTo") ?? today),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Out date recorded — the due window is set");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          He&rsquo;s out
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>When did {sireCode ?? "the sire"} come out?</DialogTitle>
            <DialogDescription>
              Until now the window has grown by a day every day he stayed. This
              fixes its far end.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor={`${idPrefix}-out`}>Came out</Label>
            <Input
              id={`${idPrefix}-out`}
              name="exposedTo"
              type="date"
              defaultValue={today}
              min={exposedFrom}
              max={today}
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Record it"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Correct any part of an exposure — the dates, the sire, the gestation. */
export function CorrectBreedingForm({
  breeding,
  sires,
  today,
  idPrefix,
}: {
  breeding: {
    id: string;
    sireLotId: string | null;
    exposedFrom: string;
    exposedTo: string | null;
    gestationDays: number;
    notes: string;
  };
  sires: SireOption[];
  today: string;
  idPrefix: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [sire, setSire] = useState(breeding.sireLotId ?? NONE);

  function submit(formData: FormData) {
    const out = String(formData.get("exposedTo") ?? "").trim();
    startTransition(async () => {
      const result = await updateBreedingAction({
        id: breeding.id,
        sireLotId: sire === NONE ? null : sire,
        exposedFrom: String(formData.get("exposedFrom") ?? breeding.exposedFrom),
        exposedTo: out === "" ? null : out,
        gestationDays: Number(String(formData.get("gestationDays") ?? "")),
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Breeding corrected");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          Correct
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Correct this breeding</DialogTitle>
            <DialogDescription>
              Every due date worked out from it moves with the change.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <SireSelect id={`${idPrefix}-sire`} value={sire} onChange={setSire} sires={sires} />
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`${idPrefix}-from`}>In</Label>
                <Input
                  id={`${idPrefix}-from`}
                  name="exposedFrom"
                  type="date"
                  defaultValue={breeding.exposedFrom}
                  max={today}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${idPrefix}-to`}>Out</Label>
                <Input
                  id={`${idPrefix}-to`}
                  name="exposedTo"
                  type="date"
                  defaultValue={breeding.exposedTo ?? ""}
                  max={today}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${idPrefix}-gestation`}>Gestation (days)</Label>
              <Input
                id={`${idPrefix}-gestation`}
                name="gestationDays"
                type="number"
                min="1"
                max="730"
                step="1"
                defaultValue={breeding.gestationDays}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${idPrefix}-notes`}>Notes</Label>
              <Textarea
                id={`${idPrefix}-notes`}
                name="notes"
                rows={2}
                maxLength={5000}
                defaultValue={breeding.notes}
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

/** Remove an exposure that never happened. Checks and births stay: they are facts of their own. */
export function RemoveBreedingButton({
  breedingId,
  label,
}: {
  breedingId: string;
  /** "the breeding from 2026-05-01" */
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();

  async function submit() {
    // Ask first, then start the transition — never await inside it.
    if (
      !(await confirm({
        title: `Remove ${label}?`,
        description:
          "For a breeding that never happened. If a date is simply wrong, correct it instead. Any check or birth recorded stays, and the calendar is worked out again without this.",
        confirmLabel: "Remove",
        destructive: true,
      }))
    ) {
      return;
    }
    startTransition(async () => {
      const result = await removeBreedingAction({ id: breedingId });
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
      <Button variant="ghost" size="sm" onClick={submit} disabled={pending}>
        Remove
      </Button>
      {confirmDialog}
    </>
  );
}

const RESULT_TOASTS: Record<BreedingResult, string> = {
  bred: "Pregnancy recorded",
  open: "Open recorded — no due date until she is bred again",
  lost: "Loss recorded",
};

/**
 * **WHAT THE VET FOUND.** Pregnant, open, or lost. With the vet's estimate of
 * days the window narrows to a date give or take a week; open and lost close
 * it.
 */
export function RecordCheckForm({
  livestockLotId,
  subject,
  today,
  idPrefix = "check",
  trigger,
}: {
  livestockLotId: string;
  subject: string;
  today: string;
  idPrefix?: string;
  trigger?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<BreedingResult>("bred");

  function submit(formData: FormData) {
    const days = String(formData.get("daysBred") ?? "").trim();
    startTransition(async () => {
      const saved = await recordBreedingCheckAction({
        livestockLotId,
        checkedOn: String(formData.get("checkedOn") ?? today),
        result,
        daysBred: result === "bred" && days !== "" ? Number(days) : null,
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in saved) {
        toast.error(saved.error);
        return;
      }
      toast.success(RESULT_TOASTS[result]);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {trigger ?? "Preg check"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>What did you find with {subject}?</DialogTitle>
            <DialogDescription>
              Pregnant narrows the due window when you know how far along she
              is. Open or lost closes it — there is no due date until she is
              bred again.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`${idPrefix}-on`}>Checked</Label>
                <Input
                  id={`${idPrefix}-on`}
                  name="checkedOn"
                  type="date"
                  defaultValue={today}
                  max={today}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${idPrefix}-result`}>Found</Label>
                <Select value={result} onValueChange={(v) => setResult(v as BreedingResult)}>
                  <SelectTrigger id={`${idPrefix}-result`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BREEDING_RESULTS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {BREEDING_RESULT_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {result === "bred" && (
              <div className="grid gap-2">
                <Label htmlFor={`${idPrefix}-days`}>Days pregnant</Label>
                <Input
                  id={`${idPrefix}-days`}
                  name="daysBred"
                  type="number"
                  min="0"
                  max="730"
                  step="1"
                  placeholder="e.g. 90"
                />
                <p className="text-xs text-muted-foreground">
                  As the vet reckoned it on the day. Leave it blank if nobody
                  estimated, and the window stays as it was.
                </p>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor={`${idPrefix}-notes`}>Notes</Label>
              <Textarea id={`${idPrefix}-notes`} name="notes" rows={2} maxLength={5000} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Record check"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveCheckButton({ checkId, label }: { checkId: string; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();

  async function submit() {
    if (
      !(await confirm({
        title: `Remove ${label}?`,
        description: "The calendar is worked out again without it.",
        confirmLabel: "Remove",
        destructive: true,
      }))
    ) {
      return;
    }
    startTransition(async () => {
      const result = await removeBreedingCheckAction({ id: checkId });
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
      <Button variant="ghost" size="sm" onClick={submit} disabled={pending}>
        Remove
      </Button>
      {confirmDialog}
    </>
  );
}
