import "server-only";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  AttentionCtx,
  AttentionItem,
  AttentionSource,
} from "@/lib/attention-sources/types";
import { addDays } from "@/lib/timezone";
import type { WorkState } from "@/lib/work/vocabulary";
import { SOON_WITHIN_DAYS, urgencyOf } from "../core/grouping";
import { describeDue } from "../core/due";
import { describeWorkState } from "../core/state";

/**
 * What Work says you still owe: your open work, and the pile nobody has picked
 * up.
 *
 * IMPORTS `@/lib/attention-sources/types` AND NOTHING ELSE FROM `src/lib`
 * outside the db handle and the shared date helper — never the registry, never
 * another module. See that file's header for the dependency graph.
 *
 * ── WHY THIS IS THE SOURCE WITH THE STRONGEST CLAIM ──────────────────────────
 *
 * `notifications.md` requires an obligation to SELF-CLEAR, or the channel
 * accumulates and gets muted. Work is the only source where clearing it is the
 * literal point of the record: closing the item removes the line, and there is
 * nothing to mark read. It is also the only one whose rows carry a real
 * assignee AND a real agreed date, which is what per-person delivery needs.
 *
 * ── FOUR THINGS ARE DELIBERATELY NOT AN OBLIGATION ───────────────────────────
 *
 *  1. **Undated work.** Nobody agreed a date, so nothing has been missed. The
 *     list shows it; the digest does not chase it. CRM drew the same line.
 *  2. **Deferred work** (`starts_on` in the future). Being told about something
 *     you decided not to start yet is the definition of noise, and `starts_on`
 *     exists precisely so a person can say "not until Monday" once.
 *  3. **Closed work**, obviously — `closed_at IS NULL` is the whole filter, and
 *     it covers cancelled as well as done because both mean finished with.
 *  4. **Work beyond the horizon.** Seven days, matching the page's own "this
 *     week" section, so the digest and the list agree about what is soon.
 *
 * ── BUT BLOCKED WORK *IS* AN OBLIGATION, AND THAT IS A DECISION ──────────────
 *
 * The tempting rule is that blocked work should not nag, since the assignee
 * cannot do it. It nags anyway, because the action is real — chase whatever is
 * blocking it — and because excluding it would let anybody silence a late item
 * by setting a state. A digest that can be switched off per row is one nobody
 * can trust. What the state does earn is a mention in the detail line, so the
 * reader knows why it has not moved.
 */

/** How many rows one person can be told about before the email is noise. */
const MAX_ITEMS = 100;

async function collect(tx: Tx, ctx: AttentionCtx): Promise<AttentionItem[]> {
  const horizon = addDays(ctx.today, SOON_WITHIN_DAYS);

  // Mine, plus — for owners only — whatever nobody has picked up. Staff and
  // experts do NOT receive unassigned work: for staff it would be an
  // instruction nobody gave them, and an expert cannot act on it at all.
  const assignment =
    ctx.role === "owner"
      ? or(
          eq(schema.workItems.assigneeClerkUserId, ctx.userId),
          isNull(schema.workItems.assigneeClerkUserId),
        )
      : eq(schema.workItems.assigneeClerkUserId, ctx.userId);

  const rows = await tx
    .select({
      id: schema.workItems.id,
      title: schema.workItems.title,
      dueOn: schema.workItems.dueOn,
      state: schema.workItems.state,
      status: schema.workItems.status,
      assignee: schema.workItems.assigneeClerkUserId,
      listName: schema.workLists.name,
    })
    .from(schema.workItems)
    .innerJoin(
      schema.workLists,
      and(
        eq(schema.workLists.tenantId, schema.workItems.tenantId),
        eq(schema.workLists.id, schema.workItems.listId),
      ),
    )
    .where(
      and(
        eq(schema.workItems.tenantId, ctx.tenantId),
        isNull(schema.workItems.closedAt),
        assignment,
        // `lte` excludes NULL, which is what drops undated work.
        lte(schema.workItems.dueOn, horizon),
        // Not started yet is not owed yet.
        or(
          isNull(schema.workItems.startsOn),
          lte(schema.workItems.startsOn, ctx.today),
        ),
      ),
    )
    // Soonest first, so a truncated list keeps the part that matters.
    .orderBy(schema.workItems.dueOn, sql`${schema.workItems.id}`)
    .limit(MAX_ITEMS);

  return rows.map((row) => {
    // `dueOn` cannot be null here — the lte() above excludes nulls — but the
    // column type says otherwise, and asserting would be a lie the next
    // refactor could make true.
    const dueOn = row.dueOn ?? ctx.today;
    const urgency = urgencyOf(dueOn, ctx.today);
    // Only worth saying when it is not the ordinary case — "To do" on every
    // line is furniture. This is also where a blocked item explains itself.
    const stateNote =
      row.state === "todo"
        ? null
        : describeWorkState(row.state as WorkState, row.status);
    return {
      key: `work_item:${row.id}`,
      title: row.title,
      detail: [stateNote, describeDue(dueOn, ctx.today), row.listName]
        .filter(Boolean)
        .join(" · "),
      // `later` and `undated` cannot occur: the horizon excludes the first and
      // the lte excludes the second. Mapped rather than asserted.
      urgency: urgency === "overdue" || urgency === "today" ? urgency : "soon",
      dueOn,
      // The record itself, not a list — slice 3's sheet is what makes that
      // address exist. The contract asks for a deep link precisely so the email
      // is actionable without a round trip through a page.
      href: `/dashboard/m/work?item=${row.id}`,
      unassigned: row.assignee === null,
    } satisfies AttentionItem;
  });
}

export const workAttentionSource: AttentionSource = {
  slug: "work",
  moduleSlug: "work",
  label: "Work",
  collect,
};
