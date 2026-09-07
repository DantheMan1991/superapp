"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  approveBillAction,
  returnBillToDraftAction,
  submitBillForApprovalAction,
  suggestBillCodingAction,
  unapplyBillPaymentAction,
  voidBillAction,
} from "@/modules/accounting/payables/actions";
import { useConfirm } from "@/components/app/use-confirm";

// Record payment lives in ../record-bill-payment-dialog.tsx now, shared with
// the Bills list, which offers the same dialog on a row.

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
  const { confirm, confirmDialog } = useConfirm();
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

  /**
   * A real dialog, not `window.confirm()`. The 2026-08-12 sweep that made
   * every confirmation a dialog missed this page; inside the app shell a
   * native confirm is an OS alert with none of the product's words on it.
   */
  async function voidBill() {
    const asked = await confirm({
      title: "Void this bill?",
      description:
        "Its ledger entry is voided too. A bank transaction matched to it goes back to review.",
      confirmLabel: "Void bill",
      destructive: true,
    });
    if (asked) run(() => voidBillAction(ref), "Bill voided.");
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
        <Button size="sm" variant="outline" disabled={pending} onClick={voidBill}>
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
      {confirmDialog}
    </div>
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
  const { confirm, confirmDialog } = useConfirm();
  const [pending, startTransition] = useTransition();

  async function unapply() {
    const asked = await confirm({
      title: "Unapply this payment?",
      description:
        "Its ledger entry is voided — both sides if another company paid — and the bill goes back to owing this much. A reconciled payment cannot be unapplied at all.",
      confirmLabel: "Unapply payment",
      destructive: true,
    });
    if (!asked) return;
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
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        title="Unapply (voids the payment entry)"
        onClick={unapply}
      >
        <Undo2 className="h-3.5 w-3.5" />
      </Button>
      {confirmDialog}
    </>
  );
}
