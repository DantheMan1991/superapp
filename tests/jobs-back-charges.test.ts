import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  backChargeBillDescription,
  backChargeSentence,
  backChargeStanding,
  backChargeTotals,
  backChargesExceedMessage,
  isDeducted,
  isOutstanding,
  netDueCents,
} from "../src/packs/jobs/back-charges-math";
import {
  BACK_CHARGE_DESCRIPTION_MAX,
  BACK_CHARGE_STANDINGS,
  BACK_CHARGE_STANDING_LABELS,
  BACK_CHARGE_STATUSES,
  isBackChargeStatus,
} from "../src/packs/jobs/vocabulary";

/**
 * The back-charge's arithmetic (ADR 0077), pure: where one stands, what it
 * takes off a payment, and the words. The database suites prove the rows.
 */

const SQL = readFileSync("drizzle/0369_job_back_charges.sql", "utf8");

describe("the database agrees with the words", () => {
  it("MIRRORS the status CHECK, labels every standing, and knows its own statuses", () => {
    const m = SQL.match(/job_back_charges_status_valid[^(]*\(([^)]*)\)/);
    expect(m, "status constraint").not.toBeNull();
    const listed = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(listed).toEqual([...BACK_CHARGE_STATUSES].sort());
    for (const s of BACK_CHARGE_STANDINGS) expect(BACK_CHARGE_STANDING_LABELS[s].length).toBeGreaterThan(0);
    expect(isBackChargeStatus("void")).toBe(true);
    expect(isBackChargeStatus("deducted")).toBe(false);
  });

  it("MIRRORS the money, the words and the one-way rules", () => {
    expect(SQL).toMatch(/job_back_charges_amount_positive[^;]*"amount_cents" > 0/);
    expect(SQL).toMatch(/job_back_charges_description_present[^;]*length\(btrim/);
    expect(SQL).toMatch(new RegExp(`job_back_charges_description_bounded[^;]*<= ${BACK_CHARGE_DESCRIPTION_MAX}\\)`));
    // A dropped back-charge can never be sitting on an application.
    expect(SQL).toMatch(/job_back_charges_void_is_off[^;]*= 'open' or [^;]*"sub_application_id" is null/);
  });

  it("MIRRORS the three column-list SET NULL keys, which a composite key needs", () => {
    expect(SQL).toMatch(/job_back_charges_cost_code_fk[^;]*ON DELETE SET NULL \("cost_code_id"\)/);
    expect(SQL).toMatch(/job_back_charges_claim_fk[^;]*ON DELETE SET NULL \("warranty_claim_id"\)/);
    expect(SQL).toMatch(/job_back_charges_application_fk[^;]*ON DELETE SET NULL \("sub_application_id"\)/);
    // And the order it hangs off takes it with it.
    expect(SQL).toMatch(/job_back_charges_commitment_fk[^;]*ON DELETE cascade/);
  });
});

describe("where a back-charge stands", () => {
  it("is void by its own status, else read from the application it rides", () => {
    expect(backChargeStanding("void", null)).toBe("void");
    expect(backChargeStanding("void", { status: "billed" })).toBe("void");
    expect(backChargeStanding("open", null)).toBe("open");
    expect(backChargeStanding("open", { status: "draft" })).toBe("on_application");
    expect(backChargeStanding("open", { status: "billed" })).toBe("deducted");
  });

  it("treats a VOIDED application as no application: the money is owed again", () => {
    expect(backChargeStanding("open", { status: "void" })).toBe("open");
  });

  it("knows which standings are settled and which are still to come off somebody", () => {
    expect([isDeducted("deducted"), isDeducted("on_application"), isDeducted("open"), isDeducted("void")]).toEqual([true, false, false, false]);
    expect([isOutstanding("open"), isOutstanding("on_application"), isOutstanding("deducted"), isOutstanding("void")]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

describe("the totals", () => {
  const rows = [
    { amountCents: 80_000, standing: "open" as const },
    { amountCents: 25_000, standing: "on_application" as const },
    { amountCents: 40_000, standing: "deducted" as const },
    { amountCents: 99_999, standing: "void" as const },
  ];

  it("splits by standing and leaves a dropped one out of everything", () => {
    expect(backChargeTotals(rows)).toEqual({
      onApplicationCents: 25_000,
      openCents: 80_000,
      deductedCents: 40_000,
      raisedCents: 145_000,
    });
    expect(backChargeTotals([])).toEqual({ onApplicationCents: 0, openCents: 0, deductedCents: 0, raisedCents: 0 });
  });

  it("takes what rides an application off the payment, and nothing else", () => {
    expect(netDueCents(100_000, 25_000)).toBe(75_000);
    expect(netDueCents(100_000, 0)).toBe(100_000);
    // The verb refuses before this, but the arithmetic itself does not lie about it.
    expect(netDueCents(10_000, 25_000)).toBe(-15_000);
  });
});

describe("the words", () => {
  it("says the outstanding money first, and says nothing when there is nothing", () => {
    expect(backChargeSentence(backChargeTotals([]), false)).toBe("Nothing charged back on this order.");
    expect(
      backChargeSentence(
        backChargeTotals([
          { amountCents: 25_000, standing: "on_application" },
          { amountCents: 80_000, standing: "open" },
          { amountCents: 40_000, standing: "deducted" },
        ]),
        true,
      ),
    ).toBe("1,450.00 charged back: 250.00 on the draft application, 800.00 not yet deducted, 400.00 already deducted.");
  });

  it("says an open one is waiting when there is no draft to put it on", () => {
    expect(backChargeSentence(backChargeTotals([{ amountCents: 80_000, standing: "open" }]), false)).toBe(
      "800.00 charged back: 800.00 waiting for an application to come off.",
    );
  });

  it("names itself on the bill, so a bookkeeper reading the entry knows what it is", () => {
    expect(backChargeBillDescription(2, "  Cleaned the site after them ", 3)).toBe("Back-charge 2 — Cleaned the site after them (application 3)");
  });

  it("refuses with both figures and what to do about it", () => {
    expect(backChargesExceedMessage(50_000, 125_000, 2)).toBe(
      "2 back-charges come to 1,250.00 against a payment of 500.00. Take some of them off this application and deduct them on a later one",
    );
    expect(backChargesExceedMessage(50_000, 50_000, 1)).toContain("1 back-charge comes to 500.00");
  });
});
