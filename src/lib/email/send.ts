import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { schema, withSystem } from "@/db";
import { getResend } from "@/lib/resend";
import {
  emailDomainOf,
  looksLikeEmail,
  resolveSender,
  type SenderIdentity,
} from "./identity";

/**
 * The one way the platform sends mail.
 *
 * Every caller — share links today, invoices and signature requests later —
 * goes through here, so the identity rules, the caps, the dev guard and the
 * send log cannot be bypassed by adding a feature.
 *
 * Transport is a seam. Today there is one implementation (the provider's API,
 * sending either as the tenant's verified domain or as ours). A future
 * "send through the tenant's own connected mailbox" transport slots in here
 * without touching a single caller.
 */

export type EmailKind =
  | "share_link"
  | "invoice"
  | "esign"
  | "test"
  /**
   * An automatic invoice reminder. Separate from `invoice` deliberately: it is
   * the only kind sent with NO human at the keyboard, so being able to count,
   * cap or stop reminders without touching invoice sends is worth a value in
   * the union. Off by default per tenant — see accounting_settings.
   */
  | "invoice_reminder"
  /**
   * An owner testing the reminder wording on themselves. Its own kind so it is
   * trivially separable in the log and can never be counted as a reminder the
   * customer received — the recipient always comes from `profiles`, never from
   * anything typed into a form.
   */
  | "invoice_reminder_test"
  /**
   * The daily digest. The only kind sent to OUR OWN users rather than to a
   * tenant's customers — which is why it goes from the platform domain and not
   * from the tenant's, and why its recipient always came from `profiles`
   * rather than from anything typed into a form.
   */
  | "digest"
  /**
   * A message from the tenant's own website, forwarded to the tenant. Like
   * the digest it goes to OUR OWN users rather than to a customer: the
   * recipient is the site's contact email or the owners' profiles, never
   * anything the visitor typed. Reply-To is the visitor, so answering works.
   */
  | "enquiry";

/** Per tenant, per hour. A valve, not accounting. */
export const TENANT_HOURLY_CAP = 100;
/** Platform-wide, per day. Also the provider bill's ceiling. */
export const GLOBAL_DAILY_CAP = 2000;

export interface SendEmailInput {
  tenantId: string;
  kind: EmailKind;
  to: string;
  subject: string;
  text: string;
  html?: string;
  /**
   * Makes a retried action a no-op rather than a second email. Callers should
   * derive it from what the message IS — "share:<id>:<recipient>" — not from a
   * timestamp or a random value.
   */
  idempotencyKey: string;
  replyTo?: string | null;
  /**
   * Files to attach. For a document the recipient is expecting — an invoice —
   * not a way to ship data around: the total is capped below, and the cap is
   * far under the provider's so a rejected send is our error message rather
   * than theirs.
   */
  attachments?: ReadonlyArray<{ filename: string; content: Uint8Array }>;
}

/** Total attachment bytes per message. Resend allows 40MB; we allow far less. */
export const MAX_ATTACHMENT_BYTES = 5_000_000;

export type SendResult =
  | { ok: true; id: string; duplicate: boolean; sentAs: SenderIdentity }
  | { ok: false; reason: "invalid_recipient" | "capped" | "not_configured" | "failed"; message: string };

function platformDomain(): string | null {
  return process.env.EMAIL_FROM_DOMAIN ?? null;
}

/**
 * Everywhere except real production, every recipient is rewritten to
 * EMAIL_DEV_REDIRECT with the real address moved into the subject.
 *
 * This is not a nicety. Without it, the first person to run the share-email
 * flow against a seeded local database — or from a branch preview — sends real
 * mail to a real client, and that is not a mistake you get to take back. If
 * the redirect is not set outside production, sending refuses entirely.
 */
/**
 * Only ONE environment may mail real people.
 *
 * NODE_ENV is not the test for it. Vercel builds preview deployments with
 * NODE_ENV=production, so keying on it would treat every branch preview as
 * live — and a preview is exactly where someone tries out share-emailing.
 * VERCEL_ENV is the variable that actually distinguishes them
 * (production | preview | development); NODE_ENV is only the fallback for
 * running outside Vercel.
 */
export function isLiveSendEnvironment(env: {
  vercelEnv?: string;
  nodeEnv?: string;
}): boolean {
  if (env.vercelEnv) return env.vercelEnv === "production";
  return env.nodeEnv === "production";
}

export function applyDevGuard(
  to: string,
  subject: string,
  env: { nodeEnv?: string; vercelEnv?: string; redirect?: string } = {
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    redirect: process.env.EMAIL_DEV_REDIRECT,
  },
): { to: string; subject: string } | { blocked: string } {
  if (isLiveSendEnvironment(env)) return { to, subject };
  const redirect = env.redirect;
  if (!redirect) {
    return {
      blocked:
        "Refusing to send outside production without EMAIL_DEV_REDIRECT. See SETUP.md.",
    };
  }
  return { to: redirect, subject: `[dev -> ${to}] ${subject}` };
}

function hoursAgo(now: Date, n: number): Date {
  return new Date(now.getTime() - n * 60 * 60 * 1000);
}

