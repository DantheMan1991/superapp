"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Archive, Flag, Loader2, Mail, MailOpen, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { KEYWORD_FLAGGED, KEYWORD_SEEN } from "@/lib/email/jmap/types";
import { moveMessagesAction, setKeywordAction } from "../actions";

/**
 * What you can do to the open message.
 *
 * No optimistic state. The house pattern is `useTransition` + `router.refresh()`
 * and it is right here for a reason beyond consistency: these actions change
 * what the MAIL SERVER holds, and the same mailbox may be open on a phone. A
 * local guess that diverges from the server is worse in a mail client than a
 * few hundred milliseconds of waiting, because the thing it would be wrong
 * about is whether a message still exists.
 */
export function MessageActions({
  mailboxId,
  emailId,
  seen,
  flagged,
  archiveFolderId,
  trashFolderId,
}: {
  mailboxId: string;
  emailId: string;
  seen: boolean;
  flagged: boolean;
  archiveFolderId: string | null;
  trashFolderId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(
    fn: () => Promise<{ ok: true } | { error: string }>,
    message: string,
    clearSelection = false,
  ) {
    startTransition(async () => {
      const result = await fn();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(message);
      if (clearSelection) {
        // The message is no longer where the URL says it is.
        const url = new URL(window.location.href);
        url.searchParams.delete("message");
        router.replace(`${url.pathname}${url.search}`);
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {pending && (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          run(
            () =>
              setKeywordAction({
                mailboxId,
                emailIds: [emailId],
                keyword: KEYWORD_SEEN,
                on: !seen,
              }),
            seen ? "Marked unread" : "Marked read",
          )
        }
      >
        {seen ? <Mail className="size-4" /> : <MailOpen className="size-4" />}
        {seen ? "Unread" : "Read"}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          run(
            () =>
              setKeywordAction({
                mailboxId,
                emailIds: [emailId],
                keyword: KEYWORD_FLAGGED,
                on: !flagged,
              }),
            flagged ? "Flag removed" : "Flagged",
          )
        }
      >
        <Flag className={flagged ? "size-4 fill-current" : "size-4"} />
        {flagged ? "Unflag" : "Flag"}
      </Button>

      {archiveFolderId && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              () =>
                moveMessagesAction({
                  mailboxId,
                  emailIds: [emailId],
                  targetMailboxId: archiveFolderId,
                }),
              "Archived",
              true,
            )
          }
        >
          <Archive className="size-4" />
          Archive
        </Button>
      )}

      {trashFolderId && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              () =>
                moveMessagesAction({
                  mailboxId,
                  emailIds: [emailId],
                  targetMailboxId: trashFolderId,
                }),
              // "Moved to trash", not "Deleted" — it is recoverable, and saying
              // otherwise makes people hesitate over a reversible action.
              "Moved to trash",
              true,
            )
          }
        >
          <Trash2 className="size-4" />
          Trash
        </Button>
      )}
    </div>
  );
}
