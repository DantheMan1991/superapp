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
