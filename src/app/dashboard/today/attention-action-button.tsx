"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type {
  AttentionAction,
  AttentionActionHandler,
} from "@/lib/attention-sources/types";

/**
 * The verb beside a row on What needs you.
 *
 * Sits OUTSIDE the row's link — a button inside an anchor is invalid HTML and
 * would navigate as well as act. On success the page refreshes, and because
 * every item is derived the row simply is not there any more; there is no
 * "done" state to paint. On refusal the server's own sentence is the toast,
 * and the row stays, because the obligation does.
 */
export function AttentionActionButton({
  handler,
  action,
}: {
  handler: AttentionActionHandler;
  action: AttentionAction;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await handler(action.args);
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success(action.done);
          router.refresh();
        })
      }
    >
      {pending ? "Working…" : action.label}
    </Button>
  );
}
