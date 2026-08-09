/**
 * iCalendar (RFC 5545) serialisation.
 *
 * Pure, and tested, because the two things that break real calendar clients are
 * both invisible when you eyeball the output: **line folding is counted in
 * OCTETS, not characters**, and **the delimiters have to be escaped**. A feed
 * that looks perfect in a terminal can still fail to import.
 *
 * Deliberately hand-written rather than a dependency. The whole job is four
 * rules, and an ICS library is a lot of surface for a file that has to be
 * byte-correct rather than feature-complete.
 */

export interface IcsEvent {
  /** Globally unique and STABLE across regenerations — see `buildCalendar`. */
  uid: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  summary: string;
  description?: string;
  location?: string;
  /** False renders TRANSP:TRANSPARENT, so the event does not block time. */
  busy: boolean;
  cancelled?: boolean;
}

/** `20260910T140000Z` — UTC form, unambiguous and needs no VTIMEZONE block. */
function utcStamp(at: Date): string {
  return `${at.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/** `20260910` — a floating calendar DATE, for all-day events. */
function dateStamp(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(at)
    .replace(/-/g, "");
}

/**
 * RFC 5545 §3.3.11. The order matters: backslash first, or the escapes we add
 * for the others get escaped again.
 *
 * Newlines become a literal `\n` because a raw one would be read as the end of
 * the property — which is how a multi-line description silently truncates a
 * whole event.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * RFC 5545 §3.1: no line may exceed 75 OCTETS, and continuations begin with a
 * single space.
 *
 * Octets, not characters. A line of 70 emoji is 280 bytes and some parsers
 * simply stop reading it. Splitting must also never land inside a multi-byte
 * sequence, which is why this walks code points and measures their encoded
 * length rather than slicing the string.
 */
export function foldLine(line: string): string {
  const LIMIT = 75;
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    // Continuations carry a leading space, so they have one octet less room.
    const room = out.length === 0 ? LIMIT : LIMIT - 1;
    if (bytes + size > room) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out.map((part, i) => (i === 0 ? part : ` ${part}`)).join("\r\n");
}

function property(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

export interface CalendarInput {
  /** Shown as the calendar's name in most clients (X-WR-CALNAME). */
  name: string;
  /** The zone all-day DATE values are computed in. */
  timeZone: string;
  events: IcsEvent[];
  /** Passed in rather than read from the clock, so output is reproducible. */
  now: Date;
}

/**
 * A complete VCALENDAR.
 *
 * `UID` MUST BE STABLE. A client treats a changed uid as a different event, so
 * regenerating the feed with fresh ids would delete and re-add somebody's whole
 * calendar on every refresh — alarms and all. The item's own id is used, which
 * is stable by construction.
 *
 * `DTSTAMP` is when the feed was generated, and it changes every fetch. That is
 * correct per the spec and harmless: clients compare `SEQUENCE` and `LAST-
 * MODIFIED` for real changes.
 *
 * CRLF THROUGHOUT, including the final line. Bare LF is the single commonest
 * reason a feed imports in one client and not another.
 */
export function buildCalendar(input: CalendarInput): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Yosher//Scheduling//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    property("X-WR-CALNAME", escapeText(input.name)),
    property("X-WR-TIMEZONE", input.timeZone),
  ];

  for (const event of input.events) {
    lines.push("BEGIN:VEVENT");
    lines.push(property("UID", event.uid));
    lines.push(property("DTSTAMP", utcStamp(input.now)));
    if (event.allDay) {
      // VALUE=DATE, and DTEND is EXCLUSIVE in the spec — which is exactly how
      // all-day events are already stored, so no adjustment is needed here.
      lines.push(`DTSTART;VALUE=DATE:${dateStamp(event.startsAt, input.timeZone)}`);
      lines.push(`DTEND;VALUE=DATE:${dateStamp(event.endsAt, input.timeZone)}`);
    } else {
      lines.push(property("DTSTART", utcStamp(event.startsAt)));
      lines.push(property("DTEND", utcStamp(event.endsAt)));
    }
    lines.push(property("SUMMARY", escapeText(event.summary)));
    if (event.description) {
      lines.push(property("DESCRIPTION", escapeText(event.description)));
    }
    if (event.location) {
      lines.push(property("LOCATION", escapeText(event.location)));
    }
    lines.push(`TRANSP:${event.busy ? "OPAQUE" : "TRANSPARENT"}`);
    lines.push(`STATUS:${event.cancelled ? "CANCELLED" : "CONFIRMED"}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
