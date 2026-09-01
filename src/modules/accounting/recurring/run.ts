import "server-only";
import { ne } from "drizzle-orm";
import { schema, withSystem } from "@/db";
import { localHourInTimezone } from "@/lib/timezone";
import type { LedgerCtx } from "../core";
import { generateRecurringEntries } from "./generate";

/**
 * The nightly recurring sweep.
 *
 * Until this existed, a recurring entry only ran when somebody opened the page
 * and pressed **Generate now** — which is the difference between a feature and
 * a demo, because not having to remember is the entire point of writing a
 * schedule down. The engine was always ready for it: catch-up creates one
 * record per missed month dated to that month, so a sweep that misses a day,
 * or a tenant that goes a fortnight without one, lands in exactly the same
 * place as one that never missed.
 *
 * ONE CRON SERVES EVERY TIMEZONE, the same shape as the digest and the
 * reminder sweep: it wakes hourly, asks each tenant what time it is *there*,
 * and acts on the ones where it is `GENERATE_HOUR`. Asking the zone beats
 * storing a UTC run-time (which drifts twice a year) and beats a cron per zone
 * (a config change every time a client moves).
 *
 * Nothing here decides WHAT to generate. That is `generate.ts`, which owns the
 * catch-up loop, the version CAS and the period-lock deferral; this file finds
 * tenants and calls it.
 */

/**
 * 6am local, two hours before reminders go out at 8.
 *
 * Deliberately early and deliberately ordered: an invoice this sweep generates
 * is a DRAFT, and a draft is never chased, so the gap is not about the
 * reminder run seeing today's work. It is about the owner opening the app to
 * a month that is already made up rather than watching it appear.
 */
export const GENERATE_HOUR = 6;

export interface RecurringRunResult {
  tenantsConsidered: number;
  /** Tenants where it is `GENERATE_HOUR` right now. */
  tenantsDue: number;
  /** Of those, the ones with accounting switched on. */
  tenantsRun: number;
  created: number;
  posted: number;
  /** Auto-posting journals left as drafts because their period is closed. */
  deferredToDraft: number;
  /** Tags dropped because the member they named has since been retired. */
  tagsDropped: number;
  /** Templates that failed. Counted, never named — S9. */
  templateErrors: number;
  /** Tenants whose whole run threw. */
  tenantErrors: number;
}

/**
 * Tenants to look at.
 *
 * `withSystem`, justified (S2): trusted background code enumerating tenants,
 * with no user input reaching it. The run picks its own work — the same
 * property the digest, mail-sync and reminder crons rely on.
 */
async function tenantsToConsider() {
  return withSystem((tx) =>
    tx
      .select({ id: schema.tenants.id, timezone: schema.tenants.timezone })
      .from(schema.tenants)
      .where(ne(schema.tenants.status, "churned")),
  );
}

/** Is accounting switched on for this tenant? A sweep must not wake a module nobody bought. */
async function accountingEnabled(tenantId: string): Promise<boolean> {
  const row = await withSystem((tx) =>
    tx.query.tenantModules.findFirst({
      where: (m, { and, eq: e }) =>
        and(e(m.tenantId, tenantId), e(m.moduleId, "accounting"), e(m.enabled, true)),
    }),
  );
  return !!row;
}

export async function runRecurringEntries(
  now: Date = new Date(),
): Promise<RecurringRunResult> {
  const result: RecurringRunResult = {
    tenantsConsidered: 0,
    tenantsDue: 0,
    tenantsRun: 0,
    created: 0,
    posted: 0,
    deferredToDraft: 0,
    tagsDropped: 0,
    templateErrors: 0,
    tenantErrors: 0,
  };

  const tenants = await tenantsToConsider();
  result.tenantsConsidered = tenants.length;

  for (const tenant of tenants) {
    if (localHourInTimezone(tenant.timezone, now) !== GENERATE_HOUR) continue;
    result.tenantsDue += 1;
    if (!(await accountingEnabled(tenant.id))) continue;

    try {
      /**
       * `owner`, and the reason it is not an escalation: `role` on a
       * `LedgerCtx` is an AUTHORIZATION fact, not an RLS one — the engine's
       * own `withTenant` calls pass no role, so RLS still sees the default
       * `staff`. What this asserts is that an unattended run is allowed to do
       * what an owner pressing the button is allowed to do, which is the whole
       * proposition of a schedule. `userId` is replaced per template by
       * `unattended`, so this one is never written anywhere.
       */
      const ctx: LedgerCtx = {
        tenantId: tenant.id,
        userId: "system:recurring",
        role: "owner",
      };
      const run = await generateRecurringEntries(ctx, { unattended: true });
      result.tenantsRun += 1;
      result.created += run.created;
      result.posted += run.posted;
      result.deferredToDraft += run.deferredToDraft;
      result.tagsDropped += run.tagsDropped;
      result.templateErrors += run.errors.length;
    } catch (err) {
      // One tenant's failure must not stop the others, exactly as one
      // template's failure does not stop its tenant.
      result.tenantErrors += 1;
      console.error("recurring sweep failed for a tenant", err);
    }
  }

  return result;
}
