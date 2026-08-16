import { describe, expect, it } from "vitest";
import {
  areaGrazed,
  dayBefore,
  daysBetween,
  daysOccupied,
  formatDays,
  paddocksForTarget,
  restFromPaddocks,
  rotationFinding,
  zoneRest,
} from "../src/packs/land/core/rest";

/**
 * Rest and rotation arithmetic.
 *
 * The two things worth the most attention here are the inclusive day count —
 * an off-by-one propagates into every rotation figure — and the fact that
 * "never grazed" is NOT "infinitely rested". Everything else is a formula every
 * grazier already knows.
 */

describe("day arithmetic", () => {
  it("counts plain differences", () => {
    expect(daysBetween("2026-04-01", "2026-04-10")).toBe(9);
    expect(daysBetween("2026-04-10", "2026-04-01")).toBe(-9);
    expect(daysBetween("2026-04-01", "2026-04-01")).toBe(0);
  });

  it("crosses a month end", () => {
    expect(daysBetween("2026-01-31", "2026-02-01")).toBe(1);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
  });

  it("crosses a leap day", () => {
    // 2028 is a leap year: Feb has 29 days.
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
  });

  it("crosses a year end", () => {
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
    expect(daysBetween("2025-01-01", "2026-01-01")).toBe(365);
  });

  it("steps back a day across every boundary a move can land on", () => {
    // `moveOccupant` closes the old stay on this date. It is arithmetic that
    // runs on every rotation, so month ends, leap days and year ends are the
    // ordinary path rather than edge cases.
    expect(dayBefore("2026-04-10")).toBe("2026-04-09");
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
    expect(dayBefore("2028-03-01")).toBe("2028-02-29");
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
  });

  it("makes a move-day handover add up to exactly the days that passed", () => {
    // THE PROPERTY THE DATE RULE EXISTS FOR. On A from the 1st, moved to B on
    // the 10th: nine days on A, and the 10th belongs to B alone. Ending A on
    // the 10th instead would make these sum to eleven days out of ten.
    const movedOn = "2026-04-10";
    const aDays = daysOccupied("2026-04-01", dayBefore(movedOn));
    const bDays = daysOccupied(movedOn, "2026-04-15");
    expect(aDays).toBe(9);
    expect(bDays).toBe(6);
    expect(aDays + bDays).toBe(daysOccupied("2026-04-01", "2026-04-15"));
  });

  it("counts a stay inclusively at BOTH ends", () => {
    // In on Monday, out on Monday is one day of grazing, not zero — the
    // animals ate. This is the number the paddock arithmetic runs on, so an
    // off-by-one here reaches every rotation figure on the page.
    expect(daysOccupied("2026-04-01", "2026-04-01")).toBe(1);
    expect(daysOccupied("2026-04-01", "2026-04-02")).toBe(2);
    expect(daysOccupied("2026-04-01", "2026-04-30")).toBe(30);
  });
});

