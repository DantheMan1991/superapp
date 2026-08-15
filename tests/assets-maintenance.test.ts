import { describe, expect, it } from "vitest";
import {
  computeDue,
  daysBetween,
  dueSummary,
  isMaintenanceKind,
  maintenanceWorkTitle,
} from "@/packs/assets/core/maintenance";

/**
 * When a service is due. Pure — no database.
 *
 * The property most of this file defends is that NEVER-DONE IS NOT OVERDUE.
 * Adding a schedule to a tractor owned for years must not declare six services
 * overdue and raise six work items; it must say it has no baseline and wait for
 * somebody to record one.
 */
const CAL = { kind: "calendar" as const, intervalMonths: 6 };
const METER = { kind: "meter" as const, intervalMeter: 100 };

describe("computeDue — calendar", () => {
  it("counts from the last service", () => {
    const r = computeDue({
      spec: CAL,
      lastDoneOn: "2026-01-15",
      today: "2026-05-01",
    });
    expect(r.dueOn).toBe("2026-07-15");
    expect(r.status).toBe("ok");
  });

  it("is due once the date passes", () => {
    const r = computeDue({
      spec: CAL,
      lastDoneOn: "2026-01-15",
      today: "2026-08-01",
    });
    expect(r.status).toBe("due");
    expect(r.remaining).toBeLessThan(0);
  });

  it("is due exactly on the day", () => {
    const r = computeDue({
      spec: CAL,
      lastDoneOn: "2026-01-15",
      today: "2026-07-15",
    });
    expect(r.status).toBe("due");
    expect(r.remaining).toBe(0);
  });

  it("falls back to the asset's in-service date when never done", () => {
    // A calendar interval CAN honestly be counted from the day the thing
    // entered service, so this one does have a baseline.
    const r = computeDue({
      spec: CAL,
      lastDoneOn: null,
      anchorOn: "2026-01-01",
      today: "2026-03-01",
    });
    expect(r.status).toBe("ok");
    expect(r.dueOn).toBe("2026-07-01");
  });

  it("has no baseline when never done and the asset has no dates", () => {
    const r = computeDue({ spec: CAL, lastDoneOn: null, today: "2026-08-01" });
    expect(r.status).toBe("no_baseline");
  });

  it("does not drift on a month-end service date", () => {
    // `new Date("2026-08-31")` plus a month is the classic "October 1st" bug.
    // Clamping keeps a service done on the 31st recurring on the 30th.
    const r = computeDue({
      spec: { kind: "calendar", intervalMonths: 1 },
      lastDoneOn: "2026-08-31",
      today: "2026-09-01",
    });
    expect(r.dueOn).toBe("2026-09-30");
  });

  it("rolls the year", () => {
    const r = computeDue({
      spec: { kind: "calendar", intervalMonths: 12 },
      lastDoneOn: "2026-11-05",
      today: "2026-12-01",
    });
    expect(r.dueOn).toBe("2027-11-05");
  });

  it("has no baseline for a non-positive interval rather than dividing time by zero", () => {
    expect(
      computeDue({
        spec: { kind: "calendar", intervalMonths: 0 },
        lastDoneOn: "2026-01-01",
        today: "2026-08-01",
      }).status,
    ).toBe("no_baseline");
  });
});

describe("computeDue — meter", () => {
  it("counts from the last service reading", () => {
    const r = computeDue({
      spec: METER,
      lastDoneMeter: 400,
      currentMeter: 450,
      today: "2026-08-01",
    });
    expect(r.dueAtMeter).toBe(500);
    expect(r.remaining).toBe(50);
    expect(r.status).toBe("ok");
  });

  it("is due once the reading passes", () => {
    const r = computeDue({
      spec: METER,
      lastDoneMeter: 400,
      currentMeter: 505,
      today: "2026-08-01",
    });
    expect(r.status).toBe("due");
    expect(r.remaining).toBe(-5);
  });

  it("counts from zero when never serviced but a reading exists", () => {
    const r = computeDue({ spec: METER, currentMeter: 120, today: "2026-08-01" });
    expect(r.dueAtMeter).toBe(100);
    expect(r.status).toBe("due");
  });

  it("has NO baseline without a reading — unlike calendar", () => {
    // "How many hours had it done when we bought it" is not something an asset
    // knows, so there is no in-service equivalent to fall back on.
    const r = computeDue({ spec: METER, currentMeter: null, today: "2026-08-01" });
    expect(r.status).toBe("no_baseline");
  });

  it("never uses a date for a meter schedule", () => {
    const r = computeDue({ spec: METER, currentMeter: 900, today: "2026-08-01" });
    // A meter service falls due at a reading, not on a day. Inventing a date
    // would put a fictional deadline on somebody's work list.
    expect(r.dueOn).toBeUndefined();
  });
});

describe("daysBetween", () => {
  it("counts forward and backward", () => {
    expect(daysBetween("2026-08-01", "2026-08-15")).toBe(14);
    expect(daysBetween("2026-08-15", "2026-08-01")).toBe(-14);
  });

  it("crosses a month and a leap day without drifting", () => {
    expect(daysBetween("2026-01-31", "2026-03-01")).toBe(29);
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
  });
});

describe("dueSummary", () => {
  it("speaks days for calendar and units for meter", () => {
    expect(
      dueSummary({ status: "ok", dueOn: "2026-09-01", remaining: 10 }),
    ).toBe("Due in 10 days");
    expect(
      dueSummary({ status: "due", dueAtMeter: 500, remaining: -20 }, "hours"),
    ).toBe("Overdue by 20 hours");
  });

  it("says so plainly when there is no baseline", () => {
    expect(dueSummary({ status: "no_baseline" })).toBe("No baseline yet");
  });
});

describe("isMaintenanceKind / maintenanceWorkTitle", () => {
  it("accepts what the CHECK accepts", () => {
    expect(isMaintenanceKind("calendar")).toBe(true);
    expect(isMaintenanceKind("meter")).toBe(true);
    expect(isMaintenanceKind("annual")).toBe(false);
  });

  it("names the work so it reads on a list beside other people's work", () => {
    expect(maintenanceWorkTitle("Tractor", "Oil change")).toBe(
      "Oil change — Tractor",
    );
  });
});
