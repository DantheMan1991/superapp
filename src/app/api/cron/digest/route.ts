import { timingSafeEqual } from "node:crypto";
import { runDigest } from "@/lib/notifications/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Generous, because this fans out across every tenant and every member. Still
 * bounded: a run that is cut short simply leaves some tenants for the next
 * hour, and the send log makes resuming free — nobody is mailed twice.
 */
export const maxDuration = 300;

/**
 * The daily digest, on its own cron rather than riding mail-sync's.
 *
 * A DELIBERATE CHOICE, not the default one. Under Vercel's Hobby plan a second
 * cron was impossible — one job per day meant everything had to ride mail-sync
 * — and four passengers accumulated on that route for exactly that reason. Off
 * Hobby the constraint is gone, and this job has no business sharing:
 *
 *   • it must run ONCE per person per day, while mail-sync runs every 10
 *     minutes, so riding along would mean suppressing 143 of every 144 ticks;
 *   • it is the heaviest thing in the product, and starving the mail sync of
 *     its 60 seconds to send email would be a poor trade.
 *
 * This does NOT settle the job-queue question. A queue becomes right when the
 * agent runs land — minutes long, resumable — and that is the moment to build
 * one, with two real consumers to design against rather than one hypothetical.
 * See docs/modules/notifications.md.
 *
 * THIS ROUTE IS PUBLIC IN THE ROUTING SENSE — there is no Clerk session behind
 * a cron invocation — so the shared secret below is the only thing between it
 * and an anonymous caller mailing every client. It is deliberately the first
 * check, and it accepts no parameters: no caller-supplied targeting means no
 * way to aim it. It picks its own work.
 */
function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  // Fail CLOSED when unset. A cron that runs without a secret configured is
  // worse than one that never runs — the missing digest is visible, an open
  // endpoint that sends mail is not.
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

  const result = await runDigest(new Date());

  // Counts only — never an address, a name, or a tenant (S9).
  return Response.json(result);
}
