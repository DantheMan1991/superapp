import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APPROVED_CHANGE_STATUSES,
  BILLING_METHODS,
  CHANGE_ORDER_STATUSES,
  CHANGE_ORDER_STATUS_LABELS,
  COMMITMENT_KINDS,
  COMMITMENT_KIND_LABELS,
  COMMITMENT_STATUSES,
  COMMITMENT_STATUS_LABELS,
  COMMITTED_STATUSES,
  COST_CODE_DIMENSION,
  PROJECT_DIMENSION,
  BILLING_METHOD_LABELS,
  CONTRACT_ROLES,
  CONTRACT_STATUSES,
  CONTRACT_STATUS_LABELS,
  DELIVERY_METHOD_FORMAT,
  PACK,
  PAY_APPLICATION_STATUSES,
  PAY_APPLICATION_STATUS_LABELS,
  PROJECT_STATUSES,
  RETAINAGE_PPM_MAX,
  STATUS_LABELS,
  ROLE_LABELS,
  VALUED_CONTRACT_STATUSES,
  contractKindsFrom,
  deliveryMethodsFrom,
  isBillingMethod,
  isChangeOrderStatus,
  isCommitmentKind,
  isCommitmentStatus,
  isContractRole,
  isContractStatus,
  isPayApplicationStatus,
  isProjectStatus,
  slugLabel,
} from "../src/packs/jobs/vocabulary";
import {
  lineCompletedCents,
  payApplicationTotals,
  percentComplete,
  percentStringToPpm,
  ppmToPercentString,
  retainageCents,
} from "../src/packs/jobs/billing-math";
import { packRegistry } from "../src/packs";

/**
 * The `jobs` pack's pure half: the words, and the two places they must agree
 * with the database.
 *
 * **THE MIRROR TESTS ARE THE POINT.** `DELIVERY_METHOD_FORMAT` and
 * `PROJECT_STATUSES` each exist twice — once in TypeScript, once as a CHECK
 * constraint in `drizzle/0325_jobs.sql` — and two copies of a rule is how one of
 * them drifts. A drift here does not fail loudly: the app would accept a value
 * the database then refuses, so the user sees "Something went wrong" on a form
 * that looked fine. So the SQL is read and compared rather than trusted.
 */
const MIGRATION = readFileSync("drizzle/0325_jobs.sql", "utf8");

describe("the pack declares itself consistently", () => {
  it("registers under the slug its own constant names", () => {
    // A mismatch would make `requireModuleEnabled` check a module that is not
    // this one, which fails open on a tenant that happens to have both.
    expect(packRegistry[PACK]).toBeDefined();
    expect(packRegistry[PACK].slug).toBe(PACK);
  });

  it("depends on nothing — it is the bottom of the family", () => {
    expect(packRegistry[PACK].requires).toEqual([]);
  });

  it("names an icon the registry actually has", async () => {
    // `getIcon` falls back to a generic box rather than throwing, which is how
    // five packs once shipped showing the wrong icon. See the registry header.
    const { ICONS } = await import("../src/components/app/icon-registry");
    expect(Object.keys(ICONS)).toContain(packRegistry[PACK].icon);
  });
});

describe("delivery method", () => {
  it("accepts the shape the database accepts", () => {
    for (const ok of ["a", "luxury_custom", "commercial", "semi_custom", "x9"]) {
      expect(DELIVERY_METHOD_FORMAT.test(ok), ok).toBe(true);
    }
  });

  it("refuses what the database refuses", () => {
    // A trailing underscore is deliberately NOT here: it is legal, matching the
    // `[a-z0-9_]*` tail the constraint allows.
    for (const bad of ["", "Luxury", "9lives", "has space", "_lead", "a-b"]) {
      expect(DELIVERY_METHOD_FORMAT.test(bad), bad).toBe(false);
    }
  });

  it("MIRRORS the CHECK constraint in the migration, character for character", () => {
    // The pattern in the SQL, pulled out of the constraint itself.
    const m = MIGRATION.match(
      /job_projects_delivery_method_format[^~]*~ '([^']+)'/,
    );
    expect(m, "constraint not found in drizzle/0325_jobs.sql").not.toBeNull();
    expect(m![1]).toBe(DELIVERY_METHOD_FORMAT.source);
  });

  it("reads suggestions from a profile's config, and tolerates junk", () => {
    expect(deliveryMethodsFrom({ deliveryMethods: ["commercial", "semi_custom"] })).toEqual(
      ["commercial", "semi_custom"],
    );
    // Total by construction: most tenants have no profile at all, and the jsonb
    // has no shape constraint. Anything unreadable means an empty list and a
    // free-text field — never a crash.
    expect(deliveryMethodsFrom(undefined)).toEqual([]);
    expect(deliveryMethodsFrom(null)).toEqual([]);
    expect(deliveryMethodsFrom("nonsense")).toEqual([]);
    expect(deliveryMethodsFrom({ deliveryMethods: "nonsense" })).toEqual([]);
    expect(deliveryMethodsFrom([])).toEqual([]);
  });

  it("drops individual entries the database would refuse", () => {
    // One bad word in a profile must not take the whole list down with it.
    expect(
      deliveryMethodsFrom({ deliveryMethods: ["commercial", "Not A Slug", 7, "ok_one"] }),
    ).toEqual(["commercial", "ok_one"]);
  });

  it("ships NO list of its own, which is the boundary", () => {
    // A pack that knew what "commercial" meant would know what industry it was
    // in (ADR 0004). The only way to get a suggestion is from a profile.
    const source = readFileSync("src/packs/jobs/vocabulary.ts", "utf8");
    // The words may appear in prose explaining why they are absent; what must
    // not exist is a default the code falls back to.
    expect(deliveryMethodsFrom({})).toEqual([]);
    expect(source).not.toMatch(/deliveryMethods\s*[:=]\s*\[\s*"/);
  });
});

