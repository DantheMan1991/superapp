import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { CrmAutomationRule } from "@/db/schema";
import { logAuditInTx } from "@/lib/audit";
import { CrmError } from "./core/errors";
import {
  describeRule,
  parseRule,
  type AutomationRule,
  type Trigger,
} from "./core/automation";
import { compileConditions } from "./view-ops";

/**
 * Running the rules.
 *
 * THIS CODE EXECUTES INSIDE SOMEBODY ELSE'S TRANSACTION, and every decision in
 * the file follows from that one fact.
 *
 * `runTrigger` is called from the ops functions that cause the events — a
 * record being created, a deal moving stage, a follow-up being ticked off — so
 * it inherits the caller's `tx`, their tenant role and their user id. Which
 * gives the property `core/automation.ts` states at length and this file
 * enforces by construction: **a rule cannot do anything the person who
 * triggered it could not do themselves.** RLS has already decided what that
 * transaction can see and write; nothing here re-implements a permission check,
 * because there is nothing left to check.
 *
 * A FAILING RULE MUST NOT ROLL BACK THE PERSON'S OWN WORK, and that is the
 * subtlety of running in-transaction. Every action is wrapped: a rule that
 * throws is logged and skipped, and the write that triggered it still commits.
 * Somebody renaming a customer should not be told their rename failed because
 * an automation about follow-ups is broken.
 *
 * BUT A SAVEPOINT IS WHAT MAKES THAT TRUE. Postgres aborts the whole
 * transaction on any error, so catching the exception in TypeScript is not
 * enough — the transaction would already be poisoned and the caller's own
 * commit would fail. Each action therefore runs inside `SAVEPOINT` /
 * `ROLLBACK TO SAVEPOINT`, which is the only construct that lets one statement
 * fail without taking the rest with it.
 *
 * ONE HOP, NEVER A CASCADE. The actions below call the ops functions directly
 * and those functions do not call `runTrigger`. A rule that creates a follow-up
 * therefore cannot wake a rule that watches follow-ups. That is enforced by
 * where the calls are, not by a depth counter — and if a future action ever
 * needs to go through a triggering path, the counter is the thing to add first.
 */

/* -- Loading -------------------------------------------------------------- */

export async function listRules(
  tx: Tx,
  tenantId: string,
): Promise<CrmAutomationRule[]> {
  return tx.query.crmAutomationRules.findMany({
    where: eq(schema.crmAutomationRules.tenantId, tenantId),
    orderBy: asc(schema.crmAutomationRules.name),
  });
}

/** A stored row as a rule, or null if it no longer entirely makes sense. */
export function ruleFrom(row: CrmAutomationRule): AutomationRule | null {
  const definition = (row.definition ?? {}) as Record<string, unknown>;
  return parseRule({
    trigger: row.trigger,
    conditions: definition.conditions ?? [],
    action: definition.action,
  });
}

/* -- Running -------------------------------------------------------------- */

export interface TriggerContext {
  tenantId: string;
  userId: string;
  /** The record the event happened to. Every trigger has one today. */
  partyId: string;
}

export interface TriggerOutcome {
  considered: number;
  applied: number;
  skipped: number;
  failed: number;
}

/**
 * Fire every active rule for a trigger.
 *
 * NEVER THROWS. A trigger is a side effect of somebody's real work, and the
 * real work is what matters — if the whole engine is broken, the record still
 * gets created. The outcome is returned for tests and for the audit trail
 * rather than for a decision the caller makes.
 */
export async function runTrigger(
  tx: Tx,
  ctx: TriggerContext,
  trigger: Trigger,
): Promise<TriggerOutcome> {
  const outcome: TriggerOutcome = {
    considered: 0,
    applied: 0,
    skipped: 0,
    failed: 0,
  };

  let rows: CrmAutomationRule[];
  try {
    rows = await tx.query.crmAutomationRules.findMany({
      where: and(
        eq(schema.crmAutomationRules.tenantId, ctx.tenantId),
        eq(schema.crmAutomationRules.trigger, trigger),
        eq(schema.crmAutomationRules.isActive, true),
      ),
      orderBy: asc(schema.crmAutomationRules.name),
    });
  } catch (err) {
    // Reading the rules is the one step outside a savepoint, because it is a
    // SELECT and cannot poison anything. If even that fails, the person's work
    // proceeds without automation.
    console.error("crm automation: could not load rules", err);
    return outcome;
  }

  for (const row of rows) {
    outcome.considered += 1;
    const rule = ruleFrom(row);
    if (!rule) {
      // A rule that no longer parses is SKIPPED, never partially applied. See
      // `parseRule` — this is the case its null return exists for.
      outcome.skipped += 1;
      continue;
    }

    const applied = await applyRule(tx, ctx, row, rule);
    if (applied === "applied") outcome.applied += 1;
    else if (applied === "skipped") outcome.skipped += 1;
    else outcome.failed += 1;
  }

  return outcome;
}

