import "server-only";
import type { JmapClient } from "@/lib/email/jmap/client";
import type {
  JmapEmailAddress,
  JmapIdentity,
  JmapMailbox,
} from "@/lib/email/jmap/types";
import { MailError } from "../core/errors";
import { guardComposedRecipients } from "./guard";

/**
 * The send seam.
 *
 * Everything a message needs between "somebody pressed Send" and the protocol
 * call: which identity it goes out as, which folders it lives in, and — the
 * part that matters — **who it is actually delivered to**.
 *
 * THE ENVELOPE IS BUILT HERE AND NOWHERE ELSE. `guardComposedRecipients` runs
 * inside this function, on the header recipients, and its answer is handed
 * straight to the client. No caller supplies an envelope and no caller can
 * bypass one: `JmapComposedMessage.envelopeRcptTo` is only ever populated on
 * this line. That is what makes "a branch preview cannot mail a real customer"
 * a property of the code rather than a habit — there is one door and the guard
 * is standing in it.
 */

export interface ComposeInput {
  to: JmapEmailAddress[];
  cc: JmapEmailAddress[];
  bcc: JmapEmailAddress[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  inReplyTo?: string[];
  references?: string[];
  attachments?: { blobId: string; type: string; name: string }[];
  /**
   * Pictures the html body references with `cid:`. Kept apart from
   * `attachments` because the MIME they need is a different SHAPE — the client
   * builds an explicit `multipart/related` for them, which is the only tree a
   * `cid:` reference resolves in.
   */
  inlineImages?: { blobId: string; cid: string; type: string; name: string }[];
}

export interface SendOutcome {
  emailId: string;
  submissionId: string;
  /** True when the dev guard redirected delivery away from the real recipients. */
  redirected: boolean;
  /** Where it was actually delivered, so the UI never has to guess. */
  deliveredTo: string[];
}

/** The identity to send as: the one matching this mailbox, else the first. */
export function pickIdentity(
  identities: readonly JmapIdentity[],
  address: string,
): JmapIdentity | null {
  if (identities.length === 0) return null;
  const wanted = address.trim().toLowerCase();
  return (
    identities.find((i) => i.email.trim().toLowerCase() === wanted) ??
    identities[0]
  );
}

function roleId(folders: readonly JmapMailbox[], role: string): string | null {
  return folders.find((f) => f.role === role)?.id ?? null;
}

/**
 * Send a composed message.
 *
 * The order is deliberate: everything that can be refused is refused BEFORE the
 * message is created on the server, so a failure leaves nothing behind. The one
 * exception is submission itself, which can only fail after the draft exists —
 * and the client says so in its message rather than reporting a bare failure.
 */
export async function sendComposedMessage(
  client: JmapClient,
  mailboxAddress: string,
  input: ComposeInput,
): Promise<SendOutcome> {
  if (!client.supportsSubmission()) {
    throw new MailError(
      "SEND_UNSUPPORTED",
      "server does not advertise the submission capability",
    );
  }

  const headerRecipients = [...input.to, ...input.cc, ...input.bcc].map(
    (a) => a.email,
  );

  // The guard, before anything is created. Refusing here costs a typed message
  // that is still on screen; refusing after creation would leave an orphan
  // draft, and refusing after submission would be too late to matter.
  const envelope = guardComposedRecipients(headerRecipients);
  if ("blocked" in envelope) {
    throw new MailError("SEND_BLOCKED", envelope.blocked);
  }

  const folders = await client.listMailboxes();
  if (!folders.ok) throw new MailError("MAIL_SERVER_UNREACHABLE", folders.message);
  const draftsId = roleId(folders.data, "drafts");
  if (!draftsId) {
    // Every message is created as a draft first, so there is nowhere to put it.
    throw new MailError("NO_DRAFTS_FOLDER", "no mailbox with role=drafts");
  }
  const sentId = roleId(folders.data, "sent");

  const identities = await client.identities();
  if (!identities.ok) {
    throw new MailError(
      identities.needsReauth ? "ACCOUNT_NEEDS_REAUTH" : "SEND_UNSUPPORTED",
      identities.message,
    );
  }
  const identity = pickIdentity(identities.data, mailboxAddress);
  if (!identity) {
    throw new MailError("SEND_UNSUPPORTED", "no identity to send as");
  }

  const sent = await client.sendMessage({
    identityId: identity.id,
    from: { name: identity.name || null, email: identity.email },
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    textBody: input.textBody,
    ...(input.htmlBody ? { htmlBody: input.htmlBody } : {}),
    ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
    ...(input.references ? { references: input.references } : {}),
    ...(input.attachments ? { attachments: input.attachments } : {}),
    ...(input.inlineImages && input.inlineImages.length > 0
      ? { inlineImages: input.inlineImages }
      : {}),
    draftsMailboxId: draftsId,
    ...(sentId ? { sentMailboxId: sentId } : {}),
    // The ONLY place this is populated. See the file header.
    envelopeRcptTo: envelope.rcptTo,
  });
  if (!sent.ok) {
    throw new MailError(
      sent.needsReauth ? "ACCOUNT_NEEDS_REAUTH" : "SEND_FAILED",
      sent.message,
    );
  }

  return {
    emailId: sent.data.emailId,
    submissionId: sent.data.submissionId,
    redirected: envelope.redirected,
    deliveredTo: envelope.rcptTo,
  };
}
