import "server-only";
import type { MailAccount } from "@/db/schema";
import { authorizedClient } from "@/lib/email/oauth/accounts";
import type { JmapClient } from "@/lib/email/jmap/client";
import type { JmapEmail, JmapMailbox } from "@/lib/email/jmap/types";
import { KEYWORD_FLAGGED, KEYWORD_SEEN } from "@/lib/email/jmap/types";
import { loadConnection } from "@/lib/email/oauth/accounts";
import { toJmapFilter, type MailViewQuery } from "./organise/filters";

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
  /**
   * Every mailbox this message is in. Carried so the list can show LABELS —
   * a label is a mailbox, so the chips are derived from this rather than
   * fetched. See `organise/labels.ts`.
   */
  mailboxIds: Record<string, boolean>;
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
  /**
   * The address this connection sends and receives as — the address of the
   * ACCOUNT being read, which on a delegated shared mailbox is the shared
   * address rather than the reader's own. It is what stops a reply-all
   * including the mailbox it is being sent from.
   */
  selfAddress: string;
  /**
   * True when this is a mailbox somebody was granted rather than their own.
   *
   * Carried on the view because three settings are per-ACCOUNT on the mail
   * server — rules, auto-reply and signature — so on a shared box they belong
   * to everybody using it. The UI has to say so, and in the case of rules
   * refuse outright; see `rules/actions.ts` for why that one is different.
   */
  isDelegated: boolean;
  /**
   * The signature from the mail server's Identity, fetched ONLY when a composer
   * is open. Signatures live on the server rather than in a table of ours, and
   * paying a round trip for one on every inbox render would be a cost every
   * reader carries for a feature only writers use.
   */
  signature: string;
  /**
   * The identity's `htmlSignature`, when it has one — the rich composer prefers
   * it, since a signature somebody built in another client carries their links
   * and their layout and rebuilding it from the text version would throw both
   * away. UNSANITIZED here on purpose: it is markup from the mail server bound
   * for a message we are about to send, so it goes through
   * `sanitizeOutboundHtml` at the point it is composed into a draft, not on the
   * way out of a loader.
   */
  htmlSignature: string;
  /**
   * The display name on the identity being sent from, for `{{me.name}}`.
   *
   * Empty when the mail server names no display name, which is common — the
   * placeholder is then left unfilled rather than substituted blank, so the
   * writer sees the gap while there is still someone there to fix it.
   */
  senderName: string;
}

export type MailViewResult =
  | MailView
  | { ok: false; message: string; needsReauth?: boolean; account: MailAccount };

/**
 * The address of the account this client acts on.
 *
 * Falls back to `username` when the session does not name the account, which is
 * the pre-delegation behaviour and correct for a personal mailbox — the two are
 * the same address there.
 */
function actingAddress(client: JmapClient): string {
  const acting = client.session.accounts.find((a) => a.id === client.accountId);
  const name = acting?.name ?? "";
  return name.includes("@") ? name : client.session.username;
}

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
    mailboxIds: email.mailboxIds,
  };
}

export interface MailViewParams {
  tenantId: string;
  clerkUserId: string;
  mailboxId?: string;
  messageId?: string;
  /** Search term and filter chips, already parsed out of the URL. */
  view?: MailViewQuery;
  position?: number;
  /** True when a composer is open, so the signature is worth fetching. */
  composing?: boolean;
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

  // The filter comes from one place — `toJmapFilter` — so the URL, the JMAP
  // query and a saved search cannot drift apart. It also owns the rule that a
  // text term spans the account while a filter narrows the current folder.
  const listed = await client.data.queryEmails({
    filter: toJmapFilter(params.view ?? {}, selected?.id ?? null),
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

  let signature = "";
  let htmlSignature = "";
  /** The display name on the identity, for `{{me.name}}`. */
  let senderName = "";
  if (params.composing) {
    const identities = await client.data.identities();
    // A missing signature is not a reason to refuse to compose. If the server
    // will not tell us, the composer opens without one — which is exactly what
    // an empty signature looks like anyway.
    if (identities.ok) {
      // Matched against the address of the ACCOUNT being read, not against the
      // session's `username`. On a delegated shared mailbox those differ — the
      // username is the delegate's own address and the identities all belong to
      // the shared account, so matching on it never hit and the code reached
      // `[0]` by accident. Same class as the `selfAddress` bug the delegation
      // slice fixed; it happened to pick the right identity and would stop the
      // moment a shared box had two.
      const self = actingAddress(client.data).trim().toLowerCase();
      const identity =
        identities.data.find((i) => i.email.trim().toLowerCase() === self) ??
        identities.data[0];
      signature = identity?.textSignature ?? "";
      htmlSignature = identity?.htmlSignature ?? "";
      senderName = identity?.name ?? "";
    }
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
    // The address of the account BEING READ, not of the token holding it open.
    // On a delegated shared mailbox those differ, and using `username` would
    // leave `info@` in the recipients of a reply-all sent from `info@` — the
    // mailbox mailing itself — while dropping the reader's own address, which
    // is the one case they might genuinely want to keep.
    selfAddress: actingAddress(client.data),
    isDelegated: client.data.isDelegated,
    signature,
    htmlSignature,
    senderName,
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
