import { describe, expect, it } from "vitest";
import {
  costWithBurden,
  formatCents,
  groupByRate,
  payForWeek,
  rateOnDate,
  type PayInput,
} from "../src/modules/time/core/pay";

/**
 * Turning hours into money.
 *
 * Every case here is a rule that exists in the world, and most of them are
 * ways of getting overtime pay wrong that look right on a single-rate week.
 * `$` is written in cents throughout: `2000` is $20.00 an hour.
 */

const H = (h: number) => h * 60;

function pay(over: Partial<PayInput> = {}) {
  return payForWeek({
    worked: [],
    overtimeMinutes: 0,
    doubleTimeMinutes: 0,
    leave: [],
    ...over,
  });
}

describe("a single rate, no overtime", () => {
  it("is hours times the rate", () => {
    const r = pay({ worked: [{ minutes: H(40), rateCents: 2000 }] });
    expect(r.straightTimeCents).toBe(80_000); // $800
    expect(r.regularRateCents).toBe(2000);
    expect(r.overtimePremiumCents).toBe(0);
    expect(r.grossCents).toBe(80_000);
  });

  it("handles a part hour without losing a cent", () => {
    // 7h53m at $18.75.
    const r = pay({ worked: [{ minutes: 473, rateCents: 1875 }] });
    expect(r.straightTimeCents).toBe(Math.round((473 / 60) * 1875));
    expect(r.grossCents).toBe(r.straightTimeCents);
  });
});

describe("overtime is a HALF on top, not one and a half", () => {
  it("pays 45 hours at $20 as $800 straight plus $50 premium", () => {
    // Every hour is already paid once at $20 — including the five overtime
    // ones. The premium is the extra half on those five: 5 × $10 = $50.
    // Paying 5 × $30 on top would double-count the straight half and hand over
    // $950 for a $850 week.
    const r = pay({
      worked: [{ minutes: H(45), rateCents: 2000 }],
      overtimeMinutes: H(5),
    });
    expect(r.straightTimeCents).toBe(90_000); // 45 × $20
    expect(r.overtimePremiumCents).toBe(5_000); // 5 × $10
    expect(r.grossCents).toBe(95_000); // $950 — 40×20 + 5×30
  });

  it("agrees with the naive formula when there is ONE rate", () => {
    // The reason the wrong formula survives: on a single rate it is right.
    const r = pay({
      worked: [{ minutes: H(48), rateCents: 1500 }],
      overtimeMinutes: H(8),
    });
    const naive = 40 * 1500 + 8 * 1500 * 1.5;
    expect(r.grossCents).toBe(naive);
  });

  it("double time is a WHOLE extra, so the hour is paid twice", () => {
    const r = pay({
      worked: [{ minutes: H(13), rateCents: 2000 }],
      overtimeMinutes: H(4),
      doubleTimeMinutes: H(1),
    });
    // 13 × $20 straight, + 4 × $10, + 1 × $20.
    expect(r.straightTimeCents).toBe(26_000);
    expect(r.overtimePremiumCents).toBe(4_000);
    expect(r.doubleTimePremiumCents).toBe(2_000);
    expect(r.grossCents).toBe(32_000);
  });
});

