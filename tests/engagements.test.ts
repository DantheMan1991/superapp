import { describe, expect, it } from "vitest";
import {
  meter,
  minutesToCents,
  monthAfter,
  monthHistory,
  monthRange,
} from "../src/packs/professional-services/core/meter";
import {
  canTransition,
  engagementKindLabel,
  isValidEngagementKind,
  nextStatuses,
  parseDuration,
  transitionDone,
  transitionVerb,
} from "../src/packs/professional-services/vocabulary";

/**
 * The engagement's month, and the words around it. PURE — no database.
 *
 * The arithmetic that matters is the ROUNDING: a rate is per hour and time is
 * minutes, so a month's figure divides, and it must divide once on the total
 * rather than per entry.
 */

describe("minutesToCents", () => {
  it("prices an hour at the rate", () => {
    expect(minutesToCents(60, 15000)).toBe(15000);
    expect(minutesToCents(90, 15000)).toBe(22500);
    expect(minutesToCents(0, 15000)).toBe(0);
  });

  it("rounds once, on the total — sixty one-minute entries are an hour", () => {
    // Per entry: round(15000/60) = 250 a minute, ×60 = 15,000. Fine here, but
    // at $100.10 an hour it is round(10010/60)=167 ×60 = 10,020 — twenty cents
    // invented. The total is the only safe place to divide.
    expect(minutesToCents(60, 10010)).toBe(10010);
    expect(60 * Math.round(10010 / 60)).toBe(10020);
  });
});

describe("meter", () => {
  const base = { month: "2026-09", rateCents: 12000 };

  it("counts what is left of a retainer", () => {
    const m = meter({ ...base, usedMinutes: 120, includedMinutes: 600 });
    expect(m.remainingMinutes).toBe(480);
    expect(m.overageMinutes).toBe(0);
    expect(m.overageCents).toBe(0);
    expect(m.usedCents).toBe(24000);
    expect(m.isOver).toBe(false);
    expect(m.isNearLimit).toBe(false);
  });

  it("goes over, and prices the overage at the rate", () => {
    const m = meter({ ...base, usedMinutes: 690, includedMinutes: 600 });
    expect(m.overageMinutes).toBe(90);
    expect(m.overageCents).toBe(18000);
    expect(m.remainingMinutes).toBe(0);
    expect(m.isOver).toBe(true);
    expect(m.isNearLimit).toBe(false);
  });

  it("warns at four fifths, and stops warning once it is over", () => {
    expect(meter({ ...base, usedMinutes: 480, includedMinutes: 600 }).isNearLimit).toBe(true);
    expect(meter({ ...base, usedMinutes: 479, includedMinutes: 600 }).isNearLimit).toBe(false);
    expect(meter({ ...base, usedMinutes: 700, includedMinutes: 600 }).isNearLimit).toBe(false);
  });

  it("has no meter without a retainer — nothing is over when nothing was included", () => {
    const m = meter({ ...base, usedMinutes: 300, includedMinutes: 0 });
    expect(m.isOver).toBe(false);
    expect(m.isNearLimit).toBe(false);
    expect(m.overageMinutes).toBe(0);
    expect(m.remainingMinutes).toBe(0);
    // Everything logged is still priced — that is what an hourly engagement is.
    expect(m.usedCents).toBe(60000);
  });

  it("says nothing about money without a rate", () => {
    const m = meter({ month: "2026-09", usedMinutes: 300, includedMinutes: 60, rateCents: null });
    expect(m.overageCents).toBeNull();
    expect(m.usedCents).toBeNull();
    expect(m.isOver).toBe(true);
  });
});

describe("months", () => {
  it("rolls over a year", () => {
    expect(monthAfter("2026-11")).toBe("2026-12");
    expect(monthAfter("2026-12")).toBe("2027-01");
  });

  it("gives a half-open range a query can use", () => {
    expect(monthRange("2026-09")).toEqual({ from: "2026-09-01", to: "2026-10-01" });
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
  });
});

