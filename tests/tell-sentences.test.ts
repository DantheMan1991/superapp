import { describe, expect, it } from "vitest";
import {
  casesFor,
  isAcceptable,
  sameAnswer,
  TELL_CASES,
} from "./fixtures/tell-sentences";

/**
 * The golden set's own hygiene — `npm run tell:eval` is what measures the
 * MODEL, and this is what stops the thing measuring it from rotting.
 *
 * A fixture nobody checks decays in one specific way: a case names an action
 * that has been renamed, or lists the wrong sources in `needs`, and the runner
 * quietly skips it. The accuracy figure goes UP, because the hard cases are the
 * ones that stop running. That failure has to be impossible rather than
 * unlikely, so it is asserted here and the catalogue half is asserted against
 * real actions in `tell-catalogue-db.test.ts`.
 */

describe("the golden set is well formed", () => {
  it("every case says what it is for", () => {
    for (const c of TELL_CASES) {
      expect(c.said.trim(), `a case with no sentence`).not.toBe("");
      expect(
        c.why.trim(),
        `"${c.said}" does not say why it is hard — a case that cannot answer that costs a model call and proves nothing`,
      ).not.toBe("");
    }
  });

  it("no sentence is asked twice", () => {
    const seen = new Map<string, number>();
    for (const c of TELL_CASES) {
      const key = c.said.trim().toLowerCase();
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const repeated = [...seen.entries()].filter(([, n]) => n > 1).map(([s]) => s);
    expect(repeated, "the same sentence twice pays twice and proves once").toEqual([]);
  });

  it("every expected slug is <source>.<verb>", () => {
    for (const c of TELL_CASES) {
      for (const slug of [...c.expect, ...(c.tolerate ?? []).flat()]) {
        expect(slug, `"${c.said}" expects ${slug}`).toMatch(/^[a-z][a-z-]*\.[a-z][a-z_]*$/);
      }
    }
  });

  /**
   * **THE ONE THAT MATTERS.** `casesFor` skips a case whose sources are not all
   * enabled. A case expecting `work.add` while naming only `livestock` in
   * `needs` would therefore run on a farm with no Work switched on, and fail
   * for a reason that has nothing to do with the model — or worse, be skipped
   * on the tenant where it was meant to run.
   */
  it("every source a case expects is a source it says it needs", () => {
    for (const c of TELL_CASES) {
      const answers = [...c.expect, ...(c.tolerate ?? []).flat()];
      for (const slug of answers) {
        const source = slug.split(".")[0];
        expect(
          c.needs,
          `"${c.said}" can produce ${slug} but does not list "${source}" in needs, so it would run where it cannot pass`,
        ).toContain(source);
      }
    }
  });

  it("a tolerated answer is a different answer", () => {
    for (const c of TELL_CASES) {
      for (const alt of c.tolerate ?? []) {
        expect(
          sameAnswer(alt, c.expect),
          `"${c.said}" tolerates the answer it already expects`,
        ).toBe(false);
      }
    }
  });

  it("the set covers every source it names", () => {
    const named = new Set(TELL_CASES.flatMap((c) => c.expect.map((s) => s.split(".")[0])));
    // A source in the plan with no case at all is a source nobody is measuring.
    for (const source of ["time", "work", "livestock"]) {
      expect(named, `no case exercises ${source}`).toContain(source);
    }
  });

  it("keeps the cases that say nothing should happen", () => {
    // A box that reaches for the nearest verb when nothing happened is worse
    // than one that shrugs, and only an empty-answer case can catch it.
    const refusals = TELL_CASES.filter((c) => c.expect.length === 0);
    expect(refusals.length, "nothing asserts that a non-event stays a non-event").toBeGreaterThan(0);
  });
});

describe("scoring", () => {
  it("is order-insensitive but counts duplicates", () => {
    expect(sameAnswer(["a.x", "b.y"], ["b.y", "a.x"])).toBe(true);
    // Three checks in one breath is not one check: the round said three pens.
    expect(sameAnswer(["a.x", "a.x", "a.x"], ["a.x"])).toBe(false);
    expect(sameAnswer([], [])).toBe(true);
  });

  it("accepts a tolerated answer and nothing else", () => {
    const c = {
      said: "s",
      expect: ["a.x"],
      tolerate: [["b.y"]],
      why: "w",
      needs: ["a", "b"],
    };
    expect(isAcceptable(c, ["a.x"])).toBe(true);
    expect(isAcceptable(c, ["b.y"])).toBe(true);
    expect(isAcceptable(c, ["c.z"])).toBe(false);
    expect(isAcceptable(c, [])).toBe(false);
  });
});

describe("casesFor", () => {
  it("offers only what this tenant could answer", () => {
    const farm = casesFor(["livestock", "land", "inventory"]);
    expect(farm.every((c) => !c.needs.includes("work"))).toBe(true);
    expect(farm.length).toBeGreaterThan(0);

    // A tenant with nothing still gets the "nothing happened" cases, which is
    // right: those are about the model not inventing, and need no source.
    const bare = casesFor([]);
    expect(bare.every((c) => c.needs.length === 0)).toBe(true);
  });
});