describe("two rates in one week: the WEIGHTED AVERAGE", () => {
  it("is neither rate", () => {
    // 20h at $20 and 20h at $30 is $1,000 over 40 hours: $25 an hour.
    const r = pay({
      worked: [
        { minutes: H(20), rateCents: 2000 },
        { minutes: H(20), rateCents: 3000 },
      ],
    });
    expect(r.straightTimeCents).toBe(100_000);
    expect(r.regularRateCents).toBe(2500);
  });

  it("prices overtime on the average, not on the rate that earned it", () => {
    // 25h at $20 + 20h at $30 = 45 hours, $1,100 straight, regular rate
    // $24.444…, so the five overtime hours carry an extra $12.22 each.
    const r = pay({
      worked: [
        { minutes: H(25), rateCents: 2000 },
        { minutes: H(20), rateCents: 3000 },
      ],
      overtimeMinutes: H(5),
    });
    expect(r.straightTimeCents).toBe(110_000);
    expect(r.regularRateCents).toBe(2444); // rounded for display only
    // The premium uses the UNROUNDED average: 0.5 × (110000/45) × 5.
    expect(r.overtimePremiumCents).toBe(Math.round(0.5 * (110_000 / 45) * 5));
    // And it is NOT what either rate alone would have given.
    expect(r.overtimePremiumCents).not.toBe(5 * 1000);
    expect(r.overtimePremiumCents).not.toBe(5 * 1500);
  });

  it("a mid-week raise is two rates, not one", () => {
    // The ordinary way a second rate appears: somebody's pay goes up on
    // Wednesday. Nothing special has to be modelled for it.
    const r = pay({
      worked: [
        { minutes: H(16), rateCents: 1800 },
        { minutes: H(24), rateCents: 2000 },
      ],
    });
    expect(r.straightTimeCents).toBe(16 * 1800 + 24 * 2000);
    expect(r.regularRateCents).toBe(Math.round((16 * 1800 + 24 * 2000) / 40));
  });
});

describe("paid leave", () => {
  it("is paid, and stays out of the regular rate entirely", () => {
    // 32 worked at $20 and 8 hours of holiday at $20. The regular rate is $20
    // either way here — the point is that the DIVISOR is 32, not 40.
    const r = pay({
      worked: [{ minutes: H(32), rateCents: 2000 }],
      leave: [{ minutes: H(8), rateCents: 2000 }],
    });
    expect(r.regularRateCents).toBe(2000);
    expect(r.leaveCents).toBe(16_000);
    expect(r.grossCents).toBe(64_000 + 16_000);
  });

  it("cannot dilute the average even when it is paid at a different rate", () => {
    // Holiday at a flat rate lower than the worked rate. If leave reached the
    // regular rate it would drag it down and underpay the overtime.
    const r = pay({
      worked: [{ minutes: H(40), rateCents: 3000 }],
      leave: [{ minutes: H(8), rateCents: 1000 }],
      overtimeMinutes: 0,
    });
    expect(r.regularRateCents).toBe(3000);
  });

  it("a week of nothing but leave has no regular rate and still pays", () => {
    const r = pay({ leave: [{ minutes: H(8), rateCents: 2000 }] });
    expect(r.regularRateCents).toBe(0);
    expect(r.straightTimeCents).toBe(0);
    expect(r.grossCents).toBe(16_000);
  });
});

describe("invariants", () => {
  it("the parts always add up to the gross", () => {
    // The property a reader checks by adding a payslip up, and the one most
    // easily broken by a later edit.
    const shapes: PayInput[] = [
      { worked: [], overtimeMinutes: 0, doubleTimeMinutes: 0, leave: [] },
      {
        worked: [{ minutes: 1, rateCents: 1 }],
        overtimeMinutes: 0,
        doubleTimeMinutes: 0,
        leave: [],
      },
      {
        worked: [
          { minutes: 437, rateCents: 1733 },
          { minutes: 921, rateCents: 2266 },
        ],
        overtimeMinutes: 313,
        doubleTimeMinutes: 77,
        leave: [{ minutes: 199, rateCents: 1450 }],
      },
      {
        worked: [{ minutes: H(70), rateCents: 999 }],
        overtimeMinutes: H(30),
        doubleTimeMinutes: H(10),
        leave: [],
      },
    ];
    for (const shape of shapes) {
      const r = payForWeek(shape);
      expect(
        r.straightTimeCents +
          r.overtimePremiumCents +
          r.doubleTimePremiumCents +
          r.leaveCents,
      ).toBe(r.grossCents);
      expect(r.grossCents).toBeGreaterThanOrEqual(0);
    }
  });

  it("nothing worked and nothing owed is zero, not NaN", () => {
    const r = pay();
    expect(r.regularRateCents).toBe(0);
    expect(r.grossCents).toBe(0);
    expect(Number.isNaN(r.grossCents)).toBe(false);
  });

  it("says so when somebody has no rate rather than paying them nothing", () => {
    const r = pay({ worked: [{ minutes: H(8), rateCents: 0 }] });
    expect(r.incomplete).toBe(true);
    expect(r.grossCents).toBe(0);
    const known = pay({ worked: [{ minutes: H(8), rateCents: 2000 }] });
    expect(known.incomplete).toBe(false);
  });
});

