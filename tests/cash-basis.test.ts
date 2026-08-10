import { describe, expect, it } from "vitest";
import {
  allocateDocument,
  splitProportional,
  type DocumentPayment,
  type RecognitionLine,
} from "../src/modules/accounting/core/cash-basis-allocate";

/**
 * The cash-basis allocator. This is the only division in report math (P5), so
 * it is tested to the cent — a rounding bug here shows up as a cash-basis
 * trial balance that does not balance, or as revenue quietly invented or lost.
 */

function income(accountId: string, cents: number, memberId: string | null = null): RecognitionLine {
  // Income lines are credits in this ledger, so they arrive negative.
  return { accountId, memberId, amountCents: -cents };
}

function pay(id: string, cents: number): DocumentPayment {
  return { paymentEntryId: id, amountCents: cents };
}

function sumOf(lines: RecognitionLine[]): number {
  return lines.reduce((s, l) => s + l.amountCents, 0);
}

describe("splitProportional", () => {
  it("splits exactly when it divides evenly", () => {
    expect(splitProportional([-1000, -1000], -1000, -2000)).toEqual([-500, -500]);
  });

  it("gives leftover cents to the largest remainders, summing exactly", () => {
    const out = splitProportional([-1000, -1000, -1000], -1000, -3000);
    expect(out.reduce((s, n) => s + n, 0)).toBe(-1000);
    expect(out).toEqual([-334, -333, -333]);
  });

  it("never allocates more than a line holds", () => {
    const remaining = [-1, -1, -997];
    const out = splitProportional(remaining, -999, -999);
    expect(out.reduce((s, n) => s + n, 0)).toBe(-999);
    for (let i = 0; i < out.length; i++) {
      expect(Math.abs(out[i])).toBeLessThanOrEqual(Math.abs(remaining[i]));
    }
  });

  it("works in the debit direction too (bills)", () => {
    // 333.33 and 666.67 — the spare cent goes to the larger fraction, not to
    // the first line. Ties (and only ties) break by index.
    const out = splitProportional([1000, 2000], 1000, 3000);
    expect(out.reduce((s, n) => s + n, 0)).toBe(1000);
    expect(out).toEqual([333, 667]);
  });

  it("handles mixed signs — an invoice with a discount line", () => {
    // Two income credits and one contra-revenue debit; net -1800.
    const remaining = [-1000, -1000, 200];
    const out = splitProportional(remaining, -900, -1800);
    expect(out.reduce((s, n) => s + n, 0)).toBe(-900);
    // Each share keeps its own line's sign.
    expect(out[0]).toBeLessThan(0);
    expect(out[1]).toBeLessThan(0);
    expect(out[2]).toBeGreaterThan(0);
  });

  it("is a no-op on a zero target or zero total", () => {
    expect(splitProportional([-100], 0, -100)).toEqual([0]);
    expect(splitProportional([0], -100, 0)).toEqual([0]);
  });

  it("skips zero-amount lines", () => {
    const out = splitProportional([-1000, 0, -1000], -1000, -2000);
    expect(out[1]).toBe(0);
    expect(out.reduce((s, n) => s + n, 0)).toBe(-1000);
  });

  it("is deterministic", () => {
    const a = splitProportional([-333, -333, -334], -500, -1000);
    const b = splitProportional([-333, -333, -334], -500, -1000);
    expect(a).toEqual(b);
  });

  it("stays exact at amounts that would lose precision as doubles", () => {
    // Both factors large enough that lineAmount * paymentAmount exceeds 2^53.
    const remaining = [-90_000_000_000, -10_000_000_000];
    const out = splitProportional(remaining, -50_000_000_000, -100_000_000_000);
    expect(out.reduce((s, n) => s + n, 0)).toBe(-50_000_000_000);
    expect(out).toEqual([-45_000_000_000, -5_000_000_000]);
  });
});

