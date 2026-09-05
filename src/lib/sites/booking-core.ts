import { z } from "zod";
import { findFreeSlots, type Interval } from "@/lib/schedule/availability";
import { dateInTimezone } from "@/lib/timezone";
import type { Section } from "./schema";

/**
 * Booking a time from a site — the maths and the words, no I/O (ADR 0025).
 *
 * The RULES are the section's: how long a booking is, which days and
 * hours, how much notice, how far ahead. The BUSY TIME is the business's
 * Bookings calendar, read by the server. What is offered is the free slots
 * inside the rules, aligned to the half hour by `findFreeSlots`, the seam
 * the scheduling module built for exactly this; a booking is refused unless
 * its start is one of them, recomputed at the moment it is written, so two
 * visitors cannot both have 9:00.
 */
export type BookingSection = Extract<Section, { type: "booking" }>;
export type BookingRules = Pick<
  BookingSection,
  "minutes" | "days" | "from" | "to" | "leadHours" | "horizonDays"
>;

/** The same valves as the enquiry form: a page is not a booking engine. */
export const BOOKING_HOURLY_IP_CAP = 5;
export const BOOKING_DAILY_CAP = 1000;
export const BOOKING_SITE_DAILY_CAP = 100;
/** Reading the open times is cheap; a visitor reloads a few times, a scraper does not need more. */
export const SLOTS_HOURLY_IP_CAP = 60;
export const SLOTS_DAILY_CAP = 50_000;
export const BOOKING_NOTE_MAX = 1000;
/** Offered at most, whatever the horizon. */
export const BOOKING_SLOTS_MAX = 400;

export interface BookingState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
  /** The time that was booked, as words, on success. */
  booked?: string;
}

export const SiteBookingSchema = z.object({
  site: z.string().trim().min(1).max(60),
  page: z.string().trim().max(200).default("/"),
  section: z.coerce.number().int().min(0).max(11).default(0),
  /** The chosen start, ISO 8601, exactly as the open times named it. */
  start: z.iso.datetime({ offset: true, message: "Pick a time." }),
  name: z.string().trim().min(1, "Tell us who you are.").max(120, "That name is too long."),
  email: z
    .string()
    .trim()
    .email("That email doesn't look right. Check it and try again.")
    .max(254, "That email is too long."),
  phone: z.string().trim().max(40, "That phone number is too long.").default(""),
  note: z
    .string()
    .transform((s) => s.slice(0, BOOKING_NOTE_MAX).trim())
    .default(""),
});
export type SiteBookingInput = z.infer<typeof SiteBookingSchema>;

/** The span a visitor may book in: after the notice, before the horizon. */
export function bookingWindow(rules: BookingRules, now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() + rules.leadHours * 3_600_000),
    to: new Date(now.getTime() + rules.horizonDays * 86_400_000),
  };
}

export interface OfferedSlot {
  /** ISO 8601 instants. */
  start: string;
  end: string;
  /** "9:00 am" in the business's zone. */
  label: string;
}

export interface OfferedDay {
  /** `yyyy-mm-dd` in the business's zone. */
  date: string;
  /** "Sat, Sep 12". */
  label: string;
  slots: OfferedSlot[];
}

export function timeLabel(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone })
    .format(at)
    .toLowerCase();
}

export function dayLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

/** "Saturday, September 12, 9:00 to 9:30 am", for the calendar, the follow-up and the email. */
export function describeBooking(start: Date, end: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(start);
  return `${day}, ${timeLabel(start, timeZone)} to ${timeLabel(end, timeZone)}`;
}

/** The open times inside the rules, grouped by day in the business's zone. */
export function offerSlots(
  rules: BookingRules,
  busy: readonly Interval[],
  now: Date,
  timeZone: string,
): OfferedDay[] {
  const { from, to } = bookingWindow(rules, now);
  const slots = findFreeSlots({
    busy,
    from,
    to,
    durationMinutes: rules.minutes,
    timeZone,
    dayStart: rules.from,
    dayEnd: rules.to,
    weekdays: rules.days,
    limit: BOOKING_SLOTS_MAX,
  });
  const days = new Map<string, OfferedDay>();
  for (const slot of slots) {
    const date = dateInTimezone(slot.startsAt, timeZone);
    let day = days.get(date);
    if (!day) {
      day = { date, label: dayLabel(date), slots: [] };
      days.set(date, day);
    }
    day.slots.push({
      start: slot.startsAt.toISOString(),
      end: slot.endsAt.toISOString(),
      label: timeLabel(slot.startsAt, timeZone),
    });
  }
  return [...days.values()];
}

/** Whether this start is one of the times that would be offered right now. */
export function isOffered(
  rules: BookingRules,
  busy: readonly Interval[],
  start: Date,
  now: Date,
  timeZone: string,
): boolean {
  const iso = start.toISOString();
  return offerSlots(rules, busy, now, timeZone).some((day) => day.slots.some((s) => s.start === iso));
}
