import { describe, expect, it } from "vitest";
import {
  ACTION_KINDS,
  MAX_CONDITIONS_PER_RULE,
  MAX_DUE_DAYS,
  TITLE_MAX,
  TRIGGERS,
  TRIGGER_DEFINITIONS,
  actionProblem,
  describeAction,
  describeRule,
  parseRule,
  ruleProblems,
  triggerDefinition,
  type AutomationRule,
} from "../src/modules/crm/core/automation";

/**
 * The automation rules, without a database.
 *
 * The tests that matter here are the REFUSALS, and for a sharper reason than
 * elsewhere in this module. A bad filter shows somebody the wrong list, which
 * they can see. A bad rule changes their data quietly and repeatedly, so
 * `parseRule` returns null rather than a degraded rule — and that difference is
 * what most of this file pins.
 */

const rule = (over: Partial<AutomationRule> = {}): AutomationRule => ({
  trigger: "record_created",
  conditions: [],
  action: { kind: "create_task", title: "Say hello", dueInDays: 1 },
  ...over,
});

describe("triggers", () => {
  it("declares a definition for every trigger id", () => {
    expect(TRIGGER_DEFINITIONS.map((t) => t.id).sort()).toEqual(
      [...TRIGGERS].sort(),
    );
  });

  it("REFUSES A TRIGGER IT DOES NOT DECLARE", () => {
    expect(triggerDefinition("record_deleted")).toBeNull();
    expect(parseRule(rule({ trigger: "record_deleted" as never }))).toBeNull();
  });

  it("every trigger reads as the middle of a sentence", () => {
    // `describeRule` puts "When " in front of it, so a `when` that started with
    // a capital or repeated the word would read badly on every rule.
    for (const trigger of TRIGGER_DEFINITIONS) {
      expect(trigger.when[0]).toBe(trigger.when[0].toLowerCase());
      expect(trigger.when.startsWith("when")).toBe(false);
    }
  });
});

describe("actions", () => {
  it("refuses a follow-up with no name", () => {
    expect(actionProblem({ kind: "create_task", title: "  " })).toBe(
      "Give the follow-up a name",
    );
  });

  it("refuses a due date that is not a whole number of days in range", () => {
    const bad = (dueInDays: number) =>
      actionProblem({ kind: "create_task", title: "x", dueInDays });
    expect(bad(-1)).toMatch(/whole number/);
    expect(bad(1.5)).toMatch(/whole number/);
    expect(bad(MAX_DUE_DAYS + 1)).toMatch(/whole number/);
    expect(bad(0)).toBeNull();
    expect(bad(MAX_DUE_DAYS)).toBeNull();
  });

  it("refuses a title longer than the cap", () => {
    expect(
      actionProblem({ kind: "create_task", title: "x".repeat(TITLE_MAX + 1) }),
    ).toBe("That name is too long");
  });

  it("AN EMPTY ASSIGNEE MEANS SOMETHING FOR A TASK AND NOTHING FOR AN ASSIGN", () => {
    // "whoever the record is assigned to" is a useful default for a follow-up
    // and a no-op for assignment, so only one of them accepts it.
    expect(
      actionProblem({ kind: "create_task", title: "x", assignee: "" }),
    ).toBeNull();
    expect(actionProblem({ kind: "assign_record", assignee: "" })).toBe(
      "Choose who to assign it to",
    );
  });

  it("refuses a stage change with no stage", () => {
    expect(actionProblem({ kind: "set_lifecycle_stage", stage: "" })).toBe(
      "Choose a stage",
    );
  });

  it("has a description for every declared kind", () => {
    for (const kind of ACTION_KINDS) {
      const described = describeAction({
        kind,
        title: "t",
        stage: "s",
        assignee: "a",
      });
      expect(described.length).toBeGreaterThan(0);
    }
  });
});

