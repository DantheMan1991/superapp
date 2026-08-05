import { describe, expect, it } from "vitest";
import {
  BUILT_IN_VIEWS,
  DEFAULT_SORT,
  FILTER_FIELDS,
  MAX_CONDITIONS,
  VALUE_MAX,
  builtInView,
  conditionProblem,
  describeFilter,
  filterField,
  operatorsFor,
  parseFilter,
  parseSort,
  resolveBuiltIn,
  resolveDateValue,
  type FilterCondition,
} from "../src/modules/crm/core/views";

/**
 * The saved-view rules, without a database.
 *
 * A filter is user input that ends up in a WHERE clause, so the tests that
 * matter most are the refusals: an unknown field, an operator that does not
 * apply, a value that is not what it claims to be. `view-ops.ts` binds values
 * as parameters and never builds SQL text, but the whitelist here is what makes
 * a column NAME impossible to supply from outside — and that is the property
 * worth pinning rather than trusting.
 */

const condition = (over: Partial<FilterCondition> = {}): FilterCondition => ({
  field: "name",
  operator: "contains",
  value: "probe",
  ...over,
});

describe("the field whitelist", () => {
  it("REFUSES A FIELD THAT IS NOT IN THE REGISTRY", () => {
    // The one that matters. A stored view is jsonb somebody's browser once
    // sent; if an unknown key survived parsing, a column name would have
    // arrived from outside this file.
    expect(filterField("owner_clerk_user_id; drop table parties")).toBeNull();
    expect(conditionProblem(condition({ field: "password" }))).toBe(
      "Unknown field",
    );
    expect(
      parseFilter([{ field: "password", operator: "equals", value: "x" }]),
    ).toEqual([]);
  });

  it("every registered field has a label and a usable operator set", () => {
    for (const field of FILTER_FIELDS) {
      expect(field.label.length).toBeGreaterThan(0);
      expect(operatorsFor(field.type).length).toBeGreaterThan(0);
    }
  });

  it("a closed vocabulary offers no free-text operators", () => {
    // "contains" against a picker is a question the picker cannot express.
    expect(operatorsFor("enum")).not.toContain("contains");
    expect(operatorsFor("enum")).not.toContain("starts_with");
  });

  it("A DATE HAS NO `equals`", () => {
    // It is a timestamp. Asking for one that matches an instant exactly is a
    // filter that always returns nothing, which reads as a broken product.
    expect(operatorsFor("date")).not.toContain("equals");
    expect(operatorsFor("date")).toContain("greater_or_equal");
  });
});

describe("condition validation", () => {
  it("rejects an operator that does not apply to the field's type", () => {
    expect(
      conditionProblem(condition({ field: "created", operator: "starts_with" })),
    ).toMatch(/does not apply/);
  });

  it("rejects a value outside a closed vocabulary", () => {
    expect(
      conditionProblem(
        condition({ field: "kind", operator: "equals", value: "alien" }),
      ),
    ).toBe("Not one of the choices");
    expect(
      conditionProblem(
        condition({ field: "kind", operator: "equals", value: "person" }),
      ),
    ).toBeNull();
  });

  it("rejects a boolean that is not true or false", () => {
    expect(
      conditionProblem(
        condition({ field: "active", operator: "equals", value: "yes" }),
      ),
    ).toBe("Must be true or false");
  });

  it("REFUSES AN EMPTY TEXT VALUE rather than treating it as 'is blank'", () => {
    // The two read identically in a form and mean very different things. A
    // filter that quietly became "everything" is the kind nobody notices.
    expect(conditionProblem(condition({ value: "   " }))).toBe("Enter a value");
  });

  it("rejects a value longer than the cap", () => {
    expect(
      conditionProblem(condition({ value: "x".repeat(VALUE_MAX + 1) })),
    ).toBe("Value is too long");
  });
});

