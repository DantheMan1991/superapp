import { timingSafeEqual } from "node:crypto";
import {
  accountsDueForSync,
  markAccountsErrored,
  syncMailAccount,
} from "@/lib/email/sync/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Vercel caps a Hobby cron at 60s; stay inside it and let the next tick continue. */
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

  // Counts only — never an address, a subject or a tenant name (S9).
  return Response.json({
    considered: due.length,
    synced,
    failed,
    markedNeedsReauth: broken.length,
  });
}
