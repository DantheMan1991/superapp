"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { setDigestPreferenceAction } from "./actions";

/**
 * Lives on the page the digest links to, rather than in a settings screen.
 *
 * The design's rule is that a digest which cannot be turned off gets filtered
 * instead — and a filtered email is worse than an unsubscribed one, because the
 * person stops reading it and we stop knowing they stopped. Putting the switch
 * where somebody lands when they follow the mail is what makes "off" a real
 * option rather than a technically-present one.
 */
export function DigestToggle({ daily }: { daily: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [on, setOn] = useState(daily);

  function onChange(next: boolean) {
    // Optimistic: the switch is the whole interaction, so waiting a round trip
    // to move it reads as broken. Reverted below if the write fails.
    setOn(next);
    startTransition(async () => {
      const result = await setDigestPreferenceAction({ daily: next });
      if ("error" in result) {
        setOn(!next);
        toast.error(result.error);
        return;
      }
      toast.success(next ? "Daily email on" : "Daily email off");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
      <Switch
        id="digest-daily"
        checked={on}
        onCheckedChange={onChange}
        disabled={pending}
      />
      <Label htmlFor="digest-daily" className="text-sm font-normal">
        Email me this each morning
      </Label>
    </div>
  );
}
