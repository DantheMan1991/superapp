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
  RATE_PPM_MAX,
  ESTIMATE_STATUSES,
  ESTIMATE_STATUS_LABELS,
  GROUP_PRICE_MODES,
  GROUP_PRICE_MODE_LABELS,
  SCHEDULE_SHAPES,
  isEstimateStatus,
  isGroupPriceMode,
  isScheduleShape,
  PROPOSAL_PRESENTATIONS,
  PROPOSAL_PRESENTATION_LABELS,
  isProposalPresentation,
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
  LIEN_WAIVER_KINDS,
  LIEN_WAIVER_KIND_LABELS,
  LIEN_WAIVER_STATUSES,
  LIEN_WAIVER_STATUS_LABELS,
  LIEN_WAIVER_ENTITY,
  COMMITMENT_ENTITY,
  isFinalWaiver,
  isLienWaiverKind,
  isLienWaiverStatus,
  isUnconditionalWaiver,
  CHOSEN_SELECTION_STATUSES,
  SELECTION_ENTITY,
  SELECTION_STATUSES,
  SELECTION_STATUS_LABELS,
  isSelectionStatus,
  DEFAULT_REQUIRED_PARTY_DOCUMENTS,
  EXPIRING_SOON_DAYS,
  PARTY_DOCUMENT_ENTITY,
  PARTY_DOCUMENT_FORMAT,
  PARTY_DOCUMENT_STATUSES,
  PARTY_DOCUMENT_STATUS_LABELS,
  PARTY_ENTITY,
  SUGGESTED_PARTY_DOCUMENT_KINDS,
  isPartyDocumentKind,
  isPartyDocumentStatus,
  partyDocumentKindLabel,
  requiredPartyDocumentsFrom,
} from "../src/packs/jobs/vocabulary";
import { standingFor } from "../src/packs/jobs/compliance-ops";
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
import {
  estimateByCode,
  estimateTotals,
  groupCostCents,
  groupPriceCents,
  isFixedPrice,
  scheduleRows,
  lineCostCents,
  linePriceCents,
  rateCents,
  rateStringToPpm,
  scheduleFromEstimate,
  spreadCents,
} from "../src/packs/jobs/estimate-math";
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

// ------------------------------------------- subcontract change orders (4b)

/**
 * A change order on a commitment (ADR 0065). The status list and the
 * approval-date rule are the client-side ones, read from the new migration
 * rather than trusted; the money is commitment lines, whose floor gained its
 * one exception; and a subcontractor's application line on a deduction runs
 * backwards, which the database floors on the line's own sign.
 */
const COMMITMENT_CHANGES_SQL = readFileSync("drizzle/0348_commitment_change_orders.sql", "utf8");

describe("subcontract change orders", () => {
  it("MIRRORS the client-side status CHECK: one vocabulary for a change", () => {
    const m = COMMITMENT_CHANGES_SQL.match(/job_commitment_change_orders_status_valid[^(]*\(([^)]*)\)/);
    expect(m, "constraint not found").not.toBeNull();
    const inSql = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(inSql.sort()).toEqual([...CHANGE_ORDER_STATUSES].sort());
  });

  it("makes the approval date part of BEING approved, and numbers per COMMITMENT", () => {
    expect(COMMITMENT_CHANGES_SQL).toMatch(/job_commitment_change_orders_approved_has_date/);
    expect(COMMITMENT_CHANGES_SQL).toMatch(
      /= 'approved'\) = \("job_commitment_change_orders"."approved_on" is not null\)/,
    );
    expect(COMMITMENT_CHANGES_SQL).toMatch(
      /job_commitment_change_orders_commitment_number_idx[^;]*\("tenant_id","commitment_id","number"\)/,
    );
  });

  it("belongs to a COMMITMENT (cascade), passes down a client change order (RESTRICT), and its lines go with it", () => {
    expect(COMMITMENT_CHANGES_SQL).toMatch(/job_commitment_change_orders_commitment_fk[^;]*ON DELETE cascade/);
    expect(COMMITMENT_CHANGES_SQL).toMatch(
      /job_commitment_change_orders_change_order_fk[^;]*REFERENCES "public"."job_change_orders"[^;]*ON DELETE no action/,
    );
    expect(COMMITMENT_CHANGES_SQL).toMatch(/job_commitment_lines_change_order_fk[^;]*ON DELETE cascade/);
  });

  it("keeps a commitment line's floor, with a change's line as the ONE exception", () => {
    // A deductive change is a negative line; an original line is never one.
    expect(COMMITMENT_CHANGES_SQL).toContain(
      `"job_commitment_lines"."amount_cents" >= 0 or "job_commitment_lines"."change_order_id" is not null`,
    );
  });

  it("floors a subcontractor's application line on its schedule's side of zero", () => {
    expect(COMMITMENT_CHANGES_SQL).toContain(
      `"job_sub_application_lines"."previous_cents" >= 0 or "job_sub_application_lines"."scheduled_cents" < 0`,
    );
    expect(COMMITMENT_CHANGES_SQL).toMatch(
      /case when "job_sub_application_lines"."scheduled_cents" < 0 then [^;]* <= 0 else [^;]* >= 0 end/,
    );
  });

  it("reads a deduction's percent complete like any other line's", () => {
    expect(percentComplete(-2_000_00, -2_000_00)).toBe(100);
    expect(percentComplete(-500_00, -2_000_00)).toBe(25);
    expect(percentComplete(0, -2_000_00)).toBe(0);
    expect(percentComplete(0, 0)).toBeNull();
  });
});

