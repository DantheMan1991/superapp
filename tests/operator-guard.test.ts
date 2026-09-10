import { describe, expect, it } from "vitest";
import { OPERATOR_REFUSALS, operatorRefusal } from "../src/lib/operator-guard";

/**
 * The one predicate both sides of the console call (ADR 0041): the client
 * components that draw a control and the server actions that refuse a press.
 */
describe("operatorRefusal", () => {
  const acts = Object.keys(OPERATOR_REFUSALS) as (keyof typeof OPERATOR_REFUSALS)[];

  it("names every act the console refuses", () => {
    expect(acts.sort()).toEqual(["billing", "moduleOff", "retainer", "status"]);
  });

  it("allows every act on an ordinary tenant", () => {
    for (const act of acts) {
      expect(operatorRefusal({ isOperator: false }, act)).toBeNull();
    }
  });

  it("refuses every act on the operator tenant, each with its own sentence", () => {
    for (const act of acts) {
      const refusal = operatorRefusal({ isOperator: true }, act);
      expect(refusal).toBe(OPERATOR_REFUSALS[act]);
      expect(refusal).toMatch(/^This is the operator tenant\./);
    }
    expect(new Set(acts.map((a) => OPERATOR_REFUSALS[a])).size).toBe(acts.length);
  });
});
