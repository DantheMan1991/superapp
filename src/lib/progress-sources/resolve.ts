import "server-only";
import type { Tx } from "@/db";
import { withTenant } from "@/db";
import type { TenantRole } from "@/lib/auth";
import { getActiveModules } from "@/lib/modules";
import { progressSources } from "./registry";
import type { ProgressRow, ProgressSource, ProgressWindow, TodayCard } from "./types";

/**
 * Running the progress slot (docs/modules/health.md, H1): the sources of the
 * tools switched on in the space, each asked in a transaction of the space's
 * own, so RLS has already decided what it can see.
 *
 * A source that fails costs its own rows, never the page: Health's own rows
 * still show, and the page says which tool could not be read. Each source has
 * its own transaction because a failed query aborts the transaction it ran in,
 * and would take every source after it down too. Nothing here re-checks what a
 * source may see; it is handed the caller's tenant and role.
 */

export interface Contributed<T> {
  found: T;
  /** The tools whose source failed, by name ("Workouts"). */
  failed: string[];
}

async function activeSources(tenantId: string): Promise<ProgressSource[]> {
  const active = new Set((await getActiveModules(tenantId)).map((m) => m.module.id));
  return progressSources.filter((source) => active.has(source.tool));
}

async function askEach<T>(
  tenantId: string,
  role: TenantRole,
  ask: (source: ProgressSource, tx: Tx) => Promise<T[]>,
): Promise<Contributed<T[]>> {
  const found: T[] = [];
  const failed: string[] = [];
  for (const source of await activeSources(tenantId)) {
    try {
      found.push(...(await withTenant(tenantId, (tx) => ask(source, tx), { role })));
    } catch (error) {
      console.error(`progress source ${source.tool} failed`, error instanceof Error ? error.name : "unknown");
      failed.push(source.name);
    }
  }
  return { found, failed };
}

/** Every switched-on tool's rows for these windows, in registration order. */
export function contributedRows(
  tenantId: string,
  windows: readonly ProgressWindow[],
  role: TenantRole,
): Promise<Contributed<ProgressRow[]>> {
  return askEach(tenantId, role, (source, tx) => source.rows(tx, tenantId, windows));
}

/** Every switched-on tool's card for today. */
export function contributedToday(tenantId: string, day: string, role: TenantRole): Promise<Contributed<TodayCard[]>> {
  return askEach(tenantId, role, async (source, tx) => {
    const card = await source.today(tx, tenantId, day);
    return card ? [card] : [];
  });
}
