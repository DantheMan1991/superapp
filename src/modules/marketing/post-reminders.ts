import "server-only";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { schema, withSystem, withTenant } from "@/db";
import { createUnlinkedWork } from "@/lib/work/entity-work";
import { SOCIAL_NETWORK_LABELS, type SocialNetwork } from "@/lib/sites/links";
import { channelDisplay } from "@/lib/social/channels";
import { todayInTimezone } from "@/lib/timezone";

/**
 * "It is time to post this" — the ten-minute sweep (slice S1).
 *
 * **THIS IS WHAT S1 HAS INSTEAD OF PUBLISHING.** Nothing here reaches a
 * network; it turns a scheduled post into an obligation in the one place the
 * business already looks for obligations. When S6 brings a real connection,
 * the sweep's last step changes and everything before it stays — which is the
 * whole reason the reminder was built before the connection.
 *
 * **ONE REMINDER PER POST, EVER**, unless the post is rescheduled.
 * `reminded_at` is the idempotency, and `schedulePost` clears it — so moving
 * a post to next week reminds next week, and a sweep that runs twice in the
 * same minute raises one item. A cron that can double-post is worse than one
 * that can miss, and this one can do neither.
 *
 * **WHY THE WRITES SPLIT ACROSS TWO SCOPES.** Raising the work item runs
 * `withTenant` as `staff` with no user, exactly as the website's enquiry form
 * does (ADR 0021) — the work policies decide, not this file. Stamping
 * `reminded_at` runs under `withSystem`, because `social_posts` is owner-only
 * to write and this sweep is not a person: it is trusted background code with
 * no user input, which is the case AGENTS.md names for `withSystem`. Giving
 * the table a member UPDATE policy instead would have let any member rewrite
 * the business's public voice, which is a far larger hole than this is a
 * shortcut.
 */

/** Posts one run will act on, across every tenant. Ten minutes is not long. */
export const MAX_REMINDERS_PER_RUN = 200;

export interface PostReminderResult {
  due: number;
  raised: number;
  failedTenants: number;
}

interface DuePost {
  postId: string;
  tenantId: string;
  timezone: string;
  body: string;
  network: string;
  handle: string;
  label: string;
  scheduledAt: Date;
}

/**
 * Every post whose time has come, newest tenant-agnostic.
 *
 * withSystem, justified (S2): trusted background code enumerating work across
 * tenants, taking no caller input — the same property the digest, mail-sync
 * and invoice-reminder crons rely on. It reads exactly the rows the partial
 * index covers.
 */
async function findDue(now: Date): Promise<DuePost[]> {
  return withSystem((tx) =>
    tx
      .select({
        postId: schema.socialPosts.id,
        tenantId: schema.socialPosts.tenantId,
        timezone: schema.tenants.timezone,
        body: schema.socialPosts.body,
        network: schema.socialChannels.network,
        handle: schema.socialChannels.handle,
        label: schema.socialChannels.label,
        scheduledAt: schema.socialPosts.scheduledAt,
      })
      .from(schema.socialPosts)
      .innerJoin(
        schema.socialChannels,
        and(
          eq(schema.socialChannels.tenantId, schema.socialPosts.tenantId),
          eq(schema.socialChannels.id, schema.socialPosts.channelId),
        ),
      )
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.socialPosts.tenantId))
      .where(
        and(
          eq(schema.socialPosts.status, "scheduled"),
          isNull(schema.socialPosts.remindedAt),
          lte(schema.socialPosts.scheduledAt, now),
        ),
      )
      .orderBy(asc(schema.socialPosts.scheduledAt))
      .limit(MAX_REMINDERS_PER_RUN),
  ) as Promise<DuePost[]>;
}

/** "Post to Facebook (@oakrowfarm)" — the account, because a business may run several. */
export function reminderTitle(post: {
  network: string;
  handle: string;
  label: string;
}): string {
  const network = post.network as SocialNetwork;
  return `Post to ${SOCIAL_NETWORK_LABELS[network] ?? post.network} (${channelDisplay({
    network,
    handle: post.handle,
    label: post.label,
  })})`;
}

/**
 * The words, then where to finish the job.
 *
 * The body is repeated here on purpose: most of the time the person reading
 * the digest can copy it straight out and be done, and a reminder that only
 * says "go and look" is a second errand rather than the end of one.
 */
export function reminderNotes(post: { body: string; network: string }, postId: string): string {
  const words = post.body.trim();
  return [
    words === "" ? "(nothing written)" : words,
    "",
    `Open it in Yosher to copy the words and save the picture: /dashboard/m/marketing/social/posts/${postId}`,
    "Yosher cannot post this for you yet, so post it yourself and then mark it posted.",
  ].join("\n");
}

export async function runPostReminders(now: Date): Promise<PostReminderResult> {
  const due = await findDue(now);
  if (due.length === 0) return { due: 0, raised: 0, failedTenants: 0 };

  const byTenant = new Map<string, DuePost[]>();
  for (const post of due) {
    const bucket = byTenant.get(post.tenantId);
    if (bucket) bucket.push(post);
    else byTenant.set(post.tenantId, [post]);
  }

  let raised = 0;
  let failedTenants = 0;
  for (const [tenantId, posts] of byTenant) {
    try {
      // Raised as `staff` with no user, the way every public door raises work
      // (ADR 0021). Work's own policies decide whether it may land.
      const stamped = await withTenant(tenantId, async (tx) => {
        const done: Array<{ postId: string; workItemId: string }> = [];
        for (const post of posts) {
          const workItemId = await createUnlinkedWork(
            tx,
            { tenantId, userId: "" },
            {
              title: reminderTitle(post),
              notes: reminderNotes(post, post.postId),
              // Due the day it was scheduled for, in the business's own
              // timezone, so it reaches that morning's digest rather than
              // yesterday's or tomorrow's.
              dueOn: todayInTimezone(post.timezone, post.scheduledAt),
            },
          );
          done.push({ postId: post.postId, workItemId });
        }
        return done;
      });

      // The bookkeeping, under withSystem — see the header. Done per post so a
      // tenant whose work list refused one item still records the rest.
      await withSystem(async (tx) => {
        for (const { postId, workItemId } of stamped) {
          await tx
            .update(schema.socialPosts)
            .set({ remindedAt: now, workItemId })
            .where(
              and(eq(schema.socialPosts.id, postId), eq(schema.socialPosts.tenantId, tenantId)),
            );
        }
      });
      raised += stamped.length;
    } catch (err) {
      // One tenant's failure is one tenant's. Nothing is stamped for them, so
      // the next run tries again — which is why `reminded_at` is written after
      // the item and not before it.
      failedTenants += 1;
      console.error("social post reminders failed for a tenant", err);
    }
  }
  return { due: due.length, raised, failedTenants };
}

/** Used by the isolation test to prove the sweep sees nothing it should not. */
export async function duePostIds(now: Date, tenantId: string): Promise<string[]> {
  const rows = await findDue(now);
  return rows.filter((r) => r.tenantId === tenantId).map((r) => r.postId);
}
