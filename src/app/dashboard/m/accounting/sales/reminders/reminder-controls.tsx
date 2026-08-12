"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateReminderSettingsAction } from "@/modules/accounting/invoicing/actions";
import {
  describeOffset,
  MAX_OFFSET,
  MAX_OFFSETS,
  MIN_OFFSET,
} from "@/modules/accounting/invoicing/reminder-schedule";

/**
 * The whole reminder schedule on one screen: the switch, and the list.
 *
 * Both are saved by the same action, because "on" and "when" are one decision
 * — a switch that could be turned on while the schedule was still empty would
 * be a control that says on and does nothing.
 */
export function ReminderSettingsForm({
  initialEnabled,
  initialOffsets,
}: {
  initialEnabled: boolean;
  initialOffsets: number[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [offsets, setOffsets] = useState<number[]>(initialOffsets);
  const [when, setWhen] = useState("after");
  const [days, setDays] = useState("7");

  const dirty =
    enabled !== initialEnabled ||
    offsets.length !== initialOffsets.length ||
    offsets.some((o, i) => o !== initialOffsets[i]);

  function addOffset() {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 0) {
      toast.error("Enter a whole number of days");
      return;
    }
    const offset = when === "before" ? -n : when === "on" ? 0 : n;
    if (offset < MIN_OFFSET || offset > MAX_OFFSET) {
      toast.error(`Between ${MIN_OFFSET} and ${MAX_OFFSET} days of the due date`);
      return;
    }
    if (offsets.includes(offset)) {
      toast.error("That reminder is already in the schedule");
      return;
    }
    if (offsets.length >= MAX_OFFSETS) {
      toast.error(`${MAX_OFFSETS} reminders is the most one invoice may send`);
      return;
    }
    setOffsets([...offsets, offset].sort((a, b) => a - b));
  }

  function save() {
    startTransition(async () => {
      const result = await updateReminderSettingsAction({ enabled, offsets });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(enabled ? "Reminders are on" : "Reminders are off");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 p-5">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-1">
          <Label htmlFor="reminders-enabled" className="text-sm font-medium">
            Send reminders automatically
          </Label>
          <p className="max-w-prose text-xs text-muted-foreground">
            Emails your customer a copy of the invoice on the days below. Nothing
            is sent while this is off, and a paid, voided or muted invoice is
            never chased.
          </p>
        </div>
        <Switch
          id="reminders-enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={pending}
        />
      </div>

      <div className="space-y-3">
        <Label className="text-sm font-medium">Schedule</Label>
        {offsets.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No reminders yet — add one below.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {offsets.map((offset) => (
              <li
                key={offset}
                className="flex items-center gap-1.5 rounded-full bg-module-accent/10 py-1 pl-3 pr-1.5 text-xs font-medium text-module-accent"
              >
                {describeOffset(offset)}
                <button
                  type="button"
                  onClick={() => setOffsets(offsets.filter((o) => o !== offset))}
                  disabled={pending}
                  className="rounded-full p-0.5 transition-colors hover:bg-module-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-module-accent"
                  aria-label={`Remove reminder ${describeOffset(offset)}`}
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-2">
          {when !== "on" && (
            <div className="space-y-1">
              <Label htmlFor="reminder-days" className="text-xs">
                Days
              </Label>
              <Input
                id="reminder-days"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                inputMode="numeric"
                className="w-20"
                disabled={pending}
              />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="reminder-when" className="text-xs">
              When
            </Label>
            <Select value={when} onValueChange={setWhen} disabled={pending}>
              <SelectTrigger id="reminder-when" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="before">before the due date</SelectItem>
                <SelectItem value="on">on the due date</SelectItem>
                <SelectItem value="after">after the due date</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={addOffset}
            disabled={pending}
          >
            <Plus className="size-4" />
            Add
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-divider pt-4">
        <Button onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {dirty && (
          <p className="text-xs text-muted-foreground">Unsaved changes</p>
        )}
      </div>
    </div>
  );
}
