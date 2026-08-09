import { describe, expect, it } from "vitest";
import { WORK_STATES } from "../src/lib/work/vocabulary";
import {
  coreStateLabel,
  describeWorkState,
  isClosedState,
  isWorkState,
  WORK_STATE_ORDER,
} from "../src/modules/work/core/state";

/**
 * The mechanism/vocabulary split, tested where it lives. No database: this is
 * the whole reason `core/` exists.
 */
describe("work state vocabulary", () => {
  it("shows a supplied label instead of core's word", () => {
    // What a plumbing profile does to `in_progress`. Core never learns the word.
    expect(describeWorkState("in_progress", "On the way")).toBe("On the way");
    expect(describeWorkState("blocked", "Awaiting parts")).toBe(
      "Awaiting parts",
    );
  });

  it("falls back to core's word when no label was supplied", () => {
    expect(describeWorkState("in_progress", "")).toBe("In progress");
    expect(describeWorkState("todo", "")).toBe("To do");
  });

  it("treats a whitespace label as absent", () => {
    // Otherwise the chip renders empty, which reads as a bug rather than as a
    // state.
    expect(describeWorkState("blocked", "   ")).toBe("Blocked");
  });

  it("knows which states mean finished with", () => {
    expect(isClosedState("done")).toBe(true);
    expect(isClosedState("cancelled")).toBe(true);
    expect(isClosedState("todo")).toBe(false);
    expect(isClosedState("in_progress")).toBe(false);
    expect(isClosedState("blocked")).toBe(false);
  });

  it("rejects a state it does not know", () => {
    expect(isWorkState("todo")).toBe(true);
    expect(isWorkState("archived")).toBe(false);
    expect(isWorkState("")).toBe(false);
  });

  it("orders board columns least finished first", () => {
    expect(WORK_STATE_ORDER).toEqual(WORK_STATES);
    expect(WORK_STATE_ORDER.indexOf("todo")).toBeLessThan(
      WORK_STATE_ORDER.indexOf("done"),
    );
  });

  it("can still name core's own word when a label exists", () => {
    expect(coreStateLabel("in_progress")).toBe("In progress");
  });
});
