"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { CrmError, friendlyMessage } from "./core/errors";
import type { CrmCtx } from "./core/types";
import {
  ACTION_KINDS,
  MAX_CONDITIONS_PER_RULE,
  MAX_DUE_DAYS,
  STAGE_MAX,
  TITLE_MAX,
  TRIGGERS,
  describeRule,
  ruleProblems,
  type AutomationRule,
} from "./core/automation";
import { FILTER_OPERATORS, VALUE_MAX } from "./core/views";
import { RULE_NAME_MAX, createRule, deleteRule, setRuleActive } from "./automation-ops";

/**
 * Creating, pausing and deleting automation rules.
 *
 * OWNER-ONLY, checked here as well as in RLS — a rule changes everybody's data
 * on every trigger, so it is the business's decision rather than a personal
 * preference. That matches the merge tool and the collaborator grants and is
 * deliberately stricter than saved views and reports, which only change what
 * one person looks at.
 *
 * EVERY WRITE IS AUDITED, INCLUDING PAUSING. "Why did the follow-ups stop?" is
 * a question somebody will ask weeks after the fact, and a rule being switched
 * off is exactly the kind of change nobody remembers making. The audit meta
 * carries the rule as a SENTENCE rather than its id, because the rule may have
 * been edited or deleted by the time anybody reads the entry.
 */

const BASE = "/dashboard/m/crm";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(): Promise<CrmCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");
  if (ctx.role === "expert") {
    throw new CrmError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  if (ctx.role !== "owner") {
    throw new CrmError("FORBIDDEN", "owner role required");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (err instanceof CrmError) return { error: friendlyMessage(err) };
  console.error("crm automation action failed", err);
  return { error: friendlyMessage(err) };
}

/**
 * Zod proves the shape; `ruleProblems` decides whether the rule means anything.
 *
 * The split matters more here than anywhere else in the module, because this is
 * the one place a validation gap becomes a rule that runs against real data on
 * every trigger. Zod cannot know that a date field has no `starts_with`, or
 * that an empty assignee is meaningful for a follow-up and meaningless for an
 * assignment — those live in the registries.
 */
const ruleSchema = z.object({
  trigger: z.enum(TRIGGERS),
  conditions: z
    .array(
      z.object({
        field: z.string().max(60),
        operator: z.enum(FILTER_OPERATORS),
        value: z.string().max(VALUE_MAX),
      }),
    )
    .max(MAX_CONDITIONS_PER_RULE),
  action: z.object({
    kind: z.enum(ACTION_KINDS),
    title: z.string().max(TITLE_MAX).optional(),
    dueInDays: z.number().int().min(0).max(MAX_DUE_DAYS).optional(),
    stage: z.string().max(STAGE_MAX).optional(),
    assignee: z.string().max(120).optional(),
  }),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(RULE_NAME_MAX),
  rule: ruleSchema,
  isActive: z.boolean(),
});

export async function createRuleAction(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ ruleId: string }>> {
  try {
    const ctx = await gate();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const rule = parsed.data.rule as AutomationRule;
    const problems = ruleProblems(rule);
    // The FIRST problem, not a list: a rule form is small enough that fixing
    // one thing and being told the next is a reasonable loop, and a wall of
    // messages about a five-field form reads as failure rather than guidance.
    if (problems.length > 0) {
      return { error: problems[0] };
    }

    const created = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const row = await createRule(tx, ctx.tenantId, ctx.userId, {
          name: parsed.data.name,
          rule,
          isActive: parsed.data.isActive,
        });
        await logAuditInTx(tx, {
          action: "crm.automation_rule_created",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "crm_automation_rule",
          targetId: row.id,
          meta: { name: row.name, rule: describeRule(rule), active: row.isActive },
        });
        return row;
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidatePath(`${BASE}/automations`);
    return { ok: true, data: { ruleId: created.id } };
  } catch (err) {
    return fail(err);
  }
}

const toggleSchema = z.object({
  ruleId: z.string().uuid(),
  isActive: z.boolean(),
});

export async function setRuleActiveAction(
  input: z.infer<typeof toggleSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = toggleSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await setRuleActive(
          tx,
          ctx.tenantId,
          parsed.data.ruleId,
          parsed.data.isActive,
        );
        await logAuditInTx(tx, {
          action: parsed.data.isActive
            ? "crm.automation_rule_resumed"
            : "crm.automation_rule_paused",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "crm_automation_rule",
          targetId: parsed.data.ruleId,
          meta: {},
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidatePath(`${BASE}/automations`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteRuleAction(input: {
  ruleId: string;
}): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = z.object({ ruleId: z.string().uuid() }).safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await deleteRule(tx, ctx.tenantId, parsed.data.ruleId);
        await logAuditInTx(tx, {
          action: "crm.automation_rule_deleted",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "crm_automation_rule",
          targetId: parsed.data.ruleId,
          meta: {},
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidatePath(`${BASE}/automations`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
