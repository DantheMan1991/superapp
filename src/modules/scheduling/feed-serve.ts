import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { schema, withSystem, withTenant } from "@/db";
import { listRange } from "@/lib/schedule/range";
import { getTenantTimezone } from "@/lib/tenant-timezone";
import { addDays, startOfDayInTimezone, todayInTimezone } from "@/lib/timezone";
import { buildCalendar, type IcsEvent } from "./core/ics";
import { hashFeedToken } from "./feed-ops";

/**
 * Serving one person's calendar to their phone.
 *
 * ============================================================================
 * THE ONLY `withSystem` IN THIS MODULE, AND IT DOES EXACTLY ONE THING.
 * ============================================================================
 *
 * A calendar subscription arrives with no session — the phone cannot log in —
 * so the request has no tenant and no user, and the token is the only thing
 * that can establish either. Resolving it therefore has to happen outside RLS.
 *
 * THE MOMENT THE PERSON IS KNOWN, THAT CONTEXT IS CLOSED and the events are
 * fetched again as them, through ordinary `withTenant`. A feed that selected
 * items under the system context would serve whatever the token named,
 * including calendars that person cannot see — which is the difference between
 * "your calendar, by link" and "any calendar, by link".
 *
 * The two phases are kept visibly apart below for that reason. If a future
 * change needs one more thing from the system context, it belongs in phase 1
 * with a comment saying why, not merged into phase 2.
 */

/** How much of the calendar a subscription carries. */
const DAYS_BACK = 30;
const DAYS_AHEAD = 365;

export interface FeedResult {
  ics: string;
  /** For the response's filename. */
  label: string;
}

export async function serveFeed(token: string): Promise<FeedResult | null> {
  /* ── Phase 1: who is this? System context, one query, nothing else. ─────── */
  const resolved = await withSystem(async (tx) => {
    const [row] = await tx
      .select({
        id: schema.scheduleFeedTokens.id,
        tenantId: schema.scheduleFeedTokens.tenantId,
        clerkUserId: schema.scheduleFeedTokens.clerkUserId,
        label: schema.scheduleFeedTokens.label,
      })
      .from(schema.scheduleFeedTokens)
      .where(
        and(
          // BY HASH. The token itself is never stored, so a dump of this table
          // does not hand anybody a working feed.
          eq(schema.scheduleFeedTokens.tokenHash, hashFeedToken(token)),
          isNull(schema.scheduleFeedTokens.revokedAt),
        ),
      );
    if (!row) return null;

    // The membership is read here too, because phase 2 needs a role to open
    // with and cannot ask for one without a tenant context.
    //
    // The STORED role is used rather than a fresh reconcile against Clerk,
    // unlike the digest. The difference is who the output reaches: the digest
    // MAILS somebody's obligations and a stale `owner` would send them
    // somebody else's, whereas this is pulled by the person themselves with
    // their own token and shows only their own calendars. `memberships.role` is
    // `withSystem`-write-only (0085), so it is not user-tamperable either.
    const [membership] = await tx
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .innerJoin(
        schema.profiles,
        eq(schema.profiles.id, schema.memberships.profileId),
      )
      .where(
        and(
          eq(schema.memberships.tenantId, row.tenantId),
          eq(schema.profiles.clerkUserId, row.clerkUserId),
        ),
      );
    // No membership means they have left the workspace. The token stays valid
    // in the table and serves nothing, which is the right shape: revoking
    // access is Clerk's job, and this must not become a second place to do it.
    if (!membership) return null;

    await tx
      .update(schema.scheduleFeedTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.scheduleFeedTokens.id, row.id));

    return { ...row, role: membership.role };
  });

  if (!resolved) return null;

  /* ── Phase 2: their calendar, as them. Ordinary RLS from here. ──────────── */
  const events = await withTenant(
    resolved.tenantId,
    async (tx) => {
      const timeZone = await getTenantTimezone(tx, resolved.tenantId);
      const today = todayInTimezone(timeZone);
      const from = startOfDayInTimezone(addDays(today, -DAYS_BACK), timeZone);
      const to = startOfDayInTimezone(addDays(today, DAYS_AHEAD), timeZone);
      const items = await listRange(tx, from, to);
      return { items, timeZone };
    },
    { role: resolved.role, userId: resolved.clerkUserId },
  );

  const icsEvents: IcsEvent[] = events.items.map((item) => ({
    // The item's own id, so a client never sees an event change identity and
    // delete-then-re-add it on every refresh.
    uid: `${item.id}@yosherapp.com`,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    allDay: item.allDay,
    // A `busy`-level item has no title BY CONSTRUCTION — the projection nulled
    // it. "Busy" is the honest rendering, and the same word the app shows.
    summary: item.title ?? "Busy",
    description: item.description ?? undefined,
    location: item.location ?? undefined,
    busy: item.showAs !== "free",
  }));

  return {
    ics: buildCalendar({
      name: "Yosher",
      timeZone: events.timeZone,
      events: icsEvents,
      now: new Date(),
    }),
    label: resolved.label,
  };
}
