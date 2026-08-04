import {
  CalendarCheck,
  CircleCheck,
  MessageSquare,
  Phone,
  Users,
} from "lucide-react";
import type { CrmActivity, CrmTask } from "@/db/schema";
import type { TimelineItem, TimelineItemKind } from "../core/timeline";
import { DeleteActivityButton, TaskToggle, DueBadge } from "./timeline-controls";

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
}: {
  items: TimelineItem[];
  /** For the delete control — only activities carry one. */
  activities: CrmActivity[];
  /** For the tick control — the stream carries no version. */
  tasks: CrmTask[];
  partyId: string;
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

            {task && !task.completedAt && <DueBadge dueOn={task.dueOn} />}
            {task && <TaskToggle task={task} />}
            {activity && (
              <DeleteActivityButton activityId={activity.id} partyId={partyId} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
