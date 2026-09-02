"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { disconnectSquareAction } from "./actions";

/**
 * Withdraw Yosher's access to a company's Square account. Square first, then
 * our row — the action calls Square's revoke endpoint and only marks the
 * connection closed once Square has confirmed.
 *
 * A `confirm()` rather than a dialog, as `reader-controls.tsx` does for
 * retiring a reader: this is an owner-only button on a settings page, and the
 * consequence ("the till cannot take a card") is the whole of what needs saying.
 */
export function SquareDisconnectButton({
  entityId,
  businessName,
}: {
  entityId: string | null;
  businessName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (
          !window.confirm(
            `Disconnect Square for ${businessName}? The till will not be able to take a card until it is connected again. Nothing changes in your Square account itself.`,
          )
        ) {
          return;
        }
        startTransition(async () => {
          const res = await disconnectSquareAction({ entityId });
          if (res.error) toast.error(res.error);
          else {
            toast.success("Square disconnected.");
            router.refresh();
          }
        });
      }}
    >
      {pending ? "Disconnecting…" : "Disconnect Square"}
    </Button>
  );
}

/**
 * Re-renders the page, which reconciles from Square on load — so the button's
 * honest promise is "ask Square again", not "make it work".
 */
export function SquareRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? "Checking…" : "Check with Square again"}
    </Button>
  );
}
