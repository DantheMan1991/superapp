import Link from "next/link";
import {
  Archive,
  Flag,
  Inbox as InboxIcon,
  Paperclip,
  Send,
  FileText,
  ShieldAlert,
  Trash2,
  Folder,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { JmapMailbox } from "@/lib/email/jmap/types";
import type { ThreadRow } from "../read";

/**
 * The folder rail and the thread list — both server components, both made of
 * links.
 *
 * State lives in the URL, exactly as it does in Documents: a folder, a search
 * and an open message are all parameters, so any view can be linked, bookmarked,
 * reloaded and reached with the back button. There is no client state to lose.
 */

const BASE = "/dashboard/m/email";

const ROLE_ICONS: Record<string, typeof InboxIcon> = {
  inbox: InboxIcon,
  sent: Send,
  drafts: FileText,
  archive: Archive,
  junk: ShieldAlert,
  trash: Trash2,
};

/** Preserve every other parameter when one changes. */
export function mailHref(
  current: Record<string, string | undefined>,
  changes: Record<string, string | undefined>,
): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...changes })) {
    if (value !== undefined && value !== "") next.set(key, value);
  }
  const query = next.toString();
  return query ? `${BASE}?${query}` : BASE;
}

export function FolderRail({
  folders,
  selectedId,
  params,
}: {
  folders: JmapMailbox[];
  selectedId: string | null;
  params: Record<string, string | undefined>;
}) {
  return (
    <nav className="space-y-0.5 p-2">
      {folders.map((folder) => {
        const Icon = folder.role ? (ROLE_ICONS[folder.role] ?? Folder) : Folder;
        const active = folder.id === selectedId;
        return (
          <Link
            key={folder.id}
            // Changing folder clears the open message and the page position —
            // keeping either would show a message from somewhere you left.
            href={mailHref(params, {
              mailbox: folder.id,
              message: undefined,
              pos: undefined,
              q: undefined,
              images: undefined,
            })}
            className={cn(
              "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
              active
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            {folder.unreadEmails > 0 && (
              <span className="shrink-0 rounded-full bg-brand/15 px-1.5 text-xs font-medium tabular-nums text-brand-foreground">
                {folder.unreadEmails > 99 ? "99+" : folder.unreadEmails}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
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

export function ThreadList({
  rows,
  selectedId,
  params,
  emptyMessage,
}: {
  rows: ThreadRow[];
  selectedId: string | undefined;
  params: Record<string, string | undefined>;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
        <InboxIcon className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <ul className="divide-y">
      {rows.map((row) => {
        const active = row.emailId === selectedId;
        return (
          <li key={row.emailId}>
            <Link
              // `images` is cleared: unblocking is a decision about ONE
              // message, and carrying it to the next one would silently show
              // remote content in a message nobody agreed to unblock.
              href={mailHref(params, { message: row.emailId, images: undefined })}
              className={cn(
                "block px-3 py-2.5 transition-colors",
                active ? "bg-accent" : "hover:bg-accent/40",
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
  );
}
