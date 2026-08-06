import type { FilterCondition } from "./views";
import { FILTER_FIELDS, conditionProblem, describeFilter } from "./views";

/**
 * Automation: "when this happens, do that."
 *
 * PURE — no database, no `server-only`. This file declares what a rule may SAY;
 * `automation-ops.ts` is the only thing that makes one happen.
 *
 * THE DESIGN DECISION THAT SHAPES EVERYTHING ELSE: **a rule runs as the person
 * whose action triggered it, synchronously, inside the same transaction.**
 *
 * Mail's auto-filing is the other shape and the comparison is worth having.
 * That one rides a cron, because the thing it reacts to — a message arriving —
 * happens in somebody else's system. A cron has no Clerk session, so it runs as
 * `staff`, the least-privileged honest value, and the documented consequence is
 * that auto-filing can never reach an owners-only folder.
 *
 * CRM's triggers are our own writes. There is a real person, a real role and an
 * open transaction at the moment each one fires, so the rule can simply borrow
 * them — and that gives the property worth stating plainly:
 *
 *   **AN AUTOMATION CAN NEVER DO SOMETHING THE PERSON WHO TRIGGERED IT COULD
 *   NOT DO THEMSELVES.**
 *
 * A staff member's edit cannot cause a rule to touch a restricted record,
 * because the transaction it runs in is theirs and RLS has already removed the
 * row. No rule needs a permission model, and none is written here. That is the
 * same S12 property the mail extensions, the reports and the saved views all
 * turn on, arrived at once more from a different direction.
 *
 * ONE HOP, NEVER A CASCADE. An action does not re-trigger rules. A rule that
 * creates a follow-up cannot wake a rule that watches follow-ups, so a loop is
 * not merely unlikely — it is unrepresentable. Cascades are the feature that
 * makes automation engines fun to demonstrate and impossible to debug, and the
 * honest version of "chain two rules" is one rule with two actions, which a
 * later slice can add without changing this promise.
 */

/* -- Triggers ------------------------------------------------------------- */

/**
 * What can start a rule. A CLOSED SET, and each member is a call site somebody
 * added on purpose in `automation-ops.ts` — adding a sixth means editing two
 * files, the same discipline the report types and field types follow.
 */
export const TRIGGERS = [
  "record_created",
  "deal_stage_changed",
  "deal_won",
  "deal_lost",
  "task_completed",
] as const;

export type Trigger = (typeof TRIGGERS)[number];

export interface TriggerDefinition {
  id: Trigger;
  label: string;
  /** Read as "When …". */
  when: string;
  /**
   * Whether the thing that happened has a RECORD behind it.
   *
   * Every trigger here does today, which is what lets the conditions reuse the
   * records field registry. A future trigger about something record-less — a
   * pipeline being archived, say — would need its own field set, and this flag
   * is where that difference will first have to be admitted.
   */
  hasRecord: true;
}

export const TRIGGER_DEFINITIONS: readonly TriggerDefinition[] = [
  {
    id: "record_created",
    label: "A record is added",
    when: "a new record is added",
    hasRecord: true,
  },
  {
    id: "deal_stage_changed",
    label: "A deal moves stage",
    when: "a deal moves to another stage",
    hasRecord: true,
  },
  {
    id: "deal_won",
    label: "A deal is won",
    when: "a deal moves into a stage that counts as won",
    hasRecord: true,
  },
  {
    id: "deal_lost",
    label: "A deal is lost",
    when: "a deal moves into a stage that counts as lost",
    hasRecord: true,
  },
  {
    id: "task_completed",
    label: "A follow-up is completed",
    when: "somebody ticks a follow-up off",
    hasRecord: true,
  },
];

export function triggerDefinition(id: string): TriggerDefinition | null {
  return TRIGGER_DEFINITIONS.find((t) => t.id === id) ?? null;
}

/* -- Actions -------------------------------------------------------------- */

