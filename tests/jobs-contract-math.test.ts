import { describe, expect, it } from "vitest";
import {
  type ChangeOrderRowLike,
  type ContractLike,
  contractSummary,
} from "@/packs/jobs/contract-math";

/**
 * What a job's agreements are worth.
 *
 * These rules used to live inline in the project page, where the Contracts and
 * Changes panels shared them by being in the same file. Splitting the page into
 * tabs (jobs redesign 2a) made them a shared function, and the point of these
 * cases is that the two screens can never drift into disagreeing about what a
 * job is worth.
 */

const contract = (over: Partial<ContractLike> = {}): ContractLike => ({
  id: "c1",
  status: "signed",
  valueCents: 100_000_00,
  ...over,
});

const change = (
  contractId: string,
  status: string,
  valueCents: number,
): ChangeOrderRowLike => ({
  changeOrder: { status, valueCents },
  contract: { id: contractId },
});

describe("contractSummary", () => {
  it("counts only signed and complete agreements", () => {
    const s = contractSummary(
      [
        contract({ id: "a", status: "signed", valueCents: 100_000_00 }),
        contract({ id: "b", status: "complete", valueCents: 50_000_00 }),
        contract({ id: "c", status: "proposed", valueCents: 900_000_00 }),
        contract({ id: "d", status: "declined", valueCents: 900_000_00 }),
        contract({ id: "e", status: "cancelled", valueCents: 900_000_00 }),
      ],
      [],
    );
    expect(s.signedCount).toBe(2);
    expect(s.signedValue).toBe(150_000_00);
    // A concept the client has not signed is not money, however large.
    expect(s.proposedCount).toBe(1);
  });

  it("moves the revised value by approved changes only", () => {
    const s = contractSummary(
      [contract({ id: "a", valueCents: 100_000_00 })],
      [
        change("a", "approved", 15_000_00),
        change("a", "proposed", 40_000_00),
        change("a", "rejected", 80_000_00),
      ],
    );
    expect(s.signedValue).toBe(115_000_00);
    expect(s.changesValue).toBe(15_000_00);
    expect(s.approvedCount).toBe(1);
    expect(s.proposedChangeCount).toBe(1);
  });

  it("nets a deduction against the additions", () => {
    // A deduction is a negative change, not a separate kind of thing.
    const s = contractSummary(
      [contract({ id: "a", valueCents: 100_000_00 })],
      [change("a", "approved", 20_000_00), change("a", "approved", -5_000_00)],
    );
    expect(s.changesValue).toBe(15_000_00);
    expect(s.signedValue).toBe(115_000_00);
  });

  it("never reads a change on a contract that does not count", () => {
    // The change is summed into the map and then ignored, because only
    // `valued` contracts are added up. A proposed contract's approved change
    // must not leak into the job's value.
    const s = contractSummary(
      [
        contract({ id: "a", status: "signed", valueCents: 100_000_00 }),
        contract({ id: "b", status: "proposed", valueCents: 500_000_00 }),
      ],
      [change("b", "approved", 90_000_00)],
    );
    expect(s.signedValue).toBe(100_000_00);
    expect(s.changesValue).toBe(0);
    // It is still counted as an approved change order, because it is one.
    expect(s.approvedCount).toBe(1);
  });

  it("treats a contract with no value as zero, not as absent", () => {
    const s = contractSummary(
      [contract({ id: "a", valueCents: null })],
      [change("a", "approved", 7_500_00)],
    );
    expect(s.signedCount).toBe(1);
    expect(s.revisedOf({ id: "a", valueCents: null })).toBe(7_500_00);
    expect(s.signedValue).toBe(7_500_00);
  });

  it("is all zeroes for a job with nothing on it", () => {
    const s = contractSummary([], []);
    expect(s).toMatchObject({
      signedValue: 0,
      changesValue: 0,
      signedCount: 0,
      approvedCount: 0,
      proposedChangeCount: 0,
      proposedCount: 0,
    });
    expect(s.valued).toEqual([]);
  });
});
