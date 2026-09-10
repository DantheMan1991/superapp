"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  backfillPlatformRevenueAction,
  retrySkippedPostingsAction,
} from "./actions";

function said(counts: { posted: number; already: number; skipped: number }): string {
  const parts = [`${counts.posted} posted`];
  if (counts.already > 0) parts.push(`${counts.already} already there`);
  if (counts.skipped > 0) parts.push(`${counts.skipped} skipped`);
  return parts.join(", ");
}

/** The two verbs on the operator's Platform revenue card (back-office slice 5). */
export function PlatformRevenueButtons({ skipped }: { skipped: number }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {skipped > 0 && (
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await retrySkippedPostingsAction();
              if ("error" in res) toast.error(res.error);
              else toast.success(`Retried ${res.considered}: ${said(res)}`);
            })
          }
        >
          {pending ? "Working…" : `Retry ${skipped} skipped`}
        </Button>
      )}
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await backfillPlatformRevenueAction();
            if ("error" in res) toast.error(res.error);
            else toast.success(`Considered ${res.considered}: ${said(res)}`);
          })
        }
      >
        {pending ? "Working…" : "Post what Stripe holds"}
      </Button>
    </div>
  );
}
