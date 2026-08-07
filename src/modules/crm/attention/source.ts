import "server-only";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { addDays } from "../core/timeline";
import type {
  AttentionCtx,
  AttentionItem,
  AttentionSource,
} from "@/lib/attention-sources/types";

/**
 * What CRM says you still owe: follow-ups that are due.
 *
 * IMPORTS `@/lib/attention-sources/types` AND NOTHING ELSE FROM `src/lib`
 * outside the db handle — never the registry, never another module. See that
 * file's header for the dependency graph.
 */

/** How far ahead counts as "soon". Matches the task list's own 7-day window. */
const SOON_WITHIN_DAYS = 7;

/**
 * Tasks are the one obligation in the product with a real assignee column, so
 * this is the source that most closely matches the design's intent: each person
 * sees THEIR OWN work.
 *
 * Two populations, deliberately kept distinguishable:
 *
 *   • assigned to you — the ordinary case;
 *   • assigned to NOBODY, surfaced only to owners, flagged `unassigned`.
 *
 * The second exists because per-person delivery has one load-bearing hole: work
 * assigned to no one is invisible to everyone, forever, and the more carefully
 * you scope a digest the more complete that invisibility becomes. Rolling it up
 * to the owner is the smallest fix that closes it. Flagging it is what stops
 * the owner reading "you owe this" when the truth is "nobody owes this yet" —
 * different asks needing different actions.
 *
 * Staff and experts do NOT receive unassigned work. For staff it would be an
 * instruction nobody gave them; for an expert it would be work they are
 * structurally barred from doing (the accountant role never writes).
 */
async function collect(tx: Tx, ctx: AttentionCtx): Promise<AttentionItem[]> {
  const horizon = addDays(ctx.today, SOON_WITHIN_DAYS);

  // Mine, plus — for owners only — whatever nobody has picked up.
  const assignment = ctx.role === "owner"
    ? or(
        eq(schema.crmTasks.assigneeClerkUserId, ctx.userId),
        isNull(schema.crmTasks.assigneeClerkUserId),
      )
    : eq(schema.crmTasks.assigneeClerkUserId, ctx.userId);

  const rows = await tx
    .select({
      id: schema.crmTasks.id,
      title: schema.crmTasks.title,
      dueOn: schema.crmTasks.dueOn,
      partyId: schema.crmTasks.partyId,
      assignee: schema.crmTasks.assigneeClerkUserId,
    })
    .from(schema.crmTasks)
    .where(
      and(
        eq(schema.crmTasks.tenantId, ctx.tenantId),
        isNull(schema.crmTasks.completedAt),
        assignment,
        // A task with no due date is `someday` — nobody agreed a date, so
        // nothing has been missed and it is not an obligation yet. The task
        // list shows it; the digest does not chase it.
        lte(schema.crmTasks.dueOn, horizon),
      ),
    )
    .limit(100);

  return rows.map((row) => {
    // `dueOn` cannot be null here — the lte() above excludes nulls — but the
    // column type says otherwise, and asserting would be a lie the next
    // refactor could make true.
    const dueOn = row.dueOn;
    return {
      key: `crm_task:${row.id}`,
      title: row.title,
      detail: describeDue(dueOn, ctx.today),
      urgency: urgencyFor(dueOn, ctx.today),
      dueOn,
      href: row.partyId
        ? `/dashboard/m/crm/records/${row.partyId}`
        : "/dashboard/m/crm/tasks",
      unassigned: row.assignee === null,
    } satisfies AttentionItem;
  });
}

/** Calendar comparison only — both sides are `yyyy-mm-dd` in the tenant's zone. */
function urgencyFor(dueOn: string | null, today: string): AttentionItem["urgency"] {
  if (dueOn === null) return "soon";
  if (dueOn < today) return "overdue";
  if (dueOn === today) return "today";
  return "soon";
}

/**
 * The human phrasing. Deliberately not "in 3 days" for everything — "today"
 * and "tomorrow" are how people actually hold a deadline, and a digest that
 * says "due in 0 days" reads as machine output.
 */
function describeDue(dueOn: string | null, today: string): string | undefined {
  if (dueOn === null) return undefined;
  if (dueOn === today) return "Due today";
  if (dueOn === addDays(today, 1)) return "Due tomorrow";
  if (dueOn < today) {
    const days = daysBetween(dueOn, today);
    return days === 1 ? "1 day overdue" : `${days} days overdue`;
  }
  return `Due ${dueOn}`;
}

/** Whole days between two `yyyy-mm-dd` strings, both treated as midnight UTC. */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  // Both endpoints are midnight UTC, so the difference is an exact multiple of
  // a day — none of the DST error that date arithmetic in a real zone carries.
  return Math.round((b - a) / 86_400_000);
}

export const crmAttentionSource: AttentionSource = {
  slug: "crm",
  moduleSlug: "crm",
  label: "Follow-ups",
  collect,
};