describe("status", () => {
  it("MIRRORS the CHECK constraint in the migration", () => {
    const m = MIGRATION.match(/job_projects_status_valid[^(]*\(([^)]*)\)/);
    expect(m, "constraint not found").not.toBeNull();
    const inSql = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(inSql.sort()).toEqual([...PROJECT_STATUSES].sort());
  });

  it("gives every status a label a person can read", () => {
    for (const s of PROJECT_STATUSES) {
      expect(STATUS_LABELS[s], s).toBeTruthy();
    }
  });

  it("recognises its own statuses and nothing else", () => {
    expect(isProjectStatus("active")).toBe(true);
    expect(isProjectStatus("archived")).toBe(false);
  });
});

describe("slugLabel", () => {
  it("turns a slug into something readable", () => {
    expect(slugLabel("luxury_custom")).toBe("Luxury custom");
    expect(slugLabel("commercial")).toBe("Commercial");
  });

  it("does not fall over on an empty string", () => {
    expect(slugLabel("")).toBe("");
  });
});

/**
 * Contracts. The mirror tests matter more here than on the project, because
 * `billing_method` is a CLOSED list in both places: a method offered on screen
 * that the CHECK constraint refuses is a form that looks fine and fails on save.
 */
const CONTRACTS_SQL = readFileSync("drizzle/0327_job_contracts.sql", "utf8");

describe("contracts", () => {
  it("MIRRORS the billing-method CHECK constraint", () => {
    const m = CONTRACTS_SQL.match(/job_contracts_billing_method_valid[^(]*\(([^)]*)\)/);
    expect(m, "constraint not found").not.toBeNull();
    const inSql = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(inSql.sort()).toEqual([...BILLING_METHODS].sort());
  });

  it("MIRRORS the status CHECK constraint", () => {
    const m = CONTRACTS_SQL.match(/job_contracts_status_valid[^(]*\(([^)]*)\)/);
    const inSql = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(inSql.sort()).toEqual([...CONTRACT_STATUSES].sort());
  });

  it("MIRRORS the role CHECK constraint", () => {
    const m = CONTRACTS_SQL.match(/job_contracts_role_valid[^(]*\(([^)]*)\)/);
    const inSql = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(inSql.sort()).toEqual([...CONTRACT_ROLES].sort());
  });

  it("has NO direction column, and role is what replaced it", () => {
    /*
     * The dossier listed one. Every row here is billed BY the business; what it
     * issues outward is `commitments`, a different table. If a direction column
     * ever appears, one of those two claims has stopped being true and the
     * boundary needs re-reading rather than a column adding.
     */
    expect(CONTRACTS_SQL).not.toMatch(/"direction"/);
    expect(CONTRACTS_SQL).toMatch(/"role" text/);
  });

  it("counts only signed and complete contracts toward a project's value", () => {
    // The rule lives in one exported constant so the SQL roll-up and the page's
    // own sum cannot drift into disagreeing about what a job is worth.
    expect([...VALUED_CONTRACT_STATUSES].sort()).toEqual(["complete", "signed"]);
    for (const notMoney of ["proposed", "declined", "cancelled"] as const) {
      expect(VALUED_CONTRACT_STATUSES).not.toContain(notMoney);
    }
  });

  it("gives every role, status and billing method a readable label", () => {
    for (const r of CONTRACT_ROLES) expect(ROLE_LABELS[r]).toBeTruthy();
    for (const s of CONTRACT_STATUSES) expect(CONTRACT_STATUS_LABELS[s]).toBeTruthy();
    for (const m of BILLING_METHODS) expect(BILLING_METHOD_LABELS[m]).toBeTruthy();
  });

  it("reads contract kinds from a profile and ships none of its own", () => {
    expect(contractKindsFrom({ contractKinds: ["concept_design", "aia"] })).toEqual([
      "concept_design",
      "aia",
    ]);
    expect(contractKindsFrom({})).toEqual([]);
    expect(contractKindsFrom(undefined)).toEqual([]);
    expect(contractKindsFrom({ contractKinds: "nonsense" })).toEqual([]);
    // One bad word must not take the list down with it.
    expect(contractKindsFrom({ contractKinds: ["aia", "Not A Slug", 7] })).toEqual([
      "aia",
    ]);
  });

  it("recognises its own values and nothing else", () => {
    expect(isContractRole("subcontract")).toBe(true);
    expect(isContractRole("gc")).toBe(false);
    expect(isBillingMethod("schedule_of_values")).toBe(true);
    expect(isBillingMethod("whatever")).toBe(false);
    expect(isContractStatus("declined")).toBe(true);
    expect(isContractStatus("lost")).toBe(false);
  });
});

