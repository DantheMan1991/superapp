"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { formatMoney } from "@/lib/money";
import { returnToMarketAction, transferToBreedingAction } from "../actions";

export interface FixedAssetAccount {
  id: string;
  code: string;
  name: string;
}

/**
 * **MOVE HER OUT OF STOCK AND ONTO THE BALANCE SHEET.**
 *
 * The dialog for the one act in this pack that posts a journal entry. Its copy
 * carries more accounting than anything else here on purpose: the person
 * pressing it is making a decision about what the business owns, and a farm that
 * does not understand the entry will not understand the balance sheet
 * afterwards.
 */
export function ToBreedingForm({
  livestockLotId,
  code,
  carriedCents,
  currencySymbol,
  accounts,
  today,
}: {
  livestockLotId: string;
  code: string;
  /** What the lot is carrying — the figure that will move. */
  carriedCents: number;
  currencySymbol: string | null;
  accounts: FixedAssetAccount[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [accountId, setAccountId] = useState(
    accounts.length === 1 ? accounts[0].id : "",
  );
  const [depreciates, setDepreciates] = useState(true);

  function submit(formData: FormData) {
    startTransition(async () => {
      const life = Number(String(formData.get("usefulLifeMonths") ?? "0"));
      const result = await transferToBreedingAction({
        livestockLotId,
        occurredOn: String(formData.get("occurredOn") ?? today),
        assetAccountId: accountId || null,
        assetKind: "breeding_stock",
        depreciationMethod: depreciates ? "straight_line" : "none",
        usefulLifeMonths: depreciates && life > 0 ? life : null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.amountCents > 0
          ? `${code} is breeding stock — ${formatMoney(result.amountCents, currencySymbol)} moved to fixed assets`
          : `${code} is breeding stock`,
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Move to breeding stock
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Move {code} to the breeding herd</DialogTitle>
            <DialogDescription>
              She stops being stock and becomes something the business owns.{" "}
              {carriedCents > 0 ? (
                <>
                  <span className="font-medium text-foreground">
                    {formatMoney(carriedCents, currencySymbol)}
                  </span>{" "}
                  moves out of inventory and into fixed assets — what she cost to
                  buy plus what has been spent raising her.
                </>
              ) : (
                <>Nothing has been costed against her, so nothing moves — the
                asset is created with no value to depreciate.</>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="capital-account">Her cost sits in</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="capital-account">
                  <SelectValue placeholder="Pick a fixed-asset account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Said rather than silently skipped: an entry with nowhere to
                  land is the thing somebody would discover at year end. */}
              {accounts.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No fixed-asset accounts in the chart yet. She can still be
                  moved — the books just will not record it.
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="capital-when">From</Label>
              <Input
                id="capital-when"
                name="occurredOn"
                type="date"
                defaultValue={today}
                max={today}
                required
              />
            </div>

            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={depreciates}
                onChange={(e) => setDepreciates(e.target.checked)}
              />
              She depreciates from here
            </label>

            {depreciates && (
              <div className="grid gap-2">
                <Label htmlFor="capital-life">Over how many months</Label>
                <Input
                  id="capital-life"
                  name="usefulLifeMonths"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue="60"
                />
                {/* BOOK depreciation, straight line — the only kind this app
                    does. The assets dossier has the book/tax split open, and a
                    farm filing on tax basis will not match this. */}
                <p className="text-xs text-muted-foreground">
                  Straight-line book depreciation. Tax methods — MACRS, §179 —
                  are not modelled, and a raised animal has no tax basis at all.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Moving…" : "Move to breeding stock"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * **BRING HER BACK INTO STOCK — the cull decision.**
 *
 * At net book value, which is the number the books already believe. A cow
 * written down to nothing comes back at nothing, and the dialog says so before
 * anybody presses it.
 */
export function ToMarketForm({
  livestockLotId,
  code,
  bookValueCents,
  currencySymbol,
  today,
}: {
  livestockLotId: string;
  code: string;
  bookValueCents: number;
  currencySymbol: string | null;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await returnToMarketAction({
        livestockLotId,
        occurredOn: String(formData.get("occurredOn") ?? today),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${code} is back in the market herd`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Back to the market herd
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Bring {code} back into stock</DialogTitle>
            <DialogDescription>
              She becomes inventory again and can be processed or sold. She comes
              back at{" "}
              <span className="font-medium text-foreground">
                {formatMoney(bookValueCents, currencySymbol)}
              </span>{" "}
              — what she cost less the depreciation already taken, not what she
              was worth going in.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="market-when">From</Label>
              <Input
                id="market-when"
                name="occurredOn"
                type="date"
                defaultValue={today}
                max={today}
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Moving…" : "Back to the market herd"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
