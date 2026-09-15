import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cascade,
  daysBetween,
  durationDays,
  earliestStart,
  summarise,
  weeksCovering,
  wouldCycle,
  type PhaseDates,
} from "../src/packs/jobs/schedule-math";
import {
  JOB_CALENDAR,
  PHASE_ITEM_KIND,
  PHASE_KINDS,
  PHASE_KIND_LABELS,
  PHASE_STATUSES,
  PHASE_STATUS_LABELS,
  isPhaseKind,
  isPhaseStatus,
} from "../src/packs/jobs/vocabulary";

/**
 * A job's schedule (ADR 0071): the arithmetic of phases that follow one
 * another, pinned, and the two places the words must agree with the
 * database.
 */

const SQL = readFileSync("drizzle/0359_job_phases.sql", "utf8");

const P = (id: string, startOn: string, endOn: string, predecessorId: string | null = null, lagDays = 0): PhaseDates => ({
  id,
  startOn,
  endOn,
  predecessorId,
  lagDays,
});

describe("the database agrees with the words", () => {
  it("MIRRORS the kind and status CHECKs, and labels every value", () => {
    const kinds = SQL.match(/job_phases_kind_valid[^(]*\(([^)]*)\)/);
    const statuses = SQL.match(/job_phases_status_valid[^(]*\(([^)]*)\)/);
    expect(kinds, "kind constraint").not.toBeNull();
    expect(statuses, "status constraint").not.toBeNull();
    expect([...kinds![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()).toEqual([...PHASE_KINDS].sort());
    expect([...statuses![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()).toEqual([...PHASE_STATUSES].sort());
    for (const k of PHASE_KINDS) expect(PHASE_KIND_LABELS[k]).toBeTruthy();
    for (const s of PHASE_STATUSES) expect(PHASE_STATUS_LABELS[s]).toBeTruthy();
    expect(isPhaseKind("milestone")).toBe(true);
    expect(isPhaseKind("task")).toBe(false);
    expect(isPhaseStatus("underway")).toBe(true);
    expect(isPhaseStatus("late")).toBe(false);
  });

  it("holds the keys: the job and the item cascade, the predecessor, the party and the code are held; the item is unique; a phase is not its own predecessor", () => {
    expect(SQL).toMatch(/job_phases_project_fk[^;]*ON DELETE cascade/);
    expect(SQL).toMatch(/job_phases_item_fk[^;]*REFERENCES "public"."schedule_items"[^;]*ON DELETE cascade/);
    expect(SQL).toMatch(/job_phases_predecessor_fk[^;]*REFERENCES "public"."job_phases"[^;]*ON DELETE no action/);
    expect(SQL).toMatch(/job_phases_party_fk[^;]*ON DELETE no action/);
    expect(SQL).toMatch(/job_phases_code_fk[^;]*ON DELETE no action/);
    expect(SQL).toMatch(/CREATE UNIQUE INDEX "job_phases_item_idx"/);
    expect(SQL).toMatch(/job_phases_no_self_predecessor/);
    expect(SQL).toMatch(/job_phases_lag_within_a_year[^;]*between -365 and 365/);
    // Hand-reordered: the table's own unique index lands before the key that points back at it.
    expect(SQL.indexOf('CREATE UNIQUE INDEX "job_phases_tenant_id_id_idx"')).toBeLessThan(
      SQL.indexOf('ADD CONSTRAINT "job_phases_predecessor_fk"'),
    );
  });

  it("names the calendar and the item kind the way the scheduling module's open taxonomies want them", () => {
    expect(JOB_CALENDAR).toMatchObject({ extensionSlug: "jobs", extensionKey: "schedule", name: "Job schedule" });
    expect(JOB_CALENDAR.color).toMatch(/^(slate|blue|green|amber|rose|violet)$/);
    expect(PHASE_ITEM_KIND).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

describe("days", () => {
  it("counts inclusive days, and never less than one", () => {
    expect(daysBetween("2026-09-15", "2026-09-15")).toBe(0);
    expect(daysBetween("2026-09-15", "2026-09-20")).toBe(5);
    expect(daysBetween("2026-09-20", "2026-09-15")).toBe(-5);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(durationDays("2026-09-15", "2026-09-15")).toBe(1);
    expect(durationDays("2026-09-15", "2026-09-19")).toBe(5);
  });

  it("lets a successor start the day after its predecessor's last, plus the lag, minus an overlap", () => {
    expect(earliestStart("2026-09-19", 0)).toBe("2026-09-20");
    expect(earliestStart("2026-09-19", 3)).toBe("2026-09-23");
    expect(earliestStart("2026-09-19", -2)).toBe("2026-09-18");
  });

  it("covers a span in Sunday-first weeks", () => {
    // 2026-09-15 is a Tuesday; the week starts Sunday the 13th.
    expect(weeksCovering("2026-09-15", "2026-09-15")).toEqual(["2026-09-13"]);
    expect(weeksCovering("2026-09-15", "2026-09-27")).toEqual(["2026-09-13", "2026-09-20", "2026-09-27"]);
  });
});

describe("the chain", () => {
  const site = P("site", "2026-09-14", "2026-09-18");
  const slab = P("slab", "2026-09-21", "2026-09-25", "site");
  const framing = P("framing", "2026-09-28", "2026-10-16", "slab", 2);
  const roof = P("roof", "2026-10-19", "2026-10-23", "framing");
  const inspection = P("inspection", "2026-10-26", "2026-10-26", "roof");
  const chain = [site, slab, framing, roof, inspection];

  it("refuses a loop, in either direction, and a phase following itself", () => {
    expect(wouldCycle(chain, "site", "roof")).toBe(true);
    expect(wouldCycle(chain, "slab", "inspection")).toBe(true);
    expect(wouldCycle(chain, "roof", "site")).toBe(false);
    expect(wouldCycle(chain, "roof", null)).toBe(false);
    expect(wouldCycle(chain, "roof", "roof")).toBe(true);
  });

  it("pushes what follows when a phase moves later, every phase keeping its length, and reports only what moved", () => {
    // The slab slips a week: framing (2 days' lag), the roof and the inspection all move.
    const slipped = chain.map((p) => (p.id === "slab" ? { ...p, startOn: "2026-09-28", endOn: "2026-10-02" } : p));
    expect(cascade(slipped, ["slab"])).toEqual([
      { id: "framing", startOn: "2026-10-05", endOn: "2026-10-23" },
      { id: "roof", startOn: "2026-10-24", endOn: "2026-10-28" },
      { id: "inspection", startOn: "2026-10-29", endOn: "2026-10-29" },
    ]);
  });

  it("pulls nothing earlier: a phase that moves EARLIER leaves its successors where they are", () => {
    const early = chain.map((p) => (p.id === "slab" ? { ...p, startOn: "2026-09-19", endOn: "2026-09-23" } : p));
    expect(cascade(early, ["slab"])).toEqual([]);
  });

  it("moves a successor only as far as it must, and one with slack enough not at all", () => {
    // Framing was left with two days' slack: a one-day slip of the slab does not reach it.
    const slack = [site, slab, { ...framing, startOn: "2026-09-30", endOn: "2026-10-18" }, roof, inspection];
    const oneDay = slack.map((p) => (p.id === "slab" ? { ...p, startOn: "2026-09-22", endOn: "2026-09-26" } : p));
    expect(cascade(oneDay, ["slab"])).toEqual([]);
    // Three days: framing may start October 1st (the 28th, plus one, plus the lag), so it and the roof move a day; the inspection had a day to spare.
    const threeDays = slack.map((p) => (p.id === "slab" ? { ...p, startOn: "2026-09-24", endOn: "2026-09-28" } : p));
    expect(cascade(threeDays, ["slab"])).toEqual([
      { id: "framing", startOn: "2026-10-01", endOn: "2026-10-19" },
      { id: "roof", startOn: "2026-10-20", endOn: "2026-10-24" },
    ]);
  });

  it("reports a phase pushed by two changed ancestors once, at its final dates", () => {
    const fork = [
      P("a", "2026-09-14", "2026-09-15"),
      P("b", "2026-09-16", "2026-09-17", "a"),
      P("c", "2026-09-18", "2026-09-18", "b"),
    ];
    const moved = fork.map((p) => (p.id === "a" ? { ...p, startOn: "2026-09-20", endOn: "2026-09-21" } : p));
    expect(cascade(moved, ["a"])).toEqual([
      { id: "b", startOn: "2026-09-22", endOn: "2026-09-23" },
      { id: "c", startOn: "2026-09-24", endOn: "2026-09-24" },
    ]);
    expect(cascade(moved, ["a", "a"])).toHaveLength(2);
  });
});

describe("the sentence", () => {
  it("counts phases and milestones, done and underway, overdue against today, and the span", () => {
    const s = summarise(
      [
        { startOn: "2026-09-14", endOn: "2026-09-18", status: "done", kind: "phase" },
        { startOn: "2026-09-21", endOn: "2026-09-25", status: "underway", kind: "phase" },
        { startOn: "2026-09-10", endOn: "2026-09-12", status: "planned", kind: "phase" },
        { startOn: "2026-10-26", endOn: "2026-10-26", status: "planned", kind: "milestone" },
      ],
      "2026-09-23",
    );
    expect(s).toEqual({ count: 4, milestones: 1, done: 1, underway: 1, overdue: 1, startOn: "2026-09-10", endOn: "2026-10-26", spanDays: 47 });
    expect(summarise([], "2026-09-23")).toEqual({ count: 0, milestones: 0, done: 0, underway: 0, overdue: 0, startOn: null, endOn: null, spanDays: 0 });
  });
});
