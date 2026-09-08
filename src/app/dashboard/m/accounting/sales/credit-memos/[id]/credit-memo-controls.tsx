"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/app/use-confirm";
import { voidCreditMemoAction } from "@/modules/accounting/invoicing/actions";

export function VoidCreditMemoButton({
  creditMemoId,
  version,
  invoiceNumber,
}: {
  creditMemoId: string;
  version: number;
  invoiceNumber: string;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [pending, startTransition] = useTransition();

  async function voidMemo() {
    const asked = await confirm({
      title: "Void this credit memo?",
      description: `Its entry is voided and ${invoiceNumber} goes back to owing the credited amount. A credit memo whose entry sits in a closed period cannot be voided.`,
      confirmLabel: "Void credit memo",
      destructive: true,
    });
    if (!asked) return;
    startTransition(async () => {
      const result = await voidCreditMemoAction({ creditMemoId, expectedVersion: version });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Credit memo voided — ${invoiceNumber} owes the amount again`);
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={voidMemo} disabled={pending}>
        {pending ? "Voiding…" : "Void"}
      </Button>
      {confirmDialog}
    </>
  );
}
