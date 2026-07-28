import Link from "next/link";
import { EyeOff, Paperclip, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TenantContext } from "@/lib/auth";
import { hasRemoteContent } from "../render/sanitize";
import type { JmapEmail, JmapMailbox } from "@/lib/email/jmap/types";
import { KEYWORD_FLAGGED, KEYWORD_SEEN } from "@/lib/email/jmap/types";
import { mailAttachmentPolicy } from "../render/attachment-policy";
import { blobExpiry, signBlobClaim } from "../render/signing";
import { MessageFrame } from "./message-frame";
import { MessageActions } from "./message-actions";
import { ThreadLinks } from "./thread-links";

/**
 * The open message.
 *
 * A server component: it already has the message from the same load that built
 * the list, so fetching again from the client would be a second round trip for
 * data we are holding. The only client code here is the frame, which exists to
 * measure a height.
 */

function addressLine(list: JmapEmail["to"]): string {
  return list.map((a) => a.name || a.email).join(", ");
}

export function ReadingPane({
  ctx,
  message,
  accountId,
  mailboxId,
  folders,
  showImages,
  showImagesHref,
}: {
  ctx: TenantContext;
  message: JmapEmail;
  accountId: string;
  mailboxId: string;
  folders: JmapMailbox[];
  showImages: boolean;
  showImagesHref: string;
}) {
  const tenantId = ctx.tenant.id;
  const clerkUserId = ctx.userId;
  const sender = message.from[0];
  const expiresAt = blobExpiry();

  // Inline parts are already rendered inside the body; the chips below are the
  // things a person downloads.
  const attachments = message.attachments.filter(
    (a) => a.disposition !== "inline" || !a.cid,
  );

  const archive = folders.find((f) => f.role === "archive");
  const trash = folders.find((f) => f.role === "trash");

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-5 py-4">
        <h2 className="text-lg font-semibold tracking-tight">
          {message.subject || (
            <span className="italic text-muted-foreground">No subject</span>
          )}
        </h2>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium">{sender?.name || sender?.email}</span>
          {sender?.name && (
            <span className="text-muted-foreground">{sender.email}</span>
          )}
          {message.receivedAt && (
            <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground">
              {message.receivedAt.toLocaleString()}
            </span>
          )}
        </div>
        {message.to.length > 0 && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            To {addressLine(message.to)}
          </p>
        )}

        <div className="mt-3">
          <MessageActions
            mailboxId={mailboxId}
            emailId={message.id}
            seen={message.keywords[KEYWORD_SEEN] === true}
            flagged={message.keywords[KEYWORD_FLAGGED] === true}
            archiveFolderId={archive?.id ?? null}
            trashFolderId={trash?.id ?? null}
          />
        </div>

        {/* The differentiator, and deliberately here rather than below the fold:
            an inbox that cannot put a thread next to the invoice it is about is
            a worse Gmail. */}
        <ThreadLinks
          ctx={ctx}
          mailboxId={mailboxId}
          mailAccountId={accountId}
          emailId={message.id}
          threadId={message.threadId}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {/*
          Rendered by the PARENT, never inside the frame. A bar drawn by the
          message could be forged by the message — a fake "images blocked"
          notice is a perfectly good phishing button.
        */}
        {!showImages && message.htmlBody && hasRemoteContent(message.htmlBody) && (
          <div className="mx-5 mt-4 flex flex-wrap items-center gap-2 rounded-md border bg-secondary/40 px-3 py-2 text-sm">
            <EyeOff className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 text-muted-foreground">
              Images are blocked so the sender can&apos;t tell you opened this.
            </span>
            <Link
              href={showImagesHref}
              className="font-medium underline underline-offset-2"
            >
              Show images
            </Link>
          </div>
        )}

        <div className="px-5 py-4">
          <MessageFrame
            src={`/api/mail/${accountId}/messages/${encodeURIComponent(message.id)}/body${
              showImages ? "?images=1" : ""
            }`}
            title={message.subject || "Message"}
          />
        </div>

        {attachments.length > 0 && (
          <div className="border-t px-5 py-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <Paperclip className="size-4 text-muted-foreground" />
              {attachments.length}{" "}
              {attachments.length === 1 ? "attachment" : "attachments"}
            </h3>
            <ul className="flex flex-wrap gap-2">
              {attachments.map((part) => {
                if (!part.blobId) return null;
                const policy = mailAttachmentPolicy(
                  part.type,
                  part.name ?? "attachment",
                );
                const query = new URLSearchParams({
                  type: policy.servedType,
                  name: policy.fileName,
                  disp: policy.disposition,
                  exp: String(expiresAt),
                  sig: signBlobClaim({
                    tenantId,
                    clerkUserId,
                    mailAccountId: accountId,
                    blobId: part.blobId,
                    servedType: policy.servedType,
                    fileName: policy.fileName,
                    disposition: policy.disposition,
                    expiresAt,
                  }),
                });
                return (
                  <li key={part.partId ?? part.blobId}>
                    <a
                      href={`/api/mail/${accountId}/blob/${encodeURIComponent(part.blobId)}?${query}`}
                      // The link downloads; it never navigates the app to
                      // attacker-supplied bytes.
                      download={policy.fileName}
                      className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent/40"
                    >
                      <span className="max-w-[220px] truncate">
                        {policy.fileName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {Math.max(1, Math.round(part.size / 1024))} KB
                      </span>
                      {policy.warn && (
                        // Named plainly rather than blocked: it is the user's
                        // own mail, and they may genuinely need the file.
                        <Badge variant="secondary" className="gap-1">
                          <ShieldAlert className="size-3" />
                          Risky
                        </Badge>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