describe("dates", () => {
  const now = new Date("2026-08-04T12:00:00.000Z");

  it("resolves a relative token against the supplied now", () => {
    const seven = resolveDateValue("last_7_days", now)!;
    expect(seven.toISOString()).toBe("2026-07-28T12:00:00.000Z");
  });

  it("accepts an ISO date as midnight UTC", () => {
    expect(resolveDateValue("2026-07-01", now)!.toISOString()).toBe(
      "2026-07-01T00:00:00.000Z",
    );
  });

  it("REFUSES anything else rather than handing it to new Date()", () => {
    // `new Date()` parses far too much and fails by returning Invalid Date,
    // which compares false against everything and produces an empty list with
    // no error.
    expect(resolveDateValue("last tuesday", now)).toBeNull();
    expect(resolveDateValue("2026-13-45", now)).toBeNull();
    expect(resolveDateValue("", now)).toBeNull();
  });

  it("a relative token is not frozen at save time", () => {
    // The whole point: a view called "added recently" must mean something
    // different next month, or every seeded view is stale the day after it was
    // made.
    const later = new Date("2026-09-04T12:00:00.000Z");
    expect(resolveDateValue("last_7_days", now)).not.toEqual(
      resolveDateValue("last_7_days", later),
    );
  });
});

describe("parseFilter", () => {
  it("drops an unusable condition and keeps the rest", () => {
    const parsed = parseFilter([
      { field: "name", operator: "contains", value: "probe" },
      { field: "gone", operator: "equals", value: "x" },
      { field: "kind", operator: "equals", value: "person" },
    ]);
    expect(parsed.map((c) => c.field)).toEqual(["name", "kind"]);
  });

  it("survives a stored value of the wrong shape entirely", () => {
    // A view saved by an older build, or a bag somebody hand-edited.
    expect(parseFilter(null)).toEqual([]);
    expect(parseFilter("nonsense")).toEqual([]);
    expect(parseFilter([1, "two", null])).toEqual([]);
  });

  it("caps how many conditions one view may carry", () => {
    const many = Array.from({ length: MAX_CONDITIONS + 5 }, () => ({
      field: "name",
      operator: "contains",
      value: "x",
    }));
    expect(parseFilter(many)).toHaveLength(MAX_CONDITIONS);
  });
});

describe("describeFilter", () => {
  it("says 'All records' when nothing is filtered", () => {
    expect(describeFilter([])).toBe("All records");
  });

  it("uses the choice's LABEL rather than its stored value", () => {
    expect(
      describeFilter([{ field: "kind", operator: "equals", value: "organization" }]),
    ).toBe("Type is Company");
  });

  it("phrases a relative date as a period rather than a comparison", () => {
    // "Added after the last 7 days" is nonsense; this is what somebody means
    // when they pick it.
    expect(
      describeFilter([
        { field: "created", operator: "greater_or_equal", value: "last_7_days" },
      ]),
    ).toBe("Added in the last 7 days");
  });

  it("joins several conditions", () => {
    expect(
      describeFilter([
        { field: "kind", operator: "equals", value: "person" },
        { field: "name", operator: "starts_with", value: "A" },
      ]),
    ).toBe("Type is Person · Name starts with A");
  });
});

describe("sort", () => {
  it("falls back to the default for anything unrecognised", () => {
    expect(parseSort(null)).toEqual(DEFAULT_SORT);
    expect(parseSort({ field: "haxx", direction: "sideways" })).toEqual(
      DEFAULT_SORT,
    );
  });

  it("keeps a valid stored sort", () => {
    expect(parseSort({ field: "created", direction: "desc" })).toEqual({
      field: "created",
      direction: "desc",
    });
  });
});

describe("built-in views", () => {
  it("every built-in carries a filter this module would accept", () => {
    // A built-in that failed its own validation would be a view that silently
    // showed everything.
    for (const view of BUILT_IN_VIEWS) {
      for (const c of view.filter) {
        // "Assigned to me" stores an empty value until it is resolved, which is
        // the one condition allowed to be invalid before resolution.
        if (view.usesCurrentUser && c.value === "") continue;
        expect(conditionProblem(c)).toBeNull();
      }
    }
  });

  it("resolves 'assigned to me' against the caller", () => {
    const view = builtInView("builtin:mine")!;
    const resolved = resolveBuiltIn(view, "user_123");
    expect(resolved).toEqual([
      { field: "assigned", operator: "equals", value: "user_123" },
    ]);
    // And the resolved form is valid, which the unresolved one is not.
    expect(conditionProblem(resolved[0])).toBeNull();
  });

  it("leaves a built-in without the marker alone", () => {
    const view = builtInView("builtin:companies")!;
    expect(resolveBuiltIn(view, "user_123")).toEqual(view.filter);
  });

  it("returns null for an id that is not built in", () => {
    expect(builtInView("builtin:nope")).toBeNull();
  });
});