describe("zoneRest", () => {
  const TODAY = "2026-08-15";

  it("distinguishes never-used from long-rested", () => {
    // A paddock nobody has used and one resting 200 days are different facts.
    // Collapsing them puts every brand new zone at the top of a "most rested"
    // list on the day it is created.
    const never = zoneRest([], TODAY);
    expect(never.status).toBe("never_grazed");
    expect(never.restDays).toBeNull();
    expect(never.grazingDays).toBe(0);
    expect(never.stays).toBe(0);
  });

  it("counts rest from the day the last stay ended", () => {
    const rest = zoneRest(
      [{ startedOn: "2026-08-01", endedOn: "2026-08-05" }],
      TODAY,
    );
    expect(rest.status).toBe("resting");
    expect(rest.restDays).toBe(10);
    expect(rest.restingSince).toBe("2026-08-05");
    expect(rest.grazingDays).toBe(5);
    expect(rest.stays).toBe(1);
  });

  it("reads an open stay as occupied, not as zero rest", () => {
    const rest = zoneRest(
      [{ startedOn: "2026-08-13", endedOn: null }],
      TODAY,
    );
    expect(rest.status).toBe("occupied");
    // Null rather than 0: nothing is resting, so there is no number to report.
    expect(rest.restDays).toBeNull();
    // An open stay still counts the days it has run, or a herd that has been
    // somewhere three weeks would read as zero grazing days.
    expect(rest.grazingDays).toBe(3);
  });

  it("takes the LATEST end date, not the last row", () => {
    // Rows arrive newest-first from the query, but a backdated correction can
    // land in any order. The clock must follow the dates, not the ordering.
    const rest = zoneRest(
      [
        { startedOn: "2026-06-01", endedOn: "2026-06-03" },
        { startedOn: "2026-07-01", endedOn: "2026-07-04" },
        { startedOn: "2026-05-01", endedOn: "2026-05-02" },
      ],
      TODAY,
    );
    expect(rest.restingSince).toBe("2026-07-04");
    expect(rest.restDays).toBe(42);
    expect(rest.grazingDays).toBe(3 + 4 + 2);
    expect(rest.stays).toBe(3);
  });

  it("is occupied if ANY stay is open, even alongside closed ones", () => {
    const rest = zoneRest(
      [
        { startedOn: "2026-08-10", endedOn: null },
        { startedOn: "2026-06-01", endedOn: "2026-06-03" },
      ],
      TODAY,
    );
    expect(rest.status).toBe("occupied");
  });

  // ---- what has happened, versus what is planned -------------------------
  //
  // Every case below was wrong until 2026-08-16, and one of them was wrong
  // WITH A TEST ASSERTING IT — the booked-departure case read "resting 0 days"
  // while the herd was still standing on the ground. Clamping a negative
  // number to zero hid the question instead of answering it. Found by driving
  // the one-act move, which put the "On" date in reach and made recording a
  // stay ahead of time easy.

  it("counts a booked departure as STILL OCCUPIED, not as rested", () => {
    // On since the 1st, leaving on the 20th, today is the 15th. They are
    // eating. The rest clock has not started and must not read 0 days, which
    // is a number somebody rotates on.
    const rest = zoneRest(
      [{ startedOn: "2026-08-01", endedOn: "2026-08-20" }],
      TODAY,
    );
    expect(rest.status).toBe("occupied");
    expect(rest.restDays).toBeNull();
    // And only the days actually elapsed: the 1st to the 15th, not to the 20th.
    expect(rest.grazingDays).toBe(15);
  });

  it("ignores a stay that has not begun", () => {
    // "They go to Creek Paddock on Monday", typed on Friday. It used to read
    // as occupied the moment it was saved, stopping the rest clock days early
    // on ground nothing was standing on.
    const rest = zoneRest(
      [
        { startedOn: "2026-06-01", endedOn: "2026-06-05" },
        { startedOn: "2026-08-20", endedOn: null },
      ],
      TODAY,
    );
    expect(rest.status).toBe("resting");
    expect(rest.restingSince).toBe("2026-06-05");
    expect(rest.restDays).toBe(71);
    // The planned stay contributes nothing — not a day, not a count.
    expect(rest.grazingDays).toBe(5);
    expect(rest.stays).toBe(1);
  });

  it("treats a paddock whose only stay is in the future as never used", () => {
    // Not "rested forever" and not "occupied". Nothing has been on it, which
    // is what never_grazed means.
    const rest = zoneRest([{ startedOn: "2026-09-01", endedOn: null }], TODAY);
    expect(rest.status).toBe("never_grazed");
    expect(rest.grazingDays).toBe(0);
    expect(rest.stays).toBe(0);
  });

  it("counts an open stay only up to today", () => {
    // Unchanged behaviour, restated because the clipping rule now covers it:
    // a herd three weeks into a stay must not read as zero grazing days.
    const rest = zoneRest([{ startedOn: "2026-08-01", endedOn: null }], TODAY);
    expect(rest.status).toBe("occupied");
    expect(rest.grazingDays).toBe(15);
  });

  it("starts counting a stay on the very day it begins", () => {
    // The boundary: `startedOn === today` has begun. An off-by-one here would
    // make every move invisible on the day it happened.
    const rest = zoneRest([{ startedOn: TODAY, endedOn: null }], TODAY);
    expect(rest.status).toBe("occupied");
    expect(rest.grazingDays).toBe(1);
    expect(rest.stays).toBe(1);
  });
});

