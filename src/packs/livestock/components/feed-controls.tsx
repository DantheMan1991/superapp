"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatMoney } from "@/lib/money";
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
  addLotToFeedGroupAction,
  closeFeedGroupAction,
  createFeedGroupAction,
  endFeedGroupMembershipAction,
  recordDirectFeedAction,
  recordFeedDrawAction,
} from "../actions";

const NO_LOT = "__none__";
const NO_LOCATION = "__none__";

export interface FeederOption {
  id: string;
  name: string;
}

export interface FeedItemOption {
  id: string;
  name: string;
  unit: string;
}

export interface FeedLotOption {
  id: string;
  code: string;
  species: string;
}

/**
 * Start a shared feeder.
 *
 * **THE ONE FORM THAT EXPLAINS THE ALLOCATION**, because nothing else on the
 * screen can: a person who has only ever handed a bag to a pen has no reason to
 * expect a second way for feed to reach animals, and "feeder" alone does not
 * say that the cost will be estimated rather than assigned.
 */
export function FeedGroupForm({ trigger }: { trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await createFeedGroupAction({
        name: String(formData.get("name") ?? ""),
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Feeder added");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button variant="outline">New feeder</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Add a shared feeder</DialogTitle>
            <DialogDescription>
              A bin, a bulk bag, a trough — anything several lots eat from. Feed
              drawn for it is spread across whichever lots were on it, by head
              and days, because nobody knows which animal ate which pound.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="feeder-name">Name</Label>
              <Input
                id="feeder-name"
                name="name"
                required
                maxLength={200}
                autoFocus
                placeholder="e.g. Broiler bin, North trough"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="feeder-notes">Notes</Label>
              <Textarea
                id="feeder-notes"
                name="notes"
                rows={2}
                maxLength={5000}
              />
              <p className="text-xs text-muted-foreground">
                A bag issued to one lot by name stays measured and does not need
                a feeder. This is for the feed nobody can attribute.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Add feeder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Put a lot on a feeder from a date.
 *
 * **THE DATE IS THE FIELD THAT MATTERS**, which is why it is not hidden behind
 * a sensible default alone. Head is never asked for — the ledger already knows
 * how many stood in that pen on every day — so the membership dates are the
 * entire extra fact this form exists to collect.
 */
export function AddLotToFeederForm({
  feedGroupId,
  feederName,
  lots,
  today,
}: {
  feedGroupId: string;
  feederName: string;
  lots: FeedLotOption[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [lotId, setLotId] = useState<string>(lots[0]?.id ?? "");

  function submit(formData: FormData) {
    if (!lotId) {
      toast.error("Pick a lot.");
      return;
    }
    startTransition(async () => {
      const result = await addLotToFeedGroupAction({
        feedGroupId,
        livestockLotId: lotId,
        startedOn: String(formData.get("startedOn") ?? today),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("On the feeder");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={lots.length === 0}>
          Add a lot
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Onto {feederName}</DialogTitle>
            <DialogDescription>
              From this day on, this lot takes a share of what is drawn for the
              feeder. Its head count comes from the ledger, so you are only
              recording when they went on.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor={`feeder-lot-${feedGroupId}`}>Lot</Label>
              <Select value={lotId} onValueChange={setLotId}>
                <SelectTrigger id={`feeder-lot-${feedGroupId}`}>
                  <SelectValue placeholder="Pick a lot" />
                </SelectTrigger>
                <SelectContent>
                  {lots.map((lot) => (
                    <SelectItem key={lot.id} value={lot.id}>
                      {lot.code} · {lot.species}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`feeder-from-${feedGroupId}`}>Went on</Label>
              <Input
                id={`feeder-from-${feedGroupId}`}
                name="startedOn"
                type="date"
                defaultValue={today}
                required
              />
              <p className="text-xs text-muted-foreground">
                Backdate it if they have been on it a while — the share is
                worked out day by day, so the date changes the answer.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Take a lot off a feeder, on an inclusive last day. */
export function EndMembershipForm({
  memberId,
  lotCode,
  startedOn,
  today,
}: {
  memberId: string;
  lotCode: string;
  startedOn: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await endFeedGroupMembershipAction({
        memberId,
        endedOn: String(formData.get("endedOn") ?? today),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Off the feeder");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Take off
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Take {lotCode} off</DialogTitle>
            <DialogDescription>
              They went on {startedOn}. The last day counts as a day on feed,
              and everything drawn up to it still gets a share.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor={`off-${memberId}`}>Last day on it</Label>
              <Input
                id={`off-${memberId}`}
                name="endedOn"
                type="date"
                defaultValue={today}
                required
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Take off"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Close a feeder. Its history keeps reporting. */
export function CloseFeederButton({
  feedGroupId,
  feederName,
}: {
  feedGroupId: string;
  feederName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await closeFeedGroupAction({ id: feedGroupId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${feederName} closed — its history still reports`);
      router.refresh();
    });
  }

  return (
    <Button variant="ghost" size="sm" onClick={submit} disabled={pending}>
      Close
    </Button>
  );
}

/**
 * Draw feed for a feeder.
 *
 * **THE SAME ACT AS ISSUING A BAG TO A PEN, and it says so.** Stock leaves,
 * the cost is stamped at today's average, and the only difference is that
 * nobody is named — so the toast reports the figure that is about to be spread,
 * because the moment it is recorded is the only time anyone would notice it was
 * wrong.
 */
export function RecordDrawForm({
  feeders,
  animals,
  items,
  lotsByItem,
  locations,
  currencySymbol,
  today,
  defaultFeederId,
  defaultAnimalId,
  trigger,
}: {
  feeders: FeederOption[];
  /**
   * **SLICE 8F: who can be fed BY NAME.** Every animal and lot on the farm.
   *
   * The founder's rule is *in a lot, feed is the lot's; on her own, it is
   * hers*, and this module only had the first half — a cow standing on her own
   * could not be fed from here at all, because the only control required a
   * shared feeder.
   */
  animals: { id: string; code: string }[];
  items: FeedItemOption[];
  /** Batches of each item, so a draw can name the delivery it came out of. */
  lotsByItem: Record<string, { id: string; code: string }[]>;
  locations: { id: string; name: string }[];
  currencySymbol: string | null;
  today: string;
  defaultFeederId?: string;
  /** Opens straight into "by name" with this one picked — the lot page's door. */
  defaultAnimalId?: string;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feederId, setFeederId] = useState(defaultFeederId ?? feeders[0]?.id ?? "");
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [lotId, setLotId] = useState(NO_LOT);
  /**
   * **WHO ATE IT — a feeder, or somebody named.** The one real choice in this
   * dialog, because it decides whether the cost is ALLOCATED by head-days or
   * MEASURED against one record. Opens on whichever the caller has: the feed
   * page defaults to a feeder, an animal's own page defaults to her.
   */
  const [mode, setMode] = useState<"feeder" | "named">(
    defaultAnimalId || feeders.length === 0 ? "named" : "feeder",
  );
  const [animalId, setAnimalId] = useState(
    defaultAnimalId ?? animals[0]?.id ?? "",
  );
  const byName = mode === "named";

  const item = useMemo(
    () => items.find((i) => i.id === itemId) ?? null,
    [items, itemId],
  );
  const lots = lotsByItem[itemId] ?? [];

  function submit(formData: FormData) {
    const quantity = Number(String(formData.get("quantity") ?? "0"));
    if (!quantity || quantity <= 0) {
      toast.error("Enter how much was drawn.");
      return;
    }
    if (!itemId || (byName ? !animalId : !feederId)) {
      toast.error(
        byName
          ? "Pick who ate it and what was drawn."
          : "Pick a feeder and what was drawn.",
      );
      return;
    }
    const locationId = String(formData.get("locationAssetId") ?? NO_LOCATION);
    const shared = {
      itemId,
      lotId: lotId === NO_LOT ? null : lotId,
      quantity,
      occurredOn: String(formData.get("occurredOn") ?? today),
      locationAssetId: locationId === NO_LOCATION ? null : locationId,
      notes: String(formData.get("notes") ?? ""),
    };
    startTransition(async () => {
      // The ONLY difference is who is named, and that is what decides measured
      // against allocated. Same ledger, same stamping, either way.
      const result = byName
        ? await recordDirectFeedAction({ ...shared, livestockLotId: animalId })
        : await recordFeedDrawAction({ ...shared, feedGroupId: feederId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      // Null means the item has no priced receipt behind it — spent grain, or
      // an invoice that has not arrived. Fed, but not spent, and saying "0.00"
      // there would be a claim nobody made.
      const verb = byName ? "Fed" : "Drawn";
      toast.success(
        result.costCents === null || result.costCents === undefined
          ? `${verb} · no price on record`
          : `${verb} · ${formatMoney(result.costCents, currencySymbol)}`,
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm">Record a draw</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>{byName ? "Feed one" : "Draw feed"}</DialogTitle>
            <DialogDescription>
              Stock leaves now and the cost is worked out now, at today&rsquo;s
              average.{" "}
              {byName
                ? "It lands entirely on the one you name — measured, not a share of anything."
                : "It is spread across the lots on this feeder afterwards, by head and days."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* **THE CHOICE FIRST, because it changes what the rest is asking
                for** — the same reason the lot form leads with One animal / A
                lot. Hidden when there are no feeders: a farm with none has only
                one answer and does not need to be asked. */}
            {feeders.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={byName ? "outline" : "default"}
                  onClick={() => setMode("feeder")}
                >
                  A shared feeder
                </Button>
                <Button
                  type="button"
                  variant={byName ? "default" : "outline"}
                  onClick={() => setMode("named")}
                >
                  One by name
                </Button>
              </div>
            )}

            {byName ? (
              <div className="grid gap-2">
                <Label htmlFor="draw-animal">Who ate it</Label>
                <Select value={animalId} onValueChange={setAnimalId}>
                  <SelectTrigger id="draw-animal">
                    <SelectValue placeholder="Pick one" />
                  </SelectTrigger>
                  <SelectContent>
                    {animals.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              feeders.length > 1 && (
                <div className="grid gap-2">
                  <Label htmlFor="draw-feeder">Feeder</Label>
                  <Select value={feederId} onValueChange={setFeederId}>
                    <SelectTrigger id="draw-feeder">
                      <SelectValue placeholder="Pick a feeder" />
                    </SelectTrigger>
                    <SelectContent>
                      {feeders.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )
            )}

            <div className="grid gap-2">
              <Label htmlFor="draw-item">What was drawn</Label>
              <Select
                value={itemId}
                onValueChange={(value) => {
                  setItemId(value);
                  // The batch belongs to the item. Keeping a stale one selected
                  // would submit a batch of a different thing.
                  setLotId(NO_LOT);
                }}
              >
                <SelectTrigger id="draw-item">
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

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="draw-qty">
                  How much{item ? ` (${item.unit})` : ""}
                </Label>
                <Input
                  id="draw-qty"
                  name="quantity"
                  type="number"
                  min="0"
                  step="0.0001"
                  required
                  autoFocus
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="draw-when">When</Label>
                <Input
                  id="draw-when"
                  name="occurredOn"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>
            </div>

            {lots.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="draw-lot">Out of which delivery</Label>
                <Select value={lotId} onValueChange={setLotId}>
                  <SelectTrigger id="draw-lot">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_LOT}>Not recorded</SelectItem>
                    {lots.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {locations.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="draw-where">Where from</Label>
                <Select name="locationAssetId" defaultValue={NO_LOCATION}>
                  <SelectTrigger id="draw-where">
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

            <div className="grid gap-2">
              <Label htmlFor="draw-notes">Notes</Label>
              <Textarea id="draw-notes" name="notes" rows={2} maxLength={5000} />
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
