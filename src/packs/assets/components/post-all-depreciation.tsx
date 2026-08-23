"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { postAllDepreciationAction } from "../actions";

/**
 * Month-end, for the whole register.
 *
 * Deliberately shows what is waiting BEFORE it is pressed — how many assets and
 * how much — because "post depreciation" with no number attached asks somebody
 * to authorise a write to the books sight unseen.
 */
export function PostAllDepreciation({
  through,
  assetsDue,
  totalLabel,
}: {
  through: string;
  assetsDue: number;
  totalLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (assetsDue === 0) return null;

  function post() {
    startTransition(async () => {
      const result = await postAllDepreciationAction({ through });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const caught = result.caughtUpCount ?? 0;
      toast.success(
        `Posted ${result.periodsPosted} ${result.periodsPosted === 1 ? "month" : "months"} across ${result.assetsPosted} ${result.assetsPosted === 1 ? "asset" : "assets"}` +
          (caught > 0
            ? ` — ${caught} pre-close ${caught === 1 ? "month" : "months"} rolled into catch-up entries`
            : ""),
      );
      router.refresh();
    });
  }

  return (
    <Button variant="outline" onClick={post} disabled={pending}>
      {pending
        ? "Posting…"
        : `Post depreciation (${assetsDue} ${assetsDue === 1 ? "asset" : "assets"}, ${totalLabel})`}
    </Button>
  );
}
