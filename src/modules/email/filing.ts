import "server-only";
import type { JmapClient } from "@/lib/email/jmap/client";
import type { JmapEmail } from "@/lib/email/jmap/types";
import type {
  FiledAttachmentInput,
  FiledMessageInput,
} from "@/lib/mail-extensions/types";
import { sanitizeFileName } from "@/lib/file-headers";
import { MailError } from "./core/errors";
import { buildTranscript } from "./render/transcript";

/**
 * Turning a live message into the neutral payload a filing target understands.
 *
 * This is the only place in the linking path that speaks JMAP. Everything past
 * it — the Documents extension, `mail_links`, the UI — deals in bytes, strings
 * and dates, which is what lets a second filing target exist one day without
 * learning a mail protocol.
 *
 * All of it runs OUTSIDE any transaction. Fetching a message and its
 * attachments is several round trips to a mail server; holding a Postgres
 * transaction open across them is the house rule this codebase has repeated
 * since blob ingestion.
 */

/**
 * How much of one message we are willing to pull into memory.
 *
 * A serverless function has a fixed budget and an attachment is the one thing in
 * this product that can be arbitrarily large. These are download caps, not
 * policy: an attachment refused here is still inside the `.eml`, which is filed
 * whole. Nothing is lost, it is only unindexed — so the caps can be
 * conservative without costing anybody a file.
 */
export const MAX_RAW_MESSAGE_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 40 * 1024 * 1024;

export interface BuiltMessage {
  input: FiledMessageInput;
  /**
   * Attachments MAIL declined to fetch — too large, or the mail server would not
   * give them up. Separate from the allowlist rejections the filing target
   * reports, because the two have different causes and a person deserves to know
   * which happened.
   */
  skipped: number;
}

/**
 * Attachments worth filing as documents of their own.
 *
 * Inline parts are excluded by the same rule the reading pane uses: a `cid:`
 * logo is part of the message's rendering, not a file anybody wants in the
 * cabinet. It is still inside the `.eml`.
 */
export function filableAttachments(message: JmapEmail) {
  return message.attachments.filter(
    (a) => a.blobId !== null && (a.disposition !== "inline" || !a.cid),
  );
}

export async function buildFiledMessage(
  client: JmapClient,
  message: JmapEmail,
  /** What the thread is being attached to. Passed straight through; mail has no
   *  opinion about whether the filing target can make use of it. */
  target?: FiledMessageInput["target"],
): Promise<BuiltMessage> {
  if (message.size > MAX_RAW_MESSAGE_BYTES) {
    throw new MailError(
      "MESSAGE_TOO_LARGE",
      `raw message ${message.size} bytes exceeds cap`,
    );
  }

  // `Email.blobId` is the whole RFC 5322 message — headers, MIME structure,
  // every part, exactly as it arrived. That completeness is the reason a copy is
  // worth making: it is the message, not our rendering of it.
  const raw = await client.downloadBlob(
    message.blobId,
    "message.eml",
    "message/rfc822",
  );
  if (!raw.ok) {
    throw new MailError(
      raw.needsReauth ? "ACCOUNT_NEEDS_REAUTH" : "MAIL_SERVER_UNREACHABLE",
      raw.message,
    );
  }
  const rawBytes = new Uint8Array(await raw.data.arrayBuffer());
  if (rawBytes.byteLength > MAX_RAW_MESSAGE_BYTES) {
    // The advertised size was wrong or absent. Checked again against what
    // actually arrived, because the first check trusted the server's own
    // metadata and this one does not.
    throw new MailError("MESSAGE_TOO_LARGE", "raw message exceeded cap on read");
  }

  const attachments: FiledAttachmentInput[] = [];
  let skipped = 0;
  let budget = MAX_TOTAL_ATTACHMENT_BYTES;

  for (const part of filableAttachments(message)) {
    if (part.size > MAX_ATTACHMENT_BYTES || part.size > budget) {
      skipped += 1;
      continue;
    }
    const name = sanitizeFileName(part.name ?? "attachment");
    const fetched = await client.downloadBlob(part.blobId!, name, part.type);
    if (!fetched.ok) {
      // One unreachable attachment must not lose the message. The `.eml` still
      // contains it; the cabinet just does not get its own row for it.
      skipped += 1;
      continue;
    }
    const bytes = new Uint8Array(await fetched.data.arrayBuffer());
    if (bytes.byteLength > budget) {
      skipped += 1;
      continue;
    }
    budget -= bytes.byteLength;
    attachments.push({ fileName: name, mimeType: part.type, bytes });
  }

  const transcript = buildTranscript({
    subject: message.subject,
    from: message.from,
    to: message.to,
    cc: message.cc,
    receivedAt: message.receivedAt,
    textBody: message.textBody,
    htmlBody: message.htmlBody,
    attachmentNames: filableAttachments(message).map((a) =>
      sanitizeFileName(a.name ?? "attachment"),
    ),
    truncated: message.bodyTruncated,
  });

  const sender = message.from[0];
  return {
    skipped,
    input: {
      ...(target ? { target } : {}),
      messageId: message.id,
      threadId: message.threadId,
      // RFC 5322 Message-Id: stable across servers and across a re-import, which
      // the mail server's own opaque id is not. Arrays or null, never a bare
      // string — verified against a live server.
      rfcMessageId: message.messageId?.[0] ?? "",
      subject: message.subject,
      fromAddress: sender?.email ?? "",
      fromName: sender?.name ?? null,
      to: message.to.map((a) => a.email),
      cc: message.cc.map((a) => a.email),
      receivedAt: message.receivedAt,
      transcript,
      raw: rawBytes,
      attachments,
    },
  };
}
