import { describe, expect, it } from "vitest";
import {
  allocateCents,
  dimensionKey,
  splitByDimension,
} from "@/modules/time/core/allocate";

/**
 * The apportionment, and the one property that matters: NOTHING IS LOST.
 *
 * A journal entry that does not sum to zero does not post, so every test here
 * that checks a total is checking whether the period can reach the books at
 * all — not whether a report is pretty.
 */
describe("allocateCents", () => {
  it("gives an exact split exactly", () => {
    expect(allocateCents(1000, [1, 1])).toEqual([500, 500]);
  });

  it("never loses the odd cent", () => {
    // $10.00 three ways is 3.33 each and a cent over. The cent has to land.
    const shares = allocateCents(1000, [1, 1, 1]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(shares).toEqual([334, 333, 333]);
  });

  it("splits by weight, not by head count", () => {
    expect(allocateCents(10000, [3, 1])).toEqual([7500, 2500]);
  });

  it("hands leftovers to whoever the floor robbed most", () => {
    // 100 over weights 1/2/2: exact is 20, 40, 40 — no remainder at all.
    expect(allocateCents(100, [1, 2, 2])).toEqual([20, 40, 40]);
    // 100 over 1/1/1: 33.33 each, one cent over, first bucket takes it.
    expect(allocateCents(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it("is stable, so re-posting a period does not shuffle cents", () => {
    const once = allocateCents(1001, [7, 7, 7, 7]);
    const twice = allocateCents(1001, [7, 7, 7, 7]);
    expect(once).toEqual(twice);
    expect(once.reduce((a, b) => a + b, 0)).toBe(1001);
  });

  it("keeps the total whatever the weights are", () => {
    const cases: Array<[number, number[]]> = [
      [1, [1, 1, 1, 1, 1]],
      [99, [17, 3, 41, 2]],
      [123457, [1, 2, 3, 4, 5, 6, 7]],
      [7, [1000000, 1]],
    ];
    for (const [total, weights] of cases) {
      const shares = allocateCents(total, weights);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
      expect(shares.every((c) => c >= 0)).toBe(true);
    }
  });

  it("puts money somewhere rather than nowhere when there is no basis", () => {
    expect(allocateCents(500, [0, 0, 0])).toEqual([500, 0, 0]);
  });

  it("has nothing to say about no buckets", () => {
    expect(allocateCents(500, [])).toEqual([]);
  });

  it("handles a zero total without inventing a cent", () => {
    expect(allocateCents(0, [5, 5])).toEqual([0, 0]);
  });
});

describe("dimensionKey", () => {
  it("treats the same pair of tags as the same key whatever the order", () => {
    expect(dimensionKey(["b", "a"])).toBe(dimensionKey(["a", "b"]));
  });

  it("gives untagged hours a key of their own", () => {
    expect(dimensionKey([])).toBe("");
    expect(dimensionKey([])).not.toBe(dimensionKey(["a"]));
  });
});

describe("splitByDimension", () => {
  const tagged = (minutes: number, ...memberIds: string[]) => ({
    minutes,
    memberIds,
  });

  it("puts each enterprise's hours on its own line", () => {
    const splits = splitByDimension(
      [tagged(120, "beef"), tagged(60, "hay")],
      9000,
    );
    expect(splits).toEqual([
      { memberIds: ["beef"], minutes: 120, cents: 6000 },
      { memberIds: ["hay"], minutes: 60, cents: 3000 },
    ]);
  });

  it("adds up hours tagged the same way", () => {
    const splits = splitByDimension(
      [tagged(60, "beef"), tagged(30, "hay"), tagged(30, "beef")],
      1200,
    );
    expect(splits).toHaveLength(2);
    expect(splits[0]).toEqual({ memberIds: ["beef"], minutes: 90, cents: 900 });
  });

  it("keeps a two-tag hour whole instead of counting it twice", () => {
    // One hour tagged with an enterprise AND a parcel is ONE line carrying
    // both, not an hour against each.
    const splits = splitByDimension([tagged(60, "beef", "north-field")], 2400);
    expect(splits).toHaveLength(1);
    expect(splits[0].memberIds).toEqual(["beef", "north-field"]);
    expect(splits[0].cents).toBe(2400);
  });

  it("groups the same pair of tags however they were written", () => {
    const splits = splitByDimension(
      [tagged(60, "beef", "north"), tagged(60, "north", "beef")],
      1000,
    );
    expect(splits).toHaveLength(1);
    expect(splits[0].minutes).toBe(120);
  });

  it("keeps untagged hours rather than dropping their cost", () => {
    const splits = splitByDimension([tagged(60, "beef"), tagged(60)], 2000);
    expect(splits).toHaveLength(2);
    expect(splits[1].memberIds).toEqual([]);
    expect(splits.reduce((s, x) => s + x.cents, 0)).toBe(2000);
  });

  it("always splits the whole gross, odd cents and all", () => {
    const splits = splitByDimension(
      [tagged(37, "a"), tagged(41, "b"), tagged(13, "c")],
      100001,
    );
    expect(splits.reduce((s, x) => s + x.cents, 0)).toBe(100001);
  });

  it("drops a group worth nothing, because that is not a journal line", () => {
    // An unpaid week: real hours, no money. Nothing should post.
    expect(splitByDimension([tagged(60, "beef")], 0)).toEqual([]);
  });

  it("returns groups in the order the hours were logged", () => {
    const splits = splitByDimension(
      [tagged(60, "zebra"), tagged(60, "apple")],
      1000,
    );
    expect(splits.map((s) => s.memberIds[0])).toEqual(["zebra", "apple"]);
  });

  it("has nothing to post for nobody", () => {
    expect(splitByDimension([], 5000)).toEqual([]);
  });
});
