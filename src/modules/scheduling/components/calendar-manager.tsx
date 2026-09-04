"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Archive,
  ArchiveRestore,
  Building2,
  Lock,
  Pencil,
  Plus,
  Share2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SCHEDULE_ACCESS_LEVELS, type ScheduleAccessLevel } from "@/lib/schedule/access";
import type { CalendarSummary, ShareRow } from "../calendar-ops";
import { CALENDAR_COLORS } from "../core/colors";
import {
  createCalendarAction,
  grantShareAction,
  revokeShareAction,
  setCalendarArchivedAction,
  updateCalendarAction,
} from "../actions";

/**
 * Calendars, and who they are shared with.
 *
 * Written as ONE component with dialogs rather than a page per action, because
 * the thing somebody does here is compare — "who can see which of these?" — and
 * that question is unanswerable if each calendar's sharing lives on its own
 * screen.
 */

/**
 * Full class strings, never interpolated.
 *
 * Tailwind scans source text, so `bg-${color}-500` produces a class that exists
 * in no stylesheet and a dot that is invisible. The colour column is open text
 * in the database so a palette can change without a migration; the mapping to
 * actual classes belongs here, where the scanner can see it.
 */
const COLOR_DOT: Record<string, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  green: "bg-green-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};

/**
 * What each level actually means, in the words Outlook uses — minus its "I".
 *
 * A business calendar has no "I", and "can view when I'm busy" on the shared
 * Team calendar reads as somebody's personal availability rather than the
 * calendar's. The distinction the middle tier exists to make is titles-vs-
 * details, and that survives the rewording.
 */
const ACCESS_LABEL: Record<ScheduleAccessLevel, string> = {
  busy: "Free/busy only",
  titles: "Titles and locations",
  details: "All details",
  write: "Can edit",
};

const GROUP_META = {
  mine: { title: "My calendars", icon: Lock, blurb: "Private unless you share them." },
  shared: {
    title: "Shared with me",
    icon: Users,
    blurb: "What colleagues have given you access to.",
  },
  business: {
    title: "Business calendars",
    icon: Building2,
    blurb: "Owned by the workspace rather than a person.",
  },
} as const;

