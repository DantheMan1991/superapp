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
import {
  checkStreak,
  daysSinceCheck,
  formatLastChecked,
  lossesOn,
  roundProgress,
} from "../src/packs/livestock/core/daily";
import { breedHint } from "../src/packs/livestock/vocabulary";

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

describe("breedHint", () => {
  /**
   * The breed field carried a fixed "e.g. Cornish Cross", which sat under
   * Species: Cattle and read as an instruction rather than an example.
   * Reported by the founder, 2026-08-16.
   */
  it("follows the species chosen", () => {
    expect(breedHint("cattle")).toBe("e.g. Angus");
    expect(breedHint("poultry")).toBe("e.g. Cornish Cross");
  });

  it("gives NO hint for a species it does not know", () => {
    // Species is an open taxonomy fed by profile config, so this is the
    // ordinary path for anything a profile invents. An empty box beats a
    // confident irrelevance, which is the bug being fixed.
    expect(breedHint("alpaca")).toBeUndefined();
    expect(breedHint("")).toBeUndefined();
  });

  it("matches the way the form slugs a typed species", () => {
    // The picker's "Something else…" lets a person type "Beef Cattle", and
    // the form lowercases and underscores it before submitting. The hint has
    // to survive the same treatment or it only works for picker values.
    expect(breedHint("Cattle")).toBe("e.g. Angus");
    expect(breedHint("  POULTRY  ")).toBe("e.g. Cornish Cross");
  });
});

/**
 * The daily round.
 *
 * What is worth asserting here is not the arithmetic — it is the two places a
 * defensible-looking answer would quietly destroy the habit the slice exists to
 * build: a streak that resets every morning, and a "never checked" that renders
 * as zero days.
 */
describe("checkStreak", () => {
  it("counts consecutive days back from today", () => {
    expect(
      checkStreak(["2026-08-19", "2026-08-18", "2026-08-17"], "2026-08-19"),
    ).toBe(3);
  });

  it("does NOT break because today has not been walked yet", () => {
    // The whole point. At breakfast today has no entry, and a counter that
    // dropped to zero every morning would be a counter nobody keeps — so the
    // run is measured from yesterday when today is untouched.
    expect(checkStreak(["2026-08-18", "2026-08-17"], "2026-08-19")).toBe(2);
  });

  it("breaks after two days of silence", () => {
    // Yesterday is the furthest back the grace extends. A missed day is a
    // missed day, and a streak that forgives them means nothing.
    expect(checkStreak(["2026-08-17", "2026-08-16"], "2026-08-19")).toBe(0);
  });

  it("stops at the first gap rather than counting every entry", () => {
    expect(
      checkStreak(
        ["2026-08-19", "2026-08-18", "2026-08-15", "2026-08-14"],
        "2026-08-19",
      ),
    ).toBe(2);
  });

  it("ignores duplicate days and unsorted input", () => {
    // The query returns distinct days, but the order is the database's choice
    // and this must not depend on it.
    expect(
      checkStreak(
        ["2026-08-18", "2026-08-19", "2026-08-18", "2026-08-17"],
        "2026-08-19",
      ),
    ).toBe(3);
  });

  it("is zero when nothing has ever been recorded", () => {
    expect(checkStreak([], "2026-08-19")).toBe(0);
  });

  it("crosses a month boundary", () => {
    expect(
      checkStreak(["2026-09-01", "2026-08-31", "2026-08-30"], "2026-09-01"),
    ).toBe(3);
  });
});

describe("roundProgress", () => {
  const check = (livestockLotId: string, status = "normal") => ({
    livestockLotId,
    loggedOn: "2026-08-19",
    status,
  });

  it("names the lots still to look at, not just how many", () => {
    // `remaining` is what the "all normal" button acts on, so it has to be the
    // exact set — a count could not tell it which lots to leave alone.
    const progress = roundProgress(["a", "b", "c"], [check("b")]);
    expect(progress).toEqual({
      total: 3,
      checked: 1,
      remaining: ["a", "c"],
      needsAttention: [],
    });
  });

  it("separates a lot that was flagged from one that was never touched", () => {
    // The distinction this slice is built on. A flagged lot has been looked at
    // — it must not reappear in the list the one-tap button sweeps.
    const progress = roundProgress(["a", "b"], [check("a", "attention")]);
    expect(progress.remaining).toEqual(["b"]);
    expect(progress.needsAttention).toEqual(["a"]);
    expect(progress.checked).toBe(1);
  });

  it("ignores checks for lots that are not in the round", () => {
    // A lot whose animals have all gone is off the list, but its check for
    // today still exists and must not inflate the count.
    const progress = roundProgress(["a"], [check("a"), check("gone")]);
    expect(progress.total).toBe(1);
    expect(progress.checked).toBe(1);
  });

  it("is empty and complete when there is nothing to check", () => {
    expect(roundProgress([], [])).toEqual({
      total: 0,
      checked: 0,
      remaining: [],
      needsAttention: [],
    });
  });
});

describe("last checked", () => {
  it("distinguishes never from today", () => {
    // NULL IS NOT ZERO. A lot nobody has ever checked is the thing the round
    // screen exists to surface, and "0 days ago" would read as the opposite.
    expect(daysSinceCheck(null, "2026-08-19")).toBeNull();
    expect(formatLastChecked(null, "2026-08-19")).toBe("Never");
    expect(formatLastChecked("2026-08-19", "2026-08-19")).toBe("Today");
  });

  it("says yesterday rather than 1 day ago", () => {
    expect(formatLastChecked("2026-08-18", "2026-08-19")).toBe("Yesterday");
    expect(formatLastChecked("2026-08-16", "2026-08-19")).toBe("3 days ago");
  });

  it("treats a future-dated check as today rather than as negative days", () => {
    // Possible across a timezone boundary at midnight. "-1 days ago" is
    // nonsense; "Today" is at worst a few hours early.
    expect(formatLastChecked("2026-08-20", "2026-08-19")).toBe("Today");
  });
});

describe("lossesOn", () => {
  const mv = (occurredOn: string, movementKind: string, quantity: number) => ({
    occurredOn,
    movementKind,
    quantity,
  });

  it("adds up the day's losses from the LEDGER, not from the check", () => {
    // The losses are not stored on the daily log, so this is how the round
    // screen shows them. One number, read twice — never two kept in step.
    expect(
      lossesOn(
        [
          mv("2026-08-19", "death", -3),
          mv("2026-08-19", "cull", -1),
          mv("2026-08-18", "death", -9),
        ],
        "2026-08-19",
      ),
    ).toBe(4);
  });

  it("counts neither placements nor splits as losses", () => {
    expect(
      lossesOn(
        [
          mv("2026-08-19", "placement", 210),
          mv("2026-08-19", "split_out", -70),
          mv("2026-08-19", "sold_live", -2),
        ],
        "2026-08-19",
      ),
    ).toBe(0);
  });

  it("is zero on a day nothing was recorded", () => {
    expect(lossesOn([mv("2026-08-18", "death", -3)], "2026-08-19")).toBe(0);
  });
});
