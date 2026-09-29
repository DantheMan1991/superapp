import { timingSafeEqual } from "node:crypto";
import { runWorkoutReminders } from "@/modules/fitness/reminder-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Bounded work: at most `MAX_REMINDERS_PER_RUN` rows, one small read and one push each. */
export const maxDuration = 60;

/**
 * "Time for your workout", every ten minutes (Workouts F4a, ADR 0116).
 *
 * TEN MINUTES, like `social-due`: the card keeps times in tens, so a reminder
 * set for 7:30 goes at 7:30 and not at the top of an hour that has not come.
 *
 * THIS ROUTE IS PUBLIC IN THE ROUTING SENSE: no Clerk session is behind a cron
 * invocation, so the shared secret is the only thing between it and an
 * anonymous caller. It takes NO PARAMETERS and picks its own work, like every
 * cron here. At worst it tells a person's own phone about their own workout,
 * once a reminder per day, and only when that day's sets are not done.
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
  const result = await runWorkoutReminders(new Date());
  // Counts only: never a space, a program or a word of what was sent (S9).
  return Response.json(result);
}
