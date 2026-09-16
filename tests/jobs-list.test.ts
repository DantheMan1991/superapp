import { describe, expect, it } from "vitest";
import {
  BOARD_GROUPS,
  LIST_FILTERS,
  boardGroupFor,
  isListView,
  barPercent,
  filterCounts,
  filterKeyFor,
  isListFilterKey,
  matchesFilter,
  measureProject,
  summariseList,
  type ProjectMeasureInput,
  type ProjectValuation,
} from "@/packs/jobs/list-math";
import { WIP_PPM } from "@/packs/jobs/wip-math";

/**
 * The module home's arithmetic.
 *
 * Pure, so every rule the list claims can be pinned without a database. The
 * rules worth pinning are the ones about what the list REFUSES to say: a zero
 * it cannot defend, a percent it has nothing to measure, and a netted figure.
 */

function input(over: Partial<ProjectMeasureInput> = {}): ProjectMeasureInput {
  return {
    status: "active",
    contractCents: 100_000_00,
    signedCount: 1,
    proposedCents: 0,
    budgetCents: 80_000_00,
    costToDateCents: 40_000_00,
    billedCents: 45_000_00,
    terms: null,
    ...over,
  };
}

function measured(v: ProjectValuation) {
  if (v.kind !== "measured") throw new Error(`expected measured, got ${v.kind}`);
  return v.figures;
}

describe("measureProject", () => {
  it("measures a plain job cost-to-cost", () => {
    const f = measured(measureProject(input()));
    // 40k of an 80k budget is half done; half of a 100k contract is 50k earned.
    expect(f.percentCompletePpm).toBe(WIP_PPM / 2);
    expect(f.earnedCents).toBe(50_000_00);
    expect(f.underBilledCents).toBe(5_000_00);
    expect(f.overBilledCents).toBe(0);
  });

  it("calls an unsigned job unsigned, and carries what is out for signature", () => {
    const v = measureProject(input({ signedCount: 0, contractCents: 0, proposedCents: 62_500_00 }));
    expect(v).toEqual({ kind: "unsigned", proposedCents: 62_500_00 });
  });

  it("stays unsigned even when the job has cost money", () => {
    // A spec house accumulating cost against no contract is a real state, not
    // an error, and it must not be measured against a contract of zero.
    const v = measureProject(
      input({ signedCount: 0, contractCents: 0, costToDateCents: 120_000_00 }),
    );
    expect(v.kind).toBe("unsigned");
  });

  it("refuses to measure a time-and-materials job on the list", () => {
    // Earned needs each approved hour at its bill rate (ADR 0062) — a query
    // per job. The list says so rather than approximating the money.
    const v = measureProject(
      input({
        terms: { method: "time_and_materials", feePpm: null, feeCents: null, gmaxCents: null },
      }),
    );
    expect(v).toEqual({ kind: "by_hours" });
  });

  it("measures a cost-plus job on cost plus its fee, not against a budget", () => {
    const f = measured(
      measureProject(
        input({
          budgetCents: 0, // no estimate at all, which cost-plus does not need
          costToDateCents: 40_000_00,
          terms: { method: "cost_plus", feePpm: 100_000, feeCents: null, gmaxCents: null },
        }),
      ),
    );
    // 40k of cost plus a 10% fee on it.
    expect(f.earnedCents).toBe(44_000_00);
  });

  it("returns a null percent rather than 0% when there is no estimate", () => {
    const f = measured(measureProject(input({ budgetCents: 0 })));
    expect(f.percentCompletePpm).toBeNull();
  });

  it("treats a complete job as fully complete whatever its cost says", () => {
    const f = measured(
      measureProject(input({ status: "complete", costToDateCents: 10_000_00 })),
    );
    expect(f.percentCompletePpm).toBe(WIP_PPM);
    expect(f.earnedCents).toBe(100_000_00);
  });
});

