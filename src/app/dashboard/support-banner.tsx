"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Eye } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { endSupportViewAction } from "@/app/admin/actions";

/**
 * The bar across every page of a support view (back-office slice 4): whose
 * workspace this is, why it was opened, how long is left, and the one thing
 * a viewer can do — end it. Nothing else on the page can be changed; every
 * server action refuses while the session is live, and the banner says so
 * before anyone finds out the hard way.
 */
export function SupportBanner({
  tenantId,
  tenantName,
  reason,
  expiresAt,
}: {
  tenantId: string;
  tenantName: string;
  reason: string;
  /** ISO string — a Date does not cross the server/client boundary. */
  expiresAt: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [minutesLeft, setMinutesLeft] = useState<number | null>(null);

  useEffect(() => {
    const tick = () =>
      setMinutesLeft(
        Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000)),
      );
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [expiresAt]);

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Eye className="size-4 shrink-0" />
        <span>
          <span className="font-medium">Support view of {tenantName}</span>
          {" — read-only. "}
          {reason}
          {minutesLeft !== null && (
            <span className="text-muted-foreground">
              {" · "}
              {minutesLeft === 0 ? "expiring now" : `${minutesLeft} min left`}
            </span>
          )}
        </span>
      </div>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await endSupportViewAction();
            if ("error" in res) {
              toast.error(res.error);
              return;
            }
            router.push(`/admin/tenants/${tenantId}`);
          })
        }
      >
        {pending ? "Ending…" : "End support view"}
      </Button>
    </div>
  );
}
