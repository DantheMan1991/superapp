import { describe, expect, it } from "vitest";
import {
  allotmentForMonth,
  computeRetainerUsage,
  currentMonth,
  elapsedMinutes,
  formatMinutesAsHours,
  monthOf,
  todayInRetainerTz,
  usedByMonth,
} from "@/lib/retainer-core";

describe("retainer time helpers", () => {
  it("monthOf slices a date string", () => {
    expect(monthOf("2026-07-24")).toBe("2026-07");
  });

  it("month boundaries follow America/New_York, not UTC", () => {
    // 02:00 UTC on Mar 1 is still Feb 28 in New York (UTC-5).
    const utcEdge = new Date("2026-03-01T02:00:00Z");
    expect(todayInRetainerTz(utcEdge)).toBe("2026-02-28");
    expect(currentMonth(utcEdge)).toBe("2026-02");
    // By 06:00 UTC it's 01:00 in New York — March has arrived.
    expect(currentMonth(new Date("2026-03-01T06:00:00Z"))).toBe("2026-03");
  });

  it("elapsedMinutes rounds up with a floor of 1", () => {
    const t0 = new Date("2026-07-24T12:00:00Z");
    expect(elapsedMinutes(t0, new Date("2026-07-24T12:00:00Z"))).toBe(1);
    expect(elapsedMinutes(t0, new Date("2026-07-24T12:00:30Z"))).toBe(1);
    expect(elapsedMinutes(t0, new Date("2026-07-24T12:01:01Z"))).toBe(2);
    expect(elapsedMinutes(t0, new Date("2026-07-24T13:30:00Z"))).toBe(90);
  });

  it("formatMinutesAsHours renders tenths", () => {
    expect(formatMinutesAsHours(90)).toBe("1.5 h");
    expect(formatMinutesAsHours(1)).toBe("0.0 h");
    expect(formatMinutesAsHours(600)).toBe("10.0 h");
  });

  it("usedByMonth groups and sorts", () => {
    expect(
      usedByMonth([
        { workDate: "2026-07-02", minutes: 30 },
        { workDate: "2026-06-30", minutes: 45 },
        { workDate: "2026-07-15", minutes: 60 },
      ]),
    ).toEqual([
      { month: "2026-06", minutes: 45 },
      { month: "2026-07", minutes: 90 },
    ]);
  });
});

describe("allotmentForMonth", () => {
  const history = [
    { effectiveMonth: "2026-03", includedMinutes: 600 },
    { effectiveMonth: "2026-06", includedMinutes: 1200 },
  ];

  it("returns 0 with no history", () => {
    expect(allotmentForMonth([], "2026-07")).toBe(0);
  });

  it("returns 0 before the first row", () => {
    expect(allotmentForMonth(history, "2026-02")).toBe(0);
  });

  it("matches the exact effective month", () => {
    expect(allotmentForMonth(history, "2026-03")).toBe(600);
    expect(allotmentForMonth(history, "2026-06")).toBe(1200);
  });

  it("latest row ≤ month wins", () => {
    expect(allotmentForMonth(history, "2026-05")).toBe(600);
    expect(allotmentForMonth(history, "2027-01")).toBe(1200);
  });
});

