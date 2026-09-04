import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { withTenant, schema } from "@/db";
import type { Module, TenantModule } from "@/db/schema";

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

/** 404s when the module isn't switched on for this tenant. */
export async function requireModuleEnabled(
  tenantId: string,
  moduleId: string,
): Promise<void> {
  if (!(await isModuleEnabled(tenantId, moduleId))) notFound();
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

