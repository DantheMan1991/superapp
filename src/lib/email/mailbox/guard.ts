import { isLiveSendEnvironment } from "@/lib/email/send";

/**
 * Environment guards for the mailbox host.
 *
 * The send spine has had a guard since day one: outside production every
 * recipient is rewritten to EMAIL_DEV_REDIRECT, and sending refuses outright
 * if that is unset. The mailbox path shipped without an equivalent, which left
 * a worse hole than the one that guard was written for — a branch preview
 * could reach a real mail host and act on a real domain.
 *
 * Three operations, three different answers, chosen by how recoverable each
 * mistake is:
 *
 *   activate  — REFUSED outside production, with no escape hatch. There is no
 *               legitimate reason to redirect a domain's mail from a preview
 *               deployment, and the mistake is not undoable from inside the
 *               app: it means editing DNS at a registrar and waiting for the
 *               internet to catch up while the business's mail goes nowhere.
 *
 *   delete    — REFUSED outside production. Deleting a mailbox destroys the
 *               correspondence inside it at the host. Nothing to redirect and
 *               nothing to take back.
 *
 *   create    — ALLOWED, but the invitation is redirected to EMAIL_DEV_REDIRECT
 *               and refused if that is unset. Creating a mailbox is reversible;
 *               mailing a setup link to a real person is not. This mirrors
 *               applyDevGuard exactly, deliberately reusing the same variable
 *               so there is one thing to configure and one thing to remember.
 *
 * `isLiveSendEnvironment` is imported rather than reimplemented because it
 * encodes a trap worth encoding once: Vercel builds preview deployments with
 * NODE_ENV=production, so keying on NODE_ENV would treat every branch preview
 * as live. Two copies of that logic would drift, and the drift would be silent.
 */

export interface MailboxGuardEnv {
  vercelEnv?: string;
  nodeEnv?: string;
  redirect?: string;
}

function currentEnv(): MailboxGuardEnv {
  return {
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
    redirect: process.env.EMAIL_DEV_REDIRECT,
  };
}

/**
 * The MX cutover. Production or nothing.
 *
 * Returns a sentence to show the owner when blocked, or null when allowed.
 */
export function guardCutover(env: MailboxGuardEnv = currentEnv()): string | null {
  if (isLiveSendEnvironment(env)) return null;
  return (
    "Switching a domain's mail over is only possible from the live app. " +
    "This is a preview or development environment, and a cutover here would " +
    "redirect real mail."
  );
}

/** Destroying a mailbox and the mail in it. Production or nothing. */
export function guardMailboxDeletion(
  env: MailboxGuardEnv = currentEnv(),
): string | null {
  if (isLiveSendEnvironment(env)) return null;
  return (
    "Deleting a mailbox is only possible from the live app — it would destroy " +
    "real mail at the mail host."
  );
}

/**
 * Where a setup invitation may actually be sent.
 *
 * In production, wherever the owner said. Outside it, the developer's own
 * address — or nowhere at all, if none is configured. The mailbox still gets
 * created either way, so the flow stays testable; it is only the message to a
 * human that is diverted.
 */
export function guardInviteAddress(
  inviteEmail: string,
  env: MailboxGuardEnv = currentEnv(),
): { inviteEmail: string; redirected: boolean } | { blocked: string } {
  if (isLiveSendEnvironment(env)) {
    return { inviteEmail, redirected: false };
  }
  if (!env.redirect) {
    return {
      blocked:
        "Refusing to send a mailbox invitation outside production without " +
        "EMAIL_DEV_REDIRECT. See SETUP.md.",
    };
  }
  return { inviteEmail: env.redirect, redirected: true };
}
