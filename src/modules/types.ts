import type { ReactNode } from "react";
import type { TenantContext } from "@/lib/auth";

/**
 * A module = a togglable feature rendered inside the client dashboard shell.
 * The DB `modules` table is the registry of what exists and is sellable;
 * this code-side definition is how an available module actually renders.
 * Industry templates (Layer 2) will later contribute their own definitions —
 * same seam, different package.
 */
export interface ModuleDefinition {
  /** Must match modules.id in the DB. */
  slug: string;
  name: string;
  /** lucide icon name used in nav (kept as string to stay serializable). */
  icon: string;
  /** Server component rendered at /dashboard/m/[slug]. */
  Component: (props: { ctx: TenantContext }) => Promise<ReactNode> | ReactNode;
}
