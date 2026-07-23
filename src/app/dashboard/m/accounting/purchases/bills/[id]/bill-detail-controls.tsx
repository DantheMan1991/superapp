"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, Undo2 } from "lucide-react";
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
import {
  approveBillAction,
  recordBillPaymentAction,
  returnBillToDraftAction,
  submitBillForApprovalAction,
  suggestBillCodingAction,
  unapplyBillPaymentAction,
  voidBillAction,
} from "@/modules/accounting/payables/actions";
import {
  formatCents,
  parseMoneyToCents,
} from "@/modules/accounting/lib/money";

type Result = { error?: string } | { ok: true };

export function BillActions({
  billId,
  version,
  status,
  isOwner,
  journalEntryId,
}: {
  billId: string;
  version: number;
  status: string;
  isOwner: boolean;
  journalEntryId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<Result>, done: string) {
    startTransition(async () => {
      const result = await fn();
      if ("error" in result && result.error) toast.error(result.error);
      else {
        toast.success(done);
        router.refresh();
      }
    });
  }

  const ref = { billId, expectedVersion: version };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => suggestBillCodingAction({ billId }), "Coding suggested.")
          }
        >
          <Sparkles className="mr-1 h-3.5 w-3.5" /> Suggest coding
        </Button>
      )}
      {status === "draft" && !isOwner && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() => submitBillForApprovalAction(ref), "Submitted for approval.")
          }
        >
          Submit for approval
        </Button>
      )}
      {status === "awaiting_approval" && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => returnBillToDraftAction(ref), "Returned to draft.")
          }
        >
          Return to draft
        </Button>
      )}
      {isOwner && ["draft", "awaiting_approval"].includes(status) && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() => approveBillAction(ref), "Approved and posted.")
          }
        >
          {pending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          Approve
        </Button>
      )}
      {isOwner && ["approved", "partial", "paid"].includes(status) && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            if (confirm("Void this bill? Its ledger entry will be voided too."))
              run(() => voidBillAction(ref), "Bill voided.");
          }}
        >
          Void
        </Button>
      )}
      {journalEntryId && status !== "draft" && (
        <Button asChild size="sm" variant="ghost">
          <Link href={`/dashboard/m/accounting/journal/${journalEntryId}`}>
            View entry
          </Link>
        </Button>
      )}
    </div>
  );
}

export function RecordBillPaymentDialogButton({
  billId,
  version,
  remainingCents,
  today,
  registers,
}: {
  billId: string;
  version: number;
  remainingCents: number;
  today: string;
  registers: Array<{ ledgerAccountId: string; name: string; kind: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState(formatCents(remainingCents).replace(/,/g, ""));
  const [date, setDate] = useState(today);
  const [paidFrom, setPaidFrom] = useState(registers[0]?.ledgerAccountId ?? "");
  const [method, setMethod] = useState<"cash" | "check" | "card" | "bank_transfer" | "other">("check");
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
        billId,
        expectedVersion: version,
        paymentDate: date,
        amountCents: cents,
        paidFromAccountId: paidFrom,
        method,
        memo: memo || undefined,
      });
      if ("error" in result && result.error) toast.error(result.error);
      else {
        toast.success("Payment recorded.");
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Record payment
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>
              Posts Dr Accounts Payable / Cr the paid-from account. Remaining:
              ${formatCents(remainingCents)}. Record-keeping only — no money
              moves.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bp-amount">Amount</Label>
                <Input
                  id="bp-amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bp-date">Date</Label>
                <Input
                  id="bp-date"
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
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Method</Label>
                <Select
                  value={method}
                  onValueChange={(v) => setMethod(v as typeof method)}
                >
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
                <Label htmlFor="bp-memo">Memo</Label>
                <Input
                  id="bp-memo"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function UnapplyBillPaymentButton({
  paymentId,
  version,
}: {
  paymentId: string;
  version: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      title="Unapply (voids the payment entry)"
      onClick={() => {
        if (!confirm("Unapply this payment? Its ledger entry will be voided."))
          return;
        startTransition(async () => {
          const result = await unapplyBillPaymentAction({
            paymentId,
            expectedVersion: version,
          });
          if ("error" in result && result.error) toast.error(result.error);
          else {
            toast.success("Payment unapplied.");
            router.refresh();
          }
        });
      }}
    >
      <Undo2 className="h-3.5 w-3.5" />
    </Button>
  );
}
