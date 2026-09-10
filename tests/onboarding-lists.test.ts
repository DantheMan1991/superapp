import { describe, expect, it } from "vitest";
import {
  dueDateFor,
  listsForKind,
  MAX_STEPS,
  onboardingListsFrom,
  scheduleFrom,
  stepsToRaise,
} from "../src/packs/professional-services/core/onboarding";

import { getIndustryProfile } from "../src/industries";

/**
 * The onboarding list an engagement starts with — PURE.
 *
 * The parsing half matters more than it looks: `tenant_modules.config` is
 * jsonb with no shape constraint and a profile is hand-written, so this runs
 * over data nobody validated. It must drop what it cannot read and never
 * throw, the same discipline `resolveLabels` keeps.
 */

const list = (over: Record<string, unknown> = {}) => ({
  name: "New client",
  steps: [{ title: "Signed agreement on file" }, { title: "Kickoff call booked", dueInDays: 3 }],
  ...over,
});

describe("onboardingListsFrom", () => {
  it("reads a well-formed list", () => {
    const lists = onboardingListsFrom({ onboarding: [list()] });
    expect(lists).toHaveLength(1);
    expect(lists[0].name).toBe("New client");
    expect(lists[0].steps[1]).toEqual({
      title: "Kickoff call booked",
      notes: "",
      dueInDays: 3,
    });
  });

  it("answers empty for anything that is not a list of lists", () => {
    for (const config of [null, undefined, 42, "onboarding", [], {}, { onboarding: {} }]) {
      expect(onboardingListsFrom(config)).toEqual([]);
    }
  });

  it("drops a malformed step without losing its siblings", () => {
    const lists = onboardingListsFrom({
      onboarding: [
        {
          name: "Mixed",
          steps: [
            { title: "Good" },
            { title: "" },
            { notes: "no title" },
            "not an object",
            null,
            { title: "Also good", dueInDays: "soon" },
          ],
        },
      ],
    });
    expect(lists[0].steps.map((s) => s.title)).toEqual(["Good", "Also good"]);
    // A due figure it cannot read becomes no due date, never a guess.
    expect(lists[0].steps[1].dueInDays).toBeNull();
  });

  it("drops a list with no usable step at all", () => {
    expect(onboardingListsFrom({ onboarding: [{ name: "Empty", steps: [] }] })).toEqual([]);
    expect(onboardingListsFrom({ onboarding: [{ name: "Broken" }] })).toEqual([]);
  });

  it("refuses a negative due figure rather than dating a step in the past", () => {
    const lists = onboardingListsFrom({
      onboarding: [{ name: "N", steps: [{ title: "T", dueInDays: -5 }] }],
    });
    expect(lists[0].steps[0].dueInDays).toBeNull();
  });

  it("names a list that forgot to name itself", () => {
    const lists = onboardingListsFrom({ onboarding: [{ steps: [{ title: "T" }] }] });
    expect(lists[0].name).toBe("Onboarding");
  });
});

describe("listsForKind", () => {
  const lists = onboardingListsFrom({
    onboarding: [
      list({ name: "Retainers", appliesTo: ["retainer"] }),
      list({ name: "Everything" }),
    ],
  });

  it("takes a list that names the kind, and one that names none", () => {
    expect(listsForKind(lists, "retainer").map((l) => l.name)).toEqual([
      "Retainers",
      "Everything",
    ]);
  });

  it("leaves out a list that names other kinds only", () => {
    expect(listsForKind(lists, "hourly").map((l) => l.name)).toEqual(["Everything"]);
  });
});

describe("stepsToRaise", () => {
  const lists = onboardingListsFrom({ onboarding: [list()] });

  it("offers everything when nothing is raised", () => {
    expect(stepsToRaise(lists, "retainer", []).map((s) => s.title)).toEqual([
      "Signed agreement on file",
      "Kickoff call booked",
    ]);
  });

  it("offers only what is missing — the button is idempotent with no column", () => {
    expect(
      stepsToRaise(lists, "retainer", ["Signed agreement on file"]).map((s) => s.title),
    ).toEqual(["Kickoff call booked"]);
    expect(
      stepsToRaise(lists, "retainer", ["Signed agreement on file", "Kickoff call booked"]),
    ).toEqual([]);
  });

  it("matches a title case-insensitively and ignores surrounding space", () => {
    expect(stepsToRaise(lists, "retainer", ["  signed AGREEMENT on file "])).toHaveLength(1);
  });

  it("never offers the same title twice, even from two lists", () => {
    const two = onboardingListsFrom({ onboarding: [list(), list({ name: "Second" })] });
    expect(stepsToRaise(two, "retainer", [])).toHaveLength(2);
  });

  it("stops at the ceiling, so a mistyped profile cannot flood a work list", () => {
    const many = onboardingListsFrom({
      onboarding: [
        {
          name: "Huge",
          steps: Array.from({ length: MAX_STEPS + 20 }, (_, i) => ({ title: `Step ${i}` })),
        },
      ],
    });
    expect(stepsToRaise(many, "retainer", [])).toHaveLength(MAX_STEPS);
  });
});

describe("dueDateFor", () => {
  it("counts days from the day the list starts from", () => {
    expect(dueDateFor({ title: "T", notes: "", dueInDays: 3 }, "2026-09-10")).toBe("2026-09-13");
    expect(dueDateFor({ title: "T", notes: "", dueInDays: 0 }, "2026-09-10")).toBe("2026-09-10");
    expect(dueDateFor({ title: "T", notes: "", dueInDays: null }, "2026-09-10")).toBeNull();
  });

  it("rolls over a month end", () => {
    expect(dueDateFor({ title: "T", notes: "", dueInDays: 25 }, "2026-09-10")).toBe("2026-10-05");
  });
});

describe("scheduleFrom", () => {
  it("uses today when the engagement started already", () => {
    // Otherwise a list raised late arrives with every step already overdue.
    expect(scheduleFrom("2026-01-01", "2026-09-10")).toBe("2026-09-10");
  });

  it("uses the start when it is still ahead", () => {
    expect(scheduleFrom("2026-12-01", "2026-09-10")).toBe("2026-12-01");
  });

  it("is the same day when they agree", () => {
    expect(scheduleFrom("2026-09-10", "2026-09-10")).toBe("2026-09-10");
  });
});

describe("the agency profile's own list", () => {
  const config = (getIndustryProfile("agency")!.packConfig ?? {})["professional-services"];
  const lists = onboardingListsFrom(config);

  it("parses — a profile that ships an unreadable list ships nothing", () => {
    expect(lists.length).toBeGreaterThan(0);
    expect(lists[0].steps.length).toBeGreaterThan(3);
  });

  it("applies to the shapes that need it and not to ad-hoc hours", () => {
    expect(listsForKind(lists, "retainer")).toHaveLength(1);
    expect(listsForKind(lists, "project")).toHaveLength(1);
    expect(listsForKind(lists, "hourly")).toHaveLength(0);
  });

  it("names no industry — an agency's list must suit a law firm too", () => {
    const banned = /\b(farm|homestead|plumb|electric|dental|construction)/i;
    for (const step of lists.flatMap((l) => l.steps)) {
      expect(banned.test(step.title), step.title).toBe(false);
      expect(banned.test(step.notes), step.title).toBe(false);
    }
  });

  it("stays under the ceiling", () => {
    expect(stepsToRaise(lists, "retainer", []).length).toBeLessThan(MAX_STEPS);
  });
});
