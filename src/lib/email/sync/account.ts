import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, withSystem } from "@/db";
import type { MailAccount } from "@/db/schema";
import { authorizedClient } from "@/lib/email/oauth/accounts";
import type { JmapClient } from "@/lib/email/jmap/client";
import type { JmapEmail } from "@/lib/email/jmap/types";

/**
 * Keeping `mail_thread_index` and the unread badge current.
 *
 * WHAT THIS IS FOR, because it is easy to mistake for a mirror: the mail server
 * owns the mail. It threads, searches and sorts better than a copy of it would,
 * and every read in the inbox goes straight to it. This index exists so a
 * MODULE can ask "every thread on this invoice" as a SQL join instead of
 * fetching thread ids and then asking the mail server about each one. Without
 * it the business-object integration degrades into N+1 protocol calls, and that
 * integration is the whole reason this product exists rather than Gmail.
 *
 * So the rows here are derived, lossy and monotonic. Nothing reads them to
 * decide what a message SAYS.
 *
 * House rule observed throughout: **network work never happens inside a
 * transaction.** Every JMAP call completes first, then the writes go in.
 */

/** Don't re-sync an account more often than this unless forced. */
export const MIN_SYNC_INTERVAL_MS = 60_000;
/** JMAP caps a get at 500; changes are paged well inside that. */
const CHANGES_PAGE = 200;
/** Stop after this many change pages in one run, so one account cannot hog a cron invocation. */
const MAX_PAGES = 10;

export interface SyncOutcome {
  ok: boolean;
  skipped?: boolean;
  /** True when the account's state string was unchanged — the cheap exit. */
  unchanged?: boolean;
  indexed?: number;
  unread?: number;
  message?: string;
  needsReauth?: boolean;
}

/** Self, so a thread's participant list is other people rather than you. */
function selfAddresses(client: JmapClient, account: MailAccount): Set<string> {
  const out = new Set<string>();
  if (client.session.username) out.add(client.session.username.toLowerCase());
  if (account.jmapAccountId) {
    // accountName is often the address on servers that populate it.
    const name = client.session.accountName?.toLowerCase();
    if (name?.includes("@")) out.add(name);
  }
  return out;
}

interface ThreadFacts {
  threadId: string;
  subject: string;
  participants: { name: string | null; email: string }[];
  lastMessageAt: Date | null;
  hasAttachment: boolean;
  messageCount: number;
}

/**
 * Fold a batch of messages into one row per thread.
 *
 * Two deliberate lies, both in the over-inclusive direction, because the two
 * mistakes are not symmetric:
 *
 *  - `hasAttachment` is sticky-true. If the only attachment-bearing message in
 *    a thread is deleted, the flag stays set until a full resync. A filter that
 *    returns a thread with no attachment costs a click; one that hides the
 *    thread carrying the file somebody needs costs the job.
 *  - `participants` never shrinks, for the same reason.
 */
export function foldThreads(
  emails: readonly JmapEmail[],
  self: ReadonlySet<string>,
): Map<string, ThreadFacts> {
  const byThread = new Map<string, ThreadFacts>();

  for (const email of emails) {
    if (!email.threadId) continue;
    const existing = byThread.get(email.threadId);
    const people = [...email.from, ...email.to, ...email.cc].filter(
      (a) => a.email && !self.has(a.email.toLowerCase()),
    );

    if (!existing) {
      byThread.set(email.threadId, {
        threadId: email.threadId,
        subject: email.subject,
        participants: people,
        lastMessageAt: email.receivedAt,
        hasAttachment: email.hasAttachment,
        messageCount: 1,
      });
      continue;
    }

    // A thread's identity is its OPENING subject. Rewriting it on every reply
    // makes the list jitter for no gain.
    if (existing.subject.length === 0) existing.subject = email.subject;
    existing.participants.push(...people);
    existing.hasAttachment = existing.hasAttachment || email.hasAttachment;
    existing.messageCount += 1;
    // receivedAt, never sentAt — sentAt is the sender's claim and is spoofable.
    if (
      email.receivedAt &&
      (!existing.lastMessageAt || email.receivedAt > existing.lastMessageAt)
    ) {
      existing.lastMessageAt = email.receivedAt;
    }
  }

  // Dedupe participants case-insensitively, first-seen name wins, capped.
  for (const facts of byThread.values()) {
    const seen = new Map<string, { name: string | null; email: string }>();
    for (const person of facts.participants) {
      const key = person.email.toLowerCase();
      const prior = seen.get(key);
      if (!prior) seen.set(key, person);
      else if (!prior.name && person.name) seen.set(key, person);
    }
    facts.participants = [...seen.values()].slice(0, 20);
  }

  return byThread;
}

