import { timingSafeEqual } from "node:crypto";
import { runRecurringEntries } from "@/modules/accounting/recurring/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Generous, because this fans out across every tenant and a single catch-up
 * can post twelve months of a journal. Still bounded: a run that is cut short
 * leaves the rest for the next hour, and nothing is lost — an entry that did
 * not generate today still has `next_run_date` in the past tomorrow.
 */
export const maxDuration = 300;

/**
 * Recurring entries, generated without anybody pressing a button.
 *
 * Its own cron rather than a passenger on the reminder sweep, for the same
 * reason reminders are not a passenger on the digest: blast radius. This one
 * WRITES TO THE LEDGER — an auto-posting journal posts here — while reminders
 * send mail. Being able to stop one without stopping the other is worth an
 * entry in vercel.json.
 *
 * THIS ROUTE IS PUBLIC IN THE ROUTING SENSE — there is no Clerk session behind
 * a cron invocation — so the shared secret is the only thing between it and an
 * anonymous caller posting entries into every client's books. It is the first
 * check and it accepts no parameters: no caller-supplied targeting means no
 * way to aim it. It picks its own work.
 */
function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  // Fail CLOSED when unset. An open endpoint that writes to strangers' ledgers
  // is not a failure anyone gets to take back.
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

  const result = await runRecurringEntries(new Date());

  // Counts only — never a tenant, a template name or an amount (S9).
  return Response.json(result);
}
