"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Smartphone, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/app/use-confirm";
import { cn } from "@/lib/utils";
import type { ReaderView } from "@/lib/payments/terminal";
import {
  archiveReaderAction,
  cancelCollectionAction,
  collectPaymentAction,
  readPaymentStatusAction,
  registerReaderAction,
  renameReaderAction,
  simulateTapAction,
} from "./reader-actions";

/**
 * Card readers for one company.
 *
 * **THE PANEL IS THE ONLY PLACE A PAYMENT CAN BE DRIVEN TODAY**, because the
 * till does not call it yet (`retail` slice 5). It is deliberately not a
 * mock: it creates a real PaymentIntent on the connected account and pushes it
 * to a real reader, so what it proves is what the till will do.
 */
export function ReaderSection({
  entityId,
  readers,
  canRegister,
  testMode,
}: {
  entityId: string | null;
  readers: ReaderView[];
  /** Owner-only. Choosing whose bank a device pays into is a decision. */
  canRegister: boolean;
  /** Stripe test mode. Gates the simulated-tap button, never the charge itself. */
  testMode: boolean;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Card readers</p>
        {canRegister && !adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            Add a reader
          </Button>
        )}
      </div>

      {readers.length === 0 && !adding && (
        <p className="mt-2 text-sm text-muted-foreground">
          No readers yet. A reader is the card machine a customer taps — add one
          and it can take payments at a stall.
        </p>
      )}

      {readers.length > 0 && (
        <ul className="mt-3 space-y-2">
          {readers.map((reader) => (
            <ReaderRow
              key={reader.id}
              reader={reader}
              canManage={canRegister}
              testMode={testMode}
            />
          ))}
        </ul>
      )}

      {adding && (
        <RegisterForm
          entityId={entityId}
          needsAddress={readers.length === 0}
          onDone={() => setAdding(false)}
        />
      )}
    </div>
  );
}

function RegisterForm({
  entityId,
  needsAddress,
  onDone,
}: {
  entityId: string | null;
  /**
   * Stripe needs an address for the Terminal location, and the app holds no
   * address anywhere — so the FIRST reader for a company asks for one. If a
   * location already exists these fields are ignored server-side.
   */
  needsAddress: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");

  return (
    <form
      className="mt-3 space-y-3 border-t border-border pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const res = await registerReaderAction({
            entityId,
            label,
            registrationCode: code,
            address: needsAddress
              ? { line1, city, state, postalCode }
              : null,
          });
          if (res.error) toast.error(res.error);
          else {
            toast.success("Reader added");
            onDone();
            router.refresh();
          }
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="reader-label">What to call it</Label>
          <Input
            id="reader-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Front table"
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="reader-code">Pairing code</Label>
          <Input
            id="reader-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="quick-brown-fox"
            required
          />
          <p className="text-xs text-muted-foreground">
            Shown on the reader&rsquo;s own screen. It expires after a few
            minutes, so fetch it just before you add the device.
          </p>
        </div>
      </div>

      {needsAddress && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Stripe needs the address the reader will be used at. It goes on
            Stripe&rsquo;s record of the device, not on a receipt.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={line1}
              onChange={(e) => setLine1(e.target.value)}
              placeholder="Street address"
              aria-label="Street address"
              required
            />
            <Input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City"
              aria-label="City"
              required
            />
            <Input
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder="State"
              aria-label="State"
              required
            />
            <Input
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder="ZIP"
              aria-label="ZIP code"
              required
            />
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add reader"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onDone}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ReaderRow({
  reader,
  canManage,
  testMode,
}: {
  reader: ReaderView;
  canManage: boolean;
  testMode: boolean;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [label, setLabel] = useState(reader.label);
  const [charging, setCharging] = useState(false);

  const online = reader.status === "online";

  return (
    <li className="rounded-md border border-border bg-muted/30 p-3">
      {confirmDialog}
      <div className="flex flex-wrap items-center gap-2">
        <Smartphone className="size-4 text-muted-foreground" />
        {renaming ? (
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const res = await renameReaderAction({
                  readerId: reader.id,
                  label,
                });
                if (res.error) toast.error(res.error);
                else {
                  setRenaming(false);
                  router.refresh();
                }
              });
            }}
          >
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="h-8"
              aria-label="Reader name"
            />
            <Button type="submit" size="sm" disabled={pending}>
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setLabel(reader.label);
                setRenaming(false);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <span className="text-sm font-medium">{reader.label}</span>
            <Badge
              variant="outline"
              className={cn(
                "gap-1 border-transparent",
                online
                  ? "bg-success/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {online ? (
                <Wifi className="size-3" />
              ) : (
                <WifiOff className="size-3" />
              )}
              {reader.status ?? "unknown"}
            </Badge>
            {reader.simulated && (
              <Badge variant="outline" className="border-transparent bg-accent text-accent-foreground">
                simulated
              </Badge>
            )}
          </>
        )}
      </div>

      <p className="mt-1 font-mono text-xs text-muted-foreground">
        {reader.stripeReaderId}
      </p>

      {!renaming && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setCharging((v) => !v)}
          >
            {charging ? "Close" : "Take a payment"}
          </Button>
          {canManage && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>
                Rename
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={async () => {
                  /**
                   * **ASKED BEFORE THE TRANSITION, NEVER INSIDE ONE.** Inside,
                   * opening the dialog is an update the transition cannot
                   * commit while suspended on the answer, so the button
                   * silently does nothing — the exact failure `retail`'s till
                   * shipped and had to fix.
                   */
                  const ok = await confirm({
                    title: `Retire ${reader.label}?`,
                    description:
                      "It stops being able to take payments and disappears from the till. Payments it already took are unaffected. You can add it again with a fresh pairing code.",
                    confirmLabel: "Retire reader",
                    destructive: true,
                  });
                  if (!ok) return;
                  startTransition(async () => {
                    const res = await archiveReaderAction({ readerId: reader.id });
                    if (res.error) toast.error(res.error);
                    else router.refresh();
                  });
                }}
              >
                Retire
              </Button>
            </>
          )}
        </div>
      )}

      {charging && <ChargePanel reader={reader} testMode={testMode} />}
    </li>
  );
}

