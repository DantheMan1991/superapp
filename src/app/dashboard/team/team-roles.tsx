"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setMemberAccountantAction } from "./actions";

export function AccountantToggle({
  membershipId,
  accountant,
}: {
  membershipId: string;
  accountant: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Switch
      checked={accountant}
      disabled={pending}
      onCheckedChange={(next) =>
        startTransition(async () => {
          const res = await setMemberAccountantAction({
            membershipId,
            accountant: next,
          });
          if ("error" in res) {
            toast.error(res.error);
            return;
          }
          toast.success(
            next
              ? "Marked as accountant — read and review access only."
              : "Accountant access removed.",
          );
          router.refresh();
        })
      }
      aria-label="Accountant access"
    />
  );
}
