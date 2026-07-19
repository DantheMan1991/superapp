"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createCheckoutSession, createPortalSession } from "./actions";
import type { PlanKey } from "@/lib/stripe";

export function SubscribeButton({
  plan,
  label,
  includeOnboardingFee,
}: {
  plan: PlanKey;
  label: string;
  includeOnboardingFee: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      className="w-full"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await createCheckoutSession({
            plan,
            includeOnboardingFee,
          });
          if (res.error) toast.error(res.error);
          else if (res.url) window.location.assign(res.url);
        })
      }
    >
      {pending ? "Redirecting…" : label}
    </Button>
  );
}

export function ManageBillingButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await createPortalSession();
          if (res.error) toast.error(res.error);
          else if (res.url) window.location.assign(res.url);
        })
      }
    >
      {pending ? "Opening…" : "Manage in Stripe portal"}
    </Button>
  );
}
