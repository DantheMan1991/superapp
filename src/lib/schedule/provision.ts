import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";

/**
 * Everybody gets exactly one calendar of their own, and it cannot be deleted.
 *
 * WHY IT IS PROVISIONED RATHER THAN CREATED ON DEMAND. A calendar is the unit
 * of sharing, so "somebody with no calendar" is a person nobody can put
 * anything on and who cannot be shown a week. Making the first write create it
 * would put that branch in every caller forever, and would mean an empty
 * calendar and a missing one look identical until somebody hits the difference.
 *
 * IDEMPOTENT, because it is called from a webhook path Clerk may deliver twice
 * and does not order. `ON CONFLICT DO NOTHING` in its bare form rather than
 * against a named target: the guarantee lives in the partial unique index
 * `schedule_calendars_primary_idx`, and naming a partial index as a conflict
 * target means restating its predicate here — a second copy of the rule, which
 * is the thing this module keeps refusing to have.
 *
 * Called under `withSystem` from tenant-sync, so the superadmin policy is what
 * lets it write. It must never be reachable from user input: it names the
 * person whose calendar it creates, and that name is the whole permission.
 */
export async function ensurePrimaryCalendar(
  tx: Tx,
  tenantId: string,
  clerkUserId: string,
): Promise<void> {
  await tx
    .insert(schema.scheduleCalendars)
    .values({
      tenantId,
      ownerClerkUserId: clerkUserId,
      // "Calendar", the way Outlook names a primary one. Deliberately not the
      // person's name: the UI already knows whose it is from the owner column,
      // and a name baked in at creation is a name that goes stale the day
      // somebody gets married.
      name: "Calendar",
      kind: "personal",
      isPrimary: true,
    })
    .onConflictDoNothing();
}

/**
 * The primary calendar for one person, or null before it has been provisioned.
 *
 * Null is a real state and not an error: a member whose Clerk webhook has not
 * landed yet has a membership and no calendar for a moment, and the same is
 * true of everybody who joined before this module existed. Callers decide what
 * to do about it — see the backfill note in docs/modules/scheduling.md.
 */
export async function findPrimaryCalendarId(
  tx: Tx,
  tenantId: string,
  clerkUserId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: schema.scheduleCalendars.id })
    .from(schema.scheduleCalendars)
    .where(
      and(
        eq(schema.scheduleCalendars.tenantId, tenantId),
        eq(schema.scheduleCalendars.ownerClerkUserId, clerkUserId),
        sql`${schema.scheduleCalendars.isPrimary}`,
      ),
    );
  return row?.id ?? null;
}
