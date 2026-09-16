import { describe, expect, it } from "vitest";
import { type DecisionInput, decisionsFor } from "@/packs/jobs/decisions";
import { wipFigures } from "@/packs/jobs/wip-math";

/**
 * What a job needs somebody to do.
 *
 * The rules worth pinning are about restraint: which facts earn a row at all,
 * and that a row's own sentence explains its own headline.
 */

function input(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    projectId: "p1",
    symbol: "$",
    figures: null,
    costRows: [],
    selections: { pending: 0, overdue: 0 },
    proposedChanges: { count: 0, cents: 0 },
    paidWaiverGaps: [],
    lapsedCertificates: [],
    ...over,
  };
}

const code = (o: Partial<DecisionInput["costRows"][number]> = {}) => ({
  costCodeId: "c1",
  code: "06 10 00",
  name: "Rough carpentry",
  budgetCents: 40_000_00,
  committedCents: 34_000_00,
  actualCents: 63_650_00,
  varianceCents: -23_650_00,
  hasBudget: true,
  ...o,
});

describe("a quiet job has nothing to decide", () => {
  it("returns no rows at all", () => {
    expect(decisionsFor(input())).toEqual([]);
  });
});

describe("billing", () => {
  const measured = (billed: number) =>
    wipFigures({
      contractCents: 100_000_00,
      estimatedCostCents: 80_000_00,
      costToDateCents: 40_000_00,
      billedCents: billed,
    });

  it("raises over-billing, because the fix is a judgement", () => {
    const rows = decisionsFor(input({ figures: measured(70_000_00) }));
    expect(rows.map((r) => r.kind)).toEqual(["over_billed"]);
    expect(rows[0].title).toContain("$20,000.00");
    expect(rows[0].severity).toBe("bad");
  });

  it("does NOT raise under-billing — the answer is always just to invoice it", () => {
    // It is a real figure and it is on the strip above; it is not a decision.
    const rows = decisionsFor(input({ figures: measured(10_000_00) }));
    expect(rows).toEqual([]);
  });
});

describe("a cost code over its budget", () => {
  it("names the figure that caused the overage, not the other one", () => {
    // $34,000 ordered against $40,000 budgeted does not explain $23,650 over —
    // the spend does. Quoting the smaller figure prints a sentence whose own
    // numbers cannot reach its headline.
    const rows = decisionsFor(input({ costRows: [code()] }));
    expect(rows[0].title).toBe("Rough carpentry is $23,650.00 over its budget");
    expect(rows[0].why).toContain("$63,650.00 spent against $40,000.00 budgeted");
    expect(rows[0].why).not.toContain("ordered");
  });

  it("quotes ordered when ordered is what went over", () => {
    const rows = decisionsFor({
      ...input(),
      costRows: [code({ committedCents: 86_400_00, actualCents: 10_000_00, varianceCents: -46_400_00 })],
    });
    expect(rows[0].why).toContain("$86,400.00 ordered against");
  });

  it("raises the WORST code once, and counts the rest", () => {
    const rows = decisionsFor(
      input({
        costRows: [
          code({ costCodeId: "a", name: "Framing", varianceCents: -2_000_00 }),
          code({ costCodeId: "b", name: "Concrete", varianceCents: -9_000_00 }),
          code({ costCodeId: "c", name: "Roofing", varianceCents: -500_00 }),
        ],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toContain("Concrete");
    expect(rows[0].why).toContain("2 more codes over");
  });

  it("ignores a code with no budget, however much is on it", () => {
    // A code with no budget cannot be over one — the same rule the Job cost
    // tab's Over-budget pill applies.
    const rows = decisionsFor(
      input({
        costRows: [code({ hasBudget: false, budgetCents: 0, varianceCents: -99_000_00 })],
      }),
    );
    expect(rows).toEqual([]);
  });
});

describe("selections", () => {
  it("says overdue when any are, and does not also say pending", () => {
    const rows = decisionsFor(input({ selections: { pending: 3, overdue: 1 } }));
    expect(rows.map((r) => r.kind)).toEqual(["selection_overdue"]);
    expect(rows[0].severity).toBe("bad");
  });

  it("falls back to pending when nothing is late yet", () => {
    const rows = decisionsFor(input({ selections: { pending: 2, overdue: 0 } }));
    expect(rows.map((r) => r.kind)).toEqual(["selection_pending"]);
    expect(rows[0].severity).toBe("warn");
  });
});

describe("ordering", () => {
  it("puts what has already gone wrong above what might", () => {
    const rows = decisionsFor(
      input({
        selections: { pending: 2, overdue: 0 }, // warn
        proposedChanges: { count: 1, cents: 12_800_00 }, // warn
        costRows: [code()], // bad
        paidWaiverGaps: [{ commitmentNumber: "SC-1", partyName: "Braun Framing" }], // bad
      }),
    );
    const severities = rows.map((r) => r.severity);
    expect(severities).toEqual([...severities].sort((a, b) => (a === b ? 0 : a === "bad" ? -1 : 1)));
    expect(severities.slice(0, 2)).toEqual(["bad", "bad"]);
  });

  it("gives every row a label and a place to go", () => {
    const rows = decisionsFor(
      input({
        selections: { pending: 1, overdue: 0 },
        proposedChanges: { count: 1, cents: 5_000_00 },
        costRows: [code()],
        paidWaiverGaps: [{ commitmentNumber: "SC-1", partyName: "Braun" }],
        lapsedCertificates: [{ partyName: "Braun", expiresOn: "2026-09-04" }],
      }),
    );
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(row.action.label).toBeTruthy();
      expect(row.action.href.startsWith("/dashboard/")).toBe(true);
      expect(row.why).toBeTruthy();
    }
  });
});
