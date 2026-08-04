import { describe, expect, it } from "vitest";
import type { CrmFieldDef, CrmFieldType } from "../src/db/schema";
import {
  fieldOptions,
  formatFieldValue,
  isBlank,
  mergeCustomValues,
  missingRequired,
  parseFieldValue,
  sanitizeCustomValues,
  TEXT_VALUE_MAX,
} from "../src/modules/crm/core/custom-fields";

/**
 * The custom-field validator, tested without a database.
 *
 * This file is the integrity of the `custom` jsonb column. Postgres will store
 * whatever shape it is handed, so nothing else checks any of this — which makes
 * these the highest-value tests in the slice.
 */

let seq = 0;
function def(
  fieldType: CrmFieldType,
  over: Partial<CrmFieldDef> = {},
): CrmFieldDef {
  seq += 1;
  return {
    id: `def-${seq}`,
    tenantId: "t1",
    entityType: "party",
    key: `field_${seq}`,
    label: `Field ${seq}`,
    fieldType,
    options: [],
    isRequired: false,
    helpText: "",
    sortOrder: 0,
    archivedAt: null,
    version: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  } as CrmFieldDef;
}

const CHOICES = [
  { value: "north", label: "North" },
  { value: "south", label: "South" },
];

describe("parseFieldValue — blanks", () => {
  it("treats undefined, null and empty string as unanswered for every type", () => {
    const types: CrmFieldType[] = [
      "text",
      "number",
      "date",
      "boolean",
      "select",
      "multi_select",
      "url",
    ];
    for (const t of types) {
      for (const blank of [undefined, null, ""]) {
        const result = parseFieldValue(def(t), blank);
        expect(result.ok, `${t} / ${String(blank)}`).toBe(true);
        expect(result.ok && result.value).toBeUndefined();
      }
    }
  });

  it("does NOT treat false or zero as blank", () => {
    // A boolean answered "no" and a number answered "zero" are answers, and a
    // required check that swallowed them would demand the user re-enter a value
    // they had already given.
    expect(parseFieldValue(def("boolean"), false)).toEqual({ ok: true, value: false });
    expect(parseFieldValue(def("number"), 0)).toEqual({ ok: true, value: 0 });
    expect(isBlank(false)).toBe(false);
    expect(isBlank(0)).toBe(false);
    expect(isBlank("")).toBe(true);
    expect(isBlank([])).toBe(true);
  });
});

describe("parseFieldValue — text and number", () => {
  it("trims text and enforces the cap", () => {
    expect(parseFieldValue(def("text"), "  ACME-1 ")).toEqual({
      ok: true,
      value: "ACME-1",
    });
    expect(parseFieldValue(def("text"), "   ")).toEqual({ ok: true });
    const tooLong = parseFieldValue(def("text"), "x".repeat(TEXT_VALUE_MAX + 1));
    expect(tooLong.ok).toBe(false);
  });

  it("accepts the string a form sends but refuses anything non-finite", () => {
    expect(parseFieldValue(def("number"), " 42 ")).toEqual({ ok: true, value: 42 });
    expect(parseFieldValue(def("number"), -3.5)).toEqual({ ok: true, value: -3.5 });
    // NaN and Infinity would serialize into jsonb as null and read back as
    // "not answered", which is a value silently becoming an absence.
    expect(parseFieldValue(def("number"), "abc").ok).toBe(false);
    expect(parseFieldValue(def("number"), Number.NaN).ok).toBe(false);
    expect(parseFieldValue(def("number"), Infinity).ok).toBe(false);
  });
});

describe("parseFieldValue — date", () => {
  it("accepts a real ISO date", () => {
    expect(parseFieldValue(def("date"), "2026-08-04")).toEqual({
      ok: true,
      value: "2026-08-04",
    });
  });

  it("rejects a date that matches the format but does not exist", () => {
    // The regex alone accepts this; only the round-trip catches it.
    expect(parseFieldValue(def("date"), "2026-02-31").ok).toBe(false);
    expect(parseFieldValue(def("date"), "2026-13-01").ok).toBe(false);
  });

  it("rejects anything that is not YYYY-MM-DD", () => {
    expect(parseFieldValue(def("date"), "04/08/2026").ok).toBe(false);
    expect(parseFieldValue(def("date"), "2026-8-4").ok).toBe(false);
  });
});

