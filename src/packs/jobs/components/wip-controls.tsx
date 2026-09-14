"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { postWipAction, saveWipEstimateAction, unpostWipAction } from "../actions";

/**
 * The controls on the work-in-progress schedule: which company and which
 * date, the one box a person types into, and the two buttons that move the
 * ledger. Small on purpose — the schedule itself is a server-rendered table,
 * and everything here calls one action and refreshes.
 */

const BASE = "/dashboard/m/jobs/wip";

export function WipPeriodPicker({
  entities,
  entityId,
  periodEnd,
}: {
  entities: Array<{ id: string; name: string }>;
  entityId: string;
  periodEnd: string;
}) {
  const router = useRouter();
  const [company, setCompany] = useState(entityId);
  const [through, setThrough] = useState(periodEnd);

  function show() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) {
      toast.error("Pick a date for the period end.");
      return;
    }
    const params = new URLSearchParams({ company, through });
    router.push(`${BASE}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* A single-company business is never asked which company. */}
      {entities.length > 1 && (
        <div className="min-w-[14rem] space-y-1">
          <Label htmlFor="wip-company">Company</Label>
          <Select value={company} onValueChange={setCompany}>
            <SelectTrigger id="wip-company" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {entities.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="wip-through">As of</Label>
        <Input
          id="wip-through"
          type="date"
          value={through}
          onChange={(e) => setThrough(e.target.value)}
          className="w-44"
        />
      </div>
      <Button variant="outline" onClick={show}>
        Show
      </Button>
    </div>
  );
}

/**
 * The estimate box: what this job is now expected to cost in total. Saves on
 * Enter or when the box loses focus; blank puts the budget back.
 */
export function WipEstimateCell({
  entityId,
  periodEnd,
  projectId,
  estimate,
  budgetLabel,
  disabled,
}: {
  entityId: string;
  periodEnd: string;
  projectId: string;
  /** The typed estimate, formatted, or "" when the budget stands. */
  estimate: string;
  /** What the box falls back to, as its placeholder. */
  budgetLabel: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(estimate);
  const [saved, setSaved] = useState(estimate);

  function save() {
    if (value.trim() === saved.trim()) return;
    startTransition(async () => {
      const result = await saveWipEstimateAction({
        entityId,
        periodEnd,
        projectId,
        estimate: value.trim(),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setSaved(value.trim());
      router.refresh();
    });
  }

  return (
    <Input
      aria-label="Estimated total cost"
      inputMode="decimal"
      value={value}
      placeholder={budgetLabel}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      disabled={disabled || pending}
      className="h-8 w-32 text-right tabular-nums"
    />
  );
}

export function PostWipButton({
  entityId,
  periodEnd,
  version,
  confirmText,
  disabled,
}: {
  entityId: string;
  periodEnd: string;
  version?: number;
  /** What the person is agreeing to, in the words the schedule showed. */
  confirmText: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function post() {
    if (!window.confirm(confirmText)) return;
    startTransition(async () => {
      const result = await postWipAction({ entityId, periodEnd, version });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Work in progress through ${periodEnd} posted.`);
      router.refresh();
    });
  }

  return (
    <Button onClick={post} disabled={disabled || pending}>
      Post the adjustment
    </Button>
  );
}

export function UnpostWipButton({ periodId, version }: { periodId: string; version: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function unpost() {
    if (
      !window.confirm(
        "Unpost this period? Both entries are voided and the figures go back to live. The estimates you typed are kept.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await unpostWipAction({ periodId, version });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Period unposted.");
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={unpost} disabled={pending}>
      Unpost
    </Button>
  );
}