describe("the paddock formula", () => {
  it("is (rest ÷ graze) + 1", () => {
    // The +1 is the paddock the herd is standing in — it cannot rest at the
    // same time.
    expect(paddocksForTarget(21, 1)).toBe(22);
    expect(paddocksForTarget(30, 3)).toBe(11);
  });

  it("rounds the division UP", () => {
    // Two-thirds of a paddock does not exist, and rounding down returns an
    // answer that quietly misses the target.
    expect(paddocksForTarget(21, 2)).toBe(12); // 10.5 → 11, +1
    expect(paddocksForTarget(20, 3)).toBe(8); // 6.67 → 7, +1
  });

  it("refuses nonsense rather than dividing by zero", () => {
    expect(paddocksForTarget(21, 0)).toBeNull();
    expect(paddocksForTarget(0, 1)).toBeNull();
    expect(paddocksForTarget(-1, 1)).toBeNull();
  });

  it("inverts to the rest a given count can deliver", () => {
    expect(restFromPaddocks(22, 1)).toBe(21);
    expect(restFromPaddocks(12, 1)).toBe(11);
    // One paddock is not a rotation: there is nowhere for the herd to go.
    expect(restFromPaddocks(1, 1)).toBeNull();
    expect(restFromPaddocks(0, 1)).toBeNull();
  });
});

describe("rotationFinding", () => {
  it("reproduces the pilot farm's shortfall from its own numbers", () => {
    // THE FINDING THE WHOLE CATEGORY WAS ARGUED FOR. 12 paddocks on the summer
    // parcel, about a day each, against a 21-day target: 11 days achievable,
    // 22 paddocks needed, 10 short. The stated difficulty hitting three weeks
    // is arithmetically unavoidable rather than a management failure — and
    // every input came from records the app already holds.
    const finding = rotationFinding({
      paddocks: 12,
      restTargetDays: 21,
      staysDays: Array.from({ length: 12 }, () => 1),
    });
    expect(finding).not.toBeNull();
    expect(finding!.grazeDaysPerZone).toBe(1);
    expect(finding!.achievableRestDays).toBe(11);
    expect(finding!.paddocksNeeded).toBe(22);
    expect(finding!.shortfallDays).toBe(10);
    expect(finding!.shortfallPaddocks).toBe(10);
  });

  it("reports no shortfall when the target is met", () => {
    const finding = rotationFinding({
      paddocks: 25,
      restTargetDays: 21,
      staysDays: [1, 1, 1, 1],
    });
    expect(finding!.achievableRestDays).toBe(24);
    expect(finding!.shortfallPaddocks).toBe(0);
    expect(finding!.shortfallDays).toBeLessThan(0);
  });

  it("says nothing at all without enough history", () => {
    // A rotation figure computed from one stay is noise wearing a decimal
    // point. Silence beats a confident wrong number.
    expect(
      rotationFinding({ paddocks: 12, restTargetDays: 21, staysDays: [1, 1] }),
    ).toBeNull();
  });

  it("says nothing without a target to compare against", () => {
    expect(
      rotationFinding({
        paddocks: 12,
        restTargetDays: null,
        staysDays: [1, 1, 1, 1],
      }),
    ).toBeNull();
  });

  it("says nothing when there is no rotation to speak of", () => {
    expect(
      rotationFinding({
        paddocks: 1,
        restTargetDays: 21,
        staysDays: [1, 1, 1, 1],
      }),
    ).toBeNull();
  });

  it("averages uneven stays to a tenth", () => {
    // Rounded because a handful of stays does not support more precision,
    // and "1.2 days a paddock" is a sentence somebody can act on.
    const finding = rotationFinding({
      paddocks: 10,
      restTargetDays: 21,
      staysDays: [1, 2, 1, 1, 2],
    });
    expect(finding!.grazeDaysPerZone).toBe(1.4);
    expect(finding!.achievableRestDays).toBe(12.6);
  });
});

describe("formatDays", () => {
  it("singularises one", () => {
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(0)).toBe("0 days");
    expect(formatDays(21)).toBe("21 days");
  });

  it("renders unknown as an em dash", () => {
    expect(formatDays(null)).toBe("—");
  });
});

describe("areaGrazed", () => {
  it("falls back to the whole zone when the stay does not say", () => {
    // Null on the record means all of it — the fixed-paddock case, and the
    // majority of records.
    expect(areaGrazed(null, 10)).toBe(10);
  });

  it("prefers the strip size when one was recorded", () => {
    expect(areaGrazed(0.4, 10)).toBe(0.4);
  });

  it("stays unknown when neither is known", () => {
    expect(areaGrazed(null, null)).toBeNull();
  });
});
