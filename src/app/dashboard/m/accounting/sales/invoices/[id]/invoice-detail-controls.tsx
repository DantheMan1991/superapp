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
  deleteInvoiceDraftAction,
  issueAndSendInvoiceAction,
  issueInvoiceAction,
  sendInvoiceAction,
  unapplyInvoicePaymentAction,
  voidInvoiceAction,
} from "@/modules/accounting/invoicing/actions";
import type { DepositOption } from "@/modules/accounting/lib/deposit-options";
import { useConfirm } from "@/components/app/use-confirm";
import { RecordPaymentButton } from "../record-payment-dialog";

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
  customerEmail,
}: {
  invoice: InvoiceRef;
  /**
   * Every active register plus Undeposited Funds, from `depositOptionsFor`.
   * `otherCompany` is set only when the account belongs to somebody else —
   * depositing into one is an INTERCOMPANY payment (ADR 0010, the mirror of
   * the bill case), recorded as a linked pair rather than refused, and the
   * dialog says so before it happens.
   */
  depositOptions: DepositOption[];
  today: string;
  canAct: boolean;
  /** The tenant's own list. Codes are what get stored on the payment. */
  paymentMethods: Array<{ code: string; name: string }>;
  /** The customer's stored address; prefills the one-step dialog's To. */
  customerEmail: string;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [pending, startTransition] = useTransition();
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueTo, setIssueTo] = useState(customerEmail);

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

  /**
   * The one-step version of Issue then Send. The page reloads on failure as
   * well as success: a send that failed AFTER the issue succeeded has still
   * changed the invoice, and the error message says so.
   */
  function issueAndSend() {
    startTransition(async () => {
      const result = await issueAndSendInvoiceAction({
        invoiceId: invoice.id,
        expectedVersion: invoice.version,
        to: issueTo.trim(),
      });
      setIssueOpen(false);
      if ("error" in result) toast.error(result.error);
      else {
        toast.success(
          result.data?.duplicate
            ? `Invoice issued — already sent to ${result.data.to}`
            : `Invoice issued and sent to ${result.data?.to}`,
        );
      }
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
          <Button size="sm" onClick={() => setIssueOpen(true)} disabled={pending}>
            <Send className="mr-1.5 size-3.5" />
            Issue and send
          </Button>
          <Button size="sm" variant="outline" onClick={() => run("issue")} disabled={pending}>
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
        <RecordPaymentButton
          variant="default"
          invoice={{
            id: invoice.id,
            version: invoice.version,
            number: invoice.number,
            balanceCents: invoice.balanceCents,
          }}
          depositOptions={depositOptions}
          today={today}
          paymentMethods={paymentMethods}
        />
      )}
      {invoice.status === "issued" && (
        <Button size="sm" variant="outline" onClick={() => run("void")} disabled={pending}>
          Void
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={() => window.print()}>
        <Printer className="mr-1.5 size-3.5" /> Print
      </Button>

      <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue {invoice.number} and email it?</DialogTitle>
            <DialogDescription>
              This posts it to the books, freezes its lines and starts the clock
              on getting paid — then the invoice goes to the customer as a PDF
              attachment.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="issue-send-to">To</Label>
            <Input
              id="issue-send-to"
              type="email"
              value={issueTo}
              onChange={(e) => setIssueTo(e.target.value)}
              placeholder="customer@example.com"
            />
            <p className="text-xs text-muted-foreground">
              From your business&apos;s sending address, with the invoice
              attached.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={issueAndSend} disabled={pending || issueTo.trim() === ""}>
              {pending ? "Issuing…" : "Issue and send"}
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
 * clicking it. A draft's one-step `Issue and send` lives in `InvoiceActions`.
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
