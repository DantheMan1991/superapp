"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { recordInvoicePaymentAction } from "@/modules/accounting/invoicing/actions";
import type { DepositOption } from "@/modules/accounting/lib/deposit-options";
import {
  formatCentsSigned,
  parseMoneyToCents,
} from "@/modules/accounting/lib/money";

export interface PaymentInvoiceRef {
  id: string;
  version: number;
  number: string;
  balanceCents: number;
}

export interface RecordPaymentProps {
  invoice: PaymentInvoiceRef;
  /** From `depositOptionsFor`, relative to THIS invoice's company. */
  depositOptions: DepositOption[];
  today: string;
  /** The tenant's own list. Codes are what get stored on the payment. */
  paymentMethods: Array<{ code: string; name: string }>;
}

/**
 * Record what a customer paid against one invoice.
 *
 * ONE dialog for two places: the invoice's page, where it always lived, and
 * the invoice list, where it is now a button at the end of an open row so a
 * payment that arrived can be recorded without opening the invoice first.
 * The list mounts it only while it is open — two hundred rows must not carry
 * two hundred dialogs' worth of state.
 */
export function RecordInvoicePaymentDialog({
  open,
  onOpenChange,
  invoice,
  depositOptions,
  today,
  paymentMethods,
}: RecordPaymentProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pay, setPay] = useState({
    date: today,
    amount: (invoice.balanceCents / 100).toFixed(2),
    // Default to one of THIS company's own accounts, so the ordinary payment
    // stays one click and banking it into an affiliate is always deliberate.
    depositAccountId:
      (depositOptions.find((o) => !o.otherCompany) ?? depositOptions[0])?.id ?? "",
    // Whatever the tenant listed first, rather than a hardcoded "check" that
    // might not be one of their methods at all.
    method: paymentMethods[0]?.code ?? "other",
    memo: "",
  });

  const chosenDeposit = depositOptions.find((o) => o.id === pay.depositAccountId);

  function submit() {
    const cents = parseMoneyToCents(pay.amount);
    if (cents === null || cents === 0) {
      toast.error("Enter a valid amount");
      return;
    }
    startTransition(async () => {
      const result = await recordInvoicePaymentAction({
        invoiceId: invoice.id,
        expectedVersion: invoice.version,
        paymentDate: pay.date,
        amountCents: cents,
        depositAccountId: pay.depositAccountId,
        method: pay.method,
        memo: pay.memo.trim() || undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Payment recorded");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment — {invoice.number}</DialogTitle>
          <DialogDescription>
            Balance due {formatCentsSigned(invoice.balanceCents)}. Recording is
            bookkeeping only — no money moves through Yosher.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`pay-date-${invoice.id}`}>Date</Label>
              <Input
                id={`pay-date-${invoice.id}`}
                type="date"
                value={pay.date}
                onChange={(e) => setPay({ ...pay, date: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`pay-amount-${invoice.id}`}>Amount</Label>
              <Input
                id={`pay-amount-${invoice.id}`}
                inputMode="decimal"
                className="text-right font-mono"
                value={pay.amount}
                onChange={(e) => setPay({ ...pay, amount: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Deposit to</Label>
              <Select
                value={pay.depositAccountId || undefined}
                onValueChange={(v) => setPay({ ...pay, depositAccountId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Account" />
                </SelectTrigger>
                <SelectContent>
                  {depositOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                      {o.otherCompany ? ` — ${o.otherCompany}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {chosenDeposit?.otherCompany && (
                // Said BEFORE it happens, the way the bill dialog says it.
                <p className="text-xs text-muted-foreground">
                  The money is going into {chosenDeposit.otherCompany}&apos;s
                  account. It will be recorded on both sides:{" "}
                  {chosenDeposit.otherCompany} owes this company the amount
                  until it is settled.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select
                value={pay.method}
                onValueChange={(v) => setPay({ ...pay, method: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((m) => (
                    <SelectItem key={m.code} value={m.code}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`pay-memo-${invoice.id}`}>Memo (optional)</Label>
            <Input
              id={`pay-memo-${invoice.id}`}
              value={pay.memo}
              onChange={(e) => setPay({ ...pay, memo: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={submit}
            disabled={pending || !pay.date || !pay.depositAccountId}
          >
            {pending ? "Recording…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The button that opens the dialog. Mounts the dialog only while it is open,
 * so a list can put one on every open row.
 */
export function RecordPaymentButton({
  variant = "outline",
  className,
  ...props
}: RecordPaymentProps & {
  variant?: "default" | "outline";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant={variant}
        className={className}
        onClick={() => setOpen(true)}
      >
        Record payment
      </Button>
      {open && (
        <RecordInvoicePaymentDialog open onOpenChange={setOpen} {...props} />
      )}
    </>
  );
}
