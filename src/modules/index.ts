import type { ModuleDefinition } from "./types";
import { HelloModule } from "./hello/HelloModule";

/**
 * Code-side module registry: slug → how it renders. The DB `modules` table
 * decides what exists and what's switched on per tenant; this map is the
 * implementation seam where real modules (accounting, CRM, …) get added in
 * Phase 2 without touching the shell.
 */
export const moduleRegistry: Record<string, ModuleDefinition> = {
  hello: {
    slug: "hello",
    name: "Hello Module",
    icon: "sparkles",
    Component: HelloModule,
  },
};

export function getModuleDefinition(slug: string): ModuleDefinition | null {
  return moduleRegistry[slug] ?? null;
}
