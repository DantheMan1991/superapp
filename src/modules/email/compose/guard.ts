import { isLiveSendEnvironment } from "@/lib/email/send";

/**
 * What a composed message is allowed to actually reach, outside production.
 *
 * This is the third answer in a family. `applyDevGuard` protects the outbound
 * spine, `mailbox/guard.ts` protects the mail host, and this protects a person
 * typing a message in the app. All three reuse `isLiveSendEnvironment`, and the
 * reuse is the point: it encodes the trap that Vercel builds preview
 * deployments with `NODE_ENV=production`, so keying on NODE_ENV would treat
 * every branch preview as live — and a preview is exactly where somebody tries
 * out a new compose screen.
 *
 * WHY THIS IS BETTER THAN `applyDevGuard`, rather than a copy of it. That one
 * rewrites the `to` HEADER and mangles the subject, which is right for a
 * transactional send where the header and the envelope are the same thing. It
 * is wrong here for two reasons:
 *
 *   - A composed message is a DRAFT the person can see, and it is filed into
 *     their Sent folder afterwards. Rewriting the header would make Sent hold a
 *     record of a message they never wrote, addressed to a developer.
 *   - The whole point of testing compose is seeing the real message.
 *
 * So this rewrites the **envelope** — SMTP `RCPT TO`, which JMAP models as
 * `EmailSubmission.envelope.rcptTo` — and leaves `To:`/`Cc:`/`Bcc:` untouched.
 * The developer sees a truthful message, Sent holds a truthful record, and
 * delivery goes only to them. The envelope and the headers disagreeing is not a
 * trick: it is exactly how a mailing list, a bcc, and every forwarding rule on
 * the internet already work.
 *
 * Pure and environment-injected, so the Vercel-preview trap is testable without
 * a Vercel preview.
 */

export interface ComposeGuardEnv {
  vercelEnv?: string;
  nodeEnv?: string;
  redirect?: string;
}

function currentEnv(): ComposeGuardEnv {
  return {
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
    redirect: process.env.EMAIL_DEV_REDIRECT,
  };
}

export type GuardedEnvelope =
  | {
      /** Who the mail server will actually deliver to. */
      rcptTo: string[];
      /** True when these are not the addresses the person typed. */
      redirected: boolean;
    }
  | { blocked: string };

/**
 * Decide the envelope recipients for a composed message.
 *
 * In production: exactly who the message is addressed to. Outside it: the
 * developer, once, however many people the headers name — or **refused
 * outright** when `EMAIL_DEV_REDIRECT` is unset.
 *
 * Refusing rather than falling back is the same call `applyDevGuard` made and
 * for the same reason: the failure mode of guessing is mailing a real customer
 * from somebody's laptop, and that is not a mistake you get to take back. A
 * compose screen that refuses to send is annoying; one that quietly mails a
 * client during a demo is a phone call to the founder.
 */
export function guardComposedRecipients(
  headerRecipients: readonly string[],
  env: ComposeGuardEnv = currentEnv(),
): GuardedEnvelope {
  const real = [
    ...new Set(
      headerRecipients
        .map((r) => r.trim())
        .filter((r) => r.length > 0)
        .map((r) => r.toLowerCase()),
    ),
  ];

  if (isLiveSendEnvironment(env)) {
    if (real.length === 0) {
      return { blocked: "That message has no recipients." };
    }
    return { rcptTo: real, redirected: false };
  }

  if (!env.redirect) {
    return {
      blocked:
        "Refusing to send outside production without EMAIL_DEV_REDIRECT. See SETUP.md.",
    };
  }
  // Still refuse an empty message, even in dev — otherwise the one path that
  // never gets exercised locally is the one that matters in production.
  if (real.length === 0) {
    return { blocked: "That message has no recipients." };
  }
  return { rcptTo: [env.redirect.trim().toLowerCase()], redirected: true };
}

/**
 * A line for the composer, so nobody discovers the redirect by wondering where
 * their test message went.
 *
 * Returns null in production, where there is nothing to say.
 */
export function devDeliveryNotice(
  env: ComposeGuardEnv = currentEnv(),
): string | null {
  if (isLiveSendEnvironment(env)) return null;
  if (!env.redirect) {
    return "Sending is disabled here — EMAIL_DEV_REDIRECT isn't set.";
  }
  return `Not production: this will be delivered only to ${env.redirect}, whatever the To line says.`;
}
