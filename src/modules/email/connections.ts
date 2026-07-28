import "server-only";
import type { MailAccount, Mailbox } from "@/db/schema";
import { listConnections } from "@/lib/email/oauth/accounts";
import { listTenantMailboxes } from "@/lib/email/mailbox/provisioning";

/**
 * What the Mail home needs to know: which addresses this person may connect,
 * and which they already have.
 *
 * The pairing happens here rather than in the page because "which mailboxes are
 * mine" is a rule, not a layout: a mailbox with a `clerkUserId` belongs to that
 * person, and a mailbox with none is shared (info@, invoices@) and connectable
 * by anyone in the business. Somebody else's personal mailbox is simply not in
 * the list — the same non-answer RLS gives for a row it hides.
 */

export interface ConnectableMailbox {
  mailbox: Mailbox;
  /** Null until this person has authorized us against it. */
  account: MailAccount | null;
  /** A box nobody owns personally — info@, accounts@, and the like. */
  shared: boolean;
}

export interface MailHomeData {
  connectable: ConnectableMailbox[];
  /**
   * Connections whose mailbox row has gone — the address was deleted at the
   * host while a connection to it survived here. Surfaced rather than filtered
   * so a dead connection can be cleared instead of haunting the list.
   */
  orphaned: MailAccount[];
  /** True when the business has no hosted mailboxes at all yet. */
  noMailboxes: boolean;
}

export async function loadMailHome(
  tenantId: string,
  clerkUserId: string,
): Promise<MailHomeData> {
  const [mailboxes, accounts] = await Promise.all([
    listTenantMailboxes(tenantId),
    listConnections(tenantId, clerkUserId),
  ]);

  const byMailboxId = new Map(accounts.map((a) => [a.mailboxId, a]));

  const connectable = mailboxes
    .filter(
      (mailbox) =>
        mailbox.clerkUserId === null || mailbox.clerkUserId === clerkUserId,
    )
    // A mailbox still provisioning has no credentials to authorize against
    // yet, and a failed one never will. Offering "Connect" on either produces
    // an error the person can do nothing about.
    .filter(
      (mailbox) => mailbox.status === "active" || mailbox.status === "suspended",
    )
    .map((mailbox) => ({
      mailbox,
      account: byMailboxId.get(mailbox.id) ?? null,
      shared: mailbox.clerkUserId === null,
    }));

  const liveMailboxIds = new Set(mailboxes.map((m) => m.id));

  return {
    connectable,
    orphaned: accounts.filter((a) => !liveMailboxIds.has(a.mailboxId)),
    noMailboxes: mailboxes.length === 0,
  };
}
