import { timingSafeEqual } from "node:crypto";
import {
  accountsDueForSync,
  markAccountsErrored,
  syncMailAccount,
} from "@/lib/email/sync/account";
import { wakeDueSnoozes } from "@/modules/email/triage/snooze";
import { sendDueMessages } from "@/modules/email/schedule/sweep";
import { runAutofileRules } from "@/modules/email/autofile/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 60s is now OUR choice, not the platform's. It was Hobby's hard cap when this
 * was written; the plan changed (confirmed 2026-08-06) and the ceiling is
 * higher, but every batch size below was picked to fit inside a minute and
 * raising the limit without re-deriving them buys nothing. Raise both together,
 * deliberately — most likely alongside the digest, when the shape of this job
 * is being decided anyway.
 */
export const maxDuration = 60;

/**
 * Background sync, so unread counts and the thread index stay warm with nobody
 * looking.
 *
 * The poller covers the case where somebody has Mail open. This covers the rest
 * of the product: the sidebar badge renders on every dashboard page, and a
 * badge that only updates while you are already reading mail is not much of a
 * badge.
 *
 * THIS ROUTE IS PUBLIC IN THE ROUTING SENSE — there is no Clerk session behind
 * a cron invocation — so its authentication is the shared secret below, and
 * that is the only thing standing between it and an anonymous caller draining
 * every tenant's mail server. It is deliberately the first check.
 *
 * It is also the reason this does NOT accept a tenant or account id: no
 * caller-supplied targeting means no way to aim it. It picks its own work.
 */

const BATCH = 25;
/** Due snoozes per tick. Bounded separately so it cannot starve the sync. */
const WAKE_BATCH = 200;
/**
 * Due scheduled sends per tick. SMALLER than the snooze cap on purpose: waking
 * a message is one folder move, while releasing one is a full submission with
 * an SMTP handoff behind it, and a hundred of those would not fit in the same
 * budget.
 */
const SEND_BATCH = 50;
/**
 * Auto-filing rules per tick. The SMALLEST cap of the three, because this is
 * the only step that downloads whole messages and their attachments — a rule
 * page is 10 messages, so this bounds the tick at 80 downloads in the worst
 * case rather than at a folder move apiece.
 */
const AUTOFILE_BATCH = 8;

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  // Fail CLOSED when unset. A cron route that runs without a secret configured
  // is worse than one that never runs — the missing sync is visible, an open
  // endpoint is not.
  if (!expected || expected.length < 16) return false;

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  const header = request.headers.get("authorization") ?? "";
  const offered = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    // 404, not 401: an unauthenticated caller learns nothing about whether this
    // endpoint exists.
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // `accountsDueForSync` applies its own cooldown, so overlapping invocations
  // cannot both pick up the same account and double-sync it.
  const due = await accountsDueForSync(BATCH);
  const broken: string[] = [];
  let synced = 0;
  let failed = 0;

  for (const account of due) {
    const outcome = await syncMailAccount(account);
    if (outcome.ok) {
      synced += 1;
      continue;
    }
    failed += 1;
    // A credential that needs re-authorizing is marked so the poller stops and
    // the badge shows a dot. Anything else is transient and gets retried on the
    // next tick rather than being written off.
    if (outcome.needsReauth) broken.push(account.id);
  }

  if (broken.length > 0) {
    await markAccountsErrored(broken, "sync could not authenticate");
  }

  /**
   * Snoozed mail rides along on this schedule rather than getting a cron of
   * its own. The original reason has EXPIRED: Hobby ran each cron once a day,
   * so a second job would have meant "later today" arriving tomorrow. Off
   * Hobby (confirmed 2026-08-06) a second cron is allowed, and this is now a
   * ride-along by inertia rather than by necessity.
   *
   * Left as-is deliberately rather than split on discovery: it works, and the
   * one-cron-many-passengers shape is exactly what the digest forces a decision
   * about. Split it there, once, with the queue question answered — not here as
   * a drive-by.
   *
   * Its own cap, and last, so a large batch of due messages cannot eat the
   * sync's 60 seconds. Anything left over is picked up on the next tick —
   * waking late is a small harm, and waking is idempotent.
   */
  const woken = await wakeDueSnoozes(new Date(), WAKE_BATCH);

  /**
   * Scheduled messages ride the same schedule, for the same (now expired)
   * reason as the snooze sweep above, and run LAST — after the sync and after
   * the snooze sweep.
   *
   * Order matters here in a way it does not for the other two. This is the only
   * step that performs an irreversible act on somebody's behalf, so it runs when
   * everything else has had its budget: a batch cut short leaves messages queued
   * for the next tick, which is late, whereas a batch that ran first and then
   * timed out could leave the sync perpetually starved.
   */
  const released = await sendDueMessages(new Date(), SEND_BATCH);

  /**
   * Auto-filing runs LAST of the four, and the reason is the same one that puts
   * scheduled send third: it is the most expensive step and the least urgent.
   * A page of attachments not filed on this tick is filed on the next one —
   * the watermark makes that free — whereas a sync starved of its budget leaves
   * every unread badge in the product stale.
   *
   * It could not have been a Sieve rule. Sieve runs inside the mail server and
   * cannot call Yosher; the one action that could reach us (`redirect` to an
   * inbound address) would send the message back out over SMTP, duplicate it
   * and break SPF. So the cron is the only trigger available, and this feature
   * inherits ADR 0005's cadence.
   */
  const autofiled = await runAutofileRules(AUTOFILE_BATCH);

  // Counts only — never an address, a subject or a tenant name (S9).
  return Response.json({
    considered: due.length,
    synced,
    failed,
    markedNeedsReauth: broken.length,
    woken: woken.woken,
    wakeFailed: woken.failed,
    scheduledSent: released.sent,
    scheduledFailed: released.failed,
    autofileRules: autofiled.rules,
    autofiled: autofiled.filed,
    autofileSkipped: autofiled.skipped,
    autofileFailed: autofiled.failed,
  });
}
