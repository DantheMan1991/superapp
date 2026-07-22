"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
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
  deleteInvoiceDraftAction,
  issueInvoiceAction,
  recordInvoicePaymentAction,
  unapplyInvoicePaymentAction,
  voidInvoiceAction,
} from "@/modules/accounting/invoicing/actions";
import {
  formatCentsSigned,
  parseMoneyToCents,
} from "@/modules/accounting/lib/money";

interface InvoiceRef {
  id: string;
  version: number;
  status: string;
  number: string;
  balanceCents: number;
}

export function InvoiceActions({
  invoice,
  depositOptions,
  today,
  canAct,
}: {
  invoice: InvoiceRef;
  depositOptions: Array<{ id: string; label: string }>;
  today: string;
  canAct: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({
    date: today,
    amount: (invoice.balanceCents / 100).toFixed(2),
    depositAccountId: depositOptions[0]?.id ?? "",
    method: "check" as "cash" | "check" | "card" | "bank_transfer" | "other",
    memo: "",
  });

  function run(kind: "issue" | "void" | "delete") {
    const confirmText =
      kind === "issue"
        ? `Issue ${invoice.number}? This posts it to the books.`
        : kind === "void"
          ? `Void ${invoice.number}? Its ledger effect is removed.`
          : `Delete this draft? This cannot be undone.`;
    if (!window.confirm(confirmText)) return;
    startTransition(async () => {
      const args = { invoiceId: invoice.id, expectedVersion: invoice.version };
      const result =
        kind === "issue"
          ? await issueInvoiceAction(args)
          : kind === "void"
            ? await voidInvoiceAction(args)
            : await deleteInvoiceDraftAction(args);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        kind === "issue" ? "Invoice issued" : kind === "void" ? "Invoice voided" : "Draft deleted",
      );
      if (kind === "delete") router.push("/dashboard/m/accounting/sales/invoices");
      router.refresh();
    });
  }

  function submitPayment() {
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
      setPayOpen(false);
      router.refresh();
    });
  }

  if (!canAct) {
    return (
      <Button size="sm" variant="outline" onClick={() => window.print()}>
        <Printer className="mr-1.5 size-3.5" /> Print
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {invoice.status === "draft" && (
        <>
          <Button size="sm" onClick={() => run("issue")} disabled={pending}>
            Issue
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              router.push(`/dashboard/m/accounting/sales/invoices/${invoice.id}?edit=1`)
            }
          >
            Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => run("delete")} disabled={pending}>
            Delete
          </Button>
        </>
      )}
      {["issued", "partial"].includes(invoice.status) && (
        <Button size="sm" onClick={() => setPayOpen(true)} disabled={pending}>
          Record payment
        </Button>
      )}
      {invoice.status === "issued" && (
        <Button size="sm" variant="outline" onClick={() => run("void")} disabled={pending}>
          Void
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={() => window.print()}>
        <Printer className="mr-1.5 size-3.5" /> Print
      </Button>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
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
                <Label htmlFor="pay-date">Date</Label>
                <Input
                  id="pay-date"
                  type="date"
                  value={pay.date}
                  onChange={(e) => setPay({ ...pay, date: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pay-amount">Amount</Label>
                <Input
                  id="pay-amount"
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
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Method</Label>
                <Select
                  value={pay.method}
                  onValueChange={(v) => setPay({ ...pay, method: v as typeof pay.method })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-memo">Memo (optional)</Label>
              <Input
                id="pay-memo"
                value={pay.memo}
                onChange={(e) => setPay({ ...pay, memo: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={submitPayment}
              disabled={pending || !pay.date || !pay.depositAccountId}
            >
              {pending ? "Recording…" : "Record payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UnapplyButton({ paymentId, version }: { paymentId: string; version: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function unapply() {
    if (!window.confirm("Unapply this payment? Its ledger entry is voided.")) return;
    startTransition(async () => {
      const result = await unapplyInvoicePaymentAction({
        paymentId,
        expectedVersion: version,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Payment unapplied");
        router.refresh();
      }
    });
  }
  return (
    <Button size="sm" variant="ghost" className="h-7" onClick={unapply} disabled={pending}>
      Unapply
    </Button>
  );
}

InvoiceActions.Unapply = UnapplyButton;
