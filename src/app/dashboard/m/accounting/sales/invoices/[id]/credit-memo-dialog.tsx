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
import { Combobox } from "@/components/app/combobox";
import { issueCreditMemoAction } from "@/modules/accounting/invoicing/actions";
import { formatCentsSigned, parseMoneyToCents } from "@/modules/accounting/lib/money";

/**
 * Issue a credit against this invoice — a returned item, a price adjustment,
 * a goodwill credit. Up to what the invoice still owes: more than that is a
 * refund, which moves money and is a different thing.
 */
export function CreditMemoButton({
  invoice,
  incomeAccounts,
  defaultAccountId,
  today,
}: {
  invoice: { id: string; version: number; number: string; balanceCents: number };
  incomeAccounts: Array<{ id: string; code: string; name: string }>;
  /** The invoice's first line's account — where a credit usually comes off. */
  defaultAccountId: string | null;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState((invoice.balanceCents / 100).toFixed(2));
  const [accountId, setAccountId] = useState(defaultAccountId ?? incomeAccounts[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const cents = parseMoneyToCents(amount);
  const tooMuch = cents !== null && cents > invoice.balanceCents;
  const valid = cents !== null && cents > 0 && !tooMuch && !!accountId && !!date;

  function submit() {
    if (!valid || cents === null) return;
    startTransition(async () => {
      const result = await issueCreditMemoAction({
        invoiceId: invoice.id,
        expectedVersion: invoice.version,
        amountCents: cents,
        incomeAccountId: accountId,
        issueDate: date,
        memo: reason.trim() || undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      toast.success(
        result.data!.invoiceStatus === "paid"
          ? `Credit memo ${result.data!.number} issued — ${invoice.number} is settled`
          : `Credit memo ${result.data!.number} issued`,
      );
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Credit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Credit memo — {invoice.number}</DialogTitle>
            <DialogDescription>
              Balance due {formatCentsSigned(invoice.balanceCents)}. The credit comes
              off what the customer owes, and off the income the invoice recorded.
              No money moves.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cm-amount">Amount</Label>
                <Input
                  id="cm-amount"
                  inputMode="decimal"
                  className={tooMuch ? "border-destructive" : ""}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                {tooMuch && (
                  <p className="text-xs text-destructive">
                    More than the balance. A credit larger than what is owed is a refund.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cm-date">Date</Label>
                <Input
                  id="cm-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cm-account">Comes off</Label>
              <Combobox
                id="cm-account"
                options={incomeAccounts.map((a) => ({
                  value: a.id,
                  label: `${a.code} · ${a.name}`,
                }))}
                value={accountId || undefined}
                onValueChange={setAccountId}
                placeholder="Pick an income account"
                searchPlaceholder="Type a code or a name…"
                emptyText="No income account matches."
                aria-label="Income account"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cm-reason">Reason (optional)</Label>
              <Input
                id="cm-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Two bags returned"
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || !valid}>
              {pending ? "Issuing…" : "Issue credit memo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