describe("allocateDocument", () => {
  it("a single full payment recognises the whole document", () => {
    const [alloc] = allocateDocument([income("rent", 175_000)], [pay("p1", 175_000)]);
    expect(alloc.allocatedCents).toBe(175_000);
    expect(sumOf(alloc.lines)).toBe(-175_000);
  });

  it("a partial payment recognises its proportion, and only that", () => {
    const [alloc] = allocateDocument([income("rent", 100_000)], [pay("p1", 40_000)]);
    expect(alloc.allocatedCents).toBe(40_000);
    expect(sumOf(alloc.lines)).toBe(-40_000);
  });

  it("instalments recognise the full document exactly, never more", () => {
    const lines = [income("rent", 100_000), income("fees", 33_333)];
    const allocs = allocateDocument(lines, [
      pay("p1", 40_000),
      pay("p2", 40_000),
      pay("p3", 53_333),
    ]);
    // Every payment balances on its own...
    expect(sumOf(allocs[0].lines)).toBe(-40_000);
    expect(sumOf(allocs[1].lines)).toBe(-40_000);
    expect(sumOf(allocs[2].lines)).toBe(-53_333);
    // ...and the document is recognised exactly once in total.
    const total = allocs.reduce((s, a) => s + sumOf(a.lines), 0);
    expect(total).toBe(-133_333);

    // Per line, too — no cent drifts between accounts.
    const byAccount = new Map<string, number>();
    for (const a of allocs) {
      for (const l of a.lines) {
        byAccount.set(l.accountId, (byAccount.get(l.accountId) ?? 0) + l.amountCents);
      }
    }
    expect(byAccount.get("rent")).toBe(-100_000);
    expect(byAccount.get("fees")).toBe(-33_333);
  });

  it("recognises nothing beyond the document total on an overpayment", () => {
    const [alloc] = allocateDocument([income("rent", 100_000)], [pay("p1", 120_000)]);
    expect(alloc.allocatedCents).toBe(100_000);
    expect(sumOf(alloc.lines)).toBe(-100_000);
    // The caller leaves the 20,000 residual on AR — unapplied cash is owed
    // back to the customer, it is not revenue.
  });

  it("allocates nothing to payments arriving after the document is settled", () => {
    const allocs = allocateDocument(
      [income("rent", 100_000)],
      [pay("p1", 100_000), pay("p2", 5_000)],
    );
    expect(allocs[0].allocatedCents).toBe(100_000);
    expect(allocs[1].allocatedCents).toBe(0);
    expect(allocs[1].lines).toEqual([]);
  });

  it("carries the source line's dimension member onto the allocation", () => {
    const [alloc] = allocateDocument(
      [income("rent", 100_000, "property-a"), income("rent", 50_000, "property-b")],
      [pay("p1", 75_000)],
    );
    expect(sumOf(alloc.lines)).toBe(-75_000);
    expect(alloc.lines.map((l) => l.memberId).sort()).toEqual([
      "property-a",
      "property-b",
    ]);
  });

  it("works for a bill, where the lines are debits", () => {
    const expense: RecognitionLine[] = [
      { accountId: "repairs", memberId: null, amountCents: 60_000 },
      { accountId: "supplies", memberId: null, amountCents: 40_000 },
    ];
    const allocs = allocateDocument(expense, [pay("p1", 50_000), pay("p2", 50_000)]);
    expect(sumOf(allocs[0].lines)).toBe(50_000);
    expect(sumOf(allocs[1].lines)).toBe(50_000);
    expect(allocs.reduce((s, a) => s + sumOf(a.lines), 0)).toBe(100_000);
  });

  it("handles a document with a discount line across instalments", () => {
    const lines: RecognitionLine[] = [
      { accountId: "sales", memberId: null, amountCents: -100_000 },
      { accountId: "discounts", memberId: null, amountCents: 10_000 },
    ];
    const allocs = allocateDocument(lines, [pay("p1", 30_000), pay("p2", 60_000)]);
    expect(sumOf(allocs[0].lines)).toBe(-30_000);
    expect(sumOf(allocs[1].lines)).toBe(-60_000);

    const byAccount = new Map<string, number>();
    for (const a of allocs) {
      for (const l of a.lines) {
        byAccount.set(l.accountId, (byAccount.get(l.accountId) ?? 0) + l.amountCents);
      }
    }
    // 90,000 of 90,000 net recognised, split in the lines' own proportions.
    expect((byAccount.get("sales") ?? 0) + (byAccount.get("discounts") ?? 0)).toBe(
      -90_000,
    );
    expect(byAccount.get("discounts")).toBeGreaterThan(0);
  });

  it("recognises nothing for a document with no net amount", () => {
    const allocs = allocateDocument(
      [
        { accountId: "a", memberId: null, amountCents: -1000 },
        { accountId: "b", memberId: null, amountCents: 1000 },
      ],
      [pay("p1", 500)],
    );
    expect(allocs[0].allocatedCents).toBe(0);
    expect(allocs[0].lines).toEqual([]);
  });

  it("recognises nothing when there are no payments", () => {
    expect(allocateDocument([income("rent", 100_000)], [])).toEqual([]);
  });

  it("a one-cent payment against a many-line document still balances", () => {
    const lines = Array.from({ length: 7 }, (_, i) => income(`line-${i}`, 1_000));
    const [alloc] = allocateDocument(lines, [pay("p1", 1)]);
    expect(sumOf(alloc.lines)).toBe(-1);
    expect(alloc.allocatedCents).toBe(1);
  });
});
