"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { recordSaleAction, recordStockoutAction } from "../actions";
import {
  lineTotalCents,
  saleTotalCents,
  soldByItem,
  unconfirmedSales,
} from "../core/till";

/** What the till can sell: a truck line, with the channel's price attached. */
export interface TillLine {
  itemId: string;
  itemName: string;
  unit: string;
  lotId: string | null;
  lotCode: string | null;
  /** What the server said was on the truck when this page loaded. */
  onHand: number;
  /** The channel's price today, or null when nobody has priced it here. */
  priceCents: number | null;
}

interface Basket {
  key: string;
  itemId: string;
  itemName: string;
  unit: string;
  lotId: string | null;
  quantity: number;
  unitPriceCents: number;
}

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "other", label: "Something else" },
];

/**
 * The till.
 *
 * **THE TRUCK'S STOCK IS COUNTED DOWN LOCALLY, and that is the design rather
 * than an optimisation.** The market truck is a mobile inventory location, so
 * its stock is only ever touched by the one device standing beside it — there is
 * nothing to conflict over, and therefore nothing to ask a server about between
 * customers. A till that re-fetched a balance after every sale would be unusable
 * at a stall with no signal and no better anywhere else.
 *
 * **EVERY SALE CARRIES A `clientRef` MINTED HERE, BEFORE THE NETWORK.** Today
 * that only makes a retry safe. It is the half of offline that could not be
 * added later: the queue, the service worker and the flush are all client code
 * that can be replaced, and idempotent posting is a column and an index.
 *
 * **WHAT THIS IS NOT, YET.** It is not offline. If the request fails the sale is
 * kept in the basket and the screen says so, rather than pretending it went
 * through — which is the honest failure for a till, and the alternative is
 * silently losing money. The service worker and the durable queue are their own
 * change; see the dossier.
 */