/**
 * Commitments. The mirror tests matter for the same reason they do on contracts:
 * `kind` and `status` are CLOSED lists in both TypeScript and SQL, so a value
 * offered on screen that the CHECK refuses is a form that looks fine and fails
 * on save.
 */
const COMMITMENTS_SQL = readFileSync("drizzle/0329_job_commitments.sql", "utf8");

describe("commitments", () => {
  it("MIRRORS the kind CHECK constraint", () => {
    const m = COMMITMENTS_SQL.match(/job_commitments_kind_valid[^(]*\(([^)]*)\)/);
    expect(m, "constraint not found").not.toBeNull();
    const inSql = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(inSql.sort()).toEqual([...COMMITMENT_KINDS].sort());
  });

  it("MIRRORS the status CHECK constraint", () => {
    const m = COMMITMENTS_SQL.match(/job_commitments_status_valid[^(]*\(([^)]*)\)/);
    const inSql = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(inSql.sort()).toEqual([...COMMITMENT_STATUSES].sort());
  });

  it("counts only ISSUED and CLOSED as committed money", () => {
    // A draft is written but not sent; nobody is owed anything. Same shape of
    // rule as a proposed contract not being revenue, and the same reason.
    expect([...COMMITTED_STATUSES].sort()).toEqual(["closed", "issued"]);
    for (const notMoney of ["draft", "cancelled"] as const) {
      expect(COMMITTED_STATUSES).not.toContain(notMoney);
    }
  });

  it("gives every kind and status a readable label", () => {
    for (const k of COMMITMENT_KINDS) expect(COMMITMENT_KIND_LABELS[k]).toBeTruthy();
    for (const s of COMMITMENT_STATUSES) expect(COMMITMENT_STATUS_LABELS[s]).toBeTruthy();
  });

  it("recognises its own values and nothing else", () => {
    expect(isCommitmentKind("subcontract")).toBe(true);
    expect(isCommitmentKind("work_order")).toBe(false);
    expect(isCommitmentStatus("issued")).toBe(true);
    expect(isCommitmentStatus("sent")).toBe(false);
  });

  it("keeps a committed amount non-negative in the database too", () => {
    // A credit is a change order, not a negative purchase order.
    expect(COMMITMENTS_SQL).toMatch(/job_commitment_lines_amount_nonnegative/);
  });

  it("names the two dimension types this pack syncs, and they differ", () => {
    // A line may carry one of each: `loadDimensionMembers` refuses only two
    // members of the SAME type, so a bill can say which job AND which trade.
    expect(PROJECT_DIMENSION).not.toBe(COST_CODE_DIMENSION);
  });
});

/**
 * Change orders. The status list is CLOSED in both places, the money is the
 * only money in the pack WITHOUT a floor, and an approval is not an approval
 * without a date — and all three are read from the migration rather than
 * trusted, because each would fail silently: a form that looks fine and a save
 * that says "Something went wrong".
 */
const CHANGE_ORDERS_SQL = readFileSync("drizzle/0333_job_change_orders.sql", "utf8");

