"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Check, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { CalendarSummary } from "../calendar-ops";
import {
  attachLinkAction,
  cancelEventAction,
  createEventAction,
  detachLinkAction,
  getEventAction,
  respondToEventAction,
  searchLinkTargetsAction,
  updateEventAction,
} from "../actions";

type Attendee = {
  clerkUserId?: string;
  externalEmail?: string;
  externalName?: string;
};

type LinkRow = {
  linkId: string;
  entityType: string;
  label: string | null;
  sublabel?: string;
  href?: string;
};

type LinkGroup = {
  extensionSlug: string;
  entityType: string;
  pluralLabel: string;
  results: Array<{ entityId: string; label: string; sublabel?: string }>;
};

const SHOW_AS = [
  { value: "busy", label: "Busy" },
  { value: "free", label: "Free" },
  { value: "tentative", label: "Tentative" },
  { value: "away", label: "Away" },
] as const;

/**
 * Create or edit one event.
 *
 * TIMES ARE WALL CLOCKS ALL THE WAY THROUGH THIS COMPONENT — a date string and
 * a time string, exactly as typed. The conversion to an instant happens in the
 * action, with the tenant's zone. Doing it here would use the BROWSER's zone,
 * so somebody in Denver would silently book New York appointments two hours out.
 */
