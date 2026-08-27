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
import { Panel } from "@/components/app/panel";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { recordSaleAction, recordStockoutAction } from "../actions";
import {
  lineTotalCents,
  saleTotalCents,
  soldByItem,
  unconfirmedSales,
  weighedLineCents,
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
  /**
   * `'unit'` or `'lb'` — what `priceCents` is per. `'lb'` is what makes the
   * till ask for a weight. See ADR 0016.
   */
  priceBasis: string;
}

interface Basket {
  key: string;
  itemId: string;
  itemName: string;
  unit: string;
  lotId: string | null;
  /**
   * **PACKAGES, ALWAYS — even on a weighed line.** It is what leaves the truck
   * and what the local countdown subtracts. Three packages weighed together
   * are one line at quantity 3.
   */
  quantity: number;
  /** Per stocking unit, or per POUND when `priceBasis` is `'lb'`. */
  unitPriceCents: number;
  priceBasis: string;
  /** What the scale said. Null until somebody types it, on a `'lb'` line. */
  weightLb: number | null;
  /**
   * The money, when somebody typed it over the computed figure.
   *
   * Null means "work it out from the weight and the rate". **Cleared whenever
   * the weight changes**, because a haggled total belongs to the thing that was
   * on the scale at the time, and silently keeping it against a new weight is
   * how a till charges for something it is not holding.
   */
  totalOverrideCents: number | null;
}

/**
 * What a basket line comes to, in the shape the shared arithmetic wants.
 *
 * **ONE PLACE, so the receipt cannot disagree with the day-end report.** A
 * unit line has no total and takes `lineTotalCents`'s derived path exactly as
 * it always did; a weighed line carries one, computed by `weighedLineCents` or
 * typed over it.
 */
function totalledLine(b: Basket) {
  return {
    quantity: b.quantity,
    unitPriceCents: b.unitPriceCents,
    totalCents: weighedTotal(b),
  };
}

/** Priced by the pound, with nothing on the scale yet. Cannot be sold or totalled. */
function isUnweighed(b: Basket): boolean {
  return b.priceBasis === "lb" && b.weightLb === null;
}

/** The stamped total for a weighed line, or null when the line is not one. */
function weighedTotal(b: Basket): number | null {
  if (b.priceBasis !== "lb") return null;
  if (b.totalOverrideCents !== null) return b.totalOverrideCents;
  if (b.weightLb === null) return null;
  return weighedLineCents(b.weightLb, b.unitPriceCents);
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


  /**
   * **A WEIGHED LINE NOBODY HAS WEIGHED CANNOT BE SOLD**, and it must not be
   * TOTALLED either. The basket keeps the line — somebody is standing at the
   * scale with it.
   */
  const unweighed = basket.filter(isUnweighed);
  /**
   * **THE UNWEIGHED LINE IS LEFT OUT OF THE TOTAL, AND LEAVING IT IN WAS A REAL
   * BUG.** `lineTotalCents` falls back to quantity × price when no total is
   * stamped — correct for a unit line, and for a `'lb'` line it is one package
   * at a per-POUND rate. A basket holding one unweighed package of $8.00/lb
   * beef read **$8.00**, which is a plausible-looking number, is not what the
   * customer will pay, and is precisely the per-package-at-a-per-pound-rate
   * mistake this whole slice is built to prevent. Found by standing at the
   * screen; every test passed over it.
   */
  const totalCents = saleTotalCents(
    basket.filter((b) => !isUnweighed(b)).map(totalledLine),
  );

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
          priceBasis: line.priceBasis,
          weightLb: null,
          totalOverrideCents: null,
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

  function setWeight(key: string, weightLb: number | null) {
    // THE OVERRIDE GOES WITH IT. A total somebody typed belongs to what was on
    // the scale at the time; carrying it onto a different weight would charge
    // for something the customer is not holding.
    setBasket((current) =>
      current.map((b) =>
        b.key === key ? { ...b, weightLb, totalOverrideCents: null } : b,
      ),
    );
  }

  function setLineTotal(key: string, cents: number) {
    setBasket((current) =>
      current.map((b) => (b.key === key ? { ...b, totalOverrideCents: cents } : b)),
    );
  }

  function take() {
    if (basket.length === 0) return;
    if (unweighed.length > 0) {
      toast.error(
        `Weigh ${unweighed.map((b) => b.itemName).join(", ")} first — it is priced by the pound.`,
      );
      return;
    }
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
          // PACKAGES. This is what issues the stock, weighed or not.
          quantity: b.quantity,
          unitPriceCents: b.unitPriceCents,
          weightLb: b.weightLb,
          lineTotalCents: weighedTotal(b),
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
    <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
      <Panel className="p-5">
        <h2 className="mb-3 font-heading text-base font-semibold tracking-heading">
          On the truck
        </h2>
        <div>
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
                        <>
                          {formatMoney(line.priceCents, currencySymbol)}
                          {/* Without this the tile reads "$8.00" for a package
                              that will ring up at $9.60, which is the one place
                              somebody standing at a stall would notice too
                              late. */}
                          {line.priceBasis === "lb" && (
                            <span className="text-muted-foreground">/lb</span>
                          )}
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Panel>

      <Panel className="p-5">
        <h2 className="mb-3 font-heading text-base font-semibold tracking-heading">
          This sale
        </h2>
        <div className="space-y-3">
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
                      {isUnweighed(b) ? (
                        <span className="text-muted-foreground">weigh it</span>
                      ) : (
                        formatMoney(lineTotalCents(totalledLine(b)), currencySymbol)
                      )}
                    </span>
                  </div>
                  {/**
                   * **TWO SHAPES, BECAUSE THEY ARE TWO DIFFERENT SALES.** A
                   * unit line is quantity × price and reads exactly as it
                   * always has. A weighed line is a count of packages, a
                   * reading off the scale, and money worked out from the two —
                   * so the money is the box that is editable there, because
                   * *two for twenty* on a weighed line is a total and not a
                   * rate.
                   */}
                  {b.priceBasis === "lb" ? (
                    <>
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
                          {b.unit} ·
                        </span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          autoFocus
                          placeholder="lb"
                          value={b.weightLb ?? ""}
                          onChange={(e) =>
                            setWeight(
                              b.key,
                              e.target.value === "" ? null : Number(e.target.value),
                            )
                          }
                          className="h-8"
                          aria-label={`Weight in pounds of ${b.itemName}`}
                        />
                        <span className="text-xs text-muted-foreground">lb</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          at {formatMoney(b.unitPriceCents, currencySymbol)}/lb =
                        </span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={
                            weighedTotal(b) === null
                              ? ""
                              : (weighedTotal(b)! / 100).toFixed(2)
                          }
                          onChange={(e) =>
                            setLineTotal(
                              b.key,
                              Math.round(Number(e.target.value) * 100),
                            )
                          }
                          className="h-8"
                          aria-label={`What ${b.itemName} came to`}
                        />
                      </div>
                    </>
                  ) : (
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
                  )}
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
          {unweighed.length > 0 && (
            // The total is not wrong, it is INCOMPLETE, and the difference has
            // to be on the screen rather than only in a toast after a tap.
            <p className="-mt-2 text-xs text-muted-foreground">
              Not counting {unweighed.map((b) => b.itemName).join(", ")} — still
              on the scale.
            </p>
          )}

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
            // Disabled rather than erroring on tap: the reason is already on
            // the screen above, and a dead button beside it reads as the same
            // sentence. `take` keeps its own guard for anything that reaches it
            // another way.
            disabled={pending || basket.length === 0 || unweighed.length > 0}
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
        </div>
      </Panel>
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