describe("computeRetainerUsage", () => {
  const tenHours = [{ effectiveMonth: "2026-01", includedMinutes: 600 }];

  it("under allotment: no overage, no rollover into next month", () => {
    const june = computeRetainerUsage({
      monthlyUsed: [{ month: "2026-06", minutes: 300 }],
      purchasedMinutesTotal: 0,
      allotments: tenHours,
      month: "2026-06",
    });
    expect(june.includedRemainingMinutes).toBe(300);
    expect(june.overageMinutesAllTime).toBe(0);
    expect(june.isOver).toBe(false);

    // July starts from the full allotment — June's surplus is gone.
    const july = computeRetainerUsage({
      monthlyUsed: [{ month: "2026-06", minutes: 300 }],
      purchasedMinutesTotal: 0,
      allotments: tenHours,
      month: "2026-07",
    });
    expect(july.usedMinutes).toBe(0);
    expect(july.includedRemainingMinutes).toBe(600);
  });

  it("overage consumes purchased blocks across months", () => {
    const usage = computeRetainerUsage({
      monthlyUsed: [
        { month: "2026-05", minutes: 720 }, // 2h over
        { month: "2026-06", minutes: 660 }, // 1h over
      ],
      purchasedMinutesTotal: 300, // one 5h block
      allotments: tenHours,
      month: "2026-06",
    });
    expect(usage.overageMinutesAllTime).toBe(180);
    expect(usage.purchasedMinutesRemaining).toBe(120);
    expect(usage.unpaidOverageMinutes).toBe(0);
    expect(usage.isOver).toBe(false);
  });

  it("purchases exhausted → unpaid overage and isOver", () => {
    const usage = computeRetainerUsage({
      monthlyUsed: [{ month: "2026-06", minutes: 1000 }], // 400 over
      purchasedMinutesTotal: 300,
      allotments: tenHours,
      month: "2026-06",
    });
    expect(usage.purchasedMinutesRemaining).toBe(0);
    expect(usage.unpaidOverageMinutes).toBe(100);
    expect(usage.isOver).toBe(true);
  });

  it("raising the allotment today does not rewrite last month's overage", () => {
    const before = computeRetainerUsage({
      monthlyUsed: [{ month: "2026-06", minutes: 720 }],
      purchasedMinutesTotal: 0,
      allotments: tenHours,
      month: "2026-07",
    });
    expect(before.overageMinutesAllTime).toBe(120);

    // Allotment doubled effective July: June's overage is frozen.
    const after = computeRetainerUsage({
      monthlyUsed: [{ month: "2026-06", minutes: 720 }],
      purchasedMinutesTotal: 0,
      allotments: [
        ...tenHours,
        { effectiveMonth: "2026-07", includedMinutes: 1200 },
      ],
      month: "2026-07",
    });
    expect(after.overageMinutesAllTime).toBe(120);
    expect(after.includedMinutes).toBe(1200);
  });

  it("lowering the allotment mid-timeline only affects later months", () => {
    const usage = computeRetainerUsage({
      monthlyUsed: [
        { month: "2026-05", minutes: 600 }, // exactly at 10h — fine
        { month: "2026-06", minutes: 600 }, // 10h against a 5h month — 5h over
      ],
      purchasedMinutesTotal: 0,
      allotments: [
        ...tenHours,
        { effectiveMonth: "2026-06", includedMinutes: 300 },
      ],
      month: "2026-06",
    });
    expect(usage.overageMinutesAllTime).toBe(300);
  });

  it("future-dated months are excluded from the balance", () => {
    const usage = computeRetainerUsage({
      monthlyUsed: [
        { month: "2026-06", minutes: 300 },
        { month: "2026-09", minutes: 900 }, // backdated-forward mistake
      ],
      purchasedMinutesTotal: 0,
      allotments: tenHours,
      month: "2026-06",
    });
    expect(usage.overageMinutesAllTime).toBe(0);
  });

  it("months before the first allotment row count fully as overage", () => {
    const usage = computeRetainerUsage({
      monthlyUsed: [{ month: "2025-12", minutes: 60 }],
      purchasedMinutesTotal: 0,
      allotments: tenHours, // starts 2026-01
      month: "2026-01",
    });
    expect(usage.overageMinutesAllTime).toBe(60);
  });

  it("isNearLimit triggers at exactly 80%", () => {
    const at79 = computeRetainerUsage({
      monthlyUsed: [{ month: "2026-06", minutes: 479 }],
      purchasedMinutesTotal: 0,
      allotments: tenHours,
      month: "2026-06",
    });
    expect(at79.isNearLimit).toBe(false);
    const at80 = computeRetainerUsage({
      monthlyUsed: [{ month: "2026-06", minutes: 480 }],
      purchasedMinutesTotal: 0,
      allotments: tenHours,
      month: "2026-06",
    });
    expect(at80.isNearLimit).toBe(true);
  });

  it("zero allotment never flags near-limit", () => {
    const usage = computeRetainerUsage({
      monthlyUsed: [],
      purchasedMinutesTotal: 0,
      allotments: [],
      month: "2026-06",
    });
    expect(usage.isNearLimit).toBe(false);
    expect(usage.isOver).toBe(false);
  });
});
