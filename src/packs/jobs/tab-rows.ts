import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db";
import type { JobTab } from "./tabs";

/** The eight this file asks about, in the order the columns are selected. */
const OPTIONAL_TAB_ORDER: JobTab[] = [
  "changes",
  "ordered",
  "schedule",
  "selections",
  "log",
  "drawings",
  "estimates",
  "warranty",
];

/**
 * WHICH OF A PROJECT'S OPTIONAL TABS ALREADY HAVE SOMETHING ON THEM.
 *
 * The safety half of the tab setting (`tabs.ts`). A tenant who decides on
 * Tuesday that they do not do warranty must not lose Monday's warranty claim —
 * so a tab that has rows on THIS project is drawn whatever the setting says,
 * and the setting decides what a job starts with rather than what it is allowed
 * to remember.
 *
 * **ONE ROUND TRIP, EIGHT `EXISTS`.** Not eight queries and not eight counts:
 * the question is "is there anything", `EXISTS` stops at the first row, and the
 * job layout already runs `projectVitals`, which is heavier than all of this
 * together. Every subquery is covered by the same `(tenant_id, project_id)`
 * index the tab's own page uses.
 *
 * `changes` is the odd one and has to be: a change order hangs off a CONTRACT,
 * not a project (`job_change_orders.contract_id`), because it changes an
 * agreement's value. So it asks through the contracts of this project.
 *
 * Raw SQL rather than the query builder because this is eight scalar
 * subqueries in one row, which is the shape drizzle's builder is worst at and
 * SQL is clearest at. The tenant predicate is on every one of them — belt as
 * well as the RLS braces, which `withTenant` has already fastened.
 */
export async function tabsWithRows(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<JobTab[]> {
  const rows = await tx.execute(sql`
    select
      exists (
        select 1 from job_change_orders co
        join job_contracts c on c.id = co.contract_id and c.tenant_id = co.tenant_id
        where co.tenant_id = ${tenantId} and c.project_id = ${projectId}
      ) as changes,
      exists (select 1 from job_commitments   where tenant_id = ${tenantId} and project_id = ${projectId}) as ordered,
      exists (select 1 from job_phases        where tenant_id = ${tenantId} and project_id = ${projectId}) as schedule,
      exists (select 1 from job_selections    where tenant_id = ${tenantId} and project_id = ${projectId}) as selections,
      exists (select 1 from job_daily_logs    where tenant_id = ${tenantId} and project_id = ${projectId}) as log,
      exists (select 1 from job_drawing_sets  where tenant_id = ${tenantId} and project_id = ${projectId}) as drawings,
      exists (select 1 from job_estimates     where tenant_id = ${tenantId} and project_id = ${projectId}) as estimates,
      exists (select 1 from job_warranty_claims where tenant_id = ${tenantId} and project_id = ${projectId}) as warranty
  `);
  const TABS = OPTIONAL_TAB_ORDER;
  const row = (rows as unknown as { rows?: Record<string, unknown>[] }).rows?.[0];
  /**
   * **WRONG IN THE SAFE DIRECTION, ON PURPOSE.**
   *
   * A raw `sql` result is not type-checked — the driver decides what comes back
   * and TypeScript takes the claim on trust, which is how a `sql<Date>` once
   * shipped a string and made every comparison quietly false. So nothing here
   * trusts the shape: no row at all means show every tab, and any value that is
   * not exactly `false` counts as "there is something here".
   *
   * Showing a tab that turns out to be empty costs one click. Hiding one that
   * has a warranty claim on it costs the claim.
   */
  if (!row) return TABS;
  return TABS.filter((tab) => row[tab] !== false);
}

/**
 * The same question across the WHOLE business: which optional tabs has this
 * tenant ever put anything on.
 *
 * For the settings screen, which has no project in front of it. It is what
 * lets the form say "some jobs already have work here" beside a tab somebody
 * is about to switch off — so unticking it is an informed decision rather than
 * a surprise the next time they open one of those jobs.
 *
 * No join for `changes` here: a change order carries the tenant, and "has this
 * business ever raised one" does not need to know which project it was on.
 */
export async function tabsInUse(tx: Tx, tenantId: string): Promise<JobTab[]> {
  const rows = await tx.execute(sql`
    select
      exists (select 1 from job_change_orders   where tenant_id = ${tenantId}) as changes,
      exists (select 1 from job_commitments     where tenant_id = ${tenantId}) as ordered,
      exists (select 1 from job_phases          where tenant_id = ${tenantId}) as schedule,
      exists (select 1 from job_selections      where tenant_id = ${tenantId}) as selections,
      exists (select 1 from job_daily_logs      where tenant_id = ${tenantId}) as log,
      exists (select 1 from job_drawing_sets    where tenant_id = ${tenantId}) as drawings,
      exists (select 1 from job_estimates       where tenant_id = ${tenantId}) as estimates,
      exists (select 1 from job_warranty_claims where tenant_id = ${tenantId}) as warranty
  `);
  const row = (rows as unknown as { rows?: Record<string, unknown>[] }).rows?.[0];
  if (!row) return [];
  // `!== false`, the same way round as `tabsWithRows` and for the same reason:
  // this drives the warning beside a tab somebody is about to switch off, so an
  // unreadable value should warn rather than stay quiet.
  return OPTIONAL_TAB_ORDER.filter((tab) => row[tab] !== false);
}
