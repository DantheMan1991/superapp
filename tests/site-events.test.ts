import { describe, expect, it } from "vitest";
import { eventDate, eventKey, eventWhen, upcomingEvents, type LiveEvent } from "../src/lib/sites/events-core";
import { newSection, sectionSummary } from "../src/lib/sites/pages";
import { SectionSchema } from "../src/lib/sites/schema";

const TZ = "America/New_York";
const NOW = new Date("2026-09-10T12:00:00Z");

function event(over: Partial<LiveEvent> & Pick<LiveEvent, "id" | "startsAt" | "endsAt">): LiveEvent {
  return { occurrenceDate: null, title: over.id, location: "", allDay: false, ...over };
}

describe("a what's on section", () => {
  it("starts with the next five, three months ahead", () => {
    const section = SectionSchema.parse(newSection("events"));
    expect(section).toMatchObject({ type: "events", heading: "What's on", count: 5, horizonDays: 90, emptyText: "" });
    expect(sectionSummary(newSection("events"))).toBe("What's on: the next 5");
    expect(SectionSchema.safeParse({ ...newSection("events"), count: 4 }).success).toBe(false);
    expect(SectionSchema.safeParse({ ...newSection("events"), horizonDays: 365 }).success).toBe(false);
  });

  it("shows what is still to come inside the horizon, soonest first, up to the count", () => {
    const events = [
      event({ id: "later", startsAt: "2026-09-20T13:00:00Z", endsAt: "2026-09-20T15:00:00Z" }),
      event({ id: "past", startsAt: "2026-09-01T13:00:00Z", endsAt: "2026-09-01T15:00:00Z" }),
      event({ id: "under way", startsAt: "2026-09-10T11:00:00Z", endsAt: "2026-09-10T14:00:00Z" }),
      event({ id: "soon", startsAt: "2026-09-12T13:00:00Z", endsAt: "2026-09-12T15:00:00Z" }),
      event({ id: "far", startsAt: "2026-12-20T13:00:00Z", endsAt: "2026-12-20T15:00:00Z" }),
    ];
    expect(upcomingEvents(events, NOW, 90, 10).map((e) => e.id)).toEqual(["under way", "soon", "later"]);
    expect(upcomingEvents(events, NOW, 180, 10).map((e) => e.id)).toEqual(["under way", "soon", "later", "far"]);
    expect(upcomingEvents(events, NOW, 90, 2).map((e) => e.id)).toEqual(["under way", "soon"]);
    expect(upcomingEvents([], NOW, 90, 5)).toEqual([]);
  });

  it("says the day and the time the way a poster would", () => {
    const timed = event({ id: "market", startsAt: "2026-09-12T12:00:00Z", endsAt: "2026-09-12T16:00:00Z" });
    expect(eventDate(timed, TZ)).toEqual({ weekday: "Sat", day: "12", month: "Sep" });
    expect(eventWhen(timed, TZ)).toBe("8:00 am to 12:00 pm");
    const allDay = event({ id: "open day", startsAt: "2026-09-12T04:00:00Z", endsAt: "2026-09-13T04:00:00Z", allDay: true });
    expect(eventWhen(allDay, TZ)).toBe("All day");
    const festival = event({ id: "festival", startsAt: "2026-09-12T04:00:00Z", endsAt: "2026-09-15T04:00:00Z", allDay: true });
    expect(eventWhen(festival, TZ)).toBe("Sep 12 to Sep 14");
    const overnight = event({ id: "camp", startsAt: "2026-09-12T20:00:00Z", endsAt: "2026-09-13T14:00:00Z" });
    expect(eventWhen(overnight, TZ)).toBe("Sep 12, 4:00 pm to Sep 13, 10:00 am");
  });

  it("keys a repeating event's occurrences apart", () => {
    expect(eventKey(event({ id: "a", startsAt: "2026-09-12T12:00:00Z", endsAt: "2026-09-12T13:00:00Z" }))).toBe("a");
    expect(eventKey(event({ id: "a", occurrenceDate: "2026-09-19", startsAt: "2026-09-19T12:00:00Z", endsAt: "2026-09-19T13:00:00Z" }))).toBe("a:2026-09-19");
  });
});
