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
  createLotAction,
  recordMovementAction,
  splitLotAction,
} from "../actions";
import { LOT_SOURCES, LOT_SOURCE_LABELS } from "../vocabulary";

const NO_LOT = "__none__";
const NO_LOCATION = "__none__";

export interface LotOption {
  id: string;
  code: string;
  balanceLabel: string;
}

export interface LocationOption {
  id: string;
  name: string;
}

/** Start a new batch of something. */
export function LotForm({
  itemId,
  today,
}: {
  itemId: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await createLotAction({
        itemId,
        code: String(formData.get("code") ?? ""),
        source: String(formData.get("source") ?? "purchased"),
        openedOn: String(formData.get("openedOn") ?? today),
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Batch started");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          New batch
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Start a batch</DialogTitle>
            <DialogDescription>
              A batch is what traceability follows — one delivery, one hatch,
              one pen. It becomes a cost object, so what it cost is answerable
              later.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="code">Batch code</Label>
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
                <Label htmlFor="source">Where from</Label>
                <Select name="source" defaultValue="purchased">
                  <SelectTrigger id="source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOT_SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {LOT_SOURCE_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="openedOn">Started</Label>
                <Input
                  id="openedOn"
                  name="openedOn"
                  type="date"
                  defaultValue={today}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lot-notes">Notes</Label>
              <Textarea id="lot-notes" name="notes" rows={2} maxLength={5000} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Start batch"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Record stock in or out.
 *
 * IN and OUT are two buttons rather than a signed number, because nobody
 * thinks "negative eighty pounds of feed". The sign is applied here, which is
 * the last place the human meaning is still visible.
 */
export function MovementForm({
  itemId,
  unitLabel,
  lots,
  locations,
  today,
}: {
  itemId: string;
  unitLabel: string;
  lots: LotOption[];
  locations: LocationOption[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    const raw = Number(String(formData.get("quantity") ?? "0"));
    if (!raw) {
      toast.error("Enter a quantity other than zero.");
      return;
    }
    const lotId = String(formData.get("lotId") ?? NO_LOT);
    const locationId = String(formData.get("locationAssetId") ?? NO_LOCATION);

    startTransition(async () => {
      const result = await recordMovementAction({
        itemId,
        lotId: lotId === NO_LOT ? null : lotId,
        locationAssetId: locationId === NO_LOCATION ? null : locationId,
        quantity: direction === "in" ? Math.abs(raw) : -Math.abs(raw),
        movementKind: direction === "in" ? "receipt" : "issue",
        occurredOn: String(formData.get("occurredOn") ?? today),
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(direction === "in" ? "Stock recorded in" : "Stock recorded out");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Record stock</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Record stock</DialogTitle>
            <DialogDescription>
              Every quantity on this page is the sum of these, so nothing is
              counted twice and a correction is just another entry.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={direction === "in" ? "default" : "outline"}
                onClick={() => setDirection("in")}
                className="flex-1"
              >
                In
              </Button>
              <Button
                type="button"
                variant={direction === "out" ? "default" : "outline"}
                onClick={() => setDirection("out")}
                className="flex-1"
              >
                Out
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="quantity">How much ({unitLabel})</Label>
                <Input
                  id="quantity"
                  name="quantity"
                  type="number"
                  min="0"
                  step="0.0001"
                  required
                  autoFocus
                />
              </div>
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
            </div>

            {lots.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="lotId">Batch</Label>
                <Select name="lotId" defaultValue={NO_LOT}>
                  <SelectTrigger id="lotId">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_LOT}>No batch</SelectItem>
                    {lots.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.code} · {l.balanceLabel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="locationAssetId">Where</Label>
              <Select name="locationAssetId" defaultValue={NO_LOCATION}>
                <SelectTrigger id="locationAssetId">
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

            <div className="grid gap-2">
              <Label htmlFor="move-notes">Notes</Label>
              <Textarea id="move-notes" name="notes" rows={2} maxLength={5000} />
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

/**
 * Split a batch. One of only two operations that change cardinality, and the
 * one `livestock` cannot live without — a batch of chicks arrives as one
 * purchase and splits across pens.
 */
export function SplitLotForm({
  lot,
  unitLabel,
  locations,
  today,
}: {
  lot: LotOption;
  unitLabel: string;
  locations: LocationOption[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    const locationId = String(formData.get("locationAssetId") ?? NO_LOCATION);
    startTransition(async () => {
      const result = await splitLotAction({
        lotId: lot.id,
        quantity: Number(String(formData.get("quantity") ?? "0")),
        newCode: String(formData.get("newCode") ?? ""),
        occurredOn: String(formData.get("occurredOn") ?? today),
        locationAssetId: locationId === NO_LOCATION ? null : locationId,
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
        <Button variant="ghost" size="sm">
          Split
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Split {lot.code}</DialogTitle>
            <DialogDescription>
              Moves part of this batch into a new one that remembers where it
              came from. Nothing is created or destroyed — {lot.code} currently
              holds {lot.balanceLabel}.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="split-qty">How much ({unitLabel})</Label>
                <Input
                  id="split-qty"
                  name="quantity"
                  type="number"
                  min="0"
                  step="0.0001"
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
              <Label htmlFor="newCode">New batch code</Label>
              <Input
                id="newCode"
                name="newCode"
                required
                maxLength={120}
                placeholder="e.g. Pen 3"
              />
            </div>
            {locations.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="split-where">Where it goes</Label>
                <Select name="locationAssetId" defaultValue={NO_LOCATION}>
                  <SelectTrigger id="split-where">
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
            )}
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
