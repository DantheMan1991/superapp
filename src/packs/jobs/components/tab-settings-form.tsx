"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { setJobTabsAction } from "../tab-settings";
import { OPTIONAL_TABS, TAB_COPY, type JobTab } from "../tabs";

/**
 * WHICH PARTS OF A JOB THIS BUSINESS DOES.
 *
 * Ticked means the tab is there. Stored the other way round — as what is OFF
 * (`tabs.ts`) — so a tab added to the pack next year arrives switched ON for a
 * business that configured this today, rather than silently missing because
 * their stored list predates it.
 *
 * `inUse` is the tabs that already have work on them somewhere. Unticking one
 * is allowed — a business that has stopped doing something has stopped — but it
 * says so, because the tab will keep appearing on the jobs that have rows and
 * somebody needs to know that is deliberate rather than a bug.
 */
export function TabSettingsForm({
  tabsOff,
  inUse,
  canEdit,
}: {
  tabsOff: JobTab[];
  inUse: JobTab[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [off, setOff] = useState<Set<JobTab>>(new Set(tabsOff));
  const saved = new Set(tabsOff);
  const changed =
    off.size !== saved.size || [...off].some((tab) => !saved.has(tab));

  function toggle(tab: JobTab) {
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(tab)) next.delete(tab);
      else next.add(tab);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-divider">
        {OPTIONAL_TABS.map((tab) => {
          const on = !off.has(tab);
          const used = inUse.includes(tab);
          return (
            <li key={tab} className="flex items-start gap-3 py-3">
              <Checkbox
                id={`tab-${tab}`}
                checked={on}
                disabled={!canEdit || pending}
                onCheckedChange={() => toggle(tab)}
                className="mt-0.5"
              />
              <label htmlFor={`tab-${tab}`} className="min-w-0 cursor-pointer">
                <span className="text-sm font-medium">{TAB_COPY[tab].label}</span>
                <span className="block text-sm text-muted-foreground">
                  {TAB_COPY[tab].describes}
                </span>
                {!on && used && (
                  <span className="mt-1 block text-xs text-warning-foreground">
                    Some jobs already have work here. Those keep the tab — nothing
                    is hidden. New jobs will not show it.
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>

      {canEdit && (
        <div className="flex items-center gap-3">
          <Button
            disabled={pending || !changed}
            onClick={() =>
              startTransition(async () => {
                const result = await setJobTabsAction({ tabsOff: [...off] });
                if ("error" in result) {
                  toast.error(result.error);
                  return;
                }
                toast.success("Saved. The tabs on every job follow this now.");
                router.refresh();
              })
            }
          >
            {pending ? "Saving…" : "Save"}
          </Button>
          {changed && (
            <Button variant="ghost" disabled={pending} onClick={() => setOff(new Set(tabsOff))}>
              Undo
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
