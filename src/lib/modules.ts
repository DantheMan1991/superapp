import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { withTenant, schema, type Tx } from "@/db";
import type { Module, TenantModule } from "@/db/schema";
import { deniedFor } from "@/lib/access/current";
import { reaches } from "@/lib/access/can";
import { areaForPath } from "@/lib/access/areas";
import { headers } from "next/headers";

export interface ActiveModule {
  module: Module;
  tenantModule: TenantModule;
}

/** Modules switched on for a tenant, in nav order. Tenant-context query. */
export async function getActiveModules(
  tenantId: string,
): Promise<ActiveModule[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ module: schema.modules, tenantModule: schema.tenantModules })
      .from(schema.tenantModules)
      .innerJoin(
        schema.modules,
        eq(schema.tenantModules.moduleId, schema.modules.id),
      )
      .where(
        and(
          eq(schema.tenantModules.tenantId, tenantId),
          eq(schema.tenantModules.enabled, true),
        ),
      )
      .orderBy(asc(schema.modules.sortOrder));
    return rows;
  });
}

export async function isModuleEnabled(
  tenantId: string,
  moduleId: string,
): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const row = await tx.query.tenantModules.findFirst({
      where: and(
        eq(schema.tenantModules.tenantId, tenantId),
        eq(schema.tenantModules.moduleId, moduleId),
        eq(schema.tenantModules.enabled, true),
      ),
    });
    return !!row;
  });
}

/**
 * 404s when the module isn't switched on for this tenant, **or when this
 * person's access level does not reach it** (ADR 0093).
 *
 * ── WHY THE PERSON CHECK LIVES HERE ─────────────────────────────────────────
 *
 * 349 call sites already do this, because it has been step 4 of the
 * add-a-module workflow since the beginning. Putting the second question in the
 * same function means every page and every action that follows the existing
 * convention is gated without being edited, and a module page written next year
 * is gated by following the same convention rather than by remembering a new
 * one. The alternative — a second call beside this one — is 349 edits now and
 * one forgotten call later, and the forgotten one is a silent hole.
 *
 * **`notFound()` FOR BOTH, and the same `notFound()`.** A person who may not
 * open Reports gets exactly what they get for a module the business never
 * bought: nothing. Distinguishing "no such thing" from "not for you" tells them
 * what exists, which is a thing an owner deliberately did not tell them.
 *
 * **IT IS A SCREEN GATE, NOT A ROW GATE**, and the distinction is load-bearing
 * (ADR 0093). Which COMPANY's rows somebody may read is answered by Postgres,
 * because Reports and Purchases read the same `journal_lines` and no gate on a
 * screen can tell those rows apart. This closes the door; RLS is what makes the
 * wall.
 */
export async function requireModuleEnabled(
  tenantId: string,
  moduleId: string,
): Promise<void> {
  if (!(await isModuleEnabled(tenantId, moduleId))) notFound();
  const denied = await deniedFor(tenantId);
  if (!reaches(denied, moduleId)) notFound();
  /**
   * AND WHICH PART OF THE TOOL (ADR 0095), WITHOUT A LINE IN ANY OF THE PAGES.
   *
   * The proxy stamps `x-yosher-path` on every request it passes, from the
   * request's own URL, overwriting anything a client sent (`src/proxy.ts`) —
   * which is what makes it safe to read here. So the area is derived from where
   * the caller actually is, and all 349 existing call sites gained the check
   * the same way they gained the person check: by not being edited.
   *
   * **FOR A SERVER ACTION THE PATH IS THE SUBMITTING PAGE'S**, not the action's
   * own. That is defence in depth rather than a boundary, and it is only ever
   * stricter: it can refuse a caller who could not have loaded the page the
   * action came from, and never admits one who could not. The boundary for
   * writes remains the module gate and the role. See ADR 0095's open item.
   */
  const path = (await headers()).get("x-yosher-path") ?? "";
  /**
   * **IMPORTED AT CALL TIME, NOT AT MODULE LOAD, AND IT HAS TO BE.**
   * `@/lib/features` merges the two registries, which import every module's and
   * pack's `Component` — and those import this file for `requireModuleEnabled`.
   * A static import here closes that loop, and `packRegistry` is `undefined`
   * when `features.ts` initialises: five suites failed to load with "Cannot
   * convert undefined or null to object" before this line was a dynamic import.
   *
   * Deferring to call time breaks the cycle without moving the area
   * declarations away from the tools that own them, which is the whole point of
   * declaring them there.
   */
  const { getFeature } = await import("@/lib/features");
  const area = areaForPath(path, getFeature(moduleId)?.areas);
  if (area && !reaches(denied, area)) notFound();
}

/**
 * The same gate for an AREA inside a module — `accounting:reports`.
 *
 * Separate from the call above rather than folded into it, because the module
 * half has 349 callers that must not learn a second argument. A screen with an
 * area calls both, in the order they are written here: what the business has,
 * then what this person has.
 */
