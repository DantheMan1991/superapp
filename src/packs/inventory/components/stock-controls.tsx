"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatMoney } from "@/lib/money";
import {
  EnterprisePicker,
  NO_ENTERPRISE,
  type EnterpriseOption,
} from "@/components/app/enterprise-picker";
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
  adjustLotCostAction,
  adjustStockAction,
  createLotAction,
  issueStockAction,
  receiveStockAction,
  splitLotAction,
} from "../actions";
import {
  ADJUSTMENT_REASON_LABELS,
  ADJUSTMENT_REASON_NOTES,
  COST_ADJUSTMENT_REASONS,
  COST_ADJUSTMENT_REASON_LABELS,
  COST_ADJUSTMENT_REASON_NOTES,
  LOT_SOURCES,
  LOT_SOURCE_LABELS,
  SUGGESTED_ADJUSTMENT_REASONS,
} from "../vocabulary";
/**
 * PURE, and that is what makes it importable here. `core/costing.ts` has no
 * imports and no `server-only` directive, so the preview in `LotCostForm` runs
 * the very function the server will run rather than a second copy of the
 * arithmetic that could drift from it.
 */
import { splitCostAdjustment } from "../core/costing";

const NO_LOT = "__none__";
const CUSTOM_REASON = "__custom__";
const NO_CONSUMER = "__nobody__";
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
  enterprises,
  enterpriseWord,
  itemEnterpriseId,
}: {
  itemId: string;
  today: string;
  /** Active ones only. The picker renders nothing when the list is empty. */
  enterprises: EnterpriseOption[];
  enterpriseWord: string;
  /**
   * What the ITEM is tagged with, which is what this batch would inherit.
   * See the picker below for why it is the default rather than a hidden one.
   */
  itemEnterpriseId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  /**
   * **SHOWN AS THE ITEM'S, SENT ONLY WHEN SOMEBODY CHANGES IT.**
   *
   * `createLot` treats an ABSENT `enterpriseId` as "not said" and inherits the
   * item's; a picker that defaulted to None would send an explicit null on
   * every batch and turn that inheritance off — so a farm that tagged "Broiler
   * chicks" once would be back to saying so on every hatch, which is the exact
   * thing slice 2 built the inheritance to prevent. So the field shows what
   * will happen rather than leaving it invisible.
   *
   * **BUT PREFILLING AND ALWAYS SENDING IS NOT THE SAME AS INHERITING, and the
   * difference is a stale-state bug.** This form and the item's own Edit dialog
   * are siblings on one page with no `key` between them, and `router.refresh()`
   * is documented to merge the new server payload *without losing client
   * state* — so retagging the item Broilers → Pigs updates this component's
   * PROP and not its `useState`. Sending the value unconditionally then writes
   * the OLD tag onto the new batch, permanently, because there is no
   * `updateLot` to correct a batch with.
   *
   * Two guards, and both are needed. `touched` means an untouched form sends
   * `undefined` and lets the SERVER read the item at insert time, so no client
   * staleness can reach the database. Re-seeding on open means the value a
   * person LOOKS at is current too, rather than merely harmless.
   */
  const [enterprise, setEnterprise] = useState<string>(
    itemEnterpriseId ?? NO_ENTERPRISE,
  );
  const [touched, setTouched] = useState(false);

  function onOpenChange(next: boolean) {
    if (next) {
      setEnterprise(itemEnterpriseId ?? NO_ENTERPRISE);
      setTouched(false);
    }
    setOpen(next);
  }

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await createLotAction({
        itemId,
        code: String(formData.get("code") ?? ""),
        source: String(formData.get("source") ?? "purchased"),
        openedOn: String(formData.get("openedOn") ?? today),
        expiresOn: String(formData.get("expiresOn") ?? "") || null,
        // UNDEFINED WHEN UNTOUCHED — the server re-reads the item, so a stale
        // prefill can never be written. See the state above.
        enterpriseId: !touched
          ? undefined
          : enterprise === NO_ENTERPRISE
            ? null
            : enterprise,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              <Label htmlFor="expiresOn">Good until</Label>
              <Input id="expiresOn" name="expiresOn" type="date" />
              <p className="text-xs text-muted-foreground">
                {/* Blank covers two different things and the pack does not try
                    to tell them apart: nobody has dated it, and it does not go
                    off. Baling twine is honestly blank. */}
                Optional. When it is set, this batch shows up under what is going
                off soon and gets used first.
              </p>
            </div>
            {/*
              **THE FIELD THE COSTING ACTUALLY READS.** Every other surface tags
              the ITEM, and the posting path deliberately will not fall back
              from a batch to its item — so until this existed, the column the
              enterprise dimension leans on hardest could only ever be set by
              inheritance, and a batch that belonged somewhere else could not
              be told so at all.
            */}
            <EnterprisePicker
              id="lot-enterprise"
              word={enterpriseWord}
              options={enterprises}
              value={enterprise}
              onValue={(v) => {
                setEnterprise(v);
                setTouched(true);
              }}
              hint={`What this batch costs is charged here. It starts from the item's, and what you feed to it follows the batch rather than the feed.`}
            />
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
  consumers,
  unitSingular,
  stockedByMass,
  currencySymbol,
  today,
}: {
  itemId: string;
  unitLabel: string;
  /** "pound", not "pounds" — a price is per one of them. */
  unitSingular: string;
  /**
   * True when the stocking unit measures mass. The weight box is then hidden,
   * because the quantity already IS the weight and asking twice invites two
   * numbers that disagree.
   */
  stockedByMass?: boolean;
  /** The tenant's symbol, or null for the house style of none. */
  currencySymbol: string | null;
  lots: LotOption[];
  locations: LocationOption[];
  /**
   * Lots that can EAT this — pens, mostly, and deliberately across every item.
   * Feed is not the same item as the birds that eat it, and that difference is
   * the whole reason the loop closes.
   */
  consumers: { id: string; label: string }[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  /**
   * **A THIRD DOOR ON THE SAME FORM, NOT A SECOND FORM.** Slice 1 made the point
   * already: adding a separate "Adjust" button would leave three ways to move
   * stock and a person guessing which one this is. In carries a price, Out
   * carries who ate it, and Adjust carries a REASON — the one thing an
   * adjustment is for.
   */
  const [direction, setDirection] = useState<"in" | "out" | "adjust">("in");
  const [reason, setReason] = useState<string>(SUGGESTED_ADJUSTMENT_REASONS[0]);
  // Which way an adjustment goes. Both are ordinary: a rat and a miscount are
  // the same act against the same column in opposite directions.
  const [adjustUp, setAdjustUp] = useState(false);
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
      /**
       * **THE SAME DOOR, NOT A SECOND ONE.** Slice 1 could have added "Receive"
       * and "Use" buttons beside this and left three ways to move stock. It
       * routes through the form people already know instead: In carries a
       * price, Out carries who ate it.
       */
      const money = String(formData.get("cost") ?? "").trim();
      const weighed = String(formData.get("weightLb") ?? "").trim();
      const consumedBy = String(formData.get("issuedToLotId") ?? NO_CONSUMER);
      const chosenReason =
        reason === CUSTOM_REASON
          ? String(formData.get("customReason") ?? "")
              .trim()
              .toLowerCase()
              .replace(/\s+/g, "_")
          : reason;

      const result =
        direction === "adjust"
          ? await adjustStockAction({
              itemId,
              lotId: lotId === NO_LOT ? null : lotId,
              // SIGNED here and only here. The form asks for a positive number
              // and a direction, because "how much" and "which way" are two
              // questions and a minus sign typed into a box is not an answer to
              // either.
              quantity: adjustUp ? Math.abs(raw) : -Math.abs(raw),
              reason: chosenReason,
              occurredOn: String(formData.get("occurredOn") ?? today),
              locationAssetId: locationId === NO_LOCATION ? null : locationId,
              notes: String(formData.get("notes") ?? ""),
            })
          : direction === "in"
          ? await receiveStockAction({
              itemId,
              lotId: lotId === NO_LOT ? undefined : lotId,
              quantity: Math.abs(raw),
              // Dollars in, cents stored. Rounding here rather than in the
              // action keeps the boundary integer-only.
              costCents: money ? Math.round(Number(money) * 100) : null,
              // Blank stays blank. "Nobody weighed it" and "it weighed
              // nothing" are different facts and the ledger keeps them apart.
              weightLb: weighed ? Number(weighed) : null,
              occurredOn: String(formData.get("occurredOn") ?? today),
              locationAssetId: locationId === NO_LOCATION ? null : locationId,
              notes: String(formData.get("notes") ?? ""),
            })
          : await issueStockAction({
              itemId,
              lotId: lotId === NO_LOT ? null : lotId,
              quantity: Math.abs(raw),
              issuedToLotId: consumedBy === NO_CONSUMER ? null : consumedBy,
              occurredOn: String(formData.get("occurredOn") ?? today),
              locationAssetId: locationId === NO_LOCATION ? null : locationId,
              notes: String(formData.get("notes") ?? ""),
            });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      // The stamped cost is worth saying out loud: it is what the pen was
      // charged, and it will not change when the next delivery arrives.
      // The stamped cost is worth saying out loud on the way out AND on a
      // downward adjustment: spoilage that cost $42 is a number somebody acts
      // on, and "Adjusted" on its own is not.
      const charged =
        direction !== "in" && "costCents" in result && result.costCents
          ? ` · ${formatMoney(result.costCents, currencySymbol)}`
          : "";
      const headline =
        direction === "in"
          ? "Stock recorded in"
          : direction === "out"
            ? "Stock recorded out"
            : adjustUp
              ? "Adjusted up"
              : "Adjusted down";
      toast.success(headline + charged);
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
              <Button
                type="button"
                variant={direction === "adjust" ? "default" : "outline"}
                onClick={() => setDirection("adjust")}
                className="flex-1"
              >
                Adjust
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

            {direction === "adjust" && (
              <>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={!adjustUp ? "default" : "outline"}
                    onClick={() => setAdjustUp(false)}
                    className="flex-1"
                  >
                    Less than the record says
                  </Button>
                  <Button
                    type="button"
                    variant={adjustUp ? "default" : "outline"}
                    onClick={() => setAdjustUp(true)}
                    className="flex-1"
                  >
                    More
                  </Button>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="reason">Why</Label>
                  <Select value={reason} onValueChange={setReason}>
                    <SelectTrigger id="reason">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SUGGESTED_ADJUSTMENT_REASONS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ADJUSTMENT_REASON_LABELS[r]}
                        </SelectItem>
                      ))}
                      <SelectItem value={CUSTOM_REASON}>
                        Something else…
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {reason === CUSTOM_REASON ? (
                    <Input
                      name="customReason"
                      maxLength={63}
                      required
                      placeholder="e.g. dropped in the mud"
                    />
                  ) : (
                    /* THE REASON IS A DIAGNOSTIC, and the note is what says so
                       at the moment somebody picks one. Sustained shrinkage is
                       not an accounting problem, it is a rodent problem — and
                       nobody learns that from a screen that just took the
                       number. */
                    <p className="text-xs text-muted-foreground">
                      {ADJUSTMENT_REASON_NOTES[reason]}
                    </p>
                  )}
                </div>
                {!adjustUp && (
                  <p className="text-xs text-muted-foreground">
                    What it cost comes off with it, at the average paid. Stock
                    that turns up carries nothing, because nobody paid for it.
                  </p>
                )}
              </>
            )}

            {direction === "in" ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="cost">What it cost</Label>
                  <Input
                    id="cost"
                    name="cost"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="340.00"
                  />
                  <p className="text-xs text-muted-foreground">
                    {/* The total on the ticket, not a rate. The per-unit figure
                        is derived from it and never stored. */}
                    The whole delivery, not the price per {unitSingular}. Leave
                    it empty if the invoice has not arrived — the stock still
                    counts.
                  </p>
                </div>
                {/**
                 * **ONLY FOR SOMETHING COUNTED, and only on the way in.**
                 *
                 * An item stocked by mass has its weight in the quantity box
                 * already — asking for it twice invites two numbers that
                 * disagree. And a weight belongs to stock ARRIVING: what leaves
                 * is weighed by whoever weighs it, on their own record, which
                 * is why there is no box on the issue side and a CHECK
                 * constraint behind that.
                 */}
                {!stockedByMass && (
                  <div className="grid gap-2">
                    <Label htmlFor="weightLb">What it weighed (lb)</Label>
                    <Input
                      id="weightLb"
                      name="weightLb"
                      type="number"
                      min="0"
                      step="0.0001"
                      placeholder="47.5"
                    />
                    <p className="text-xs text-muted-foreground">
                      The whole delivery again, not one {unitSingular}. This is
                      what lets the app say roughly what a freezer holds in
                      pounds. Leave it empty if nobody weighed it — an unweighed
                      batch says nothing rather than nothing-at-all-pounds.
                    </p>
                  </div>
                )}
              </>
            ) : direction === "out" ? (
              consumers.length > 0 && (
                <div className="grid gap-2">
                  <Label htmlFor="issuedToLotId">Fed to</Label>
                  <Select name="issuedToLotId" defaultValue={NO_CONSUMER}>
                    <SelectTrigger id="issuedToLotId">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CONSUMER}>Nothing — waste or sold</SelectItem>
                      {consumers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    This is what makes &ldquo;what did this pen cost&rdquo; a
                    question with an answer. The cost is worked out now, at
                    today&rsquo;s average, and does not move when the next
                    delivery arrives.
                  </p>
                </div>
              )
            ) : null}

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

