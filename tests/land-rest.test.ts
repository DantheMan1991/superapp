import { describe, expect, it } from "vitest";
import {
  areaGrazed,
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

  it("never reports negative rest for a stay ending in the future", () => {
    // A booked move entered ahead of time. Clamped rather than shown as -5.
    const rest = zoneRest(
      [{ startedOn: "2026-08-01", endedOn: "2026-08-20" }],
      TODAY,
    );
    expect(rest.restDays).toBe(0);
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
