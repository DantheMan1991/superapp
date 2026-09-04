import { describe, expect, it } from "vitest";
import { allowsWrite, ownerFeatureAllowsWrite, type WriteRole } from "../src/lib/packs/authorize";

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

/**
 * Whose rule applies to work raised on somebody else's record.
 *
 * The whole point of this function is that the two owners disagree, so the
 * tests are written as the disagreement rather than as a truth table.
 */
describe("ownerFeatureAllowsWrite", () => {
  it("lets a pack's own rule through — the accountant is a member there", () => {
    // A job raised off a tractor is a chore, and `assets` is a pack.
    expect(ownerFeatureAllowsWrite("pack", "expert")).toBe(true);
    expect(ownerFeatureAllowsWrite("pack", "staff")).toBe(true);
    expect(ownerFeatureAllowsWrite("pack", "owner")).toBe(true);
  });

  it("refuses the accountant when a CORE module owns the record", () => {
    // A follow-up on a CRM record. Every write in CRM refuses an expert, and
    // reaching one through the shared Layer 0 verbs must not be the way round.
    expect(ownerFeatureAllowsWrite("core", "expert")).toBe(false);
    expect(ownerFeatureAllowsWrite("core", "staff")).toBe(true);
    expect(ownerFeatureAllowsWrite("core", "owner")).toBe(true);
  });

  it("treats anything it does not recognise as core, not as a pack", () => {
    // The default has to be the STRICT one: a slug nobody registered is a
    // question nobody can answer, and answering it permissively is how a
    // dropped registry row becomes a permission.
    expect(ownerFeatureAllowsWrite("system", "expert")).toBe(false);
    expect(ownerFeatureAllowsWrite("", "expert")).toBe(false);
    expect(ownerFeatureAllowsWrite("something-new", "expert")).toBe(false);
  });

  it("never widens what the pack rule itself allows", () => {
    // `pack` delegates to `allowsWrite(role, "member")`, so an owner-level act
    // is still not reachable this way for anybody.
    for (const role of ROLES) {
      expect(ownerFeatureAllowsWrite("pack", role)).toBe(
        allowsWrite(role, "member"),
      );
    }
  });
});
