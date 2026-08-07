"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COMMON_TIMEZONES } from "@/lib/timezone";
import { setTenantTimezoneAction } from "./actions";

export function TimezoneForm({ current }: { current: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [timezone, setTimezone] = useState(current);

  // A tenant may already hold a zone that is not in the curated list (set
  // before the list existed, or by a future admin tool). Showing the list
  // alone would silently present a DIFFERENT zone as if it were the current
  // one, and the first save would move the business's day without anyone
  // meaning to. So the current value always has an entry.
  const options = COMMON_TIMEZONES.some((t) => t.value === current)
    ? COMMON_TIMEZONES
    : [{ value: current, label: current }, ...COMMON_TIMEZONES];

  function onSubmit() {
    startTransition(async () => {
      const result = await setTenantTimezoneAction({ timezone });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Timezone updated");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-64 flex-1 space-y-2">
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button onClick={onSubmit} disabled={pending || timezone === current}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