async function applyRule(
  tx: Tx,
  ctx: TriggerContext,
  row: CrmAutomationRule,
  rule: AutomationRule,
): Promise<"applied" | "skipped" | "failed"> {
  // A SAVEPOINT PER RULE. Without it a single failing action would abort the
  // caller's whole transaction — the rename, the stage move, the thing the
  // person actually did — and Postgres would refuse every later statement in
  // it. Catching the error in TypeScript alone does not undo that.
  const savepoint = `crm_rule_${row.id.replace(/-/g, "")}`;
  await tx.execute(sql.raw(`SAVEPOINT ${savepoint}`));

  try {
    if (!(await matches(tx, ctx, rule))) {
      await tx.execute(sql.raw(`RELEASE SAVEPOINT ${savepoint}`));
      return "skipped";
    }

    await performAction(tx, ctx, rule);
    await logAuditInTx(tx, {
      action: "crm.automation_applied",
      tenantId: ctx.tenantId,
      actorClerkUserId: ctx.userId,
      targetType: "party",
      targetId: ctx.partyId,
      // The rule as a sentence, so the audit row explains itself without
      // somebody having to go and read the rule that may since have changed.
      meta: { rule: row.name, ruleId: row.id, did: describeRule(rule) },
    });
    await tx.execute(sql.raw(`RELEASE SAVEPOINT ${savepoint}`));
    return "applied";
  } catch (err) {
    await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${savepoint}`));
    // Logged rather than raised: somebody renaming a customer should not be
    // told their rename failed because an automation is broken.
    console.error(`crm automation: rule ${row.id} failed`, err);
    return "failed";
  }
}

/**
 * Does the record this happened to still match the rule's conditions?
 *
 * BY RE-QUERYING, NOT BY AN IN-MEMORY MATCHER, and the reuse is the whole
 * argument. `compileConditions` already turns conditions into predicates, is
 * already tested against a database, and already handles the null-keeping
 * negatives and the bound values. A second evaluator here would be a second
 * implementation of the same rules, and it would drift from the first the day
 * somebody adds an operator — silently, because the two would disagree only on
 * the cases nobody wrote a test for.
 *
 * The cost is one indexed query per rule per trigger. That is the right price.
 */
async function matches(
  tx: Tx,
  ctx: TriggerContext,
  rule: AutomationRule,
): Promise<boolean> {
  if (rule.conditions.length === 0) return true;

  const rows = await tx
    .select({ id: schema.parties.id })
    .from(schema.parties)
    .leftJoin(
      schema.crmPartyDetails,
      and(
        eq(schema.crmPartyDetails.tenantId, schema.parties.tenantId),
        eq(schema.crmPartyDetails.partyId, schema.parties.id),
      ),
    )
    .where(
      and(
        eq(schema.parties.tenantId, ctx.tenantId),
        eq(schema.parties.id, ctx.partyId),
        ...compileConditions(rule.conditions, new Date()),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/* -- The actions ---------------------------------------------------------- */

/**
 * Do the thing.
 *
 * EVERY BRANCH WRITES THE SAME TABLES A PERSON'S CLICK WRITES, in the caller's
 * transaction, so RLS applies exactly as it would to them — but it writes them
 * DIRECTLY rather than through `createTask` and friends. Two reasons, and the
 * second is the one that would bite: those functions contain the trigger calls,
 * so routing through them would reintroduce the cascade this design forbids;
 * and it would make this file import `timeline-ops`, which imports `party-ops`,
 * which imports this file. The validation they would have applied is applied by
 * `actionProblem` before a rule is ever stored.
 */
async function performAction(
  tx: Tx,
  ctx: TriggerContext,
  rule: AutomationRule,
): Promise<void> {
  const { action } = rule;

  switch (action.kind) {
    case "create_task": {
      const dueOn = new Date();
      dueOn.setUTCDate(dueOn.getUTCDate() + (action.dueInDays ?? 0));
      // A DATE column, and follow-ups are due on a DAY — the same rule the
      // timeline slice set down. `toISOString().slice(0, 10)` is the yyyy-mm-dd
      // that column wants.
      const due = dueOn.toISOString().slice(0, 10);

      const assignee = action.assignee?.trim()
        ? action.assignee.trim()
        : await recordOwner(tx, ctx);

      await tx.insert(schema.crmTasks).values({
        tenantId: ctx.tenantId,
        partyId: ctx.partyId,
        title: (action.title ?? "").trim(),
        dueOn: due,
        assigneeClerkUserId: assignee,
        // Attributed to the person whose action triggered it, not to a system
        // user. There is no system user, and inventing one would make the
        // audit trail lie about who caused the row to exist.
        createdByClerkUserId: ctx.userId,
      });
      return;
    }

    case "set_lifecycle_stage": {
      const rows = await tx
        .update(schema.crmPartyDetails)
        .set({
          lifecycleStage: (action.stage ?? "").trim(),
          version: sql`${schema.crmPartyDetails.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.crmPartyDetails.tenantId, ctx.tenantId),
            eq(schema.crmPartyDetails.partyId, ctx.partyId),
          ),
        )
        .returning({ id: schema.crmPartyDetails.id });
      // Zero rows is not an error: the record may have no CRM details row yet,
      // or be restricted and invisible to this transaction. Both mean "this
      // rule does not apply here", which is what a skip is.
      if (rows.length === 0) {
        throw new CrmError("RECORD_NOT_FOUND", "no details row to update");
      }
      return;
    }

    case "assign_record": {
      const rows = await tx
        .update(schema.crmPartyDetails)
        .set({
          ownerClerkUserId: (action.assignee ?? "").trim(),
          version: sql`${schema.crmPartyDetails.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.crmPartyDetails.tenantId, ctx.tenantId),
            eq(schema.crmPartyDetails.partyId, ctx.partyId),
          ),
        )
        .returning({ id: schema.crmPartyDetails.id });
      if (rows.length === 0) {
        throw new CrmError("RECORD_NOT_FOUND", "no details row to update");
      }
      return;
    }
  }
}

/** Who the record is assigned to, or the person who triggered the rule. */
async function recordOwner(tx: Tx, ctx: TriggerContext): Promise<string> {
  const row = await tx.query.crmPartyDetails.findFirst({
    where: and(
      eq(schema.crmPartyDetails.tenantId, ctx.tenantId),
      eq(schema.crmPartyDetails.partyId, ctx.partyId),
    ),
    columns: { ownerClerkUserId: true },
  });
  // Falling back to the trigger's actor rather than leaving it unassigned: an
  // unassigned follow-up appears on nobody's list, which is the one outcome
  // that makes an automation worse than nothing.
  return row?.ownerClerkUserId?.trim() || ctx.userId;
}

/* -- Managing rules ------------------------------------------------------- */

export const RULE_NAME_MAX = 80;

export async function createRule(
  tx: Tx,
  tenantId: string,
  clerkUserId: string,
  input: { name: string; rule: AutomationRule; isActive: boolean },
): Promise<CrmAutomationRule> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > RULE_NAME_MAX) {
    throw new CrmError("RULE_NAME_REQUIRED", "name required");
  }
  const rows = await tx
    .insert(schema.crmAutomationRules)
    .values({
      tenantId,
      name,
      trigger: input.rule.trigger,
      definition: { conditions: input.rule.conditions, action: input.rule.action },
      isActive: input.isActive,
      createdByClerkUserId: clerkUserId,
    })
    .onConflictDoNothing()
    .returning();

  const row = rows[0];
  if (!row) throw new CrmError("RULE_NAME_TAKEN", "a rule with that name exists");
  return row;
}

export async function setRuleActive(
  tx: Tx,
  tenantId: string,
  ruleId: string,
  isActive: boolean,
): Promise<void> {
  const rows = await tx
    .update(schema.crmAutomationRules)
    .set({ isActive, updatedAt: new Date() })
    .where(
      and(
        eq(schema.crmAutomationRules.tenantId, tenantId),
        eq(schema.crmAutomationRules.id, ruleId),
      ),
    )
    .returning({ id: schema.crmAutomationRules.id });
  if (rows.length === 0) throw new CrmError("FORBIDDEN", "owner role required");
}

export async function deleteRule(
  tx: Tx,
  tenantId: string,
  ruleId: string,
): Promise<void> {
  const rows = await tx
    .delete(schema.crmAutomationRules)
    .where(
      and(
        eq(schema.crmAutomationRules.tenantId, tenantId),
        eq(schema.crmAutomationRules.id, ruleId),
      ),
    )
    .returning({ id: schema.crmAutomationRules.id });
  if (rows.length === 0) throw new CrmError("FORBIDDEN", "owner role required");
}
