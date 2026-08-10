import { z } from "zod";
import { parseMoneyToCents } from "@/lib/money";

/**
 * The rule matcher — pure, no database, no `server-only`.
 *
 * Mirrors the `ai/*-validate.ts` seam: all the decision logic that decides what
 * a bank row should be coded to lives in one exhaustively table-testable
 * function, and the server module around it only reads and writes rows.
 *
 * A rule that cannot be parsed is SKIPPED, never thrown on. A malformed row —
 * hand-edited jsonb, a shape from a future version — must not be able to break
 * a bank import for every other rule in the tenant.
 */

export const RULE_TEXT_OPS = [
  "contains",
  "doesnt_contain",
  "is",
  "starts_with",
] as const;

export const RULE_AMOUNT_OPS = ["gt", "lt", "eq"] as const;

export type RuleTextOp = (typeof RULE_TEXT_OPS)[number];
export type RuleAmountOp = (typeof RULE_AMOUNT_OPS)[number];

const textConditionSchema = z.object({
  field: z.literal("description"),
  op: z.enum(RULE_TEXT_OPS),
  value: z.string().trim().min(1).max(200),
});

const amountConditionSchema = z.object({
  field: z.literal("amount"),
  op: z.enum(RULE_AMOUNT_OPS),
  // Validated as money here so a rule can never be saved with an amount the
  // matcher would later have to silently treat as zero.
  value: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .refine((v) => parseMoneyToCents(v) !== null, "not a money amount"),
});

export const ruleConditionSchema = z.discriminatedUnion("field", [
  textConditionSchema,
  amountConditionSchema,
]);

/**
 * At least one condition, always. A rule with an empty condition list would
 * match every row in the register, which is never what anybody meant.
 */
export const ruleConditionsSchema = z.array(ruleConditionSchema).min(1).max(10);

export type RuleCondition = z.infer<typeof ruleConditionSchema>;

/** The bank-row fields a rule can see. */
export interface MatchableTxn {
  bankAccountId: string;
  description: string;
  /** Signed cents, account-holder perspective: positive = money in. */
  amountCents: number;
}

/** The rule fields the matcher needs — a structural subset of the row. */
export interface MatchableRule {
  id: string;
  name: string;
  priority: number;
  isActive: boolean;
  appliesTo: "money_in" | "money_out" | "both";
  /** Null = every register. */
  bankAccountId: string | null;
  matchMode: "all" | "any";
  conditions: unknown;
  setAccountId: string;
  setMemo: string | null;
  autoPost: boolean;
  createdAt: Date;
}

export interface RuleMatch {
  ruleId: string;
  ruleName: string;
  accountId: string;
  memo: string | null;
  autoPost: boolean;
}

/** Lowercased, whitespace-collapsed — bank descriptions are noisy by nature. */
export function normalizeDescription(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Returns the parsed conditions, or null when the rule is unusable. */
export function parseConditions(raw: unknown): RuleCondition[] | null {
  const parsed = ruleConditionsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function conditionHolds(condition: RuleCondition, txn: MatchableTxn): boolean {
  if (condition.field === "description") {
    const haystack = normalizeDescription(txn.description);
    const needle = normalizeDescription(condition.value);
    switch (condition.op) {
      case "contains":
        return haystack.includes(needle);
      case "doesnt_contain":
        return !haystack.includes(needle);
      case "is":
        return haystack === needle;
      case "starts_with":
        return haystack.startsWith(needle);
    }
  }

  // Amounts compare on magnitude: the direction of the money is already
  // decided by `appliesTo`, and "more than $50" is how people say it.
  const target = parseMoneyToCents(condition.value);
  if (target === null) return false;
  const actual = Math.abs(txn.amountCents);
  switch (condition.op) {
    case "gt":
      return actual > target;
    case "lt":
      return actual < target;
    case "eq":
      return actual === target;
  }
}

function ruleApplies(rule: MatchableRule, txn: MatchableTxn): boolean {
  if (!rule.isActive) return false;
  if (rule.bankAccountId !== null && rule.bankAccountId !== txn.bankAccountId) {
    return false;
  }
  // Zero is neither in nor out; no scoped rule should claim it.
  if (rule.appliesTo === "money_in" && txn.amountCents <= 0) return false;
  if (rule.appliesTo === "money_out" && txn.amountCents >= 0) return false;

  const conditions = parseConditions(rule.conditions);
  if (conditions === null) return false;

  return rule.matchMode === "all"
    ? conditions.every((c) => conditionHolds(c, txn))
    : conditions.some((c) => conditionHolds(c, txn));
}

/**
 * Deterministic order: priority ascending, then oldest first, then by id.
 *
 * The last tiebreak matters more than it looks — two rules created in the same
 * millisecond must still resolve the same way on every machine, or a re-run of
 * "apply rules" could quietly recategorize a row.
 */
export function sortRules<T extends MatchableRule>(rules: readonly T[]): T[] {
  return [...rules].sort(
    (a, b) =>
      a.priority - b.priority ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** First match wins, in `sortRules` order. Null when nothing matches. */
export function matchRules(
  txn: MatchableTxn,
  rules: readonly MatchableRule[],
): RuleMatch | null {
  for (const rule of sortRules(rules)) {
    if (!ruleApplies(rule, txn)) continue;
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      accountId: rule.setAccountId,
      memo: rule.setMemo,
      autoPost: rule.autoPost,
    };
  }
  return null;
}

/** Human-readable conditions for the rules list — "Description contains X". */
export function describeConditions(raw: unknown, matchMode: "all" | "any"): string {
  const conditions = parseConditions(raw);
  if (conditions === null) return "Invalid conditions";
  const labels: Record<RuleTextOp | RuleAmountOp, string> = {
    contains: "contains",
    doesnt_contain: "doesn't contain",
    is: "is",
    starts_with: "starts with",
    gt: "is more than",
    lt: "is less than",
    eq: "equals",
  };
  const parts = conditions.map(
    (c) =>
      `${c.field === "description" ? "Description" : "Amount"} ${labels[c.op]} "${c.value}"`,
  );
  return parts.join(matchMode === "all" ? " and " : " or ");
}
