import { describe, expect, it } from "vitest";
import { chooseSite } from "../src/lib/sites/choose";

/**
 * Which website a screen is about (`src/lib/sites/choose.ts`, ADR 0045).
 *
 * Pure and tested because TWO screens ask — the Website screen and the shot
 * list — and a rule two callers implement separately is a rule they will
 * eventually disagree about. The cases that matter are the ones where a
 * business has exactly one site: it must never be shown a list, never be
 * stranded by a stale `?site=` in a bookmark, and never learn the plural
 * exists.
 */

const one = [{ id: "a" }];
const two = [{ id: "a" }, { id: "b" }];

describe("a business with no website", () => {
  it("chooses nothing and shows no list — the screen draws its build form", () => {
    expect(chooseSite([], undefined)).toEqual({ site: null, wantsNew: false, showList: false });
  });

  it("still shows no list when a stale id is asked for", () => {
    expect(chooseSite([], "a")).toEqual({ site: null, wantsNew: false, showList: false });
  });
});

describe("a business with one website", () => {
  it("opens it without being asked", () => {
    expect(chooseSite(one, undefined).site).toEqual({ id: "a" });
  });

  it("opens it even when a DIFFERENT id is asked for", () => {
    // A bookmark from before a site was deleted, or a link from somebody
    // else's workspace. One site wins: there is nothing else to show, and a
    // list of one is worse than the site itself.
    expect(chooseSite(one, "gone").site).toEqual({ id: "a" });
    expect(chooseSite(one, "gone").showList).toBe(false);
  });

  it("steps aside for `new`, so a second website can be built", () => {
    const chosen = chooseSite(one, "new");
    expect(chosen.site).toBeNull();
    expect(chosen.wantsNew).toBe(true);
    expect(chosen.showList).toBe(false);
  });
});

describe("a business with several websites", () => {
  it("shows the list when none is asked for", () => {
    expect(chooseSite(two, undefined)).toEqual({ site: null, wantsNew: false, showList: true });
  });

  it("opens the one asked for", () => {
    expect(chooseSite(two, "b").site).toEqual({ id: "b" });
    expect(chooseSite(two, "b").showList).toBe(false);
  });

  it("shows the list for an id that is not in it", () => {
    // The list came from `withTenant`, so another tenant's id is simply
    // absent — RLS decided before this saw anything, and there is no separate
    // "not yours" answer for a stranger to tell apart from "no longer there".
    expect(chooseSite(two, "someone-elses").showList).toBe(true);
    expect(chooseSite(two, "someone-elses").site).toBeNull();
  });

  it("steps aside for `new` rather than drawing the list", () => {
    expect(chooseSite(two, "new")).toEqual({ site: null, wantsNew: true, showList: false });
  });

  it("never reports a site and a list at once", () => {
    for (const asked of [undefined, "", "a", "b", "new", "nope"]) {
      const chosen = chooseSite(two, asked);
      expect(chosen.site !== null && chosen.showList, `asked=${String(asked)}`).toBe(false);
    }
  });
});
