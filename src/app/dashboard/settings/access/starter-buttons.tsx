"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createStarterLevelAction } from "./actions";

/**
 * SOMEWHERE TO START (ADR 0097).
 *
 * QuickBooks hands most businesses a fixed user type rather than a grid of tick
 * boxes, and free-form permissions are a top-tier feature there because
 * free-form permissions are work — work nobody does is a feature nobody has.
 *
 * These make one ordinary level, which the owner then edits like any other.
 * Shown only while the name is free, so the row empties itself as they get
 * used rather than offering to make a second "Bookkeeping".
 */
export function StarterButtons({
  starters,
}: {
  starters: { id: string; name: string; notes: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (starters.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Or start from one of these and change it to suit:
      </p>
      <div className="flex flex-wrap gap-2">
        {starters.map((s) => (
          <Button
            key={s.id}
            variant="outline"
            size="sm"
            disabled={pending}
            title={s.notes}
            onClick={() =>
              startTransition(async () => {
                const res = await createStarterLevelAction({ starterId: s.id });
                if ("error" in res) {
                  toast.error(res.error);
                  return;
                }
                toast.success(`${s.name} added — edit it to suit`);
                router.refresh();
              })
            }
          >
            {s.name}
          </Button>
        ))}
      </div>
    </div>
  );
}
