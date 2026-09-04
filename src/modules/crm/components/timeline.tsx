import {
  CalendarCheck,
  CircleCheck,
  MessageSquare,
  Phone,
  Users,
} from "lucide-react";
import type { CrmActivity } from "@/db/schema";
import type { GroupableTask } from "../core/timeline";
import type { TimelineItem, TimelineItemKind } from "../core/timeline";
import { DeleteActivityButton } from "./timeline-controls";
import { WorkItemRow } from "@/components/app/work-item-row";

/**
 * The timeline, rendered.
 *
 * A SERVER COMPONENT with no `"use client"`, so the interactive bits are
 * imported as COMPONENTS from the controls file — never as functions. That
 * distinction took the deal page down once; see conventions §8.
 *
 * It takes already-merged `TimelineItem`s rather than the source rows, so slice
 * 5's mail threads need nothing here beyond producing items.
 */

const ICONS: Record<TimelineItemKind, typeof MessageSquare> = {
  note: MessageSquare,
  call: Phone,
  meeting: Users,
  task: CalendarCheck,
  task_done: CircleCheck,
};

function dayLabel(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function Timeline({
  items,
  activities,
  tasks,
  partyId,
  members = [],
  revalidate,
  canWrite = true,
}: {
  items: TimelineItem[];
  /** For the delete control — only activities carry one. */
  activities: CrmActivity[];
  /** For the work controls — the stream carries no version. */
  tasks: GroupableTask[];
  partyId: string;
  /**
   * Who work can be given to. Passed through to the shared row so a follow-up
   * can be REASSIGNED here rather than in Work — the point of adopting it.
   */
  members?: Array<{ clerkUserId: string; label: string }>;
  /** The route the shared verbs refresh after a change. */
  revalidate?: string;
  /**
   * `roleMayWrite(role)`. The timeline itself is a read and stays whole; what
   * goes is the follow-up row's Done / reassign / re-due and the activity's
   * Delete.
   *
   * **THE FOLLOW-UP ROW IS THE ONE PLACE THIS SCREEN IS STRICTER THAN ITS
   * SERVER.** `WorkItemRow` calls Layer 0's `setEntityWork*Action`
   * (`src/lib/work/actions.ts`), which applies no role rule at all — so an
   * accountant can in fact work a CRM follow-up today. That is a gap in the
   * shared seam rather than in this module, and closing it needs the owning
   * feature's rule (CRM says no, a pack says yes), which is a design question
   * and not this PR's. Hidden here meanwhile, because a banner saying nothing
   * can be changed above a control that changes something is worse than a
   * control an accountant did not know they had.
   */
  canWrite?: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-md border px-4 py-8 text-center text-sm text-muted-foreground">
        Nothing logged yet.
      </p>
    );
  }

  const activityById = new Map(activities.map((a) => [`activity:${a.id}`, a]));
  const taskById = new Map(tasks.map((t) => [`task:${t.id}`, t]));

  return (
    <ul className="divide-y rounded-md border">
      {items.map((item) => {
        const Icon = ICONS[item.kind];
        const activity = activityById.get(item.id);
        const task = taskById.get(item.id);

        return (
          <li key={item.id} className="flex items-start gap-3 px-4 py-3">
            <Icon
              className={`mt-0.5 size-4 shrink-0 ${
                item.kind === "task_done"
                  ? "text-muted-foreground"
                  : "text-muted-foreground"
              }`}
            />
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm ${
                  // A completed follow-up reads as done rather than as another
                  // thing on the list.
                  item.kind === "task_done" ? "text-muted-foreground" : "font-medium"
                }`}
              >
                {item.title}
              </p>
              {item.detail && (
                <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {dayLabel(item.at)}
                {item.kind === "task" && " · due"}
                {item.kind === "task_done" && " · done"}
              </p>
            </div>

            {task && canWrite && (
              // THE SHARED ROW, not a CRM-only control. Done, reopen,
              // reassign and re-due all happen here, in the timeline, so a
              // follow-up raised on a record can be worked without leaving
              // the record. See src/components/app/work-item-row.tsx.
              <WorkItemRow
                item={{
                  id: task.id,
                  title: task.title,
                  dueOn: task.dueOn,
                  assigneeClerkUserId: task.assigneeClerkUserId,
                  completedAt: task.completedAt,
                  version: task.version,
                }}
                members={members}
                revalidate={revalidate}
              />
            )}
            {activity && canWrite && (
              <DeleteActivityButton activityId={activity.id} partyId={partyId} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