export function EventForm({
  itemId,
  defaultDate,
  timeZone,
  calendars,
  members,
  onClose,
}: {
  itemId?: string;
  defaultDate: string;
  timeZone: string;
  calendars: CalendarSummary[];
  members: Array<{ clerkUserId: string; label: string }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(!!itemId);
  const [canEdit, setCanEdit] = useState(!itemId);
  const [myResponse, setMyResponse] = useState<string | null>(null);

  const [calendarId, setCalendarId] = useState(calendars[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState(defaultDate);
  const [endTime, setEndTime] = useState("10:00");
  const [showAs, setShowAs] = useState<string>("busy");
  const [isPrivate, setIsPrivate] = useState(false);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [guestEmail, setGuestEmail] = useState("");
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkGroups, setLinkGroups] = useState<LinkGroup[]>([]);

  /**
   * DEBOUNCED, because this fires while somebody types and each keystroke is a
   * fan-out across every module's search. 250ms is long enough to skip the
   * middle of a word and short enough not to feel laggy.
   */
  useEffect(() => {
    const q = linkQuery.trim();
    let stale = false;
    // Every path goes through the timer, including the empty one. Clearing
    // synchronously here would be a setState directly inside an effect, which
    // cascades an extra render before paint — see conventions.md §8.
    const timer = setTimeout(() => {
      if (q.length === 0) {
        setLinkGroups([]);
        return;
      }
      searchLinkTargetsAction({ query: q }).then((result) => {
        // A response that arrives after a newer keystroke is discarded, or a
        // slow query for "ac" overwrites the results for "acme".
        if (stale || "error" in result) return;
        setLinkGroups(result.data!.groups);
      });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [linkQuery]);

  async function refreshLinks() {
    if (!itemId) return;
    const result = await getEventAction({ itemId });
    if (!("error" in result)) setLinks(result.data!.links);
  }

  function attach(extensionSlug: string, entityType: string, entityId: string) {
    if (!itemId) return;
    startTransition(async () => {
      const result = await attachLinkAction({
        itemId,
        extensionSlug,
        entityType,
        entityId,
      });
      if ("error" in result) toast.error(result.error);
      else {
        setLinkQuery("");
        setLinkGroups([]);
        await refreshLinks();
        router.refresh();
      }
    });
  }

  function detach(linkId: string) {
    if (!itemId) return;
    startTransition(async () => {
      const result = await detachLinkAction({ itemId, linkId });
      if ("error" in result) toast.error(result.error);
      else {
        await refreshLinks();
        router.refresh();
      }
    });
  }

  useEffect(() => {
    if (!itemId) return;
    let cancelled = false;
    getEventAction({ itemId }).then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        toast.error(result.error);
        onClose();
        return;
      }
      const d = result.data!;
      setCalendarId(d.calendarId);
      setTitle(d.title);
      setDescription(d.description);
      setLocation(d.location);
      setAllDay(d.allDay);
      setStartDate(d.startDate);
      setStartTime(d.startTime);
      setEndDate(d.endDate);
      setEndTime(d.endTime);
      setShowAs(d.showAs);
      setIsPrivate(d.sensitivity === "private");
      setCanEdit(d.canEdit);
      setMyResponse(d.myResponse);
      setAttendees(
        d.attendees.map((a) => ({
          clerkUserId: a.clerkUserId ?? undefined,
          externalEmail: a.externalEmail ?? undefined,
          externalName: a.externalName,
        })),
      );
      setLinks(d.links);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [itemId, onClose]);

  const nameOf = new Map(members.map((m) => [m.clerkUserId, m.label]));
  const invited = new Set(attendees.map((a) => a.clerkUserId).filter(Boolean));
  const candidates = members.filter((m) => !invited.has(m.clerkUserId));

  function save() {
    const fields = {
      calendarId,
      title: title.trim(),
      description,
      location,
      startDate,
      startTime,
      endDate,
      endTime,
      allDay,
      showAs: showAs as "free" | "busy" | "tentative" | "away",
      sensitivity: (isPrivate ? "private" : "normal") as "private" | "normal",
      attendees,
    };
    startTransition(async () => {
      const result = itemId
        ? await updateEventAction({ itemId, ...fields })
        : await createEventAction(fields);
      if ("error" in result) toast.error(result.error);
      else {
        toast.success(itemId ? "Event updated" : "Event created");
        router.refresh();
        onClose();
      }
    });
  }

  function remove() {
    if (!itemId) return;
    startTransition(async () => {
      const result = await cancelEventAction({ itemId });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Event cancelled");
        router.refresh();
        onClose();
      }
    });
  }

  function respond(response: "accepted" | "declined" | "tentative") {
    if (!itemId) return;
    startTransition(async () => {
      const result = await respondToEventAction({ itemId, response });
      if ("error" in result) toast.error(result.error);
      else {
        setMyResponse(response);
        toast.success("Response sent");
        router.refresh();
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{itemId ? "Event" : "New event"}</DialogTitle>
          <DialogDescription>
            Times are in {timeZone.replace(/_/g, " ")}, the workspace&rsquo;s
            timezone.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-6 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-4">
            {/* Somebody who is ON an event but cannot edit its calendar gets the
                RSVP row and read-only fields — the common case for an invitation
                to a colleague's meeting. */}
            {!canEdit && myResponse && (
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
                <span className="text-xs text-muted-foreground">
                  You are on this event.
                </span>
                <div className="ml-auto flex gap-1">
                  {(["accepted", "tentative", "declined"] as const).map((r) => (
                    <Button
                      key={r}
                      size="sm"
                      variant={myResponse === r ? "default" : "outline"}
                      disabled={pending}
                      onClick={() => respond(r)}
                      className="h-7 px-2 text-xs capitalize"
                    >
                      {myResponse === r && <Check className="mr-1 size-3" />}
                      {r === "accepted" ? "Yes" : r === "declined" ? "No" : "Maybe"}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="event-title">Title</Label>
              <Input
                id="event-title"
                value={title}
                disabled={!canEdit}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Site visit"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-calendar">Calendar</Label>
              <Select
                value={calendarId}
                disabled={!canEdit}
                onValueChange={setCalendarId}
              >
                <SelectTrigger id="event-calendar" className="w-full">
                  <SelectValue placeholder="Choose a calendar" />
                </SelectTrigger>
                <SelectContent>
                  {calendars.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="all-day"
                checked={allDay}
                disabled={!canEdit}
                onCheckedChange={setAllDay}
              />
              <Label htmlFor="all-day" className="text-sm">
                All day
              </Label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="start-date">Starts</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  disabled={!canEdit}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    // Keep the end from drifting behind the start, which is the
                    // commonest way to hit the "cannot end before it starts"
                    // error and the least useful time to be told about it.
                    if (e.target.value > endDate) setEndDate(e.target.value);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end-date">Ends</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  disabled={!canEdit}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              {!allDay && (
                <>
                  <Input
                    aria-label="Start time"
                    type="time"
                    value={startTime}
                    disabled={!canEdit}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                  <Input
                    aria-label="End time"
                    type="time"
                    value={endTime}
                    disabled={!canEdit}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-location">Location</Label>
              <Input
                id="event-location"
                value={location}
                disabled={!canEdit}
                maxLength={200}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="show-as">Show as</Label>
                <Select value={showAs} disabled={!canEdit} onValueChange={setShowAs}>
                  <SelectTrigger id="show-as" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHOW_AS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 pb-2">
                <Switch
                  id="private"
                  checked={isPrivate}
                  disabled={!canEdit}
                  onCheckedChange={setIsPrivate}
                />
                <Label htmlFor="private" className="text-sm">
                  Private
                </Label>
              </div>
            </div>
            {isPrivate && (
              <p className="-mt-2 text-xs text-muted-foreground">
                Only you and the people on it will see the details, however
                widely this calendar is shared.
              </p>
            )}

            {/* Attendees */}
            <div className="space-y-1.5">
              <Label>People</Label>
              {attendees.length > 0 && (
                <ul className="divide-y rounded-md border">
                  {attendees.map((a, i) => (
                    <li
                      key={a.clerkUserId ?? a.externalEmail ?? i}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm"
                    >
                      <span className="truncate">
                        {a.clerkUserId
                          ? (nameOf.get(a.clerkUserId) ?? a.clerkUserId)
                          : a.externalEmail}
                      </span>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          onClick={() =>
                            setAttendees((prev) => prev.filter((_, j) => j !== i))
                          }
                        >
                          <X className="size-3.5" />
                          <span className="sr-only">Remove</span>
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && (
                <div className="space-y-2">
                  {candidates.length > 0 && (
                    <Select
                      value=""
                      onValueChange={(id) =>
                        setAttendees((prev) => [...prev, { clerkUserId: id }])
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Add a colleague" />
                      </SelectTrigger>
                      <SelectContent>
                        {candidates.map((m) => (
                          <SelectItem key={m.clerkUserId} value={m.clerkUserId}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Or an email address"
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      disabled={!guestEmail.includes("@")}
                      onClick={() => {
                        setAttendees((prev) => [
                          ...prev,
                          { externalEmail: guestEmail.trim().toLowerCase() },
                        ]);
                        setGuestEmail("");
                      }}
                    >
                      Add
                    </Button>
                  </div>
                  {/* Nothing is emailed yet, and saying so beats somebody
                      assuming an invitation went out. */}
                  <p className="text-xs text-muted-foreground">
                    Nobody is emailed yet — adding somebody puts the event on
                    their calendar in Yosher.
                  </p>
                </div>
              )}
            </div>

            {/* WHAT THIS EVENT IS ABOUT.
                Only on a saved event: a link needs an item id to point at, and
                queueing them client-side until the first save would mean two
                code paths for one feature. */}
            {itemId && (
              <div className="space-y-1.5">
                <Label>Related to</Label>
                {links.length > 0 && (
                  <ul className="divide-y rounded-md border">
                    {links.map((l) => (
                      <li
                        key={l.linkId}
                        className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm"
                      >
                        {l.label === null ? (
                          /* The record is gone, or this reader may not see it.
                             Shown rather than hidden: a link that silently
                             disappears looks like it was never made. */
                          <span className="truncate text-muted-foreground italic">
                            {l.entityType} (no longer available)
                          </span>
                        ) : (
                          <span className="min-w-0 flex-1 truncate">
                            {l.href ? (
                              <a
                                href={l.href}
                                className="underline underline-offset-2"
                              >
                                {l.label}
                              </a>
                            ) : (
                              l.label
                            )}
                            {l.sublabel && (
                              <span className="ml-1.5 text-xs text-muted-foreground">
                                {l.sublabel}
                              </span>
                            )}
                          </span>
                        )}
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6 shrink-0"
                            disabled={pending}
                            onClick={() => detach(l.linkId)}
                          >
                            <X className="size-3.5" />
                            <span className="sr-only">Remove link</span>
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {canEdit && (
                  <div className="space-y-1.5">
                    <Input
                      value={linkQuery}
                      onChange={(e) => setLinkQuery(e.target.value)}
                      placeholder="Search a customer, invoice, file…"
                    />
                    {/* Derived from the query rather than trusted from state,
                        so an emptied box hides results immediately instead of
                        waiting out the debounce. */}
                    {linkQuery.trim().length > 0 && linkGroups.length > 0 && (
                      <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-2">
                        {linkGroups.map((group) => (
                          <div key={`${group.extensionSlug}:${group.entityType}`}>
                            <p className="px-1 text-[11px] font-medium text-muted-foreground">
                              {group.pluralLabel}
                            </p>
                            {group.results.map((r) => (
                              <button
                                key={r.entityId}
                                className="block w-full truncate rounded px-1 py-1 text-left text-sm hover:bg-muted"
                                disabled={pending}
                                onClick={() =>
                                  attach(
                                    group.extensionSlug,
                                    group.entityType,
                                    r.entityId,
                                  )
                                }
                              >
                                {r.label}
                                {r.sublabel && (
                                  <span className="ml-1.5 text-xs text-muted-foreground">
                                    {r.sublabel}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="event-notes">Notes</Label>
              <Textarea
                id="event-notes"
                value={description}
                disabled={!canEdit}
                maxLength={5000}
                rows={3}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
        )}

        {canEdit && !loading && (
          <DialogFooter className="gap-2 sm:justify-between">
            {itemId ? (
              <Button variant="ghost" disabled={pending} onClick={remove}>
                <Trash2 className="mr-1.5 size-4" /> Cancel event
              </Button>
            ) : (
              <span />
            )}
            <Button disabled={pending || title.trim().length === 0} onClick={save}>
              Save
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
