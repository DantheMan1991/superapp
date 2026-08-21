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
  createChannelAction,
  recordMarketDayAction,
  removeMarketDayAction,
  removePriceAction,
  setPriceAction,
  updateChannelAction,
  voidSaleAction,
} from "../actions";
import { slugLabel } from "../vocabulary";

const CUSTOM = "__custom__";

export interface ChannelOption {
  id: string;
  name: string;
}

/** Dollars in the box, integer cents over the wire. The boundary stays integer. */
function toCents(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function numberOrNull(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Add somewhere the business sells. Owner-only: it is a decision, not a chore. */
export function ChannelForm({
  channelWord,
  kindOptions,
}: {
  channelWord: string;
  kindOptions: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<string>(kindOptions[0] ?? CUSTOM);

  function submit(formData: FormData) {
    const chosen =
      kind === CUSTOM ? String(formData.get("customKind") ?? "") : kind;
    startTransition(async () => {
      const result = await createChannelAction({
        name: String(formData.get("name") ?? ""),
        channelKind:
          chosen.trim().toLowerCase().replace(/\s+/g, "_") || undefined,
        location: String(formData.get("location") ?? ""),
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${channelWord} added`);
      setOpen(false);
      if (result.channelId) {
        router.push(`/dashboard/m/retail/${result.channelId}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add a {channelWord.toLowerCase()}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Add a {channelWord.toLowerCase()}</DialogTitle>
            <DialogDescription>
              Somewhere the business sells. Prices live per {channelWord.toLowerCase()}, because
              the same pound is one price at a stall and another at the gate —
              and neither of them is the price.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                required
                maxLength={200}
                autoFocus
                placeholder="e.g. Saturday market, Farm store"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="kind">Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kindOptions.map((k) => (
                    <SelectItem key={k} value={k}>
                      {slugLabel(k)}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM}>Something else…</SelectItem>
                </SelectContent>
              </Select>
              {kind === CUSTOM && (
                <Input
                  name="customKind"
                  maxLength={63}
                  required
                  placeholder="e.g. box scheme"
                />
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="location">Where</Label>
              <Input
                id="location"
                name="location"
                maxLength={300}
                placeholder="e.g. Elm Street car park"
              />
              <p className="text-xs text-muted-foreground">
                {/* Free text on purpose: the farm does not own the square its
                    stall stands on, and pointing at Assets would claim it did. */}
                As you would say it. This is not a place the business owns.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="channel-notes">Notes</Label>
              <Textarea id="channel-notes" name="notes" rows={2} maxLength={5000} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Close a channel, or reopen it. Its prices and its history stay. */
export function ChannelStatusButton({
  id,
  status,
  channelWord,
}: {
  id: string;
  status: string;
  channelWord: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const closing = status === "active";

  function toggle() {
    startTransition(async () => {
      const result = await updateChannelAction({
        id,
        status: closing ? "closed" : "active",
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        closing
          ? `${channelWord} closed — its prices and history stay`
          : `${channelWord} open again`,
      );
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={toggle} disabled={pending}>
      {closing ? "Close" : "Reopen"}
    </Button>
  );
}

/**
 * Set what an item costs here, from a day.
 *
 * **THE DATE IS NOT AN ADVANCED OPTION.** A price change is a new row starting
 * on a day, which is what lets the same table answer *what do I charge* and
 * *what did I charge in June*. Hiding the date behind a disclosure would make
 * the common case — putting next season's price in now — invisible.
 */
export function SetPriceForm({
  channelId,
  itemId,
  itemName,
  unitSingular,
  currencySymbol,
  currentCents,
  today,
}: {
  channelId: string;
  itemId: string;
  itemName: string;
  /** "pound", not "pounds" — a price is per one of them. */
  unitSingular: string;
  currencySymbol: string | null;
  currentCents: number | null;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    const priceCents = toCents(formData.get("price"));
    if (priceCents === null) {
      toast.error("Enter a price. Zero is allowed; blank is not a price.");
      return;
    }
    startTransition(async () => {
      const result = await setPriceAction({
        channelId,
        itemId,
        priceCents,
        effectiveFrom: String(formData.get("effectiveFrom") ?? today),
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Price set");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          {currentCents === null ? "Set a price" : "Change"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>{itemName}</DialogTitle>
            <DialogDescription>
              Per {unitSingular}, here. A change is a new price from a day —
              nothing overwrites what you charged before, because that is what a
              margin report has to read.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="price">
                  Price {currencySymbol ? `(${currencySymbol})` : ""}
                </Label>
                <Input
                  id="price"
                  name="price"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  autoFocus
                  placeholder="8.00"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="effectiveFrom">From</Label>
                <Input
                  id="effectiveFrom"
                  name="effectiveFrom"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              A date in the future sets the price ahead without changing what you
              are charging today.
            </p>
            <div className="grid gap-2">
              <Label htmlFor="price-notes">Notes</Label>
              <Textarea id="price-notes" name="notes" rows={2} maxLength={2000} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Set"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemovePriceButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await removePriceAction({ id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Removed — whatever ran before applies again");
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

/** Record a day of selling and what it cost. `member` — a chore. */
export function MarketDayForm({
  channels,
  dayWord,
  currencySymbol,
  today,
  defaultChannelId,
}: {
  channels: ChannelOption[];
  dayWord: string;
  currencySymbol: string | null;
  today: string;
  defaultChannelId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [channelId, setChannelId] = useState<string>(
    defaultChannelId ?? channels[0]?.id ?? "",
  );

  function submit(formData: FormData) {
    if (!channelId) {
      toast.error("Add somewhere to sell first.");
      return;
    }
    startTransition(async () => {
      const result = await recordMarketDayAction({
        channelId,
        heldOn: String(formData.get("heldOn") ?? today),
        stallFeeCents: toCents(formData.get("stallFee")),
        travelCents: toCents(formData.get("travel")),
        crewSize: numberOrNull(formData.get("crewSize")),
        hours: numberOrNull(formData.get("hours")),
        weather: String(formData.get("weather") ?? ""),
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${dayWord} recorded`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={channels.length === 0}>
          Record a {dayWord.toLowerCase()}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Record a {dayWord.toLowerCase()}</DialogTitle>
            <DialogDescription>
              What it cost to stand there. Two seasons of this is what settles
              which market is worth going to and which one is habit.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="day-channel">Where</Label>
                <Select value={channelId} onValueChange={setChannelId}>
                  <SelectTrigger id="day-channel">
                    <SelectValue placeholder="Pick one" />
                  </SelectTrigger>
                  <SelectContent>
                    {channels.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="heldOn">When</Label>
                <Input
                  id="heldOn"
                  name="heldOn"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="stallFee">
                  Stall fee {currencySymbol ? `(${currencySymbol})` : ""}
                </Label>
                <Input
                  id="stallFee"
                  name="stallFee"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="35.00"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="travel">
                  Getting there {currencySymbol ? `(${currencySymbol})` : ""}
                </Label>
                <Input
                  id="travel"
                  name="travel"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="18.00"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="crewSize">Crew</Label>
                <Input
                  id="crewSize"
                  name="crewSize"
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="hours">Hours stood there</Label>
                <Input
                  id="hours"
                  name="hours"
                  type="number"
                  min="0"
                  step="0.25"
                  inputMode="decimal"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {/* The whole argument for the table: own hours at zero make every
                  market look profitable and the dud invisible. */}
              Hours are recorded beside the money, never inside it. If your own
              time counts as nothing, every market looks worth going to.
            </p>

            <div className="grid gap-2">
              <Label htmlFor="weather">Weather</Label>
              <Input
                id="weather"
                name="weather"
                maxLength={300}
                placeholder="e.g. rained until eleven"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="day-notes">Notes</Label>
              <Textarea id="day-notes" name="notes" rows={2} maxLength={5000} />
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

export function RemoveMarketDayButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await removeMarketDayAction({ id });
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
 * Void a sale.
 *
 * **THE STOCK ISSUE IS DELIBERATELY LEFT BEHIND**, and the dialog copy says so
 * rather than letting somebody find it later as stock they cannot account for.
 * The goods went over the table; a movement records what happened, and unwriting
 * it would rewrite that. `inventory` slice 2's adjustment is the remedy — which
 * means that for the first time in this repo the loose end has a screen.
 */
export function VoidSaleButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function voidIt() {
    startTransition(async () => {
      const result = await voidSaleAction({ id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Voided — the stock that went out is still off the truck");
      router.refresh();
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={voidIt}
      disabled={pending}
      className="text-muted-foreground"
    >
      Void
    </Button>
  );
}
