import "server-only";
import type { Tx } from "@/db";
import { createCostCode, createCostCodeSet, listCostCodeSets, type JobsCtx } from "./ops";
import { createOutline, listOutlines } from "./outline-ops";
import { costCodeSetsFrom, estimateOutlinesFrom } from "./seed-shape";

export { costCodeSetsFrom, estimateOutlinesFrom, summarizeJobsSeed } from "./seed-shape";
export type {
  CostCodeSetSeed,
  EstimateOutlineSeed,
  EstimateOutlineStepSeed,
  EstimateOutlineQuestionSeed,
  JobsSeed,
} from "./seed-shape";

/**
 * A profile's starter cost code lists, written into this pack's tables.
 *
 * **ADDITIVE, RE-RUNNABLE, AND THE TENANT'S OWN ROWS WIN**, the rule every seed
 * follows (`src/app/admin/profile-seed.ts`). A list is skipped WHOLE when the
 * tenant already has one by that name — not merged into, because a business
 * that pruned "CSI divisions" down to the twelve it uses must not find the
 * other eleven back after a re-install. The first list a tenant ever gets
 * becomes its default, by `createCostCodeSet`'s own rule; a seeded list never
 * displaces a default the tenant already chose.
 *
 * Through `createCostCodeSet` / `createCostCode`, never a raw insert, so every
 * seeded code is a cost object from the moment it exists — the dimension sync
 * is what makes a code more than a list, and a seed that skipped it would ship
 * a chart nobody could charge a bill to.
 */
export async function applyJobsSeed(
  tx: Tx,
  ctx: JobsCtx,
  seed: unknown,
): Promise<{ created: number; description: string }> {
  const wanted = costCodeSetsFrom(seed);
  const wantedOutlines = estimateOutlinesFrom(seed);
  if (wanted.length === 0 && wantedOutlines.length === 0) {
    return { created: 0, description: "" };
  }

  const existing = new Set(
    (await listCostCodeSets(tx, ctx.tenantId)).map((s) => s.name.trim().toLowerCase()),
  );

  let setsCreated = 0;
  let codesCreated = 0;
  for (const set of wanted) {
    if (existing.has(set.name.toLowerCase())) continue;
    const row = await createCostCodeSet(tx, ctx, {
      name: set.name,
      notes: set.notes,
      // Undefined on purpose: the pack's rule makes the FIRST list a tenant
      // has its default and leaves an existing default alone. A seed must not
      // have an opinion the tenant's own chart outranks.
      isDefault: undefined,
    });
    setsCreated += 1;
    for (const [i, code] of set.codes.entries()) {
      await createCostCode(tx, ctx, {
        setId: row.id,
        code: code.code,
        name: code.name,
        sortOrder: (i + 1) * 10,
      });
      codesCreated += 1;
    }
    existing.add(set.name.toLowerCase());
  }

  /**
   * THE OUTLINES, by the same three rules (ADR 0098). Skipped WHOLE when the
   * tenant already has one by that name — a business that pruned "New build"
   * down to the fourteen steps it actually walks must not find the other
   * twenty back after a re-install — and never made the default, because the
   * pack's own rule already makes the first one a tenant has its default.
   */
  const existingOutlines = new Set(
    (await listOutlines(tx, ctx.tenantId)).map((o) =>
      o.outline.name.trim().toLowerCase(),
    ),
  );
  let outlinesCreated = 0;
  let stepsCreated = 0;
  for (const outline of wantedOutlines) {
    if (existingOutlines.has(outline.name.toLowerCase())) continue;
    await createOutline(tx, ctx, {
      name: outline.name,
      notes: outline.notes,
      isDefault: undefined,
      steps: outline.steps.map((step) => ({
        title: step.title,
        costCode: step.costCode,
        guidance: step.guidance,
        questions: step.questions?.map((q) => ({
          prompt: q.prompt,
          kind: q.kind,
          choices: q.choices,
          unit: q.unit,
          notes: q.notes,
          alwaysAsk: q.alwaysAsk,
        })),
      })),
    });
    outlinesCreated += 1;
    stepsCreated += outline.steps.length;
    existingOutlines.add(outline.name.toLowerCase());
  }

  const parts: string[] = [];
  if (setsCreated > 0) {
    parts.push(
      `${setsCreated} cost code ${setsCreated === 1 ? "list" : "lists"} with ${codesCreated} codes`,
    );
  }
  if (outlinesCreated > 0) {
    parts.push(
      `${outlinesCreated} estimate ${outlinesCreated === 1 ? "outline" : "outlines"} with ${stepsCreated} steps`,
    );
  }
  return {
    created: setsCreated + outlinesCreated,
    description: parts.join(" and "),
  };
}
