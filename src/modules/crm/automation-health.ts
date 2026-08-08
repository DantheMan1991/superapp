import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, withSystem, type Tx } from "@/db";
import type { CrmAutomationRuleHealth } from "@/db/schema";

/**
 * Whether each rule is actually working.
 *
 * Before this, a rule that threw was written to the server console and counted
 * in a return value nobody reads. `audit_log` records the firings that SUCCEED,
 * so a rule failing every single time looked identical to one whose conditions
 * simply never matched — and the two want opposite responses.
 *
 * That was cosmetic while rules only nudged records around. It stopped being
 * cosmetic when rules started creating follow-ups and follow-ups started
 * routing to somebody's daily digest: a silently broken rule is now silently
 * missing obligations, which is the exact failure the digest was built to
 * prevent.
 *
 * ── WHY THE WRITES ARE CHEAP ─────────────────────────────────────────────────
 *
 * A row exists only while something is wrong, and is written only when the
 * state CHANGES:
 *
 *   healthy → failing    insert
 *   failing → failing    update (bump the count, keep the newest error)
 *   failing → recovered  delete
 *   healthy → healthy    NOTHING
 *
 * The last line is the one that matters. Rules fire on every record create and
 * update, so a per-run write would put an extra transaction on the hot path of
 * ordinary work forever, in exchange for information that is only interesting
 * when it is bad. A working tenant carries no rows here and pays nothing.
 */

export interface RuleOutcomes {
  /** Rules that threw this run, with the reason. */
  failed: Array<{ ruleId: string; error: string }>;
  /** Rules that applied cleanly this run. */
  succeeded: string[];
}

/**
 * Persist what this run learned, if anything changed.
 *
 * `previouslyFailing` is the set of rule ids that already had a health row when
 * the run started — read as part of the engine's existing rules query, so this
 * costs no extra SELECT. Comparing against it is what makes "nothing changed"
 * detectable without a read here.
 *
 * withSystem, justified (S2): trusted engine code, and the ids come from rule
 * rows the engine just loaded rather than from anything a caller supplied. It
 * also runs OUTSIDE the triggering transaction on purpose — a failure that
 * happened should be recorded even if the person's own work is later rolled
 * back for an unrelated reason.
 *
 * Never throws. This is diagnostics; it must not be able to break the work it
 * is reporting on.
 */
export async function recordRuleOutcomes(
  tenantId: string,
  outcomes: RuleOutcomes,
  previouslyFailing: ReadonlySet<string>,
): Promise<void> {
  const recovered = outcomes.succeeded.filter((id) => previouslyFailing.has(id));
  if (outcomes.failed.length === 0 && recovered.length === 0) return;

  try {
    await withSystem(async (tx) => {
      for (const failure of outcomes.failed) {
        await tx
          .insert(schema.crmAutomationRuleHealth)
          .values({
            tenantId,
            ruleId: failure.ruleId,
            consecutiveFailures: 1,
            lastError: failure.error,
            lastErrorAt: new Date(),
          })
          .onConflictDoUpdate({
            target: schema.crmAutomationRuleHealth.ruleId,
            set: {
              // Incremented in SQL rather than read-then-written: two triggers
              // failing concurrently must count as two.
              consecutiveFailures: sql`${schema.crmAutomationRuleHealth.consecutiveFailures} + 1`,
              lastError: failure.error,
              lastErrorAt: new Date(),
            },
          });
      }

      if (recovered.length > 0) {
        await tx
          .delete(schema.crmAutomationRuleHealth)
          .where(
            and(
              eq(schema.crmAutomationRuleHealth.tenantId, tenantId),
              inArray(schema.crmAutomationRuleHealth.ruleId, recovered),
            ),
          );
      }
    });
  } catch (err) {
    // The diagnostics failing is not worth failing the person's work over, and
    // the console still has the original error that got us here.
    console.error("crm automation: could not record rule health", err);
  }
}

/** Health for a set of rules, in the caller's own transaction. */
export async function healthForRules(
  tx: Tx,
  tenantId: string,
  ruleIds: readonly string[],
): Promise<Map<string, CrmAutomationRuleHealth>> {
  if (ruleIds.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(schema.crmAutomationRuleHealth)
    .where(
      and(
        eq(schema.crmAutomationRuleHealth.tenantId, tenantId),
        inArray(schema.crmAutomationRuleHealth.ruleId, [...ruleIds]),
      ),
    );
  return new Map(rows.map((r) => [r.ruleId, r]));
}
