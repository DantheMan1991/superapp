import { timingSafeEqual } from "node:crypto";
import { runPostReminders } from "@/modules/marketing/post-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Bounded work — at most `MAX_REMINDERS_PER_RUN` rows, no rendering, no mail. */
export const maxDuration = 60;

/**
 * "It is time to post this", every ten minutes (Marketing slice S1).
 *
 * TEN MINUTES BECAUSE THAT IS WHAT A SCHEDULE CAN PROMISE. The screen rounds
 * every scheduled time to the same ten, so a post set for 4:10 is reminded at
 * 4:10 rather than at the top of an hour that has not come — and the owner is
 * never told a minute the platform cannot keep. `mail-sync` already runs at
 * this interval, so the cadence costs nothing new.
 *
 * THIS ROUTE IS PUBLIC IN THE ROUTING SENSE — there is no Clerk session behind
 * a cron invocation — so the shared secret is the only thing between it and an
 * anonymous caller. It accepts NO PARAMETERS: no caller-supplied targeting
 * means no way to aim it. It picks its own work, which is the property every
 * cron in this codebase is built on.
 *
 * What it can do at worst is raise a work item early. It sends no mail, posts
 * nothing anywhere, and cannot reach a network at all in this build.
 */
function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  // Fail CLOSED when unset, as every other cron here does.
  if (!expected || expected.length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  const offered = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    // 404, not 401: an unauthenticated caller learns nothing about whether
    // this endpoint exists.
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const result = await runPostReminders(new Date());
  // Counts only — never a tenant, an account or a word of anybody's post (S9).
  return Response.json(result);
}
