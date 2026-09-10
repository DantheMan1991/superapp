"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/panel";
import { WorkItemRow, type WorkRowView } from "@/components/app/work-item-row";
import { startOnboardingAction } from "../actions";

/**
 * What starting this engagement sets in motion.
 *
 * THE ROWS ARE THE SHARED ONES. A step raised here is an ordinary work item —
 * same component, same verbs, same rules as a CRM follow-up or a tractor's
 * service — so it is ticked off wherever somebody meets it, and it reaches the
 * daily digest and *What needs you* without this pack knowing either exists.
 * A checklist of its own would have been a fourth inconsistent work surface.
 */
export function OnboardingPanel({
  engagementId,
  work,
  missingCount,
  noListConfigured,
  members,
  revalidate,
  canStart,
}: {
  engagementId: string;
  work: WorkRowView[];
  /** How many steps the button would add — named before it is pressed. */
  missingCount: number;
  /** The installed profile contributes no list at all. */
  noListConfigured: boolean;
  members: Array<{ clerkUserId: string; label: string }>;
  revalidate: string;
  canStart: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Nothing raised, nothing to raise, and no list to explain: say nothing
  // rather than showing an empty panel about a feature this business has not
  // been given.
  if (work.length === 0 && missingCount === 0 && noListConfigured) return null;

  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading font-medium tracking-heading">Onboarding</h2>
          <p className="text-sm text-muted-foreground">
            {noListConfigured
              ? "No list is set up for this kind of work yet."
              : missingCount > 0
                ? work.length === 0
                  ? "The steps your profile says a new one starts with."
                  : "Your profile has steps that are not on here yet."
                : "Everything your profile lists has been raised."}
          </p>
        </div>
        {canStart && missingCount > 0 && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await startOnboardingAction({ engagementId });
                if ("error" in result) {
                  toast.error(result.error);
                  return;
                }
                toast.success(
                  result.raised === 1 ? "1 step raised" : `${result.raised} steps raised`,
                );
                router.refresh();
              })
            }
          >
            {pending
              ? "Raising…"
              : work.length === 0
                ? `Start onboarding (${missingCount} step${missingCount === 1 ? "" : "s"})`
                : `Add ${missingCount} missing step${missingCount === 1 ? "" : "s"}`}
          </Button>
        )}
      </div>

      {work.length > 0 && (
        <div className="mt-3 space-y-2">
          {work.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center gap-2">
              <span className="text-sm">{item.title}</span>
              <WorkItemRow item={item} members={members} revalidate={revalidate} />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
