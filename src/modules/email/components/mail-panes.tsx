import Link from "next/link";
import {
  Archive,
  Bookmark,
  Inbox as InboxIcon,
  Send,
  FileText,
  ShieldAlert,
  Trash2,
  Folder,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { JmapMailbox } from "@/lib/email/jmap/types";
import type { SavedSearchEntry } from "../organise/saved-searches";
import { DeleteSearchButton, NewFolderButton } from "./organise-controls";

/**
 * The folder rail: folders, a way to make one, and this person's saved views.
 *
 * Still a server component made of links. State lives in the URL, exactly as it
 * does in Documents — a folder, a search and an open message are all
 * parameters, so any view can be linked, bookmarked, reloaded and reached with
 * the back button.
 *
 * The thread list moved to `thread-list.tsx` when it gained a selection: a set
 * of chosen message ids is the one piece of state in this module that genuinely
 * should NOT be in the URL, since nobody wants to bookmark it and every
 * checkbox would become a navigation.
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
  mailboxId,
  savedSearches,
}: {
  folders: JmapMailbox[];
  selectedId: string | null;
  params: Record<string, string | undefined>;
  mailboxId: string;
  savedSearches: SavedSearchEntry[];
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
              <span className="shrink-0 rounded-full bg-module-accent/12 px-1.5 text-xs font-medium text-module-accent tabular-nums">
                {folder.unreadEmails > 99 ? "99+" : folder.unreadEmails}
              </span>
            )}
          </Link>
        );
      })}

      <div className="pt-1">
        <NewFolderButton mailboxId={mailboxId} />
      </div>

      {savedSearches.length > 0 && (
        <div className="pt-2">
          <p className="px-2.5 pb-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
            Saved
          </p>
          {savedSearches.map((saved) => (
            <div key={saved.id} className="group flex items-center">
              {/* A saved view IS its href — there is no separate query engine
                  behind it. Clicking one is the same as having typed the
                  filters yourself. */}
              <Link
                href={saved.href}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
              >
                <Bookmark className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{saved.name}</span>
              </Link>
              <DeleteSearchButton searchId={saved.id} />
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}
