import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { schema, withSystem } from "@/db";
import { applyDevGuard } from "@/lib/email/send";
import { getResend } from "@/lib/resend";
import { CONTACT, SITE } from "@/lib/site";

/**
 * The public contact form's send path.
 *
 * This does NOT go through `src/lib/email/send.ts`, and that is deliberate.
 * That module is the one way *tenant* mail is sent: it resolves the sending
 * identity from the tenant's verified domain, caps per tenant, and writes a
 * per-tenant send log. A website enquiry has no tenant — there is nobody to
 * key any of that on, and inventing a tenant to satisfy the shape would put a
 * fake row in the outbound log.
 *
 * What it does reuse is the part that actually protects people: `applyDevGuard`
 * from that same module, so a branch preview or a local dev server can never
 * mail a real address.
 *
 * Recipient is fixed by configuration and never taken from the request, so
 * this cannot be turned into an open relay. The caps below exist to protect
 * the inbox and the provider bill from a bot, not to stop a redirect attack.
 */

/** Submissions tolerated from one IP per hour. */
export const CONTACT_HOURLY_IP_CAP = 5;
/** Submissions accepted platform-wide per day. Protects the provider bill. */
export const CONTACT_DAILY_CAP = 200;

const ATTEMPT_KIND = "contact_form";

export interface ContactSubmission {
  name: string;
  email: string;
  business: string | null;
  message: string;
}

export type ContactResult =
  | { ok: true }
  | { ok: false; reason: "capped" | "not_configured" | "failed" };

/**
 * The platform's salt for anonymising IPs before they are stored.
 *
 * The env var is named for the health check because that is what first needed
 * it; it is the platform's only anonymous-IP salt and is shared by every public
 * surface. Missing salt does not disable the form — it drops the per-IP key and
 * leans on the global daily cap instead, because "we can't rate limit you" is
 * not a good reason to refuse to hear from a customer.
 */
function ipKey(ip: string): string {
  const salt = process.env.INTERVIEW_IP_SALT;
  if (!salt) return "unsalted";
  return createHash("sha256").update(`${salt}${ip}`).digest("hex");
}

function hoursAgo(now: Date, n: number): Date {
  return new Date(now.getTime() - n * 60 * 60 * 1000);
}

function startOfUtcDay(now: Date): Date {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

/**
 * Record the attempt and report whether it is over either cap.
 *
 * Reuses `public_access_attempts` — the platform's existing table for counting
 * anonymous public actions — rather than adding a table for one form. Runs
 * under `withSystem` because the row belongs to no tenant; the only identifier
 * involved is an already-hashed IP.
 *
 * Counting inside the same transaction as the insert means concurrent
 * submissions serialize rather than both slipping through. Races exactly at the
 * boundary are accepted: this is a valve, not accounting.
 */
async function overCap(ipHash: string): Promise<boolean> {
  const now = new Date();
  return withSystem(async (tx) => {
    await tx
      .insert(schema.publicAccessAttempts)
      .values({ kind: ATTEMPT_KIND, ipHash });

    const [perIp] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.publicAccessAttempts)
      .where(
        and(
          eq(schema.publicAccessAttempts.kind, ATTEMPT_KIND),
          eq(schema.publicAccessAttempts.ipHash, ipHash),
          gte(schema.publicAccessAttempts.createdAt, hoursAgo(now, 1)),
        ),
      );
    if (ipHash !== "unsalted" && perIp.n > CONTACT_HOURLY_IP_CAP) return true;

    const [perDay] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.publicAccessAttempts)
      .where(
        and(
          eq(schema.publicAccessAttempts.kind, ATTEMPT_KIND),
          gte(schema.publicAccessAttempts.createdAt, startOfUtcDay(now)),
        ),
      );
    return perDay.n > CONTACT_DAILY_CAP;
  });
}

/** Where enquiries land. Never derived from the request. */
function destination(): string {
  return process.env.CONTACT_INBOX ?? CONTACT.email;
}

function body(sub: ContactSubmission): string {
  return [
    `From:     ${sub.name} <${sub.email}>`,
    sub.business ? `Business: ${sub.business}` : null,
    "",
    sub.message,
    "",
    "—",
    `Sent from the ${SITE.name} contact form. Reply directly to reach them.`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export async function submitContactEnquiry(
  sub: ContactSubmission,
  ip: string,
): Promise<ContactResult> {
  if (await overCap(ipKey(ip))) return { ok: false, reason: "capped" };

  const fromDomain = process.env.EMAIL_FROM_DOMAIN;
  if (!fromDomain || !process.env.RESEND_API_KEY) {
    console.error(
      "Contact form is not configured — needs EMAIL_FROM_DOMAIN and RESEND_API_KEY. See SETUP.md.",
    );
    return { ok: false, reason: "not_configured" };
  }

  const subject = `Website enquiry — ${sub.name}${sub.business ? ` (${sub.business})` : ""}`;
  const guarded = applyDevGuard(destination(), subject);
  if ("blocked" in guarded) {
    console.error(`Contact form: ${guarded.blocked}`);
    return { ok: false, reason: "not_configured" };
  }

  try {
    const sent = await getResend().emails.send({
      from: `${SITE.name} website <noreply@${fromDomain}>`,
      to: guarded.to,
      subject: guarded.subject,
      text: body(sub),
      // The whole point: hit reply and you are talking to the person who
      // filled in the form, not to a noreply mailbox.
      replyTo: `${sub.name} <${sub.email}>`,
    });
    if (sent.error) {
      console.error("Contact form send failed", sent.error);
      return { ok: false, reason: "failed" };
    }
    return { ok: true };
  } catch (err) {
    console.error("Contact form send threw", err);
    return { ok: false, reason: "failed" };
  }
}
