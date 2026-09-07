"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/app/use-confirm";
import { voidDepositAction } from "@/modules/accounting/banking/deposit-actions";

export function VoidDepositButton({
  depositId,
  version,
}: {
  depositId: string;
  version: number;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [pending, startTransition] = useTransition();

  async function voidDeposit() {
    const asked = await confirm({
      title: "Void this deposit?",
      description:
        "Its entry is voided and the payments go back to waiting in Undeposited Funds, so they can be deposited again. A deposit whose entry has been reconciled cannot be voided.",
      confirmLabel: "Void deposit",
      destructive: true,
    });
    if (!asked) return;
    startTransition(async () => {
      const result = await voidDepositAction({ depositId, expectedVersion: version });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Deposit voided — the payments are back in Undeposited Funds");
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={voidDeposit} disabled={pending}>
        {pending ? "Voiding…" : "Void"}
      </Button>
      {confirmDialog}
    </>
  );
}
