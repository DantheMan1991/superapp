import { describe, expect, it } from "vitest";
import {
  ageInDays,
  formatAge,
  formatRate,
  headEffect,
  mortalityRate,
  preferredIdentifier,
  summariseHead,
} from "../src/packs/livestock/core/herd";

/**
 * The pure half of `livestock`: head arithmetic.
 *
 * The head count is a BALANCE, never a counter — so all of this is a fold over
 * the ledger `inventory` already keeps. What is worth asserting is the
 * classification (which movement kinds mean a death rather than a move) and the
 * two places a wrong answer would be actively misleading: mortality before
 * anything has arrived, and an unknown birth date.
 */

const m = (movementKind: string, quantity: number) => ({ movementKind, quantity });

describe("headEffect", () => {
  it("classifies the kinds livestock writes", () => {
    expect(headEffect("placement")).toBe("intake");
    expect(headEffect("death")).toBe("death");
    expect(headEffect("cull")).toBe("removal");
    expect(headEffect("sold_live")).toBe("removal");
    expect(headEffect("split_out")).toBe("transfer");
    expect(headEffect("split_in")).toBe("transfer");
  });

  it("treats an unrecognised kind as a transfer", () => {
    // `movement_kind` is an open taxonomy, so this file WILL meet kinds it has
    // never heard of. Transfer is the safe assumption: it moves head without
    // claiming anything was placed or lost.
    expect(headEffect("weighed_out")).toBe("transfer");
  });
});

describe("summariseHead", () => {
  it("reproduces the design's worked example, and it balances to zero", () => {
    // Placed +70, died −4, culled −2, transferred −64 → balance 0.
    const summary = summariseHead([
      m("placement", 70),
      m("death", -4),
      m("cull", -2),
      m("split_out", -64),
    ]);
    expect(summary.intake).toBe(70);
    expect(summary.died).toBe(4);
    expect(summary.removed).toBe(2);
    expect(summary.balance).toBe(0);
  });

  it("counts a transfer IN as intake, so a pen has a mortality denominator", () => {
    // A pen split off a batch has no `placement` of its own. Without this its
    // mortality would divide by zero and read as unknown forever, which is the
    // number the broiler enterprise actually lives on.
    const summary = summariseHead([m("split_in", 70), m("death", -7)]);
    expect(summary.intake).toBe(70);
    expect(summary.balance).toBe(63);
    expect(mortalityRate(summary)).toBeCloseTo(0.1, 5);
  });

  it("does not let a transfer OUT reduce intake", () => {
    const summary = summariseHead([m("placement", 100), m("split_out", -40)]);
    expect(summary.intake).toBe(100);
    expect(summary.balance).toBe(60);
  });

  it("is all zeros for a lot with no movements", () => {
    const summary = summariseHead([]);
    expect(summary).toEqual({
      intake: 0,
      died: 0,
      removed: 0,
      transferred: 0,
      balance: 0,
    });
  });
});

describe("mortalityRate", () => {
  it("is deaths over everything that arrived", () => {
    expect(
      mortalityRate(summariseHead([m("placement", 1000), m("death", -50)])),
    ).toBeCloseTo(0.05, 5);
  });

  it("is NULL when nothing has arrived, not zero", () => {
    // "No deaths" and "no animals" are different facts, and a lot showing 0%
    // before a single chick is placed reads as reassurance.
    expect(mortalityRate(summariseHead([]))).toBeNull();
    expect(formatRate(null)).toBe("—");
  });

  it("formats to one decimal, which is the precision that matters", () => {
    // At 1,000 birds the gap between 5% and 12% is most of the margin.
    expect(formatRate(0.05)).toBe("5.0%");
    expect(formatRate(0.1234)).toBe("12.3%");
  });
});

describe("age", () => {
  it("is null when the birth date is unknown", () => {
    // The ordinary case for stock bought in, and it must not read as newborn.
    expect(ageInDays(null, "2026-08-15")).toBeNull();
    expect(formatAge(null)).toBe("—");
  });

  it("counts days across months and a leap day", () => {
    expect(ageInDays("2026-08-01", "2026-08-15")).toBe(14);
    expect(ageInDays("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("switches units with the animal, because precision matters differently", () => {
    // A broiler's life is measured in weeks and it matters; nobody describes a
    // cow as 1,340 days old.
    expect(formatAge(1)).toBe("1 day");
    expect(formatAge(10)).toBe("10 days");
    expect(formatAge(49)).toBe("7 weeks");
    expect(formatAge(200)).toBe("6 months");
    expect(formatAge(1340)).toBe("3 years");
  });

  it("says 'not yet' rather than a negative age", () => {
    expect(formatAge(-3)).toBe("not yet");
  });
});

describe("preferredIdentifier", () => {
  const id = (kind: string, value: string, removedOn: string | null = null) => ({
    identifierKind: kind,
    value,
    removedOn,
  });

  it("prefers a current tag over a removed one", () => {
    const chosen = preferredIdentifier([
      id("visual", "47", "2026-07-01"),
      id("official", "USA-840", null),
    ]);
    expect(chosen?.value).toBe("USA-840");
  });

  it("prefers what a person says over what paperwork says", () => {
    const chosen = preferredIdentifier([
      id("official", "USA-840"),
      id("name", "Daisy"),
      id("visual", "47"),
    ]);
    expect(chosen?.value).toBe("Daisy");
  });

  it("falls back to a removed tag rather than nothing", () => {
    // "#47 (removed)" beats no answer when somebody is trying to identify an
    // animal in front of them.
    const chosen = preferredIdentifier([id("visual", "47", "2026-07-01")]);
    expect(chosen?.value).toBe("47");
  });

  it("handles a kind it has never heard of", () => {
    const chosen = preferredIdentifier([id("brand", "Lazy K")]);
    expect(chosen?.value).toBe("Lazy K");
  });

  it("is null when there are none", () => {
    expect(preferredIdentifier([])).toBeNull();
  });
});