describe("change orders", () => {
  it("MIRRORS the status CHECK constraint", () => {
    const m = CHANGE_ORDERS_SQL.match(/job_change_orders_status_valid[^(]*\(([^)]*)\)/);
    expect(m, "constraint not found").not.toBeNull();
    const inSql = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(inSql.sort()).toEqual([...CHANGE_ORDER_STATUSES].sort());
  });

  it("counts ONLY APPROVED as money that has moved", () => {
    // One constant, read by the SQL roll-ups and by the page, so they cannot
    // drift into two opinions about whether a proposed change is money.
    expect([...APPROVED_CHANGE_STATUSES]).toEqual(["approved"]);
    for (const notMoney of ["proposed", "declined", "void"] as const) {
      expect(APPROVED_CHANGE_STATUSES).not.toContain(notMoney);
    }
  });

  it("has NO floor on either amount, and that is the one place in the pack without one", () => {
    /*
     * A deductive change order is a negative number, not a separate "credit"
     * concept. Every other money column here carries a `>= 0` CHECK; if one
     * appears on these two, somebody has made a deduction unrepresentable.
     */
    expect(CHANGE_ORDERS_SQL).not.toMatch(/nonnegative/);
    expect(CHANGE_ORDERS_SQL).not.toMatch(/value_cents"? >= 0/);
    expect(CHANGE_ORDERS_SQL).not.toMatch(/amount_cents"? >= 0/);
  });

  it("makes the approval date part of BEING approved, in the database", () => {
    // The date is the evidence; a status anybody can flip without one is a
    // status nobody has to justify. The action enforces it and this backs it.
    expect(CHANGE_ORDERS_SQL).toMatch(/job_change_orders_approved_has_date/);
    expect(CHANGE_ORDERS_SQL).toMatch(/= 'approved'\) = \("job_change_orders"."approved_on" is not null\)/);
  });

  it("belongs to a CONTRACT and carries no project_id of its own", () => {
    // A change order changes ONE agreement. The project is reachable through
    // the contract, and a second copy of it here would be the one that drifts.
    expect(CHANGE_ORDERS_SQL).toMatch(/"contract_id" uuid NOT NULL/);
    expect(CHANGE_ORDERS_SQL).not.toMatch(/"project_id"/);
  });

  it("is numbered per CONTRACT, not per tenant", () => {
    // CO-1 on the drawings agreement and CO-1 on the build are different
    // documents on different pay applications.
    expect(CHANGE_ORDERS_SQL).toMatch(
      /job_change_orders_contract_number_idx[^;]*\("tenant_id","contract_id","number"\)/,
    );
  });

  it("keeps a code with a change against it from being deleted", () => {
    // RESTRICT, like a commitment line's and a budget line's: retired, never deleted.
    expect(CHANGE_ORDERS_SQL).toMatch(
      /job_change_order_lines_code_fk[^;]*ON DELETE no action/,
    );
  });

  it("gives every status a readable label", () => {
    for (const s of CHANGE_ORDER_STATUSES) expect(CHANGE_ORDER_STATUS_LABELS[s]).toBeTruthy();
  });

  it("recognises its own values and nothing else", () => {
    expect(isChangeOrderStatus("void")).toBe(true);
    expect(isChangeOrderStatus("approved")).toBe(true);
    expect(isChangeOrderStatus("signed")).toBe(false);
    expect(isChangeOrderStatus("pco")).toBe(false);
  });
});

/**
 * Progress billing. The status list and the retainage range are CHECKs in
 * both places, an issued application must be an invoice in both places, and
 * the G702 arithmetic is pinned number by number — because a certificate that
 * disagrees with its invoice by a cent is one the owner's bookkeeper sends
 * back.
 */
const BILLING_SQL = readFileSync("drizzle/0335_job_billing.sql", "utf8");

describe("progress billing", () => {
  it("MIRRORS the status CHECK constraint", () => {
    const m = BILLING_SQL.match(/job_pay_applications_status_valid[^(]*\(([^)]*)\)/);
    expect(m, "constraint not found").not.toBeNull();
    const inSql = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(inSql.sort()).toEqual([...PAY_APPLICATION_STATUSES].sort());
  });

  it("keeps retainage between nothing and everything, in the database too", () => {
    expect(BILLING_SQL).toMatch(/retainage_ppm" >= 0 and "job_pay_applications"."retainage_ppm" <= 1000000/);
    expect(RETAINAGE_PPM_MAX).toBe(1_000_000);
  });

  it("makes an issued application an invoice and a draft not one, both ways", () => {
    expect(BILLING_SQL).toMatch(/job_pay_applications_issued_has_invoice/);
    expect(BILLING_SQL).toMatch(/= 'draft'\) = \("job_pay_applications"."invoice_id" is null\)/);
  });

  it("lets a period's work go negative but never a line's total to date", () => {
    // An earlier over-billing is corrected on the next application; a line
    // cannot be less than nothing complete.
    expect(BILLING_SQL).not.toMatch(/this_period_cents" >= 0/);
    expect(BILLING_SQL).toMatch(/job_pay_application_lines_completed_nonnegative/);
  });

  it("holds a billed schedule line and a voided invoice by RESTRICT", () => {
    expect(BILLING_SQL).toMatch(/job_pay_application_lines_sov_fk[^;]*ON DELETE no action/);
    expect(BILLING_SQL).toMatch(/job_pay_applications_invoice_fk[^;]*ON DELETE no action/);
  });

  it("gives every status a label and has no paid one — that is the invoice's word", () => {
    for (const s of PAY_APPLICATION_STATUSES) expect(PAY_APPLICATION_STATUS_LABELS[s]).toBeTruthy();
    expect(PAY_APPLICATION_STATUSES).not.toContain("paid");
    expect(isPayApplicationStatus("issued")).toBe(true);
    expect(isPayApplicationStatus("paid")).toBe(false);
  });

  describe("the G702 arithmetic", () => {
    const lines = [
      { sovLineId: "a", scheduledCents: 100_000_00, previousCents: 40_000_00, thisPeriodCents: 10_000_00, storedCents: 5_000_00 },
      { sovLineId: "b", scheduledCents: 50_000_00, previousCents: 0, thisPeriodCents: 25_000_00, storedCents: 0 },
    ];

    it("adds the columns the way the form does", () => {
      const t = payApplicationTotals(lines, 100_000, 36_000_00);
      expect(t.scheduledCents).toBe(150_000_00);
      expect(t.completedToDateCents).toBe(80_000_00);
      expect(t.retainageCents).toBe(8_000_00);
      expect(t.earnedLessRetainageCents).toBe(72_000_00);
      expect(t.previousCertificatesCents).toBe(36_000_00);
      expect(t.dueCents).toBe(36_000_00);
      expect(t.balanceToFinishCents).toBe(70_000_00);
    });

    it("rounds retainage ONCE, on the total, half up", () => {
      // 7.5% of $1,234.57 = $92.59275 → $92.59; on the total, not per line.
      expect(retainageCents(123_457, 75_000)).toBe(9_259);
      expect(retainageCents(1, 500_000)).toBe(1); // half a cent rounds up
      expect(retainageCents(0, 100_000)).toBe(0);
      expect(retainageCents(100, 0)).toBe(0);
    });

    it("releases retainage when the rate falls: due goes UP by what was held", () => {
      const final = payApplicationTotals(
        [{ sovLineId: "a", scheduledCents: 100_000_00, previousCents: 100_000_00, thisPeriodCents: 0, storedCents: 0 }],
        0,
        90_000_00, // the previous certificate held 10%
      );
      expect(final.retainageCents).toBe(0);
      expect(final.dueCents).toBe(10_000_00);
    });

    it("lets a negative period correct an over-billing", () => {
      const t = payApplicationTotals(
        [{ sovLineId: "a", scheduledCents: 10_000_00, previousCents: 6_000_00, thisPeriodCents: -1_000_00, storedCents: 0 }],
        0,
        6_000_00,
      );
      expect(t.completedToDateCents).toBe(5_000_00);
      expect(t.dueCents).toBe(-1_000_00); // nothing to invoice; the ops refuse it
    });

    it("reads percent complete to one decimal and says nothing for a worthless line", () => {
      expect(percentComplete(55_000_00, 80_000_00)).toBe(68.8);
      expect(percentComplete(0, 0)).toBeNull();
      expect(lineCompletedCents({ previousCents: 1, thisPeriodCents: 2, storedCents: 3 })).toBe(6);
    });

    it("turns a percent box into parts per million and back without drift", () => {
      expect(percentStringToPpm("10")).toBe(100_000);
      expect(percentStringToPpm("7.5")).toBe(75_000);
      expect(percentStringToPpm("7.5%")).toBe(75_000);
      expect(percentStringToPpm("0")).toBe(0);
      expect(percentStringToPpm("100")).toBe(1_000_000);
      expect(percentStringToPpm("101")).toBeNull();
      expect(percentStringToPpm("ten")).toBeNull();
      expect(ppmToPercentString(100_000)).toBe("10");
      expect(ppmToPercentString(75_000)).toBe("7.5");
      expect(ppmToPercentString(0)).toBe("0");
    });
  });
});