/**
 * What a batch is carrying, and what the split will be measured against.
 * Everything the correction dialog needs is computed on the server and handed
 * over, so the client does no arithmetic it cannot show its working for.
 */
export interface CostCorrectionLot {
  id: string;
  code: string;
  /** Null when nobody has recorded a cost for this batch at all. */
  carriedLabel: string | null;
  quantityOnHand: number;
  quantityReceived: number;
  onHandLabel: string;
  receivedLabel: string;
}

/**
 * **CORRECT WHAT A BATCH COST.** ADR 0012 §A.4.
 *
 * Separate from the adjustment form, and deliberately not a fourth tab on it.
 * That form changes HOW MUCH IS THERE; this one changes WHAT IT COST and moves
 * no stock at all. Putting them together would invite somebody to record a
 * spoiled bag as a cost correction, which leaves the bag on the shelf and
 * quietly re-prices the batch.
 *
 * **THE SPLIT IS SHOWN BEFORE IT HAPPENS, and that is the point of the panel.**
 * A person entering "the $60 the ticket missed" does not expect part of it to
 * land on the profit and loss, and finding that out afterwards from a journal
 * entry is the wrong order. Same discipline as the posting switch, which says
 * what it does — including the thing people assume and should not — first.
 */
export function LotCostForm({
  lot,
  currencySymbol,
  today,
}: {
  lot: CostCorrectionLot;
  currencySymbol: string | null;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState<string>(COST_ADJUSTMENT_REASONS[0]);
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"up" | "down">("up");

  /**
   * **THE SAME FUNCTION THE SERVER WILL CALL**, so the preview cannot say one
   * thing and the stored record another. `splitCostAdjustment` is pure and
   * imports nothing, which is exactly why a client component can have it.
   */
  const typed = Math.round(Number(amount || "0") * 100);
  const signed = direction === "down" ? -Math.abs(typed) : Math.abs(typed);
  const preview =
    Number.isFinite(typed) && typed > 0
      ? splitCostAdjustment({
          amountCents: signed,
          quantityOnHand: lot.quantityOnHand,
          quantityReceived: lot.quantityReceived,
        })
      : null;

  function submit(formData: FormData) {
    const chosenReason =
      reason === CUSTOM_REASON
        ? String(formData.get("customReason") ?? "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "_")
        : reason;
    startTransition(async () => {
      const result = await adjustLotCostAction({
        lotId: lot.id,
        amountCents: signed,
        reason: chosenReason,
        occurredOn: String(formData.get("occurredOn") ?? today),
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      /**
       * **THE VERB FOLLOWS THE SIGN, and it did not until somebody clicked
       * "It cost less".** A correction downwards took $8 OFF cost of goods
       * sold, and the toast said it "went to" cost of goods sold — the opposite
       * of the entry it had just posted, in the one sentence a person reads
       * before deciding whether to believe the number. Keyed off the STORED
       * `issuedCents` rather than off the form's direction, because that is
       * what was actually written.
       */
      toast.success(
        result.issuedCents === 0
          ? "Cost corrected."
          : "Cost corrected — " +
              formatMoney(Math.abs(result.issuedCents), currencySymbol) +
              (result.issuedCents > 0 ? " of it went to" : " of it came off") +
              " cost of goods sold, because that much had already been used.",
      );
      setOpen(false);
      setAmount("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Correct cost
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Correct what {lot.code} cost</DialogTitle>
            <DialogDescription>
              {lot.carriedLabel === null
                ? "Nobody has recorded a cost for this batch yet, and this is how you supply one. It does not change how much of it there is."
                : `This batch is carrying ${lot.carriedLabel}. This changes what it cost, never how much of it there is.`}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="cost-direction">Which way</Label>
                <Select
                  value={direction}
                  onValueChange={(v) => setDirection(v as "up" | "down")}
                >
                  <SelectTrigger id="cost-direction">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="up">It cost more</SelectItem>
                    <SelectItem value="down">It cost less</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cost-amount">
                  By how much{currencySymbol ? ` (${currencySymbol})` : ""}
                </Label>
                {/* A POSITIVE NUMBER AND A DIRECTION, never a minus sign typed
                    into a box — the same two questions the adjustment form
                    splits, for the same reason. */}
                <Input
                  id="cost-amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  autoFocus
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="cost-reason">Why</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="cost-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COST_ADJUSTMENT_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {COST_ADJUSTMENT_REASON_LABELS[r]}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_REASON}>Something else…</SelectItem>
                </SelectContent>
              </Select>
              {reason === CUSTOM_REASON ? (
                <Input
                  name="customReason"
                  maxLength={63}
                  required
                  placeholder="e.g. billed in tons not pounds"
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {COST_ADJUSTMENT_REASON_NOTES[reason]}
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="cost-when">When</Label>
              <Input
                id="cost-when"
                name="occurredOn"
                type="date"
                defaultValue={today}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="cost-notes">Notes</Label>
              <Textarea id="cost-notes" name="notes" rows={2} />
            </div>

            {preview && (
              <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Where this lands</p>
                <p className="mt-1">
                  {formatMoney(Math.abs(preview.onHandCents), currencySymbol)}{" "}
                  {direction === "down"
                    ? "comes off what the batch is carried at"
                    : "goes onto what the batch is carried at"}
                  , because {lot.onHandLabel} of the {lot.receivedLabel} that
                  came in is still on hand.
                </p>
                {preview.issuedCents !== 0 && (
                  /* THE HALF PEOPLE DO NOT EXPECT. Stock that has already been
                     used cannot take cost back onto the balance sheet, so its
                     share goes to the profit and loss — and saying so here is
                     cheaper than explaining a journal entry afterwards.

                     The verb follows the direction. Found by clicking "It cost
                     less": this read "goes to cost of goods sold" about $8 that
                     was about to come OFF it. */
                  <p className="mt-1">
                    The other{" "}
                    {formatMoney(Math.abs(preview.issuedCents), currencySymbol)}{" "}
                    {direction === "down"
                      ? "comes off cost of goods sold"
                      : "goes to cost of goods sold"}
                    , because that much of the batch has already been used and
                    is no longer on the balance sheet to change.
                  </p>
                )}
                <p className="mt-1">
                  Nothing about how much is there changes, and the entries
                  already recorded are left exactly as they are.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Correcting…" : "Correct cost"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
