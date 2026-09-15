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
  DAILY_LOG_ENTITY,
  DELIVERY_METHOD_FORMAT,
  PROJECT_ENTITY,
  hoursToTenths,
  tenthsToHours,
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
  OVERBILLING_ACCOUNT_CODE,
  UNDERBILLING_ACCOUNT_CODE,
  WIP_ENTRY_SOURCE,
  WIP_REASONS,
  WIP_REASON_LABELS,
  WIP_STATUSES,
  WIP_STATUS_LABELS,
  isWipStatus,
  COST_PLUS_METHODS,
  FEE_PPM_MAX,
  FIXED_VALUE_METHODS,
  UNBILLED_METHODS,
  WIP_METHODS,
  WIP_METHOD_LABELS,
  isCostPlusMethod,
  isFixedValueMethod,
  TIME_AND_MATERIALS_METHODS,
  UNIT_PRICE_METHODS,
  billsTheLedger,
  isUnitPriceMethod,
  isTimeAndMaterialsMethod,
  RETAINAGE_PAYABLE_CODE,
  SUBCONTRACT_EXPENSE_CODES,
  SUB_APPLICATION_STATUSES,
  SUB_APPLICATION_STATUS_LABELS,
  isSubApplicationStatus,
} from "../src/packs/jobs/vocabulary";
import {
  WIP_PPM,
  earnedCents,
  percentCompletePpm,
  wipFigures,
  wipPercentLabel,
  wipTotals,
  costPlusFeeCents,
} from "../src/packs/jobs/wip-math";
import { CONSTRUCTION_COA } from "../src/industries/construction/accounts";
import {
  lineCompletedCents,
  payApplicationTotals,
  percentComplete,
  percentStringToPpm,
  ppmToPercentString,
  retainageCents,
  costLineToDateCents,
  costPlusTotals,
  feeCents,
  hoursStringToMinutes,
  laborLineCents,
  minutesToHoursString,
  formatQuantity,
  quantityStringToThousandths,
  thousandthsToQuantityString,
  unitLineCents,
} from "../src/packs/jobs/billing-math";
import { GENERAL_COA } from "../src/modules/accounting/templates/general";
import { packRegistry } from "../src/packs";
import { describeProject, findProjects, type OpenProject } from "../src/packs/jobs/tell/find";

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

/**
 * The field. Two CHECKs a form could quietly disagree with, one unique index
 * that is the whole design (one report per day), and the search behind
 * "which job" — pure, because choosing the wrong house is the failure that
 * matters and it should be pinned without a database.
 */
const FIELD_SQL = readFileSync("drizzle/0337_job_field.sql", "utf8");

describe("the field", () => {
  it("keeps ONE report per job per day, in the database", () => {
    expect(FIELD_SQL).toMatch(/job_daily_logs_project_date_idx[^;]*\("tenant_id","project_id","log_date"\)/);
  });

  it("refuses a crew line that names neither a trade nor a subcontractor, and negative counts", () => {
    expect(FIELD_SQL).toMatch(/job_daily_log_crews_named/);
    expect(FIELD_SQL).toMatch(/job_daily_log_crews_workers_nonnegative/);
    expect(FIELD_SQL).toMatch(/job_daily_log_crews_hours_nonnegative/);
  });

  it("holds a subcontractor named on a day by RESTRICT, and takes the day with the job", () => {
    expect(FIELD_SQL).toMatch(/job_daily_log_crews_party_fk[^;]*ON DELETE no action/);
    expect(FIELD_SQL).toMatch(/job_daily_logs_project_fk[^;]*ON DELETE cascade/);
  });

  it("names the two Layer 0 rows it hangs things on, and nothing else", () => {
    expect(DAILY_LOG_ENTITY).toBe("job_daily_log");
    expect(PROJECT_ENTITY).toBe("project");
  });

  it("turns hours into tenths and back without drift", () => {
    expect(hoursToTenths("8")).toBe(80);
    expect(hoursToTenths("6.5")).toBe(65);
    expect(hoursToTenths("")).toBe(0);
    expect(hoursToTenths("6h")).toBeNull();
    expect(hoursToTenths("-1")).toBeNull();
    expect(tenthsToHours(80)).toBe("8");
    expect(tenthsToHours(65)).toBe("6.5");
  });

  describe("which job those words mean", () => {
    const jobs: OpenProject[] = [
      { value: "a", number: "24-108", name: "Oak Row residence", address: "118 Oak Row", deliveryMethod: "luxury_custom" },
      { value: "b", number: "24-112", name: "Miller house", address: "4 Mill Lane", deliveryMethod: null },
      { value: "c", number: "Lot 12", name: "Lot 12", address: "Meadowbrook phase 2", deliveryMethod: "production_residential" },
      { value: "d", number: "Lot 13", name: "Lot 13", address: "Meadowbrook phase 2", deliveryMethod: "production_residential" },
    ];
    const ids = (said: string) => findProjects(jobs, said).map((c) => c.value);

    it("finds a job by its number first", () => {
      expect(ids("24-108")).toEqual(["a"]);
      expect(ids("at 24-112 today")).toEqual(["b"]);
    });

    it("then by its name, then by its street", () => {
      expect(ids("the Miller house")).toEqual(["b"]);
      expect(ids("at Oak Row")).toEqual(["a"]);
    });

    it("never picks the nearest lot — Lot 12 is not Lot 13", () => {
      expect(ids("lot 12")).toEqual(["c"]);
      expect(ids("lot 13")).toEqual(["d"]);
    });

    it("offers everything rather than nothing when the words match no job", () => {
      expect(ids("the place with the dog")).toEqual(["a", "b", "c", "d"]);
      expect(ids("")).toEqual(["a", "b", "c", "d"]);
    });

    it("describes a job by the things that tell it from its neighbours", () => {
      expect(describeProject(jobs[0])).toBe("24-108 · Luxury custom · 118 Oak Row");
      expect(describeProject(jobs[1])).toBe("24-112 · 4 Mill Lane");
    });
  });
});

