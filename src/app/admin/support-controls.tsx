"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openSupportViewAction } from "./actions";

/** Open a support view of this workspace: a reason, then the dashboard. */
export function SupportViewForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why — e.g. “can’t find the March invoice”"
        maxLength={500}
      />
      <Button
        size="sm"
        disabled={pending || reason.trim().length < 3}
        onClick={() =>
          startTransition(async () => {
            const res = await openSupportViewAction({ tenantId, reason });
            if (res && "error" in res) {
              toast.error(res.error);
              return;
            }
            router.push("/dashboard");
          })
        }
      >
        {pending ? "Opening…" : "Look at it as they see it"}
      </Button>
    </div>
  );
}
