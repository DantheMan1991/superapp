import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobProject } from "@/db/schema";
import {
  actualByProject,
  budgetByProject,
  billedByProject,
  committedTotals,
  getProject,
  projectValues,
} from "./ops";
import { ledgerTermsByProject } from "./wip-ops";
import { type ProjectValuation, measureProject } from "./list-math";

/**
 * A job's identity and its five vitals — the strip that stays on every tab of
 * the project page.
 *
 * ── THE SAME ARITHMETIC AS THE LIST, DELIBERATELY ───────────────────────────
 *
 * `measureProject` is what the module home uses, so the percent complete and
 * the billed-versus-earned figure on a job's own page are the SAME numbers the
 * list showed a click earlier. A page that quietly re-derived them would
 * eventually disagree with the list, and the person reading would have no way
 * to tell which one was lying. One function, both screens.
 *
 * ── WHY THIS IS SEPARATE FROM THE PAGE'S OWN READ ───────────────────────────
 *
 * The strip lives in `[id]/layout.tsx` because it must not move or reload as
 * somebody moves between Overview, Job cost and Schedule — it is the page's
 * identity, not one tab's content. A layout gets its own render, so it needs
 * its own read; everything here is either a single row or a tenant-wide
 * grouped map, and `committedTotals` and the three ledger maps are the same
 * statements the tabs already run.
 */
export interface ProjectVitals {
  project: JobProject;
  entityName: string;
  clientName: string | null;
  enterpriseName: string | null;
  /** Revised: original + approved changes, over counted contracts. */
  contractCents: number;
  changesCents: number;
  signedCount: number;
  proposedCents: number;
  /** Ordered, billed or not: every commitment line on the job. */
  committedCents: number;
  /** From the ledger, scoped to the job's own company. */
  actualCents: number;
  budgetCents: number;
  billedCents: number;
  valuation: ProjectValuation;
}

export async function projectVitals(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<ProjectVitals | null> {
  const project = await getProject(tx, tenantId, projectId);
  if (!project) return null;

  const [entity, party, enterprise, values, budgets, committed, actual, billed, terms] =
    await Promise.all([
      tx
        .select({ name: schema.entities.name })
        .from(schema.entities)
        .where(
          and(eq(schema.entities.tenantId, tenantId), eq(schema.entities.id, project.entityId)),
        )
        .limit(1),
      project.partyId
        ? tx
            .select({ name: schema.parties.displayName })
            .from(schema.parties)
            .where(
              and(
                eq(schema.parties.tenantId, tenantId),
                eq(schema.parties.id, project.partyId),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
      project.enterpriseId
        ? tx
            .select({ name: schema.enterprises.name })
            .from(schema.enterprises)
            .where(
              and(
                eq(schema.enterprises.tenantId, tenantId),
                eq(schema.enterprises.id, project.enterpriseId),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
      projectValues(tx, tenantId),
      budgetByProject(tx, tenantId),
      committedTotals(tx, tenantId),
      /*
       * ACTUAL COST COMES FROM THE LEDGER through a CORE export, never from a
       * query of accounting's tables — `getBalances` already applies the basis
       * lens and the entity scope, so a job cost figure that disagreed with the
       * P&L is not possible. Scoped to the project's own company, as the tabs
       * below it are.
       */
      actualByProject(tx, tenantId, { kind: "one", entityId: project.entityId }),
      billedByProject(tx, tenantId, { kind: "one", entityId: project.entityId }),
      ledgerTermsByProject(tx, tenantId),
    ]);

  const value = values.get(project.id);
  const contractCents = value?.valueCents ?? 0;
  const signedCount = value?.signedCount ?? 0;
  const proposedCents = value?.proposedCents ?? 0;
  const budgetCents = budgets.get(project.id) ?? 0;
  const actualCents = actual.get(project.id) ?? 0;
  const billedCents = billed.get(project.id) ?? 0;

  return {
    project,
    entityName: entity[0]?.name ?? "—",
    clientName: party[0]?.name ?? null,
    enterpriseName: enterprise[0]?.name ?? null,
    contractCents,
    changesCents: value?.changesCents ?? 0,
    signedCount,
    proposedCents,
    committedCents: committed.byProject.get(project.id) ?? 0,
    actualCents,
    budgetCents,
    billedCents,
    valuation: measureProject({
      status: project.status,
      contractCents,
      signedCount,
      proposedCents,
      budgetCents,
      costToDateCents: actualCents,
      billedCents,
      terms: terms.get(project.id) ?? null,
    }),
  };
}
