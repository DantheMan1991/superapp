"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/app/use-confirm";
import { formatMoney } from "@/lib/money";
import {
  matchBillLineAction,
  setInventoryTreatmentAction,
  unmatchBillLineAction,
} from "../actions";

interface Delivery {
  movementId: string;
  itemName: string;
  unit: string;
  lotCode: string | null;
  occurredOn: string;
  openQuantity: number;
  openCostCents: number;
}

/**
 * **THE SWITCH THAT MAKES INVENTORY REACH THE BOOKS.**
 *
 * Until this existed the posting engine was unreachable — tested, live, and
 * impossible to turn on. It is deliberately not a quiet toggle in a settings
 * list: it changes how every future purchase is recorded, so it says what it
 * does before it does it, and it says the one thing people assume and should
 * not — **it does not backfill.**
 */
export function TreatmentControl({
  treatment,
  isOwner,
  postedEntries,
  postedSince,
}: {
  treatment: "none" | "capitalise";
  isOwner: boolean;
  /** Entries this pack has already put in the books. See `postedInventoryEntries`. */
  postedEntries: number;
  postedSince: string | null;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [pending, startTransition] = useTransition();
  const on = treatment === "capitalise";
  /**
   * **ONCE SOMETHING HAS POSTED, THIS IS A METHOD RATHER THAN A SETTING** —
   * [ADR 0013](../../../../docs/decisions/0013-inventory-tax-treatment.md) §A.6.
   * The server refuses it (`assertPostingChangeSafe`); the switch does not offer
   * it, which is the same rule slice 3c set when it stopped offering a Match
   * button that was going to fail.
   */
  const locked = on && postedEntries > 0;

  async function toggle(next: boolean) {
    const asked = await confirm(
      next
        ? {
            title: "Start putting stock on the balance sheet?",
            description:
              "From now on a delivery becomes an asset and its cost moves to cost of goods when it is used. Entries are written as things happen — nothing before today is rewritten, so the books start from here. Your accountant should be the one who says this is right for your business.",
            confirmLabel: "Turn it on",
          }
        : {
            title: "Stop posting stock to the books?",
            /**
             * **THIS USED TO SAY "what is already posted stays posted", WHICH
             * IS TRUE AND WAS THE PROBLEM.** It reads as reassurance. What it
             * leaves out is that issues stop posting too, so anything already
             * capitalised sits in Inventory with nothing left to relieve it. It
             * is only reachable now when nothing has posted, so the sentence
             * can simply be accurate instead.
             */
            description:
              "Nothing has reached the ledger yet, so there is nothing to unwind. Cost is still tracked either way — this only decides whether stock appears in your financial statements.",
            confirmLabel: "Turn it off",
            destructive: true,
          },
    );
    if (!asked) return;
    startTransition(async () => {
      const result = await setInventoryTreatmentAction({
        treatment: next ? "capitalise" : "none",
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(next ? "Stock now posts to the books" : "Stock no longer posts");
      router.refresh();
    });
  }

  return (
    <>
      {confirmDialog}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div className="max-w-2xl">
            <div className="text-sm font-medium">
              {on
                ? "Stock is on the balance sheet"
                : "Stock is not on the balance sheet"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {on
                ? "A delivery becomes an asset when it arrives, and its cost moves to cost of goods when it is used. What you were charged is matched to what turned up below."
                : "What stock costs is tracked either way — this decides whether it appears in your financial statements. Most small businesses should ask their accountant before turning it on."}
            </p>
            {locked && (
              /* Said HERE rather than only in the refusal, because a disabled
                 switch with no explanation reads as a bug. */
              <p className="mt-2 text-xs text-muted-foreground">
                This cannot be turned off now. Stock has been on the books since{" "}
                {postedSince}, across {postedEntries}{" "}
                {postedEntries === 1 ? "entry" : "entries"}, and switching off
                would leave that cost in Inventory with nothing left to relieve
                it. Deciding what to do with it is a journal entry somebody makes
                on purpose.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="treatment" className="text-xs text-muted-foreground">
              {on ? "On" : "Off"}
            </Label>
            <Switch
              id="treatment"
              checked={on}
              disabled={!isOwner || pending || locked}
              onCheckedChange={toggle}
            />
          </div>
        </CardContent>
      </Card>
    </>
  );
}

/**
 * Match one bill line to the deliveries it is paying for.
 *
 * **The quantity boxes start EMPTY rather than pre-filled with what is open.**
 * A pre-filled number is a number nobody reads, and the one question this
 * screen exists to ask is whether what the invoice charges for is what actually
 * turned up. Filling it in for them answers it on their behalf, always in the
 * affirmative.
 */
export function MatchDialog({
  billLineId,
  vendorName,
  description,
  invoiceCents,
  currencySymbol,
  deliveries,
}: {
  billLineId: string;
  vendorName: string;
  description: string;
  invoiceCents: number;
  currencySymbol: string | null;
  deliveries: Delivery[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [invoiceQuantity, setInvoiceQuantity] = useState("");

  const matches = useMemo(
    () =>
      Object.entries(picked)
        .map(([movementId, raw]) => ({
          movementId,
          quantityMatched: Number(raw),
        }))
        .filter((m) => Number.isFinite(m.quantityMatched) && m.quantityMatched > 0),
    [picked],
  );

  const matchedQuantity = matches.reduce((s, m) => s + m.quantityMatched, 0);
  const invoiceQty = Number(invoiceQuantity);
  const short =
    Number.isFinite(invoiceQty) && invoiceQty > matchedQuantity
      ? invoiceQty - matchedQuantity
      : 0;

  function submit() {
    if (matches.length === 0) {
      toast.error("Say how much of a delivery this bill is paying for.");
      return;
    }
    startTransition(async () => {
      const result = await matchBillLineAction({
        billLineId,
        invoiceQuantity: invoiceQty > 0 ? invoiceQty : undefined,
        matches,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const bits: string[] = [];
      if (result.varianceCents !== 0) {
        bits.push(
          `${formatMoney(Math.abs(result.varianceCents), currencySymbol)} ${
            result.varianceCents > 0 ? "dearer" : "cheaper"
          } than the ticket`,
        );
      }
      if (result.shortfallCents !== 0) {
        bits.push(
          `${formatMoney(result.shortfallCents, currencySymbol)} charged for stock that did not arrive`,
        );
      }
      toast.success(bits.length > 0 ? `Matched — ${bits.join(", ")}` : "Matched");
      setPicked({});
      setInvoiceQuantity("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Match
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {vendorName} — {formatMoney(invoiceCents, currencySymbol)}
          </DialogTitle>
          <DialogDescription>
            {description || "This line"}. Say how much of each delivery this bill
            is paying for.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-80 space-y-2 overflow-y-auto py-2">
          {deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No priced deliveries are waiting for an invoice.
            </p>
          ) : (
            deliveries.map((d) => (
              <div
                key={d.movementId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="text-sm">
                  <div className="font-medium">{d.itemName}</div>
                  <div className="text-xs text-muted-foreground">
                    {d.occurredOn}
                    {d.lotCode ? ` · ${d.lotCode}` : ""} · {d.openQuantity}{" "}
                    {d.unit} open ·{" "}
                    {formatMoney(d.openCostCents, currencySymbol)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    max={d.openQuantity}
                    step="0.0001"
                    className="h-9 w-28"
                    placeholder={`0 ${d.unit}`}
                    aria-label={`How much of the ${d.occurredOn} ${d.itemName} delivery`}
                    value={picked[d.movementId] ?? ""}
                    onChange={(e) =>
                      setPicked((p) => ({ ...p, [d.movementId]: e.target.value }))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setPicked((p) => ({
                        ...p,
                        [d.movementId]: String(d.openQuantity),
                      }))
                    }
                  >
                    All
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="invoiceQuantity" className="text-xs">
            How much is the bill charging for?
          </Label>
          <Input
            id="invoiceQuantity"
            type="number"
            min="0"
            step="0.0001"
            className="h-9 w-40"
            placeholder={matchedQuantity > 0 ? String(matchedQuantity) : ""}
            value={invoiceQuantity}
            onChange={(e) => setInvoiceQuantity(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {/* THE QUESTION THIS SCREEN EXISTS FOR. Charged for more than
                turned up is not a price rise — it is stock paid for and not
                held, and it stays on the books to be chased. */}
            {short > 0
              ? `Charged for ${short} more than arrived. That stays as owed stock rather than becoming a cost.`
              : "Leave it blank if the bill is for exactly what arrived."}
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            onClick={submit}
            disabled={pending || matches.length === 0}
          >
            {pending ? "Matching…" : "Match"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Undo a match, putting the bill line back the way it was. */
export function UnmatchButton({ billLineId }: { billLineId: string }) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [pending, startTransition] = useTransition();

  // The guard is OUTSIDE the transition. Asking inside one deadlocks, because
  // opening the dialog is a transition update the transition cannot commit
  // while suspended on the answer.
  async function undo() {
    const asked = await confirm({
      title: "Unpick this match?",
      description:
        "The deliveries go back to waiting for an invoice, and the bill line goes back to being uncoded — so the bill cannot be approved until somebody says what it was for.",
      confirmLabel: "Unpick it",
      destructive: true,
    });
    if (!asked) return;
    startTransition(async () => {
      const result = await unmatchBillLineAction({ billLineId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Unpicked");
      router.refresh();
    });
  }

  return (
    <>
      {confirmDialog}
      <Button variant="ghost" size="sm" onClick={undo} disabled={pending}>
        Unpick
      </Button>
    </>
  );
}
