import "server-only";
import { and, eq, lte } from "drizzle-orm";
import { schema, withSystem, withTenant } from "@/db";
import type { MailAccount } from "@/db/schema";
import { authorizedClient } from "@/lib/email/oauth/accounts";
import type { JmapClient } from "@/lib/email/jmap/client";
import type { JmapMailbox } from "@/lib/email/jmap/types";
import { SNOOZE_FOLDER_NAME } from "./snooze-times";

/**
 * Putting mail out of sight until a date, and bringing it back.
 *
 * THE MESSAGE REALLY MOVES, into a folder called Snoozed on the mail server.
 * Hiding it in Yosher's list instead would have been a fraction of this code
 * and quietly wrong: the same mailbox is open on a phone and in Outlook, and
 * mail that is only hidden in one client has not been dealt with.
 *
 * The consequence to keep in mind while reading this file is that the mail
 * server holds the truth and `mail_snoozes` is only a reminder. Every failure
 * here is designed to leave the message somewhere a person can find it, even
 * when that means leaving the row behind.
 */

/** The Snoozed folder for this account, created on first use. */
async function snoozeFolder(
  client: JmapClient,
  folders: JmapMailbox[],
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const existing = folders.find(
    (f) => f.parentId === null && f.name.toLowerCase() === SNOOZE_FOLDER_NAME.toLowerCase(),
  );
  if (existing) return { ok: true, id: existing.id };

  const created = await client.createMailbox(SNOOZE_FOLDER_NAME, null);
  if (!created.ok) return { ok: false, message: created.message };
  return { ok: true, id: created.data.id };
}

export interface SnoozeOutcome {
  moved: number;
  requested: number;
}

/**
 * Move messages out of sight, and remember where they came from.
 *
 * ORDER MATTERS AND IS NOT NEGOTIABLE: the mail server moves first, and rows
 * are only written for messages it confirms. The other order would record a
 * reminder for a message still sitting in the inbox, and the sweep would later
 * "return" it to a folder it never left — moving mail nobody asked to move.
 */
export async function snoozeMessages(input: {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
  account: MailAccount;
  client: JmapClient;
  emailIds: string[];
  returnToMailboxId: string;
  dueAt: Date;
}): Promise<{ ok: true; data: SnoozeOutcome } | { ok: false; message: string }> {
  const folders = await input.client.listMailboxes();
  if (!folders.ok) return { ok: false, message: folders.message };

  const folder = await snoozeFolder(input.client, folders.data);
  if (!folder.ok) return folder;

  const moved = await input.client.moveToMailbox(input.emailIds, folder.id);
  if (!moved.ok) return { ok: false, message: moved.message };

  const confirmed = moved.data.updated;
  if (confirmed.length > 0) {
    await withTenant(
      input.tenantId,
      async (tx) => {
        await tx
          .insert(schema.mailSnoozes)
          .values(
            confirmed.map((emailId: string) => ({
              tenantId: input.tenantId,
              clerkUserId: input.userId,
              mailAccountId: input.account.id,
              emailId,
              returnToMailboxId: input.returnToMailboxId,
              snoozeMailboxId: folder.id,
              dueAt: input.dueAt,
            })),
          )
          // Snoozing something already snoozed is a double-click, not a second
          // intention. The newest time wins, which is what re-snoozing means.
          .onConflictDoUpdate({
            target: [
              schema.mailSnoozes.tenantId,
              schema.mailSnoozes.clerkUserId,
              schema.mailSnoozes.mailAccountId,
              schema.mailSnoozes.emailId,
            ],
            set: {
              dueAt: input.dueAt,
              returnToMailboxId: input.returnToMailboxId,
              snoozeMailboxId: folder.id,
            },
          });
      },
      { role: input.role, userId: input.userId },
    );
  }

  return {
    ok: true,
    data: { moved: confirmed.length, requested: input.emailIds.length },
  };
}

export interface WakeOutcome {
  woken: number;
  accounts: number;
  failed: number;
}

/**
 * Bring back everything that is due.
 *
 * Runs from a cron with no session, so it reads under withSystem() like the
 * mail-sync sweep beside it. RLS is not standing behind this code, which is why
 * it groups strictly by `mail_account_id` and only ever asks a client about the
 * rows belonging to its own account.
 *
 * IDEMPOTENT BY CONSTRUCTION. The row is deleted only after the mail server
 * confirms the move, so a run that dies halfway leaves rows whose messages are
 * already back in the inbox — and the next run asks the server to move them to
 * a folder they are already in, which is a no-op that reports success. Waking
 * twice is harmless; deleting the row first and then failing would strand the
 * message in Snoozed with nothing left to remember it.
 */
export async function wakeDueSnoozes(
  now: Date,
  limit: number,
): Promise<WakeOutcome> {
  const due = await withSystem((tx) =>
    tx
      .select()
      .from(schema.mailSnoozes)
      .where(lte(schema.mailSnoozes.dueAt, now))
      .orderBy(schema.mailSnoozes.dueAt)
      .limit(limit),
  );
  if (due.length === 0) return { woken: 0, accounts: 0, failed: 0 };

  const byAccount = new Map<string, typeof due>();
  for (const row of due) {
    const list = byAccount.get(row.mailAccountId) ?? [];
    list.push(row);
    byAccount.set(row.mailAccountId, list);
  }

  let woken = 0;
  let failed = 0;

  for (const [accountId, rows] of byAccount) {
    const account = await withSystem((tx) =>
      tx.query.mailAccounts.findFirst({
        where: eq(schema.mailAccounts.id, accountId),
      }),
    );
    if (!account) {
      // The connection is gone but the mail is not — it is sitting in a folder
      // called Snoozed where anyone would think to look. Drop the reminders;
      // there is nothing left that could act on them.
      await withSystem((tx) =>
        tx.delete(schema.mailSnoozes).where(eq(schema.mailSnoozes.mailAccountId, accountId)),
      );
      continue;
    }

    const client = await authorizedClient(account);
    if (!client.ok) {
      // Left alone deliberately. A token that needs refreshing is a temporary
      // condition, and the next sweep will try again — whereas a message woken
      // into the wrong place, or a row deleted here, cannot be undone.
      failed += rows.length;
      continue;
    }

    // Grouped by destination, because most of a batch returns to the same
    // inbox and one Email/set beats one per message.
    const byDestination = new Map<string, string[]>();
    for (const row of rows) {
      const list = byDestination.get(row.returnToMailboxId) ?? [];
      list.push(row.emailId);
      byDestination.set(row.returnToMailboxId, list);
    }

    for (const [destination, emailIds] of byDestination) {
      const moved = await client.data.moveToMailbox(emailIds, destination);
      if (!moved.ok) {
        failed += emailIds.length;
        continue;
      }
      const confirmed = new Set(moved.data.updated);
      const settled = rows.filter(
        (row) => row.returnToMailboxId === destination && confirmed.has(row.emailId),
      );
      failed += emailIds.length - confirmed.size;
      if (settled.length === 0) continue;

      await withSystem(async (tx) => {
        for (const row of settled) {
          await tx
            .delete(schema.mailSnoozes)
            .where(
              and(
                eq(schema.mailSnoozes.tenantId, row.tenantId),
                eq(schema.mailSnoozes.id, row.id),
              ),
            );
        }
      });
      woken += settled.length;
    }
  }

  return { woken, accounts: byAccount.size, failed };
}
