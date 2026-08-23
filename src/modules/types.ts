import type { ReactNode } from "react";
import type { TenantContext } from "@/lib/auth";
import type { LabelDefinition } from "@/lib/packs/resolve";

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
  /**
   * How much width the module's pages want.
   *
   * "standard" (the default) keeps the shell's centred max-w-6xl column, which
   * is right for every reading-and-forms surface in the product. "full" hands
   * the module the whole viewport, for the one shape that genuinely needs it:
   * a list beside a detail pane, where the clamp would waste half a monitor.
   *
   * Declared here rather than matched by pathname in the shell, so the shell
   * never has to know a module's name to lay it out.
   */
  layout?: "standard" | "full";
  /**
   * Words this feature lets a tenant rename. Declared so the admin screen can
   * LIST what is customisable instead of somebody having to grep for
   * `labelFor`, and so a test can catch a key used but never declared.
   */
  labels?: LabelDefinition[];
  /**
   * Server component rendered at /dashboard/m/[slug].
   *
   * `searchParams` is already awaited. Modules that keep view state in the URL
   * — which is the house pattern — read it from here; ones that do not can
   * ignore it.
   */
  Component: (props: {
    ctx: TenantContext;
    searchParams: Record<string, string | string[] | undefined>;
  }) => Promise<ReactNode> | ReactNode;
}
