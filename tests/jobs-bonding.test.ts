import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  backlogOf,
  bondStanding,
  bondingCapacity,
  bondsSentence,
  capacitySentence,
  daysBetween,
  fitSentence,
  tiesUpCapacity,
  wouldFit,
} from "../src/packs/jobs/bonding-math";
import {
  BONDED_STANDINGS,
  BOND_STANDINGS,
  BOND_STANDING_LABELS,
  BOND_STATUSES,
  BOND_STATUS_LABELS,
  EXPIRING_SOON_DAYS,
  SUGGESTED_BOND_KINDS,
  isBondKind,
  isBondStatus,
} from "../src/packs/jobs/vocabulary";

/**
 * Bonding's arithmetic (ADR 0078), pure: where a bond stands, what it ties
 * up, and whether one more job would go on the line. The database suites
 * prove the rows.
 */

const SQL = readFileSync("drizzle/0371_job_bonding.sql", "utf8");

describe("the database agrees with the words", () => {
  it("MIRRORS the status CHECK, labels every status and every standing, and knows its own", () => {
    const m = SQL.match(/job_bonds_status_valid[^(]*\(([^)]*)\)/);
    expect(m, "status constraint").not.toBeNull();
    expect([...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()).toEqual([...BOND_STATUSES].sort());
    for (const s of BOND_STATUSES) expect(BOND_STATUS_LABELS[s].length).toBeGreaterThan(0);
    for (const s of BOND_STANDINGS) expect(BOND_STANDING_LABELS[s].length).toBeGreaterThan(0);
    expect(isBondStatus("released")).toBe(true);
    expect(isBondStatus("active")).toBe(false);
  });

  it("MIRRORS the kind FORMAT rather than a list, because what a business posts is its own", () => {
    expect(SQL).toMatch(/job_bonds_kind_format[^;]*\^\[a-z\]\[a-z0-9_\]\{0,62\}\$/);
    for (const k of SUGGESTED_BOND_KINDS) expect(isBondKind(k)).toBe(true);
    expect(isBondKind("site_improvement")).toBe(true);
    expect(isBondKind("Performance")).toBe(false);
    expect(isBondKind("")).toBe(false);
  });

  it("MIRRORS the money, the dates and the limits, each written to survive a NULL", () => {
    expect(SQL).toMatch(/job_bonds_penal_sum_positive[^;]*"penal_sum_cents" > 0/);
    expect(SQL).toMatch(/job_bonds_premium_nonnegative[^;]*coalesce\([^)]*\) >= 0/);
    expect(SQL).toMatch(/job_bonds_in_force_dated[^;]*in \('requested', 'void'\) or [^;]*"effective_on" is not null/);
    expect(SQL).toMatch(/job_bonds_released_dated[^;]*= 'released'\) = \([^)]*"released_on" is not null\)/);
    expect(SQL).toMatch(/job_bonding_lines_single_within_aggregate[^;]*<=/);
    expect(SQL).toMatch(/job_bonding_lines_single_positive[^;]*coalesce/);
    // The two keys that SET NULL do so in the column-list form; a bare one cannot run on a composite key.
    expect(SQL).toMatch(/job_bonds_contract_fk[^;]*ON DELETE SET NULL \("contract_id"\)/);
    expect(SQL).toMatch(/job_bonds_cost_code_fk[^;]*ON DELETE SET NULL \("cost_code_id"\)/);
    // One line per company, and the bonds go with the job.
    expect(SQL).toMatch(/job_bonding_lines_entity_idx[^;]*"tenant_id","entity_id"/);
    expect(SQL).toMatch(/job_bonds_project_fk[^;]*ON DELETE cascade/);
  });
});

describe("where a bond stands", () => {
  const today = "2026-09-16";

  it("is settled by its status, and read against today only while in force", () => {
    expect(bondStanding("void", "2027-01-01", today)).toBe("void");
    expect(bondStanding("released", "2027-01-01", today)).toBe("released");
    expect(bondStanding("requested", null, today)).toBe("requested");
    expect(bondStanding("issued", null, today)).toBe("active");
    expect(bondStanding("issued", "2027-01-01", today)).toBe("active");
    expect(bondStanding("issued", "2026-09-15", today)).toBe("expired");
    expect(bondStanding("issued", today, today)).toBe("expiring");
  });

  it("calls a bond expiring within the month the certificates use", () => {
    const edge = new Date(Date.UTC(2026, 8, 16 + EXPIRING_SOON_DAYS)).toISOString().slice(0, 10);
    expect(daysBetween(today, edge)).toBe(EXPIRING_SOON_DAYS);
    expect(bondStanding("issued", edge, today)).toBe("expiring");
    const past = new Date(Date.UTC(2026, 8, 17 + EXPIRING_SOON_DAYS)).toISOString().slice(0, 10);
    expect(bondStanding("issued", past, today)).toBe("active");
  });

  it("ties up the line from the day it is asked for, and lets go once released or expired", () => {
    expect(BONDED_STANDINGS.map((s) => tiesUpCapacity(s))).toEqual([true, true, true]);
    expect([tiesUpCapacity("released"), tiesUpCapacity("expired"), tiesUpCapacity("void")]).toEqual([false, false, false]);
  });

  it("says a job's bonds in one line", () => {
    expect(bondsSentence([])).toBe("No bonds on this job.");
    expect(bondsSentence(["active", "active"])).toBe("2 bonds: 2 in force.");
    expect(bondsSentence(["active", "requested"])).toBe("2 bonds: 1 in force, 1 asked for.");
    expect(bondsSentence(["released"])).toBe("1 bond: 1 released.");
  });
});

