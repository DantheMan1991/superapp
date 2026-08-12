import { describe, expect, it } from "vitest";
import {
  AP_BUCKETS,
  AR_BUCKETS,
  documentBucket,
  isApBucket,
  isArBucket,
  obligationFor,
} from "../src/modules/accounting/lib/obligation";

/**
 * Obligation language and the MoneyBar's document buckets.
 *
 * `issued` tells a reader what the software did; "Overdue 60 days" tells them
 * what they are owed. This file pins the second, including the cases where the
 * two disagree.
 */

const TODAY = "2026-08-12";

const on = (over: Partial<Parameters<typeof obligationFor>[0]> = {}) =>
  obligationFor({
    status: "issued",
    dueDate: "2026-08-12",
    balanceCents: 50_000,
    today: TODAY,
    ...over,
  });

describe("obligationFor", () => {
  it("counts the days late", () => {
    expect(on({ dueDate: "2026-06-13" }).label).toBe("Overdue 60 days");
    expect(on({ dueDate: "2026-08-11" }).label).toBe("Overdue 1 day");
    expect(on({ dueDate: "2026-06-13" }).tone).toBe("overdue");
    expect(on({ dueDate: "2026-06-13" }).daysPastDue).toBe(60);
  });

  it("names today and tomorrow rather than counting them", () => {
    expect(on({ dueDate: TODAY }).label).toBe("Due today");
    expect(on({ dueDate: "2026-08-13" }).label).toBe("Due tomorrow");
    expect(on({ dueDate: "2026-08-19" }).label).toBe("Due in 7 days");
  });

  it("reserves the urgent tone for the last week", () => {
    // If "due in 40 days" looked as urgent as "due tomorrow", neither would.
    expect(on({ dueDate: "2026-08-19" }).tone).toBe("due");
    expect(on({ dueDate: "2026-08-20" }).tone).toBe("neutral");
  });

  it("lets the BALANCE beat the status when they disagree", () => {
    // `paid` derives from payments and the two are written in one transaction,
    // but if they ever diverged the money is the fact.
    expect(on({ balanceCents: 0 }).label).toBe("Paid");
    expect(on({ status: "partial", balanceCents: -1 }).label).toBe("Paid");
    expect(on({ status: "paid", balanceCents: 100 }).label).not.toBe("Paid");
  });

  it("never calls a void or draft record overdue", () => {
    // Both read BEFORE the date maths, so a stale due date on a voided
    // invoice cannot render as an alarm.
    expect(on({ status: "void", dueDate: "2020-01-01" }).label).toBe("Void");
    expect(on({ status: "draft", dueDate: "2020-01-01" }).label).toBe("Draft");
    expect(on({ status: "void", dueDate: "2020-01-01" }).tone).toBe("settled");
  });

  it("says Open when money is owed with no date to be late against", () => {
    const o = on({ dueDate: null });
    expect(o.label).toBe("Open");
    expect(o.tone).toBe("neutral");
    expect(o.daysPastDue).toBeNull();
  });
});

describe("documentBucket", () => {
  const bucket = (over: Partial<Parameters<typeof documentBucket>[0]> = {}) =>
    documentBucket({
      status: "issued",
      dueDate: "2026-08-12",
      balanceCents: 50_000,
      today: TODAY,
      ...over,
    });

  it("splits owed money by whether it is late", () => {
    expect(bucket({ dueDate: "2026-08-11" })).toBe("overdue");
    expect(bucket({ dueDate: TODAY })).toBe("not_due");
    expect(bucket({ dueDate: "2026-08-13" })).toBe("not_due");
  });

  it("counts an undated debt as not due, never as overdue", () => {
    expect(bucket({ dueDate: null })).toBe("not_due");
  });

  it("excludes everything that is not owed", () => {
    // Drafts and voids are not money anybody is waiting for, and a settled
    // record has left the bar entirely.
    expect(bucket({ status: "draft" })).toBeNull();
    expect(bucket({ status: "void" })).toBeNull();
    expect(bucket({ balanceCents: 0 })).toBeNull();
  });

  it("agrees with obligationFor about what is overdue", () => {
    // The badge and the bucket must never disagree on one row: a list saying
    // "Overdue 3 days" while the Overdue tile excludes it is unusable.
    for (const dueDate of ["2026-06-01", "2026-08-11", TODAY, "2026-09-30"]) {
      const o = obligationFor({
        status: "issued",
        dueDate,
        balanceCents: 1_000,
        today: TODAY,
      });
      expect(bucket({ dueDate })).toBe(o.tone === "overdue" ? "overdue" : "not_due");
    }
  });
});

describe("bucket guards", () => {
  it("accept only their own keys", () => {
    for (const k of AR_BUCKETS) expect(isArBucket(k)).toBe(true);
    for (const k of AP_BUCKETS) expect(isApBucket(k)).toBe(true);
    // A query string is user input; an unknown value must fall back to "all"
    // rather than filtering by something nobody defined.
    expect(isArBucket("awaiting_approval")).toBe(false);
    expect(isApBucket("not_deposited")).toBe(false);
    expect(isArBucket(undefined)).toBe(false);
    expect(isArBucket("'; drop table invoices; --")).toBe(false);
  });
});
