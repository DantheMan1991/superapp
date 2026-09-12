import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { schema } from "@/db";
import type {
  AttentionCtx,
  AttentionItem,
  AttentionSource,
} from "@/lib/attention-sources/types";
import type { Tx } from "@/db";
import { approveSheetAction } from "../actions";
import { roleMayApprove } from "../core/errors";
import { periodLabel } from "../core/periods";

/**
 * What Time owes a person: timesheets waiting to be approved.
 *
 * ONE ITEM PER SHEET, and only for owners — approving is the owner's decision
 * (`roleMayApprove`), so putting it in front of staff would be telling somebody
 * about work they cannot do. The predicate is the whole design of `time_sheets`
 * paying off: a row exists once submitted, `approved_at is null` means waiting,
 * and approving it makes the item disappear with nothing to mark read.
 *
 * A SUBMITTED SHEET HAS NO AGREED DATE, so `dueOn` is null and the urgency is
 * `soon`. It is a queue, not a deadline: nothing is late because payroll has
 * not been run yet, and dressing it up as overdue would cry wolf beside an
 * invoice that genuinely is.
 *
 * The other two things this module could report — a clock left running, and
 * somebody about to cross forty hours — are slice 8's. They are a different
 * shape: neither is a record with a person waiting on it, and the overtime one
 * needs the evaluator run per worker per week, which is too much to do inside a
 * digest that already asks six sources for their answers.
 */

/** A queue is not a deadline; a long one is still not late. */
const MAX_ITEMS = 25;

async function collect(tx: Tx, ctx: AttentionCtx): Promise<AttentionItem[]> {
  if (!roleMayApprove(ctx.role)) return [];

  const rows = await tx
    .select({
      id: schema.timeSheets.id,
      version: schema.timeSheets.version,
      periodStartsOn: schema.timeSheets.periodStartsOn,
      periodEndsOn: schema.timeSheets.periodEndsOn,
      submittedAt: schema.timeSheets.submittedAt,
      workerName: schema.parties.displayName,
    })
    .from(schema.timeSheets)
    .innerJoin(
      schema.timeWorkers,
      and(
        eq(schema.timeWorkers.tenantId, schema.timeSheets.tenantId),
        eq(schema.timeWorkers.id, schema.timeSheets.workerId),
      ),
    )
    .innerJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.timeWorkers.tenantId),
        eq(schema.parties.id, schema.timeWorkers.partyId),
      ),
    )
    .where(
      and(
        eq(schema.timeSheets.tenantId, ctx.tenantId),
        isNull(schema.timeSheets.approvedAt),
      ),
    )
    .orderBy(asc(schema.timeSheets.submittedAt))
    .limit(MAX_ITEMS);

  return rows.map((row) => ({
    key: `time_sheet:${row.id}`,
    title: `${row.workerName}'s hours are waiting for you`,
    detail: periodLabel({ start: row.periodStartsOn, end: row.periodEndsOn }),
    urgency: "soon" as const,
    dueOn: null,
    href: `/dashboard/m/time/pay?on=${row.periodStartsOn}`,
    action: {
      kind: "time.sheet.approve",
      label: "Approve",
      done: "Approved",
      // The version rides along so a concurrent edit is refused rather than
      // approved blind — exactly what the contract asks the args to carry.
      args: { sheetId: row.id, expectedVersion: row.version },
    },
  }));
}

export const timeAttentionSource: AttentionSource = {
  slug: "time",
  moduleSlug: "time",
  label: "Time",
  collect,
  actions: {
    /*
     * The page hands this straight to a client button, so it must be a server
     * action — which is why it is the module's own exported action rather than
     * a function defined here. It gates, validates and audits exactly as the
     * button on the pay period screen does, because it IS that button.
     */
    "time.sheet.approve": async (args) =>
      approveSheetAction({
        sheetId: String(args.sheetId),
        expectedVersion: Number(args.expectedVersion),
      }),
  },
};
