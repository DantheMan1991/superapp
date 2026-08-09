import { describe, expect, it } from "vitest";
import {
  layoutDay,
  partitionAllDay,
  spansDay,
} from "../src/modules/scheduling/core/layout";

const at = (hhmm: string) => new Date(`2026-08-10T${hhmm}:00Z`);
const ev = (id: string, from: string, to: string) => ({
  id,
  startsAt: at(from),
  endsAt: at(to),
});

/** id → {column, columns}, so assertions read like the picture. */
function positions(items: ReturnType<typeof ev>[]) {
  const out: Record<string, string> = {};
  for (const p of layoutDay(items)) out[p.item.id] = `${p.column}/${p.columns}`;
  return out;
}

describe("layoutDay", () => {
  it("gives a lone event the whole column", () => {
    expect(positions([ev("a", "09:00", "10:00")])).toEqual({ a: "0/1" });
  });

  it("does not overlap events that merely touch", () => {
    // 9–10 and 10–11 share no time. Two full-width columns, one after another.
    expect(positions([ev("a", "09:00", "10:00"), ev("b", "10:00", "11:00")]))
      .toEqual({ a: "0/1", b: "0/1" });
  });

  it("splits two genuinely overlapping events", () => {
    expect(positions([ev("a", "09:00", "10:30"), ev("b", "10:00", "11:00")]))
      .toEqual({ a: "0/2", b: "1/2" });
  });

  it("handles the TRANSITIVE case, which is the one that goes wrong", () => {
    // A overlaps B, B overlaps C, A and C never touch.
    //
    // The cluster is three events wide but only TWO columns, because width is
    // maximum CONCURRENCY, not cluster size: at no instant are three of these
    // running at once. C reuses A's column, since A has finished by then.
    //
    // What the clustering buys is that all three agree on the same width. Laid
    // out independently, A and C would each claim the full column and overlap B.
    const result = positions([
      ev("a", "09:00", "10:00"),
      ev("b", "09:30", "10:30"),
      ev("c", "10:00", "11:00"),
    ]);
    expect(result.a).toBe("0/2");
    expect(result.b).toBe("1/2");
    expect(result.c).toBe("0/2");
  });

  it("widens to three columns when three really are concurrent", () => {
    const result = positions([
      ev("a", "09:00", "11:00"),
      ev("b", "09:30", "11:00"),
      ev("c", "10:00", "11:00"),
    ]);
    expect(result).toEqual({ a: "0/3", b: "1/3", c: "2/3" });
  });

  it("starts a new cluster once the day clears", () => {
    const result = positions([
      ev("a", "09:00", "10:00"),
      ev("b", "09:30", "10:30"),
      ev("c", "14:00", "15:00"),
    ]);
    expect(result.a).toBe("0/2");
    expect(result.b).toBe("1/2");
    // Nothing to share with, so the afternoon event is full width again.
    expect(result.c).toBe("0/1");
  });

  it("puts the longer event first when two start together", () => {
    const result = positions([
      ev("short", "09:00", "09:15"),
      ev("long", "09:00", "10:00"),
    ]);
    expect(result.long).toBe("0/2");
    expect(result.short).toBe("1/2");
  });

  it("is stable — same input, same layout, every time", () => {
    // Two identical spans differing only by id. Without the id tiebreak these
    // swap columns between renders, which reads as the calendar flickering.
    const a = [ev("b", "09:00", "10:00"), ev("a", "09:00", "10:00")];
    const b = [ev("a", "09:00", "10:00"), ev("b", "09:00", "10:00")];
    expect(positions(a)).toEqual(positions(b));
    expect(positions(a).a).toBe("0/2");
  });

  it("returns every event it was given", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      ev(`e${i}`, `${String(9 + (i % 6)).padStart(2, "0")}:00`, `${String(10 + (i % 6)).padStart(2, "0")}:30`),
    );
    expect(layoutDay(many)).toHaveLength(12);
  });

  it("handles an empty day", () => {
    expect(layoutDay([])).toEqual([]);
  });
});

describe("partitionAllDay", () => {
  it("splits on the FLAG, not on the times", () => {
    // An overnight shift starting at midnight is a timed event, not an all-day
    // one. Only the author's flag decides.
    const items = [
      { ...ev("shift", "00:00", "08:00"), allDay: false },
      { ...ev("holiday", "00:00", "00:00"), allDay: true },
    ];
    const { allDay, timed } = partitionAllDay(items);
    expect(allDay.map((i) => i.id)).toEqual(["holiday"]);
    expect(timed.map((i) => i.id)).toEqual(["shift"]);
  });
});

describe("spansDay", () => {
  const dayStart = new Date("2026-08-10T00:00:00Z");
  const dayEnd = new Date("2026-08-11T00:00:00Z");

  it("includes an event that starts and ends inside the day", () => {
    expect(spansDay(ev("a", "09:00", "10:00"), dayStart, dayEnd)).toBe(true);
  });

  it("includes a multi-day event on its middle day", () => {
    const long = {
      id: "l",
      startsAt: new Date("2026-08-09T12:00:00Z"),
      endsAt: new Date("2026-08-12T12:00:00Z"),
    };
    expect(spansDay(long, dayStart, dayEnd)).toBe(true);
  });

  it("excludes an event that ends exactly at midnight", () => {
    const prev = {
      id: "p",
      startsAt: new Date("2026-08-09T22:00:00Z"),
      endsAt: dayStart,
    };
    expect(spansDay(prev, dayStart, dayEnd)).toBe(false);
  });
});
