import "server-only";
import { eq, lte } from "drizzle-orm";
import { schema, withSystem } from "@/db";
import { authorizedClient } from "@/lib/email/oauth/accounts";
import { logAudit } from "@/lib/audit";
import { releaseHeldMessage } from "../compose/send";

/**
 * Send the messages whose time has come.
 *
 * Rides the existing mail-sync cron rather than getting one of its own, the same
 * arrangement `wakeDueSnoozes` has. The reason has expired: Hobby ran each cron
 * ONCE A DAY, so a second job could not have made anything more punctual. Off
 * Hobby (confirmed 2026-08-06) it could — see the note in the cron route for
 * why the split waits for the digest rather than happening piecemeal.
 *
 * **THE ORDERING IS THE OPPOSITE OF THE SNOOZE SWEEP'S, and deliberately so.**
 * Snooze deletes its row only after the move is confirmed, because waking twice
 * is a no-op and stranding a message is not. Here the row is deleted FIRST,
 * inside its own transaction, before the submission is attempted — because the
 * failure modes are reversed:
 *
 *   • Row deleted, send fails → a finished message sits in Drafts, unsent. The
 *     person finds it where they would look, and sends it by hand.
 *   • Send succeeds, row survives → the NEXT sweep sends it AGAIN. The same
 *     message goes to a customer twice, and there is no undoing that.
 *
 * One of those is an inconvenience and the other is a mistake you have to
 * apologise for, so the claim is taken before the irreversible act rather than
 * after it. That is the same reasoning the outbound spine's idempotency key
 * encodes, applied where no natural key exists.
 *
 * It runs under `withSystem` — no session, no user — which is the documented
 * exception for trusted background code. RLS is not standing behind this, so it
 * submits each draft through the account its own row names and nothing else.
 */

export interface ScheduledSendOutcome {
  sent: number;
  failed: number;
  accounts: number;
}

export async function sendDueMessages(
  now: Date,
  limit: number,
): Promise<ScheduledSendOutcome> {
  const due = await withSystem((tx) =>
    tx
      .select()
      .from(schema.mailScheduledSends)
      .where(lte(schema.mailScheduledSends.sendAt, now))
      .orderBy(schema.mailScheduledSends.sendAt)
      .limit(limit),
  );
  if (due.length === 0) return { sent: 0, failed: 0, accounts: 0 };

  const byAccount = new Map<string, typeof due>();
  for (const row of due) {
    const list = byAccount.get(row.mailAccountId) ?? [];
    list.push(row);
    byAccount.set(row.mailAccountId, list);
  }

  let sent = 0;
  let failed = 0;

  for (const [accountId, rows] of byAccount) {
    const account = await withSystem((tx) =>
      tx.query.mailAccounts.findFirst({
        where: eq(schema.mailAccounts.id, accountId),
      }),
    );
    if (!account) {
      // The connection is gone but the drafts are not — they are in the mail
      // server's Drafts folder, which is where anyone would look. Drop the
      // reminders; nothing left here could act on them.
      await withSystem((tx) =>
        tx
          .delete(schema.mailScheduledSends)
          .where(eq(schema.mailScheduledSends.mailAccountId, accountId)),
      );
      continue;
    }

    const client = await authorizedClient(account);
    if (!client.ok) {
      // Left alone deliberately, exactly like the snooze sweep. A token needing
      // refresh is temporary and the next sweep will try again — whereas a row
      // deleted here would leave a message queued in nobody's mind.
      failed += rows.length;
      continue;
    }

    for (const row of rows) {
      // CLAIM FIRST. See the header: sending twice is the outcome that cannot
      // be undone, so the row goes before the submission is attempted.
      const claimed = await withSystem((tx) =>
        tx
          .delete(schema.mailScheduledSends)
          .where(eq(schema.mailScheduledSends.id, row.id))
          .returning({ id: schema.mailScheduledSends.id }),
      );
      // Another sweep took it first. Two workers is not a thing today, but the
      // check costs nothing and it is what makes the claim a claim.
      if (claimed.length === 0) continue;

      try {
        const recipients = Array.isArray(row.envelopeRcptTo)
          ? (row.envelopeRcptTo as string[])
          : [];
        if (recipients.length === 0) {
          failed += 1;
          continue;
        }
        // The guard runs again in here, over the stored envelope. A message
        // queued days ago is released by a cron with no memory of the composer,
        // and EMAIL_DEV_REDIRECT refusing to mail a real customer from a preview
        // has to hold at the moment the message actually leaves.
        await releaseHeldMessage(
          client.data,
          {
            emailId: row.emailId,
            identityId: row.identityId,
            fromEmail: row.fromEmail,
            draftsMailboxId: row.draftsMailboxId,
            sentMailboxId: row.sentMailboxId,
          },
          recipients,
        );
        sent += 1;

        await logAudit({
          action: "mail.sent",
          tenantId: row.tenantId,
          actorClerkUserId: row.clerkUserId,
          targetType: "mailbox",
          targetId: row.mailAccountId,
          meta: {
            emailId: row.emailId,
            recipients: recipients.length,
            scheduled: true,
          },
        });
      } catch (err) {
        // The draft survives in Drafts, which is the recoverable half of the
        // trade the ordering above makes. Logged loudly because nothing else
        // will surface it — nobody is watching a cron.
        failed += 1;
        console.error(
          `scheduled send failed for email ${row.emailId} on account ${accountId}`,
          err,
        );
      }
    }
  }

  return { sent, failed, accounts: byAccount.size };
}