export const ACTION_KINDS = [
  "create_task",
  "set_lifecycle_stage",
  "assign_record",
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

/**
 * What a rule does.
 *
 * THREE ACTIONS, ALL OF THEM WRITES THIS MODULE ALREADY MAKES — but the engine
 * writes the TABLES rather than calling the ops functions, and that is worth
 * being precise about because the obvious reading is the wrong one.
 *
 * Going through `createTask` would be tidier in one sense and wrong in two.
 * Those functions contain the trigger calls, so routing an action through one
 * would reintroduce exactly the cascade this design forbids — and it would make
 * `automation-ops` import `timeline-ops`, which imports `party-ops`, which
 * imports `automation-ops`. The validation those functions apply is applied
 * here instead, by `actionProblem` before the rule is ever stored.
 *
 * NOTHING HERE SENDS ANYTHING. No email, no notification, no webhook. That is
 * not an oversight: the module has no notification machinery at all, and an
 * automation that quietly emailed a customer would be the single most damaging
 * thing a half-built rules engine could do. When notifications exist, "notify
 * somebody" becomes a fourth action and this comment comes out.
 */
export interface RuleAction {
  kind: ActionKind;
  /** `create_task`: what the follow-up is called. */
  title?: string;
  /** `create_task`: days from now. 0 means today. */
  dueInDays?: number;
  /** `set_lifecycle_stage`: the stage to set. */
  stage?: string;
  /**
   * `create_task` and `assign_record`: who it goes to. Empty means "whoever the
   * record is assigned to", which is the answer that keeps working when people
   * join and leave.
   */
  assignee?: string;
}

export const TITLE_MAX = 120;
export const STAGE_MAX = 60;
export const MAX_DUE_DAYS = 365;

export function actionProblem(action: RuleAction): string | null {
  switch (action.kind) {
    case "create_task": {
      const title = (action.title ?? "").trim();
      if (title.length === 0) return "Give the follow-up a name";
      if (title.length > TITLE_MAX) return "That name is too long";
      const due = action.dueInDays ?? 0;
      if (!Number.isInteger(due) || due < 0 || due > MAX_DUE_DAYS) {
        return "Due in must be a whole number of days, up to a year";
      }
      return null;
    }
    case "set_lifecycle_stage": {
      const stage = (action.stage ?? "").trim();
      if (stage.length === 0) return "Choose a stage";
      if (stage.length > STAGE_MAX) return "That stage name is too long";
      return null;
    }
    case "assign_record":
      // An empty assignee is meaningful for `create_task` ("whoever owns the
      // record") and meaningless here, because assigning a record to whoever it
      // is assigned to does nothing at all.
      return (action.assignee ?? "").trim().length === 0
        ? "Choose who to assign it to"
        : null;
  }
}

export function describeAction(action: RuleAction): string {
  switch (action.kind) {
    case "create_task": {
      const due = action.dueInDays ?? 0;
      const when =
        due === 0 ? "today" : due === 1 ? "tomorrow" : `in ${due} days`;
      const who = action.assignee?.trim()
        ? ` for ${action.assignee.trim()}`
        : " for whoever the record is assigned to";
      return `add a follow-up “${action.title ?? ""}” due ${when}${who}`;
    }
    case "set_lifecycle_stage":
      return `set the stage to ${action.stage ?? ""}`;
    case "assign_record":
      return `assign the record to ${action.assignee ?? ""}`;
  }
}

/* -- Rules ---------------------------------------------------------------- */

export interface AutomationRule {
  trigger: Trigger;
  /**
   * Narrows which records the rule applies to, reusing slice 8's filter
   * entirely — the same conditions, operators and registry the records list
   * uses.
   *
   * THEY ARE EVALUATED BY RE-QUERYING, NOT BY AN IN-MEMORY MATCHER, which is a
   * decision `automation-ops.ts` explains: asking "does this record still match
   * this filter?" as one indexed query reuses the existing compiler exactly,
   * where a second evaluator would be a second implementation of the same rules
   * and would drift from the first the day somebody adds an operator.
   */
  conditions: FilterCondition[];
  action: RuleAction;
}

export const MAX_CONDITIONS_PER_RULE = 5;

/** Everything wrong with a rule, or an empty list. */
export function ruleProblems(rule: AutomationRule): string[] {
  const problems: string[] = [];
  if (!triggerDefinition(rule.trigger)) problems.push("Unknown trigger");
  if (rule.conditions.length > MAX_CONDITIONS_PER_RULE) {
    problems.push("Too many conditions");
  }
  for (const condition of rule.conditions) {
    const problem = conditionProblem(condition, FILTER_FIELDS);
    if (problem) problems.push(problem);
  }
  const actionIssue = actionProblem(rule.action);
  if (actionIssue) problems.push(actionIssue);
  return problems;
}

/**
 * A stored rule, validated.
 *
 * RETURNS NULL RATHER THAN A DEGRADED RULE, which is the opposite of how
 * `parseFilter` and `parseDefinition` treat a bad value — and the difference is
 * the point. A dropped filter condition widens a LIST, which somebody sees. A
 * dropped condition on a RULE widens what the rule does to their data, silently
 * and repeatedly. So a rule that no longer entirely makes sense stops running
 * and says so, rather than running on a subset of its own instructions.
 */
export function parseRule(stored: unknown): AutomationRule | null {
  if (typeof stored !== "object" || stored === null) return null;
  const candidate = stored as Record<string, unknown>;

  if (!triggerDefinition(candidate.trigger as string)) return null;
  const action = candidate.action;
  if (typeof action !== "object" || action === null) return null;
  const kind = (action as RuleAction).kind;
  if (!(ACTION_KINDS as readonly string[]).includes(kind)) return null;

  const conditions = Array.isArray(candidate.conditions)
    ? (candidate.conditions as FilterCondition[])
    : [];

  const rule: AutomationRule = {
    trigger: candidate.trigger as Trigger,
    conditions,
    action: action as RuleAction,
  };
  return ruleProblems(rule).length === 0 ? rule : null;
}

/** The rule as a sentence, for the list and the confirmation. */
export function describeRule(rule: AutomationRule): string {
  const trigger = triggerDefinition(rule.trigger);
  if (!trigger) return "";
  const where =
    rule.conditions.length > 0
      ? ` where ${describeFilter(rule.conditions, FILTER_FIELDS).toLowerCase()}`
      : "";
  return `When ${trigger.when}${where}, ${describeAction(rule.action)}.`;
}