/**
 * **A REAL CHARGE ON THE CONNECTED ACCOUNT**, not a mock. The till will do
 * exactly this; until it does, this panel is the only way anybody can find out
 * whether it works.
 */
function ChargePanel({
  reader,
  testMode,
}: {
  reader: ReaderView;
  testMode: boolean;
}) {
  const [dollars, setDollars] = useState("");
  const [intentId, setIntentId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Plain state, not a transition: the till must never wait on the server to
  // show what it just did (`retail`'s own rule).
  const [busy, setBusy] = useState(false);

  const done = status === "succeeded" || status === "canceled";

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border bg-background p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`amt-${reader.id}`}>Amount</Label>
          <Input
            id={`amt-${reader.id}`}
            inputMode="decimal"
            value={dollars}
            onChange={(e) => setDollars(e.target.value)}
            placeholder="12.50"
            className="w-32"
            disabled={!!intentId}
          />
        </div>
        {!intentId ? (
          <Button
            size="sm"
            disabled={busy || !dollars}
            onClick={async () => {
              // Dollars in the form, cents in the action, converted once.
              const cents = Math.round(Number(dollars) * 100);
              if (!Number.isFinite(cents) || cents <= 0) {
                toast.error("Enter an amount.");
                return;
              }
              setBusy(true);
              setFailure(null);
              const res = await collectPaymentAction({
                readerId: reader.id,
                amountCents: cents,
                description: "Yosher reader test",
                /**
                 * Minted BEFORE the network call, like the till's own
                 * `client_ref`. A retry returns the first PaymentIntent
                 * instead of charging the customer twice.
                 */
                clientRef: crypto.randomUUID(),
              });
              setBusy(false);
              if (res.error) toast.error(res.error);
              else {
                setIntentId(res.stripePaymentIntentId ?? null);
                setStatus(res.status ?? null);
              }
            }}
          >
            {busy ? "Sending to reader…" : "Charge this card"}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const res = await readPaymentStatusAction({
                  readerId: reader.id,
                  stripePaymentIntentId: intentId,
                });
                setBusy(false);
                if (res.error) toast.error(res.error);
                else {
                  setStatus(res.status ?? null);
                  setFailure(res.failureMessage ?? null);
                }
              }}
            >
              {busy ? "Checking…" : "Check"}
            </Button>
            {reader.simulated && testMode && !done && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const res = await simulateTapAction({ readerId: reader.id });
                  setBusy(false);
                  if (res.error) toast.error(res.error);
                  else toast.success("Card presented");
                }}
              >
                Tap a test card
              </Button>
            )}
            {!done && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await cancelCollectionAction({ readerId: reader.id });
                  setBusy(false);
                  setIntentId(null);
                  setStatus(null);
                  setFailure(null);
                }}
              >
                Cancel
              </Button>
            )}
          </>
        )}
      </div>

      {intentId && (
        <div className="space-y-1 text-sm">
          <p className="flex items-center gap-2">
            {busy && <Loader2 className="size-3 animate-spin" />}
            <span
              className={cn(
                "font-medium",
                status === "succeeded" &&
                  "text-emerald-700 dark:text-emerald-300",
              )}
            >
              {describeStatus(status)}
            </span>
          </p>
          {failure && <p className="text-destructive">{failure}</p>}
          <p className="font-mono text-xs text-muted-foreground">{intentId}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Stripe's PaymentIntent statuses, in words somebody at a stall can act on.
 * **`requires_payment_method` means "waiting for the customer"**, which reads
 * as an error if it is shown raw.
 */
function describeStatus(status: string | null): string {
  switch (status) {
    case null:
      return "Not started";
    case "requires_payment_method":
      return "Waiting for the customer to tap";
    case "requires_confirmation":
    case "processing":
      return "Processing…";
    case "requires_capture":
      return "Authorised, waiting to be taken";
    case "succeeded":
      return "Paid";
    case "canceled":
      return "Cancelled";
    default:
      return status;
  }
}
