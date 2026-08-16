import { describe, expect, it } from "vitest";
import { allowsWrite, type WriteRole } from "../src/lib/packs/authorize";

/**
 * The decision/chore rule, on its own.
 *
 * Four packs used to carry four private copies of `requireOwner`, and the copies
 * had already drifted in their error messages. The function is trivial; what is
 * being pinned here is the SHAPE of the answer, so a fifth pack cannot invent a
 * fifth level or quietly promote `expert`.
 */
const ROLES: WriteRole[] = ["owner", "staff", "expert"];

describe("pack write levels", () => {
  it("lets anyone in the workspace record a chore", () => {
    // Recording a death, a feeding, a move. If this ever tightens, the daily
    // log has to be redesigned for a single-person farm.
    for (const role of ROLES) {
      expect(allowsWrite(role, "member")).toBe(true);
    }
  });

  it("keeps decisions with the owner", () => {
    expect(allowsWrite("owner", "owner")).toBe(true);
    expect(allowsWrite("staff", "owner")).toBe(false);
  });

  it("does not treat an expert as an owner", () => {
    // The platform's bookkeeper reconciles books; they do not decide the farm
    // bought a parcel. Stated as its own test because it is the one answer a
    // future reader is likely to assume goes the other way.
    expect(allowsWrite("expert", "owner")).toBe(false);
    expect(allowsWrite("expert", "member")).toBe(true);
  });
});
