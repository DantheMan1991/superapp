import "server-only";
import type { Tx } from "@/db";
import { createCostCode, createCostCodeSet, listCostCodeSets, type JobsCtx } from "./ops";
import { costCodeSetsFrom } from "./seed-shape";

export { costCodeSetsFrom, summarizeJobsSeed } from "./seed-shape";
export type { CostCodeSetSeed, JobsSeed } from "./seed-shape";

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
  if (wanted.length === 0) return { created: 0, description: "" };

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

  return {
    created: setsCreated,
    description:
      setsCreated === 0
        ? ""
        : `${setsCreated} cost code ${setsCreated === 1 ? "list" : "lists"} with ${codesCreated} codes`,
  };
}
