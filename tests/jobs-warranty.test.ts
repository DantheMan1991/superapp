import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXPIRING_WITHIN_DAYS,
  addMonths,
  claimStanding,
  claimsSentence,
  daysBetween,
  periodSentence,
  summariseClaims,
  warrantyExpiresOn,
  warrantyStanding,
  withinWarranty,
  workTitleFor,
} from "../src/packs/jobs/warranty-math";
import { jobsEntityLinks } from "../src/packs/jobs/links";
import {
  CLAIM_STANDINGS,
  CLAIM_STANDING_LABELS,
  WARRANTY_CLAIM_ENTITY,
  WARRANTY_DECISIONS,
  WARRANTY_DECISION_LABELS,
  WARRANTY_MONTHS_MAX,
  isWarrantyDecision,
} from "../src/packs/jobs/vocabulary";

/**
 * The warranty's arithmetic (ADR 0076), pure: the period, the expiry, a
 * claim inside or outside it, and where a claim stands. The database suites
 * prove the rows.
 */

const SQL = readFileSync("drizzle/0367_job_warranty.sql", "utf8");

describe("the database agrees with the words", () => {
  it("MIRRORS the decision CHECK, labels every decision and every standing, and knows its own decisions", () => {
    const m = SQL.match(/job_warranty_claims_decision_valid[^(]*\(([^)]*)\)/);
    expect(m, "decision constraint").not.toBeNull();
    const listed = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(listed).toEqual([...WARRANTY_DECISIONS].sort());
    for (const d of WARRANTY_DECISIONS) expect(WARRANTY_DECISION_LABELS[d].length).toBeGreaterThan(0);
    for (const s of CLAIM_STANDINGS) expect(CLAIM_STANDING_LABELS[s].length).toBeGreaterThan(0);
    expect(isWarrantyDecision("covered")).toBe(true);
    expect(isWarrantyDecision("maybe")).toBe(false);
  });

  it("MIRRORS the months bound and the decision-dated rule, both written to survive a NULL", () => {
    expect(SQL).toMatch(new RegExp(`job_projects_warranty_months_whole[^;]*coalesce\\([^)]*\\) between 1 and ${WARRANTY_MONTHS_MAX}\\)`));
    expect(SQL).toMatch(/job_warranty_claims_decision_dated[^;]*= 'pending'\) = \([^)]*decided_on" is null\)/);
    // The two keys that SET NULL do so in the column-list form; a bare SET NULL can never run on a composite key.
    expect(SQL).toMatch(/job_warranty_claims_cost_code_fk[^;]*ON DELETE SET NULL \("cost_code_id"\)/);
    expect(SQL).toMatch(/job_warranty_claims_work_fk[^;]*ON DELETE SET NULL \("work_item_id"\)/);
  });

  it("registers the claim as something a work item or a calendar item can point at", () => {
    const type = jobsEntityLinks.entityTypes.find((t) => t.type === WARRANTY_CLAIM_ENTITY);
    expect(type?.label).toBe("Warranty claim");
    expect(typeof type?.search).toBe("function");
    expect(typeof type?.resolve).toBe("function");
  });
});

describe("addMonths", () => {
  it("adds calendar months and clamps the day to the month's last", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-03-31", 1)).toBe("2026-04-30");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-06-30", 12)).toBe("2027-06-30");
    expect(addMonths("2026-02-28", 12)).toBe("2027-02-28");
    expect(addMonths("2026-06-30", 24)).toBe("2028-06-30");
    expect(addMonths("2026-06-30", 0)).toBe("2026-06-30");
  });
});

describe("daysBetween", () => {
  it("counts whole days, negative backwards", () => {
    expect(daysBetween("2026-09-16", "2026-09-16")).toBe(0);
    expect(daysBetween("2026-09-16", "2026-09-17")).toBe(1);
    expect(daysBetween("2026-09-17", "2026-09-16")).toBe(-1);
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
  });
});