async function writeThreads(
  account: MailAccount,
  threads: Map<string, ThreadFacts>,
): Promise<void> {
  if (threads.size === 0) return;
  // withSystem: mail_thread_index has no member INSERT policy — these rows are
  // derived from what the mail server said, and a forgeable index would be
  // worse than none. This is trusted sync code in the S2 sense.
  await withSystem(async (tx) => {
    for (const facts of threads.values()) {
      await tx
        .insert(schema.mailThreadIndex)
        .values({
          tenantId: account.tenantId,
          mailAccountId: account.id,
          threadId: facts.threadId,
          subject: facts.subject,
          participants: facts.participants,
          lastMessageAt: facts.lastMessageAt,
          hasAttachment: facts.hasAttachment,
          messageCount: facts.messageCount,
        })
        .onConflictDoUpdate({
          target: [
            schema.mailThreadIndex.tenantId,
            schema.mailThreadIndex.mailAccountId,
            schema.mailThreadIndex.threadId,
          ],
          set: {
            // Keep the opening subject unless we never had one.
            subject: sql`case when ${schema.mailThreadIndex.subject} = '' then excluded.subject else ${schema.mailThreadIndex.subject} end`,
            participants: facts.participants,
            lastMessageAt: sql`greatest(${schema.mailThreadIndex.lastMessageAt}, excluded.last_message_at)`,
            hasAttachment: sql`${schema.mailThreadIndex.hasAttachment} or excluded.has_attachment`,
            messageCount: sql`greatest(${schema.mailThreadIndex.messageCount}, excluded.message_count)`,
            updatedAt: new Date(),
          },
        });
    }
  });
}

/**
 * Index messages we already fetched for another reason.
 *
 * The list view's `queryEmails` call has the rows in hand; handing them here
 * costs ZERO extra round trips. This is the primary writer in practice.
 *
 * It deliberately does NOT touch `lastState`: it has no idea whether it saw
 * everything, and claiming a state it cannot vouch for would make the next
 * delta skip real changes.
 */
export async function indexFromEmails(
  account: MailAccount,
  client: JmapClient,
  emails: readonly JmapEmail[],
): Promise<void> {
  if (emails.length === 0) return;
  try {
    await writeThreads(account, foldThreads(emails, selfAddresses(client, account)));
  } catch (err) {
    // Opportunistic indexing must never break the page it piggybacks on.
    console.error("mail: opportunistic index failed", err);
  }
}

/**
 * The authoritative delta.
 *
 * `currentState()` is one tiny request. When it matches what we stored, the run
 * ends there — no changes call, no gets, no writes. That cheapness is what makes
 * polling viable at all.
 */
