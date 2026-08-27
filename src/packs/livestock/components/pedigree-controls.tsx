"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
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
  recordBirthAction,
  setBreedPartsAction,
  setParentsAction,
} from "../actions";
import { SEXES, SEX_LABELS, breedLabel } from "../vocabulary";
import type { ParentCandidate } from "../ops";

const NONE = "__none__";
const CUSTOM = "__custom__";

/** A breed slug the way a person typed it: "Red Angus" becomes `red_angus`. */
function toSlug(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

/** One row of the composition editor, before it is worth sending anywhere. */
type PartDraft = { key: number; breed: string; parts: string };

let nextKey = 0;
const draft = (breed = "", parts = "1"): PartDraft => ({
  key: nextKey++,
  breed,
  parts,
});

/**
 * **WHAT AN ANIMAL IS MADE OF.**
 *
 * Parts rather than percentages, and the editor shows the resulting share as
 * you type — because "2, 1, 1" is quick to enter and "½, ¼, ¼" is what the
 * person is actually thinking, and neither alone is enough.
 */
export function BreedCompositionForm({
  livestockLotId,
  suggestions,
  current,
  trigger,
}: {
  livestockLotId: string;
  /** Breed slugs the profile suggests for this species. Never a closed list. */
  suggestions: string[];
  current: { breed: string; parts: number }[];
  trigger?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<PartDraft[]>(
    current.length > 0
      ? current.map((p) => draft(p.breed, String(p.parts)))
      : [draft()],
  );

  const filled = rows.filter((r) => r.breed.trim() !== "");
  const total = filled.reduce((sum, r) => sum + (Number(r.parts) || 0), 0);

  function update(key: number, patch: Partial<PartDraft>) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  function submit() {
    startTransition(async () => {
      const result = await setBreedPartsAction({
        livestockLotId,
        parts: filled.map((r) => ({
          breed: toSlug(r.breed),
          parts: Math.max(1, Math.round(Number(r.parts) || 1)),
        })),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        filled.length === 0 ? "Breeding cleared" : "Breeding recorded",
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {trigger ?? (current.length > 0 ? "Edit breeding" : "Set breeding")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What is this animal made of?</DialogTitle>
          <DialogDescription>
            Give each breed a number of parts. Two parts Angus beside one
            Hereford and one Simmental is ½, ¼ and ¼ — the numbers do not have
            to add up to anything in particular.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-4">
          <datalist id="breed-suggestions">
            {suggestions.map((breed) => (
              <option key={breed} value={breedLabel(breed)} />
            ))}
          </datalist>

          {rows.map((row, i) => {
            const parts = Number(row.parts) || 0;
            return (
              <div key={row.key} className="flex items-end gap-2">
                <div className="grid flex-1 gap-2">
                  {i === 0 && <Label htmlFor={`breed-${row.key}`}>Breed</Label>}
                  <Input
                    id={`breed-${row.key}`}
                    list="breed-suggestions"
                    value={row.breed}
                    maxLength={63}
                    placeholder="e.g. Angus"
                    onChange={(e) => update(row.key, { breed: e.target.value })}
                  />
                </div>
                <div className="grid w-20 gap-2">
                  {i === 0 && <Label htmlFor={`parts-${row.key}`}>Parts</Label>}
                  <Input
                    id={`parts-${row.key}`}
                    type="number"
                    min="1"
                    step="1"
                    value={row.parts}
                    onChange={(e) => update(row.key, { parts: e.target.value })}
                  />
                </div>
                <div className="w-14 pb-2 text-sm tabular-nums text-muted-foreground">
                  {row.breed.trim() && total > 0
                    ? `${Math.round((parts / total) * 100)}%`
                    : ""}
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Remove this breed"
                  onClick={() =>
                    setRows((prev) =>
                      prev.length === 1
                        ? [draft()]
                        : prev.filter((r) => r.key !== row.key),
                    )
                  }
                >
                  <X className="size-4" />
                </Button>
              </div>
            );
          })}

          <div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setRows((prev) => [...prev, draft()])}
            >
              <Plus className="size-4" /> Add a breed
            </Button>
          </div>

          {/* Clearing every row is a legitimate answer — "I thought I knew and
              I do not" — so it is said out loud rather than left to be
              discovered by pressing save on an empty form. */}
          {filled.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Saving with nothing here clears what is recorded, and the breeding
              goes back to whatever the parents imply.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? "Saving…" : "Save breeding"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A picker over the herd, with "not recorded" as a first-class answer. */
function ParentSelect({
  id,
  label,
  value,
  onChange,
  candidates,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  candidates: ParentCandidate[];
  hint: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Not recorded" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Not recorded</SelectItem>
          {candidates.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.code}
              {c.sex ? ` · ${SEX_LABELS[c.sex] ?? c.sex}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * Name the dam and the sire.
 *
 * Both pickers always send a value, so clearing one clears it — an animal whose
 * sire turns out to have been the other bull needs the box to be emptiable.
 */
export function SetParentsForm({
  livestockLotId,
  candidates,
  damLotId,
  sireLotId,
}: {
  livestockLotId: string;
  candidates: ParentCandidate[];
  damLotId: string | null;
  sireLotId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [dam, setDam] = useState(damLotId ?? NONE);
  const [sire, setSire] = useState(sireLotId ?? NONE);

  // A bull is never the dam and a cow is never the sire, so the list each
  // picker offers leaves out what the write path would refuse anyway. An
  // animal with no sex recorded stays in BOTH lists: not knowing is not a
  // contradiction, and hiding it would be this screen inventing a fact.
  const dams = candidates.filter((c) => c.sex !== "male");
  const sires = candidates.filter((c) => c.sex !== "female");

  function submit() {
    startTransition(async () => {
      const result = await setParentsAction({
        livestockLotId,
        damLotId: dam === NONE ? null : dam,
        sireLotId: sire === NONE ? null : sire,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Parents recorded");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {damLotId || sireLotId ? "Edit parents" : "Set parents"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Who are the parents?</DialogTitle>
          <DialogDescription>
            Either one on its own is worth recording. A parent nobody knows is
            half the animal, and the breeding will say so rather than quietly
            rounding up.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <ParentSelect
            id="dam"
            label="Dam"
            value={dam}
            onChange={setDam}
            candidates={dams}
            hint="The mother. A whole flock can be the dam — that is the only pedigree fifty layers will ever have."
          />
          <ParentSelect
            id="sire"
            label="Sire"
            value={sire}
            onChange={setSire}
            candidates={sires}
            hint="The father. With a bull running with the cows this is the bull that was in with them."
          />
        </div>

        <DialogFooter>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? "Saving…" : "Save parents"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * **A BIRTH.** One calf or a whole farrowing — the lot model takes both.
 *
 * The item is asked for rather than inherited from the dam, and pre-set to
 * hers. A calf and her mother are frequently NOT the same stock line — the cow
 * is in the breeding herd and the calf is destined for beef — so inheriting it
 * silently would file every calf under her.
 */
export function RecordBirthForm({
  damLotId,
  sireLotId,
  candidates,
  items,
  defaultItemId,
  today,
  trigger,
}: {
  damLotId?: string | null;
  sireLotId?: string | null;
  candidates: ParentCandidate[];
  items: { id: string; name: string }[];
  defaultItemId?: string | null;
  today: string;
  trigger?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [dam, setDam] = useState(damLotId ?? NONE);
  const [sire, setSire] = useState(sireLotId ?? NONE);
  const [itemId, setItemId] = useState(
    defaultItemId ?? (items.length === 1 ? items[0].id : ""),
  );
  const [customItem, setCustomItem] = useState("");

  const newItemName = itemId === CUSTOM ? customItem.trim() : "";
  const canSubmit =
    (dam !== NONE || sire !== NONE) &&
    (itemId === CUSTOM ? Boolean(newItemName) : Boolean(itemId));

  const dams = candidates.filter((c) => c.sex !== "male");
  const sires = candidates.filter((c) => c.sex !== "female");

  function submit(formData: FormData) {
    if (!canSubmit) return;
    const sex = String(formData.get("sex") ?? NONE);
    startTransition(async () => {
      const result = await recordBirthAction({
        damLotId: dam === NONE ? null : dam,
        sireLotId: sire === NONE ? null : sire,
        code: String(formData.get("code") ?? ""),
        head: Number(String(formData.get("head") ?? "1")),
        bornOn: String(formData.get("bornOn") ?? today),
        itemId: itemId === CUSTOM ? undefined : itemId,
        newItemName: newItemName || undefined,
        sex: sex === NONE ? null : sex,
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Birth recorded");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {trigger ?? "Record a birth"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Record a birth</DialogTitle>
            <DialogDescription>
              Starts a new lot with both parents on it and places the head. One
              calf is a lot of one; ten piglets are a lot of ten.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <ParentSelect
                id="birth-dam"
                label="Dam"
                value={dam}
                onChange={setDam}
                candidates={dams}
                hint="The mother."
              />
              <ParentSelect
                id="birth-sire"
                label="Sire"
                value={sire}
                onChange={setSire}
                candidates={sires}
                hint="The father, if it is known."
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="birth-code">Lot code</Label>
              <Input
                id="birth-code"
                name="code"
                required
                maxLength={120}
                placeholder="e.g. COW-14, Farrowing 2"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="birth-head">How many</Label>
                <Input
                  id="birth-head"
                  name="head"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue="1"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="birth-when">Born</Label>
                <Input
                  id="birth-when"
                  name="bornOn"
                  type="date"
                  defaultValue={today}
                  max={today}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="birth-sex">Sex</Label>
                <Select name="sex" defaultValue={NONE}>
                  <SelectTrigger id="birth-sex">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not recorded</SelectItem>
                    {SEXES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {SEX_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="birth-item">Counted as</Label>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger id="birth-item">
                  <SelectValue placeholder="Pick a stock line" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM}>A new stock line…</SelectItem>
                </SelectContent>
              </Select>
              {itemId === CUSTOM ? (
                <Input
                  value={customItem}
                  maxLength={200}
                  placeholder="e.g. Beef cattle"
                  onChange={(e) => setCustomItem(e.target.value)}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Set to the dam&rsquo;s line. Change it if the offspring are
                  raised for something else.
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="birth-notes">Notes</Label>
              <Textarea id="birth-notes" name="notes" rows={2} maxLength={5000} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending || !canSubmit}>
              {pending ? "Saving…" : "Record birth"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
