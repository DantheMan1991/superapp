import { describe, expect, it } from "vitest";
import type { CrmActivity } from "../src/db/schema";
import type { GroupableTask } from "../src/modules/crm/core/timeline";
import {
  activityToTimeline,
  addDays,
  dueBucket,
  groupTasks,
  mergeTimeline,
  taskToTimeline,
  type TimelineItem,
} from "../src/modules/crm/core/timeline";

/**
 * The timeline's merge and the follow-up urgency rules, without a database.
 *
 * Two of these are about calendar days rather than instants, which is the part
 * that is easy to get subtly wrong: an "overdue" that is off by a day for
 * anybody not on UTC is the kind of bug that gets reported as "the app is
 * nagging me about something due tomorrow".
 */

let seq = 0;
function activity(over: Partial<CrmActivity> = {}): CrmActivity {
  seq += 1;
  return {
    id: `act-${seq}`,
    tenantId: "t1",
    partyId: "p1",
    dealId: null,
    kind: "note",
    subject: "",
    body: "",
    occurredAt: new Date("2026-08-01T10:00:00Z"),
    createdByClerkUserId: "u1",
    version: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  } as CrmActivity;
}

/**
 * A follow-up, as the pure timeline functions read one.
 *
 * `GroupableTask` rather than the `crm_tasks` row: the table was dropped in
 * work.md slice 5c and these functions never depended on it — they read a
 * shape, which is what the structural type says out loud.
 */
function task(over: Partial<GroupableTask> = {}): GroupableTask {
  seq += 1;
  return {
    id: `task-${seq}`,
    partyId: "p1",
    dealId: null,
    title: `Task ${seq}`,
    notes: "",
    dueOn: null,
    assigneeClerkUserId: null,
    completedAt: null,
    version: 1,
    ...over,
  };
}

describe("mergeTimeline", () => {
  const at = (iso: string): Date => new Date(iso);

  it("orders newest first across sources", () => {
    const a: TimelineItem[] = [
      { id: "a:1", kind: "note", at: at("2026-08-01T10:00:00Z"), title: "old" },
    ];
    const b: TimelineItem[] = [
      { id: "b:1", kind: "call", at: at("2026-08-03T10:00:00Z"), title: "new" },
    ];
    expect(mergeTimeline(a, b).map((i) => i.title)).toEqual(["new", "old"]);
  });

  it("breaks ties by id so the order is stable between renders", () => {
    // Two things in the same second would otherwise swap places on every
    // render, which reads as the page lying about history.
    const same = at("2026-08-01T10:00:00Z");
    const items: TimelineItem[] = [
      { id: "z", kind: "note", at: same, title: "z" },
      { id: "a", kind: "note", at: same, title: "a" },
    ];
    expect(mergeTimeline(items).map((i) => i.id)).toEqual(["a", "z"]);
    expect(mergeTimeline([...items].reverse()).map((i) => i.id)).toEqual(["a", "z"]);
  });

  it("takes any number of sources, including none", () => {
    // Slice 5 adds mail as a third; this must not need reshaping for it.
    expect(mergeTimeline()).toEqual([]);
    expect(mergeTimeline([], [], [])).toEqual([]);
  });
});

describe("activityToTimeline", () => {
  it("uses the subject when there is one, with the body as detail", () => {
    const item = activityToTimeline(
      activity({ subject: "Site visit", body: "Went well.\nSecond line." }),
    );
    expect(item.title).toBe("Site visit");
    expect(item.detail).toBe("Went well.");
  });

  it("falls back to the body's first line when there is no subject", () => {
    // A note is usually all body and no subject; "(no subject)" would be the
    // most common thing on the page.
    const item = activityToTimeline(activity({ body: "  They want a revised price.  " }));
    expect(item.title).toBe("They want a revised price.");
    expect(item.detail).toBeUndefined();
  });

  it("falls back to the kind when there is neither", () => {
    expect(activityToTimeline(activity({ kind: "call" })).title).toBe("Call");
    expect(activityToTimeline(activity({ kind: "meeting" })).title).toBe("Meeting");
  });

  it("truncates a long first line rather than letting it run", () => {
    const item = activityToTimeline(activity({ body: "x".repeat(300) }));
    expect(item.title.length).toBe(140);
    expect(item.title.endsWith("…")).toBe(true);
  });

  it("uses occurredAt, not createdAt", () => {
    // Somebody writing up Friday's visit on Monday needs Friday.
    const friday = new Date("2026-07-31T09:00:00Z");
    const item = activityToTimeline(
      activity({ occurredAt: friday, createdAt: new Date("2026-08-03T09:00:00Z") }),
    );
    expect(item.at).toEqual(friday);
  });
});