describe("the period", () => {
  it("expires months after substantial completion, and not at all until both are set", () => {
    expect(warrantyExpiresOn({ substantialCompletionOn: "2026-06-30", warrantyMonths: 12 })).toBe("2027-06-30");
    expect(warrantyExpiresOn({ substantialCompletionOn: null, warrantyMonths: 12 })).toBeNull();
    expect(warrantyExpiresOn({ substantialCompletionOn: "2026-06-30", warrantyMonths: null })).toBeNull();
    expect(warrantyExpiresOn({ substantialCompletionOn: "2026-06-30", warrantyMonths: 0 })).toBeNull();
  });

  it("stands unset, not started, running, expiring or expired against today", () => {
    const p = { substantialCompletionOn: "2026-06-30", warrantyMonths: 12 };
    expect(warrantyStanding({ substantialCompletionOn: null, warrantyMonths: null }, "2026-09-16")).toEqual({ state: "unset", expiresOn: null, daysLeft: null });
    expect(warrantyStanding(p, "2026-06-01")).toEqual({ state: "not_started", expiresOn: "2027-06-30", daysLeft: 394 });
    expect(warrantyStanding(p, "2026-06-30").state).toBe("running");
    expect(warrantyStanding(p, "2026-09-16")).toEqual({ state: "running", expiresOn: "2027-06-30", daysLeft: 287 });
    expect(warrantyStanding(p, "2027-05-01")).toEqual({ state: "expiring", expiresOn: "2027-06-30", daysLeft: EXPIRING_WITHIN_DAYS });
    expect(warrantyStanding(p, "2027-06-30")).toEqual({ state: "expiring", expiresOn: "2027-06-30", daysLeft: 0 });
    expect(warrantyStanding(p, "2027-07-01")).toEqual({ state: "expired", expiresOn: "2027-06-30", daysLeft: -1 });
  });

  it("says a claim is inside by the day reported, before completion included, and nothing when there is no period", () => {
    const p = { substantialCompletionOn: "2026-06-30", warrantyMonths: 12 };
    expect(withinWarranty("2026-09-10", p)).toBe(true);
    expect(withinWarranty("2027-06-30", p)).toBe(true);
    expect(withinWarranty("2027-07-01", p)).toBe(false);
    expect(withinWarranty("2026-05-01", p)).toBe(true);
    expect(withinWarranty("2026-09-10", { substantialCompletionOn: null, warrantyMonths: 12 })).toBeNull();
  });

  it("reads as one sentence in every state", () => {
    const p = { substantialCompletionOn: "2026-06-30", warrantyMonths: 12 };
    expect(periodSentence({ substantialCompletionOn: null, warrantyMonths: null }, warrantyStanding({ substantialCompletionOn: null, warrantyMonths: null }, "2026-09-16"))).toBe("No warranty period set.");
    expect(periodSentence(p, warrantyStanding(p, "2026-06-01"))).toBe("The warranty starts at substantial completion on 2026-06-30 and runs 12 months, to 2027-06-30.");
    expect(periodSentence(p, warrantyStanding(p, "2026-09-16"))).toBe("Under warranty until 2027-06-30, 287 days left.");
    expect(periodSentence(p, warrantyStanding(p, "2027-06-29"))).toBe("Under warranty until 2027-06-30, 1 day left.");
    expect(periodSentence(p, warrantyStanding(p, "2027-07-11"))).toBe("The warranty ended 2027-06-30, 11 days ago.");
    expect(periodSentence({ substantialCompletionOn: "2026-06-30", warrantyMonths: 1 }, warrantyStanding({ substantialCompletionOn: "2026-06-30", warrantyMonths: 1 }, "2026-06-01"))).toContain("runs 1 month,");
  });
});

describe("where a claim stands", () => {
  const closed = { completedAt: new Date("2026-09-20T12:00:00Z"), dueOn: "2026-09-18" };
  const dated = { completedAt: null, dueOn: "2026-09-18" };
  const bare = { completedAt: null, dueOn: null };

  it("is not covered by the decision whatever the work says, else done, scheduled or open by the work", () => {
    expect(claimStanding("not_covered", closed)).toBe("not_covered");
    expect(claimStanding("not_covered", null)).toBe("not_covered");
    expect(claimStanding("pending", closed)).toBe("done");
    expect(claimStanding("covered", closed)).toBe("done");
    expect(claimStanding("covered", dated)).toBe("scheduled");
    expect(claimStanding("pending", bare)).toBe("open");
    expect(claimStanding("pending", null)).toBe("open");
  });

  it("counts and says the claims", () => {
    expect(claimsSentence(summariseClaims([]))).toBe("No claims.");
    expect(claimsSentence(summariseClaims(["open", "scheduled", "done"]))).toBe("3 claims: 1 open, 1 scheduled, 1 done.");
    expect(claimsSentence(summariseClaims(["not_covered"]))).toBe("1 claim: 1 not covered.");
    expect(summariseClaims(["open", "open", "done", "not_covered"])).toEqual({ total: 4, open: 2, scheduled: 0, done: 1, notCovered: 1 });
  });

  it("titles the work item by number and job, and keeps it short", () => {
    expect(workTitleFor(3, "  Drip under the sink ", "24-109")).toBe("Warranty claim 3 on 24-109: Drip under the sink");
    const long = "x".repeat(260);
    const t = workTitleFor(1, long, "24-109");
    expect(t.endsWith("…")).toBe(true);
    expect(t.length).toBeLessThan(240);
  });
});