export async function requireAreaReachable(
  tenantId: string,
  areaKey: string,
): Promise<void> {
  if (!reaches(await deniedFor(tenantId), areaKey)) notFound();
}

/**
 * THE GATE FOR A ROUTE HANDLER (ADR 0096). Null when allowed, a Response when
 * not — a handler cannot `notFound()`.
 *
 * ── WHY THIS EXISTS, AND WHAT IT IS FIXING ──────────────────────────────────
 *
 * An audit of every route handler that reads tenant data found **nineteen of
 * them and not one calling `requireModuleEnabled`**. Twelve checked
 * `isModuleEnabled`, which asks whether the BUSINESS has the tool and never
 * whether this PERSON may reach it. So a person whose access level denied
 * Accounting outright could still `GET /api/accounting/invoices/<id>/pdf` and
 * be handed the invoice. They need the uuid — and uuids are in URLs, in emails,
 * and in lists the same person can see elsewhere.
 *
 * The pages and the server actions were covered from the day levels shipped,
 * because both go through `requireModuleEnabled`. Route handlers never did, and
 * `tests/module-gate-scan.test.ts` did not look at them. Both are fixed here.
 *
 * ── THE AREA IS NAMED, NOT DERIVED ──────────────────────────────────────────
 *
 * A page's area comes from its own path. `/api/accounting/invoices/[id]/pdf` is
 * not under `/dashboard/m/`, so nothing can derive it — the route has to say
 * which part of which tool it serves. Every mapping in this codebase was taken
 * from the screen that actually links to the route, not from its name: the
 * `entry_id` that meant `time_entries` rather than `journal_entries` is a
 * recent enough lesson (`drizzle/0388`).
 *
 * `areas` is ANY-OF, not all-of. A commitment PDF is linked from both the
 * Ordered tab and the Commitments tab, and somebody who can reach either has a
 * legitimate route to the file.
 */
export async function routeGate(
  tenantId: string,
  moduleId: string,
  areas: readonly string[] = [],
): Promise<Response | null> {
  const refuse = () =>
    new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  if (!(await isModuleEnabled(tenantId, moduleId))) return refuse();
  const denied = await deniedFor(tenantId);
  if (!reaches(denied, moduleId)) return refuse();
  if (areas.length > 0 && !areas.some((key) => reaches(denied, key))) return refuse();
  return null;
}

/**
 * The non-throwing form, for a nav strip deciding which tabs to draw.
 *
 * A row this returns false for is not drawn AND its page 404s — the two read
 * the same list through `deniedFor`, which is cached per request, so they
 * cannot disagree. A menu that hides what a page still serves is the failure
 * mode that makes a permission screen worthless.
 */
export async function canReach(tenantId: string, key: string): Promise<boolean> {
  return reaches(await deniedFor(tenantId), key);
}

/**
 * A module's CATEGORY — `core`, `pack` or `system`.
 *
 * The row says what a module IS, not what one tenant has done with it, so this
 * reads `modules` rather than `tenant_modules`. Null when the slug is not
 * registered at all.
 *
 * **`withTenant`, NOT `withSystem`.** The catalogue is readable in tenant
 * context — `getActiveModules` joins it that way — so there is nothing here the
 * god view is needed for, and reaching for it to read a registry would be the
 * kind of habit that later reads something else.
 *
 * The caller that wants it is `ownerFeatureAllowsWrite`
 * (`src/lib/packs/authorize.ts`), deciding whose role rule applies to work
 * raised on somebody else's record.
 */
export async function moduleCategory(
  tenantId: string,
  moduleId: string,
): Promise<string | null> {
  return withTenant(tenantId, async (tx) => {
    const row = await tx.query.modules.findFirst({
      where: eq(schema.modules.id, moduleId),
      columns: { category: true },
    });
    return row?.category ?? null;
  });
}

/**
 * EVERY TOOL THE PRODUCT ACTUALLY SHIPS, with the one line each says about
 * itself — the platform's catalogue, not one tenant's switched-on list.
 *
 * The distinction is the whole point and it is easy to get backwards. A
 * business whose website SELLS this software to an industry is usually not
 * itself in that industry: the operator tenant runs Professional services and
 * none of the farm packs, while its Homestead site sells exactly the farm
 * packs. Asking what THAT tenant has on would describe the wrong screens.
 * What bounds a screenshot is what exists in the product at all.
 *
 * `coming_soon` rows are left out: an empty slot has no screen to photograph.
 * The descriptions are maintained to track what actually ships
 * (`scripts/seed.ts`), which is what makes them usable as a bound.
 */
export async function productCatalogue(
  tx: Tx,
): Promise<Array<{ id: string; name: string; description: string }>> {
  return tx
    .select({
      id: schema.modules.id,
      name: schema.modules.name,
      description: schema.modules.description,
    })
    .from(schema.modules)
    .where(eq(schema.modules.status, "available"))
    .orderBy(asc(schema.modules.sortOrder));
}
