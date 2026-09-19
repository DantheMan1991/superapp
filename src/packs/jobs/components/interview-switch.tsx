"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { setEstimateInterviewAction } from "../interview-settings";

/**
 * WHETHER THIS BUSINESS WALKS ITS ESTIMATES (X1, ADR 0098).
 *
 * Only drawn for a business that has been granted the layer, so the copy can
 * say what it does rather than what it would do. Switching it off leaves
 * every estimate exactly as it is — that is the whole claim of a layer, and
 * saying so here is what makes it safe to try.
 */
export function InterviewSwitch({ on, canEdit }: { on: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(on);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor="interview-switch" className="text-sm font-medium">
            Walk an estimate
          </Label>
          <p className="mt-1 text-sm text-muted-foreground">
            Price a job by going through it step by step and answering
            questions, instead of typing the lines yourself. The estimate you
            end up with is an ordinary estimate — turning this off leaves every
            one of them untouched.
          </p>
        </div>
        <Switch
          id="interview-switch"
          checked={checked}
          disabled={!canEdit || pending}
          onCheckedChange={(next) => {
            setChecked(next);
            startTransition(async () => {
              const result = await setEstimateInterviewAction({ on: next });
              if ("error" in result) {
                setChecked(!next);
                toast.error(result.error);
                return;
              }
              toast.success(next ? "Turned on" : "Turned off");
              router.refresh();
            });
          }}
        />
      </div>
      {checked && (
        <p className="text-sm text-muted-foreground">
          <Link
            href="/dashboard/m/jobs/estimate-outlines"
            className="underline underline-offset-4"
          >
            Estimate outlines
          </Link>{" "}
          is where you set out the steps and the questions.
        </p>
      )}
    </div>
  );
}
