"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startPaymentOnboardingAction } from "./actions";

/**
 * Sends the owner to Stripe's own onboarding form. **The card details, the tax
 * ID, the bank account and the ID document are all collected on Stripe's pages
 * — none of them ever reach this app.**
 */
export function ConnectButton({
  entityId,
  label,
  variant = "default",
}: {
  entityId: string | null;
  label: string;
  variant?: "default" | "secondary";
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant={variant}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await startPaymentOnboardingAction({ entityId });
          if (res.error) toast.error(res.error);
          else if (res.url) window.location.assign(res.url);
        })
      }
    >
      {pending ? "Opening Stripe…" : label}
    </Button>
  );
}

/**
 * Stripe reviews an account after the form is submitted, and there is nothing
 * to press while it does. This re-renders the page, which reconciles from the
 * Stripe API on load — so the button's honest promise is "ask Stripe again",
 * not "make it finish".
 */
export function RefreshStatusButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? "Checking…" : "Check with Stripe again"}
    </Button>
  );
}