describe("what is tied up", () => {
  it("is the backlog, never below nothing", () => {
    expect(backlogOf({ projectId: "a", contractCents: 900_000_00, billedCents: 300_000_00 }).backlogCents).toBe(600_000_00);
    // Billed past the contract on a job nobody has changed yet: the surety's exposure is nil, not negative.
    expect(backlogOf({ projectId: "a", contractCents: 100_000_00, billedCents: 140_000_00 }).backlogCents).toBe(0);
  });

  it("COUNTS A JOB ONCE, which is the point: two bonds on one job are one exposure", () => {
    // The caller folds bonds per job before this sees them; the arithmetic sums entries.
    const oneJob = [backlogOf({ projectId: "a", contractCents: 900_000_00, billedCents: 300_000_00 })];
    const capacity = bondingCapacity({ singleJobLimitCents: 1_500_000_00, aggregateLimitCents: 5_000_000_00 }, oneJob);
    expect([capacity.usedCents, capacity.availableCents, capacity.jobCount, capacity.over]).toEqual([600_000_00, 4_400_000_00, 1, false]);
  });

  it("leaves what is left unknown until somebody types an aggregate, and never below nothing", () => {
    const jobs = [backlogOf({ projectId: "a", contractCents: 900_000_00, billedCents: 0 })];
    expect(bondingCapacity({ singleJobLimitCents: null, aggregateLimitCents: null }, jobs).availableCents).toBeNull();
    const over = bondingCapacity({ singleJobLimitCents: null, aggregateLimitCents: 500_000_00 }, jobs);
    expect([over.availableCents, over.over]).toEqual([0, true]);
  });
});

describe("whether one more would fit", () => {
  const capacity = bondingCapacity({ singleJobLimitCents: 1_500_000_00, aggregateLimitCents: 5_000_000_00 }, [
    backlogOf({ projectId: "a", contractCents: 4_000_000_00, billedCents: 0 }),
  ]);

  it("checks the single-job limit first, then what is left", () => {
    expect(wouldFit(capacity, 900_000_00)).toBe("fits");
    expect(wouldFit(capacity, 1_600_000_00)).toBe("over_single");
    expect(wouldFit(capacity, 1_200_000_00)).toBe("over_aggregate");
    expect(wouldFit(bondingCapacity({ singleJobLimitCents: null, aggregateLimitCents: null }, []), 900_000_00)).toBe("unknown");
  });

  it("says each verdict in the words somebody about to bid wants", () => {
    expect(fitSentence(capacity, 900_000_00)).toBe("A 900,000.00 job fits: inside the single-job limit and inside what is left.");
    expect(fitSentence(capacity, 1_600_000_00)).toContain("over the 1,500,000.00 single-job limit");
    expect(fitSentence(capacity, 1_200_000_00)).toBe("A 1,200,000.00 job is more than the 1,000,000.00 left on the line.");
    expect(fitSentence(bondingCapacity({ singleJobLimitCents: null, aggregateLimitCents: null }, []), 1_00)).toContain("No limits recorded");
  });
});

describe("the capacity sentence", () => {
  const jobs = [backlogOf({ projectId: "a", contractCents: 900_000_00, billedCents: 300_000_00 })];

  it("reads for a line that is set, one that is not, and one that is exhausted", () => {
    expect(capacitySentence(bondingCapacity({ singleJobLimitCents: null, aggregateLimitCents: 5_000_000_00 }, jobs), "job", "jobs")).toBe(
      "600,000.00 of bonded work on hand across 1 job, leaving 4,400,000.00 of the 5,000,000.00 your surety backs.",
    );
    expect(capacitySentence(bondingCapacity({ singleJobLimitCents: null, aggregateLimitCents: null }, jobs), "job", "jobs")).toBe(
      "600,000.00 of bonded work on hand across 1 job. Set the limits your surety gave you to see what is left.",
    );
    expect(capacitySentence(bondingCapacity({ singleJobLimitCents: null, aggregateLimitCents: null }, []), "job", "jobs")).toContain(
      "No bonded work on hand",
    );
    expect(capacitySentence(bondingCapacity({ singleJobLimitCents: null, aggregateLimitCents: 500_000_00 }, jobs), "job", "jobs")).toContain(
      "past the 500,000.00 your surety backs. Ask them before you bid again.",
    );
  });
});
