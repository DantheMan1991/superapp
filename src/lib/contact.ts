import "server-only";
import { applyDevGuard } from "@/lib/email/send";
import { ipKey, overPublicCap } from "@/lib/public-caps";
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
 * The caps, counted in `public_access_attempts` by `src/lib/public-caps.ts`
 * — the platform's one ledger for anonymous public actions, shared with the
 * tenant websites' enquiry forms since Marketing slice 4.
 */
const CAP = {
  kind: ATTEMPT_KIND,
  hourlyIpCap: CONTACT_HOURLY_IP_CAP,
  dailyCap: CONTACT_DAILY_CAP,
};

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
  if (await overPublicCap(CAP, ipKey(ip))) return { ok: false, reason: "capped" };

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
