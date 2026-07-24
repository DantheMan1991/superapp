"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { HourBlockKey } from "@/lib/stripe";
import { createHourBlockCheckout } from "./actions";

export function BuyHourBlockButton({
  block,
  emphasized,
}: {
  block: HourBlockKey;
  emphasized: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant={emphasized ? "default" : "secondary"}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await createHourBlockCheckout({ block });
          if (res.error) toast.error(res.error);
          else if (res.url) window.location.assign(res.url);
        })
      }
    >
      {pending ? "Redirecting…" : "Buy block"}
    </Button>
  );
}