export function CalendarManager({
  calendars,
  members,
  shares,
  currentUserId,
  isOwner,
  canWrite,
}: {
  calendars: CalendarSummary[];
  members: Array<{ clerkUserId: string; label: string; role: "owner" | "staff" }>;
  shares: Record<string, ShareRow[]>;
  currentUserId: string;
  isOwner: boolean;
  /**
   * `roleMayWrite(role)`. **Not the same question as `isOwner`** — that one
   * separates a business calendar from a personal one, and this one says
   * whether the reader may change anything at all. The accountant administers
   * their own provisioned calendar and may still not touch it.
   */
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CalendarSummary | null>(null);
  const [sharing, setSharing] = useState<CalendarSummary | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  /**
   * Administering is a grant AND a role. `canWrite` first, because an accountant
   * owns the calendar they were provisioned and would otherwise be offered
   * Share, Edit and Archive on it — three enabled buttons and three refusals.
   */
  const canAdmin = (c: CalendarSummary) =>
    canWrite && (c.group === "mine" || (c.group === "business" && isOwner));

  const visible = calendars.filter((c) => showArchived || c.archivedAt === null);
  const archivedCount = calendars.filter((c) => c.archivedAt !== null).length;

  function run(work: () => Promise<{ ok: true } | { error: string }>, done: string) {
    startTransition(async () => {
      const result = await work();
      if ("error" in result) toast.error(result.error);
      else {
        toast.success(done);
        setCreating(false);
        setEditing(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* The page's one h1. It was a `text-xl` heading invented inside this
          component, which left the Calendars page with no page-level title. */}
      <PageHeader
        title="Calendars"
        description="Everything you keep time in. Each one is private until you share it."
        actions={
          canWrite ? (
            <Button size="sm" onClick={() => setCreating(true)} disabled={pending}>
              <Plus className="mr-1.5 size-4" /> New calendar
            </Button>
          ) : null
        }
      />

      {/* Said once, at the top, rather than as a disabled button per row. An
          accountant who can see the page and is told why is better served than
          one who presses Share and is refused after the fact — which is what
          this screen did until 2026-09-03. */}
      {!canWrite && (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Accountant access is read-only. You can see every calendar shared with
          you, who else can see it, and any subscription links already made —
          and nothing here can be changed.
        </p>
      )}

      {(["mine", "shared", "business"] as const).map((group) => {
        const rows = visible.filter((c) => c.group === group);
        if (rows.length === 0) return null;
        const meta = GROUP_META[group];
        const Icon = meta.icon;
        return (
          <section key={group} className="space-y-2">
            <div>
              <h2 className="flex items-center gap-1.5 text-sm font-medium">
                <Icon className="size-3.5" /> {meta.title}
              </h2>
              <p className="text-xs text-muted-foreground">{meta.blurb}</p>
            </div>
            <ul className="divide-y divide-divider rounded-xl border border-border">
              {rows.map((calendar) => (
                <li
                  key={calendar.id}
                  className="flex items-center justify-between gap-3 px-3 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={`size-2.5 shrink-0 rounded-full ${
                        COLOR_DOT[calendar.color] ?? COLOR_DOT.slate
                      }`}
                      aria-hidden
                    />
                    <span className="truncate text-sm">{calendar.name}</span>
                    {calendar.isPrimary && (
                      <Badge variant="secondary" className="shrink-0">
                        Main
                      </Badge>
                    )}
                    {calendar.archivedAt && (
                      <Badge variant="outline" className="shrink-0">
                        Archived
                      </Badge>
                    )}
                    {/*
                      The level is shown only where it is NEWS. On your own
                      calendar it is always "can edit", and a badge saying so on
                      every row is noise that trains people to stop reading them.
                    */}
                    {!canAdmin(calendar) && (
                      <Badge variant="outline" className="shrink-0">
                        {ACCESS_LABEL[calendar.access] ?? calendar.access}
                      </Badge>
                    )}
                  </div>

                  {canAdmin(calendar) && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        disabled={pending}
                        onClick={() => setSharing(calendar)}
                      >
                        <Share2 className="size-4" />
                        <span className="sr-only">Share {calendar.name}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        disabled={pending}
                        onClick={() => setEditing(calendar)}
                      >
                        <Pencil className="size-4" />
                        <span className="sr-only">Edit {calendar.name}</span>
                      </Button>
                      {/*
                        The main calendar has no archive button at all, rather
                        than one that errors when pressed. The rule is in
                        calendar-ops too, because a disabled button is a UI
                        courtesy and not an enforcement.
                      */}
                      {!calendar.isPrimary && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () =>
                                setCalendarArchivedAction({
                                  calendarId: calendar.id,
                                  archived: calendar.archivedAt === null,
                                }),
                              calendar.archivedAt === null
                                ? "Calendar archived"
                                : "Calendar restored",
                            )
                          }
                        >
                          {calendar.archivedAt === null ? (
                            <Archive className="size-4" />
                          ) : (
                            <ArchiveRestore className="size-4" />
                          )}
                          <span className="sr-only">
                            {calendar.archivedAt === null ? "Archive" : "Restore"}{" "}
                            {calendar.name}
                          </span>
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {archivedCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowArchived((v) => !v)}
          className="text-xs text-muted-foreground"
        >
          {showArchived
            ? "Hide archived"
            : `Show ${archivedCount} archived calendar${archivedCount === 1 ? "" : "s"}`}
        </Button>
      )}

      <CalendarForm
        open={creating}
        onOpenChange={setCreating}
        pending={pending}
        title="New calendar"
        onSubmit={(values) =>
          run(() => createCalendarAction(values), "Calendar created")
        }
      />

      {editing && (
        <CalendarForm
          open
          onOpenChange={(open) => !open && setEditing(null)}
          pending={pending}
          title={`Edit ${editing.name}`}
          initial={{ name: editing.name, color: editing.color }}
          onSubmit={(values) =>
            run(
              () => updateCalendarAction({ calendarId: editing.id, ...values }),
              "Calendar updated",
            )
          }
        />
      )}

      {sharing && (
        <ShareDialog
          calendar={sharing}
          shares={shares[sharing.id] ?? []}
          members={members.filter((m) => m.clerkUserId !== currentUserId)}
          pending={pending}
          onOpenChange={(open) => !open && setSharing(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

function CalendarForm({
  open,
  onOpenChange,
  pending,
  title,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  title: string;
  initial?: { name: string; color: string };
  onSubmit: (values: {
    name: string;
    color: (typeof CALENDAR_COLORS)[number];
  }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState<(typeof CALENDAR_COLORS)[number]>(
    (initial?.color as (typeof CALENDAR_COLORS)[number]) ?? "blue",
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Only you can see a new calendar until you share it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="calendar-name">Name</Label>
            <Input
              id="calendar-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="Site visits"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Colour</Label>
            <div className="flex gap-2">
              {CALENDAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={c}
                  aria-pressed={color === c}
                  className={`size-7 rounded-full ${COLOR_DOT[c]} ${
                    color === c
                      ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                      : ""
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || name.trim().length === 0}
            onClick={() => onSubmit({ name: name.trim(), color })}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Who can see this calendar.
 *
 * The workspace-wide row is PINNED AT THE TOP and always present, even when
 * nothing is shared — it is the same control as a person's, which is the point.
 * Outlook does exactly this with "People in my organization", and it is what
 * stops "share with everybody" being a separate feature people have to discover.
 */
function ShareDialog({
  calendar,
  shares,
  members,
  pending,
  onOpenChange,
  onChanged,
}: {
  calendar: CalendarSummary;
  shares: ShareRow[];
  members: Array<{ clerkUserId: string; label: string; role: "owner" | "staff" }>;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [busy, startTransition] = useTransition();
  const [addUser, setAddUser] = useState("");
  const [addLevel, setAddLevel] = useState<ScheduleAccessLevel>("details");

  const everyone = shares.find((s) => s.isEveryone) ?? null;
  const people = shares.filter((s) => !s.isEveryone);
  const nameOf = new Map(members.map((m) => [m.clerkUserId, m.label]));
  const granted = new Set(people.map((s) => s.granteeClerkUserId));
  const candidates = members.filter((m) => !granted.has(m.clerkUserId));
  const working = pending || busy;

  function act(work: () => Promise<{ ok: true } | { error: string }>, done: string) {
    startTransition(async () => {
      const result = await work();
      if ("error" in result) toast.error(result.error);
      else {
        toast.success(done);
        onChanged();
      }
    });
  }

  const setLevel = (granteeClerkUserId: string, access: ScheduleAccessLevel) =>
    act(
      () =>
        grantShareAction({ calendarId: calendar.id, granteeClerkUserId, access }),
      "Sharing updated",
    );

  const remove = (shareId: string) =>
    act(
      () => revokeShareAction({ calendarId: calendar.id, shareId }),
      "Access removed",
    );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share {calendar.name}</DialogTitle>
          <DialogDescription>
            Sharing applies to the whole calendar. Anything you mark private on a
            single event stays visible only to you and the people on it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Everyone in this workspace</Label>
            <div className="flex items-center gap-2">
              <Select
                value={everyone?.access ?? "none"}
                disabled={working}
                onValueChange={(value) => {
                  if (value === "none") {
                    if (everyone) remove(everyone.id);
                  } else {
                    setLevel("", value as ScheduleAccessLevel);
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not shared</SelectItem>
                  {SCHEDULE_ACCESS_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {ACCESS_LABEL[level]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {people.length > 0 && (
            <ul className="divide-y divide-divider rounded-xl border border-border">
              {people.map((share) => (
                <li
                  key={share.id}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  {/*
                    A name when we have one, the raw id when we do not — which
                    happens for somebody who has left. Their grant is still real
                    and still needs removing, so the row must render rather than
                    vanish because the roster no longer mentions them.
                  */}
                  <span
                    className={
                      nameOf.has(share.granteeClerkUserId)
                        ? "min-w-0 flex-1 truncate text-sm"
                        : "min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
                    }
                  >
                    {nameOf.get(share.granteeClerkUserId) ?? share.granteeClerkUserId}
                  </span>
                  <Select
                    value={share.access}
                    disabled={working}
                    onValueChange={(value) =>
                      setLevel(share.granteeClerkUserId, value as ScheduleAccessLevel)
                    }
                  >
                    <SelectTrigger className="w-[190px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCHEDULE_ACCESS_LEVELS.map((level) => (
                        <SelectItem key={level} value={level}>
                          {ACCESS_LABEL[level]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    disabled={working}
                    onClick={() => remove(share.id)}
                  >
                    <X className="size-4" />
                    <span className="sr-only">Remove access</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {candidates.length > 0 ? (
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="share-user" className="text-xs">
                  Add someone
                </Label>
                <Select value={addUser} onValueChange={setAddUser}>
                  <SelectTrigger id="share-user" className="w-full">
                    <SelectValue placeholder="Choose a colleague" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((m) => (
                      <SelectItem key={m.clerkUserId} value={m.clerkUserId}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Select
                value={addLevel}
                onValueChange={(v) => setAddLevel(v as ScheduleAccessLevel)}
              >
                <SelectTrigger className="w-[190px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_ACCESS_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {ACCESS_LABEL[level]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={working || !addUser}
                onClick={() => {
                  setLevel(addUser, addLevel);
                  setAddUser("");
                }}
              >
                <Plus className="size-4" />
                <span className="sr-only">Add</span>
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {people.length > 0
                ? "Everyone in the workspace already has access."
                : "There is nobody else in this workspace yet."}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