describe("monthHistory", () => {
  const allotments = [
    { effectiveMonth: "2026-07", includedMinutes: 600 },
    { effectiveMonth: "2026-09", includedMinutes: 1200 },
  ];

  it("keeps each month at the allotment that was agreed then", () => {
    const months = monthHistory({
      entries: [
        { workDate: "2026-07-10", minutes: 700 },
        { workDate: "2026-09-03", minutes: 700 },
      ],
      allotments,
      rateCents: 10000,
      through: "2026-09",
    });
    const july = months.find((m) => m.month === "2026-07")!;
    const september = months.find((m) => m.month === "2026-09")!;
    // Raising the retainer in September must not rewrite July's overage.
    expect(july.includedMinutes).toBe(600);
    expect(july.isOver).toBe(true);
    expect(september.includedMinutes).toBe(1200);
    expect(september.isOver).toBe(false);
  });

  it("is newest first, and lists a retainer month nobody worked", () => {
    const months = monthHistory({
      entries: [{ workDate: "2026-09-03", minutes: 60 }],
      allotments,
      rateCents: null,
      through: "2026-09",
    });
    expect(months.map((m) => m.month)).toEqual(["2026-09", "2026-08", "2026-07"]);
    expect(months.find((m) => m.month === "2026-08")!.usedMinutes).toBe(0);
  });

  it("stops at `through`, so a future-dated entry does not invent a month", () => {
    const months = monthHistory({
      entries: [
        { workDate: "2026-09-03", minutes: 60 },
        { workDate: "2026-11-01", minutes: 60 },
      ],
      allotments,
      rateCents: null,
      through: "2026-09",
    });
    expect(months.map((m) => m.month)).not.toContain("2026-11");
  });

  it("needs no allotment at all", () => {
    const months = monthHistory({
      entries: [{ workDate: "2026-09-03", minutes: 90 }],
      allotments: [],
      rateCents: 20000,
      through: "2026-09",
    });
    expect(months).toHaveLength(1);
    expect(months[0].usedCents).toBe(30000);
  });
});

describe("engagement kinds", () => {
  it("takes a slug and refuses anything else", () => {
    expect(isValidEngagementKind("retainer")).toBe(true);
    expect(isValidEngagementKind("fixed_fee")).toBe(true);
    expect(isValidEngagementKind("Retainer")).toBe(false);
    expect(isValidEngagementKind("2nd_project")).toBe(false);
    expect(isValidEngagementKind("fixed fee")).toBe(false);
  });

  it("renders a slug as words", () => {
    expect(engagementKindLabel("fixed_fee")).toBe("Fixed fee");
  });
});

describe("status transitions", () => {
  it("goes where an engagement can go", () => {
    expect(canTransition("proposed", "active")).toBe(true);
    expect(canTransition("active", "paused")).toBe(true);
    expect(canTransition("paused", "active")).toBe(true);
    // Ending is reversible, which is why nothing asks twice.
    expect(canTransition("ended", "active")).toBe(true);
  });

  it("refuses what it cannot", () => {
    expect(canTransition("proposed", "paused")).toBe(false);
    expect(canTransition("ended", "paused")).toBe(false);
    expect(canTransition("active", "proposed")).toBe(false);
  });

  it("names the move in the reader's words, both tenses", () => {
    expect(nextStatuses("active")).toEqual(["paused", "ended"]);
    expect(transitionVerb("proposed", "active")).toBe("Start");
    expect(transitionVerb("paused", "active")).toBe("Resume");
    expect(transitionVerb("ended", "active")).toBe("Reopen");
    expect(transitionDone("ended", "active")).toBe("Reopened");
    expect(transitionDone("active", "ended")).toBe("Ended");
  });
});

describe("parseDuration", () => {
  it("reads the ways somebody writes an hour and a half", () => {
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("1.5")).toBe(90);
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("90m")).toBe(90);
    expect(parseDuration("90 minutes")).toBe(90);
  });

  it("reads a small bare number as hours and a large one as minutes", () => {
    // "2" is two hours; nobody logs two minutes. "45" is forty-five minutes;
    // nobody logs a forty-five-hour afternoon.
    expect(parseDuration("2")).toBe(120);
    expect(parseDuration("15")).toBe(900);
    expect(parseDuration("45")).toBe(45);
  });

  it("answers zero rather than guessing", () => {
    expect(parseDuration("")).toBe(0);
    expect(parseDuration("a while")).toBe(0);
    expect(parseDuration("-2")).toBe(0);
    expect(parseDuration("1:75")).toBe(0);
  });
});
