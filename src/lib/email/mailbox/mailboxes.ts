import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, withSystem } from "@/db";
import type { Mailbox, MailboxDomain } from "@/db/schema";
import { emailDomainOf, looksLikeEmail, normalizeLocalPart } from "@/lib/email/identity";
import { getMailboxHost } from "./index";
import { guardInviteAddress, guardMailboxDeletion } from "./guard";
import { loadHostedDomain, type ProvisionResult } from "./provisioning";

/**
 * Creating and removing the actual addresses.
 *
 * Deliberately usable BEFORE the domain is cut over. The correct migration
 * order is mailboxes first, MX second: if the MX flips while dan@acme.com does
 * not yet exist at the new host, his mail does not queue politely — it bounces
 * back to whoever sent it, and the sender is told the address is invalid.
 * Building every mailbox first makes the cutover the only moment anything
 * changes, and makes it instant rather than a scramble.
 */

/** Anything but a domain the host has already refused. */
function domainUsable(row: MailboxDomain): boolean {
  return row.status !== "failed";
}

export async function createTenantMailbox(
  tenantId: string,
  input: { localPart: string; displayName: string; inviteEmail: string },
): Promise<ProvisionResult<{ mailbox: Mailbox; invitedTo: string }>> {
  const domainRow = await loadHostedDomain(tenantId);
  if (!domainRow) {
    return { ok: false, message: "Set up a hosted domain first." };
  }
  if (!domainUsable(domainRow)) {
    return {
      ok: false,
      message: "This domain was rejected by the mail host — fix that first.",
    };
  }

  const localPart = normalizeLocalPart(input.localPart);
  if (!localPart) {
    return {
      ok: false,
      message:
        "The part before the @ can only use letters, numbers, dots, dashes and underscores.",
    };
  }

  const inviteEmail = input.inviteEmail.trim();
  if (!looksLikeEmail(inviteEmail)) {
    return { ok: false, message: "That doesn't look like an email address." };
  }
  // The setup link has to reach a mailbox that already works. Sending it to an
  // address on the domain being provisioned is a locked-room puzzle: you would
  // need the new mailbox in order to open the new mailbox.
  if (emailDomainOf(inviteEmail) === domainRow.domain) {
    return {
      ok: false,
      message: `The invitation has to go somewhere they can already read — a personal address, not one at ${domainRow.domain}.`,
    };
  }

  // Validated against what the owner typed, then diverted. The check above
  // must see the real address — telling someone their own address is invalid
  // because a dev redirect happens to live on the same domain would be a
  // baffling error to receive.
  const guarded = guardInviteAddress(inviteEmail);
  if ("blocked" in guarded) return { ok: false, message: guarded.blocked };

  const address = `${localPart}@${domainRow.domain}`;

  const existing = await withSystem((tx) =>
    tx.query.mailboxes.findFirst({
      where: and(
        eq(schema.mailboxes.tenantId, tenantId),
        eq(schema.mailboxes.mailboxDomainId, domainRow.id),
        eq(schema.mailboxes.localPart, localPart),
      ),
    }),
  );
  if (existing) {
    return { ok: false, message: `${address} already exists.` };
  }

  const host = getMailboxHost(domainRow.provider);
  const created = await host.createMailbox(domainRow.domain, {
    localPart,
    displayName: input.displayName.trim().slice(0, 120),
    inviteEmail: guarded.inviteEmail,
  });
  if (!created.ok) return { ok: false, message: created.message };

  const mailbox = await withSystem(async (tx) => {
    const [inserted] = await tx
      .insert(schema.mailboxes)
      .values({
        tenantId,
        mailboxDomainId: domainRow.id,
        localPart,
        address,
        displayName: created.data.displayName,
        // The host has it; it just has no password until the invitation is
        // accepted. "active" here means "exists and will receive mail".
        status: "active",
        maySend: created.data.maySend,
        mayReceive: created.data.mayReceive,
        mayAccessImap: created.data.mayAccessImap,
        invitePending: true,
      })
      .returning();
    return inserted;
  });

  // Reports where the link ACTUALLY went, not where it was addressed. A
  // redirect the UI hides is a redirect someone waits on forever.
  return { ok: true, data: { mailbox, invitedTo: guarded.inviteEmail } };
}

/**
 * Destroy a mailbox and everything in it.
 *
 * The host call happens FIRST and the local row is only removed if it
 * succeeded. The other order leaves an address that still receives mail with
 * nothing in the app that knows it exists — an invisible mailbox is worse than
 * a stale row, because nobody will think to go looking for it.
 */
export async function deleteTenantMailbox(
  tenantId: string,
  mailboxId: string,
): Promise<ProvisionResult<{ address: string }>> {
  const blocked = guardMailboxDeletion();
  if (blocked) return { ok: false, message: blocked };

  const row = await withSystem((tx) =>
    tx.query.mailboxes.findFirst({
      where: and(
        eq(schema.mailboxes.tenantId, tenantId),
        eq(schema.mailboxes.id, mailboxId),
      ),
    }),
  );
  if (!row) return { ok: false, message: "That mailbox no longer exists." };

  const domainRow = await loadHostedDomain(tenantId);
  if (!domainRow) {
    return { ok: false, message: "No hosted domain for this mailbox." };
  }

  const host = getMailboxHost(domainRow.provider);
  const deleted = await host.deleteMailbox(domainRow.domain, row.localPart);
  if (!deleted.ok) return { ok: false, message: deleted.message };

  await withSystem((tx) =>
    tx
      .delete(schema.mailboxes)
      .where(
        and(
          eq(schema.mailboxes.tenantId, tenantId),
          eq(schema.mailboxes.id, mailboxId),
        ),
      ),
  );

  return { ok: true, data: { address: row.address } };
}

/**
 * Reconcile what we think exists against what the host says exists.
 *
 * Two systems drift — someone adds an alias in the host's own panel, a create
 * half-fails, a delete is retried. This reports the difference rather than
 * silently "fixing" it, because both directions of automatic repair are
 * destructive: deleting local rows hides real mailboxes, and creating remote
 * ones resurrects addresses somebody deliberately removed.
 */
export async function reconcileMailboxes(tenantId: string): Promise<
  ProvisionResult<{ onlyLocal: string[]; onlyRemote: string[]; inSync: number }>
> {
  const domainRow = await loadHostedDomain(tenantId);
  if (!domainRow) return { ok: false, message: "No hosted domain." };

  const host = getMailboxHost(domainRow.provider);
  const remote = await host.listMailboxes(domainRow.domain);
  if (!remote.ok) return { ok: false, message: remote.message };

  const local = await withSystem((tx) =>
    tx
      .select()
      .from(schema.mailboxes)
      .where(eq(schema.mailboxes.tenantId, tenantId)),
  );

  const localParts = new Set(local.map((m) => m.localPart));
  const remoteParts = new Set(remote.data.map((m) => m.localPart));

  return {
    ok: true,
    data: {
      onlyLocal: [...localParts].filter((p) => !remoteParts.has(p)).sort(),
      onlyRemote: [...remoteParts].filter((p) => !localParts.has(p)).sort(),
      inSync: [...localParts].filter((p) => remoteParts.has(p)).length,
    },
  };
}
