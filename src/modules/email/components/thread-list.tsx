"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Archive,
  Flag,
  Inbox as InboxIcon,
  Loader2,
  Mail,
  MailOpen,
  Paperclip,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ThreadRow } from "../read";
import { bulkAction } from "../organise-actions";
import { mailHref } from "./mail-panes";

/**
 * The thread list, with a selection.
 *
 * A client component now, where the rail is still a server one — the selection
 * is the only genuinely client-side state in this module, and it stays here
 * rather than in the URL for the one reason URL state is wrong: a list of
 * message ids is not something anybody wants to bookmark, share or restore with
 * the back button, and it would make every checkbox a navigation.
 *
 * The ROWS are still links. Selecting is a checkbox beside the link, not a mode
 * you enter, so nothing about reading mail changes when the feature exists.
 */

export function ThreadList({
  rows,
  selectedId,
  params,
  emptyMessage,
  mailboxId,
  archiveFolderId,
  trashFolderId,
}: {
  rows: ThreadRow[];
  selectedId: string | undefined;
  params: Record<string, string | undefined>;
  emptyMessage: string;
  mailboxId: string;
  archiveFolderId: string | null;
  trashFolderId: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  function toggle(id: string) {
    setSelected((prior) => {
      const next = new Set(prior);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function run(
    action: "read" | "unread" | "flag" | "unflag" | "move",
    targetMailboxId?: string,
  ) {
    const emailIds = [...selected];
    if (emailIds.length === 0) return;
    startTransition(async () => {
      const result = await bulkAction({
        mailboxId,
        emailIds,
        action,
        ...(targetMailboxId ? { targetMailboxId } : {}),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const data = result.data;
      // Partial success is reported as partial. Saying "done" when 300 of 900
      // moved is how somebody loses an afternoon looking for their mail.
      if (data && data.failed > 0) {
        toast.warning(
          `${data.updated} of ${data.requested} done — the mail server refused ${data.failed}.`,
        );
      } else {
        toast.success(`${data?.updated ?? 0} updated.`);
      }
      setSelected(new Set());
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
        <InboxIcon className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      {selected.size > 0 && (
        // Replaces nothing and covers nothing — it appears above the list, so
        // the messages you selected stay visible while you decide.
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b bg-secondary/70 px-2 py-1.5 backdrop-blur">
          <span className="px-1 text-xs font-medium tabular-nums">
            {selected.size} selected
          </span>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("read")}>
            <MailOpen className="size-3.5" />
            Read
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("unread")}>
            <Mail className="size-3.5" />
            Unread
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("flag")}>
            <Flag className="size-3.5" />
            Flag
          </Button>
          {archiveFolderId && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run("move", archiveFolderId)}
            >
              <Archive className="size-3.5" />
              Archive
            </Button>
          )}
          {trashFolderId && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run("move", trashFolderId)}
            >
              <Trash2 className="size-3.5" />
              Trash
            </Button>
          )}
          <button
            type="button"
            className="ml-auto px-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      <label className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() =>
            setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.emailId)))
          }
          className="size-3.5 accent-current"
        />
        {/* Scoped to the page, and it says so. "Select all" that silently means
            "all 4,000 in this folder" is how people trash things they meant to
            look at. */}
        Select all on this page
      </label>

      <ul className="divide-y">
        {rows.map((row) => {
          const active = row.emailId === selectedId;
          const checked = selected.has(row.emailId);
          return (
            <li key={row.emailId} className={cn("flex", active && "bg-accent")}>
              <label className="flex shrink-0 cursor-pointer items-center pl-3">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(row.emailId)}
                  className="size-3.5 accent-current"
                  aria-label={`Select ${row.subject || "message"}`}
                />
              </label>
              <Link
                // `images` is cleared: unblocking is a decision about ONE
                // message, and carrying it to the next one would silently show
                // remote content in a message nobody agreed to unblock.
                href={mailHref(params, { message: row.emailId, images: undefined })}
                className={cn(
                  "block min-w-0 flex-1 px-3 py-2.5 transition-colors",
                  active ? "" : "hover:bg-accent/40",
                )}
              >
                <div className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      row.seen ? "text-muted-foreground" : "font-semibold",
                    )}
                  >
                    {row.fromName || row.from || "Unknown sender"}
                  </span>
                  {row.flagged && (
                    <Flag className="size-3 shrink-0 fill-current text-amber-500" />
                  )}
                  {row.hasAttachment && (
                    <Paperclip className="size-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                    {listDate(row.receivedAt)}
                  </span>
                </div>
                <p
                  className={cn(
                    "truncate text-sm",
                    row.seen ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {/* A missing subject stays missing — parse.ts never invents
                      "(no subject)", so neither does this. */}
                  {row.subject || <span className="italic opacity-60">No subject</span>}
                </p>
                {row.preview && (
                  <p className="truncate text-xs text-muted-foreground">{row.preview}</p>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Dates in a mail list: time for today, day for this week, date beyond. */
function listDate(value: Date | null): string {
  if (!value) return "";
  const now = new Date();
  const sameDay = value.toDateString() === now.toDateString();
  if (sameDay) {
    return value.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const days = (now.getTime() - value.getTime()) / 86_400_000;
  if (days < 7) return value.toLocaleDateString(undefined, { weekday: "short" });
  return value.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
