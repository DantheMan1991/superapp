import { describe, expect, it } from "vitest";
import {
  existingLineFor,
  lineVariance,
  postedOnAllowed,
} from "../src/packs/inventory/core/counts";

/**
 * The pure half of counting — what the count dialog previews and what
 * `postCount` enforces, pinned once so the two cannot drift.
 */
describe("existingLineFor", () => {
  const lines = [
    { itemId: "feed", lotId: null, countedQuantity: 795, notes: "back shelf" },
    { itemId: "feed", lotId: "lot-a", countedQuantity: 100, notes: "" },
    { itemId: "beef", lotId: "lot-b", countedQuantity: 55, notes: "" },
  ];

  it("finds the shelf already on the count — same item, same batch", () => {
    expect(existingLineFor(lines, "feed", "lot-a")?.countedQuantity).toBe(100);
    expect(existingLineFor(lines, "beef", "lot-b")?.countedQuantity).toBe(55);
  });

  it("treats no batch as a shelf of its own, and null and undefined as the same no-batch", () => {
    expect(existingLineFor(lines, "feed", null)?.countedQuantity).toBe(795);
    expect(existingLineFor(lines, "feed", undefined)?.notes).toBe("back shelf");
    // Beef was only ever counted against a batch, so "all of it" is unwritten.
    expect(existingLineFor(lines, "beef", null)).toBeNull();
  });

  it("is null for a shelf nobody has written down", () => {
    expect(existingLineFor(lines, "feed", "lot-z")).toBeNull();
    expect(existingLineFor([], "feed", null)).toBeNull();
  });
});

describe("lineVariance", () => {
  it("is nothing before the record is consulted", () => {
    expect(lineVariance(92, null)).toBeNull();
  });

  it("is counted less expected, at the column's scale", () => {
    expect(lineVariance(92, 100)).toBe(-8);
    expect(lineVariance(103, 100)).toBe(3);
    expect(lineVariance(100, 100)).toBe(0);
    // Floating point does not leak into a figure the page prints.
    expect(lineVariance(0.1 + 0.2, 0)).toBe(0.3);
  });
});

describe("postedOnAllowed", () => {
  it("posts on the day it was counted or after, never before", () => {
    expect(postedOnAllowed("2026-09-09", "2026-09-09")).toBe(true);
    expect(postedOnAllowed("2026-09-09", "2026-09-12")).toBe(true);
    expect(postedOnAllowed("2026-09-09", "2026-09-08")).toBe(false);
  });
});