describe("parseFieldValue — choices", () => {
  it("accepts only values present in options", () => {
    const d = def("select", { options: CHOICES });
    expect(parseFieldValue(d, "north")).toEqual({ ok: true, value: "north" });
    expect(parseFieldValue(d, "east").ok).toBe(false);
  });

  it("multi-select dedupes rather than refusing a repeat", () => {
    const d = def("multi_select", { options: CHOICES });
    expect(parseFieldValue(d, ["north", "south", "north"])).toEqual({
      ok: true,
      value: ["north", "south"],
    });
  });

  it("multi-select rejects a value outside the options", () => {
    const d = def("multi_select", { options: CHOICES });
    expect(parseFieldValue(d, ["north", "east"]).ok).toBe(false);
  });

  it("an empty multi-select is unanswered, not an empty array", () => {
    const d = def("multi_select", { options: CHOICES });
    expect(parseFieldValue(d, [])).toEqual({ ok: true });
  });
});

describe("parseFieldValue — url", () => {
  it("accepts http and https", () => {
    expect(parseFieldValue(def("url"), "https://example.com/a")).toEqual({
      ok: true,
      value: "https://example.com/a",
    });
  });

  it("REFUSES javascript: and data:, which become an href eventually", () => {
    expect(parseFieldValue(def("url"), "javascript:alert(1)").ok).toBe(false);
    expect(parseFieldValue(def("url"), "data:text/html,<script>").ok).toBe(false);
    expect(parseFieldValue(def("url"), "file:///etc/passwd").ok).toBe(false);
  });

  it("refuses something that is not a URL at all", () => {
    expect(parseFieldValue(def("url"), "example.com").ok).toBe(false);
  });
});

describe("fieldOptions", () => {
  it("survives junk in the jsonb column", () => {
    // `options` is jsonb and nothing at the database level constrains its shape,
    // so this has to degrade rather than throw.
    expect(fieldOptions(def("select", { options: "nonsense" as never }))).toEqual([]);
    expect(
      fieldOptions(
        def("select", {
          options: [{ value: "a" }, null, { label: "no value" }, 42] as never,
        }),
      ),
    ).toEqual([{ value: "a", label: "a" }]);
  });
});

describe("sanitizeCustomValues", () => {
  it("drops keys that match no live definition", () => {
    // An archived field's value, or another tenant's definition id. Dropping
    // rather than erroring is what stops this being a probe for which ids exist.
    const a = def("text");
    const { values, issues } = sanitizeCustomValues([a], {
      [a.id]: "kept",
      "some-other-id": "dropped",
    });
    expect(values).toEqual({ [a.id]: "kept" });
    expect(issues).toHaveLength(0);
  });

  it("survives a payload that is not an object", () => {
    expect(sanitizeCustomValues([def("text")], null).values).toEqual({});
    expect(sanitizeCustomValues([def("text")], ["nope"]).values).toEqual({});
  });

  it("reports one issue per bad value, keyed to the field", () => {
    const a = def("number", { label: "Crew size" });
    const b = def("date", { label: "Starts" });
    const { issues } = sanitizeCustomValues([a, b], {
      [a.id]: "abc",
      [b.id]: "2026-02-31",
    });
    expect(issues.map((i) => i.fieldId).sort()).toEqual([a.id, b.id].sort());
    expect(issues.find((i) => i.fieldId === a.id)?.label).toBe("Crew size");
  });

  /* The rule that keeps imports and lead capture usable. */

  it("does NOT enforce required on an ordinary save", () => {
    const a = def("text", { isRequired: true });
    const { issues } = sanitizeCustomValues([a], {});
    expect(issues).toHaveLength(0);
  });

  it("DOES enforce required when the record is moving stage", () => {
    const a = def("text", { isRequired: true, label: "PO number" });
    const { issues } = sanitizeCustomValues([a], {}, { requireComplete: true });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("PO number");
  });

  it("a required boolean answered false satisfies the requirement", () => {
    const a = def("boolean", { isRequired: true });
    const { issues, values } = sanitizeCustomValues(
      [a],
      { [a.id]: false },
      { requireComplete: true },
    );
    expect(issues).toHaveLength(0);
    expect(values[a.id]).toBe(false);
  });
});

