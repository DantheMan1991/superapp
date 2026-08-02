"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  Archive,
  Clock,
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
import { applyLabelsAction, bulkAction, snoozeAction } from "../organise-actions";
import type { JmapMailbox } from "@/lib/email/jmap/types";
import { labelsFor } from "../organise/labels";
import { LabelChips, LabelMenu } from "./label-menu";
import {
  snoozeDueAt,
  SNOOZE_PRESETS,
  type SnoozePreset,
} from "../triage/snooze-times";
import {
  isEditingTarget,
  moveCursor,
  resolveShortcut,
  SHORTCUT_HELP,
  type EditableTargetLike,
} from "../triage/keymap";
import { mailHref } from "./mail-panes";
import { MAIL_SEARCH_INPUT_ID } from "./mail-search";

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
  snoozeReturnFolderId,
  folders,
  currentMailboxId,
}: {
  rows: ThreadRow[];
  selectedId: string | undefined;
  params: Record<string, string | undefined>;
  emptyMessage: string;
  mailboxId: string;
  archiveFolderId: string | null;
  trashFolderId: string | null;
  snoozeReturnFolderId: string | null;
  /** Every folder, so labels can be named without another round trip. */
  folders: JmapMailbox[];
  /** The folder being viewed, excluded from each row's chips. Null in a search. */
  currentMailboxId: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  /**
   * Flags the user just set, held only until the refreshed rows carry them.
   *
   * Flagging one message is a reflex, not a decision — you do it while reading
   * the list and move on. A star that waits for a round trip before filling in
   * reads as a click that missed, so people click again and unflag it. The
   * entry is dropped after router.refresh() resolves, so `row.flagged` is the
   * source of truth for everything except the moment in between.
   */
  const [flagPending, setFlagPending] = useState<Map<string, boolean>>(new Map());
  const [flagTransitioning, startFlagTransition] = useTransition();
  const [helpOpen, setHelpOpen] = useState(false);
  /** Ids the snooze menu is open for, or null. Empty means "use the cursor". */
  const [snoozeFor, setSnoozeFor] = useState<string[] | null>(null);

  function snooze(preset: SnoozePreset, emailIds: string[]) {
    setSnoozeFor(null);
    if (emailIds.length === 0) return;
    // Nowhere to come back to means no snooze. Parking mail with no return
    // address is how a message disappears; better to refuse out loud.
    if (!snoozeReturnFolderId) {
      toast.error("Nowhere to return this to. Open a folder and try again.");
      return;
    }
    // Resolved HERE, in the browser. "Tomorrow morning" is a fact about this
    // person's calendar, and the server's clock is UTC.
    const dueAt = snoozeDueAt(preset, new Date());
    startTransition(async () => {
      const result = await snoozeAction({
        mailboxId,
        emailIds,
        dueAt: dueAt.toISOString(),
        returnToMailboxId: snoozeReturnFolderId,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const moved = result.data?.moved ?? 0;
      toast.success(
        `${moved} snoozed until ${dueAt.toLocaleString(undefined, {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        })}.`,
      );
      setSelected(new Set());
      router.refresh();
    });
  }

  function toggle(id: string) {
    setSelected((prior) => {
      const next = new Set(prior);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleFlag(row: ThreadRow) {
    const current = flagPending.get(row.emailId) ?? row.flagged;
    const next = !current;
    setFlagPending((prior) => new Map(prior).set(row.emailId, next));

    startFlagTransition(async () => {
      const result = await bulkAction({
        mailboxId,
        emailIds: [row.emailId],
        action: next ? "flag" : "unflag",
      });
      // The mail server is the only thing that decides. Anything short of a
      // clean single success puts the star back where it was, because a star
      // that stays lit on a message the server never flagged is worse than one
      // that visibly refuses.
      const rejected = "error" in result || (result.data?.failed ?? 0) > 0;
      if (rejected) {
        setFlagPending((prior) => {
          const revert = new Map(prior);
          revert.delete(row.emailId);
          return revert;
        });
        toast.error(
          "error" in result ? result.error : "The mail server refused that.",
        );
        return;
      }
      router.refresh();
      setFlagPending((prior) => {
        const settled = new Map(prior);
        settled.delete(row.emailId);
        return settled;
      });
    });
  }

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function run(
    action: "read" | "unread" | "flag" | "unflag" | "move",
    targetMailboxId?: string,
    /**
     * Explicit ids for the keyboard, which acts on the message under the
     * cursor. The bulk bar passes nothing and means "what I ticked".
     *
     * Keeping them one function matters: a second copy of this would be a
     * second place for the partial-success reporting to be got wrong, and
     * "300 of 900 moved" reported as "done" is how somebody loses an
     * afternoon looking for their mail.
     */
    ids?: string[],
  ) {
    const emailIds = ids ?? [...selected];
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

  /**
   * The keyboard.
   *
   * Bound to the window rather than to the list, because the whole point is
   * that you never have to click into anything first. What decides whether a
   * keystroke is ours lives in triage/keymap.ts and is tested there; this is
   * only the wiring.
   *
   * Rebinding every render is deliberate. The handler closes over `rows`,
   * `selected` and the cursor, and a stale closure here archives the wrong
   * message — addEventListener is far cheaper than that bug.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const action = resolveShortcut(event, {
        isEditing: isEditingTarget(event.target as EditableTargetLike | null),
      });
      if (!action) return;

      const index = rows.findIndex((row) => row.emailId === selectedId);
      const cursor = index >= 0 ? rows[index] : undefined;
      // Keyboard actions follow the ticked messages when there are any, and
      // otherwise the one under the cursor. Same rule as every mail client:
      // the selection wins because making it and then ignoring it is worse
      // than having no shortcut at all.
      const targets =
        selected.size > 0 ? [...selected] : cursor ? [cursor.emailId] : [];

      switch (action) {
        case "next":
        case "previous": {
          const to = moveCursor(rows.length, index, action);
          // At the ends the key is deliberately NOT consumed, so ArrowDown
          // still scrolls the page once the cursor has nowhere left to go.
          if (to === null) return;
          event.preventDefault();
          router.push(
            mailHref(params, { message: rows[to].emailId, images: undefined }),
          );
          return;
        }
        case "open": {
          if (!cursor) return;
          event.preventDefault();
          router.push(
            mailHref(params, { message: cursor.emailId, images: undefined }),
          );
          return;
        }
        case "close": {
          // Unwinds one layer at a time. Escape that closes everything at once
          // loses a selection somebody spent a minute building.
          event.preventDefault();
          if (snoozeFor !== null) {
            setSnoozeFor(null);
          } else if (helpOpen) {
            setHelpOpen(false);
          } else if (selected.size > 0) {
            setSelected(new Set());
          } else {
            router.push(
              mailHref(params, { message: undefined, compose: undefined }),
            );
          }
          return;
        }
        case "select": {
          if (!cursor) return;
          event.preventDefault();
          toggle(cursor.emailId);
          return;
        }
        case "star": {
          if (!cursor) return;
          event.preventDefault();
          toggleFlag(cursor);
          return;
        }
        case "snooze": {
          if (targets.length === 0) return;
          event.preventDefault();
          // Opens the menu rather than picking a time. "Snooze until when" is
          // the actual question, and a key that silently chose one would be a
          // key that moves mail somewhere you did not ask for.
          setSnoozeFor(targets);
          return;
        }
        case "archive":
        case "trash": {
          // A mailbox without the folder simply has no shortcut, the same way
          // the bulk bar hides the button. Offering one that fails is worse.
          const folder = action === "archive" ? archiveFolderId : trashFolderId;
          if (!folder || targets.length === 0) return;
          event.preventDefault();
          run("move", folder, targets);
          return;
        }
        case "read":
        case "unread": {
          if (targets.length === 0) return;
          event.preventDefault();
          run(action, undefined, targets);
          return;
        }
        case "reply": {
          if (!cursor) return;
          event.preventDefault();
          router.push(
            mailHref(params, { compose: "reply", message: cursor.emailId }),
          );
          return;
        }
        case "compose": {
          event.preventDefault();
          router.push(
            mailHref(params, { compose: "new", message: undefined }),
          );
          return;
        }
        case "search": {
          const box = document.getElementById(MAIL_SEARCH_INPUT_ID);
          if (!(box instanceof HTMLInputElement)) return;
          // preventDefault matters here: without it the "/" lands in the box
          // it just focused, and every search starts with a slash.
          event.preventDefault();
          box.focus();
          box.select();
          return;
        }
        case "help": {
          event.preventDefault();
          setHelpOpen((open) => !open);
          return;
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  /**
   * The "until when" menu, shown for whatever `b` or the bulk button targeted.
   *
   * A sheet rather than a dropdown anchored to the button, because the keyboard
   * can open this with no button involved — there is nothing to anchor to when
   * the trigger was a keystroke.
   */
  const snoozeMenu =
    snoozeFor !== null ? (
      <div
        role="dialog"
        aria-label="Snooze until"
        className="fixed inset-x-0 bottom-0 z-50 mx-auto mb-4 w-[min(20rem,calc(100vw-2rem))] rounded-lg border bg-popover p-3 shadow-lg"
      >
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">
            Snooze {snoozeFor.length} until
          </h2>
          <button
            type="button"
            onClick={() => setSnoozeFor(null)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Esc
          </button>
        </div>
        <div className="flex flex-col">
          {SNOOZE_PRESETS.map((option) => {
            const when = snoozeDueAt(option.preset, new Date());
            return (
              <button
                key={option.preset}
                type="button"
                disabled={pending}
                onClick={() => snooze(option.preset, snoozeFor)}
                className="flex items-baseline justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
              >
                <span>{option.label}</span>
                {/* The resolved time, because "next week" means different days
                    to different people and the whole feature is a promise
                    about when something comes back. */}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {when.toLocaleString(undefined, {
                    weekday: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    ) : null;

  /**
   * Rendered in both branches, because an empty folder is exactly where
   * somebody presses `?` to find out why nothing is happening.
   */
  const help = helpOpen ? (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="fixed inset-x-0 bottom-0 z-50 mx-auto mb-4 w-[min(28rem,calc(100vw-2rem))] rounded-lg border bg-popover p-4 shadow-lg"
    >
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
        <button
          type="button"
          onClick={() => setHelpOpen(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Esc
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        {SHORTCUT_HELP.map((entry) => (
          <div key={entry.keys} className="contents">
            <dt className="font-mono text-muted-foreground">{entry.keys}</dt>
            <dd>{entry.does}</dd>
          </div>
        ))}
      </dl>
    </div>
  ) : null;

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
        <InboxIcon className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        {snoozeMenu}
        {help}
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
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setSnoozeFor([...selected])}
          >
            <Clock className="size-3.5" />
            Snooze
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
          <LabelMenu
            folders={folders}
            selection={rows
              .filter((r) => selected.has(r.emailId))
              .map((r) => r.mailboxIds)}
            disabled={pending}
            onApply={(add, remove) => {
              startTransition(async () => {
                const result = await applyLabelsAction({
                  mailboxId,
                  emailIds: [...selected],
                  add,
                  remove,
                });
                if ("error" in result) {
                  toast.error(result.error);
                  return;
                }
                const skipped = result.data?.skipped ?? 0;
                toast.success(
                  skipped > 0
                    // Said plainly rather than reported as a clean success: a
                    // bulk action that silently did less than it claimed is the
                    // kind of lie that costs somebody an afternoon.
                    ? `Labels updated. ${skipped} left alone — removing that would have left them in no folder.`
                    : add.length > 0 && remove.length === 0
                      ? "Labelled."
                      : remove.length > 0 && add.length === 0
                        ? "Labels removed."
                        : "Labels updated.",
                );
                setSelected(new Set());
                router.refresh();
              });
            }}
          />
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
          const flagged = flagPending.get(row.emailId) ?? row.flagged;
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
              {/* Beside the checkbox rather than in the row's text, because a
                  <button> inside the <Link> is invalid HTML and every click
                  would have to fight the navigation it sits inside. */}
              <button
                type="button"
                onClick={() => toggleFlag(row)}
                disabled={flagTransitioning}
                className="flex shrink-0 items-center px-2 text-muted-foreground transition-colors hover:text-amber-500 disabled:opacity-50"
                aria-pressed={flagged}
                aria-label={
                  flagged
                    ? `Remove flag from ${row.subject || "message"}`
                    : `Flag ${row.subject || "message"}`
                }
              >
                <Flag
                  className={cn(
                    "size-3.5",
                    flagged && "fill-current text-amber-500",
                  )}
                />
              </button>
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
                  <LabelChips
                    names={labelsFor(row.mailboxIds, folders, currentMailboxId).map(
                      (l) => l.name,
                    )}
                  />
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
      {snoozeMenu}
      {help}
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