describe("taskToTimeline", () => {
  it("places a completed task at the time it was completed", () => {
    const done = new Date("2026-08-02T14:00:00Z");
    const item = taskToTimeline(task({ dueOn: "2026-07-20", completedAt: done }));
    expect(item?.kind).toBe("task_done");
    expect(item?.at).toEqual(done);
  });

  it("places an open task at its due date", () => {
    const item = taskToTimeline(task({ dueOn: "2026-08-10" }));
    expect(item?.kind).toBe("task");
    // Midday UTC, so the date does not slip back a day west of Greenwich.
    expect(item?.at.toISOString()).toBe("2026-08-10T12:00:00.000Z");
  });

  it("drops an open task with no due date", () => {
    // It has not happened and is not scheduled, so it has no place on a
    // timeline. It still shows in the task list.
    expect(taskToTimeline(task({ dueOn: null }))).toBeNull();
  });
});

describe("dueBucket", () => {
  const today = "2026-08-04";

  it("classifies by calendar day", () => {
    expect(dueBucket("2026-08-03", today)).toBe("overdue");
    expect(dueBucket("2026-08-04", today)).toBe("today");
    expect(dueBucket("2026-08-09", today)).toBe("soon");
    expect(dueBucket("2026-09-01", today)).toBe("later");
  });

  it("treats no due date as someday, never overdue", () => {
    // Nobody agreed a date, so nothing has been missed.
    expect(dueBucket(null, today)).toBe("someday");
  });

  it("puts the soon boundary inclusive on the last day", () => {
    expect(dueBucket(addDays(today, 7), today)).toBe("soon");
    expect(dueBucket(addDays(today, 8), today)).toBe("later");
  });

  it("compares strings, so it cannot drift by a timezone", () => {
    // The bug this shape avoids: comparing a `date` column against a server
    // Date makes "overdue" wrong by up to a day for anybody not on UTC.
    expect(dueBucket("2026-12-31", "2027-01-01")).toBe("overdue");
    expect(dueBucket("2027-01-01", "2026-12-31")).toBe("soon");
  });
});

describe("addDays", () => {
  it("crosses months and years", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("crosses a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("goes backwards", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("groupTasks", () => {
  const today = "2026-08-04";

  it("drops completed tasks entirely", () => {
    // A list whose job is "what is outstanding" that also carries what is
    // finished is a list nobody trusts the top of.
    const groups = groupTasks(
      [task({ dueOn: "2026-08-01", completedAt: new Date() })],
      today,
    );
    expect(Object.values(groups).flat()).toHaveLength(0);
  });

  it("puts each open task in exactly one group", () => {
    const overdue = task({ dueOn: "2026-08-01" });
    const now = task({ dueOn: today });
    const undated = task({ dueOn: null });
    const groups = groupTasks([overdue, now, undated], today);
    expect(groups.overdue.map((t) => t.id)).toEqual([overdue.id]);
    expect(groups.today.map((t) => t.id)).toEqual([now.id]);
    expect(groups.someday.map((t) => t.id)).toEqual([undated.id]);
  });

  it("orders within a group by date, then title, so it is stable", () => {
    const b = task({ dueOn: "2026-08-01", title: "B" });
    const a = task({ dueOn: "2026-08-01", title: "A" });
    const earlier = task({ dueOn: "2026-07-30", title: "Z" });
    const groups = groupTasks([b, a, earlier], today);
    expect(groups.overdue.map((t) => t.title)).toEqual(["Z", "A", "B"]);
  });
});