export function Till({
  channelId,
  marketDayId,
  truckAssetId,
  lines,
  postedRefs,
  currencySymbol,
}: {
  channelId: string;
  marketDayId: string;
  truckAssetId: string | null;
  lines: TillLine[];
  /**
   * The `clientRef` of every sale the SERVER already has. This is what makes
   * the local count safe to add to a server snapshot - see `unconfirmed`.
   */
  postedRefs: string[];
  currencySymbol: string | null;
}) {
  const router = useRouter();
  const [basket, setBasket] = useState<Basket[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  /**
   * The network call only. **NOT a `useTransition`, and that is deliberate.**
   * Everything inside a transition commits together, so putting the local stock
   * countdown in the same one as `router.refresh()` made the truck wait on the
   * server before it would show the sale — in a till whose entire reason for
   * counting locally is that there may be no server to wait for.
   */
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();
  /**
   * Sold on this device and **tagged with the ref it was posted under**, which
   * is the whole trick. `lines` is a server snapshot that goes stale the moment
   * a sale lands and fresh again a second later when `router.refresh()` returns
   * - so a local delta that simply accumulated would be subtracted twice from
   * every refreshed figure, and the truck would under-report by the session's
   * entire takings. It read 35.65 lb with 36.65 lb in the cooler before this
   * was tagged.
   *
   * Tagged, the delta answers exactly the right question: **what has this
   * device sold that the snapshot does not know about yet?** Late refreshes,
   * out-of-order ones and a queue flushing an hour of sales at once all
   * converge on the same number, and it drains itself.
   */
  const [soldSince, setSoldSince] = useState<
    { clientRef: string; itemId: string; quantity: number }[]
  >([]);

  const sold = useMemo(
    () => soldByItem(unconfirmedSales(soldSince, postedRefs)),
    [soldSince, postedRefs],
  );


  const totalCents = saleTotalCents(basket);

  function add(line: TillLine) {
    if (line.priceCents === null) {
      toast.error(`${line.itemName} has no price here. Set one first.`);
      return;
    }
    setBasket((current) => {
      const key = `${line.itemId}:${line.lotId ?? ""}`;
      const found = current.find((b) => b.key === key);
      if (found) {
        return current.map((b) =>
          b.key === key ? { ...b, quantity: round4(b.quantity + 1) } : b,
        );
      }
      return [
        ...current,
        {
          key,
          itemId: line.itemId,
          itemName: line.itemName,
          unit: line.unit,
          lotId: line.lotId,
          quantity: 1,
          unitPriceCents: line.priceCents!,
        },
      ];
    });
  }

  function setQuantity(key: string, quantity: number) {
    setBasket((current) =>
      quantity <= 0
        ? current.filter((b) => b.key !== key)
        : current.map((b) => (b.key === key ? { ...b, quantity } : b)),
    );
  }

  function setPrice(key: string, cents: number) {
    // A market haggles. "Two for twenty" is a real transaction and the list
    // price is not what happened, so the line price is editable at the till and
    // stamped as charged.
    setBasket((current) =>
      current.map((b) => (b.key === key ? { ...b, unitPriceCents: cents } : b)),
    );
  }

  function take() {
    if (basket.length === 0) return;
    // MINTED BEFORE THE NETWORK. This is what makes a retry safe.
    const clientRef = crypto.randomUUID();
    const snapshot = basket;
    void (async () => {
      setPending(true);
      const result = await recordSaleAction({
        clientRef,
        channelId,
        marketDayId,
        soldAt: new Date().toISOString(),
        paymentMethod,
        locationAssetId: truckAssetId,
        lines: snapshot.map((b) => ({
          itemId: b.itemId,
          lotId: b.lotId,
          quantity: b.quantity,
          unitPriceCents: b.unitPriceCents,
        })),
      });
      setPending(false);
      if ("error" in result) {
        // THE BASKET IS NOT CLEARED. A till that emptied itself on a failure
        // would have taken the goods off the stall and lost the money.
        toast.error(`${result.error} — the sale is still here, try again.`);
        return;
      }
      toast.success(
        result.alreadyPosted
          ? "Already rung up"
          : `${formatMoney(result.totalCents ?? 0, currencySymbol)} taken`,
      );
      setSoldSince((current) => [
        // Drop what the snapshot has caught up on while we are here.
        // `unconfirmedSales` at read time is what makes this CORRECT; pruning
        // on write only stops a long market day growing a list forever, and it
        // belongs in the handler rather than an effect that would re-render
        // every time the server answered.
        ...unconfirmedSales(current, postedRefs),
        ...snapshot.map((b) => ({
          clientRef,
          itemId: b.itemId,
          quantity: b.quantity,
        })),
      ]);
      setBasket([]);
      // LAST, AND ON ITS OWN. The till is already correct without it; this only
      // catches the server-rendered cards up — takings, margin, the sales list.
      // It is allowed to be slow, and one day it is allowed to fail.
      startTransition(() => router.refresh());
    })();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">On the truck</CardTitle>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing loaded. Move stock onto the truck and it appears here —
              loading is a transfer, so the app knows exactly what left.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {lines.map((line) => {
                const remaining = round4(
                  line.onHand - (sold.get(line.itemId) ?? 0),
                );
                return (
                  <button
                    key={`${line.itemId}:${line.lotId ?? ""}`}
                    type="button"
                    onClick={() => add(line)}
                    className="flex items-center justify-between gap-3 rounded-md border p-3 text-left hover:bg-accent disabled:opacity-50"
                    disabled={line.priceCents === null}
                  >
                    <span>
                      <span className="block text-sm font-medium">
                        {line.itemName}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {/* Counted down locally as things sell. */}
                        {remaining} {line.unit} left
                        {line.lotCode ? ` · ${line.lotCode}` : ""}
                      </span>
                    </span>
                    <span className="text-sm tabular-nums">
                      {line.priceCents === null ? (
                        <span className="text-muted-foreground">no price</span>
                      ) : (
                        formatMoney(line.priceCents, currencySymbol)
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">This sale</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {basket.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Tap what they are buying.
            </p>
          ) : (
            <div className="space-y-2">
              {basket.map((b) => (
                <div key={b.key} className="space-y-1 rounded-md border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{b.itemName}</span>
                    <span className="text-sm tabular-nums">
                      {formatMoney(lineTotalCents(b), currencySymbol)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={b.quantity}
                      onChange={(e) =>
                        setQuantity(b.key, Number(e.target.value))
                      }
                      className="h-8"
                      aria-label={`How many ${b.unit} of ${b.itemName}`}
                    />
                    <span className="text-xs text-muted-foreground">
                      {b.unit} ×
                    </span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={(b.unitPriceCents / 100).toFixed(2)}
                      onChange={(e) =>
                        setPrice(b.key, Math.round(Number(e.target.value) * 100))
                      }
                      className="h-8"
                      aria-label={`Price per ${b.unit} of ${b.itemName}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-xl font-semibold tabular-nums">
              {formatMoney(totalCents, currencySymbol)}
            </span>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="payment">Paid by</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger id="payment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            className="w-full"
            onClick={take}
            disabled={pending || basket.length === 0}
          >
            {pending ? "Taking…" : "Take payment"}
          </Button>
          {basket.length > 0 && (
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => setBasket([])}
              disabled={pending}
            >
              Clear
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Ran out of something.
 *
 * **ONE TAP, AND IT IS THE ONLY ROUTE BY WHICH A LOST SALE EVER GETS RECORDED.**
 * Bring 30 dozen eggs and sell 30 dozen and the sales data shows a perfect day;
 * nobody knows how many people wanted eggs at noon and found none. Nothing in
 * the system can infer the difference between selling out at closing time and
 * running dry at eleven.
 */
export function StockoutButton({
  marketDayId,
  itemId,
  itemName,
  alreadyNoted,
}: {
  marketDayId: string;
  itemId: string;
  itemName: string;
  alreadyNoted: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function mark() {
    startTransition(async () => {
      const result = await recordStockoutAction({
        marketDayId,
        itemId,
        noticedAt: new Date().toISOString(),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Noted — ran out of ${itemName}`);
      router.refresh();
    });
  }

  if (alreadyNoted) {
    return <Badge variant="outline">Ran out</Badge>;
  }

  return (
    <Button variant="ghost" size="sm" onClick={mark} disabled={pending}>
      Ran out
    </Button>
  );
}
