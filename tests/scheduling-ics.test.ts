import { describe, expect, it } from "vitest";
import {
  buildCalendar,
  escapeText,
  foldLine,
  type IcsEvent,
} from "../src/modules/scheduling/core/ics";

/**
 * The two things that break real calendar clients are both invisible when you
 * eyeball the output: folding is counted in OCTETS, and delimiters have to be
 * escaped. Weighted accordingly.
 */
const NOW = new Date("2026-09-01T12:00:00Z");
const TZ = "America/New_York";

const event = (over: Partial<IcsEvent> = {}): IcsEvent => ({
  uid: "evt-1",
  startsAt: new Date("2026-09-10T18:00:00Z"),
  endsAt: new Date("2026-09-10T19:00:00Z"),
  allDay: false,
  summary: "Site visit",
  busy: true,
  ...over,
});

const lines = (ics: string) => ics.split("\r\n");

describe("escapeText", () => {
  it("escapes the delimiters, backslash first", () => {
    expect(escapeText("a;b,c")).toBe("a\\;b\\,c");
    // Backslash first, or the escapes added for the others get escaped again.
    expect(escapeText("back\\slash")).toBe("back\\\\slash");
    expect(escapeText("a\\;b")).toBe("a\\\\\\;b");
  });

  it("turns a newline into a literal \\n", () => {
    // A raw newline reads as the end of the property, which silently truncates
    // the rest of the event.
    expect(escapeText("one\ntwo")).toBe("one\\ntwo");
    expect(escapeText("one\r\ntwo")).toBe("one\\ntwo");
  });
});

describe("foldLine", () => {
  const octets = (s: string) => new TextEncoder().encode(s).length;

  it("leaves a short line alone", () => {
    expect(foldLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("folds at 75 octets with a leading space on continuations", () => {
    const folded = foldLine(`SUMMARY:${"a".repeat(200)}`);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    expect(octets(parts[0])).toBeLessThanOrEqual(75);
    for (const part of parts.slice(1)) {
      expect(part.startsWith(" ")).toBe(true);
      expect(octets(part)).toBeLessThanOrEqual(75);
    }
    // Unfolding must give the original back.
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join("")).toBe(
      `SUMMARY:${"a".repeat(200)}`,
    );
  });

  it("COUNTS OCTETS, NOT CHARACTERS", () => {
    // 40 emoji is 40 characters and 160 bytes. A character-counting folder
    // would emit one 160-octet line, which some parsers stop reading.
    const folded = foldLine(`SUMMARY:${"😀".repeat(40)}`);
    for (const part of folded.split("\r\n")) {
      expect(octets(part)).toBeLessThanOrEqual(75);
    }
  });

  it("never splits inside a multi-byte character", () => {
    const folded = foldLine(`SUMMARY:${"é".repeat(100)}`);
    // A split mid-sequence produces U+FFFD when re-decoded.
    expect(folded).not.toContain("�");
    expect(
      folded
        .split("\r\n")
        .map((p, i) => (i === 0 ? p : p.slice(1)))
        .join(""),
    ).toBe(`SUMMARY:${"é".repeat(100)}`);
  });
});

describe("buildCalendar", () => {
  it("wraps events in a valid VCALENDAR and ends with CRLF", () => {
    const ics = buildCalendar({ name: "Dan", timeZone: TZ, events: [event()], now: NOW });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    // Bare LF is the commonest reason a feed imports in one client and not
    // another, so assert there is none.
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("writes timed events in UTC, needing no VTIMEZONE", () => {
    const ics = buildCalendar({ name: "c", timeZone: TZ, events: [event()], now: NOW });
    expect(ics).toContain("DTSTART:20260910T180000Z");
    expect(ics).toContain("DTEND:20260910T190000Z");
  });

  it("writes all-day events as DATE in the tenant's zone", () => {
    // 04:00Z is midnight in New York on the 10th — the DATE must be the 10th,
    // not the 9th or the 11th.
    const ics = buildCalendar({
      name: "c",
      timeZone: TZ,
      now: NOW,
      events: [
        event({
          allDay: true,
          startsAt: new Date("2026-09-10T04:00:00Z"),
          endsAt: new Date("2026-09-11T04:00:00Z"),
        }),
      ],
    });
    expect(ics).toContain("DTSTART;VALUE=DATE:20260910");
    // DTEND is exclusive in the spec, which is how all-day is already stored.
    expect(ics).toContain("DTEND;VALUE=DATE:20260911");
  });

  it("marks a free event TRANSPARENT so it does not block time", () => {
    const busy = buildCalendar({ name: "c", timeZone: TZ, now: NOW, events: [event()] });
    const free = buildCalendar({
      name: "c",
      timeZone: TZ,
      now: NOW,
      events: [event({ busy: false })],
    });
    expect(busy).toContain("TRANSP:OPAQUE");
    expect(free).toContain("TRANSP:TRANSPARENT");
  });

  it("escapes a summary that contains delimiters", () => {
    const ics = buildCalendar({
      name: "c",
      timeZone: TZ,
      now: NOW,
      events: [event({ summary: "Meet Bob; bring plans, please" })],
    });
    expect(ics).toContain("SUMMARY:Meet Bob\\; bring plans\\, please");
  });

  it("keeps the UID stable — it is the item's own id", () => {
    const a = buildCalendar({ name: "c", timeZone: TZ, now: NOW, events: [event()] });
    const b = buildCalendar({
      name: "c",
      timeZone: TZ,
      now: new Date("2026-09-02T12:00:00Z"),
      events: [event()],
    });
    // Only DTSTAMP differs. A changed UID would make a client delete and re-add
    // the whole calendar on every refresh, alarms included.
    expect(lines(a).filter((l) => l.startsWith("UID:"))).toEqual(
      lines(b).filter((l) => l.startsWith("UID:")),
    );
    expect(lines(a).filter((l) => l.startsWith("DTSTAMP:"))).not.toEqual(
      lines(b).filter((l) => l.startsWith("DTSTAMP:")),
    );
  });

  it("emits one VEVENT per event, and an empty calendar is still valid", () => {
    const many = buildCalendar({
      name: "c",
      timeZone: TZ,
      now: NOW,
      events: [event({ uid: "a" }), event({ uid: "b" }), event({ uid: "c" })],
    });
    expect(many.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(many.match(/END:VEVENT/g)).toHaveLength(3);

    const empty = buildCalendar({ name: "c", timeZone: TZ, now: NOW, events: [] });
    expect(empty).toContain("BEGIN:VCALENDAR");
    expect(empty).not.toContain("BEGIN:VEVENT");
  });

  it("marks a cancelled event CANCELLED rather than dropping it", () => {
    const ics = buildCalendar({
      name: "c",
      timeZone: TZ,
      now: NOW,
      events: [event({ cancelled: true })],
    });
    expect(ics).toContain("STATUS:CANCELLED");
  });
});