describe("summariseList", () => {
  const rows = [
    {
      status: "active",
      signedCount: 1,
      contractCents: 100_000_00,
      valuation: measureProject(input()),
    },
    {
      status: "active",
      signedCount: 1,
      contractCents: 60_000_00,
      valuation: measureProject(
        input({ contractCents: 60_000_00, budgetCents: 50_000_00, costToDateCents: 10_000_00, billedCents: 30_000_00 }),
      ),
    },
    {
      status: "cancelled",
      signedCount: 1,
      contractCents: 999_000_00,
      valuation: measureProject(input({ status: "cancelled", contractCents: 999_000_00 })),
    },
  ];

  it("never nets under-billed against over-billed", () => {
    const s = summariseList(rows);
    // Row one is under-billed 5k; row two billed 30k against 12k earned, so
    // over-billed 18k. Both survive as their own figure.
    expect(s.underBilledCents).toBe(5_000_00);
    expect(s.overBilledCents).toBe(18_000_00);
    expect(s.overBilledJobs).toBe(1);
  });

  it("leaves a cancelled job out of every figure", () => {
    const s = summariseList(rows);
    expect(s.underContractCents).toBe(160_000_00);
    expect(s.countedJobs).toBe(2);
    expect(s.activeJobs).toBe(2);
  });

  it("counts nothing signed toward nothing", () => {
    const s = summariseList([
      {
        status: "planned",
        signedCount: 0,
        contractCents: 0,
        valuation: measureProject(input({ signedCount: 0, contractCents: 0, proposedCents: 5_000_00 })),
      },
    ]);
    expect(s.underContractCents).toBe(0);
    expect(s.countedJobs).toBe(0);
  });
});

describe("filters", () => {
  it("counts every status and keeps All as the total", () => {
    const counts = filterCounts([
      { status: "active" },
      { status: "active" },
      { status: "complete" },
      { status: "cancelled" },
    ]);
    expect(counts.all).toBe(4);
    expect(counts.active).toBe(2);
    expect(counts.complete).toBe(1);
    expect(counts.cancelled).toBe(1);
    expect(counts.planned).toBe(0);
  });

  it("puts an unrecognised status under All only", () => {
    expect(filterKeyFor("something_else")).toBeNull();
    expect(matchesFilter("something_else", "all")).toBe(true);
    expect(matchesFilter("something_else", "active")).toBe(false);
  });

  it("never treats `all` as a status", () => {
    // `all` is in LIST_FILTERS as a pill, but no project is ever status "all".
    expect(LIST_FILTERS).toContain("all");
    expect(filterKeyFor("all")).toBeNull();
    expect(isListFilterKey("all")).toBe(true);
  });
});

describe("barPercent", () => {
  it("clamps to the track and treats null as empty", () => {
    expect(barPercent(null)).toBe(0);
    expect(barPercent(0)).toBe(0);
    expect(barPercent(WIP_PPM / 2)).toBe(50);
    expect(barPercent(WIP_PPM)).toBe(100);
    // percentCompletePpm caps already; the bar refuses to overrun regardless.
    expect(barPercent(WIP_PPM * 3)).toBe(100);
  });
});

describe("the board's three columns", () => {
  it("collapses five statuses into three questions", () => {
    expect(boardGroupFor("active")).toBe("on_site");
    expect(boardGroupFor("planned")).toBe("coming_up");
    expect(boardGroupFor("on_hold")).toBe("closed");
    expect(boardGroupFor("complete")).toBe("closed");
  });

  it("keeps a cancelled job on the board rather than dropping it", () => {
    // A job that disappears from a view is the one nobody notices — the same
    // reason the table keeps cancelled under All.
    expect(boardGroupFor("cancelled")).toBe("closed");
  });

  it("puts an unrecognised status somewhere rather than nowhere", () => {
    const group = boardGroupFor("something_else");
    expect(BOARD_GROUPS).toContain(group);
  });

  it("groups every status into a real column", () => {
    for (const status of ["planned", "active", "on_hold", "complete", "cancelled"]) {
      expect(BOARD_GROUPS).toContain(boardGroupFor(status));
    }
  });
});

describe("the view parameter", () => {
  it("accepts only the two views", () => {
    expect(isListView("table")).toBe(true);
    expect(isListView("board")).toBe(true);
    expect(isListView("cards")).toBe(false);
    expect(isListView(undefined)).toBe(false);
  });
});
