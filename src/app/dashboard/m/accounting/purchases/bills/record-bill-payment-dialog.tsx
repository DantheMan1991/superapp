"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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
import { recordBillPaymentAction } from "@/modules/accounting/payables/actions";
import type { PaidFromRegister } from "@/modules/accounting/lib/deposit-options";
import {
  formatCents,
  parseMoneyToCents,
} from "@/modules/accounting/lib/money";

export interface PaymentBillRef {
  id: string;
  version: number;
  remainingCents: number;
}

export interface RecordBillPaymentProps {
  bill: PaymentBillRef;
  today: string;
  /** From `paidFromRegistersFor`, relative to THIS bill's company. */
  registers: PaidFromRegister[];
}

type Method = "cash" | "check" | "card" | "bank_transfer" | "other";

/**
 * Record what was paid against one bill.
 *
 * ONE dialog for two places: the bill's page, where it always lived, and the
 * Bills list, where it is now a button at the end of an open row so a payment
 * that went out can be recorded without opening the bill first. The list
 * mounts it only while it is open — two hundred rows must not carry two
 * hundred dialogs' worth of state.
 */
export function RecordBillPaymentDialog({
  open,
  onOpenChange,
  bill,
  today,
  registers,
}: RecordBillPaymentProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState(formatCents(bill.remainingCents).replace(/,/g, ""));
  const [date, setDate] = useState(today);
  // Default to one of THIS company's own accounts, so the ordinary payment
  // stays one click and paying from an affiliate is always deliberate.
  const [paidFrom, setPaidFrom] = useState(
    (registers.find((r) => !r.otherCompany) ?? registers[0])?.ledgerAccountId ?? "",
  );
  const chosen = registers.find((r) => r.ledgerAccountId === paidFrom);
  const [method, setMethod] = useState<Method>("check");
  const [memo, setMemo] = useState("");

  function submit() {
    const cents = parseMoneyToCents(amount);
    if (cents === null || cents <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    if (!paidFrom) {
      toast.error("Pick the account it was paid from.");
      return;
    }
    startTransition(async () => {
      const result = await recordBillPaymentAction({
        billId: bill.id,
        expectedVersion: bill.version,
        paymentDate: date,
        amountCents: cents,
        paidFromAccountId: paidFrom,
        method,
        memo: memo || undefined,
      });
      if ("error" in result && result.error) toast.error(result.error);
      else {
        toast.success("Payment recorded.");
        onOpenChange(false);
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Posts Dr Accounts Payable / Cr the paid-from account. Remaining:
            ${formatCents(bill.remainingCents)}. Record-keeping only — no money
            moves.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`bp-amount-${bill.id}`}>Amount</Label>
              <Input
                id={`bp-amount-${bill.id}`}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`bp-date-${bill.id}`}>Date</Label>
              <Input
                id={`bp-date-${bill.id}`}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Paid from</Label>
            <Select value={paidFrom || undefined} onValueChange={setPaidFrom}>
              <SelectTrigger>
                <SelectValue placeholder="Bank or card register" />
              </SelectTrigger>
              <SelectContent>
                {registers.map((r) => (
                  <SelectItem key={r.ledgerAccountId} value={r.ledgerAccountId}>
                    {r.name} ({r.kind.replaceAll("_", " ")})
                    {r.otherCompany ? ` — ${r.otherCompany}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {chosen?.otherCompany && (
              // Said BEFORE it happens. Two entries rather than one is not
              // something to discover afterwards in the journal.
              <p className="text-xs text-muted-foreground">
                {chosen.otherCompany} is paying this. It will be recorded on
                both sides: this company owes {chosen.otherCompany} the amount
                until it is settled.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as Method)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`bp-memo-${bill.id}`}>Memo</Label>
              <Input
                id={`bp-memo-${bill.id}`}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record
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
export function RecordBillPaymentButton({
  variant = "default",
  className,
  ...props
}: RecordBillPaymentProps & {
  variant?: "default" | "outline";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant={variant} className={className} onClick={() => setOpen(true)}>
        Record payment
      </Button>
      {open && <RecordBillPaymentDialog open onOpenChange={setOpen} {...props} />}
    </>
  );
}
