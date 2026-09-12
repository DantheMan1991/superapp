import "server-only";
import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { schema, type Tx } from "@/db";

/**
 * Every read Time does. Each takes the CALLER'S `tx` — nothing here opens a
 * transaction, calls `withTenant` or calls `withSystem`, so what a reader can
 * find is exactly what their RLS context allows. `src/lib/parties/index.ts`
 * documents the same three properties; this file keeps them.
 *
 * `tenantId` is in every WHERE clause as well, so the query is right even if
 * the RLS context were somehow wrong.
 */

export interface WorkerRow {
  id: string;
  partyId: string;
  name: string;
  clerkUserId: string | null;
  isActive: boolean;
  version: number;
}

/**
 * Everybody the business can log time for, with the name from the party spine.
 *
 * ACTIVE FIRST AND THEN BY NAME, rather than active-only: a page that hid
 * everyone who had left would leave last month's hours attributed to a row
 * nothing on screen explains. The picker filters; the list shows both.
 */
export async function listWorkers(
  tx: Tx,
  tenantId: string,
): Promise<WorkerRow[]> {
  const rows = await tx
    .select({
      id: schema.timeWorkers.id,
      partyId: schema.timeWorkers.partyId,
      name: schema.parties.displayName,
      clerkUserId: schema.timeWorkers.clerkUserId,
      isActive: schema.timeWorkers.isActive,
      version: schema.timeWorkers.version,
    })
    .from(schema.timeWorkers)
    .innerJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.timeWorkers.tenantId),
        eq(schema.parties.id, schema.timeWorkers.partyId),
      ),
    )
    .where(eq(schema.timeWorkers.tenantId, tenantId))
    .orderBy(desc(schema.timeWorkers.isActive), asc(schema.parties.displayName));
  return rows;
}

export interface EntryRow {
  id: string;
  workerId: string;
  workerName: string;
  minutes: number;
  workDate: string;
  payType: string;
  note: string;
  source: string;
  enteredByClerkUserId: string;
  version: number;
}

/**
 * The hours in one span of days, newest day first.
 *
 * BOUNDED BY DATE IN SQL, never fetched-then-filtered: the "take a limit and
 * narrow it in JavaScript" shape is a defect class this codebase has paid for
 * more than once, because the rows that fall off the end are invisible and the
 * total is quietly wrong. A week is a week's worth of rows; there is no page.
 */
export async function listEntries(
  tx: Tx,
  tenantId: string,
  range: { from: string; to: string; workerId?: string },
): Promise<EntryRow[]> {
  const rows = await tx
    .select({
      id: schema.timeEntries.id,
      workerId: schema.timeEntries.workerId,
      workerName: schema.parties.displayName,
      minutes: schema.timeEntries.minutes,
      workDate: schema.timeEntries.workDate,
      payType: schema.timeEntries.payType,
      note: schema.timeEntries.note,
      source: schema.timeEntries.source,
      enteredByClerkUserId: schema.timeEntries.enteredByClerkUserId,
      version: schema.timeEntries.version,
    })
    .from(schema.timeEntries)
    .innerJoin(
      schema.timeWorkers,
      and(
        eq(schema.timeWorkers.tenantId, schema.timeEntries.tenantId),
        eq(schema.timeWorkers.id, schema.timeEntries.workerId),
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
        eq(schema.timeEntries.tenantId, tenantId),
        gte(schema.timeEntries.workDate, range.from),
        lte(schema.timeEntries.workDate, range.to),
        ...(range.workerId
          ? [eq(schema.timeEntries.workerId, range.workerId)]
          : []),
      ),
    )
    .orderBy(
      desc(schema.timeEntries.workDate),
      asc(schema.parties.displayName),
      asc(schema.timeEntries.createdAt),
    );
  return rows;
}

export async function getEntry(tx: Tx, tenantId: string, entryId: string) {
  return (
    (await tx.query.timeEntries.findFirst({
      where: and(
        eq(schema.timeEntries.tenantId, tenantId),
        eq(schema.timeEntries.id, entryId),
      ),
    })) ?? null
  );
}

export async function getWorker(tx: Tx, tenantId: string, workerId: string) {
  return (
    (await tx.query.timeWorkers.findFirst({
      where: and(
        eq(schema.timeWorkers.tenantId, tenantId),
        eq(schema.timeWorkers.id, workerId),
      ),
    })) ?? null
  );
}

/**
 * The worker row for a signed-in person, when they have one.
 *
 * What makes "log my own time" the default rather than a picker somebody has to
 * remember to set. Null is ordinary: an owner who does the books and never the
 * work has no worker row, and should not be given one automatically — a list of
 * people whose hours the business records is not the same list as the people
 * who can sign in.
 */
export async function getWorkerForUser(
  tx: Tx,
  tenantId: string,
  clerkUserId: string,
) {
  return (
    (await tx.query.timeWorkers.findFirst({
      where: and(
        eq(schema.timeWorkers.tenantId, tenantId),
        eq(schema.timeWorkers.clerkUserId, clerkUserId),
      ),
    })) ?? null
  );
}

export interface OpenPunchRow {
  id: string;
  workerId: string;
  workerName: string;
  startedAt: Date;
  /**
   * How long it has been running, as of this read.
   *
   * COMPUTED HERE rather than in the component, because "now" is a fact about
   * when the query ran and a render is supposed to be a pure function of what
   * it was given. The browser ticks up from this number; it never recomputes
   * it, so nobody has to trust a laptop's clock.
   */
  elapsedMinutes: number;
  note: string;
  version: number;
  startedByClerkUserId: string;
}

/**
 * Every clock currently running, longest first.
 *
 * EVERYBODY'S, not just the reader's. A clock left running is a problem for
 * whoever notices it, and the person it belongs to is by definition not
 * looking at the screen. Longest first puts the one that needs attention at the
 * top without the query knowing what "too long" means — that threshold is the
 * screen's, and lives in `core/rounding.ts` beside the rest of the clock's
 * arithmetic.
 */
export async function listOpenPunches(
  tx: Tx,
  tenantId: string,
): Promise<OpenPunchRow[]> {
  const rows = await tx
    .select({
      id: schema.timePunches.id,
      workerId: schema.timePunches.workerId,
      workerName: schema.parties.displayName,
      startedAt: schema.timePunches.startedAt,
      note: schema.timePunches.note,
      version: schema.timePunches.version,
      startedByClerkUserId: schema.timePunches.startedByClerkUserId,
    })
    .from(schema.timePunches)
    .innerJoin(
      schema.timeWorkers,
      and(
        eq(schema.timeWorkers.tenantId, schema.timePunches.tenantId),
        eq(schema.timeWorkers.id, schema.timePunches.workerId),
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
        eq(schema.timePunches.tenantId, tenantId),
        isNull(schema.timePunches.endedAt),
      ),
    )
    .orderBy(asc(schema.timePunches.startedAt));

  const now = Date.now();
  return rows.map((row) => ({
    ...row,
    elapsedMinutes: Math.max(
      0,
      Math.round((now - row.startedAt.getTime()) / 60_000),
    ),
  }));
}
