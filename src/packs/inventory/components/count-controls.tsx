"use client";

import { useMemo, useState, useTransition } from "react";
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
  postCountAction,
  recordCountLineAction,
  removeCountLineAction,
  startCountAction,
} from "../actions";

const NO_LOCATION = "__none__";
const NO_LOT = "__none__";

export interface CountItemOption {
  id: string;
  name: string;
  unit: string;
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
}: {
  locations: CountPlaceOption[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

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
        <Button>Count stock</Button>
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
              <Select name="locationAssetId" defaultValue={NO_LOCATION}>
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
 * Record one shelf.
 *
 * **THE FORM DOES NOT SHOW WHAT THE LEDGER EXPECTS, and that is deliberate.**
 * A count is worth nothing if the number on the screen anchors the person
 * holding the clipboard — they will see 92, find 88, and write 92. The
 * comparison belongs after the count, not during it.
 */
export function AddCountLineForm({
  countId,
  items,
  lots,
}: {
  countId: string;
  items: CountItemOption[];
  lots: CountLotOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [itemId, setItemId] = useState<string>(items[0]?.id ?? "");
  const [lotId, setLotId] = useState<string>(NO_LOT);

  const item = items.find((i) => i.id === itemId);
  const itemLots = useMemo(
    () => lots.filter((l) => l.itemId === itemId),
    [lots, itemId],
  );

  function submit(formData: FormData) {
    if (!itemId) {
      toast.error("Pick what you counted.");
      return;
    }
    startTransition(async () => {
      const result = await recordCountLineAction({
        countId,
        itemId,
        lotId: lotId === NO_LOT ? null : lotId,
        countedQuantity: Number(formData.get("countedQuantity")),
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Counted");
      setOpen(false);
      setLotId(NO_LOT);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Count something
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
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
              <Label htmlFor="count-item">What</Label>
              <Select
                value={itemId}
                onValueChange={(value) => {
                  setItemId(value);
                  setLotId(NO_LOT);
                }}
              >
                <SelectTrigger id="count-item">
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

            {itemLots.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="count-lot">Batch</Label>
                <Select value={lotId} onValueChange={setLotId}>
                  <SelectTrigger id="count-lot">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_LOT}>
                      All of it, no batch
                    </SelectItem>
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
                How much is there{item ? ` (${item.unit})` : ""}
              </Label>
              <Input
                id="countedQuantity"
                name="countedQuantity"
                type="number"
                min="0"
                step="0.0001"
                required
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                {/* Zero is a count; a shelf nobody got to is simply not a line.
                    That difference is why the column is NOT NULL. */}
                Zero is a real answer — a shelf you walked and found empty.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="line-notes">Notes</Label>
              <Textarea id="line-notes" name="notes" rows={2} maxLength={2000} />
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

export function RemoveCountLineButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove() {
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
    <Button
      variant="ghost"
      size="sm"
      onClick={remove}
      disabled={pending}
      className="text-muted-foreground"
    >
      Remove
    </Button>
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
}: {
  countId: string;
  lineCount: number;
  today: string;
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
                defaultValue={today}
                required
              />
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