describe("missingRequired", () => {
  it("reports required fields that are blank in what is stored", () => {
    const req = def("text", { isRequired: true, label: "PO number" });
    const opt = def("text");
    expect(missingRequired([req, opt], {})).toHaveLength(1);
    expect(missingRequired([req, opt], { [req.id]: "PO-1" })).toHaveLength(0);
  });

  it("DOES NOT re-validate stored values against the current definitions", () => {
    // The reason this exists rather than reusing sanitizeCustomValues. An owner
    // removed the "north" option after somebody picked it; the record must
    // still be able to move stage, because that value was valid when written
    // and an administrative edit afterwards is not the record's fault.
    const d = def("select", {
      isRequired: true,
      options: [{ value: "south", label: "South" }],
    });
    expect(missingRequired([d], { [d.id]: "north" })).toHaveLength(0);

    // Full validation, by contrast, correctly rejects it on an explicit edit.
    const { issues } = sanitizeCustomValues([d], { [d.id]: "north" });
    expect(issues).toHaveLength(1);
  });

  it("counts a required field answered false or zero as answered", () => {
    const b = def("boolean", { isRequired: true });
    const n = def("number", { isRequired: true });
    expect(missingRequired([b, n], { [b.id]: false, [n.id]: 0 })).toHaveLength(0);
  });

  it("survives stored junk", () => {
    const req = def("text", { isRequired: true });
    expect(missingRequired([req], null)).toHaveLength(1);
    expect(missingRequired([req], "nonsense")).toHaveLength(1);
  });
});

describe("mergeCustomValues", () => {
  it("preserves values whose definition has been archived", () => {
    // The whole reason archiving is not deleting. `archived` is absent from
    // `defs`, so a straight replace would drop it on the next unrelated save.
    const live = def("text");
    const stored = { [live.id]: "old", "archived-def-id": "keep me" };
    const merged = mergeCustomValues(stored, [live], { [live.id]: "new" });
    expect(merged).toEqual({ [live.id]: "new", "archived-def-id": "keep me" });
  });

  it("removes a live field the person deliberately cleared", () => {
    const live = def("text");
    const merged = mergeCustomValues({ [live.id]: "old" }, [live], {});
    expect(merged).toEqual({});
  });

  it("survives stored junk", () => {
    const live = def("text");
    expect(mergeCustomValues(null, [live], { [live.id]: "a" })).toEqual({
      [live.id]: "a",
    });
    expect(mergeCustomValues("nonsense", [live], {})).toEqual({});
  });
});

describe("formatFieldValue", () => {
  it("renders labels rather than stored values for choices", () => {
    const d = def("select", { options: CHOICES });
    expect(formatFieldValue(d, "north")).toBe("North");
    const m = def("multi_select", { options: CHOICES });
    expect(formatFieldValue(m, ["south", "north"])).toBe("South, North");
  });

  it("falls back to the raw value when an option has since been removed", () => {
    const d = def("select", { options: CHOICES });
    expect(formatFieldValue(d, "east")).toBe("east");
  });

  it("never throws on a shape that does not match the type", () => {
    expect(formatFieldValue(def("multi_select"), "not-an-array")).toBe("");
    expect(formatFieldValue(def("number"), "not-a-number")).toBe("");
    expect(formatFieldValue(def("boolean"), null)).toBe("");
  });
});
