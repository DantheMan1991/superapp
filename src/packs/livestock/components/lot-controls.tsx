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
  addIdentifierAction,
  createLivestockLotAction,
  moveLotToZoneAction,
  placeHeadAction,
  removeHeadAction,
  splitLivestockLotAction,
} from "../actions";
import {
  IDENTIFIER_KINDS,
  REMOVAL_REASONS,
  REMOVAL_REASON_LABELS,
  SEXES,
  SEX_LABELS,
  identifierKindLabel,
} from "../vocabulary";

const CUSTOM = "__custom__";
const NONE = "__none__";
const UNSET = "";

/** Start an animal lot. Creates the inventory lot and the biology together. */
export function LivestockLotForm({
  items,
  speciesOptions,
  today,
}: {
  items: { id: string; name: string }[];
  speciesOptions: string[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [species, setSpecies] = useState(UNSET);
  const [customSpecies, setCustomSpecies] = useState("");
  const [itemId, setItemId] = useState(items.length === 1 ? items[0].id : UNSET);

  const chosen = species === CUSTOM ? customSpecies.trim() : species;
  const canSubmit = Boolean(chosen) && Boolean(itemId);

  function submit(formData: FormData) {
    if (!canSubmit) return;
    const sex = String(formData.get("sex") ?? NONE);
    startTransition(async () => {
      const result = await createLivestockLotAction({
        itemId,
        code: String(formData.get("code") ?? ""),
        species: chosen.toLowerCase().replace(/\s+/g, "_"),
        sex: sex === NONE ? null : sex,
        breed: String(formData.get("breed") ?? ""),
        bornOn: String(formData.get("bornOn") ?? ""),
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Lot started");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Start a lot</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Start an animal lot</DialogTitle>
            <DialogDescription>
              A batch of chicks, a group of feeders, or one named cow — an
              individual is just a lot of one.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="code">Lot code</Label>
              <Input
                id="code"
                name="code"
                required
                maxLength={120}
                autoFocus
                placeholder="e.g. B-2026-04-15, Pen 3, #47"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="species">Species</Label>
                <Select value={species} onValueChange={setSpecies}>
                  <SelectTrigger id="species">
                    <SelectValue placeholder="Pick a species" />
                  </SelectTrigger>
                  <SelectContent>
                    {speciesOptions.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM}>Something else…</SelectItem>
                  </SelectContent>
                </Select>
                {species === CUSTOM && (
                  <Input
                    aria-label="New species"
                    placeholder="e.g. sheep"
                    value={customSpecies}
                    onChange={(e) => setCustomSpecies(e.target.value)}
                    maxLength={63}
                  />
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="itemId">Counted as</Label>
                <Select value={itemId} onValueChange={setItemId}>
                  <SelectTrigger id="itemId">
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
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="sex">Sex</Label>
                <Select name="sex" defaultValue={NONE}>
                  <SelectTrigger id="sex">
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
              <div className="grid gap-2">
                <Label htmlFor="bornOn">Born or hatched</Label>
                <Input id="bornOn" name="bornOn" type="date" max={today} />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="breed">Breed</Label>
              <Input
                id="breed"
                name="breed"
                maxLength={200}
                placeholder="e.g. Cornish Cross"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="lot-notes">Notes</Label>
              <Textarea id="lot-notes" name="notes" rows={2} maxLength={5000} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending || !canSubmit}>
              {pending ? "Saving…" : "Start lot"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Place head into a lot: hatched, bought in, born. */
export function PlaceHeadForm({
  itemId,
  inventoryLotId,
  today,
}: {
  itemId: string;
  inventoryLotId: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await placeHeadAction({
        itemId,
        inventoryLotId,
        head: Number(String(formData.get("head") ?? "0")),
        occurredOn: String(formData.get("occurredOn") ?? today),
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Placed");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Place head</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Place head</DialogTitle>
            <DialogDescription>
              Hatched, bought in, or born. The count is the sum of these, so it
              can never disagree with its own history.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="place-head">How many</Label>
                <Input
                  id="place-head"
                  name="head"
                  type="number"
                  min="1"
                  step="1"
                  required
                  autoFocus
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="place-when">When</Label>
                <Input
                  id="place-when"
                  name="occurredOn"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="place-notes">Notes</Label>
              <Textarea id="place-notes" name="notes" rows={2} maxLength={5000} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Place"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Record deaths, culls or live sales.
 *
 * The reason is REQUIRED and closed, because mortality is a diagnostic rather
 * than bookkeeping: timing implies cause, and a death recorded as a cull is a
 * signal thrown away.
 */
export function RemoveHeadForm({
  itemId,
  inventoryLotId,
  today,
}: {
  itemId: string;
  inventoryLotId: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await removeHeadAction({
        itemId,
        inventoryLotId,
        head: Number(String(formData.get("head") ?? "0")),
        reason: String(formData.get("reason") ?? "death"),
        occurredOn: String(formData.get("occurredOn") ?? today),
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Recorded");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Record loss
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Head leaving</DialogTitle>
            <DialogDescription>
              Why it left matters as much as how many — mortality is a
              diagnostic, and the timing usually implies the cause.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="reason">What happened</Label>
              <Select name="reason" defaultValue="death">
                <SelectTrigger id="reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REMOVAL_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {REMOVAL_REASON_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="remove-head">How many</Label>
                <Input
                  id="remove-head"
                  name="head"
                  type="number"
                  min="1"
                  step="1"
                  required
                  autoFocus
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="remove-when">When</Label>
                <Input
                  id="remove-when"
                  name="occurredOn"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="remove-notes">Notes</Label>
              <Textarea id="remove-notes" name="notes" rows={2} maxLength={5000} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Split head into a new lot — a batch across pens. */
export function SplitHerdForm({
  livestockLotId,
  balance,
  today,
}: {
  livestockLotId: string;
  balance: number;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await splitLivestockLotAction({
        livestockLotId,
        head: Number(String(formData.get("head") ?? "0")),
        newCode: String(formData.get("newCode") ?? ""),
        occurredOn: String(formData.get("occurredOn") ?? today),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Split — the total is unchanged");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Split
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Split this lot</DialogTitle>
            <DialogDescription>
              Moves head into a new lot that remembers where it came from and
              carries the same breed and birth date. {balance} head here now.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="split-head">How many</Label>
                <Input
                  id="split-head"
                  name="head"
                  type="number"
                  min="1"
                  step="1"
                  required
                  autoFocus
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="split-when">When</Label>
                <Input
                  id="split-when"
                  name="occurredOn"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="split-code">New lot code</Label>
              <Input
                id="split-code"
                name="newCode"
                required
                maxLength={120}
                placeholder="e.g. Pen 3"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Splitting…" : "Split"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Put the lot on a paddock. Writes into land's occupancy record. */
export function MoveToZoneForm({
  livestockLotId,
  zones,
  structures,
  structureWord,
  today,
}: {
  livestockLotId: string;
  zones: { id: string; name: string; parcelName: string }[];
  structures: { id: string; name: string }[];
  /** The tenant's own word for a pen, from the vocabulary registry. */
  structureWord: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [zoneId, setZoneId] = useState(UNSET);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    if (!zoneId) return;
    const rawArea = String(formData.get("areaAcres") ?? "").trim();
    const structure = String(formData.get("structureAssetId") ?? NONE);
    startTransition(async () => {
      const result = await moveLotToZoneAction({
        livestockLotId,
        zoneId,
        startedOn: String(formData.get("startedOn") ?? today),
        endedOn: String(formData.get("endedOn") ?? "") || null,
        areaAcres: rawArea ? Number(rawArea) : null,
        structureAssetId: structure === NONE ? null : structure,
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Moved");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Move to a paddock
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Move this lot</DialogTitle>
            <DialogDescription>
              This is what starts the paddock&apos;s rest clock when they move
              off again — the same record Land computes rest from.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="zone">Paddock</Label>
              <Select value={zoneId} onValueChange={setZoneId}>
                <SelectTrigger id="zone">
                  <SelectValue placeholder="Pick a paddock" />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((z) => (
                    <SelectItem key={z.id} value={z.id}>
                      {z.parcelName} · {z.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="move-on">On</Label>
                <Input
                  id="move-on"
                  name="startedOn"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="move-off">Off</Label>
                <Input id="move-off" name="endedOn" type="date" />
              </div>
            </div>
            {structures.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="structure">In a {structureWord.toLowerCase()}</Label>
                <Select name="structureAssetId" defaultValue={NONE}>
                  <SelectTrigger id="structure">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Loose is the DEFAULT and a real answer, not a blank.
                        Cattle roam the paddock; broilers live in a pen that
                        sits on it. */}
                    <SelectItem value={NONE}>Loose on the paddock</SelectItem>
                    {structures.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="move-area">Strip size in acres</Label>
              <Input
                id="move-area"
                name="areaAcres"
                type="number"
                min="0"
                step="0.0001"
                placeholder="Blank means the whole paddock"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="move-notes">Notes</Label>
              <Textarea id="move-notes" name="notes" rows={2} maxLength={5000} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !zoneId}>
              {pending ? "Moving…" : "Move"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Add a tag. Many per animal, because tags are lost and replaced. */
export function IdentifierForm({
  livestockLotId,
  today,
}: {
  livestockLotId: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(UNSET);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    if (!kind) return;
    startTransition(async () => {
      const result = await addIdentifierAction({
        livestockLotId,
        identifierKind: kind,
        value: String(formData.get("value") ?? ""),
        appliedOn: String(formData.get("appliedOn") ?? "") || null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Tag added");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Add a tag
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Add a tag</DialogTitle>
            <DialogDescription>
              An animal carries several, and they are not interchangeable — a
              visual tag comes out in a fence, the official one has to persist.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="tag-kind">Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="tag-kind">
                  <SelectValue placeholder="Pick a kind" />
                </SelectTrigger>
                <SelectContent>
                  {IDENTIFIER_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {identifierKindLabel(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tag-value">Value</Label>
              <Input id="tag-value" name="value" required maxLength={200} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tag-applied">Applied</Label>
              <Input
                id="tag-applied"
                name="appliedOn"
                type="date"
                defaultValue={today}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !kind}>
              {pending ? "Saving…" : "Add tag"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