/*
 * ── work in progress (slice 6) ─────────────────────────────────────────────
 *
 * The one-schedule-per-company-per-date index, the posted↔entry CHECK, the
 * journal source the entries carry, and the arithmetic — pinned case by case,
 * because a percent that rounds the wrong way is a revenue figure a bank
 * reads.
 */
const WIP_SQL = readFileSync("drizzle/0339_job_wip.sql", "utf8");

describe("work in progress", () => {
  it("keeps ONE schedule per company per date, and one line per job on it, in the database", () => {
    expect(WIP_SQL).toMatch(
      /job_wip_periods_entity_period_idx[^;]*\("tenant_id","entity_id","period_end"\)/,
    );
    expect(WIP_SQL).toMatch(
      /job_wip_lines_period_project_idx[^;]*\("tenant_id","period_id","project_id"\)/,
    );
  });

  it("makes a posted period an entry and a draft not one, both ways, and a reversal need its adjustment", () => {
    expect(WIP_SQL).toMatch(
      /job_wip_periods_posted_has_entry" CHECK \(\("job_wip_periods"\."status" = 'posted'\) = \("job_wip_periods"\."entry_id" is not null\)\)/,
    );
    expect(WIP_SQL).toMatch(/job_wip_periods_reversal_needs_entry/);
  });

  it("MIRRORS the status and reason CHECK constraints", () => {
    expect(WIP_SQL).toContain(
      `CHECK ("job_wip_periods"."status" in (${WIP_STATUSES.map((s) => `'${s}'`).join(", ")}))`,
    );
    expect(WIP_SQL).toContain(
      `CHECK ("job_wip_lines"."reason" in ('', 'no_value', 'no_estimate'))`,
    );
  });

  it("holds the company and both entries by RESTRICT, and takes the lines with the period and with the job", () => {
    expect(WIP_SQL).toMatch(/job_wip_periods_entity_fk[^;]*ON DELETE no action/);
    expect(WIP_SQL).toMatch(/job_wip_periods_entry_fk[^;]*ON DELETE no action/);
    expect(WIP_SQL).toMatch(/job_wip_periods_reversal_fk[^;]*ON DELETE no action/);
    expect(WIP_SQL).toMatch(/job_wip_lines_period_fk[^;]*ON DELETE cascade/);
    expect(WIP_SQL).toMatch(/job_wip_lines_project_fk[^;]*ON DELETE cascade/);
  });

  it("adds the journal source both entries carry, before anything else, and nothing in the file uses it", () => {
    expect(WIP_SQL).toContain(
      `ALTER TYPE "public"."journal_entry_source" ADD VALUE '${WIP_ENTRY_SOURCE}'`,
    );
    expect(WIP_SQL.indexOf("ADD VALUE")).toBeLessThan(WIP_SQL.indexOf("CREATE TABLE"));
    expect(WIP_SQL.split(`'${WIP_ENTRY_SOURCE}'`).length - 1).toBe(1);
  });

  it("keeps an estimate non-negative and a percent between nothing and everything", () => {
    expect(WIP_SQL).toMatch(/job_wip_lines_estimate_nonnegative/);
    expect(WIP_SQL).toMatch(/job_wip_lines_percent_range" CHECK \([^)]*between 0 and 1000000\)/);
  });

  it("gives every status and reason a label, and posts to the two accounts the construction profile seeds", () => {
    for (const s of WIP_STATUSES) expect(WIP_STATUS_LABELS[s].length).toBeGreaterThan(0);
    expect(WIP_REASON_LABELS[""]).toBe("");
    expect(WIP_REASON_LABELS.no_value.length).toBeGreaterThan(0);
    expect(WIP_REASON_LABELS.no_estimate.length).toBeGreaterThan(0);
    expect(isWipStatus("posted")).toBe(true);
    expect(isWipStatus("issued")).toBe(false);
    const under = CONSTRUCTION_COA.accounts.find((a) => a.code === UNDERBILLING_ACCOUNT_CODE);
    const over = CONSTRUCTION_COA.accounts.find((a) => a.code === OVERBILLING_ACCOUNT_CODE);
    expect(under?.type).toBe("asset");
    expect(over?.type).toBe("liability");
  });

  describe("the arithmetic", () => {
    it("percent complete is cost over estimate, truncated, capped at 100, and null with nothing to measure", () => {
      expect(percentCompletePpm(40_000_00, 80_000_00)).toBe(500_000);
      expect(percentCompletePpm(1, 3)).toBe(333_333);
      expect(percentCompletePpm(90_000_00, 80_000_00)).toBe(WIP_PPM);
      expect(percentCompletePpm(0, 80_000_00)).toBe(0);
      expect(percentCompletePpm(10_000_00, 0)).toBeNull();
      // A finished job is done whatever its cost says.
      expect(percentCompletePpm(10_000_00, 0, true)).toBe(WIP_PPM);
      expect(percentCompletePpm(10_000_00, 80_000_00, true)).toBe(WIP_PPM);
    });

    it("earned is the contract at that percent, rounded half up, and survives a ten-figure contract", () => {
      expect(earnedCents(100_000_00, 500_000)).toBe(50_000_00);
      expect(earnedCents(100_000_00, 333_333)).toBe(33_333_30);
      expect(earnedCents(1, 500_000)).toBe(1);
      // $1,000,000,000 × 33.3333%: the product passes 2^53 and must not lose cents.
      expect(earnedCents(1_000_000_000_00, 333_333)).toBe(333_333_000_00);
      expect(earnedCents(100_000_00, null)).toBe(0);
      expect(earnedCents(100_000_00, 0)).toBe(0);
      expect(earnedCents(100_000_00, WIP_PPM)).toBe(100_000_00);
    });

    it("splits under and over, never nets them, and reads a job that cost more than planned as done", () => {
      const under = wipFigures({
        contractCents: 100_000_00,
        estimatedCostCents: 80_000_00,
        costToDateCents: 40_000_00,
        billedCents: 30_000_00,
      });
      expect(under.percentCompletePpm).toBe(500_000);
      expect(under.earnedCents).toBe(50_000_00);
      expect(under.underBilledCents).toBe(20_000_00);
      expect(under.overBilledCents).toBe(0);
      expect(under.overUnderCents).toBe(20_000_00);
      expect(under.grossProfitToDateCents).toBe(10_000_00);
      expect(under.estimatedGrossProfitCents).toBe(20_000_00);
      expect(under.costToCompleteCents).toBe(40_000_00);
      expect(under.backlogCents).toBe(50_000_00);

      const over = wipFigures({
        contractCents: 100_000_00,
        estimatedCostCents: 80_000_00,
        costToDateCents: 16_000_00,
        billedCents: 30_000_00,
      });
      expect(over.percentCompletePpm).toBe(200_000);
      expect(over.earnedCents).toBe(20_000_00);
      expect(over.underBilledCents).toBe(0);
      expect(over.overBilledCents).toBe(10_000_00);

      const blown = wipFigures({
        contractCents: 100_000_00,
        estimatedCostCents: 80_000_00,
        costToDateCents: 95_000_00,
        billedCents: 100_000_00,
      });
      expect(blown.percentCompletePpm).toBe(WIP_PPM);
      expect(blown.earnedCents).toBe(100_000_00);
      expect(blown.overUnderCents).toBe(0);
      expect(blown.grossProfitToDateCents).toBe(5_000_00);
      expect(blown.costToCompleteCents).toBe(0);

      const unmeasured = wipFigures({
        contractCents: 100_000_00,
        estimatedCostCents: 0,
        costToDateCents: 5_000_00,
        billedCents: 0,
      });
      expect(unmeasured.percentCompletePpm).toBeNull();
      expect(unmeasured.earnedCents).toBe(0);

      const totals = wipTotals([under, over]);
      expect(totals.underBilledCents).toBe(20_000_00);
      expect(totals.overBilledCents).toBe(10_000_00);
      expect(totals.earnedCents).toBe(70_000_00);
      expect(totals.billedCents).toBe(60_000_00);
      expect(totals.grossProfitToDateCents).toBe(14_000_00);
    });

    it("labels a percent to one decimal and says nothing for a job it cannot measure", () => {
      expect(wipPercentLabel(500_000)).toBe("50");
      expect(wipPercentLabel(333_333)).toBe("33.3");
      expect(wipPercentLabel(WIP_PPM)).toBe("100");
      expect(wipPercentLabel(0)).toBe("0");
      expect(wipPercentLabel(null)).toBe("—");
    });
  });
});

/*
 * ── cost plus a fee (slice 5b, ADR 0060) ───────────────────────────────────
 *
 * The contract's terms and the application's two halves as CHECKs and
 * columns, the cost lines' table, and the certificate arithmetic pinned line
 * by line — a fee rounded twice is a certificate the owner's bookkeeper sends
 * back, same as retainage.
 */
const COST_PLUS_SQL = readFileSync("drizzle/0341_cost_plus.sql", "utf8");
const TM_SQL = readFileSync("drizzle/0345_time_and_materials.sql", "utf8");
const UNIT_PRICE_SQL = readFileSync("drizzle/0347_unit_price.sql", "utf8");

describe("cost plus a fee", () => {
  it("adds the three terms to the contract, nullable, with their floors", () => {
    expect(COST_PLUS_SQL).toMatch(/ALTER TABLE "job_contracts" ADD COLUMN "fee_ppm" integer;/);
    expect(COST_PLUS_SQL).toMatch(/ALTER TABLE "job_contracts" ADD COLUMN "fee_cents" bigint;/);
    expect(COST_PLUS_SQL).toMatch(/ALTER TABLE "job_contracts" ADD COLUMN "gmax_cents" bigint;/);
    expect(COST_PLUS_SQL).toMatch(/job_contracts_fee_ppm_range[^;]*<= 1000000/);
    expect(COST_PLUS_SQL).toMatch(/job_contracts_fee_nonnegative/);
    expect(COST_PLUS_SQL).toMatch(/job_contracts_gmax_nonnegative/);
    expect(FEE_PPM_MAX).toBe(1_000_000);
  });

  it("gives an application its two halves, zero on every fixed-price one", () => {
    expect(COST_PLUS_SQL).toMatch(/"job_pay_applications" ADD COLUMN "cost_to_date_cents" bigint DEFAULT 0 NOT NULL/);
    expect(COST_PLUS_SQL).toMatch(/"job_pay_applications" ADD COLUMN "fee_to_date_cents" bigint DEFAULT 0 NOT NULL/);
  });

  it("keeps ONE cost line per code per application, takes them with the application, and holds a billed code", () => {
    expect(COST_PLUS_SQL).toMatch(
      /job_pay_application_costs_app_code_idx[^;]*\("tenant_id","pay_application_id","cost_code_id"\)/,
    );
    expect(COST_PLUS_SQL).toMatch(/job_pay_application_costs_app_fk[^;]*ON DELETE cascade/);
    expect(COST_PLUS_SQL).toMatch(/job_pay_application_costs_code_fk[^;]*ON DELETE no action/);
    // The no-code line is a NULL code, so the column is nullable.
    expect(COST_PLUS_SQL).toMatch(/"cost_code_id" uuid,/);
  });

  it("records HOW a WIP line was measured: two ways then, three since time and materials", () => {
    expect(COST_PLUS_SQL).toContain(`CHECK ("job_wip_lines"."method" in ('cost_to_cost', 'cost_plus'))`);
    expect(TM_SQL).toContain(
      `CHECK ("job_wip_lines"."method" in (${WIP_METHODS.map((m) => `'${m}'`).join(", ")}))`,
    );
    for (const m of WIP_METHODS) expect(WIP_METHOD_LABELS[m].length).toBeGreaterThan(0);
  });

  it("sorts every billing method into exactly one group", () => {
    // Unit price is a schedule method AND its own group: the schedule has units, so both lists name it.
    const all = [
      ...FIXED_VALUE_METHODS,
      ...COST_PLUS_METHODS,
      ...TIME_AND_MATERIALS_METHODS,
      ...UNBILLED_METHODS,
    ].sort();
    expect(all).toEqual([...BILLING_METHODS].sort());
    expect(isTimeAndMaterialsMethod("time_and_materials")).toBe(true);
    expect(billsTheLedger("time_and_materials")).toBe(true);
    expect(billsTheLedger("cost_plus_fee")).toBe(true);
    expect(billsTheLedger("unit_price")).toBe(false);
    // Every method bills since 5f.
    expect(UNBILLED_METHODS).toEqual([]);
    expect(UNIT_PRICE_METHODS).toEqual(["unit_price"]);
    expect(isUnitPriceMethod("unit_price")).toBe(true);
    expect(isFixedValueMethod("unit_price")).toBe(true);
    expect(isCostPlusMethod("cost_plus_fee")).toBe(true);
    expect(isCostPlusMethod("fixed_price")).toBe(false);
    expect(isFixedValueMethod("draw_schedule")).toBe(true);
    // Unit price bills against a schedule too, since 5f.
    expect(isFixedValueMethod("unit_price")).toBe(true);
  });

  describe("the certificate arithmetic", () => {
    const lines = [
      { costCodeId: "a", ledgerToDateCents: 40_000_00, previousCents: 0, thisPeriodCents: 40_000_00 },
      { costCodeId: null, ledgerToDateCents: 2_000_00, previousCents: 0, thisPeriodCents: 2_000_00 },
    ];

    it("puts the fee on the TOTAL cost, rounded once", () => {
      expect(feeCents(42_000_00, 150_000)).toBe(6_300_00);
      expect(feeCents(1, 150_000)).toBe(0); // 0.15 of a cent rounds to nothing
      expect(feeCents(3, 150_000)).toBe(0); // 0.45
      expect(feeCents(4, 150_000)).toBe(1); // 0.60 rounds up
      expect(feeCents(42_000_00, null)).toBe(0);
      expect(feeCents(-5_00, 150_000)).toBe(0); // a net credit earns no fee
    });

    it("cost plus a percentage fee, less retainage, less previous, is what is due", () => {
      const t = costPlusTotals(lines, { feePpm: 150_000, feeCents: null, gmaxCents: null }, 0, 100_000, 0);
      expect(t.costToDateCents).toBe(42_000_00);
      expect(t.feeToDateCents).toBe(6_300_00);
      expect(t.completedToDateCents).toBe(48_300_00);
      expect(t.retainageCents).toBe(4_830_00);
      expect(t.earnedLessRetainageCents).toBe(43_470_00);
      expect(t.dueCents).toBe(43_470_00);
      expect(t.capped).toBe(false);
      expect(t.scheduledCents).toBe(0);
      expect(t.balanceToFinishCents).toBe(0);
    });

    it("a fixed fee is what was typed, never more than the fee itself, and may sit beside a percentage", () => {
      const fixed = costPlusTotals(lines, { feePpm: null, feeCents: 10_000_00, gmaxCents: null }, 2_500_00, 0, 0);
      expect(fixed.feeToDateCents).toBe(2_500_00);
      const over = costPlusTotals(lines, { feePpm: null, feeCents: 10_000_00, gmaxCents: null }, 99_000_00, 0, 0);
      expect(over.feeToDateCents).toBe(10_000_00);
      const both = costPlusTotals(lines, { feePpm: 100_000, feeCents: 10_000_00, gmaxCents: null }, 2_500_00, 0, 0);
      expect(both.feeToDateCents).toBe(4_200_00 + 2_500_00);
      // A contract with no fixed fee ignores a typed one.
      const none = costPlusTotals(lines, { feePpm: 100_000, feeCents: null, gmaxCents: null }, 2_500_00, 0, 0);
      expect(none.feeToDateCents).toBe(4_200_00);
    });

    it("the guaranteed maximum caps cost plus fee, and says so", () => {
      const t = costPlusTotals(lines, { feePpm: 150_000, feeCents: null, gmaxCents: 45_000_00 }, 0, 0, 0);
      expect(t.completedToDateCents).toBe(45_000_00);
      expect(t.capped).toBe(true);
      expect(t.scheduledCents).toBe(45_000_00);
      expect(t.balanceToFinishCents).toBe(0);
      const under = costPlusTotals(lines, { feePpm: 150_000, feeCents: null, gmaxCents: 100_000_00 }, 0, 0, 0);
      expect(under.capped).toBe(false);
      expect(under.balanceToFinishCents).toBe(51_700_00);
    });

    it("the next application certifies against the last, and a line billed short stays short", () => {
      const next = [
        { costCodeId: "a", ledgerToDateCents: 70_000_00, previousCents: 40_000_00, thisPeriodCents: 25_000_00 },
        { costCodeId: null, ledgerToDateCents: 2_000_00, previousCents: 2_000_00, thisPeriodCents: 0 },
      ];
      const t = costPlusTotals(next, { feePpm: 150_000, feeCents: null, gmaxCents: null }, 0, 100_000, 43_470_00);
      expect(t.costToDateCents).toBe(67_000_00); // 5,000 of the books' 70,000 left unbilled
      expect(t.feeToDateCents).toBe(10_050_00);
      expect(t.completedToDateCents).toBe(77_050_00);
      expect(t.retainageCents).toBe(7_705_00);
      expect(t.dueCents).toBe(77_050_00 - 7_705_00 - 43_470_00);
      expect(costLineToDateCents(next[0])).toBe(65_000_00);
    });
  });

  describe("work in progress on a cost-plus job", () => {
    it("earns cost plus the fee, capped at the maximum, and needs no estimate", () => {
      const f = wipFigures({
        contractCents: 0,
        estimatedCostCents: 0,
        costToDateCents: 40_000_00,
        billedCents: 30_000_00,
        costPlus: { feePpm: 150_000, feeCents: null, gmaxCents: null },
      });
      expect(f.percentCompletePpm).toBeNull();
      expect(f.earnedCents).toBe(46_000_00);
      expect(f.underBilledCents).toBe(16_000_00);
      const capped = wipFigures({
        contractCents: 0,
        estimatedCostCents: 0,
        costToDateCents: 40_000_00,
        billedCents: 30_000_00,
        costPlus: { feePpm: 150_000, feeCents: 5_000_00, gmaxCents: 45_000_00 },
      });
      expect(capped.earnedCents).toBe(45_000_00);
      expect(costPlusFeeCents(40_000_00, 150_000)).toBe(6_000_00);
    });
  });
});

/*
 * ── subcontractor applications (slice 5c, ADR 0061) ────────────────────────
 *
 * The payable-side mirror: the same CHECKs as a pay application's, a bill
 * where an invoice was, the subcontract line held by RESTRICT.
 */
const SUB_BILLING_SQL = readFileSync("drizzle/0343_sub_billing.sql", "utf8");

describe("subcontractor applications", () => {
  it("MIRRORS the status CHECK constraint, with billed where issued was", () => {
    const m = SUB_BILLING_SQL.match(/job_sub_applications_status_valid[^(]*\(([^)]*)\)/);
    expect(m, "constraint not found").not.toBeNull();
    const inSql = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(inSql.sort()).toEqual([...SUB_APPLICATION_STATUSES].sort());
    for (const s of SUB_APPLICATION_STATUSES) expect(SUB_APPLICATION_STATUS_LABELS[s].length).toBeGreaterThan(0);
    expect(isSubApplicationStatus("billed")).toBe(true);
    expect(isSubApplicationStatus("issued")).toBe(false);
  });

  it("makes a billed application a bill and a draft not one, both ways", () => {
    expect(SUB_BILLING_SQL).toMatch(/job_sub_applications_billed_has_bill/);
    expect(SUB_BILLING_SQL).toMatch(/= 'draft'\) = \("job_sub_applications"."bill_id" is null\)/);
    expect(SUB_BILLING_SQL).toMatch(/job_sub_applications_bill_fk[^;]*REFERENCES "public"."bills"[^;]*ON DELETE no action/);
  });

  it("keeps retainage between nothing and everything, numbers per subcontract, and floors a line's total", () => {
    expect(SUB_BILLING_SQL).toMatch(/retainage_ppm" >= 0 and "job_sub_applications"."retainage_ppm" <= 1000000/);
    expect(SUB_BILLING_SQL).toMatch(/job_sub_applications_commitment_number_idx[^;]*\("tenant_id","commitment_id","number"\)/);
    expect(SUB_BILLING_SQL).toMatch(/job_sub_application_lines_completed_nonnegative/);
    expect(SUB_BILLING_SQL).not.toMatch(/this_period_cents" >= 0/);
  });

  it("holds a billed subcontract line by RESTRICT and takes the lines with the application", () => {
    expect(SUB_BILLING_SQL).toMatch(/job_sub_application_lines_commitment_line_fk[^;]*ON DELETE no action/);
    expect(SUB_BILLING_SQL).toMatch(/job_sub_application_lines_app_fk[^;]*ON DELETE cascade/);
    expect(SUB_BILLING_SQL).toMatch(/job_sub_applications_commitment_fk[^;]*ON DELETE cascade/);
  });

  it("posts to the general chart's subcontract expense and the profile's retainage payable", () => {
    expect(SUBCONTRACT_EXPENSE_CODES).toEqual(["5100"]);
    expect(RETAINAGE_PAYABLE_CODE).toBe("2120");
    const seeded = CONSTRUCTION_COA.accounts.find((a) => a.code === RETAINAGE_PAYABLE_CODE);
    expect(seeded?.type).toBe("liability");
    // 5100 is deliberately NOT the construction profile's: the general chart has it.
    expect(CONSTRUCTION_COA.accounts.some((a) => a.code === "5100")).toBe(false);
  });
});

// ------------------------------------------------------ time and materials

describe("time and materials", () => {
  it("adds one rate for everybody to the contract, labour to date to the application, and a line table keyed by person and rate", () => {
    expect(TM_SQL).toMatch(/ALTER TABLE "job_contracts" ADD COLUMN "labor_rate_cents" integer;/);
    expect(TM_SQL).toMatch(/job_contracts_labor_rate_nonnegative/);
    expect(TM_SQL).toMatch(/"job_pay_applications" ADD COLUMN "labor_to_date_cents" bigint DEFAULT 0 NOT NULL/);
    expect(TM_SQL).toMatch(
      /job_pay_application_labor_app_worker_rate_idx[^;]*\("tenant_id","pay_application_id","worker_id","rate_cents"\)/,
    );
    expect(TM_SQL).toMatch(/job_pay_application_labor_app_fk[^;]*ON DELETE cascade/);
    // RESTRICT to Time's worker: a person with billed hours is deactivated, never deleted.
    expect(TM_SQL).toMatch(
      /job_pay_application_labor_worker_fk[^;]*REFERENCES "public"."time_workers"\("tenant_id","id"\) ON DELETE no action/,
    );
    expect(TM_SQL).toMatch(/job_pay_application_labor_rate_nonnegative/);
    expect(TM_SQL).toMatch(/job_pay_application_labor_to_date_nonnegative/);
    // No rate is a rate of nothing, so the key is never null.
    expect(TM_SQL).toMatch(/"rate_cents" integer DEFAULT 0 NOT NULL/);
  });

  it("widens the WIP reasons to an hour with no rate", () => {
    expect(TM_SQL).toContain(
      `CHECK ("job_wip_lines"."reason" in (${WIP_REASONS.map((r) => `'${r}'`).join(", ")}))`,
    );
    expect(WIP_REASON_LABELS.no_rate.length).toBeGreaterThan(0);
    expect(WIP_METHOD_LABELS.time_and_materials).toBe("Time and materials");
  });

  it("bills minutes at a rate, rounded once per line, and credits them back the same way", () => {
    expect(laborLineCents(60, 65_00)).toBe(65_00);
    expect(laborLineCents(600, 65_00)).toBe(650_00);
    expect(laborLineCents(90, 65_00)).toBe(97_50);
    expect(laborLineCents(1, 65_00)).toBe(108); // 108.33
    expect(laborLineCents(1, 6_50)).toBe(11); // 10.83 rounds up
    expect(laborLineCents(-30, 70_00)).toBe(-35_00);
    expect(laborLineCents(600, 0)).toBe(0);
    expect(laborLineCents(0, 65_00)).toBe(0);
  });

  it("reads hours the way a person types them, and writes them back the same", () => {
    expect(hoursStringToMinutes("12.5")).toBe(750);
    expect(hoursStringToMinutes(" 7 ")).toBe(420);
    expect(hoursStringToMinutes("")).toBe(0);
    expect(hoursStringToMinutes("0.33")).toBe(20);
    expect(hoursStringToMinutes("ten")).toBeNull();
    expect(minutesToHoursString(750)).toBe("12.5");
    expect(minutesToHoursString(30)).toBe("0.5");
    expect(minutesToHoursString(45)).toBe("0.75");
    expect(minutesToHoursString(20)).toBe("0.33");
    expect(minutesToHoursString(0)).toBe("0");
    expect(minutesToHoursString(600)).toBe("10");
  });

  it("labour plus cost plus a markup on the cost alone, capped at the not-to-exceed, less retainage, less previous", () => {
    const lines = [{ costCodeId: "a", ledgerToDateCents: 2_000_00, previousCents: 0, thisPeriodCents: 2_000_00 }];
    const t = costPlusTotals(lines, { feePpm: 100_000, feeCents: null, gmaxCents: null }, 0, 100_000, 0, 770_00);
    expect(t.laborToDateCents).toBe(770_00);
    expect(t.costToDateCents).toBe(2_000_00);
    expect(t.feeToDateCents).toBe(200_00); // on the cost, never on the hours
    expect(t.completedToDateCents).toBe(2_970_00);
    expect(t.retainageCents).toBe(297_00);
    expect(t.dueCents).toBe(2_673_00);
    // Without the argument the arithmetic is cost plus a fee, unchanged.
    expect(costPlusTotals(lines, { feePpm: 100_000, feeCents: null, gmaxCents: null }, 0, 0, 0).laborToDateCents).toBe(0);
    const capped = costPlusTotals(lines, { feePpm: 100_000, feeCents: null, gmaxCents: 2_500_00 }, 0, 0, 0, 770_00);
    expect(capped.completedToDateCents).toBe(2_500_00);
    expect(capped.capped).toBe(true);
    expect(capped.balanceToFinishCents).toBe(0);
  });

  it("on the work in progress schedule, hours earn at their rates and the wages they cover are not marked up", () => {
    const f = wipFigures({
      contractCents: 0,
      estimatedCostCents: 0,
      costToDateCents: 2_500_00,
      billedCents: 0,
      costPlus: { feePpm: 100_000, feeCents: null, gmaxCents: null },
      labor: { billableCents: 650_00, costCents: 500_00 },
    });
    expect(f.earnedCents).toBe(2_850_00);
    expect(f.grossProfitToDateCents).toBe(350_00);
    expect(f.percentCompletePpm).toBeNull();
    // A not-to-exceed caps the lot.
    const capped = wipFigures({
      contractCents: 0,
      estimatedCostCents: 0,
      costToDateCents: 2_500_00,
      billedCents: 0,
      costPlus: { feePpm: 100_000, feeCents: null, gmaxCents: 2_600_00 },
      labor: { billableCents: 650_00, costCents: 500_00 },
    });
    expect(capped.earnedCents).toBe(2_600_00);
    // Wages beyond the cost to date (a lag in posting) never make the marked-up cost negative.
    const lag = wipFigures({
      contractCents: 0,
      estimatedCostCents: 0,
      costToDateCents: 300_00,
      billedCents: 0,
      costPlus: { feePpm: 100_000, feeCents: null, gmaxCents: null },
      labor: { billableCents: 650_00, costCents: 500_00 },
    });
    expect(lag.earnedCents).toBe(650_00);
  });

  it("the wages accounts are the ones the accrual posts to, told apart by subtype", () => {
    const source = readFileSync("src/lib/labor-posting.ts", "utf8");
    expect(source).toMatch(/export const LABOR_EXPENSE_SUBTYPE = "payroll_expense"/);
    for (const code of ["6450", "6500"]) {
      expect(GENERAL_COA.accounts.find((a) => a.code === code)?.subtype).toBe("payroll_expense");
    }
    // The construction chart's job-cost accounts are NOT of it: they are marked up.
    expect(CONSTRUCTION_COA.accounts.find((a) => a.code === "5200")?.subtype).not.toBe("payroll_expense");
  });
});

// --------------------------------------------------------------- unit price

describe("unit price", () => {
  it("adds the unit, the estimate and the price to a schedule line, both or neither, and quantities to an application line", () => {
    expect(UNIT_PRICE_SQL).toMatch(/"job_sov_lines" ADD COLUMN "unit" text DEFAULT '' NOT NULL/);
    expect(UNIT_PRICE_SQL).toMatch(/"job_sov_lines" ADD COLUMN "quantity_thousandths" bigint;/);
    expect(UNIT_PRICE_SQL).toMatch(/"job_sov_lines" ADD COLUMN "unit_price_cents" bigint;/);
    expect(UNIT_PRICE_SQL).toContain(
      `CHECK (("job_sov_lines"."quantity_thousandths" is null) = ("job_sov_lines"."unit_price_cents" is null))`,
    );
    expect(UNIT_PRICE_SQL).toMatch(/job_sov_lines_quantity_nonnegative/);
    expect(UNIT_PRICE_SQL).toMatch(/job_sov_lines_unit_price_nonnegative/);
    expect(UNIT_PRICE_SQL).toMatch(/"job_pay_application_lines" ADD COLUMN "quantity_previous_thousandths" bigint DEFAULT 0 NOT NULL/);
    expect(UNIT_PRICE_SQL).toMatch(/"job_pay_application_lines" ADD COLUMN "quantity_this_period_thousandths" bigint DEFAULT 0 NOT NULL/);
    // A period's quantity may be negative; the quantity to date may not.
    expect(UNIT_PRICE_SQL).toContain(
      `CHECK ("job_pay_application_lines"."quantity_previous_thousandths" + "job_pay_application_lines"."quantity_this_period_thousandths" >= 0)`,
    );
  });

  it("keeps quantities in thousandths, reads them the way a person types them, and prints them with separators", () => {
    expect(quantityStringToThousandths("1,250.5")).toBe(1_250_500);
    expect(quantityStringToThousandths("4")).toBe(4_000);
    expect(quantityStringToThousandths("-5")).toBe(-5_000);
    expect(quantityStringToThousandths("")).toBe(0);
    expect(quantityStringToThousandths("0.0004")).toBe(0); // a fourth decimal rounds away
    expect(quantityStringToThousandths("ten")).toBeNull();
    expect(thousandthsToQuantityString(1_250_500)).toBe("1250.5");
    expect(thousandthsToQuantityString(4_000)).toBe("4");
    expect(thousandthsToQuantityString(333)).toBe("0.333");
    expect(formatQuantity(1_250_500)).toBe("1,250.5");
  });

  it("prices a quantity at a unit price, rounded once per line, and credits a correction at the same price", () => {
    expect(unitLineCents(600_000, 18_00)).toBe(10_800_00); // 600 cy at 18.00
    expect(unitLineCents(800_500, 12_50)).toBe(10_006_25); // 800.5 lf at 12.50
    expect(unitLineCents(1_000, 1_750_00)).toBe(1_750_00); // one each
    expect(unitLineCents(333, 100)).toBe(33); // 0.333 at 1.00 = 33.3 cents
    expect(unitLineCents(500, 100)).toBe(50); // 0.5 at 1.00
    expect(unitLineCents(1, 500)).toBe(1); // 0.001 at 5.00 = half a cent, half up
    expect(unitLineCents(1, 400)).toBe(0); // 0.4 of a cent rounds to nothing
    expect(unitLineCents(-5_000, 18_00)).toBe(-90_00);
    expect(unitLineCents(600_000, 0)).toBe(0);
  });
});
