import "server-only";
import type { MailAccount } from "@/db/schema";
import { authorizedClient } from "@/lib/email/oauth/accounts";
import type { JmapEmail, JmapMailbox } from "@/lib/email/jmap/types";
import { KEYWORD_FLAGGED, KEYWORD_SEEN } from "@/lib/email/jmap/types";
import { loadConnection } from "@/lib/email/oauth/accounts";

/**
 * Everything the mail view needs, in as few round trips as the protocol allows.
 *
 * The folder list and the message list are two calls because JMAP cannot batch
 * a `Mailbox/get` result into an `Email/query` filter — but the list itself is
 * ONE call rather than two, because `queryEmails` chains query→get with an
 * `#ids` back-reference. Opening a message is a third.
 *
 * Every failure is a value, never a throw: one unreachable mail server should
 * render an explanation, not an error boundary.
 */

export const PAGE_SIZE = 40;

export interface ThreadRow {
  emailId: string;
  threadId: string;
  from: string;
  fromName: string | null;
  subject: string;
  preview: string;
  receivedAt: Date | null;
  seen: boolean;
  flagged: boolean;
  hasAttachment: boolean;
}

export interface MailView {
  ok: true;
  account: MailAccount;
  folders: JmapMailbox[];
  mailboxId: string | null;
  rows: ThreadRow[];
  total: number | null;
  position: number;
  message: JmapEmail | null;
}

export type MailViewResult =
  | MailView
  | { ok: false; message: string; needsReauth?: boolean; account: MailAccount };

function toRow(email: JmapEmail): ThreadRow {
  const sender = email.from[0];
  return {
    emailId: email.id,
    threadId: email.threadId,
    from: sender?.email ?? "",
    fromName: sender?.name ?? null,
    subject: email.subject,
    preview: email.preview,
    receivedAt: email.receivedAt,
    seen: email.keywords[KEYWORD_SEEN] === true,
    flagged: email.keywords[KEYWORD_FLAGGED] === true,
    hasAttachment: email.hasAttachment,
  };
}

export interface MailViewParams {
  tenantId: string;
  clerkUserId: string;
  mailboxId?: string;
  messageId?: string;
  query?: string;
  position?: number;
}

export async function loadMailView(
  account: MailAccount,
  params: MailViewParams,
): Promise<MailViewResult> {
  const client = await authorizedClient(account);
  if (!client.ok) {
    return {
      ok: false,
      message: client.message,
      ...(client.needsReauth ? { needsReauth: true } : {}),
      account,
    };
  }

  const folders = await client.data.listMailboxes();
  if (!folders.ok) return { ok: false, message: folders.message, account };

  // Default to the Inbox. `compareMailboxes` already put it first even though
  // this server gives every default folder the same sortOrder, so falling back
  // to the head of the list is right rather than merely convenient.
  const requested = params.mailboxId
    ? folders.data.find((f) => f.id === params.mailboxId)
    : undefined;
  const selected =
    requested ?? folders.data.find((f) => f.role === "inbox") ?? folders.data[0];

  const search = params.query?.trim();
  const listed = await client.data.queryEmails({
    filter: {
      // A search spans the whole account: hunting for something you know exists
      // and being shown "no results" because you were standing in the wrong
      // folder is the worst failure a mail search has.
      ...(search ? { text: search } : selected ? { inMailbox: selected.id } : {}),
    },
    // One row per conversation, which is what a person means by "a message".
    collapseThreads: true,
    limit: PAGE_SIZE,
    position: params.position ?? 0,
  });
  if (!listed.ok) return { ok: false, message: listed.message, account };

  let message: JmapEmail | null = null;
  if (params.messageId) {
    const detail = await client.data.getEmails([params.messageId], true);
    // A message that has been moved or deleted elsewhere is not an error — the
    // pane simply shows nothing selected.
    message = detail.ok ? (detail.data[0] ?? null) : null;
  }

  return {
    ok: true,
    account,
    folders: folders.data,
    mailboxId: selected?.id ?? null,
    rows: listed.data.emails.map(toRow),
    total: listed.data.query.total,
    position: params.position ?? 0,
    message,
  };
}

/** The connection this view runs on, or null when the person has none. */
export async function resolveAccount(
  tenantId: string,
  clerkUserId: string,
  mailboxId: string,
): Promise<MailAccount | null> {
  return loadConnection(tenantId, clerkUserId, mailboxId);
}

/** Folders worth showing. A mailbox we may not read is not a folder to a user. */
export function visibleFolders(folders: JmapMailbox[]): JmapMailbox[] {
  return folders.filter((f) => f.mayReadItems);
}