export async function syncMailAccount(
  account: MailAccount,
  options: { force?: boolean } = {},
): Promise<SyncOutcome> {
  if (!options.force && account.lastSyncedAt) {
    const age = Date.now() - account.lastSyncedAt.getTime();
    if (age < MIN_SYNC_INTERVAL_MS) return { ok: true, skipped: true };
  }

  const client = await authorizedClient(account);
  if (!client.ok) {
    return {
      ok: false,
      message: client.message,
      ...(client.needsReauth ? { needsReauth: true } : {}),
    };
  }

  const state = await client.data.currentState();
  if (!state.ok) return { ok: false, message: state.message };

  const unchanged = state.data === account.lastState && account.lastState !== "";

  // The unread count is refreshed even on an unchanged state: it is cheap, and
  // a badge that lags a read performed on someone's phone is the most visible
  // way this feature looks broken.
  const folders = await client.data.listMailboxes();
  const inbox = folders.ok ? folders.data.find((f) => f.role === "inbox") : undefined;
  const unread = inbox?.unreadThreads ?? 0;

  if (unchanged) {
    await touchAccount(account.id, { unread, lastState: state.data });
    return { ok: true, unchanged: true, unread, indexed: 0 };
  }

  let indexed = 0;
  let cursor = account.lastState;
  let resyncNeeded = cursor === "";

  for (let page = 0; page < MAX_PAGES && !resyncNeeded; page += 1) {
    const changes = await client.data.emailChanges(cursor, CHANGES_PAGE);
    if (!changes.ok) {
      // The one error worth branching on. `takeMethodResponse` carries the JMAP
      // error TYPE precisely so this does not have to match English prose.
      if (changes.errorType === "cannotCalculateChanges") {
        resyncNeeded = true;
        break;
      }
      return { ok: false, message: changes.message };
    }

    const touched = [...changes.data.created, ...changes.data.updated];
    if (touched.length > 0) {
      const fetched = await client.data.getEmails(touched, false);
      if (!fetched.ok) return { ok: false, message: fetched.message };
      await writeThreads(
        account,
        foldThreads(fetched.data, selfAddresses(client.data, account)),
      );
      indexed += fetched.data.length;
    }

    // Destroyed messages do not remove thread rows: a thread whose last message
    // was deleted still legitimately answers "there was correspondence here",
    // and a link from an invoice to it should not evaporate.
    cursor = changes.data.newState;
    if (!changes.data.hasMoreChanges) break;
  }

  if (resyncNeeded) {
    // Full resync: the most recent slice rather than the whole mailbox. The
    // index is an aid, not an archive, and walking a decade of mail to rebuild
    // it would cost more than it is worth.
    const recent = await client.data.queryEmails({ limit: 500 });
    if (!recent.ok) return { ok: false, message: recent.message };
    await writeThreads(
      account,
      foldThreads(recent.data.emails, selfAddresses(client.data, account)),
    );
    indexed += recent.data.emails.length;
    cursor = state.data;
  }

  await touchAccount(account.id, { unread, lastState: cursor });
  return { ok: true, indexed, unread };
}

async function touchAccount(
  id: string,
  values: { unread: number; lastState: string },
): Promise<void> {
  await withSystem((tx) =>
    tx
      .update(schema.mailAccounts)
      .set({
        inboxUnread: values.unread,
        lastState: values.lastState,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.mailAccounts.id, id)),
  );
}

/** Every connection due a background sync. Ordered oldest-first so none starves. */
export async function accountsDueForSync(limit: number): Promise<MailAccount[]> {
  return withSystem((tx) =>
    tx
      .select()
      .from(schema.mailAccounts)
      .where(
        and(
          eq(schema.mailAccounts.status, "connected"),
          sql`(${schema.mailAccounts.lastSyncedAt} is null or ${schema.mailAccounts.lastSyncedAt} < now() - interval '5 minutes')`,
        ),
      )
      .orderBy(sql`${schema.mailAccounts.lastSyncedAt} asc nulls first`)
      .limit(limit),
  );
}

/** Mark a connection dead so the poller stops and the badge shows a dot. */
export async function markAccountsErrored(ids: string[], reason: string): Promise<void> {
  if (ids.length === 0) return;
  await withSystem((tx) =>
    tx
      .update(schema.mailAccounts)
      .set({ status: "needs_reauth", lastError: reason.slice(0, 500), updatedAt: new Date() })
      .where(inArray(schema.mailAccounts.id, ids)),
  );
}
