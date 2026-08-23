"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Printer, Send } from "lucide-react";
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
  sendInvoiceAction,
  unapplyInvoicePaymentAction,
  voidInvoiceAction,
} from "@/modules/accounting/invoicing/actions";
import {
  formatCentsSigned,
  parseMoneyToCents,
} from "@/modules/accounting/lib/money";
import { useConfirm } from "@/components/app/use-confirm";

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
  paymentMethods,
}: {
  invoice: InvoiceRef;
  /**
   * Every active register plus Undeposited Funds. `otherCompany` is set only
   * when the account belongs to somebody else — depositing into one is an
   * INTERCOMPANY payment (ADR 0010, the mirror of the bill case), recorded as a
   * linked pair rather than refused, and the dialog says so before it happens.
   */
  depositOptions: Array<{ id: string; label: string; otherCompany?: string }>;
  today: string;
  canAct: boolean;
  /** The tenant's own list. Codes are what get stored on the payment. */
  paymentMethods: Array<{ code: string; name: string }>;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [pending, startTransition] = useTransition();
  const [payOpen, setPayOpen] = useState(false);
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

  async function run(kind: "issue" | "void" | "delete") {
    const asked =
      kind === "issue"
        ? await confirm({
            title: `Issue ${invoice.number}?`,
            description:
              "This posts it to the books and starts the clock on getting paid. Its lines are frozen from then on.",
            confirmLabel: "Issue invoice",
          })
        : kind === "void"
          ? await confirm({
              title: `Void ${invoice.number}?`,
              description:
                "Its ledger effect is removed and the invoice stops counting towards what you are owed. The record stays, so the number is never reused.",
              confirmLabel: "Void invoice",
              destructive: true,
            })
          : await confirm({
              title: "Delete this draft?",
              description:
                "Nothing was posted, so nothing is reversed — but the draft and its lines are gone for good.",
              confirmLabel: "Delete draft",
              destructive: true,
            });
    if (!asked) return;
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
      {confirmDialog}
    </div>
  );
}

/**
 * A PLAIN NAMED EXPORT, not `InvoiceActions.Unapply`.
 *
 * It was attached as a property of `InvoiceActions` and rendered as
 * `<InvoiceActions.Unapply />` from the invoice page — which is a SERVER
 * component. Properties hung on a "use client" export do not survive the RSC
 * boundary: the server sees a client reference, `.Unapply` is undefined on it,
 * and React throws #130 ("element type is invalid"). The whole page 500s.
 *
 * It only ever rendered when an invoice had a payment, which is why nothing
 * caught it — found by recording the first one on the live Test tenant.
 */
export function UnapplyPaymentButton({
  paymentId,
  version,
}: {
  paymentId: string;
  version: number;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [pending, startTransition] = useTransition();
  async function unapply() {
    if (
      !(await confirm({
        title: "Unapply this payment?",
        description:
          "The deposit entry is voided and the invoice goes back to owing this much. A reconciled deposit cannot be unapplied at all.",
        confirmLabel: "Unapply payment",
        destructive: true,
      }))
    ) {
      return;
    }
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
    <>
      <Button size="sm" variant="ghost" className="h-7" onClick={unapply} disabled={pending}>
        Unapply
      </Button>
      {confirmDialog}
    </>
  );
}

/**
 * Email the invoice to the customer, PDF attached.
 *
 * Only offered for a sendable invoice: a draft would go out saying DRAFT and a
 * void one should not go out at all, so the server refuses both — this just
 * keeps the button off screen rather than letting somebody find out by
 * clicking it.
 */
export function SendInvoiceButton({
  invoiceId,
  status,
  defaultTo,
  lastSentAt,
  canAct,
}: {
  invoiceId: string;
  status: string;
  defaultTo: string;
  lastSentAt: string | null;
  canAct: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo);
  const [pending, startTransition] = useTransition();

  if (!canAct || !["issued", "partial", "paid"].includes(status)) return null;

  function send() {
    startTransition(async () => {
      const result = await sendInvoiceAction({ invoiceId, to: to.trim() });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data?.duplicate
          ? `Already sent to ${result.data.to} — not sent twice`
          : `Invoice sent to ${result.data?.to}`,
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" className="h-9" onClick={() => setOpen(true)}>
        <Send className="size-4" />
        {lastSentAt ? "Send again" : "Send"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email this invoice</DialogTitle>
            <DialogDescription>
              The invoice goes out as a PDF attachment.
              {lastSentAt ? ` Last sent ${lastSentAt}.` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="send-to">To</Label>
            <Input
              id="send-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="customer@example.com"
            />
            <p className="text-xs text-muted-foreground">
              Sending the same invoice to the same address twice is a no-op, not
              a second email.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={send} disabled={pending || to.trim() === ""}>
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