// ------------------------------------------------------------ lien waivers (11a)

/**
 * A lien waiver is a record, never a form (ADR 0066): the kind and status
 * lists are CHECKs read from the migration, a received one carries its date,
 * and the row hangs off the job, the party, the order and the billed
 * application it covers.
 */
const LIEN_WAIVERS_SQL = readFileSync("drizzle/0350_lien_waivers.sql", "utf8");

describe("lien waivers", () => {
  it("MIRRORS the kind and status CHECKs", () => {
    const k = LIEN_WAIVERS_SQL.match(/job_lien_waivers_kind_valid[^(]*\(([^)]*)\)/);
    expect(k, "kind constraint not found").not.toBeNull();
    expect([...k![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()).toEqual([...LIEN_WAIVER_KINDS].sort());
    const st = LIEN_WAIVERS_SQL.match(/job_lien_waivers_status_valid[^(]*\(([^)]*)\)/);
    expect([...st![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()).toEqual([...LIEN_WAIVER_STATUSES].sort());
    for (const kind of LIEN_WAIVER_KINDS) expect(LIEN_WAIVER_KIND_LABELS[kind]).toBeTruthy();
    for (const status of LIEN_WAIVER_STATUSES) expect(LIEN_WAIVER_STATUS_LABELS[status]).toBeTruthy();
  });

  it("knows which kinds stand on their own and which cover the whole job", () => {
    // The gap rule reads these: an unconditional waiver is the one a bank
    // wants; a final one covers everything whatever its through date.
    expect(LIEN_WAIVER_KINDS.filter(isUnconditionalWaiver)).toEqual(["unconditional_progress", "unconditional_final"]);
    expect(LIEN_WAIVER_KINDS.filter(isFinalWaiver)).toEqual(["conditional_final", "unconditional_final"]);
    expect(isLienWaiverKind("partial")).toBe(false);
    expect(isLienWaiverStatus("received")).toBe(true);
    expect(isLienWaiverStatus("signed")).toBe(false);
  });

  it("makes the receipt date part of BEING received, in the database", () => {
    expect(LIEN_WAIVERS_SQL).toMatch(/job_lien_waivers_received_has_date/);
    expect(LIEN_WAIVERS_SQL).toMatch(
      /\("job_lien_waivers"."status" = 'requested' and "job_lien_waivers"."received_on" is null\) or \("job_lien_waivers"."status" = 'received' and "job_lien_waivers"."received_on" is not null\) or "job_lien_waivers"."status" = 'void'/,
    );
    expect(LIEN_WAIVERS_SQL).toMatch(/job_lien_waivers_amount_nonnegative/);
  });

  it("hangs off the job and the order (cascade), the party and the application (no action)", () => {
    expect(LIEN_WAIVERS_SQL).toMatch(/job_lien_waivers_project_fk[^;]*ON DELETE cascade/);
    expect(LIEN_WAIVERS_SQL).toMatch(/job_lien_waivers_commitment_fk[^;]*ON DELETE cascade/);
    expect(LIEN_WAIVERS_SQL).toMatch(/job_lien_waivers_party_fk[^;]*REFERENCES "public"."parties"[^;]*ON DELETE no action/);
    expect(LIEN_WAIVERS_SQL).toMatch(
      /job_lien_waivers_application_fk[^;]*REFERENCES "public"."job_sub_applications"[^;]*ON DELETE no action/,
    );
  });

  it("names its attachment target and the order's, and they are slugs Documents accepts", () => {
    for (const entity of [LIEN_WAIVER_ENTITY, COMMITMENT_ENTITY]) {
      expect(entity).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
    }
    expect(LIEN_WAIVER_ENTITY).not.toBe(COMMITMENT_ENTITY);
  });
});

// -------------------------------------------------------------- selections (8)

/**
 * A selection and its choices (ADR 0067): the status list is a CHECK read
 * from the migration, one choice is chosen per selection at the database, a
 * choice is priced by the unit or not at all, and the difference moves by
 * change order — so the row points at the change order it raised.
 */
const SELECTIONS_SQL = readFileSync("drizzle/0352_selections.sql", "utf8");

describe("selections", () => {
  it("MIRRORS the status CHECK, and counts a chosen price from selected on", () => {
    const m = SELECTIONS_SQL.match(/job_selections_status_valid[^(]*\(([^)]*)\)/);
    expect(m, "constraint not found").not.toBeNull();
    expect([...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()).toEqual([...SELECTION_STATUSES].sort());
    for (const st of SELECTION_STATUSES) expect(SELECTION_STATUS_LABELS[st]).toBeTruthy();
    expect([...CHOSEN_SELECTION_STATUSES]).toEqual(["selected", "approved"]);
    expect(isSelectionStatus("pending")).toBe(true);
    expect(isSelectionStatus("ordered")).toBe(false);
  });

  it("chooses ONE choice per selection, in the database", () => {
    // A partial unique index — the cost code set's default rule — so two
    // prices for one decision are unrepresentable.
    expect(SELECTIONS_SQL).toMatch(
      /job_selection_choices_one_chosen_idx[^;]*\("tenant_id","selection_id"\) WHERE "job_selection_choices"."is_selected"/,
    );
  });

  it("prices a choice by the unit or not at all, and floors every amount", () => {
    expect(SELECTIONS_SQL).toContain(
      `("job_selection_choices"."quantity_thousandths" is null) = ("job_selection_choices"."unit_price_cents" is null)`,
    );
    expect(SELECTIONS_SQL).toMatch(/job_selection_choices_price_nonnegative/);
    expect(SELECTIONS_SQL).toMatch(/job_selections_allowance_nonnegative/);
    expect(SELECTIONS_SQL).toMatch(/job_selections_name_present/);
    expect(SELECTIONS_SQL).toMatch(/job_selection_choices_description_present/);
  });

  it("hangs off the job (cascade), the contract, the change order and the code (no action); the choices go with the selection", () => {
    expect(SELECTIONS_SQL).toMatch(/job_selections_project_fk[^;]*ON DELETE cascade/);
    expect(SELECTIONS_SQL).toMatch(/job_selections_contract_fk[^;]*ON DELETE no action/);
    expect(SELECTIONS_SQL).toMatch(
      /job_selections_change_order_fk[^;]*REFERENCES "public"."job_change_orders"[^;]*ON DELETE no action/,
    );
    expect(SELECTIONS_SQL).toMatch(/job_selections_code_fk[^;]*ON DELETE no action/);
    expect(SELECTIONS_SQL).toMatch(/job_selection_choices_selection_fk[^;]*ON DELETE cascade/);
    expect(SELECTIONS_SQL).toMatch(/job_selection_choices_party_fk[^;]*ON DELETE no action/);
    // Hand-reordered: the selections' unique index lands before the choices' key to it.
    expect(SELECTIONS_SQL.indexOf('CREATE UNIQUE INDEX "job_selections_tenant_id_id_idx"')).toBeLessThan(
      SELECTIONS_SQL.indexOf('ADD CONSTRAINT "job_selection_choices_selection_fk"'),
    );
  });

  it("names its attachment target, a slug Documents accepts", () => {
    expect(SELECTION_ENTITY).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
  });
});

// ---------------------------------------------------------------- estimates

const ESTIMATES_SQL = readFileSync("drizzle/0356_estimates.sql", "utf8");
const PROPOSAL_SQL = readFileSync("drizzle/0358_proposal.sql", "utf8");
const ITEMS_SQL = readFileSync("drizzle/0373_job_estimate_groups.sql", "utf8");
const ITEMS_RLS_SQL = readFileSync("drizzle/0374_job_estimate_groups_rls.sql", "utf8");

describe("estimates", () => {
  it("MIRRORS the status CHECK and labels every status", () => {
    const m = ESTIMATES_SQL.match(/job_estimates_status_valid[^(]*(([^)]*))/);
    expect(m, "constraint not found").not.toBeNull();
    expect([...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()).toEqual([...ESTIMATE_STATUSES].sort());
    for (const st of ESTIMATE_STATUSES) expect(ESTIMATE_STATUS_LABELS[st]).toBeTruthy();
    expect(isEstimateStatus("sent")).toBe(true);
    expect(isEstimateStatus("won")).toBe(false);
  });

  it("MIRRORS the proposal's presentation CHECK and labels every way of showing the price", () => {
    // 0373 dropped and re-added the CHECK to admit `groups` (ADR 0079), so the live
    // definition is there, not in the migration that first wrote it.
    // Anchored on ADD CONSTRAINT: 0373 DROPS the old one first, and the drop's name
    // followed by `[^(]*` would run on into the next statement's bracket.
    const m = ITEMS_SQL.match(/ADD CONSTRAINT "job_estimates_presentation_valid" CHECK \(([^)]*\))/);
    expect(m, "constraint not found").not.toBeNull();
    expect([...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()).toEqual([...PROPOSAL_PRESENTATIONS].sort());
    for (const p of PROPOSAL_PRESENTATIONS) expect(PROPOSAL_PRESENTATION_LABELS[p]).toBeTruthy();
    expect(isProposalPresentation("codes")).toBe(true);
    expect(isProposalPresentation("poster")).toBe(false);
    // The three texts are columns with a default, so an old estimate prints a proposal with nothing around the price.
    for (const c of ["scope", "exclusions", "terms"]) expect(PROPOSAL_SQL).toContain(`ADD COLUMN "${c}" text DEFAULT '' NOT NULL`);
  });

  it("caps every rate at 1,000% in the database, the same number the code uses", () => {
    expect(RATE_PPM_MAX).toBe(10_000_000);
    for (const c of ["job_estimates_markup_range", "job_estimates_overhead_range", "job_estimates_profit_range", "job_estimate_lines_markup_range"]) {
      expect(ESTIMATES_SQL, c).toMatch(new RegExp(c + "[^;]*<= " + RATE_PPM_MAX + "[)]"));
    }
    expect(ESTIMATES_SQL).toMatch(/job_estimate_lines_quantity_nonnegative/);
    expect(ESTIMATES_SQL).toMatch(/job_estimate_lines_unit_cost_nonnegative/);
    expect(ESTIMATES_SQL).toMatch(/job_estimate_lines_unit_price_nonnegative[^;]*is null or/);
    expect(ESTIMATES_SQL).toMatch(/job_estimate_lines_description_present/);
    expect(ESTIMATES_SQL).toMatch(/job_estimates_number_present/);
  });

  it("numbers estimates uniquely per job, and the action names the index", () => {
    expect(ESTIMATES_SQL).toMatch(/CREATE UNIQUE INDEX "job_estimates_project_number_idx"[^;]*("tenant_id","project_id","number")/);
    expect(readFileSync("src/packs/jobs/actions.ts", "utf8")).toContain('case "job_estimates_project_number_idx":');
  });

  it("hangs off the job (cascade) and names the contract it became (no action); the lines go with the estimate and hold their code", () => {
    expect(ESTIMATES_SQL).toMatch(/job_estimates_project_fk[^;]*ON DELETE cascade/);
    expect(ESTIMATES_SQL).toMatch(/job_estimates_contract_fk[^;]*REFERENCES "public"."job_contracts"[^;]*ON DELETE no action/);
    expect(ESTIMATES_SQL).toMatch(/job_estimate_lines_estimate_fk[^;]*ON DELETE cascade/);
    expect(ESTIMATES_SQL).toMatch(/job_estimate_lines_code_fk[^;]*REFERENCES "public"."job_cost_codes"[^;]*ON DELETE no action/);
    // Hand-reordered: the estimates' unique index lands before the lines' key to it.
    expect(ESTIMATES_SQL.indexOf('CREATE UNIQUE INDEX "job_estimates_tenant_id_id_idx"')).toBeLessThan(
      ESTIMATES_SQL.indexOf('ADD CONSTRAINT "job_estimate_lines_estimate_fk"'),
    );
  });

  describe("the arithmetic", () => {
    const L = (quantityThousandths: number, unitCostCents: number, markupPpm: number | null = null, unitPriceCents: number | null = null) => ({
      quantityThousandths,
      unitCostCents,
      markupPpm,
      unitPriceCents,
    });

    it("applies a rate in integer math, half up, and never to nothing", () => {
      expect(rateCents(10_000, 150_000)).toBe(1_500);
      expect(rateCents(1, 500_000)).toBe(1);
      expect(rateCents(1, 499_999)).toBe(0);
      expect(rateCents(0, 150_000)).toBe(0);
      expect(rateCents(-5, 150_000)).toBe(0);
      expect(rateCents(5, 0)).toBe(0);
    });

    it("costs a line as quantity at the unit cost, and prices it by markup unless a unit price is typed", () => {
      expect(lineCostCents(L(120_000, 185_00))).toBe(22_200_00);
      expect(linePriceCents(L(120_000, 185_00), 150_000)).toBe(25_530_00); // the estimate's 15%
      expect(linePriceCents(L(1_000, 40_000_00, 100_000), 150_000)).toBe(44_000_00); // the line's own 10% wins
      expect(linePriceCents(L(2_000, 900_00, 150_000, 1_200_00), 150_000)).toBe(2_400_00); // a typed price wins over both
      expect(linePriceCents(L(1_000, 1_500_00), 0)).toBe(1_500_00); // no markup: sold at cost
    });

    it("marks up the EXTENDED cost, so a line priced whole and a line priced by the unit agree to the cent", () => {
      // 3 at $0.01 with 33% on: the unit marked up rounds to $0.01 and sells at $0.03; the extended cost of $0.03 marked up is $0.04.
      expect(linePriceCents(L(3_000, 1, 330_000), 0)).toBe(4);
      expect(linePriceCents(L(3_000, 1, 330_000), 0)).toBe(lineCostCents(L(3_000, 1)) + rateCents(3, 330_000));
    });

    it("puts overhead on the subtotal and profit on the subtotal plus overhead, each rounded once", () => {
      const lines = [L(120_000, 185_00), L(1_000, 40_000_00, 100_000), L(2_000, 900_00, null, 1_200_00), L(1_000, 1_500_00)];
      const t = estimateTotals(lines, { markupPpm: 150_000, overheadPpm: 100_000, profitPpm: 100_000 });
      expect(t).toEqual({
        costCents: 65_500_00,
        subtotalCents: 73_655_00,
        // With no items, everything is spreadable and nothing is priced by hand (ADR 0079).
        spreadableCents: 73_655_00,
        fixedCents: 0,
        overheadCents: 7_365_50,
        profitCents: 8_102_05,
        totalCents: 89_122_55,
        marginCents: 23_622_55,
        marginPpm: Math.round((23_622_55 / 89_122_55) * 1_000_000),
      });
      // Nothing below the lines: the subtotal is the total.
      expect(estimateTotals(lines, { markupPpm: 150_000, overheadPpm: 0, profitPpm: 0 })).toMatchObject({ totalCents: 73_655_00, marginCents: 8_155_00 });
      // No lines: every figure is nothing, and there is no margin to speak of.
      expect(estimateTotals([], { markupPpm: 150_000, overheadPpm: 100_000, profitPpm: 100_000 })).toEqual({
        costCents: 0,
        subtotalCents: 0,
        spreadableCents: 0,
        fixedCents: 0,
        overheadCents: 0,
        profitCents: 0,
        totalCents: 0,
        marginCents: 0,
        marginPpm: null,
      });
    });

    it("groups cost and price by code, the no-code lines under null", () => {
      const byCode = estimateByCode(
        [
          { ...L(120_000, 185_00), costCodeId: "a" },
          { ...L(1_000, 40_000_00, 100_000), costCodeId: "b" },
          { ...L(2_000, 900_00, null, 1_200_00), costCodeId: "a" },
          { ...L(1_000, 1_500_00), costCodeId: null },
        ],
        150_000,
      );
      expect([...byCode.entries()]).toEqual([
        ["a", { costCents: 24_000_00, priceCents: 27_930_00 }],
        ["b", { costCents: 40_000_00, priceCents: 44_000_00 }],
        [null, { costCents: 1_500_00, priceCents: 1_725_00 }],
      ]);
    });

    it("spreads an amount across weights so the shares sum exactly, the leftover cents to the largest remainders", () => {
      expect(spreadCents([10_00, 10_00, 10_00], 1_00)).toEqual([34, 33, 33]);
      expect(spreadCents([25_530_00, 44_000_00, 2_400_00, 1_725_00], 15_467_55)).toEqual([5_361_30, 9_240_00, 504_00, 362_25]);
      expect(spreadCents([0, 0], 5)).toEqual([0, 0]);
      expect(spreadCents([1, 2], 0)).toEqual([0, 0]);
      expect(spreadCents([], 5)).toEqual([]);
    });

    it("writes a schedule of values that TOTALS THE CONTRACT SUM: overhead and profit spread over the lines, a unit-priced line's unit price raised by the same share", () => {
      const lines = [L(120_000, 185_00), L(1_000, 40_000_00, 100_000), L(2_000, 900_00, null, 1_200_00), L(1_000, 1_500_00)];
      const schedule = scheduleFromEstimate(lines, { markupPpm: 150_000, overheadPpm: 100_000, profitPpm: 100_000 });
      expect(schedule).toEqual([
        { scheduledCents: 30_891_30, quantityThousandths: null, unitPriceCents: null },
        { scheduledCents: 53_240_00, quantityThousandths: null, unitPriceCents: null },
        { scheduledCents: 2_904_00, quantityThousandths: 2_000, unitPriceCents: 1_452_00 },
        { scheduledCents: 2_087_25, quantityThousandths: null, unitPriceCents: null },
      ]);
      expect(schedule.reduce((sum, l) => sum + l.scheduledCents, 0)).toBe(89_122_55);
      // Nothing below the lines: the schedule is the prices, untouched.
      expect(scheduleFromEstimate(lines, { markupPpm: 150_000, overheadPpm: 0, profitPpm: 0 }).map((l) => l.scheduledCents)).toEqual([25_530_00, 44_000_00, 2_400_00, 1_725_00]);
      // The rounding lands on the last line priced as a sum, so the total still holds.
      const odd = scheduleFromEstimate([L(3_000, 0, null, 1), L(1_000, 10), L(1_000, 10)], { markupPpm: 0, overheadPpm: 210_000, profitPpm: 0 });
      expect(odd.map((l) => l.scheduledCents)).toEqual([3, 12, 13]);
      expect(odd.reduce((sum, l) => sum + l.scheduledCents, 0)).toBe(
        estimateTotals([L(3_000, 0, null, 1), L(1_000, 10), L(1_000, 10)], { markupPpm: 0, overheadPpm: 210_000, profitPpm: 0 }).totalCents,
      );
      // Every line by the unit: nowhere for the rounding to land, and the schedule can miss the total by it.
      const allUnit = scheduleFromEstimate([L(3_000, 0, null, 1), L(3_000, 0, null, 1)], { markupPpm: 0, overheadPpm: 210_000, profitPpm: 0 });
      expect(allUnit.map((l) => [l.scheduledCents, l.unitPriceCents])).toEqual([[3, 1], [3, 1]]);
      expect(allUnit.reduce((sum, l) => sum + l.scheduledCents, 0)).toBe(6);
      expect(estimateTotals([L(3_000, 0, null, 1), L(3_000, 0, null, 1)], { markupPpm: 0, overheadPpm: 210_000, profitPpm: 0 }).totalCents).toBe(7);
    });

    it("reads a rate as typed — a percentage, up to 1,000, four places", () => {
      expect(rateStringToPpm("10")).toBe(100_000);
      expect(rateStringToPpm("12.5")).toBe(125_000);
      expect(rateStringToPpm(" 0.25% ")).toBe(2_500);
      expect(rateStringToPpm("1000")).toBe(10_000_000);
      expect(rateStringToPpm("1000.01")).toBeNull();
      expect(rateStringToPpm("-5")).toBeNull();
      expect(rateStringToPpm("")).toBeNull();
      expect(rateStringToPpm("ten")).toBeNull();
    });
  });
});

// ------------------------------------------ items on an estimate (ADR 0079)

describe("items on an estimate", () => {
  it("MIRRORS the price-mode CHECK, labels every mode, and ties the mode to the number", () => {
    const m = ITEMS_SQL.match(/job_estimate_groups_price_mode_valid[^;]*in \(([^)]*)\)/);
    expect(m, "constraint not found").not.toBeNull();
    expect([...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()).toEqual([...GROUP_PRICE_MODES].sort());
    for (const mode of GROUP_PRICE_MODES) expect(GROUP_PRICE_MODE_LABELS[mode]).toBeTruthy();
    expect(isGroupPriceMode("fixed")).toBe(true);
    expect(isGroupPriceMode("guess")).toBe(false);
    // The mode and the price say the same thing or the row is refused.
    expect(ITEMS_SQL).toMatch(/job_estimate_groups_fixed_priced[^;]*= 'fixed'\) = \(.*is not null\)/);
    expect(ITEMS_SQL).toMatch(/job_estimate_groups_fixed_nonnegative[^;]*is null or/);
    expect(ITEMS_SQL).toMatch(/job_estimate_groups_name_present/);
  });

  it("hangs off the estimate (cascade) and leaves a line loose when its item goes, in the COLUMN-LIST SET NULL form", () => {
    expect(ITEMS_SQL).toMatch(/job_estimate_groups_estimate_fk[^;]*ON DELETE cascade/);
    // A bare SET NULL can never run on a composite key (the 0046 precedent).
    expect(ITEMS_SQL).toMatch(
      /job_estimate_lines_group_fk[^;]*REFERENCES "public"\."job_estimate_groups"[^;]*ON DELETE SET NULL \("group_id"\)/,
    );
    expect(ITEMS_SQL.indexOf('CREATE UNIQUE INDEX "job_estimate_groups_tenant_id_id_idx"')).toBeLessThan(
      ITEMS_SQL.indexOf('ADD CONSTRAINT "job_estimate_lines_group_fk"'),
    );
  });

  it("has RLS enabled AND forced, with the pack's two policies", () => {
    expect(ITEMS_RLS_SQL).toMatch(/ALTER TABLE "job_estimate_groups" ENABLE ROW LEVEL SECURITY/);
    expect(ITEMS_RLS_SQL).toMatch(/ALTER TABLE "job_estimate_groups" FORCE ROW LEVEL SECURITY/);
    expect(ITEMS_RLS_SQL).toMatch(/job_estimate_groups_superadmin_all[^;]*app_is_superadmin\(\)/);
    expect(ITEMS_RLS_SQL).toMatch(/job_estimate_groups_member_all[^;]*app_current_tenant\(\)/);
  });

  it("names the two shapes a schedule can take", () => {
    expect([...SCHEDULE_SHAPES]).toEqual(["group", "line"]);
    expect(isScheduleShape("group")).toBe(true);
    expect(isScheduleShape("detail")).toBe(false); // the proposal's shape is never a schedule's
  });

  /**
   * THE FOUNDER'S EXAMPLE, to the cent (ADR 0079): ten and ten, an item priced
   * by hand at $8,400 with $6,950 of cost behind it, and $91,600 of loose lines.
   * A fixed item sits OUTSIDE the overhead-and-profit spread, so $8,400 is what
   * prints; had it ridden the spread it would have printed $10,164, which is the
   * trap the decision was taken to avoid.
   */
  describe("an item priced by hand", () => {
    const TEN_AND_TEN = { markupPpm: 0, overheadPpm: 100_000, profitPpm: 100_000 };
    const tile = { id: "g-tile", name: "Tile flooring", priceMode: "fixed", fixedPriceCents: 8_400_00 };
    const lines = [
      { description: "Tile, material and labour", unit: "", costCodeId: "c-tile", groupId: "g-tile", quantityThousandths: 1_000, unitCostCents: 6_950_00, markupPpm: null, unitPriceCents: null },
      { description: "Everything else", unit: "", costCodeId: "c-other", groupId: null, quantityThousandths: 1_000, unitCostCents: 91_600_00, markupPpm: null, unitPriceCents: null },
    ];

    it("adds the typed price AFTER the rates, and the rates are taken on what is left", () => {
      const t = estimateTotals(lines, TEN_AND_TEN, [tile]);
      expect(t.spreadableCents).toBe(91_600_00);
      expect(t.fixedCents).toBe(8_400_00);
      expect(t.subtotalCents).toBe(100_000_00);
      expect(t.overheadCents).toBe(9_160_00);
      expect(t.profitCents).toBe(10_076_00);
      expect(t.totalCents).toBe(119_236_00);
      // Cost is every line's, grouped or loose, fixed or not.
      expect(t.costCents).toBe(98_550_00);
      expect(t.marginCents).toBe(20_686_00);
      // THE TRAP THE DECISION AVOIDS: at ten and ten the spread factor is 1.21, so an
      // item typed at $8,400 that rode the spread would have printed $10,164.
      expect(8_400_00 + rateCents(8_400_00, 210_000)).toBe(10_164_00);
      expect(scheduleRows(lines, TEN_AND_TEN, [tile], "group")[0].scheduledCents).toBe(8_400_00);
      // Left to add up its lines instead, the same item prices at cost plus the spread.
      expect(estimateTotals(lines, TEN_AND_TEN, [{ ...tile, priceMode: "rollup", fixedPriceCents: null }]).totalCents).toBe(
        119_245_50,
      );
    });

    it("prints the number that was typed, and the loose lines carry all the overhead and profit", () => {
      const rows = scheduleRows(lines, TEN_AND_TEN, [tile], "group");
      expect(rows.map((r) => [r.description, r.scheduledCents])).toEqual([
        ["Tile flooring", 8_400_00],
        ["Everything else", 110_836_00],
      ]);
      expect(rows.reduce((sum, r) => sum + r.scheduledCents, 0)).toBe(119_236_00);
      // An item bills as a sum, and takes its lines' code only when they agree on one.
      expect(rows[0]).toMatchObject({ costCodeId: "c-tile", quantityThousandths: null, unitPriceCents: null });
    });

    it("NEVER shows its build-up in the takeoff shape: one row at its price, no lines beneath", () => {
      const rows = scheduleRows(lines, TEN_AND_TEN, [tile], "detail");
      expect(rows.map((r) => [r.description, r.heading, r.scheduledCents])).toEqual([
        ["Tile flooring", false, 8_400_00],
        ["Everything else", false, 110_836_00],
      ]);
    });

    it("shares the typed price across its own lines when the schedule is written line by line", () => {
      const rows = scheduleRows(lines, TEN_AND_TEN, [tile], "line");
      expect(rows.map((r) => [r.description, r.scheduledCents])).toEqual([
        ["Tile, material and labour", 8_400_00],
        ["Everything else", 110_836_00],
      ]);
      expect(rows.reduce((sum, r) => sum + r.scheduledCents, 0)).toBe(119_236_00);
    });

    it("prices a line by its share of the typed price when the estimate is read by code", () => {
      const byCode = estimateByCode(lines, TEN_AND_TEN.markupPpm, [tile]);
      expect(byCode.get("c-tile")).toEqual({ costCents: 6_950_00, priceCents: 8_400_00 });
      expect(byCode.get("c-other")).toEqual({ costCents: 91_600_00, priceCents: 91_600_00 });
      // The prices still add to the subtotal: the budget's cost is untouched either way.
      expect([...byCode.values()].reduce((s, r) => s + r.priceCents, 0)).toBe(100_000_00);
    });
  });

  describe("an item that adds up its lines", () => {
    const TERMS = { markupPpm: 100_000, overheadPpm: 100_000, profitPpm: 0 };
    const paint = { id: "g-paint", name: "Paint, whole house", priceMode: "rollup", fixedPriceCents: null };
    const lines = [
      { description: "Paint, material", unit: "gal", costCodeId: "c-paint", groupId: "g-paint", quantityThousandths: 20_000, unitCostCents: 45_00, markupPpm: null, unitPriceCents: null },
      { description: "Paint, labour", unit: "", costCodeId: "c-paint", groupId: "g-paint", quantityThousandths: 1_000, unitCostCents: 3_100_00, markupPpm: null, unitPriceCents: null },
    ];

    it("rides the spread like any line, and its row is exactly its lines' rows added up", () => {
      const t = estimateTotals(lines, TERMS, [paint]);
      // 900 + 3,100 = 4,000 of cost, 10% on = 4,400 of price, 10% overhead = 440.
      expect(t).toMatchObject({ costCents: 4_000_00, spreadableCents: 4_400_00, fixedCents: 0, totalCents: 4_840_00 });
      const byGroup = scheduleRows(lines, TERMS, [paint], "group");
      const byLine = scheduleRows(lines, TERMS, [paint], "line");
      expect(byGroup.map((r) => [r.description, r.scheduledCents])).toEqual([["Paint, whole house", 4_840_00]]);
      expect(byLine.reduce((sum, r) => sum + r.scheduledCents, 0)).toBe(4_840_00);
      expect(byGroup[0].scheduledCents).toBe(byLine.reduce((sum, r) => sum + r.scheduledCents, 0));
    });

    it("shows as a heading with its lines beneath it in the takeoff shape, the heading carrying no money", () => {
      const rows = scheduleRows(lines, TERMS, [paint], "detail");
      expect(rows.map((r) => [r.description, r.heading])).toEqual([
        ["Paint, whole house", true],
        ["Paint, material", false],
        ["Paint, labour", false],
      ]);
      expect(rows[0].scheduledCents).toBe(0);
      expect(rows.reduce((sum, r) => sum + r.scheduledCents, 0)).toBe(4_840_00);
    });

    it("costs and prices an item from its lines, and a typed price answers the other question", () => {
      const children = lines.map((l) => ({ ...l }));
      expect(groupCostCents(children)).toBe(4_000_00);
      expect(groupPriceCents(paint, children, TERMS.markupPpm)).toBe(4_400_00);
      expect(groupPriceCents({ ...paint, priceMode: "fixed", fixedPriceCents: 5_000_00 }, children, TERMS.markupPpm)).toBe(5_000_00);
      // Says it is fixed but carries no number: not fixed. The CHECK stops the row; this stops the arithmetic.
      expect(isFixedPrice({ id: "x", priceMode: "fixed", fixedPriceCents: null })).toBe(false);
      expect(isFixedPrice(paint)).toBe(false);
    });
  });

  describe("the degenerate items, which must not lose money", () => {
    const FLAT = { markupPpm: 0, overheadPpm: 0, profitPpm: 0 };

    it("shares a typed price EQUALLY when no line under it has a price of its own", () => {
      const g = { id: "g", name: "Allowance, fixtures", priceMode: "fixed", fixedPriceCents: 8_400_00 };
      const lines = [
        { description: "To be selected", unit: "", costCodeId: null, groupId: "g", quantityThousandths: 1_000, unitCostCents: 0, markupPpm: null, unitPriceCents: null },
        { description: "Install", unit: "", costCodeId: null, groupId: "g", quantityThousandths: 1_000, unitCostCents: 0, markupPpm: null, unitPriceCents: null },
      ];
      const rows = scheduleRows(lines, FLAT, [g], "line");
      expect(rows.map((r) => r.scheduledCents)).toEqual([4_200_00, 4_200_00]);
      expect(estimateTotals(lines, FLAT, [g]).totalCents).toBe(8_400_00);
    });

    it("keeps a typed price that has no lines at all, in either shape", () => {
      const g = { id: "g", name: "Allowance, appliances", priceMode: "fixed", fixedPriceCents: 12_000_00 };
      expect(estimateTotals([], FLAT, [g]).totalCents).toBe(12_000_00);
      for (const shape of ["group", "line"] as const) {
        const rows = scheduleRows([], FLAT, [g], shape);
        expect(rows.map((r) => [r.description, r.scheduledCents]), shape).toEqual([["Allowance, appliances", 12_000_00]]);
      }
    });

    it("counts a line whose item is not on the estimate as loose, rather than dropping it", () => {
      const lines = [
        { description: "Orphan", unit: "", costCodeId: null, groupId: "gone", quantityThousandths: 1_000, unitCostCents: 1_000_00, markupPpm: null, unitPriceCents: null },
      ];
      expect(estimateTotals(lines, FLAT, []).totalCents).toBe(1_000_00);
      expect(scheduleRows(lines, FLAT, [], "group").map((r) => r.scheduledCents)).toEqual([1_000_00]);
    });
  });
});

// --------------------------------------------------------- party documents (11b)

/**
 * A subcontractor's documents (ADR 0068): the kind is the business's (a format
 * check, mirrored), the required list is the tenant's or the default, the
 * status list is a CHECK read from the migration, and the standing rule is
 * pure — so it is pinned here, date by date.
 */
const PARTY_DOCUMENTS_SQL = readFileSync("drizzle/0354_party_documents.sql", "utf8");

const doc = (over: Partial<Parameters<typeof standingFor>[0][number]>) => ({
  id: "d",
  tenantId: "t",
  partyId: "p",
  kind: "insurance_certificate",
  title: "",
  reference: "",
  issuer: "",
  issuedOn: null,
  expiresOn: null,
  limitCents: null,
  status: "received",
  requestedOn: null,
  receivedOn: "2026-01-01",
  notes: "",
  createdByClerkUserId: null,
  version: 1,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

describe("party documents", () => {
  it("MIRRORS the kind format and the status CHECK, and labels the suggested kinds", () => {
    expect(PARTY_DOCUMENTS_SQL).toContain(`"job_party_documents"."kind" ~ '${PARTY_DOCUMENT_FORMAT.source}'`);
    const m = PARTY_DOCUMENTS_SQL.match(/job_party_documents_status_valid[^(]*\(([^)]*)\)/);
    expect(m, "constraint not found").not.toBeNull();
    expect([...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()).toEqual([...PARTY_DOCUMENT_STATUSES].sort());
    for (const st of PARTY_DOCUMENT_STATUSES) expect(PARTY_DOCUMENT_STATUS_LABELS[st]).toBeTruthy();
    for (const k of SUGGESTED_PARTY_DOCUMENT_KINDS) expect(partyDocumentKindLabel(k)).not.toBe(k);
    expect(partyDocumentKindLabel("safety_plan")).toBe("Safety plan");
    expect(isPartyDocumentKind("w9")).toBe(true);
    expect(isPartyDocumentKind("W-9")).toBe(false);
    expect(isPartyDocumentStatus("received")).toBe(true);
    expect(isPartyDocumentStatus("expired")).toBe(false);
  });

  it("makes the receipt date part of being on file, floors the limit, and holds the party", () => {
    expect(PARTY_DOCUMENTS_SQL).toMatch(/job_party_documents_received_has_date/);
    expect(PARTY_DOCUMENTS_SQL).toMatch(/job_party_documents_limit_nonnegative/);
    expect(PARTY_DOCUMENTS_SQL).toMatch(/job_party_documents_party_fk[^;]*REFERENCES "public"."parties"[^;]*ON DELETE no action/);
    for (const entity of [PARTY_DOCUMENT_ENTITY, PARTY_ENTITY]) expect(entity).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
  });

  it("reads the required list from the tenant's config, or falls back to the default", () => {
    expect([...DEFAULT_REQUIRED_PARTY_DOCUMENTS]).toEqual(["insurance_certificate", "w9"]);
    expect(requiredPartyDocumentsFrom(null)).toEqual(["insurance_certificate", "w9"]);
    expect(requiredPartyDocumentsFrom({ requiredPartyDocuments: ["license", "W-9", "insurance_certificate"] })).toEqual([
      "license",
      "insurance_certificate",
    ]);
    expect(requiredPartyDocumentsFrom({ requiredPartyDocuments: [] })).toEqual(["insurance_certificate", "w9"]);
  });

  it("STANDING: missing, expired, expiring within a month, ok — the longest-running document answers, and a W-9 never runs out", () => {
    expect(EXPIRING_SOON_DAYS).toBe(30);
    const required = ["insurance_certificate", "w9"];
    // Nothing on file.
    expect(standingFor([], required, "2026-09-15").required.map((r) => r.state)).toEqual(["missing", "missing"]);
    // A certificate expired yesterday and a W-9 with no expiry.
    const expired = standingFor(
      [doc({ id: "c1", expiresOn: "2026-09-14" }), doc({ id: "w", kind: "w9" })],
      required,
      "2026-09-15",
    );
    expect(expired.required.map((r) => [r.state, r.document?.id])).toEqual([["expired", "c1"], ["ok", "w"]]);
    expect(expired.good).toBe(false);
    // A newer certificate runs longer and answers; 30 days out is expiring, 31 is ok.
    const renewed = standingFor(
      [doc({ id: "c1", expiresOn: "2026-09-14" }), doc({ id: "c2", expiresOn: "2026-10-15" }), doc({ id: "w", kind: "w9" })],
      required,
      "2026-09-15",
    );
    expect(renewed.required[0]).toMatchObject({ state: "expiring", document: { id: "c2" } });
    expect(renewed.good).toBe(true);
    expect(standingFor([doc({ expiresOn: "2026-10-16" })], ["insurance_certificate"], "2026-09-15").required[0].state).toBe("ok");
    // Requested and void are not on file; anything not required is listed beside.
    const mixed = standingFor(
      [
        doc({ id: "r", status: "requested", receivedOn: null }),
        doc({ id: "v", status: "void" }),
        doc({ id: "l", kind: "license", expiresOn: "2027-01-01" }),
      ],
      required,
      "2026-09-15",
    );
    expect(mixed.required.map((r) => r.state)).toEqual(["missing", "missing"]);
    expect(mixed.others.map((d) => d.id)).toEqual(["l"]);
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
