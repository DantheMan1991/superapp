"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { approveBillAction } from "@/modules/accounting/payables/actions";

/**
 * Approve a bill from its row on the Bills list.
 *
 * One tap and no dialog, which is exactly what the bill's own page does —
 * approval was never confirmed there either, because the owner has already
 * read the bill. What the list does NOT know is whether every line is coded,
 * so an uncoded bill answers with the server's `Every line needs an account
 * before approval.` and the owner opens it, which is what they would have
 * done anyway.
 */
export function ApproveBillButton({
  billId,
  version,
  className,
}: {
  billId: string;
  version: number;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      className={className}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await approveBillAction({ billId, expectedVersion: version });
          if ("error" in result && result.error) toast.error(result.error);
          else {
            toast.success("Approved and posted.");
            router.refresh();
          }
        })
      }
    >
      {pending ? "Approving…" : "Approve"}
    </Button>
  );
}
