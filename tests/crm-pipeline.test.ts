import { describe, expect, it } from "vitest";
import type { CrmDealOutcome, CrmPipelineStage } from "../src/db/schema";
import {
  closedAtFor,
  DEFAULT_STAGES,
  isOpen,
  openingStage,
  summarizeBoard,
  weightedCents,
} from "../src/modules/crm/core/pipeline";

/**
 * The pipeline's arithmetic and transition rules, tested without a database.
 *
 * Two of these are about money and one is about time, which is why they are
 * worth having: a rounding slip understates a forecast quietly, and a
 * `closed_at` that re-stamps rewrites history nobody thought to check.
 */

let seq = 0;
function stage(
  over: Partial<CrmPipelineStage> = {},
): CrmPipelineStage {
  seq += 1;
  return {
    id: `stage-${seq}`,
    tenantId: "t1",
    pipelineId: "p1",
    name: `Stage ${seq}`,
    sortOrder: seq,
    probability: 50,
    outcome: "open" as CrmDealOutcome,
    archivedAt: null,
    version: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  } as CrmPipelineStage;
}

describe("DEFAULT_STAGES", () => {
  it("ships exactly one won and one lost stage", () => {
    expect(DEFAULT_STAGES.filter((s) => s.outcome === "won")).toHaveLength(1);
    expect(DEFAULT_STAGES.filter((s) => s.outcome === "lost")).toHaveLength(1);
    expect(DEFAULT_STAGES.filter((s) => s.outcome === "open").length).toBeGreaterThan(0);
  });

  it("uses no industry vocabulary", () => {
    // The neutrality test from docs/extension-model.md §3, as an assertion.
    // A word here reaches every tenant in the product, so this list is the one
    // place a trade noun would do the most damage.
    const banned = [
      "job",
      "estimate",
      "quote",
      "survey",
      "treatment",
      "patient",
      "install",
      "site",
      "trade",
      "permit",
    ];
    for (const s of DEFAULT_STAGES) {
      for (const word of banned) {
        expect(s.name.toLowerCase()).not.toContain(word);
      }
    }
  });
});

describe("closedAtFor", () => {
  const now = new Date("2026-08-04T10:00:00Z");
  const earlier = new Date("2026-06-01T09:00:00Z");

  it("stamps the time when a deal first closes", () => {
    expect(closedAtFor(null, stage({ outcome: "won" }), now)).toBe(now);
    expect(closedAtFor(null, stage({ outcome: "lost" }), now)).toBe(now);
  });

  it("does NOT re-stamp a won→lost correction", () => {
    // Otherwise fixing a mistake would rewrite when the deal actually closed.
    expect(closedAtFor(earlier, stage({ outcome: "lost" }), now)).toBe(earlier);
  });

  it("clears it when a deal reopens", () => {
    // A reopened deal that kept its closing date would show up in "won last
    // quarter" forever.
    expect(closedAtFor(earlier, stage({ outcome: "open" }), now)).toBeNull();
  });

  it("leaves an open deal with nothing", () => {
    expect(closedAtFor(null, stage({ outcome: "open" }), now)).toBeNull();
  });
});

describe("weightedCents", () => {
  it("weights an open deal by its stage probability, with integer maths", () => {
    // 33% of 10,000 cents is 3,300 exactly; the point is that nothing here
    // divides a float.
    expect(
      weightedCents({ amountCents: 10_000 }, stage({ probability: 33 })),
    ).toBe(3_300);
    // And a case that must round rather than truncate or drift.
    expect(
      weightedCents({ amountCents: 333 }, stage({ probability: 33 })),
    ).toBe(110);
  });

  it("ignores the probability on terminal stages", () => {
    // Somebody leaving probability at 50 on the Won stage must not halve the
    // value of every closed deal.
    expect(
      weightedCents({ amountCents: 10_000 }, stage({ outcome: "won", probability: 50 })),
    ).toBe(10_000);
    expect(
      weightedCents({ amountCents: 10_000 }, stage({ outcome: "lost", probability: 90 })),
    ).toBe(0);
  });

  it("returns null for an unvalued deal rather than zero", () => {
    // "Not priced yet" and "worth nothing" are different facts, and a forecast
    // that conflated them would understate itself with confidence.
    expect(weightedCents({ amountCents: null }, stage())).toBeNull();
  });
});

describe("summarizeBoard", () => {
  it("returns a row for every stage, including empty ones", () => {
    const a = stage({ sortOrder: 0 });
    const b = stage({ sortOrder: 1 });
    const totals = summarizeBoard([a, b], []);
    expect(totals.map((t) => t.stageId)).toEqual([a.id, b.id]);
    expect(totals.every((t) => t.count === 0)).toBe(true);
  });

  it("counts unvalued deals without summing them", () => {
    const s = stage({ probability: 50 });
    const totals = summarizeBoard(
      [s],
      [
        { stageId: s.id, amountCents: 10_000 },
        { stageId: s.id, amountCents: null },
      ],
    );
    expect(totals[0]).toEqual({
      stageId: s.id,
      count: 2,
      amountCents: 10_000,
      weightedCents: 5_000,
      unvalued: 1,
    });
  });

  it("skips a deal whose stage is not on this board", () => {
    // An archived stage, or another pipeline's. Skipping beats crashing the
    // whole summary over one stray row.
    const s = stage();
    const totals = summarizeBoard(
      [s],
      [
        { stageId: s.id, amountCents: 100 },
        { stageId: "somewhere-else", amountCents: 999_999 },
      ],
    );
    expect(totals[0].count).toBe(1);
    expect(totals[0].amountCents).toBe(100);
  });
});

describe("openingStage", () => {
  it("picks the first live open stage in display order", () => {
    const won = stage({ sortOrder: 0, outcome: "won" });
    const second = stage({ sortOrder: 2 });
    const first = stage({ sortOrder: 1 });
    expect(openingStage([won, second, first])?.id).toBe(first.id);
  });

  it("skips archived stages", () => {
    const archived = stage({ sortOrder: 0, archivedAt: new Date(0) });
    const live = stage({ sortOrder: 1 });
    expect(openingStage([archived, live])?.id).toBe(live.id);
  });

  it("returns null when a pipeline has no open stage", () => {
    // The caller must refuse rather than drop a new deal straight into "Won".
    expect(openingStage([stage({ outcome: "won" }), stage({ outcome: "lost" })])).toBeNull();
  });
});

describe("isOpen", () => {
  it("reads the stage rather than any stored deal status", () => {
    expect(isOpen(stage({ outcome: "open" }))).toBe(true);
    expect(isOpen(stage({ outcome: "won" }))).toBe(false);
    expect(isOpen(stage({ outcome: "lost" }))).toBe(false);
  });
});