describe("parseRule", () => {
  it("RETURNS NULL RATHER THAN A DEGRADED RULE", () => {
    // The difference from `parseFilter`, which drops what it cannot validate. A
    // dropped filter condition widens a list somebody is looking at; a dropped
    // condition on a rule widens what it does to their data, silently and every
    // time it fires.
    const withBadCondition = rule({
      conditions: [{ field: "not_a_field", operator: "equals", value: "x" }],
    });
    expect(parseRule(withBadCondition)).toBeNull();

    const withBadAction = rule({ action: { kind: "create_task", title: "" } });
    expect(parseRule(withBadAction)).toBeNull();
  });

  it("survives a stored value of the wrong shape entirely", () => {
    expect(parseRule(null)).toBeNull();
    expect(parseRule("nonsense")).toBeNull();
    expect(parseRule({ trigger: "record_created" })).toBeNull();
    expect(
      parseRule({ trigger: "record_created", action: { kind: "launch_missile" } }),
    ).toBeNull();
  });

  it("keeps a rule that is entirely valid", () => {
    const valid = rule({
      conditions: [{ field: "kind", operator: "equals", value: "organization" }],
    });
    expect(parseRule(valid)).toEqual(valid);
  });

  it("refuses more conditions than a rule may carry", () => {
    const many = Array.from({ length: MAX_CONDITIONS_PER_RULE + 1 }, () => ({
      field: "name",
      operator: "contains" as const,
      value: "x",
    }));
    expect(ruleProblems(rule({ conditions: many }))).toContain(
      "Too many conditions",
    );
  });
});

describe("describeRule", () => {
  it("reads as one sentence", () => {
    expect(
      describeRule(
        rule({
          action: { kind: "create_task", title: "Call them", dueInDays: 2 },
        }),
      ),
    ).toBe(
      "When a new record is added, add a follow-up “Call them” due in 2 days for whoever the record is assigned to.",
    );
  });

  it("includes the conditions when there are some", () => {
    const described = describeRule(
      rule({
        trigger: "deal_won",
        conditions: [{ field: "kind", operator: "equals", value: "organization" }],
        action: { kind: "set_lifecycle_stage", stage: "customer" },
      }),
    );
    expect(described).toBe(
      "When a deal moves into a stage that counts as won where type is company, set the stage to customer.",
    );
  });

  it("says tomorrow rather than in 1 days", () => {
    expect(
      describeRule(rule({ action: { kind: "create_task", title: "x", dueInDays: 1 } })),
    ).toContain("due tomorrow");
    expect(
      describeRule(rule({ action: { kind: "create_task", title: "x", dueInDays: 0 } })),
    ).toContain("due today");
  });
});

describe("describeAction with a name resolver", () => {
  /**
   * The rule sentence used to render a raw Clerk user id — "assign the record
   * to user_2abc…". The picker that sets the value landed 2026-08-07, and a
   * sentence that reads back an id when you chose a name is half a fix.
   *
   * `resolve` is threaded INTO the renderer rather than applied to its output,
   * so the live preview in the builder and the list afterwards cannot drift.
   * These tests pin the fallback behaviour, which is the part that matters when
   * somebody leaves.
   */
  const resolve = (id: string) =>
    id === "user_sam" ? "Sam Rivera" : undefined;

  it("uses the resolved name for an assigned follow-up", () => {
    expect(
      describeAction(
        { kind: "create_task", title: "Call back", dueInDays: 1, assignee: "user_sam" },
        resolve,
      ),
    ).toContain("for Sam Rivera");
  });

  it("uses the resolved name when assigning a record", () => {
    expect(
      describeAction({ kind: "assign_record", assignee: "user_sam" }, resolve),
    ).toBe("assign the record to Sam Rivera");
  });

  it("FALLS BACK TO THE ID for somebody who has left", () => {
    // Not to an empty string. "assign the record to " would hide that the rule
    // now points at nobody, which is worse than an ugly id.
    expect(
      describeAction({ kind: "assign_record", assignee: "user_gone" }, resolve),
    ).toBe("assign the record to user_gone");
  });

  it("still reads correctly with no resolver at all", () => {
    // The parameter is optional, and every existing caller passed none.
    expect(describeAction({ kind: "assign_record", assignee: "user_sam" })).toBe(
      "assign the record to user_sam",
    );
  });

  it("an unassigned follow-up still says whose it is, without a resolver", () => {
    // Empty assignee is meaningful here and must not become "for undefined".
    const described = describeAction(
      { kind: "create_task", title: "t", dueInDays: 0, assignee: "" },
      resolve,
    );
    expect(described).toContain("for whoever the record is assigned to");
  });

  it("describeRule threads the resolver through to the action", () => {
    const sentence = describeRule(
      {
        trigger: "record_created",
        conditions: [],
        action: { kind: "assign_record", assignee: "user_sam" },
      },
      resolve,
    );
    expect(sentence).toContain("Sam Rivera");
    expect(sentence).not.toContain("user_sam");
  });
});
