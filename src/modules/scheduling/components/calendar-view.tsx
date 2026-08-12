"use client";

import Link from "next/link";
import { useState } from "react";
import {
  CalendarCog,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import {
  formatTimeInTimezone,
  minutesIntoDay,
  startOfDayInTimezone,
  addDays,
} from "@/lib/timezone";
import type { ScheduleRangeItem } from "@/lib/schedule/range";
import type { CalendarSummary } from "../calendar-ops";
import { layoutDay, partitionAllDay, spansDay } from "../core/layout";
import { shiftAnchor, type ScheduleViewMode, type ViewRange } from "../core/range";
import { EventForm } from "./event-form";

const BASE = "/dashboard/m/scheduling";
const HOUR_PX = 48;
const DAY_PX = HOUR_PX * 24;

const DOT: Record<string, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  green: "bg-green-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};
const CHIP: Record<string, string> = {
  slate: "bg-slate-500/15 border-slate-500/40 text-slate-900 dark:text-slate-100",
  blue: "bg-blue-500/15 border-blue-500/40 text-blue-900 dark:text-blue-100",
  green: "bg-green-500/15 border-green-500/40 text-green-900 dark:text-green-100",
  amber: "bg-amber-500/15 border-amber-500/40 text-amber-900 dark:text-amber-100",
  rose: "bg-rose-500/15 border-rose-500/40 text-rose-900 dark:text-rose-100",
  violet: "bg-violet-500/15 border-violet-500/40 text-violet-900 dark:text-violet-100",
};

/**
 * The calendar.
 *
 * NAVIGATION IS LINKS, NOT STATE. Previous, next, today and the view switcher
 * are `<Link>`s that change the URL, so the server fetches the new range and a
 * particular week stays linkable and refresh-proof. Only the event dialog is
 * client state, because it is the one thing that is not a location.
 */
export function CalendarView({
  mode,
  anchor,
  today,
  range,
  timeZone,
  items,
  calendars,
  members,
}: {
  mode: ScheduleViewMode;
  anchor: string;
  today: string;
  range: ViewRange;
  timeZone: string;
  items: ScheduleRangeItem[];
  calendars: CalendarSummary[];
  members: Array<{ clerkUserId: string; label: string }>;
}) {
  const [composing, setComposing] = useState<{ date: string } | null>(null);
  const [editing, setEditing] = useState<{
    itemId: string;
    occurrenceDate: string | null;
  } | null>(null);

  const colorOf = new Map(calendars.map((c) => [c.id, c.color || "slate"]));
  const writable = calendars.filter((c) => c.access === "write");

  const href = (next: { view?: ScheduleViewMode; date?: string }) =>
    `${BASE}?view=${next.view ?? mode}&date=${next.date ?? anchor}`;

  return (
    <div className="space-y-4">
      {/* The module had no title at all — the only h1 was the date range below,
          which changed every time you paged a week. */}
      <PageHeader
        title="Schedule"
        description="Jobs, appointments and time off, on the calendars you can see."
        icon={<CalendarDays />}
      />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={href({ date: today })}>Today</Link>
          </Button>
          <div className="flex items-center">
            <Button variant="ghost" size="icon" className="size-8" asChild>
              <Link href={href({ date: shiftAnchor(mode, anchor, -1) })}>
                <ChevronLeft className="size-4" />
                <span className="sr-only">Previous</span>
              </Link>
            </Button>
            <Button variant="ghost" size="icon" className="size-8" asChild>
              <Link href={href({ date: shiftAnchor(mode, anchor, 1) })}>
                <ChevronRight className="size-4" />
                <span className="sr-only">Next</span>
              </Link>
            </Button>
          </div>
          {/*
            NOT an h1. This is the range you are looking at — page state, not the
            page's name — and it was the only h1 on the screen, so the module had
            no title and the heading changed every time you paged a week. It
            keeps its visual weight; the `PageHeader` above owns the h1.
          */}
          <p
            aria-live="polite"
            className="font-heading text-lg font-semibold tracking-heading"
          >
            {rangeTitle(mode, range)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5">
            {(["day", "week", "month"] as const).map((m) => (
              <Link
                key={m}
                href={href({ view: m })}
                className={`rounded px-2.5 py-1 text-xs capitalize ${
                  m === mode ? "bg-muted font-medium" : "text-muted-foreground"
                }`}
              >
                {m}
              </Link>
            ))}
          </div>
          {/* Labelled, not an icon with sr-only text. This is the only route to
              the Calendars page, and an unlabelled cog is a poor front door to
              the screen that decides who can see what. */}
          <Button variant="outline" size="sm" asChild>
            <Link href={`${BASE}/calendars`}>
              <CalendarCog className="size-4" />
              Calendars
            </Link>
          </Button>
          <Button
            size="sm"
            disabled={writable.length === 0}
            onClick={() => setComposing({ date: anchor })}
          >
            <Plus className="mr-1.5 size-4" /> New event
          </Button>
        </div>
      </header>

      {writable.length === 0 && (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          You can look at these calendars but not add to them. Anything you own
          appears under{" "}
          <Link href={`${BASE}/calendars`} className="underline">
            Calendars
          </Link>
          .
        </p>
      )}

      {mode === "month" ? (
        <MonthGrid
          range={range}
          today={today}
          items={items}
          timeZone={timeZone}
          colorOf={colorOf}
          onOpen={setEditing}
          onAdd={(date) => setComposing({ date })}
        />
      ) : (
        <TimeGrid
          days={range.days}
          today={today}
          items={items}
          timeZone={timeZone}
          colorOf={colorOf}
          onOpen={setEditing}
        />
      )}

      {(composing || editing) && (
        <EventForm
          key={
            editing
              ? `${editing.itemId}:${editing.occurrenceDate ?? ""}`
              : composing?.date
          }
          itemId={editing?.itemId}
          occurrenceDate={editing?.occurrenceDate ?? null}
          defaultDate={composing?.date ?? anchor}
          timeZone={timeZone}
          calendars={writable}
          members={members}
          onClose={() => {
            setComposing(null);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function rangeTitle(mode: ScheduleViewMode, range: ViewRange): string {
  const long = (date: string) =>
    new Intl.DateTimeFormat("en-US", {
      // Parsed as UTC and formatted as UTC: these are calendar dates, not
      // instants, so introducing a zone here would shift the label by a day.
      timeZone: "UTC",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date(`${date}T12:00:00Z`));
  if (mode === "day") return long(range.from);
  if (mode === "month") {
    // The anchor month, not the first cell — a grid starting on 26 July is
    // still August.
    const mid = range.days[Math.floor(range.days.length / 2)];
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    }).format(new Date(`${mid}T12:00:00Z`));
  }
  return `${long(range.from)} – ${long(range.to)}`;
}

/**
 * A row's identity in the DOM.
 *
 * MUST include the occurrence date. Every occurrence of a repeating series
 * shares the item's id, so keying on `id` alone collapses a whole standup into
 * one rendered row and React reuses the wrong node when the week changes.
 */
function keyOf(item: ScheduleRangeItem): string {
  return `${item.id}:${item.occurrenceDate ?? ""}`;
}

/** What an item is called to THIS reader. Null title is not a bug. */
function labelOf(item: ScheduleRangeItem): string {
  // `busy` access carries no title by construction — the projection nulled it.
  // Saying "Busy" is the honest rendering; inventing a placeholder like
  // "(private)" would suggest the event is marked private when it is simply
  // not shared with this person at that level.
  return item.title ?? "Busy";
}

function TimeGrid({
  days,
  today,
  items,
  timeZone,
  colorOf,
  onOpen,
}: {
  days: string[];
  today: string;
  items: ScheduleRangeItem[];
  timeZone: string;
  colorOf: Map<string, string>;
  onOpen: (item: { itemId: string; occurrenceDate: string | null }) => void;
}) {
  const { allDay, timed } = partitionAllDay(items);

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <div style={{ minWidth: days.length > 1 ? 640 : undefined }}>
        {/* Day headings */}
        <div
          className="grid border-b bg-muted/30"
          style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, 1fr)` }}
        >
          <div />
          {days.map((date) => (
            <div key={date} className="px-2 py-1.5 text-center">
              <div className="text-xs text-muted-foreground">
                {new Intl.DateTimeFormat("en-US", {
                  timeZone: "UTC",
                  weekday: "short",
                }).format(new Date(`${date}T12:00:00Z`))}
              </div>
              <div
                className={`text-sm ${date === today ? "font-semibold text-primary" : ""}`}
              >
                {Number(date.slice(-2))}
              </div>
            </div>
          ))}
        </div>

        {/* All-day row. Always rendered, so the grid does not jump when the
            first all-day event of the week is added. */}
        <div
          className="grid border-b"
          style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, 1fr)` }}
        >
          <div className="px-1 py-1 text-right text-[10px] text-muted-foreground">
            all-day
          </div>
          {days.map((date) => {
            const dayStart = startOfDayInTimezone(date, timeZone);
            const dayEnd = startOfDayInTimezone(addDays(date, 1), timeZone);
            const here = allDay.filter((i) => spansDay(i, dayStart, dayEnd));
            return (
              <div key={date} className="min-h-[26px] space-y-0.5 border-l p-0.5">
                {here.map((item) => (
                  <button
                    key={keyOf(item)}
                    onClick={() =>
                      onOpen({ itemId: item.id, occurrenceDate: item.occurrenceDate })
                    }
                    className={`block w-full truncate rounded border px-1 text-left text-[11px] ${
                      CHIP[colorOf.get(item.calendarId) ?? "slate"]
                    }`}
                  >
                    {labelOf(item)}
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        {/* Timed grid */}
        <div
          className="relative grid"
          style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, 1fr)` }}
        >
          <div className="relative" style={{ height: DAY_PX }}>
            {Array.from({ length: 24 }, (_, hour) => (
              <div
                key={hour}
                className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground"
                style={{ top: hour * HOUR_PX }}
              >
                {hour === 0 ? "" : `${hour % 12 || 12}${hour < 12 ? "am" : "pm"}`}
              </div>
            ))}
          </div>

          {days.map((date) => {
            const dayStart = startOfDayInTimezone(date, timeZone);
            const dayEnd = startOfDayInTimezone(addDays(date, 1), timeZone);
            const here = timed.filter((i) => spansDay(i, dayStart, dayEnd));
            const placed = layoutDay(here);
            return (
              <div
                key={date}
                className="relative border-l"
                style={{ height: DAY_PX }}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <div
                    key={hour}
                    className="absolute inset-x-0 border-t border-border/40"
                    style={{ top: hour * HOUR_PX }}
                  />
                ))}
                {placed.map(({ item, column, columns }) => {
                  // Clamped to the day, so a multi-day event draws from the top
                  // of the column rather than off the top of the screen.
                  const start = Math.max(
                    item.startsAt.getTime(),
                    dayStart.getTime(),
                  );
                  const end = Math.min(item.endsAt.getTime(), dayEnd.getTime());
                  const top =
                    (start === dayStart.getTime()
                      ? 0
                      : minutesIntoDay(new Date(start), timeZone)) *
                    (HOUR_PX / 60);
                  const height = Math.max(
                    ((end - start) / 60_000) * (HOUR_PX / 60),
                    18,
                  );
                  return (
                    <button
                      key={keyOf(item)}
                      onClick={() =>
                      onOpen({ itemId: item.id, occurrenceDate: item.occurrenceDate })
                    }
                      title={labelOf(item)}
                      className={`absolute overflow-hidden rounded border px-1 text-left text-[11px] leading-tight ${
                        CHIP[colorOf.get(item.calendarId) ?? "slate"]
                      }`}
                      style={{
                        top,
                        height,
                        left: `calc(${(column / columns) * 100}% + 1px)`,
                        width: `calc(${100 / columns}% - 2px)`,
                      }}
                    >
                      <span className="block truncate font-medium">
                        {labelOf(item)}
                      </span>
                      {height > 30 && (
                        <span className="block truncate opacity-70">
                          {formatTimeInTimezone(item.startsAt, timeZone)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({
  range,
  today,
  items,
  timeZone,
  colorOf,
  onOpen,
  onAdd,
}: {
  range: ViewRange;
  today: string;
  items: ScheduleRangeItem[];
  timeZone: string;
  colorOf: Map<string, string>;
  onOpen: (item: { itemId: string; occurrenceDate: string | null }) => void;
  onAdd: (date: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="grid grid-cols-7 border-b bg-muted/30 text-center text-xs text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="py-1.5">
            {d}
          </div>
        ))}
      </div>
      {range.rows.map((row, rowIndex) => (
        <div key={rowIndex} className="grid grid-cols-7 border-b last:border-b-0">
          {row.map((date) => {
            const dayStart = startOfDayInTimezone(date, timeZone);
            const dayEnd = startOfDayInTimezone(addDays(date, 1), timeZone);
            const here = items.filter((i) => spansDay(i, dayStart, dayEnd));
            const shown = here.slice(0, 3);
            return (
              <div
                key={date}
                className="min-h-[92px] space-y-0.5 border-l p-1 first:border-l-0"
              >
                <button
                  onClick={() => onAdd(date)}
                  className={`text-xs ${
                    date === today
                      ? "font-semibold text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  {Number(date.slice(-2))}
                </button>
                {shown.map((item) => (
                  <button
                    key={keyOf(item)}
                    onClick={() =>
                      onOpen({ itemId: item.id, occurrenceDate: item.occurrenceDate })
                    }
                    className={`block w-full truncate rounded border px-1 text-left text-[11px] ${
                      CHIP[colorOf.get(item.calendarId) ?? "slate"]
                    }`}
                  >
                    <span
                      className={`mr-1 inline-block size-1.5 rounded-full align-middle ${
                        DOT[colorOf.get(item.calendarId) ?? "slate"]
                      }`}
                    />
                    {labelOf(item)}
                  </button>
                ))}
                {here.length > shown.length && (
                  <span className="block px-1 text-[10px] text-muted-foreground">
                    +{here.length - shown.length} more
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
