import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW,
  isFiltered,
  parseWorkView,
  resolveAssignee,
  workViewHref,
  workViewToQuery,
} from "../src/modules/work/core/view-params";

/**
 * A view is a parameter set. These tests are the contract that makes it one:
 * anything that survives a round trip through the URL is view state, and
 * anything that does not would have to live somewhere else.
 */
describe("work view params", () => {
  const ME = "user_me";

  it("reads the module's front door out of no parameters at all", () => {
    expect(parseWorkView({})).toEqual(DEFAULT_VIEW);
  });

  it("writes the default view as an empty query", () => {
    // The everyday URL must stay bare, or every link somebody pastes carries
    // filters they never chose.
    expect(workViewToQuery(DEFAULT_VIEW)).toBe("");
    expect(workViewHref(DEFAULT_VIEW)).toBe("/dashboard/m/work");
  });

  it("round-trips a filtered view", () => {
    const view = parseWorkView({
      display: "list",
      who: "nobody",
      list: "11111111-1111-1111-1111-111111111111",
      state: "blocked",
      open: "0",
      q: "roof",
    });
    expect(view.assignee).toBe("nobody");
    expect(view.states).toEqual(["blocked"]);
    expect(view.openOnly).toBe(false);
    expect(view.q).toBe("roof");
    expect(parseWorkView(Object.fromEntries(new URLSearchParams(workViewToQuery(view))))).toEqual(view);
  });

  it("keeps a named person through a round trip", () => {
    const view = parseWorkView({ who: "user_sam" });
    expect(view.assignee).toEqual({ userId: "user_sam" });
    expect(workViewToQuery(view)).toContain("who=user_sam");
  });

  it("forces the board to show finished work", () => {
    // A Done column that is always empty is worse than no Done column, so the
    // display overrides the filter rather than the other way round.
    expect(parseWorkView({ display: "board" }).openOnly).toBe(false);
    expect(parseWorkView({ display: "board", open: "1" }).openOnly).toBe(false);
    // …and the board never writes `open` back, since it does not own it.
    expect(
      workViewToQuery({ ...DEFAULT_VIEW, display: "board", openOnly: false }),
    ).toBe("display=board");
  });

  it("drops one bad state without discarding the good ones", () => {
    const view = parseWorkView({ state: "todo,nonsense,blocked" });
    expect(view.states).toEqual(["todo", "blocked"]);
  });

  it("falls back rather than throwing on a hand-edited URL", () => {
    // These arrive from stale bookmarks; an error page is the wrong answer.
    const view = parseWorkView({ display: "kanban", who: "", state: "" });
    expect(view.display).toBe("list");
    expect(view.assignee).toBe("me");
    expect(view.states).toEqual([]);
  });

  it("accepts a repeated parameter as well as a comma-separated one", () => {
    expect(parseWorkView({ state: ["todo", "done"] }).states).toEqual([
      "todo",
      "done",
    ]);
  });

  it("resolves the three assignee questions the read path draws apart", () => {
    expect(resolveAssignee("anyone", ME)).toBeUndefined();
    expect(resolveAssignee("me", ME)).toBe(ME);
    expect(resolveAssignee("nobody", ME)).toBeNull();
    expect(resolveAssignee({ userId: "user_sam" }, ME)).toBe("user_sam");
  });

  it("knows when anything is narrowed", () => {
    expect(isFiltered(DEFAULT_VIEW)).toBe(false);
    // The drawing is not a filter — switching to the board narrows nothing.
    expect(isFiltered({ ...DEFAULT_VIEW, display: "board" })).toBe(false);
    expect(isFiltered({ ...DEFAULT_VIEW, q: "roof" })).toBe(true);
    expect(isFiltered({ ...DEFAULT_VIEW, assignee: "anyone" })).toBe(true);
  });

  it("caps a pasted search term rather than passing it through", () => {
    const view = parseWorkView({ q: "x".repeat(500) });
    expect(view.q.length).toBe(100);
  });
});
