import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { schema, withSystem } from "@/db";
import { reconcileTenantMemberships } from "@/lib/membership-sync";
import { sendEmail } from "@/lib/email/send";
import { localHourInTimezone, todayInTimezone } from "@/lib/timezone";
import { buildPersonDigest, claimDigestSend } from "./digest";
import { digestSubject, renderDigestHtml, renderDigestText } from "./email";

/**
 * The daily run: who gets a digest right now, and sending it.
 *
 * ONE CRON SERVES EVERY TIMEZONE. It wakes hourly, asks each tenant what time
 * it is *there*, and sends to the ones where it is `SEND_HOUR`. The
 * alternatives are worse in ways that only show up twice a year: a stored UTC
 * send-time drifts when the offset shifts, and a cron per timezone is a
 * configuration change every time a client moves. Asking the zone is always
 * right and needs no maintenance — see docs/modules/timezone.md.
 */

/** Local hour to send at. 7am: before the day starts, after the alarm. */
export const SEND_HOUR = 7;

export interface DigestRunResult {
  tenantsConsidered: number;
  tenantsDue: number;
  sent: number;
  skippedAlreadySent: number;
  skippedOptedOut: number;
  failed: number;
  /** Tenants whose roster could not be confirmed against Clerk. */
  rosterUnconfirmed: number;
}

/** Active tenants, with the timezone that decides whether it is their 7am. */
async function tenantsToConsider() {
  // withSystem, justified (S2): trusted background code enumerating tenants.
  // No user input reaches this — the run picks its own work, the same property
  // the mail-sync cron relies on.
  return withSystem((tx) =>
    tx
      .select({
        id: schema.tenants.id,
        clerkOrgId: schema.tenants.clerkOrgId,
        timezone: schema.tenants.timezone,
      })
      .from(schema.tenants)
      .where(ne(schema.tenants.status, "churned")),
  );
}

/**
 * Everyone in this tenant who wants the digest, with a confirmed role.
 *
 * LEFT join to preferences, because a missing row means `daily`. Storing the
 * default would mean every new member needs a row inserted before they can be
 * mailed, and any gap in that backfill is a person who silently never hears
 * from us — the failure mode being designed against here.
 */
async function recipientsFor(tenantId: string) {
  const rows = await withSystem((tx) =>
    tx
      .select({
        profileId: schema.memberships.profileId,
        role: schema.memberships.role,
        clerkUserId: schema.profiles.clerkUserId,
        email: schema.profiles.email,
        name: schema.profiles.name,
        digest: schema.notificationPreferences.digest,
      })
      .from(schema.memberships)
      .innerJoin(
        schema.profiles,
        eq(schema.profiles.id, schema.memberships.profileId),
      )
      .leftJoin(
        schema.notificationPreferences,
        and(
          eq(schema.notificationPreferences.tenantId, schema.memberships.tenantId),
          eq(
            schema.notificationPreferences.profileId,
            schema.memberships.profileId,
          ),
        ),
      )
      .where(eq(schema.memberships.tenantId, tenantId)),
  );
  return rows;
}

/**
 * Send every digest that is due at this moment.
 *
 * `now` is injectable so the whole thing is testable without waiting for 7am.
 */
export async function runDigest(now: Date = new Date()): Promise<DigestRunResult> {
  const result: DigestRunResult = {
    tenantsConsidered: 0,
    tenantsDue: 0,
    sent: 0,
    skippedAlreadySent: 0,
    skippedOptedOut: 0,
    failed: 0,
    rosterUnconfirmed: 0,
  };

  const tenants = await tenantsToConsider();
  result.tenantsConsidered = tenants.length;

  for (const tenant of tenants) {
    if (localHourInTimezone(tenant.timezone, now) !== SEND_HOUR) continue;
    result.tenantsDue += 1;

    const localDate = todayInTimezone(tenant.timezone, now);

    /**
     * RECONCILE BEFORE ACTING AS ANYBODY. This is prerequisite 1's whole
     * point: `memberships.role` is what decides whose behalf this job acts on,
     * and a dropped demotion webhook leaves a row that still says `owner` for
     * somebody Clerk has since demoted. Acting on that would read owners-only
     * Documents folders and mail them to a person who can no longer open them
     * — a disclosure that cannot be withdrawn.
     *
     * When the roster cannot be confirmed the run SKIPS this tenant rather
     * than falling back to stored roles. A missed morning is recoverable; the
     * other direction is not.
     */
    const reconciled = await reconcileTenantMemberships(tenant);
    if (!reconciled.complete) {
      result.rosterUnconfirmed += 1;
      console.error(
        `digest: skipping tenant ${tenant.id} — roster not confirmed against Clerk`,
      );
      continue;
    }

    const recipients = await recipientsFor(tenant.id);
    for (const person of recipients) {
      // No row means daily — see recipientsFor.
      if (person.digest === "off") {
        result.skippedOptedOut += 1;
        continue;
      }
      try {
        const digest = await buildPersonDigest({
          tenantId: tenant.id,
          profileId: person.profileId,
          clerkUserId: person.clerkUserId,
          email: person.email,
          name: person.name,
          role: person.role,
          localDate,
        });

        // Claim BEFORE sending — see claimDigestSend for why this order.
        const claimed = await claimDigestSend({
          tenantId: tenant.id,
          profileId: person.profileId,
          localDate,
          itemKeys: digest.items.map((i) => i.key),
        });
        if (!claimed) {
          result.skippedAlreadySent += 1;
          continue;
        }

        const sent = await sendEmail({
          tenantId: tenant.id,
          kind: "digest",
          to: person.email,
          subject: digestSubject(digest),
          text: renderDigestText(digest),
          html: renderDigestHtml(digest),
          // Second net under the log's unique index: derived from what the
          // message IS, so a retry is a no-op rather than a second email.
          idempotencyKey: `digest:${person.profileId}:${localDate}`,
        });
        if (sent.ok) result.sent += 1;
        else {
          result.failed += 1;
          // Reason only — never the address or the subject (S9).
          console.error(`digest send failed for tenant ${tenant.id}: ${sent.reason}`);
        }
      } catch (err) {
        result.failed += 1;
        console.error(`digest failed for a member of tenant ${tenant.id}`, err);
      }
    }
  }

  return result;
}
