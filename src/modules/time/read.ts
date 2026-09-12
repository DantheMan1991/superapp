import "server-only";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
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