describe("burden is a cost, never pay", () => {
  it("adds the employer's on-cost to the wage", () => {
    expect(costWithBurden(2000, 0)).toBe(2000);
    expect(costWithBurden(2000, 18)).toBe(2360);
    expect(costWithBurden(1733, 22)).toBe(Math.round(1733 * 1.22));
  });

  it("never reaches the gross", () => {
    // There is no burden argument to `payForWeek`, and that is the guarantee:
    // an employer's tax cannot be handed to an employee by mistake.
    const r = pay({ worked: [{ minutes: H(40), rateCents: 2000 }] });
    expect(r.grossCents).toBe(80_000);
  });
});

describe("formatCents", () => {
  it("is where money becomes a string, once", () => {
    expect(formatCents(2450)).toBe("$24.50");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(100_000)).toBe("$1,000.00");
  });
});

describe("rateOnDate", () => {
  const history = [
    { effectiveOn: "2026-01-01", payRateCents: 1800 },
    { effectiveOn: "2026-06-01", payRateCents: 2000 },
    { effectiveOn: "2026-09-09", payRateCents: 2200 },
  ];

  it("takes the newest rate that had started", () => {
    expect(rateOnDate(history, "2026-03-04")).toBe(1800);
    expect(rateOnDate(history, "2026-06-01")).toBe(2000); // inclusive
    expect(rateOnDate(history, "2026-09-08")).toBe(2000);
    expect(rateOnDate(history, "2026-09-09")).toBe(2200);
    expect(rateOnDate(history, "2030-01-01")).toBe(2200);
  });

  it("is zero before the history begins, not the earliest rate", () => {
    // Projecting a wage backwards over work done before it was agreed would
    // invent a number. `payForWeek` reports the gap instead.
    expect(rateOnDate(history, "2025-12-31")).toBe(0);
    expect(rateOnDate([], "2026-09-09")).toBe(0);
  });

  it("does not care what order the history arrives in", () => {
    const shuffled = [history[2], history[0], history[1]];
    expect(rateOnDate(shuffled, "2026-09-08")).toBe(2000);
  });
});

describe("groupByRate", () => {
  const history = [
    { effectiveOn: "2026-09-06", payRateCents: 2000 },
    { effectiveOn: "2026-09-09", payRateCents: 3000 },
  ];

  it("collapses days at one rate and splits a mid-week raise", () => {
    const grouped = groupByRate(
      [
        { workDate: "2026-09-07", minutes: H(8) },
        { workDate: "2026-09-08", minutes: H(8) },
        { workDate: "2026-09-09", minutes: H(8) },
        { workDate: "2026-09-10", minutes: H(8) },
      ],
      history,
    );
    expect(grouped).toHaveLength(2);
    expect(grouped.find((g) => g.rateCents === 2000)?.minutes).toBe(H(16));
    expect(grouped.find((g) => g.rateCents === 3000)?.minutes).toBe(H(16));
  });

  it("feeds the weighted average straight into payForWeek", () => {
    const grouped = groupByRate(
      [
        { workDate: "2026-09-07", minutes: H(20) },
        { workDate: "2026-09-10", minutes: H(20) },
      ],
      history,
    );
    expect(payForWeek({
      worked: grouped,
      overtimeMinutes: 0,
      doubleTimeMinutes: 0,
      leave: [],
    }).regularRateCents).toBe(2500);
  });
});