function startOfUtcDay(now: Date): Date {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  if (!looksLikeEmail(input.to)) {
    return {
      ok: false,
      reason: "invalid_recipient",
      message: "That doesn't look like an email address.",
    };
  }

  const attachmentBytes = (input.attachments ?? []).reduce(
    (sum, a) => sum + a.content.byteLength,
    0,
  );
  if (attachmentBytes > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      reason: "failed",
      message: "That attachment is too large to email.",
    };
  }

  const domain = platformDomain();
  if (!domain) {
    return {
      ok: false,
      reason: "not_configured",
      message: "Email isn't configured yet — add EMAIL_FROM_DOMAIN. See SETUP.md.",
    };
  }
  if (!process.env.RESEND_API_KEY) {
    return {
      ok: false,
      reason: "not_configured",
      message: "Email isn't configured yet — add RESEND_API_KEY. See SETUP.md.",
    };
  }

  const guarded = applyDevGuard(input.to, input.subject);
  if ("blocked" in guarded) {
    return { ok: false, reason: "not_configured", message: guarded.blocked };
  }

  // One transaction: idempotency claim, caps, and the queued row. Concurrent
  // callers serialize on the unique key rather than both sending.
  const claim = await withSystem(async (tx) => {
    const existing = await tx.query.outboundEmails.findFirst({
      where: and(
        eq(schema.outboundEmails.tenantId, input.tenantId),
        eq(schema.outboundEmails.idempotencyKey, input.idempotencyKey),
      ),
    });
    if (existing) return { duplicate: true as const, row: existing };

    const now = new Date();
    const [{ n: tenantCount }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.outboundEmails)
      .where(
        and(
          eq(schema.outboundEmails.tenantId, input.tenantId),
          gte(schema.outboundEmails.createdAt, hoursAgo(now, 1)),
        ),
      );
    if (tenantCount >= TENANT_HOURLY_CAP) {
      return { capped: true as const };
    }
    const [{ n: globalCount }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.outboundEmails)
      .where(gte(schema.outboundEmails.createdAt, startOfUtcDay(now)));
    if (globalCount >= GLOBAL_DAILY_CAP) {
      return { capped: true as const };
    }

    const tenant = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.id, input.tenantId),
    });
    const verified = await tx.query.emailDomains.findFirst({
      where: and(
        eq(schema.emailDomains.tenantId, input.tenantId),
        eq(schema.emailDomains.status, "verified"),
      ),
    });

    const sender = resolveSender({
      tenantName: tenant?.name ?? "Yosher",
      verifiedDomain: verified
        ? {
            domain: verified.domain,
            fromLocalPart: verified.fromLocalPart,
            fromName: verified.fromName,
          }
        : null,
      tenantReplyTo: input.replyTo ?? null,
      platformDomain: domain,
    });

    const rows = await tx
      .insert(schema.outboundEmails)
      .values({
        tenantId: input.tenantId,
        kind: input.kind,
        toAddress: input.to,
        toDomain: emailDomainOf(input.to),
        subject: input.subject,
        fromAddress: sender.fromAddress,
        fromTenantDomain: sender.kind === "tenant_domain",
        idempotencyKey: input.idempotencyKey,
        status: "queued",
      })
      // A concurrent caller won the race; treat it as the duplicate it is.
      .onConflictDoNothing()
      .returning();

    if (rows.length === 0) return { duplicate: true as const, row: null };
    return { row: rows[0], sender };
  });

  if ("capped" in claim) {
    return {
      ok: false,
      reason: "capped",
      message: "That's the sending limit for now — try again shortly.",
    };
  }
  if ("duplicate" in claim) {
    return {
      ok: true,
      id: claim.row?.id ?? "",
      duplicate: true,
      sentAs: {
        kind: claim.row?.fromTenantDomain ? "tenant_domain" : "platform",
        from: claim.row?.fromAddress ?? "",
        fromAddress: claim.row?.fromAddress ?? "",
      },
    };
  }

  const { row, sender } = claim;

  // Network work happens AFTER the transaction commits — the house rule.
  try {
    const result = await getResend().emails.send({
      from: sender.from,
      to: [guarded.to],
      subject: guarded.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
      ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
      ...(input.attachments?.length
        ? {
            attachments: input.attachments.map((a) => ({
              filename: a.filename,
              content: Buffer.from(a.content),
            })),
          }
        : {}),
    });

    if (result.error) {
      await markFailed(row.id, result.error.message ?? "provider error");
      return {
        ok: false,
        reason: "failed",
        message: "The email couldn't be sent. Check the send log for details.",
      };
    }

    await withSystem((tx) =>
      tx
        .update(schema.outboundEmails)
        .set({
          status: "sent",
          providerMessageId: result.data?.id ?? null,
          updatedAt: new Date(),
        })
        .where(eq(schema.outboundEmails.id, row.id)),
    );

    return { ok: true, id: row.id, duplicate: false, sentAs: sender };
  } catch (err) {
    await markFailed(row.id, err instanceof Error ? err.message : "unknown");
    return {
      ok: false,
      reason: "failed",
      message: "The email couldn't be sent. Check the send log for details.",
    };
  }
}

async function markFailed(id: string, error: string): Promise<void> {
  try {
    await withSystem((tx) =>
      tx
        .update(schema.outboundEmails)
        .set({ status: "failed", error: error.slice(0, 500), updatedAt: new Date() })
        .where(eq(schema.outboundEmails.id, id)),
    );
  } catch (err) {
    console.error("could not record email failure", err);
  }
}

/** The send log for a tenant's own settings page. */
export async function listOutboundEmails(tenantId: string, limit = 50) {
  return withSystem((tx) =>
    tx
      .select()
      .from(schema.outboundEmails)
      .where(eq(schema.outboundEmails.tenantId, tenantId))
      .orderBy(sql`${schema.outboundEmails.createdAt} desc`)
      .limit(limit),
  );
}
