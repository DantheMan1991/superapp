import "server-only";
import { isMigaduConfigured, migaduHost } from "./migadu";
import { stalwartHost } from "./stalwart";
import type { MailboxHost } from "./types";

export type * from "./types";
export { isMigaduConfigured };

/**
 * Which host holds a tenant's mail. Lazy and keyless-safe, like getResend():
 * the app must build and boot with no mail-host credentials configured, and
 * every caller already handles the "not configured" result.
 *
 * Takes the provider from the row rather than from an env var so a future
 * migration to a self-hosted server can move one tenant at a time instead of
 * flipping the whole platform at once.
 */
export function getMailboxHost(provider: string = "migadu"): MailboxHost {
  switch (provider) {
    case "migadu":
      return migaduHost;
    case "stalwart":
      return stalwartHost;
    default:
      // Failing loudly beats silently mailing through the wrong host.
      throw new Error(`No mailbox host implementation for "${provider}".`);
  }
}

/**
 * Which host a NEW domain is provisioned against.
 *
 * The default above answers "who holds this existing row's mail", and reading
 * it from the row is what lets tenants move one at a time. But a domain being
 * created has no row yet, and `createHostedDomain()` called `getMailboxHost()`
 * with no argument — so every domain was provisioned against Migadu whatever
 * the platform actually ran, and the caller then stored `migadu` as the row's
 * provider, making the wrong answer permanent.
 *
 * That is a one-way mistake: the records the wizard renders are MX records,
 * and publishing the wrong ones points a live domain's mail at a host that
 * is not holding its mailboxes.
 *
 * Unset keeps the historical behaviour, so nothing already provisioned moves.
 */
export function defaultMailboxProvider(): string {
  return process.env.MAILBOX_PROVIDER?.trim() || "migadu";
}
