"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellOff, BellRing } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setInvoiceRemindersMutedAction } from "@/modules/accounting/invoicing/actions";
import { describeOffset } from "@/modules/accounting/invoicing/reminder-schedule";

export interface ReminderHistoryRow {
  offset: number;
  toAddress: string;
  status: string;
  sentOn: string;
}

/**
 * What automatic chasing has done to this invoice, and the off switch.
 *
 * The history is the DELIVERY record read back from the send log, not a tick
 * that says "sent" — so a bounce reads as a bounce, which is the whole reason
 * anybody opens this panel.
 */
export function InvoiceRemindersPanel({
  invoiceId,
  version,
  muted,
  customerMuted,
  enabled,
  nextLabel,
  history,
  canAct,
}: {
  invoiceId: string;
  version: number;
  muted: boolean;
  customerMuted: boolean;
  enabled: boolean;
  nextLabel: string | null;
  history: ReminderHistoryRow[];
  canAct: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const result = await setInvoiceRemindersMutedAction({
        invoiceId,
        expectedVersion: version,
        muted: !muted,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(muted ? "Reminders resumed" : "Reminders muted");
      router.refresh();
    });
  }

  // Nothing has happened and nothing will — don't spend a panel on it.
  if (!enabled && history.length === 0 && !muted) return null;

  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-elevation-1">
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            Reminders
            {muted && <Badge variant="outline">muted</Badge>}
          </p>
          <p className="text-xs text-muted-foreground">
            {muted
              ? "This invoice is not chased automatically."
              : customerMuted
                ? "This customer is never chased automatically."
                : !enabled
                  ? "Automatic reminders are off for the business."
                  : nextLabel
                    ? `Next reminder ${nextLabel}.`
                    : "The schedule has finished for this invoice."}
          </p>
        </div>
        {canAct && (
          <Button
            variant="outline"
            size="sm"
            onClick={toggle}
            disabled={pending}
          >
            {muted ? (
              <>
                <BellRing className="size-4" />
                Resume
              </>
            ) : (
              <>
                <BellOff className="size-4" />
                Mute
              </>
            )}
          </Button>
        )}
      </div>

      {history.length > 0 && (
        <ul className="divide-y divide-divider border-t border-divider">
          {history.map((row) => (
            <li
              key={`${row.offset}-${row.sentOn}`}
              className="flex items-center justify-between gap-3 px-5 py-2.5 text-xs"
            >
              <span className="text-muted-foreground">
                {describeOffset(row.offset)} · {row.toAddress}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono tabular-nums text-subtle-foreground">
                  {row.sentOn}
                </span>
                <Badge
                  variant={
                    row.status === "bounced" || row.status === "failed"
                      ? "destructive"
                      : "outline"
                  }
                >
                  {row.status}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
