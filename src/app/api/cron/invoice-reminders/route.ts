import { timingSafeEqual } from "node:crypto";
import { runInvoiceReminders } from "@/modules/accounting/invoicing/reminder-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Generous, because this fans out across every tenant and renders a PDF per
 * reminder. Still bounded: a run that is cut short leaves the rest for the
 * next hour, and the send log makes resuming free — nobody is mailed twice.
 */
export const maxDuration = 300;

/**
 * Automatic invoice reminders, on their own cron rather than the digest's.
 *
 * The reasoning is in `reminder-run.ts`: this mails our clients' CUSTOMERS
 * with nobody at the keyboard, while the digest mails our own users. Being
 * able to stop one without stopping the other is worth a second entry in
 * vercel.json.
 *
 * THIS ROUTE IS PUBLIC IN THE ROUTING SENSE — there is no Clerk session behind
 * a cron invocation — so the shared secret below is the only thing between it
 * and an anonymous caller mailing every client's customer list. It is
 * deliberately the first check, and it accepts no parameters: no
 * caller-supplied targeting means no way to aim it. It picks its own work.
 */
function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  // Fail CLOSED when unset. Truer here than anywhere else in the product: an
  // open endpoint that chases a stranger's customers for money is not a
  // failure anyone gets to take back.
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

  const result = await runInvoiceReminders(new Date());

  // Counts only — never an address, a name, or a tenant (S9).
  return Response.json(result);
}
